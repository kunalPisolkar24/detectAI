# model-publisher — HuggingFace model publisher for DetectAI

Publishes local `assets/<model>` folders (e.g. `assets/detect-ai-spark`, `assets/detect-ai-flare`) to HuggingFace Hub as versioned model repos, with strict validation and dry-run support.

## Clean architecture

```
src/
  core/             exceptions, constants, logging (no domain/infrastructure imports)
  domain/           constants + schemas (pure Pydantic, no FS I/O)
  interfaces/       ports: IModelRegistry, IArtifactStore (ABCs)
  application/      DTOs + use-cases (orchestrates ports, no I/O)
  infrastructure/
    config/         Settings + provider (lru_cache, clear for tests)
    filesystem/     LocalArtifactStore — the ONLY place that touches Path.exists()
    huggingface/    HuggingFaceRegistry — injected HfApi, redacted errors
    composition/    container — sole wiring place (build_publisher)
  cli/              argparse parser (testable)
main.py             thin bootstrap: parse args -> get_settings -> build_publisher -> execute
```

Dependency rule: `domain <- application <- infrastructure`, `main -> composition -> all`. Domain never imports infra.

## Setup

```bash
cp .env.example .env   # set HF_TOKEN, HF_USERNAME
poetry -C tools/model-publisher install --no-interaction
# or
make -C tools/model-publisher install
```

### Environment

| Var | Required | Default | Notes |
|-----|----------|---------|-------|
| `HF_TOKEN` | yes | — | write token, min 8 chars, not `test`/`placeholder` |
| `HF_USERNAME` | yes | — | Hub namespace |
| `PROJECT_ROOT_DIR` | no | `.` | root containing `assets/` |
| `ASSETS_DIR_NAME` | no | `assets` | folder name under root |
| `ENV_FILE` | no | `.env` | alternative dotenv path |

Empty strings are ignored (so compose empty vars don't break validation).

## Usage

```bash
# validate only — never touches network (recommended before real publish)
poetry -C tools/model-publisher run python main.py --model detect-ai-spark --version v1.0.0 --dry-run
make -C tools/model-publisher dry-run model=detect-ai-spark v=v1.0.0

# publish
poetry -C tools/model-publisher run python main.py --model detect-ai-spark --version v1.0.0
make -C tools/model-publisher upload-spark v=v1.0.0
make -C tools/model-publisher upload-flare v=v1.0.0
make -C tools/model-publisher upload model=detect-ai-spark v=v1.0.1 -- --description "hotfix" --assets-dir ./assets

# verbose + custom assets dir
poetry -C tools/model-publisher run python main.py --model detect-ai-spark --version v1.0.0 --assets-dir /tmp/assets --verbose
```

Version must match `^v\d+\.\d+\.\d+(?:[-+].+)?$` (e.g. `v1.0.0`, `v2.1.3-alpha`). Description defaults to `Production release <version>`.

Exit codes: `0` success, `2` usage/config error, `1` runtime (upload/tag/artifact missing).

## Dry-run

`--dry-run` validates model/version/description and that `PROJECT_ROOT_DIR/ASSETS_DIR_NAME/<model>` exists and is a directory, then returns without calling HuggingFace. Use it in CI and before any real `v*` publish.

## Development

```bash
make -C tools/model-publisher lint        # ruff check
make -C tools/model-publisher test        # unit (no network)
make -C tools/model-publisher test-all    # unit + integration (mocked HF, tmp_path)
make -C tools/model-publisher test-cov    # unit + coverage gate 80%
poetry -C tools/model-publisher run ruff format .   # format
```

Tests use `FakeRegistry`/`FakeStore` — no network, no token needed. Integration tests mount `tmp_path` and `mocker.patch(HfApi)`.

## Publishing flow

1. `LocalArtifactStore.resolve(model, version)` validates `model_key`/`version` (pure regex) and checks `<root>/<assets>/<model>` exists.
2. `HuggingFaceRegistry.upload_artifacts(bundle)` calls `HfApi.upload_folder(repo_id={username}/{model}, repo_type=model)`.
3. `HuggingFaceRegistry.set_version_tag(bundle)` calls `HfApi.create_tag(tag=version, tag_message=description)`. If tag already exists, raises `TagFailedException` (409).

Upload errors are wrapped as `UploadFailedException`/`TagFailedException` with redacted auth material and `repo_id` context; `upload_folder` failure never attempts tagging.

## CI

`tools-model-publisher.yaml` runs on `staging`/`main` (path-filtered) — `ruff + pytest --cov --cov-fail-under=80`. Feature branches target `dev` (no CI) — paste local `make lint/test` output in PR.

## Legacy

`src/application/publisher.py:ModelPublisher` is kept as a deprecated shim delegating to `PublishModelUseCase`; prefer `container.build_publisher`.

## Verify

```bash
# after publish, check Hub
# https://huggingface.co/<username>/<model>/tree/<version>
# tag via
# huggingface-cli repo tag list <username>/<model>  # or via UI
```
