# Publishing Flow

This document explains what happens step-by-step when you publish a model. We'll trace through both a dry-run and a real publish.

## Overview

Publishing a model is a one-shot operation with three phases:

```mermaid
graph LR
    A[1. Validate] --> B[2. Upload]
    B --> C[3. Tag]
    A -.->|dry-run stops here| D[Done]
    C --> D
```

1. **Validate** — Check inputs and locate assets on disk
2. **Upload** — Push asset files to HuggingFace Hub
3. **Tag** — Create a version tag on the repo

In dry-run mode, only phase 1 runs. Phases 2 and 3 are skipped.

## Full Publish Flow

Here's the complete sequence for a real publish:

```mermaid
sequenceDiagram
    participant You as You (CLI)
    participant Main as main.py
    participant Settings as Settings Provider
    participant Container as Composition Root
    participant UseCase as PublishModelUseCase
    participant Store as LocalArtifactStore
    participant Registry as HuggingFaceRegistry
    participant HF as HuggingFace Hub

    You->>Main: python main.py --model detect-ai-spark --version v1.0.0
    Main->>Main: Parse CLI arguments
    Main->>Settings: get_settings()
    Settings-->>Main: Settings (hf_token, hf_username, ...)

    Main->>Container: build_publisher(settings)
    Container->>Container: Create HuggingFaceRegistry
    Container->>Container: Create LocalArtifactStore
    Container->>Container: Inject into PublishModelUseCase
    Container-->>Main: PublishModelUseCase instance

    Main->>UseCase: execute(PublishCommand)

    rect rgb(240, 248, 255)
        Note over UseCase,Store: Phase 1 — Validate
        UseCase->>Store: resolve(model, version, description)
        Store->>Store: Validate model key (regex)
        Store->>Store: Validate version (regex)
        Store->>Store: Check assets/<model> exists
        Store-->>UseCase: ArtifactBundle
    end

    rect rgb(240, 255, 240)
        Note over UseCase,HF: Phase 2 — Upload
        UseCase->>Registry: upload_artifacts(bundle)
        Registry->>HF: upload_folder(repo_id, folder_path)
        HF-->>Registry: URL returned
        Registry-->>UseCase: URL
    end

    rect rgb(255, 248, 240)
        Note over UseCase,HF: Phase 3 — Tag
        UseCase->>Registry: set_version_tag(bundle)
        Registry->>HF: create_tag(tag, message)
        HF-->>Registry: Tag created
        Registry-->>UseCase: Done
    end

    UseCase-->>Main: PublishResult
    Main-->>You: "Publication completed successfully"
```

### What happens at each step:

1. **Parse CLI arguments** — `main.py` reads `--model`, `--version`, `--dry-run`, etc.
2. **Load settings** — Settings provider reads from `.env` and validates `HF_TOKEN` / `HF_USERNAME`
3. **Wire dependencies** — Composition root creates all concrete implementations and injects them
4. **Resolve artifacts** — `LocalArtifactStore` checks the asset directory exists on disk and creates an `ArtifactBundle`
5. **Upload** — `HuggingFaceRegistry` calls `HfApi.upload_folder()` to push files
6. **Tag** — `HuggingFaceRegistry` calls `HfApi.create_tag()` to create a version tag
7. **Return result** — `PublishResult` with the URL and metadata is returned to `main.py`

## Dry-Run Flow

Dry-run validates everything but never touches the network:

```mermaid
sequenceDiagram
    participant You as You (CLI)
    participant Main as main.py
    participant UseCase as PublishModelUseCase
    participant Store as LocalArtifactStore
    participant Registry as HuggingFaceRegistry

    You->>Main: python main.py --model detect-ai-spark --version v1.0.0 --dry-run
    Main->>UseCase: execute(PublishCommand, dry_run=True)

    rect rgb(240, 248, 255)
        Note over UseCase,Store: Phase 1 — Validate (runs)
        UseCase->>Store: resolve(model, version, description)
        Store->>Store: Validate model key (regex)
        Store->>Store: Validate version (regex)
        Store->>Store: Check assets/<model> exists
        Store-->>UseCase: ArtifactBundle
    end

    Note over UseCase,Registry: Phases 2 & 3 — Skipped (no network)

    UseCase-->>Main: PublishResult(dry_run=True, url=None)
    Main-->>You: "Dry-run completed successfully"
```

