"""Infra kind: declaration schema, the queue ledger law, state plane, and the verbs."""

from __future__ import annotations

import json
from types import SimpleNamespace

import pytest

from conftest import fake_carrier_session
from app import main as cli
from app.engine.carrier import session as carrier_session
from app.engine.declaration.model import state_bucket_for
from app.kinds.locate import workspace_for
from app.kinds.infra import kind as infra_kind
from app.kinds.infra import policy, tfvars, values
from app.kinds.infra import flow as flow_module
from app.kinds.infra.declaration import (
    DeclarationError,
    declaration_errors,
    load,
)

pytestmark = pytest.mark.unit

INFRA_KIND = infra_kind()

INFRA_TOML = (
    '[service]\nslug = "infra"\nregion = "ap-southeast-2"\n\n'
    '[[queues]]\nname = "payment_events.fifo"\ndlq = "payment_events_dlq.fifo"\n'
    "max_receive_count = 5\n\n"
    '[[queues]]\nname = "payment_events_dlq.fifo"\n'
)

CACHE_TOML = (
    '[service]\nslug = "infra"\nregion = "ap-southeast-2"\n\n'
    '[[elasticache]]\nname = "detectai-dev-cache"\nengine = "redis"\n'
    'major_engine_version = "7"\nmax_data_storage_gb = 5\nmax_ecpu_per_second = 5000\n'
)

BOTH_TOML = (
    INFRA_TOML
    + '\n[[elasticache]]\nname = "detectai-dev-cache"\nengine = "redis"\n'
    'major_engine_version = "7"\nmax_data_storage_gb = 5\nmax_ecpu_per_second = 5000\n'
)

ATLAS_TOML = (
    '[service]\nslug = "infra"\nregion = "ap-southeast-2"\n\n'
    '[[atlas]]\nname = "detectai-dev-mongo"\nregion = "AP_SOUTHEAST_2"\n'
    'tier = "M0"\n'
)

AURORA_TOML = (
    '[service]\nslug = "infra"\nregion = "ap-southeast-2"\n\n'
    '[[aurora]]\nname = "detectai-dev-users"\nengine = "aurora-postgresql"\n'
    'engine_version = "16.4"\ndatabase_name = "users_db"\nport = 5432\n'
    "min_acu = 0.5\nmax_acu = 1\nnum_read_replicas = 0\n"
    "storage_encrypted = true\nbackup_retention_days = 7\n"
    "deletion_protection = false\nskip_final_snapshot = true\n"
)

ALL_TOML = (
    BOTH_TOML
    + '\n[[atlas]]\nname = "detectai-dev-mongo"\nregion = "AP_SOUTHEAST_2"\ntier = "M0"\n'
    + '\n[[aurora]]\nname = "detectai-dev-users"\nengine = "aurora-postgresql"\n'
    'engine_version = "16.4"\ndatabase_name = "users_db"\nport = 5432\n'
    "min_acu = 0.5\nmax_acu = 1\nnum_read_replicas = 0\n"
    "storage_encrypted = true\nbackup_retention_days = 7\n"
    "deletion_protection = false\nskip_final_snapshot = true\n"
)

INFRA_ENV = {"AWS_REGION": "ap-southeast-2"}
CACHE_ENV = {
    **INFRA_ENV,
    "CACHE_SUBNET_IDS": "subnet-default-ap-southeast-2-a",
    "CACHE_SECURITY_GROUP_IDS": "",
}
ATLAS_ENV = {
    **INFRA_ENV,
    "MONGODB_ATLAS_PUBLIC_KEY": "abcdefgh",
    "MONGODB_ATLAS_PRIVATE_KEY": "0123456789abcdef0123",
    "MONGODB_ATLAS_PROJECT_ID": "0123456789abcdef01234567",
    "ATLAS_DB_USERNAME": "chats_user",
    "ATLAS_DB_PASSWORD": "atlas-password-16-chars",
    "ATLAS_IP_CIDRS": "203.0.113.7/32,2401:4900::/64",
}
AURORA_ENV = {
    **INFRA_ENV,
    "DB_MASTER_USERNAME": "users",
    "DB_MASTER_PASSWORD": "local-dev-db-password-16-chars",
    "DB_SUBNET_IDS": "subnet-a,subnet-b",
    "DB_SECURITY_GROUP_IDS": "sg-0123456789abcdef0",
}

SESSION = {
    "role_arn": "arn:aws:iam::123456789012:role/detectai-infra-seeder",
    "access_key_id": "ASIAFAKE",
    "secret_access_key": "fake-secret",
    "session_token": "fake-token",
    "expires_at": "2086-01-01T00:00:00Z",
}


@pytest.fixture
def clean_tf_env(monkeypatch):
    monkeypatch.delenv("AWS_REGION", raising=False)


def write_stack(tmp_path, env_values=None, toml_text=INFRA_TOML):
    (tmp_path / "infra.toml").write_text(toml_text)
    workspace = workspace_for(INFRA_KIND, tmp_path)
    env_values = INFRA_ENV if env_values is None else env_values
    workspace.values_file.parent.mkdir(parents=True, exist_ok=True)
    workspace.values_file.write_text(
        "".join(f"{key}={value}\n" for key, value in env_values.items())
    )
    return workspace


def declaration(tmp_path, toml_text=INFRA_TOML):
    (tmp_path / "infra.toml").write_text(toml_text)
    return load(tmp_path / "infra.toml")


