"""Observability kind: declaration schema, credential law, state plane, and the verbs."""

from __future__ import annotations

import json
from types import SimpleNamespace
from urllib.error import HTTPError

import pytest

from app import main as cli
from app.kinds.locate import workspace_for
from app.kinds.observability import kind as observability_kind
from app.kinds.observability import account, policy, values
from app.kinds.observability import flow as flow_module
from app.kinds.observability.declaration import DeclarationError, load

pytestmark = pytest.mark.unit

OBS_KIND = observability_kind()

OBS_TOML = '[service]\nslug = "observability"\nregion = "ap-south-1"\n'

OBS_ENV = {
    "NEW_RELIC_API_KEY": "NRAK-ABCDEFGHIJKLMNOP",
    "NEW_RELIC_ACCOUNT_ID": "123456",
    "NEW_RELIC_REGION": "EU",
    "TF_STATE_BUCKET": "detectai-observability-tfstate",
    "EMULATOR_ENDPOINT": "http://localhost:4566",
    "AWS_REGION": "ap-south-1",
}

SESSION = {
    "role_arn": "arn:aws:iam::123456789012:role/detectai-observability-seeder",
    "access_key_id": "ASIAFAKE",
    "secret_access_key": "fake-secret",
    "session_token": "fake-token",
    "expires_at": "2086-01-01T00:00:00Z",
}


@pytest.fixture
def clean_nr_env(monkeypatch):
    for key in ("NEW_RELIC_API_KEY", "NEW_RELIC_ACCOUNT_ID", "NEW_RELIC_REGION", "TF_STATE_BUCKET"):
        monkeypatch.delenv(key, raising=False)


def write_stack(tmp_path, env_values=None, toml_text=OBS_TOML):
    (tmp_path / "observability.toml").write_text(toml_text)
    workspace = workspace_for(OBS_KIND, tmp_path)
    env_values = OBS_ENV if env_values is None else env_values
    workspace.values_file.parent.mkdir(parents=True, exist_ok=True)
    workspace.values_file.write_text(
        "".join(f"{key}={value}\n" for key, value in env_values.items())
    )
    return workspace


def declaration(tmp_path):
    (tmp_path / "observability.toml").write_text(OBS_TOML)
    return load(tmp_path / "observability.toml")


def test_declaration_matches_the_committed_schema(tmp_path):
    (tmp_path / "observability.toml").write_text(OBS_TOML)
    obs = load(tmp_path / "observability.toml")
    assert obs.slug == "observability"
    assert obs.kind == "observability"
    assert obs.seeder_role_name == "detectai-observability-seeder"
    assert obs.region_default == "ap-south-1"
    assert obs.stack_root == tmp_path / "terraform"


@pytest.mark.parametrize(
    "toml_text, message",
    (
        ('[service]\nslug = "other"', 'slug must be "observability" (the state keys'),
        ('[extra]\nx = 1\n\n[service]\nslug = "observability"', "unknown section(s) ['extra']"),
        ('[service]\nslug = "o"\nstate = "x"', "unknown field(s) ['state']"),
        ("[secrets]\nkeys = []", "[service] is required"),
        ('[service]\nslug = "observability"\nregion = "e u 1"', "must be a plain region code"),
        ("[service", "cannot read"),
    ),
)
def test_declaration_errors(tmp_path, toml_text, message):
    (tmp_path / "observability.toml").write_text(toml_text)
    with pytest.raises(DeclarationError) as excinfo:
        load(tmp_path / "observability.toml")
    assert message in str(excinfo.value)


def test_plane_choice_moves_with_the_flags_and_the_values_file():
    set_env = {"EMULATOR_ENDPOINT": "http://localhost:4566"}
    assert values.resolve_plane(set_env, True, False) is False
    assert values.resolve_plane({}, False, True) is True
    assert values.resolve_plane(set_env, False, False) is True
    assert values.resolve_plane({}, False, False) is False


def test_state_bucket_law_follows_the_plane(tmp_path, clean_nr_env):
    assert (
        values.resolve_state_bucket({"TF_STATE_BUCKET": "custom-bucket"}, True) == "custom-bucket"
    )
    assert values.resolve_state_bucket({}, True) == "detectai-observability-tfstate"
    assert values.resolve_state_bucket({}, False) is None


def test_state_shape_errors_name_the_line_and_the_fix():
    errors = values.validate_state(
        True,
        {"AWS_REGION": "eu-west", "EMULATOR_ENDPOINT": "localhost:4566", "TF_STATE_BUCKET": "B!AD"},
    )
    text = "\n".join(errors)
    assert "AWS_REGION is not a valid state-bucket region: 'eu-west'" in text
    assert "EMULATOR_ENDPOINT is not a valid http(s) URL" in text
    assert "TF_STATE_BUCKET is not a valid S3 bucket name: 'B!AD'" in text


