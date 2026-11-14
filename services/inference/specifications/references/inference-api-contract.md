# Inference — API Contract (design reference)

Status: design reference for the API-contract slice, implemented in
`api/proto/ai_service.proto` (the contract), `mk/proto.mk` (stub codegen),
`app/serving/auth.py` (the `x-api-key` gate), and
`tests/unit/serving/test_contract.py` (the pins). The servicer is not
implemented; the `app/` service today serves health and denies unkeyed calls.

The quarantined `services/inference/slop/` tree is the reference draft. Its
`aidetection` contract carried slop-era vocabulary (`PredictRequest`, a `final`
event, display-name model strings) and left the important semantics unpinned —
offset spaces, confidence units, model-id handling. This slice defines the
standing contract both RPCs will be implemented against.

---

## 1. Scope

| In scope | Out of scope (later slices) |
| --- | --- |
| The proto contract: `Detect` (unary) + `AnalyzeDocument` (server-streaming) | The Python servicer and its registration on the server |
| The `x-api-key` gate on every non-health RPC (`app/serving/auth.py`) | Chunking, the engine contract (`predict_batch`), batching proxy |
| The `MAX_TEXT_CHARS` submission bound (Settings knob; servicer-enforced) | Telemetry |
| Pinned semantics: offsets, units, model-id rules, error codes | The web-side adaptation to `inference.v1` |
| Python stub codegen: `make proto` → `app/serving/generated/` | |

## 2. Mapping from the quarantined contract

| slop name | Contract name | Change |
| --- | --- | --- |
| `aidetection` | `inference.v1` | Versioned package; a breaking rename later would cost the same |
| `PredictRequest` | `DetectRequest` / `AnalyzeDocumentRequest` | Message names match their RPCs; the ML engine vocabulary leaves the wire |
| `PredictResponse` | `DetectionResult` | One result message shared by the unary response and the stream's `result` event |
| `AnalyzeDocumentEvent.final` | `AnalyzeDocumentEvent.result` | The member is the shared result, not a unary-only wrapper |
| `label` | dropped | Duplicates `is_ai_generated`; clients already derive it |
| `model_name` (`"Spark"`) | `model_id` echo | Display names stay client-side; the echo is the canonical key clients key on |
| `confidence_score` | kept | The one derived field consumers read directly, every time |

## 3. The contract

```proto
syntax = "proto3";

package inference.v1;

service AIService {
  rpc Detect (DetectRequest) returns (DetectionResult) {}
  rpc AnalyzeDocument (AnalyzeDocumentRequest) returns (stream AnalyzeDocumentEvent) {}
}

message DetectRequest {
  string text = 1;
  string model_id = 2;
}

message AnalyzeDocumentRequest {
  string text = 1;
  string model_id = 2;
}

message AnalyzeDocumentStarted {
  int32 total_chars = 1;
  int32 total_chunks = 2;
}

message AnalyzeDocumentProgress {
  int32 processed_chunks = 1;
  int32 total_chunks = 2;
}

message AnalyzeDocumentEvent {
  oneof event {
    AnalyzeDocumentStarted started = 1;
    AnalyzeDocumentProgress progress = 2;
    DetectionResult result = 3;
  }
}

message HighlightSpan {
  int32 char_start = 1;
  int32 char_end = 2;
  float ai_confidence = 3;
}

message DetectionResult {
  string model_id = 1;
  bool is_ai_generated = 2;
  float confidence_score = 3;
  float ai_confidence = 4;
  float human_confidence = 5;
  repeated HighlightSpan highlight_spans = 6;
}
```

The proto carries no comments; the pins below are the field semantics.

## 4. Pinned semantics

**Character offsets.** `char_start` / `char_end` and `total_chars` count
Unicode scalar values (code points), never UTF-8 bytes or UTF-16 units. Python
`str` indexes produce them directly; a JavaScript client converts scalar
offsets to UTF-16 indices in one mapper — `String.prototype.length` and
`slice()` are UTF-16, so emoji and other non-BMP characters shift the two.

**Confidences.** All four floats are 0–100 percentages rounded to one decimal,
not 0–1 probabilities. `confidence_score` mirrors the winning side:
`ai_confidence` when `is_ai_generated` is true, otherwise `human_confidence`.
`highlight_spans` are non-overlapping `[char_start, char_end)` ranges over the
request text.

**`model_id`.** Known values are `spark` and `flare`. Empty or missing
defaults to `spark`; an unknown value is `INVALID_ARGUMENT`. No
case-normalization is promised — clients send the canonical key, and the
response `model_id` is the canonical echo of what was used.

The **served set is deployment-scoped**: `ENABLED_MODELS` names the models a
process serves — `spark`, `flare`, or both, `spark` alone by default. A model
the deployment does not serve answers `INVALID_ARGUMENT` like any other
unknown one, with a detail naming the model and saying it is not served. The
default deployment serves `spark`, so the contract's own default for an
unnamed request resolves to a model that is actually there.

**Text limits.** Non-empty, else `INVALID_ARGUMENT`. The submission bound is
`MAX_TEXT_CHARS` scalars — 1,000,000 by default, env-overridable, and bad
values fail closed to the default — and exceeding it is `INVALID_ARGUMENT`:
admission, not truncation (a truncated document changes the analysis). A
token-count ceiling (~10,000) is a server-side engine limit, not a wire
guarantee.