**What's validated in dry-run:**
- Model key matches the regex pattern (e.g., `detect-ai-spark`)
- Version matches the version pattern (e.g., `v1.0.0`)
- Description is non-empty
- `assets/<model>` directory exists and is a directory

**What's NOT done:**
- No files are uploaded to HuggingFace
- No tags are created
- No network requests are made

## Error Paths

### Upload Failure Prevents Tagging

If the upload fails, the tag is never attempted:

```mermaid
sequenceDiagram
    participant UseCase as PublishModelUseCase
    participant Store as LocalArtifactStore
    participant Registry as HuggingFaceRegistry
    participant HF as HuggingFace Hub

    UseCase->>Store: resolve(model, version)
    Store-->>UseCase: ArtifactBundle

    UseCase->>Registry: upload_artifacts(bundle)
    Registry->>HF: upload_folder(...)
    HF-->>Registry: Error! (network, auth, etc.)
    Registry-->>UseCase: raise UploadFailedException

    Note over UseCase: Tag is NEVER attempted

    UseCase-->>main.py: raise UploadFailedException
```

### Tag Already Exists

If the tag already exists on HuggingFace, a `TagFailedException` is raised:

```mermaid
sequenceDiagram
    participant UseCase as PublishModelUseCase
    participant Registry as HuggingFaceRegistry
    participant HF as HuggingFace Hub

    UseCase->>Registry: set_version_tag(bundle)
    Registry->>HF: create_tag(tag="v1.0.0")
    HF-->>Registry: 409 Conflict (tag exists)
    Registry-->>UseCase: raise TagFailedException

    UseCase-->>main.py: raise TagFailedException
```

**How to fix:** Bump the version number (e.g., `v1.0.1`) or delete the existing tag on HuggingFace.

### Artifact Not Found

If the asset directory doesn't exist, the operation fails immediately:

```mermaid
sequenceDiagram
    participant UseCase as PublishModelUseCase
    participant Store as LocalArtifactStore

    UseCase->>Store: resolve(model, version)
    Store->>Store: Check assets/detect-ai-spark exists
    Store-->>UseCase: raise ArtifactNotFoundException

    Note over UseCase: Upload is NEVER attempted

    UseCase-->>main.py: raise ArtifactNotFoundException
```

## Exit Codes

| Code | Meaning | When |
|------|---------|------|
| `0` | Success | Publish (or dry-run) completed without errors |
| `1` | Runtime error | Upload failed, tag failed, artifact not found, unexpected error |
| `2` | Usage/config error | Invalid CLI arguments, bad model key/version format, missing config |

## Error Redaction

When HuggingFace returns error messages, the tool redacts any auth material:

| Original | Redacted |
|----------|----------|
| `Token hf_abc123 is invalid` | `HuggingFace error (redacted — contains auth material)` |
| `Bearer authentication required` | `HuggingFace error (redacted — contains auth material)` |
| `Rate limit exceeded` | `Rate limit exceeded` (no redaction needed) |

This prevents tokens from leaking into logs or terminal output.

## Summary

| Phase | What Happens | Network? | Dry-Run? |
|-------|--------------|----------|----------|
| Validate | Check inputs, resolve asset path | No | Yes |
| Upload | Push files to HuggingFace Hub | Yes | No |
| Tag | Create version tag on repo | Yes | No |

## Next Steps

- [Architecture](architecture.md) - How the layers connect
- [CLI Reference](../components/cli.md) - All command-line options
- [Configuration](../getting-started/configuration.md) - Settings and env vars
- [Validation](../components/validation.md) - Input validation rules