def test_credential_shape_errors_name_the_credential_class():
    errors = values.validate_config(
        {
            "api_key": "eu01-LOREM-IPSUM-SHORT",
            "account_id": "12a456",
            "region": "emea",
        }
    )
    text = "\n".join(errors)
    assert "not a User API key" in text and "wrong credential class" in text
    assert "NEW_RELIC_ACCOUNT_ID must be numeric, got '12a456'" in text
    assert "NEW_RELIC_REGION must be one of US, EU, JP, got 'emea'" in text

    truncated = values.validate_config({"api_key": "NRAK-AB", "account_id": None, "region": None})
    assert "looks truncated" in truncated[0]

    missing = values.validate_config({"api_key": None, "account_id": None, "region": None})
    assert "NEW_RELIC_API_KEY is empty in envs/.env" in missing[0]

    assert (
        values.validate_config(
            {"api_key": "NRAK-ABCDEFGHIJKLMNOP", "account_id": "123456", "region": "eu"}
        )
        == []
    )


def test_build_config_prefers_the_shell_per_key(monkeypatch, tmp_path, clean_nr_env):
    monkeypatch.setenv("NEW_RELIC_API_KEY", "NRAK-FROM-THE-SHELL")
    config = values.build_config({**OBS_ENV, "NEW_RELIC_API_KEY": "NRAK-ABCDEFGHIJKLMNOP"})
    assert config == {
        "api_key": "NRAK-FROM-THE-SHELL",
        "account_id": "123456",
        "region": "EU",
    }


def test_the_kind_validate_is_state_only(tmp_path):
    # No New Relic keys at all: state shapes pass, credentials are the verbs' concern.
    assert values.validate(declaration(tmp_path), {"AWS_REGION": "ap-south-1"}, True) == []


def test_the_seeder_policy_scopes_only_the_state_bucket_family(tmp_path):
    document = policy.seeder_policy_document(
        declaration(tmp_path), {}, True, "arn:aws:iam::1:user/u"
    )
    assert document["Version"] == "2012-10-17"
    assert [statement["Sid"] for statement in document["Statement"]] == [
        "RunTerraformStateBucket",
        "RunTerraformStateObjects",
    ]
    actions = [action for statement in document["Statement"] for action in statement["Action"]]
    assert all(action.startswith("s3:") for action in actions)
    resources = [
        resource for statement in document["Statement"] for resource in statement["Resource"]
    ]
    assert all(
        resource.startswith("arn:aws:s3:::detectai-observability-tfstate") for resource in resources
    )
    object_statement = next(s for s in document["Statement"] if "s3:GetObject" in s["Action"])
    assert object_statement["Resource"] == ["arn:aws:s3:::detectai-observability-tfstate*/*"]


def test_the_seeder_policy_pins_the_resolved_bucket_not_the_default_constant(tmp_path):
    """Real AWS takes its bucket from TF_STATE_BUCKET; a policy pinned to the
    default constant would lock the role out of the bucket the run uses."""
    document = policy.seeder_policy_document(
        declaration(tmp_path), {"TF_STATE_BUCKET": "custom-tfstate"}, False, "arn:aws:iam::1:user/u"
    )
    resources = [r for s in document["Statement"] for r in s["Resource"]]
    assert resources == ["arn:aws:s3:::custom-tfstate*", "arn:aws:s3:::custom-tfstate*/*"]


def test_tf_vars_flow_the_provider_block(tmp_path, monkeypatch, clean_nr_env):
    from app.kinds.observability import tfvars

    (tmp_path / "observability.toml").write_text(OBS_TOML)
    obs = load(tmp_path / "observability.toml")
    tf_vars = tfvars.build_tf_vars(obs, OBS_ENV, True)
    assert tf_vars == {
        "TF_VAR_newrelic_api_key": "NRAK-ABCDEFGHIJKLMNOP",
        "TF_VAR_newrelic_account_id": "123456",
        "TF_VAR_newrelic_region": "EU",
    }
    assert tfvars.build_tf_vars(obs, {"NEW_RELIC_API_KEY": "NRAK-ABCDEFGHIJKLMNOP"}, True) == {
        "TF_VAR_newrelic_api_key": "NRAK-ABCDEFGHIJKLMNOP"
    }