def test_declaration_matches_the_committed_schema(tmp_path):
    infra = declaration(tmp_path)
    assert infra.kind == "infra"
    assert infra.slug == "infra"
    assert infra.seeder_role_name == "detectai-infra-seeder"
    assert infra.region_default == "ap-southeast-2"
    assert infra.stack_root == tmp_path / "terraform"
    ledger = [(entry.name, entry.dlq, entry.max_receive_count) for entry in infra.queue_ledger]
    assert ledger == [
        ("payment_events.fifo", "payment_events_dlq.fifo", 5),
        ("payment_events_dlq.fifo", "", 0),
    ]
    assert infra.cache_ledger == ()
    assert infra.atlas_ledger == ()
    assert infra.aurora_ledger == ()


def test_declaration_supports_each_fabric_independently(tmp_path):
    queue_only = declaration(tmp_path, INFRA_TOML)
    assert len(queue_only.queue_ledger) == 2 and queue_only.cache_ledger == ()
    assert queue_only.atlas_ledger == ()

    cache_only = declaration(tmp_path, CACHE_TOML)
    assert cache_only.queue_ledger == ()
    assert [(entry.name, entry.engine, entry.major_engine_version,
             entry.max_data_storage_gb, entry.max_ecpu_per_second)
            for entry in cache_only.cache_ledger] == [
        ("detectai-dev-cache", "redis", "7", 5, 5000)
    ]

    both = declaration(tmp_path, BOTH_TOML)
    assert len(both.queue_ledger) == 2 and len(both.cache_ledger) == 1
    assert both.atlas_ledger == ()

    atlas_only = declaration(tmp_path, ATLAS_TOML)
    assert atlas_only.queue_ledger == () and atlas_only.cache_ledger == ()
    assert [(entry.name, entry.region, entry.tier) for entry in atlas_only.atlas_ledger] == [
        ("detectai-dev-mongo", "AP_SOUTHEAST_2", "M0")
    ]

    aurora_only = declaration(tmp_path, AURORA_TOML)
    assert aurora_only.queue_ledger == () and aurora_only.cache_ledger == ()
    assert aurora_only.atlas_ledger == ()
    assert [
        (
            entry.name,
            entry.engine,
            entry.engine_version,
            entry.database_name,
            entry.port,
            entry.min_acu,
            entry.max_acu,
            entry.num_read_replicas,
            entry.storage_encrypted,
            entry.backup_retention_days,
            entry.deletion_protection,
            entry.skip_final_snapshot,
        )
        for entry in aurora_only.aurora_ledger
    ] == [
        (
            "detectai-dev-users",
            "aurora-postgresql",
            "16.4",
            "users_db",
            5432,
            0.5,
            1,
            0,
            True,
            7,
            False,
            True,
        )
    ]

    all_fabrics = declaration(tmp_path, ALL_TOML)
    assert (
        len(all_fabrics.queue_ledger) == 2
        and len(all_fabrics.cache_ledger) == 1
        and len(all_fabrics.atlas_ledger) == 1
        and len(all_fabrics.aurora_ledger) == 1
    )


