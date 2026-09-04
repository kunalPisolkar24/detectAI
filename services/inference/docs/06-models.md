# Model Loading

## Sequence

```mermaid
sequenceDiagram
    participant L as HuggingFaceLoader
    participant HF as HuggingFace Hub
    participant Cache as MODEL_CACHE_DIR
    participant ORT as onnxruntime
    L->>L: log model_download_started repo_id kpisolkar24/detect-ai-spark|flare revision 40-char SHA
    loop 3x transient retry backoff 1s,2s,3s
        L->>HF: hf_hub_download/snapshot_download
        alt success
            L->>Cache: save onnx + tokenizer
        else transient 429/503/timeout
            L->>L: sleep backoff retry
        else 401/403/404
            L-->>L: fail fast
        end
    end
    L->>ORT: InferenceSession(path, providers)
    ORT-->>L: active_providers
    alt requested GPU but active CPU only
        L->>L: record_provider_fallback gpu_missing
    else
        L->>L: log model_loaded
    end
    alt failed -> offline fallback
        L->>HF: snapshot_download local_files_only
        L->>L: record_provider_fallback offline
    end
```

Code at `src/adapters/outbound/inference/loader.py:62`.

## Repos

* `kpisolkar24/detect-ai-spark` — ONNX `detect-ai-spark.onnx` + `detect-ai-spark-tokenizer.pkl` (sklearn TF-IDF)
* `kpisolkar24/detect-ai-flare` — `model.onnx` + `BertTokenizerFast` via `snapshot_download`

Revisions pinned (`9a48004391c71272d6fb1d164ed7c56e1fbfe360`, `e1911c0be59f4e10f0d120f639d1358e46bc2086`) validated as lowercase 40-char SHA.

## Engines

```mermaid
classDiagram
    class BaseEngine {
        +softmax(x): ndarray
        +sigmoid(x): ndarray
    }
    class SparkEngine {
        -session
        -tokenizer
        -input_name
        +predict_batch(texts): List[float]
    }
    class FlareEngine {
        -session
        -tokenizer
        -max_length: int
        +predict_batch(texts): List[float]
    }
    class HuggingFaceLoader {
        -cache_dir: str
        -providers: List[str]
        +load(model_key): tuple
        -get_file()
        -get_directory()
        -verify_providers()
    }
    BaseEngine <|-- SparkEngine
    BaseEngine <|-- FlareEngine
    HuggingFaceLoader --> SparkEngine
    HuggingFaceLoader --> FlareEngine
```

* `SparkEngine:23` `tokenizer.transform(texts).toarray()` → ONNX; handles output shapes `(N,)`, `(N,1)`, `(N,2)` via `sigmoid`/`softmax`.
* `FlareEngine:19` `tokenizer(..., padding, truncation, max_length=256)` → ONNX int64 inputs.
* Both clip `probs 0..1`, raise `InferenceError` on shape mismatch.

## Security & resilience

* `RestrictedUnpickler` allows only `sklearn, scipy, numpy, builtins, collections, copyreg` for spark pickle.
* `_is_transient_error` detects `429/503/timeout/network`; `401/403/404` fail fast without retry.
* Provider verification: `requested GPU` but `active CPU` → warn `gpu_provider_unavailable_falling_back_to_cpu` + `inference_engine_provider_fallback_total{trigger=gpu_missing}`.
* Offline fallback via `local_files_only` if network fails.

## Env

`INFERENCE_PROVIDERS` comma or JSON array, allow-listed (`CPUExecutionProvider`, `CUDAExecutionProvider`, `TensorrtExecutionProvider`, `ROCMExecutionProvider`, `OpenVINOExecutionProvider`). `compose.gpu.yml` switches to `CUDAExecutionProvider`.
