"""Build the k6 inference corpus from the DetectAI Lite dataset.

`python -m tests.load.generate` writes tests/load/assets/corpus.jsonl and
manifest.json. Every document is one dataset row, verbatim: nothing is joined,
padded or rewritten. Each row is self-checked through the real tokenizer and
chunker so the manifest records what the service will actually stream.
"""

from __future__ import annotations

import hashlib
import json
import os
import urllib.parse
import urllib.request
from collections import Counter
from pathlib import Path

from transformers import AutoTokenizer

from app.boot import ensure_model_artifacts, resolve_settings
from app.inference.preprocessing import DocumentPreprocessor, FastTokenizer

DATASET = "kpisolkar24/detectai-dataset"
CONFIG = "lite"
SPLITS = ("train", "validation", "test")
ROWS_ENDPOINT = "https://datasets-server.huggingface.co/rows"
DATASET_INFO_ENDPOINT = "https://huggingface.co/api/datasets/{dataset}"
PAGE_SIZE = 100

# Bucket boundaries are tags over the row's own char_count, not text builders.
BUCKET_LIMITS = (
    ("short", 0, 1_000),
    ("medium", 1_000, 3_000),
    ("long", 3_000, 8_000),
    ("xl", 8_000, None),
)
BUCKET_ORDER = {name: index for index, (name, _, _) in enumerate(BUCKET_LIMITS)}

ASSETS = Path(__file__).resolve().parent / "assets"


def _dataset_revision() -> str:
    override = os.getenv("INFERENCE_LOAD_DATASET_REVISION", "").strip()
    if override:
        return override
    url = DATASET_INFO_ENDPOINT.format(dataset=DATASET)
    with urllib.request.urlopen(url, timeout=30) as response:
        info = json.load(response)
    sha = info.get("sha")
    if not isinstance(sha, str) or not sha:
        raise RuntimeError(f"no revision reported for dataset {DATASET}")
    return sha


def _fetch_split(split: str, revision: str) -> list[dict]:
    rows: list[dict] = []
    offset = 0
    while True:
        query = urllib.parse.urlencode(
            {
                "dataset": DATASET,
                "config": CONFIG,
                "split": split,
                "offset": offset,
                "length": PAGE_SIZE,
                "revision": revision,
            }
        )
        with urllib.request.urlopen(f"{ROWS_ENDPOINT}?{query}", timeout=60) as response:
            payload = json.load(response)
        page = payload.get("rows")
        if not isinstance(page, list):
            raise TypeError(
                f"{CONFIG}/{split}: unexpected rows response at offset {offset}"
            )
        for entry in page:
            row = entry.get("row") if isinstance(entry, dict) else None
            if not isinstance(row, dict):
                raise TypeError(f"{CONFIG}/{split}: malformed row at offset {offset}")
            rows.append(row)
        total = payload.get("num_rows_total")
        offset += len(page)
        if not page or (isinstance(total, int) and offset >= total):
            break
    return rows


def _bucket(char_count: int) -> str:
    for name, low, high in BUCKET_LIMITS:
        if char_count >= low and (high is None or char_count < high):
            return name
    raise RuntimeError(f"no bucket for char_count {char_count}")


def _build_preprocessor() -> tuple[DocumentPreprocessor, dict]:
    settings = resolve_settings()
    artifacts = ensure_model_artifacts(settings)
    model_key = next(iter(sorted(settings.enabled_models)))
    tokenizer = AutoTokenizer.from_pretrained(
        str(artifacts[model_key]), local_files_only=True
    )
    fast = FastTokenizer(tokenizer)
    ceiling = settings.max_sequence_lengths()[model_key]
    preprocessor = DocumentPreprocessor(
        tokenizer=fast,
        chunk_token_limit=settings.chunk_token_limit,
        model_max_sequence_length=ceiling,
        max_text_chars=settings.max_text_chars,
        chunk_token_overlap=settings.chunk_token_overlap,
    )
    contract = {
        "model": model_key,
        "model_revision": settings.model_settings(model_key).revision,
        "chunk_token_limit": settings.chunk_token_limit,
        "chunk_token_overlap": settings.chunk_token_overlap,
        "max_text_chars": settings.max_text_chars,
        "max_sequence_length": ceiling,
        "window_tokens": preprocessor.window_tokens,
    }
    return preprocessor, contract


def build() -> tuple[list[dict], dict]:
    revision = _dataset_revision()
    preprocessor, contract = _build_preprocessor()

    documents: list[dict] = []
    for split in SPLITS:
        for index, row in enumerate(_fetch_split(split, revision)):
            text = row.get("text")
            label = row.get("label")
            char_count = row.get("char_count")
            if not isinstance(text, str) or label not in (0, 1):
                raise RuntimeError(f"{split}:{index}: malformed text or label")
            if not isinstance(char_count, int) or char_count <= 0:
                raise RuntimeError(f"{split}:{index}: malformed char_count")
            source_row_id = row.get("source_row_id") or str(index)
            prepared = preprocessor.prepare(text)
            documents.append(
                {
                    "id": f"{split}:{source_row_id}",
                    "split": split,
                    "label": label,
                    "source": row.get("source"),
                    "domain": row.get("domain"),
                    "fingerprint": row.get("fingerprint"),
                    "bucket": _bucket(char_count),
                    "text": text,
                    "expected_total_chars": prepared.total_chars,
                    "expected_total_tokens": prepared.total_tokens,
                    "expected_total_chunks": len(prepared.chunks),
                }
            )

    documents.sort(
        key=lambda document: (BUCKET_ORDER[document["bucket"]], document["id"])
    )

    bucket_stats: dict[str, dict] = {}
    for name, _, _ in BUCKET_LIMITS:
        chunks = [
            document["expected_total_chunks"]
            for document in documents
            if document["bucket"] == name
        ]
        bucket_stats[name] = {
            "documents": len(chunks),
            "min_chunks": min(chunks) if chunks else 0,
            "max_chunks": max(chunks) if chunks else 0,
        }
    if not bucket_stats["xl"]["documents"]:
        raise RuntimeError(
            "no xl documents in the corpus: streaming coverage would be untested"
        )

    corpus_bytes = "".join(
        json.dumps(document, ensure_ascii=False, sort_keys=True) + "\n"
        for document in documents
    ).encode("utf-8")
    manifest = {
        "dataset": DATASET,
        "config": CONFIG,
        "revision": revision,
        "splits": dict(
            sorted(Counter(document["split"] for document in documents).items())
        ),
        "buckets": {
            name: {
                "min_chars": low,
                "max_chars": high,
                **bucket_stats[name],
            }
            for name, low, high in BUCKET_LIMITS
        },
        "preprocessing": contract,
        "corpus_sha256": hashlib.sha256(corpus_bytes).hexdigest(),
        "documents": len(documents),
    }
    return documents, {"manifest": manifest, "corpus_bytes": corpus_bytes}


def main() -> None:
    documents, output = build()
    ASSETS.mkdir(parents=True, exist_ok=True)
    (ASSETS / "corpus.jsonl").write_bytes(output["corpus_bytes"])
    (ASSETS / "manifest.json").write_text(
        json.dumps(output["manifest"], indent=2, sort_keys=True) + "\n",
        encoding="utf-8",
    )
    print(
        f"wrote {len(documents)} documents to {ASSETS} "
        f"(sha256 {output['manifest']['corpus_sha256'][:12]})"
    )


if __name__ == "__main__":
    main()