@pytest.mark.parametrize(
    "toml_text, message",
    (
        ('[service]\nslug = "other"', 'slug must be "infra" (the state keys'),
        ('[extra]\nx = 1\n\n[service]\nslug = "infra"', "unknown section(s) ['extra']"),
        ('[service]\nslug = "infra"\nstate = "x"', "unknown field(s) ['state']"),
        ('[[queues]]\nname = "a.fifo"', "[service] is required"),
        ('[service]\nslug = "infra"\nregion = "e u 1"', "must be a plain region code"),
        ('[service]\nslug = "infra"', "declare at least one fabric"),
        ('[service]\nslug = "infra"\nqueues = []', "declare at least one fabric"),
        ('[service]\nslug = "infra"\nelasticache = []', "declare at least one fabric"),
        (
            '[service]\nslug = "infra"\n[[elasticache]]\nname = "Cache_One"',
            "must be a lowercase DNS-style name",
        ),
        (
            '[service]\nslug = "infra"\n[[elasticache]]\nname = "cache-one"\nengine = "memcached"',
            "must be 'redis'",
        ),
        (
            '[service]\nslug = "infra"\n[[elasticache]]\nname = "cache-one"\nmax_data_storage_gb = 0',
            "max_data_storage_gb must be an integer 1-5000",
        ),
        (
            '[service]\nslug = "infra"\n[[elasticache]]\nname = "cache-one"\nmax_ecpu_per_second = 999',
            "max_ecpu_per_second must be an integer 1000-15000000",
        ),
        (
            '[service]\nslug = "infra"\n[[elasticache]]\nname = "cache-one"\nunrelated = 1',
            "unknown field(s) ['unrelated']",
        ),
        (
            '[service]\nslug = "infra"\n[[atlas]]\nname = "mongo-one"\nregion = "ap-southeast-2"',
            "must be an Atlas region name",
        ),
        (
            '[service]\nslug = "infra"\n[[atlas]]\nname = "mongo-one"\nregion = "AP_SOUTHEAST_2"\ntier = "M10"',
            "must be 'M0'",
        ),
        (
            '[service]\nslug = "infra"\n[[atlas]]\nname = "Mongo_One"\nregion = "AP_SOUTHEAST_2"',
            "must be a lowercase DNS-style name",
        ),
        (
            '[service]\nslug = "infra"\n[[atlas]]\nname = "mongo-one"\nregion = "AP_SOUTHEAST_2"\nunrelated = 1',
            "unknown field(s) ['unrelated']",
        ),
        (
            '[service]\nslug = "infra"\n[[queues]]\nname = "queue"',
            "must be a FIFO name",
        ),
        (
            '[service]\nslug = "infra"\n[[queues]]\nname = "a.fifo"\n[[queues]]\nname = "a.fifo"',
            "declared twice",
        ),
        (
            '[service]\nslug = "infra"\n[[queues]]\nname = "a.fifo"\ndlq = "a.fifo"\nmax_receive_count = 5',
            "redrives to itself",
        ),
        (
            '[service]\nslug = "infra"\n[[queues]]\nname = "a.fifo"\ndlq = "ghost.fifo"\nmax_receive_count = 5\n[[queues]]\nname = "b.fifo"\n',
            "redrives to 'ghost.fifo', which is not declared",
        ),
        (
            '[service]\nslug = "infra"\n[[queues]]\nname = "a.fifo"\nmax_receive_count = 5',
            "declares no dlq; max_receive_count is meaningless",
        ),
        (
            '[service]\nslug = "infra"\n[[queues]]\nname = "a.fifo"\ndlq = "b.fifo"\n[[queues]]\nname = "b.fifo"',
            "max_receive_count (1-1000) is required",
        ),
        (
            '[service]\nslug = "infra"\n[[queues]]\nname = "a.fifo"\ndlq = "b.fifo"\nmax_receive_count = 0\n[[queues]]\nname = "b.fifo"',
            "must be an integer 1-1000",
        ),
        (
            '[service]\nslug = "infra"\n[[queues]]\nname = "a.fifo"\ndlq = "b.fifo"\nmax_receive_count = "5"\n[[queues]]\nname = "b.fifo"',
            "must be an integer 1-1000",
        ),
        (
            '[service]\nslug = "infra"\n[[queues]]\nname = "a.fifo"\ndlq = "b.fifo"\nmax_receive_count = 5\n'
            '[[queues]]\nname = "b.fifo"\ndlq = "c.fifo"\nmax_receive_count = 1',
            "is itself a redrive target; DLQ chains are not modeled",
        ),
        (
            '[service]\nslug = "infra"\n[[queues]]\nname = "a.fifo"\nunrelated = 1',
            "unknown field(s) ['unrelated']",
        ),
        (
            '[service]\nslug = "infra"\n[[aurora]]\nname = "DB_One"',
            "must be a lowercase DNS-style name",
        ),
        (
            '[service]\nslug = "infra"\n[[aurora]]\nname = "db-one"\nengine = "mysql"',
            "must be 'aurora-postgresql'",
        ),
        (
            '[service]\nslug = "infra"\n[[aurora]]\nname = "db-one"\ndatabase_name = "users_db"\nmin_acu = 0.25\nmax_acu = 1',
            "min_acu must be a number 0.5-128 in 0.5 steps",
        ),
        (
            '[service]\nslug = "infra"\n[[aurora]]\nname = "db-one"\ndatabase_name = "users_db"\nmin_acu = 2\nmax_acu = 1',
            "min_acu 2 exceeds max_acu 1",
        ),
        (
            '[service]\nslug = "infra"\n[[aurora]]\nname = "db-one"\ndatabase_name = "users_db"\nmin_acu = 0.5\nmax_acu = 1\nnum_read_replicas = -1',
            "num_read_replicas must be a non-negative integer",
        ),
        (
            '[service]\nslug = "infra"\n[[aurora]]\nname = "db-one"\ndatabase_name = "users_db"\nmin_acu = 0.5\nmax_acu = 1\nbackup_retention_days = 0',
            "backup_retention_days must be an integer 1-35",
        ),
        (
            '[service]\nslug = "infra"\n[[aurora]]\nname = "db-one"\ndatabase_name = "9bad"\nmin_acu = 0.5\nmax_acu = 1',
            "must be a plain SQL identifier",
        ),
        (
            '[service]\nslug = "infra"\n[[aurora]]\nname = "db-one"\ndatabase_name = "users_db"\nmin_acu = 0.5\nmax_acu = 1\nunrelated = 1',
            "unknown field(s) ['unrelated']",
        ),
        ("[queues", "cannot read"),
    ),
)
def test_declaration_errors(tmp_path, toml_text, message):
    (tmp_path / "infra.toml").write_text(toml_text)
    with pytest.raises(DeclarationError) as excinfo:
        load(tmp_path / "infra.toml")
    assert message in str(excinfo.value)


def test_plane_choice_follows_the_flags_only():
    assert values.resolve_plane({}, True, False) is False
    assert values.resolve_plane({}, False, True) is True
    assert values.resolve_plane({}, False, False) is True


def test_the_state_bucket_is_derived_from_slug_and_account():
    """No env override anywhere: the engine's derivation is the bucket law."""
    assert state_bucket_for("infra", "000000000000") == "detectai-infra-tfstate-000000000000"
    assert state_bucket_for("infra", "123456789012") == "detectai-infra-tfstate-123456789012"


def test_state_shape_errors_name_the_line_and_the_fix():
    errors = values.validate_state({"AWS_REGION": "eu-west"})
    text = "\n".join(errors)
    assert "AWS_REGION is not a valid region: 'eu-west'" in text
    assert "fix:" in text


def test_a_stray_tf_state_bucket_line_is_inert(tmp_path):
    """A stray TF_STATE_BUCKET line validates clean on both planes: no
    override, no note, no error — the derived bucket wins everywhere."""
    stray = {**INFRA_ENV, "TF_STATE_BUCKET": "custom-tfstate"}
    assert values.validate(declaration(tmp_path), stray, True) == []
    assert values.validate(declaration(tmp_path), stray, False) == []


def test_the_kind_validate_is_state_only_for_queue_only_stacks(tmp_path):
    assert values.validate(declaration(tmp_path), {"AWS_REGION": "ap-southeast-2"}, True) == []