def test_shell_state_conflicts_warn_and_lose(monkeypatch, capsys, tmp_path):
    monkeypatch.setenv("TF_STATE_BUCKET", "shell-bucket")
    values.warn_shell_conflicts({"TF_STATE_BUCKET": "envs-bucket"})
    assert "the .env value wins" in capsys.readouterr().out
    values.warn_shell_conflicts({"TF_STATE_BUCKET": "shell-bucket"})
    assert capsys.readouterr().out == ""


def test_check_flow_describes_the_credential_pair(tmp_path, capsys, monkeypatch, clean_nr_env):
    (tmp_path / "observability.toml").write_text(OBS_TOML)
    obs = load(tmp_path / "observability.toml")
    monkeypatch.setattr(flow_module, "live_check", lambda config: print("live: ok"))
    assert flow_module.check_flow(obs, OBS_ENV, True) == 0
    out = capsys.readouterr().out
    assert "NEW_RELIC_API_KEY     NRAK...MNOP (from envs/.env)" in out
    assert "NEW_RELIC_ACCOUNT_ID  123456" in out
    assert "mock — set a real account ID" in out
    assert "plane:  floci (emulator http://localhost:4566)" in out
    assert "state:  detectai-observability-tfstate" in out


def test_check_flow_reports_bad_credentials_before_describing(tmp_path, capsys, clean_nr_env):
    (tmp_path / "observability.toml").write_text(OBS_TOML)
    obs = load(tmp_path / "observability.toml")
    environment = {**OBS_ENV, "NEW_RELIC_API_KEY": "eu01-license-key"}
    environment.pop("EMULATOR_ENDPOINT")
    assert flow_module.check_flow(obs, environment, False) == 1
    out = capsys.readouterr().out
    assert "not a User API key" in out
    assert "credentials:" not in out


def test_bootstrap_flow_heals_the_plane_bucket(tmp_path, monkeypatch, capsys, clean_nr_env):
    (tmp_path / "observability.toml").write_text(OBS_TOML)
    obs = load(tmp_path / "observability.toml")
    monkeypatch.setattr(flow_module, "probe_emulator", lambda endpoint: None)
    healing = {}
    monkeypatch.setattr(
        flow_module,
        "ensure_state_bucket",
        lambda declaration, values, is_emulator, account, session=None, bucket=None: (
            healing.update(bucket=bucket, session=session) or 0
        ),
    )
    assert flow_module.bootstrap_flow(obs, {}, True, SESSION) == 0
    assert healing == {
        "bucket": "detectai-observability-tfstate",
        "session": SESSION,
    }

    with pytest.raises(SystemExit) as excinfo:
        flow_module.bootstrap_flow(obs, {}, False, SESSION)
    assert excinfo.value.code == 1
    assert "TF_STATE_BUCKET is not set" in capsys.readouterr().out


def test_stack_verb_flow_dry_run_prints_the_backend_and_commands(
    tmp_path, capsys, monkeypatch, clean_nr_env
):
    (tmp_path / "observability.toml").write_text(OBS_TOML)
    obs = load(tmp_path / "observability.toml")
    monkeypatch.setattr(
        flow_module,
        "run_terraform",
        lambda *a, **k: (_ for _ in ()).throw(AssertionError("dry run must not run terraform")),
    )
    args = SimpleNamespace(dry_run=True)
    code = flow_module.stack_verb_flow(obs, OBS_ENV, True, "plan", args, None)
    assert code == 0
    out = capsys.readouterr().out
    assert "carrier: role session (promoted when the command runs)" in out
    assert "state:  detectai-observability-tfstate / observability/floci/terraform.tfstate" in out
    assert "endpoints = {" in out
    assert "then terraform plan" in out
    assert "-var-file" not in out
    assert "(dry run: no terraform, no AWS writes)" in out


def test_stack_verb_flow_runs_init_then_the_verb_on_the_carrier_triplet(
    tmp_path, capsys, monkeypatch, clean_nr_env
):
    (tmp_path / "observability.toml").write_text(OBS_TOML)
    obs = load(tmp_path / "observability.toml")
    monkeypatch.setattr(flow_module, "probe_emulator", lambda endpoint: None)
    monkeypatch.setattr(flow_module, "ensure_state_bucket", lambda *a, **k: 0)
    backend_file = tmp_path / "backend.hcl"
    monkeypatch.setattr(flow_module, "write_backend_hcl", lambda hcl: backend_file)
    calls = []

    def fake_terraform(tf_dir, tf_args, tf_vars, overlay):
        calls.append((str(tf_dir), tf_args, dict(tf_vars), dict(overlay)))
        return 0

    monkeypatch.setattr(flow_module, "run_terraform", fake_terraform)
    args = SimpleNamespace(dry_run=False)
    assert flow_module.stack_verb_flow(obs, OBS_ENV, True, "apply", args, SESSION) == 0
    assert len(calls) == 2
    init_call, verb_call = calls
    assert init_call[0] == str(obs.stack_root) and verb_call[0] == str(obs.stack_root)
    assert init_call[2]["TF_VAR_newrelic_api_key"] == "NRAK-ABCDEFGHIJKLMNOP"
    assert any(
        arg.startswith("-backend-config=") or arg == "-backend-config" for arg in init_call[1]
    )
    assert verb_call[1] == ["apply", "-input=false", "-auto-approve"]
    assert verb_call[3] == {
        "AWS_ACCESS_KEY_ID": "ASIAFAKE",
        "AWS_SECRET_ACCESS_KEY": "fake-secret",
        "AWS_SESSION_TOKEN": "fake-token",
    }
    assert not backend_file.exists()  # the temp backend lands and unlinks in one run


