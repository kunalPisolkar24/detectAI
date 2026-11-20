# Analysis Pipeline

One document is admitted, tokenized once, cut into chunks, scored in batches, and aggregated into one verdict. The text is never rewritten — the highlight spans must still point into the text the client sent.

## The whole path

```mermaid
graph LR
    START(["start: submitted text"]) --> A{"admissible?"}
    A -->|"blank, wrong type, too long"| REJ["InvalidDocument"] --> END(["end: INVALID_ARGUMENT"])
    A -->|"yes"| T["tokenize once: ids + offsets"]
    T --> W["cut at sentence or line boundaries"]
    W --> C["chunks: ids, char span, scored token count"]
    C --> S["score each batch on the engine"]
    S --> G["aggregate by scored-token weight"]
    G --> END(["end: verdict + highlight spans"])
```

## Admission

```mermaid
graph TB
    START(["start: text on the use case"]) --> Q1{"is it text?"}
    Q1 -->|"no"| X["reject"] --> END(["end: INVALID_ARGUMENT"])
    Q1 -->|"yes"| Q2{"non-blank after stripping<br/>whitespace and controls?"}
    Q2 -->|"no"| X
    Q2 -->|"yes"| Q3{"within MAX_TEXT_CHARS?"}
    Q3 -->|"no"| X
    Q3 -->|"yes"| OK["keep the text byte-for-byte"] --> END(["end: admitted"])
```

Over-limit text is rejected, never truncated: a truncated document is a different document.

## One tokenization, aligned cuts

The tokenizer returns token IDs and their character offsets in one call. The window is `min(CHUNK_TOKEN_LIMIT, model ceiling)`, and `content = window − 2 special tokens − overlap`.

```mermaid
graph LR
    START(["start: window and overlap"]) --> W["window = min(limit, ceiling)"]
    W --> S["− 2 special tokens"]
    S --> O["− overlap"]
    O --> C["content tokens per chunk"]
    O --> X["context: preceding overlap tokens"]
    C --> I["input = context + content + 2 = window"]
    X --> I
    I --> END(["end: one chunk shape"])
```

Cuts prefer a sentence end (`.`, `!`, `?`) or the line break before the next token, but only when it lands in the upper half of the window — otherwise the content window would shrink too far. Chunks are contiguous; scored regions never overlap even when inputs carry context.

## The two cores

**Preparation's surface.** A narrow tokenizer port and one facade own admission and windowing.

```mermaid
classDiagram
    class Tokenizer {
        <<interface>>
        +encode(text) Encoding
        +cls_token_id
        +sep_token_id
        +special_token_count
    }
    class FastTokenizer
    class DocumentPreprocessor {
        +prepare(text) PreparedDocument
        +split(text, encoding)
        +window_tokens
    }
    class Chunk {
        +token_ids
        +context_tokens
        +scored_tokens
        +char_start
        +char_end
    }
    Tokenizer <|.. FastTokenizer
    DocumentPreprocessor o--> Tokenizer : injected
    DocumentPreprocessor o--> Chunk : emits
    note for Chunk "scored_tokens is the aggregation weight, not the model input length"
```

**Scoring and verdict.** The engine returns one probability per chunk; the aggregator turns regions into a verdict.

```mermaid
classDiagram
    class Engine {
        <<interface>>
        +score(sequences)
        +warmup(length)
    }
    class OnnxEngine
    class VerdictAggregator {
        +aggregate(regions) DocumentVerdict
    }
    class ScoredRegion {
        +char_start
        +char_end
        +scored_tokens
        +ai_probability
    }
    Engine <|.. OnnxEngine
    VerdictAggregator o--> ScoredRegion : weighs by size
    note for OnnxEngine "shape [batch, 2], two-class softmax, column 1 is AI"
```

## The engine's guards

A call the session cannot hold is refused, never truncated or attempted.

```mermaid
graph TB
    START(["start: score(sequences)"]) --> E{"empty call?"}
    E -->|"yes"| NONE["return an empty tuple"] --> END(["end: nothing to score"])
    E -->|"no"| B{"wider than batch width?"}
    B -->|"yes"| ERR["EngineError"] --> END(["end: refused"])
    B -->|"no"| L{"any sequence empty<br/>or over the ceiling?"}
    L -->|"yes"| ERR
    L -->|"no"| RUN["pad, run once, check shape<br/>and finiteness, softmax"]
    RUN --> END(["end: one probability per sequence"])
```

## The verdict

`VerdictAggregator` computes the weighted mean of region probabilities using `scored_tokens` as the weight, flips the flag at the threshold, and emits one highlight span per region in order. Spans from adjacent regions are not merged: a merged span would carry a weighted mean the client cannot re-derive the tone from.

## Next

- **[Models and artifacts](models.md)** — where the session and tokenizer come from.
- **[Design: pipeline](../../specification/pipeline.md)** — the decisions behind these rules.