def test_the_cache_placement_law_applies_only_when_a_cache_is_declared(tmp_path):
    queue_only = declaration(tmp_path, INFRA_TOML)
    assert values.validate(queue_only, INFRA_ENV, True) == []

    cache_only = declaration(tmp_path, CACHE_TOML)
    errors = "\n".join(values.validate(cache_only, INFRA_ENV, True))
    assert "CACHE_SUBNET_IDS is required" in errors
    assert "REDIS_AUTH_TOKEN" not in errors
    assert values.validate(cache_only, CACHE_ENV, True) == []
    assert values.validate(cache_only, CACHE_ENV, False) == []


def test_the_atlas_law_applies_on_every_plane(tmp_path):
    atlas_only = declaration(tmp_path, ATLAS_TOML)
    for is_emulator in (True, False):
        missing = "\n".join(values.validate(atlas_only, INFRA_ENV, is_emulator))
        assert "MONGODB_ATLAS_PUBLIC_KEY is required" in missing
        assert "ATLAS_IP_CIDRS is required" in missing
        assert values.validate(atlas_only, ATLAS_ENV, is_emulator) == []

    bad_cidr = {**ATLAS_ENV, "ATLAS_IP_CIDRS": "not-a-cidr"}
    assert "is not a valid IPv4 or IPv6 CIDR" in "\n".join(
        values.validate(atlas_only, bad_cidr, True)
    )
    bad_project = {**ATLAS_ENV, "MONGODB_ATLAS_PROJECT_ID": "xyz"}
    assert "24-character hex string" in "\n".join(
        values.validate(atlas_only, bad_project, True)
    )


def test_the_aurora_law_applies_only_when_a_database_is_declared(tmp_path):
    aurora_only = declaration(tmp_path, AURORA_TOML)
    missing = "\n".join(values.validate(aurora_only, INFRA_ENV, True))
    assert "DB_MASTER_USERNAME is required" in missing
    assert "DB_MASTER_PASSWORD is required" in missing
    assert "DB_SUBNET_IDS is required" in missing
    assert values.validate(aurora_only, AURORA_ENV, True) == []
    assert values.validate(aurora_only, AURORA_ENV, False) == []

    short = {**AURORA_ENV, "DB_MASTER_PASSWORD": "short"}
    assert "16+ characters" in "\n".join(values.validate(aurora_only, short, True))


def test_the_seeder_policy_scopes_the_state_plane_and_exactly_the_ledger(tmp_path):
    document = policy.seeder_policy_document(
        declaration(tmp_path), {}, True, "arn:aws:iam::123456789012:user/u"
    )
    assert document["Version"] == "2012-10-17"
    assert [statement["Sid"] for statement in document["Statement"]] == [
        "RunTerraformStateBucket",
        "RunTerraformStateObjects",
        "ManageQueueFabric",
    ]
    queue_statement = document["Statement"][2]
    actions = queue_statement["Action"]
    assert all(action.startswith("sqs:") for action in actions)
    assert "sqs:CreateQueue" in actions
    assert "sqs:SetQueueAttributes" in actions
    assert "sqs:DeleteQueue" in actions
    assert queue_statement["Resource"] == [
        "arn:aws:sqs:ap-southeast-2:000000000000:payment_events.fifo",
        "arn:aws:sqs:ap-southeast-2:000000000000:payment_events_dlq.fifo",
    ]
    s3_resources = [
        resource for statement in document["Statement"][:2] for resource in statement["Resource"]
    ]
    assert s3_resources == [
        "arn:aws:s3:::detectai-infra-tfstate-000000000000",
        "arn:aws:s3:::detectai-infra-tfstate-000000000000/*",
    ]


def test_the_seeder_policy_locks_the_queues_to_the_stacks_region(tmp_path):
    document = policy.seeder_policy_document(
        declaration(tmp_path), {}, False, "arn:aws:iam::123456789012:user/u"
    )
    queue_resources = document["Statement"][2]["Resource"]
    assert all(":sqs:ap-southeast-2:" in resource for resource in queue_resources)


def test_the_seeder_policy_adds_cache_access_only_for_declared_caches(tmp_path):
    cache_only = declaration(tmp_path, CACHE_TOML)
    document = policy.seeder_policy_document(
        cache_only, {}, True, "arn:aws:iam::123456789012:user/u"
    )
    assert [statement["Sid"] for statement in document["Statement"]] == [
        "RunTerraformStateBucket",
        "RunTerraformStateObjects",
        "ManageCacheFabric",
    ]
    cache_statement = document["Statement"][2]
    assert set(cache_statement["Action"]) == {
        "elasticache:CreateServerlessCache",
        "elasticache:DeleteServerlessCache",
        "elasticache:DescribeServerlessCaches",
        "elasticache:ModifyServerlessCache",
        "elasticache:ListTagsForResource",
        "elasticache:AddTagsToResource",
        "elasticache:RemoveTagsFromResource",
    }
    assert cache_statement["Resource"] == [
        "arn:aws:elasticache:ap-southeast-2:000000000000:serverlesscache:detectai-dev-cache",
    ]

    both = policy.seeder_policy_document(
        declaration(tmp_path, BOTH_TOML), {}, True, "arn:aws:iam::123456789012:user/u"
    )
    assert [statement["Sid"] for statement in both["Statement"]] == [
        "RunTerraformStateBucket",
        "RunTerraformStateObjects",
        "ManageQueueFabric",
        "ManageCacheFabric",
    ]


def test_the_seeder_policy_adds_database_access_only_for_declared_aurora(tmp_path):
    aurora_only = declaration(tmp_path, AURORA_TOML)
    document = policy.seeder_policy_document(
        aurora_only, {}, True, "arn:aws:iam::123456789012:user/u"
    )
    assert [statement["Sid"] for statement in document["Statement"]] == [
        "RunTerraformStateBucket",
        "RunTerraformStateObjects",
        "ManageDatabaseFabric",
    ]
    db_statement = document["Statement"][2]
    assert all(action.startswith("rds:") for action in db_statement["Action"])
    assert not any("proxy" in action.lower() for action in db_statement["Action"])
    assert db_statement["Resource"] == [
        "arn:aws:rds:ap-southeast-2:000000000000:cluster:detectai-dev-users",
        "arn:aws:rds:ap-southeast-2:000000000000:db:detectai-dev-users-writer",
        "arn:aws:rds:ap-southeast-2:000000000000:subgrp:detectai-dev-users-subnet-group",
    ]


