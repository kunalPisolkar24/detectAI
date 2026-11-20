# Architecture

Four parts, two seams, and one runtime bundle per model. The code lives entirely under `app/`; inner layers never import the wire or the cloud SDKs.

## The four parts

| Part | Directory | Responsibility |
| --- | --- | --- |
| Config | `app/config/` | resolve one typed `Settings` from dev or prod |
| Models | `app/models/` | pull and verify artifacts, build offline sessions |
| Inference | `app/inference/` | prepare text, score, aggregate — no I/O |
| Serving | `app/serving/` | auth, gRPC wire, health, reflection |

Observability (`app/observability/`) wraps the whole request as a seam; `app/boot.py` wires the parts at startup.

## The two seams

The diagrams below are deliberately small: each answers one question.

**What the outer world touches.** Serving depends on the analysis use case; the use case depends on ports, not on ONNX or Hugging Face.

```mermaid
classDiagram
    class ApiKeyAuthInterceptor
    class AIServiceServicer
    class DocumentAnalysis {
        +analyze(text, model_id)
        +stream(text, model_id)
    }
    class Observability {
        <<interface>>
        +annotate_model()
        +track_document()
        +track_batch()
        +record_engine_duration()
    }
    class Engine {
        <<interface>>
        +score(sequences)
        +warmup(length)
    }
    class ModelRuntime

    ApiKeyAuthInterceptor <|.. AIServiceServicer : gates every call
    AIServiceServicer o--> DocumentAnalysis : the one use case
    DocumentAnalysis o--> ModelRuntime : one per model_id
    ModelRuntime o--> Engine : the scoring port
    DocumentAnalysis ..> Observability : annotate and record
    note for Observability "NullObservability when the OTLP endpoint is unset"
```

**What the boot wires.** Each package is a step in `main.py`, in this order.

```mermaid
classDiagram
    class main {
        <<package>>
    }
    class boot {
        <<package>>
        +resolve_settings()
        +ensure_artifacts()
        +build_runtimes()
    }
    class config {
        <<package>>
        +deployment_flick()
    }
    class models {
        <<package>>
        +ensure_all()
        +load_all()
    }
    class serving {
        <<package>>
        +run_server()
    }
    main --> config : the plane decides the source
    main --> boot : artifacts, models, runtimes
    boot --> models : pull, then load
    main --> serving : serve only after warmup
    note for main "shutdown: close pools, then drain telemetry"
```

**What a `model_id` resolves to.** One runtime owns its own preprocessor, engine, batch width, and two pools.

```mermaid
classDiagram
    class ModelRuntime {
        +key
        +batch_size
        +max_inflight
        +provider
        +close()
    }
    class DocumentPreprocessor {
        +prepare(text)
        +split(text, encoding)
    }
    class Engine {
        <<interface>>
        +score(sequences)
    }
    class ThreadPoolExecutor {
        <<package>>
        preparation
        engine
    }
    ModelRuntime o--> DocumentPreprocessor : one
    ModelRuntime o--> Engine : one
    ModelRuntime o--> ThreadPoolExecutor : two pools
    note for ModelRuntime "preparation and inference want opposite things from one pool"
```

## Boot sequence

A boot that cannot configure, pull, load, or warm a model dies before the port is bound.

```mermaid
sequenceDiagram
    autonumber
    participant M as main
    participant C as config
    participant B as boot
    participant H as hub/store
    participant S as serving

    M->>C: resolve plane + Settings
    alt bad plane, key, or pin
        C--xM: ConfigError — boot dies
    end
    M->>B: build observability
    M->>B: ensure_model_artifacts
    B->>H: locate offline, pull misses in parallel
    alt artifact missing or wrong revision
        H--xB: typed ArtifactError — boot dies
    end
    M->>B: load_models, build_runtimes, warm
    alt provider not effective or session cannot score
        B--xM: typed error — boot dies
    end
    M->>S: run_server(port, key, analysis)
    S-->>M: serve until SIGTERM/SIGINT
```

## Where things live

- `app/main.py` — the process entry point and shutdown order.
- `app/boot.py` — the sequence above, as plain functions.
- `app/serving/server.py` — interceptors, registration, graceful drain.
- `app/inference/analysis.py` — the use case behind both RPCs.

## Next

- **[Request flow](request-flow.md)** — what happens to one call.
- **[Analysis pipeline](pipeline.md)** — what happens to one document.
- **[Design: runtime model](../../specification/design.md)** — why these seams.