**Stream guarantees.** First event is `started` (`total_chars`,
`total_chunks`). `progress` follows with `processed_chunks` strictly
increasing. Events are coalesced — one per `total_chunks / 20` completed
chunks, the last chunk always emits — so a large document yields at most ~20
progress events; coalescing is server behavior, and clients must tolerate one
per chunk. `result` is the last event, then the stream ends. A mid-stream
client cancellation surfaces as `CANCELLED`.

## 5. Error semantics

| Path | Code | Notes |
| --- | --- | --- |
| Empty text, oversized text, unknown `model_id` | `INVALID_ARGUMENT` | Bad input |
| Missing or incorrect `x-api-key` metadata | `UNAUTHENTICATED` | Health check stays open |
| Full queue / saturated pool / shutting down | `RESOURCE_EXHAUSTED` | Load shedding; does **not** flip health to `NOT_SERVING` |
| Client disconnect mid-stream | `CANCELLED` | Client reconnects and retries |
| Unexpected engine or server failure | `INTERNAL` | Generic message only: `Internal Inference Error` |

The `UNAUTHENTICATED` path is enforced at the server boundary
(`app/serving/auth.py`), ahead of dispatch: an unkeyed or wrong-keyed call
answers `UNAUTHENTICATED` even for a method with no registered servicer, where
a valid key would return `UNIMPLEMENTED`. Only `x-api-key` is honored; there
is no Bearer/JWT path.

## 6. Health

`grpc.health.v1.Health` remains the readiness surface: `Check('')` answers
`SERVING` for the process, and once the servicer registers,
`Check('inference.v1.AIService')` answers `SERVING` under that service name.
The web probes health by proto package name, so its `aidetection.AIService`
probe strings change as part of the web slice below.

## 7. Codegen

`make proto` (`mk/proto.mk`) is the only generator: `grpc_tools.protoc`
emits `ai_service_pb2.py` + `ai_service_pb2_grpc.py` into
`app/serving/generated/`, and a `sed` rewrites the grpc module's bare
`import ai_service_pb2` to a package-relative import so the directory imports
as `app.serving.generated`. The directory is derived and gitignored; the
`__init__.py` is created by the target.

- `grpcio-tools` is pinned to the `grpcio` version (`1.80.0`) in the dev group.
- A future image build runs the same step; until then nothing in `app/`
  imports the stubs, so `make run` needs no codegen.

## 8. Consumers

- `apps/web/lib/shared/proto/ai_service.proto` is the web's hand-synced copy
  and still speaks `aidetection`. Adapting it — the copy itself, the
  `inference-service` mappers (label/confidence derivation, scalar→UTF-16
  offsets), the `readyz` / `analysis/status` probe strings, and the load-test
  mock server — is the web follow-up slice. Until then the old copy keeps
  working because the live server serves no `AIService` at all.
- The load rig's copy (`slop/load/protos/`) stays quarantined with slop; the
  load slice gets its own client on this contract.

## 9. Testing

`tests/unit/serving/test_contract.py` pins the generated descriptor against
drift: package name, both RPCs' input/output types, request and result field
sets (including the absence of `label` / `model_name`), the event oneof's
`started → progress → result` order, and the grpc stub's relative-import fix.
`tests/unit/serving/test_auth.py` pins the gate at the interceptor: health
pass-through, deny on missing, wrong, or non-string keys, case-insensitive
metadata, streaming-shape preservation, and the unknown-method deny.
`tests/unit/serving/test_servicer.py` and `test_mapper.py` pin the RPC
surface: the verdict's percentages and the confidence that mirrors the winning
side, the canonical `model_id` echo, the event order, the progress
coalescing, and each error's status — `INVALID_ARGUMENT` for a bad input or
an unserved model, `RESOURCE_EXHAUSTED` for a shed load, `INTERNAL` for
anything unexpected. The integration boot probes a real channel: unkeyed and
wrong-keyed `Detect` → `UNAUTHENTICATED`, keyed → a verdict, health open
without a key, and a request past the server's concurrency limit →
`RESOURCE_EXHAUSTED`. `test`, `test-unit`, and `test-integration` depend on
`proto` so every run drives fresh stubs. Run with `make test-unit`.

## 10. Defaults taken (override if any read wrong)

1. Versioned package (`inference.v1`) over a plain `inference` matching chats'
   unversioned `chat` — contracts outlive services; pay the version once.
2. Two separate request messages over one shared message — their shapes
   evolve independently.
3. `int32` counts — text is capped at 50k scalars and chunk counts in the
   hundreds.
4. `confidence_score` kept despite being derivable — the client reads one
   field for display instead of branching.
5. Semantics live in this doc, not proto comments — house protos are
   comment-free, and the doc is the review surface.
6. No proto `options` — a Python service; chats carries `go_package` because
   chats is Go.
7. `x-api-key` only, no Bearer/JWT path — the single consumer (the web BFF)
   sends the header; slop's JWT path served its load rig.
8. Admission-reject at the text bound, not document-parser's truncate — a
   truncated document changes the analysis.
9. A bad `MAX_TEXT_CHARS` seed falls back to the default — the `grpc_port`
   fail-closed pattern; the bound never widens on garbage.