def test_tf_vars_carry_the_ledger_region_and_emulator(tmp_path, monkeypatch, clean_tf_env):
    infra = declaration(tmp_path)
    built = tfvars.build_tf_vars(infra, INFRA_ENV, True)
    assert built["TF_VAR_aws_region"] == "ap-southeast-2"
    assert built["TF_VAR_emulator_endpoint"] == "http://localhost:4566"
    assert json.loads(built["TF_VAR_queues"]) == {
        "payment_events.fifo": {
            "name": "payment_events.fifo",
            "dlq": "payment_events_dlq.fifo",
            "max_receive_count": 5,
        },
        "payment_events_dlq.fifo": {
            "name": "payment_events_dlq.fifo",
            "dlq": "",
            "max_receive_count": 0,
        },
    }
    assert json.loads(built["TF_VAR_cache_clusters"]) == {}
    assert json.loads(built["TF_VAR_atlas_clusters"]) == {}
    assert json.loads(built["TF_VAR_db_clusters"]) == {}
    assert "TF_VAR_cache_auth_token" not in built
    assert "TF_VAR_db_master_username" not in built
    assert "TF_VAR_atlas_public_key" not in built
    assert "TF_VAR_emulator_endpoint" not in tfvars.build_tf_vars(infra, INFRA_ENV, False)


def test_tf_vars_carry_the_cache_ledger_and_placement(tmp_path, clean_tf_env):
    built = tfvars.build_tf_vars(declaration(tmp_path, CACHE_TOML), CACHE_ENV, True)
    assert json.loads(built["TF_VAR_queues"]) == {}
    assert json.loads(built["TF_VAR_cache_clusters"]) == {
        "detectai-dev-cache": {
            "name": "detectai-dev-cache",
            "engine": "redis",
            "major_engine_version": "7",
            "max_data_storage_gb": 5,
            "max_ecpu_per_second": 5000,
        }
    }
    assert "TF_VAR_cache_auth_token" not in built
    assert json.loads(built["TF_VAR_cache_subnet_ids"]) == [
        "subnet-default-ap-southeast-2-a"
    ]
    assert json.loads(built["TF_VAR_cache_security_group_ids"]) == []
    assert built["TF_VAR_emulator_endpoint"] == "http://localhost:4566"


def test_tf_vars_carry_the_atlas_ledger_and_credentials(tmp_path, clean_tf_env):
    built = tfvars.build_tf_vars(declaration(tmp_path, ATLAS_TOML), ATLAS_ENV, False)
    assert json.loads(built["TF_VAR_atlas_clusters"]) == {
        "detectai-dev-mongo": {
            "name": "detectai-dev-mongo",
            "region": "AP_SOUTHEAST_2",
            "tier": "M0",
        }
    }
    assert built["TF_VAR_atlas_public_key"] == "abcdefgh"
    assert built["TF_VAR_atlas_private_key"] == "0123456789abcdef0123"
    assert built["TF_VAR_atlas_project_id"] == "0123456789abcdef01234567"
    assert built["TF_VAR_atlas_db_username"] == "chats_user"
    assert built["TF_VAR_atlas_db_password"] == "atlas-password-16-chars"
    assert json.loads(built["TF_VAR_atlas_ip_cidrs"]) == [
        "203.0.113.7/32",
        "2401:4900::/64",
    ]
    assert "TF_VAR_emulator_endpoint" not in built


def test_tf_vars_carry_the_aurora_ledger_and_credentials(tmp_path, clean_tf_env):
    built = tfvars.build_tf_vars(declaration(tmp_path, AURORA_TOML), AURORA_ENV, True)
    assert json.loads(built["TF_VAR_db_clusters"]) == {
        "detectai-dev-users": {
            "name": "detectai-dev-users",
            "engine": "aurora-postgresql",
            "engine_version": "16.4",
            "database_name": "users_db",
            "port": 5432,
            "min_acu": 0.5,
            "max_acu": 1,
            "num_read_replicas": 0,
            "storage_encrypted": True,
            "backup_retention_days": 7,
            "deletion_protection": False,
            "skip_final_snapshot": True,
        }
    }
    assert built["TF_VAR_db_master_username"] == "users"
    assert built["TF_VAR_db_master_password"] == "local-dev-db-password-16-chars"
    assert json.loads(built["TF_VAR_db_subnet_ids"]) == ["subnet-a", "subnet-b"]
    assert json.loads(built["TF_VAR_db_security_group_ids"]) == ["sg-0123456789abcdef0"]


def test_stack_verb_flow_dry_run_prints_the_backend_and_commands(
    tmp_path, capsys, monkeypatch, clean_tf_env
):
    infra = declaration(tmp_path)
    monkeypatch.setattr(
        flow_module,
        "run_terraform",
        lambda *a, **k: (_ for _ in ()).throw(AssertionError("dry run must not run terraform")),
    )
    args = SimpleNamespace(dry_run=True)
    code = flow_module.stack_verb_flow(infra, INFRA_ENV, True, "plan", args, None)
    assert code == 0
    out = capsys.readouterr().out
    assert "carrier: role session (promoted when the command runs)" in out
    assert "fabrics: queues=2, elasticache=0, atlas=0, aurora=0" in out
    assert "state:  detectai-infra-tfstate-000000000000 / infra/floci/terraform.tfstate" in out
    assert "endpoints = {" in out
    assert "then terraform plan" in out
    assert "-var-file" not in out
    assert "(dry run: no terraform, no AWS writes)" in out