def test_stack_verb_flow_hints_when_init_fails(tmp_path, capsys, monkeypatch, clean_nr_env):
    (tmp_path / "observability.toml").write_text(OBS_TOML)
    obs = load(tmp_path / "observability.toml")
    monkeypatch.setattr(flow_module, "probe_emulator", lambda endpoint: None)
    monkeypatch.setattr(flow_module, "ensure_state_bucket", lambda *a, **k: 0)
    monkeypatch.setattr(flow_module, "write_backend_hcl", lambda hcl: tmp_path / "backend.hcl")
    codes = [1, 0]

    def fake_terraform(tf_dir, tf_args, tf_vars, overlay):
        return codes.pop(0)

    monkeypatch.setattr(flow_module, "run_terraform", fake_terraform)
    args = SimpleNamespace(dry_run=False)
    assert (
        flow_module.stack_verb_flow(
            obs, {"NEW_RELIC_API_KEY": "NRAK-ABCDEFGHIJKLMNOP"}, True, "plan", args, SESSION
        )
        == 1
    )
    out = capsys.readouterr().out
    assert "fix: create the emulator state bucket and retry" in out
    assert (
        "aws --endpoint-url http://localhost:4566 s3 mb s3://detectai-observability-tfstate" in out
    )


def test_live_check_resolves_the_account_name(monkeypatch, capsys, tmp_path, clean_nr_env):
    (tmp_path / "observability.toml").write_text(OBS_TOML)

    class FakeResponse:
        def __enter__(self):
            return self

        def __exit__(self, *rest):
            return False

        def read(self):
            return json.dumps({"data": {"actor": {"account": {"name": "DetectAI"}}}}).encode()

    captured = {}
    monkeypatch.setattr(
        account.urllib.request,
        "urlopen",
        lambda request, timeout: captured.update(request=request) or FakeResponse(),
    )
    account.live_check({"api_key": "NRAK-ABCDEFGHIJKLMNOP", "account_id": "123456", "region": "EU"})
    out = capsys.readouterr().out
    assert "live: region EU, account DetectAI (123456) OK" in out
    assert captured["request"].host == "api.eu.newrelic.com"


def test_live_check_hints_at_the_user_key_on_http_errors(monkeypatch, capsys, tmp_path):
    (tmp_path / "observability.toml").write_text(OBS_TOML)

    def raise_http(request, timeout):
        raise HTTPError("https://api.eu.newrelic.com/graphql", 401, "Unauthorized", None, None)

    monkeypatch.setattr(account.urllib.request, "urlopen", raise_http)
    with pytest.raises(SystemExit) as excinfo:
        account.live_check({"api_key": "NRAK-ABC", "account_id": "123456", "region": None})
    assert excinfo.value.code == 1
    assert "User API key" in capsys.readouterr().out


def test_live_check_hints_when_the_account_is_not_visible(monkeypatch, capsys, tmp_path):
    (tmp_path / "observability.toml").write_text(OBS_TOML)

    class FakeResponse:
        def __enter__(self):
            return self

        def __exit__(self, *rest):
            return False

        def read(self):
            return json.dumps({"data": None}).encode()

    monkeypatch.setattr(account.urllib.request, "urlopen", lambda request, timeout: FakeResponse())
    with pytest.raises(SystemExit):
        account.live_check(
            {"api_key": "NRAK-ABCDEFGHIJKLMNOP", "account_id": "999999", "region": None}
        )
    assert "not visible to it" in capsys.readouterr().out


def test_cli_check_resolves_the_account(tmp_path, monkeypatch, capsys, clean_nr_env):
    workspace = write_stack(tmp_path)
    monkeypatch.setattr(flow_module, "live_check", lambda config: print("live: ok"))
    assert cli.main(["check"], workspace=workspace) == 0
    out = capsys.readouterr().out
    assert "NEW_RELIC_API_KEY     NRAK...MNOP" in out


