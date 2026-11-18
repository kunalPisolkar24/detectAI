# Inference load rig

k6 gRPC load tests for the live `inference.v1` service. Load knobs live in
`infra/.env.load`; service config stays in `infra/.env`, which the load-rig
service reads like any other run. The file's `SCENARIO` line selects the
script, and Compose passes `API_KEY` from `.env` to k6 without duplicating it.

## Run

```sh
make load-env        # create infra/.env.load from the template if missing
make load-fixtures   # build the corpus once (gitignored)
make load-test       # inference + k6 on an isolated network
make load-e2e        # k6 alone, against the file's GRPC_ADDR
make load-down       # tear both down
```

Append `IMAGE=gpu` to `load-test` to reuse the GPU compose overlay. The default
scenario is `smoke`, with deliberately small stages and generous budgets so it
runs comfortably on a dev machine.

## Corpus

`make load-fixtures` runs `python -m tests.load.generate`. It pulls every row
of `kpisolkar24/detectai-dataset` (`lite`, 3,000 rows) through the Hugging Face
datasets-server API at a recorded revision and writes:

- `assets/corpus.jsonl` — one document per row, text verbatim. Nothing is
  joined, padded or rewritten.
- `assets/manifest.json` — dataset revision, split and bucket counts, the
  tokenizer/chunk config, a sha256 of the corpus, and the per-sample chunk
  counts observed by running the real `DocumentPreprocessor` over each row.

Generation fails loudly on a malformed row or a preprocessing mismatch. The
manifest is the contract the stream checks assert against, so a config change
means regenerating the corpus.

Length buckets (`short` <1k, `medium` 1k–3k, `long` 3k–8k, `xl` ≥8k) are tags
over each row's own `char_count`. The naturally long rows are what exercise
multi-chunk streams and progress coalescing; no synthetic long documents are
created.

## Scenarios

- `smoke` — one unary `Detect` per configured model, one full
  `AnalyzeDocument` stream per bucket (always including `xl`, regardless of
  the load scenario's profile mix), and a rejection matrix (unauthenticated
  and invalid-argument cases). Every request is asserted.
- `load` — `ramping-arrival-rate` over server-streaming `AnalyzeDocument`.
  Thresholds: success rate, stream p95/p99, time-to-first-event p95. They are
  deliberately loose for a dev machine; tighten them once you have baseline
  numbers from the target environment.

`RESOURCE_EXHAUSTED` is reported through a dedicated backpressure counter and
does not count as a failure: it is the service shedding load as designed.

## Sampling

Selection is deterministic, not random. The bucket cycles by
`scenario.iterationInTest` (so even a one-iteration smoke covers every bucket),
and the row within a bucket is picked by a prime stride over the VU number and
iteration. Every request carries `sample_id`, `profile`, `label`, `domain` and
`split` tags, so a failing run can be traced back to one dataset row.

## Why this rig exists

The quarantined `slop/load` suite targets the old `aidetection` contract, uses
two recycled prose paragraphs grown to fixed lengths, and carries a duplicate
proto. This rig uses the canonical proto from `api/proto` (mounted read-only),
the real `x-api-key` auth, and a manifest-verified corpus, so a green run says
something about the service that is actually deployed.