def test_stack_verb_flow_notes_atlas_is_real_on_every_plane(
    tmp_path, capsys, monkeypatch, clean_tf_env
):
    atlas = declaration(tmp_path, ATLAS_TOML)
    monkeypatch.setattr(
        flow_module,
        "run_terraform",
        lambda *a, **k: (_ for _ in ()).throw(AssertionError("dry run must not run terraform")),
    )
    args = SimpleNamespace(dry_run=True)
    for is_emulator in (True, False):
        assert flow_module.stack_verb_flow(atlas, ATLAS_ENV, is_emulator, "plan", args, None) == 0
        out = capsys.readouterr().out
        assert "fabrics: queues=0, elasticache=0, atlas=1, aurora=0" in out
        assert "note:   atlas is real MongoDB Cloud (state tracked on this plane)" in out


def test_stack_verb_flow_runs_init_then_the_verb_on_the_carrier_triplet(
    tmp_path, capsys, monkeypatch, clean_tf_env
):
    infra = declaration(tmp_path)
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
    assert flow_module.stack_verb_flow(infra, INFRA_ENV, True, "apply", args, SESSION) == 0
    assert len(calls) == 2
    init_call, verb_call = calls
    assert init_call[0] == str(infra.stack_root) and verb_call[0] == str(infra.stack_root)
    assert init_call[2]["TF_VAR_aws_region"] == "ap-southeast-2"
    assert (
        json.loads(init_call[2]["TF_VAR_queues"])["payment_events.fifo"]["max_receive_count"] == 5
    )
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


def test_stack_verb_flow_hints_when_init_fails(tmp_path, capsys, monkeypatch, clean_tf_env):
    infra = declaration(tmp_path)
    monkeypatch.setattr(flow_module, "probe_emulator", lambda endpoint: None)
    monkeypatch.setattr(flow_module, "ensure_state_bucket", lambda *a, **k: 0)
    monkeypatch.setattr(flow_module, "write_backend_hcl", lambda hcl: tmp_path / "backend.hcl")
    codes = [1, 0]

    def fake_terraform(tf_dir, tf_args, tf_vars, overlay):
        return codes.pop(0)

    monkeypatch.setattr(flow_module, "run_terraform", fake_terraform)
    args = SimpleNamespace(dry_run=False)
    assert flow_module.stack_verb_flow(infra, INFRA_ENV, True, "plan", args, SESSION) == 1
    out = capsys.readouterr().out
    assert "fix: confirm the emulator is up and rerun (the bucket is created on demand)" in out
    assert "aws --endpoint-url http://localhost:4566 s3 mb s3://detectai-infra-tfstate-000000000000" in out


def test_destroy_auto_approves_on_both_planes(tmp_path, monkeypatch, clean_tf_env):
    infra = declaration(tmp_path)
    monkeypatch.setattr(flow_module, "probe_emulator", lambda endpoint: None)
    monkeypatch.setattr(flow_module, "ensure_state_bucket", lambda *a, **k: 0)
    calls = []

    def fake_terraform(tf_dir, tf_args, tf_vars, overlay):
        calls.append(tf_args)
        return 0

    monkeypatch.setattr(flow_module, "run_terraform", fake_terraform)
    args = SimpleNamespace(dry_run=False, force_delete=False, purge_state=False, drop_seeder=False)
    assert flow_module.stack_verb_flow(infra, INFRA_ENV, True, "destroy", args, SESSION) == 0
    assert calls[-1] == ["destroy", "-input=false", "-auto-approve"]
    assert flow_module.stack_verb_flow(infra, INFRA_ENV, False, "destroy", args, SESSION) == 0
    assert calls[-1] == ["destroy", "-input=false", "-auto-approve"]


def test_destroy_tail_waits_for_a_succeeded_destroy(tmp_path, monkeypatch, clean_tf_env):
    infra = declaration(tmp_path)
    monkeypatch.setattr(flow_module, "probe_emulator", lambda endpoint: None)
    monkeypatch.setattr(flow_module, "ensure_state_bucket", lambda *a, **k: 0)
    order = []
    codes = []

    def fake_preview(declaration, values, is_emulator, account, session, bucket):
        order.append("preview")

    def fake_terraform(tf_dir, tf_args, tf_vars, overlay):
        order.append(tf_args[0])
        return codes.pop(0)

    def fake_purge(declaration, values, is_emulator, account, session, bucket):
        order.append("purge")
        return 0

    def fake_drop(declaration, values, is_emulator, dry_run):
        order.append("drop")
        return 0

    monkeypatch.setattr(flow_module, "preview_purge", fake_preview)
    monkeypatch.setattr(flow_module, "run_terraform", fake_terraform)
    monkeypatch.setattr(flow_module, "purge_state", fake_purge)
    monkeypatch.setattr(flow_module, "drop_seeder_flow", fake_drop)
    args = SimpleNamespace(dry_run=False, force_delete=False, purge_state=True, drop_seeder=True)

    codes = [0, 1]  # init ok, destroy fails
    assert flow_module.stack_verb_flow(infra, INFRA_ENV, True, "destroy", args, SESSION) == 1
    assert order == ["preview", "init", "destroy"]

    order.clear()
    codes = [0, 0]
    assert flow_module.stack_verb_flow(infra, INFRA_ENV, True, "destroy", args, SESSION) == 0
    assert order == ["preview", "init", "destroy", "purge", "drop"]