def test_cli_rejects_foreign_verbs_for_the_observability_kind(tmp_path, capsys):
    workspace = write_stack(tmp_path)
    with pytest.raises(SystemExit) as excinfo:
        cli.main(["verify"], workspace=workspace)
    assert excinfo.value.code == 1
    assert "verify is not a verb of the observability kind" in capsys.readouterr().out


def test_cli_plan_dry_run_previews_the_plane(tmp_path, monkeypatch, capsys, clean_nr_env):
    workspace = write_stack(tmp_path)
    monkeypatch.setattr(
        flow_module,
        "run_terraform",
        lambda *a, **k: (_ for _ in ()).throw(AssertionError("dry run must not run terraform")),
    )
    assert cli.main(["plan", "--dry-run"], workspace=workspace) == 0
    out = capsys.readouterr().out
    assert "plane:   floci" in out
    assert "(dry run: no terraform, no AWS writes)" in out


def test_cli_missing_values_file_demands_the_make_env_step(tmp_path, capsys):
    (tmp_path / "observability.toml").write_text(OBS_TOML)
    workspace = workspace_for(OBS_KIND, tmp_path)
    with pytest.raises(SystemExit) as excinfo:
        cli.main(["check"], workspace=workspace)
    assert excinfo.value.code == 1
    assert "make env` in observability" in capsys.readouterr().out


def test_cli_seeder_drop_is_available_to_the_observability_kind(tmp_path, capsys):
    workspace = write_stack(tmp_path)
    assert cli.main(["seeder-drop", "--dry-run"], workspace=workspace) == 0
    out = capsys.readouterr().out
    assert "would run: aws --region ap-south-1 --endpoint-url http://localhost:4566 iam" in out
    assert "--role-name detectai-observability-seeder" in out
    assert "deleted: detectai-observability-seeder" not in out


def test_cli_stack_dir_drives_a_stack_from_a_foreign_cwd(
    tmp_path, monkeypatch, capsys, clean_nr_env
):
    stack_dir = tmp_path / "terraform"
    stack_dir.mkdir()
    write_stack(stack_dir)
    elsewhere = tmp_path / "elsewhere"
    elsewhere.mkdir()
    monkeypatch.chdir(elsewhere)
    monkeypatch.setattr(flow_module, "live_check", lambda config: print("live: ok"))
    assert cli.main(["check", "--stack-dir", str(stack_dir)]) == 0
    out = capsys.readouterr().out
    assert "NEW_RELIC_API_KEY     NRAK...MNOP" in out
    assert "plane:  floci (emulator http://localhost:4566)" in out


def test_cli_stack_dir_resolves_a_relative_name_against_the_repo_root(
    tmp_path, monkeypatch, capsys, clean_nr_env
):
    stack_dir = tmp_path / "observability"
    stack_dir.mkdir()
    write_stack(stack_dir)
    elsewhere = tmp_path / "elsewhere"
    elsewhere.mkdir()
    monkeypatch.chdir(elsewhere)
    monkeypatch.setattr(cli, "REPO_ROOT", tmp_path)
    monkeypatch.setattr(flow_module, "live_check", lambda config: print("live: ok"))
    assert cli.main(["check", "--stack-dir", "observability"]) == 0
    out = capsys.readouterr().out
    assert "NEW_RELIC_API_KEY     NRAK...MNOP" in out
    assert "plane:  floci (emulator http://localhost:4566)" in out


def test_cli_stack_dir_conflicts_with_service(tmp_path, capsys):
    with pytest.raises(SystemExit) as excinfo:
        cli.main(["check", "--service", "document-parser", "--stack-dir", str(tmp_path)])
    assert excinfo.value.code == 1
    assert "--service and --stack-dir name two different stacks" in capsys.readouterr().out


def test_cli_stack_dir_dies_on_an_unknown_directory(tmp_path, capsys):
    with pytest.raises(SystemExit) as excinfo:
        cli.main(["check", "--stack-dir", str(tmp_path)])
    assert excinfo.value.code == 1
    assert f"no secrets.toml found in {tmp_path}" in capsys.readouterr().out


def test_cli_stack_dir_does_not_apply_to_batch_verbs(tmp_path, capsys):
    with pytest.raises(SystemExit) as excinfo:
        cli.main(["session-clear-all", "--stack-dir", str(tmp_path)])
    assert excinfo.value.code == 1
    assert "--stack-dir does not apply to the session-clear-all command" in capsys.readouterr().out
