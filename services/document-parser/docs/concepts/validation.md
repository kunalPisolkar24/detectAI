# Validation

This is the admission gate. Before a single content byte is *extracted*, it decides whether the bytes are a document type we accept — and within bounds. Admission is not correctness: it can say "this looks like a PDF within limits" without knowing whether the PDF contains text.

## The one rule: bytes vote, headers don't

The client cannot be trusted to declare content. The `Content-Type` header and the `filename` are metadata only — the first bytes of the body are the whole vote. Each strategy sniffs for a magic signature, then opens the container it recognized, then checks a per-type bound. The sniffed MIME becomes the response's `content_type` and the key that dispatches extraction — so the gate's answer and the pipeline's input are the same value.

## The layers

| Strategy | Layer 1 — sniff | Layer 2 — container | Layer 3 — bound |
|----------|-----------------|---------------------|-----------------|
| PDF | `%PDF-` signature | `pypdf` opens the container | ≤ 1,000 pages |
| DOCX | `PK…` zip header | zip opens, `word/document.xml` present | ≤ 30 MiB unpacked |
| TXT | strict UTF-8 decode | — (the decode is everything) | — (bounded by the upload limit) |

Notes worth having in your head:

- **TXT is last on purpose.** Nearly any text-based upload decodes as UTF-8, so the text strategy registers last — otherwise it would claim bytes the other formats should see first.
- **The DOCX bound is a zip-bomb guard** read entirely from member metadata, before a content byte is touched. Real DOCX files deflate ≈ 8–12×, so legitimate documents pass; bombs run 100×+ and die at the metadata read.
- A recognizable container that will not open is *corrupt* (422), not unsupported (415) — a car that looks like a car but does not open is broken, not another vehicle.

## The walk, once per upload

```mermaid
graph TB
    START(["start: bytes on the wire"]) --> PDFS{"starts with<br/>%PDF- ?"}
    PDFS -->|"no"| ZIPS{"zip magic?"}
    PDFS -->|"yes"| POPEN["container opens<br/>(pypdf)"]
    POPEN -->|"unreadable"| C422["422: corrupt"]
    POPEN -->|"over the page bound"| L413["413: too large"]
    POPEN -->|"within bounds"| ADMITTED["admitted: sniffed mime<br/>pdf / docx / text/plain"]
    ZIPS -->|"no"| TXTS{"strict UTF-8<br/>decode?"}
    ZIPS -->|"yes"| ZOPEN["zip opens, body part present,<br/>30 MiB unpack sum from metadata"]
    ZOPEN -->|"broken or<br/>no body part"| C422
    ZOPEN -->|"over the unpack bound"| L413
    ZOPEN -->|"within bounds"| ADMITTED
    TXTS -->|"no"| DECLINE["415: unsupported type<br/>(detail names the best guess)"]
    TXTS -->|"yes"| ADMITTED
    ADMITTED --> EXTRACT["the extraction pipeline<br/>takes over"] --> END(["end"])
    C422 --> END
    L413 --> END
    DECLINE --> END
```

Every strategy returns *either* a claim *or* "not mine" — the first one that claims the bytes wins. When no strategy does, the gate refuses to guess which format it saw: `UnsupportedTypeError`, whose detail names the best-effort sniff from a magic table (PNG, GIF, legacy MS Word, gzip, …). That naming is diagnostic only — it never admits anything.

## The walk as a conversation

The same walk, told as ordered calls — this is the simplest way to read "ordered registry, first claim wins": an attempt happens only when every strategy before it passed on the bytes.

```mermaid
sequenceDiagram
    autonumber
    participant R as route
    participant S as validation service
    participant P as pdf strategy
    participant D as docx strategy
    participant T as txt strategy

    R->>S: validate(bytes)
    S->>P: validate(bytes)
    P-->>S: a claim, a typed verdict, or none-of-mine
    S->>D: validate(bytes) — only if pdf passed on
    D-->>S: a claim, a typed verdict, or none-of-mine
    S->>T: validate(bytes) — only if docx passed on
    T-->>S: a claim, or none-of-mine
    alt a claim landed
        S-->>R: the sniffed mime for this upload
    else every strategy passed
        S-->>R: UnsupportedTypeError — the 415
    end
```

## The registry

One ordered tuple behind one interface: validation is "ask each strategy, first claim wins." Both this registry and the extraction registry downstream key off the mime it returns — which is why order and silence rules are behavioral, not cosmetic.

```mermaid
classDiagram
    class DocumentValidationService {
        +validate(data)
    }
    class DocumentValidationStrategy {
        <<abstract>>
        +validate(data)
    }
    class PdfValidationStrategy
    class DocxValidationStrategy
    class TextValidationStrategy
    class ValidationOutcome {
        +mime
    }
    DocumentValidationStrategy <|-- PdfValidationStrategy
    DocumentValidationStrategy <|-- DocxValidationStrategy
    DocumentValidationStrategy <|-- TextValidationStrategy
    DocumentValidationService o--> DocumentValidationStrategy : ordered registry, first claim wins
    DocumentValidationStrategy ..> ValidationOutcome : claims a type or passes
    note for TextValidationStrategy "registered last: decodable bytes must never shadow the others"
```

## The strategies up close

The strategies carry exactly one piece of state — the bound each was built with at boot. Nothing else is stored; every call judges the bytes in front of it.

```mermaid
classDiagram
    class DocumentValidationStrategy {
        <<abstract>>
        +validate(data)
    }
    class PdfValidationStrategy {
        -max_pages: int
        +validate(data)
    }
    class DocxValidationStrategy {
        -max_uncompressed_bytes: int
        +validate(data)
    }
    class TextValidationStrategy {
        +validate(data)
    }
    class ValidationOutcome {
        +mime: str
    }
    DocumentValidationStrategy <|-- PdfValidationStrategy
    DocumentValidationStrategy <|-- DocxValidationStrategy
    DocumentValidationStrategy <|-- TextValidationStrategy
    DocumentValidationStrategy ..> ValidationOutcome : claims its type or returns nothing
    note for PdfValidationStrategy "signature, pypdf container open, page-count check"
    note for DocxValidationStrategy "zip signature, body part required, metadata-only unpack sum"
    note for TextValidationStrategy "no state at all: the strict decode is sniff, container check, and bound in one"
```

## Error classes

Three typed verdicts, each refusing exactly one thing — the route's whole 413/415/422 surface comes from this trio.

```mermaid
classDiagram
    class UnsupportedTypeError
    class TooLargeError
    class CorruptDocumentError
    note for UnsupportedTypeError "no strategy claimed the bytes: 415, detail names the sniffed best guess"
    note for TooLargeError "a container knows itself but overstates a bound: 413, detail names the limit"
    note for CorruptDocumentError "recognized container that will not open: 422, generic detail"
```

| Typed error | Where it maps | Detail on the wire |
|-------------|---------------|--------------------|
| `UnsupportedTypeError` | 415 | names the sniffed best guess |
| `TooLargeError` | 413 | names the limit that was breached |
| `CorruptDocumentError` | 422 | the one generic detail — a corrupt file cannot be branded |

The two bounds on this page are env-configurable (`MAX_PDF_PAGES`, `DOCX_MAX_UNCOMPRESSED_BYTES`) and fail closed to their defaults — see [Configuration](../getting-started/configuration.md). The transport bound (3 MiB by default) is applied even earlier, by the endpoint's bounded read — see the [HTTP reference](../reference/http-api.md).

## Next Steps

- **[Extraction](extraction.md)** — what happens to admitted bytes
- **[Testing](../guides/testing.md)** — the load rig's generated invalid set exercises these verdicts file by file