def test_destroy_notes_when_force_delete_is_set(tmp_path, monkeypatch, capsys, clean_tf_env):
    infra = declaration(tmp_path)
    monkeypatch.setattr(flow_module, "probe_emulator", lambda endpoint: None)
    monkeypatch.setattr(flow_module, "ensure_state_bucket", lambda *a, **k: 0)
    monkeypatch.setattr(flow_module, "run_terraform", lambda tf_dir, tf_args, tf_vars, overlay: 0)
    args = SimpleNamespace(dry_run=False, force_delete=True, purge_state=False, drop_seeder=False)
    assert flow_module.stack_verb_flow(infra, INFRA_ENV, True, "destroy", args, SESSION) == 0
    assert "--force-delete is secrets-only" in capsys.readouterr().out


def test_cli_plan_dry_run_previews_the_plane(tmp_path, monkeypatch, capsys, clean_tf_env):
    workspace = write_stack(tmp_path)
    monkeypatch.setattr(
        flow_module,
        "run_terraform",
        lambda *a, **k: (_ for _ in ()).throw(AssertionError("dry run must not run terraform")),
    )
    assert cli.main(["plan", "--dry-run"], workspace=workspace) == 0
    out = capsys.readouterr().out
    assert "plane:   floci" in out
    assert "fabrics: queues=2, elasticache=0, atlas=0, aurora=0" in out
    assert "(dry run: no terraform, no AWS writes)" in out


def test_cli_rejects_foreign_verbs_for_the_infra_kind(tmp_path, capsys):
    workspace = write_stack(tmp_path)
    with pytest.raises(SystemExit) as excinfo:
        cli.main(["check"], workspace=workspace)
    assert excinfo.value.code == 1
    assert "check is not a verb of the infra kind" in capsys.readouterr().out

    with pytest.raises(SystemExit) as excinfo:
        cli.main(["verify"], workspace=workspace)
    assert excinfo.value.code == 1
    assert "verify is not a verb of the infra kind" in capsys.readouterr().out


def test_cli_auto_apply_runs_plan_apply_and_stops(tmp_path, monkeypatch, capsys, clean_tf_env):
    workspace = write_stack(tmp_path)
    order = []

    def fake_terraform(tf_dir, tf_args, tf_vars, overlay=None):
        order.append(tf_args[0])
        return 0

    monkeypatch.setattr(flow_module, "run_terraform", fake_terraform)
    monkeypatch.setattr(flow_module, "probe_emulator", lambda endpoint: None)
    monkeypatch.setattr(flow_module, "ensure_state_bucket", lambda *a, **k: 0)
    monkeypatch.setattr(cli, "resolve_carrier_session", fake_carrier_session)
    assert cli.main(["auto-apply"], workspace=workspace) == 0
    assert order == ["init", "plan", "init", "apply"]  # no verify: this kind supplies none


def test_cli_auto_apply_dry_run_has_no_verify_tail(tmp_path, monkeypatch, capsys, clean_tf_env):
    workspace = write_stack(tmp_path)

    def boom(*a, **k):
        raise AssertionError("dry run must not run terraform")

    monkeypatch.setattr(flow_module, "run_terraform", boom)
    monkeypatch.setattr(flow_module, "ensure_state_bucket", boom)
    assert cli.main(["auto-apply", "--dry-run"], workspace=workspace) == 0
    out = capsys.readouterr().out
    assert "then apply:  terraform apply with the same backend overrides" in out
    assert "then verify" not in out


def test_cli_session_clear_targets_only_the_infra_cache(monkeypatch, tmp_path, capsys):
    monkeypatch.setattr(carrier_session, "CACHE_ROOT", tmp_path / "cache")
    workspace = write_stack(tmp_path)
    cache = tmp_path / "cache" / "infra.json"
    other = tmp_path / "cache" / "document-parser.json"
    cache.parent.mkdir(parents=True, exist_ok=True)
    cache.write_text("{}")
    other.write_text("{}")

    assert cli.main(["session-clear"], workspace=workspace) == 0
    assert not cache.exists()
    assert other.exists()  # scoped: another stack's cached triplet stays
    assert f"removed: {cache}" in capsys.readouterr().out

    assert cli.main(["session-clear"], workspace=workspace) == 0  # rerun is a no-op
    assert "nothing to clear (no cached seeder session for infra)" in capsys.readouterr().out


def test_cli_session_refresh_clears_then_mints_in_order(
    monkeypatch, tmp_path, capsys, clean_tf_env
):
    monkeypatch.setattr(carrier_session, "CACHE_ROOT", tmp_path / "cache")
    workspace = write_stack(tmp_path)
    cache = tmp_path / "cache" / "infra.json"
    other = tmp_path / "cache" / "document-parser.json"
    cache.parent.mkdir(parents=True, exist_ok=True)
    cache.write_text("{}")
    other.write_text("{}")
    order = []

    def fake_resolve(declaration, values, is_emulator, dry_run, cache_path, policy):
        order.append(("mint", cache_path.name, not cache_path.exists(), is_emulator))
        return SESSION

    monkeypatch.setattr(cli, "resolve_carrier_session", fake_resolve)
    assert cli.main(["session-refresh"], workspace=workspace) == 0
    assert order == [("mint", "infra.json", True, True)]
    assert other.exists()  # scoped: another stack's cached triplet stays
    assert f"removed: {cache}" in capsys.readouterr().out


def test_cli_session_refresh_dry_run_deletes_nothing(monkeypatch, tmp_path, capsys, clean_tf_env):
    monkeypatch.setattr(carrier_session, "CACHE_ROOT", tmp_path / "cache")
    workspace = write_stack(tmp_path)
    cache = tmp_path / "cache" / "infra.json"
    cache.parent.mkdir(parents=True, exist_ok=True)
    cache.write_text("{}")

    def boom(*a, **k):
        raise AssertionError("dry run must not mint a session")

    monkeypatch.setattr(cli, "resolve_carrier_session", boom)
    assert cli.main(["session-refresh", "--dry-run"], workspace=workspace) == 0
    assert cache.exists()
    out = capsys.readouterr().out
    assert f"would clear: {cache}" in out
    assert "then mint: a fresh carrier triplet" in out


def test_cli_destroy_dry_run_previews_the_tail(tmp_path, monkeypatch, capsys, clean_tf_env):
    workspace = write_stack(tmp_path)

    def boom(*a, **k):
        raise AssertionError("dry run must not run terraform")

    monkeypatch.setattr(flow_module, "run_terraform", boom)
    monkeypatch.setattr(flow_module, "ensure_state_bucket", boom)
    arguments = ["destroy", "--purge-state", "--drop-seeder", "--dry-run"]
    assert cli.main(arguments, workspace=workspace) == 0
    out = capsys.readouterr().out
    assert "then terraform destroy" in out
    assert "then purge: every object version in detectai-infra-tfstate-000000000000" in out
    assert "then drop: detectai-infra-seeder inline policy and role" in out


def test_cli_missing_values_file_demands_the_make_env_step(tmp_path, capsys):
    (tmp_path / "infra.toml").write_text(INFRA_TOML)
    workspace = workspace_for(INFRA_KIND, tmp_path)
    with pytest.raises(SystemExit) as excinfo:
        cli.main(["plan"], workspace=workspace)
    assert excinfo.value.code == 1
    assert "make env` in infra" in capsys.readouterr().out


def test_cli_seeder_drop_is_available_to_the_infra_kind(tmp_path, capsys):
    workspace = write_stack(tmp_path)
    assert cli.main(["seeder-drop", "--dry-run"], workspace=workspace) == 0
    out = capsys.readouterr().out
    assert "would run: aws --region ap-southeast-2 --endpoint-url http://localhost:4566 iam" in out
    assert "--role-name detectai-infra-seeder" in out
    assert "deleted: detectai-infra-seeder" not in out


def test_cli_stack_dir_drives_a_stack_from_a_foreign_cwd(
    tmp_path, monkeypatch, capsys, clean_tf_env
):
    stack_dir = tmp_path / "terraform"
    stack_dir.mkdir()
    write_stack(stack_dir)
    elsewhere = tmp_path / "elsewhere"
    elsewhere.mkdir()
    monkeypatch.chdir(elsewhere)
    assert cli.main(["plan", "--dry-run", "--stack-dir", str(stack_dir)]) == 0
    out = capsys.readouterr().out
    assert "plane:   floci (emulator http://localhost:4566)" in out
    assert "fabrics: queues=2, elasticache=0, atlas=0, aurora=0" in out


def test_cli_stack_dir_resolves_a_relative_name_against_the_repo_root(
    tmp_path, monkeypatch, capsys, clean_tf_env
):
    stack_dir = tmp_path / "infra"
    stack_dir.mkdir()
    write_stack(stack_dir)
    elsewhere = tmp_path / "elsewhere"
    elsewhere.mkdir()
    monkeypatch.chdir(elsewhere)
    monkeypatch.setattr(cli, "REPO_ROOT", tmp_path)
    assert cli.main(["plan", "--dry-run", "--stack-dir", "infra"]) == 0
    out = capsys.readouterr().out
    assert "plane:   floci (emulator http://localhost:4566)" in out


def test_cli_stack_dir_does_not_apply_to_batch_verbs(tmp_path, capsys):
    with pytest.raises(SystemExit) as excinfo:
        cli.main(["session-clear-all", "--stack-dir", str(tmp_path)])
    assert excinfo.value.code == 1
    assert "--stack-dir does not apply to the session-clear-all command" in capsys.readouterr().out


@pytest.mark.parametrize(
    "override, message",
    (
        ({"queues": "not a list"}, "[queues] must be a list"),
        ({"elasticache": "not a list"}, "[elasticache] must be a list"),
        ({"atlas": "not a list"}, "[atlas] must be a list"),
        ({"queues": ["not a table"]}, "every [[queues]] entry must be a table"),
        ({"queues": [{"name": "a.fifo", "dlq": "BAD"}]}, "dlq 'BAD' must be a FIFO name"),
        ({"elasticache": ["not a table"]}, "every [[elasticache]] entry must be a table"),
        (
            {"elasticache": [{"name": "cache-one"}, {"name": "cache-one"}]},
            "cache-one is declared twice",
        ),
        (
            {"elasticache": [{"name": "cache-one", "major_engine_version": "7.0"}]},
            "major_engine_version '7.0' must be a major version",
        ),
        (
            {"elasticache": [{"name": "cache-one", "max_data_storage_gb": 5001}]},
            "max_data_storage_gb must be an integer 1-5000",
        ),
        (
            {"elasticache": [{"name": "cache-one", "max_ecpu_per_second": True}]},
            "max_ecpu_per_second must be an integer 1000-15000000",
        ),
        ({"atlas": ["not a table"]}, "every [[atlas]] entry must be a table"),
        (
            {
                "atlas": [
                    {"name": "mongo-one", "region": "AP_SOUTHEAST_2"},
                    {"name": "mongo-one", "region": "AP_SOUTHEAST_2"},
                ]
            },
            "mongo-one is declared twice",
        ),
    ),
)
def test_declaration_errors_cover_malformed_fabric_entries(override, message):
    data = {"service": {"slug": "infra"}, "queues": [{"name": "a.fifo"}]}
    data.update(override)
    assert any(message in error for error in declaration_errors(data))
