import { SharedArray } from "k6/data";
import exec from "k6/execution";

// The corpus is generated once by `make load-fixtures`; k6 reads it in the
// init context and shares the parsed rows with every VU.
const corpusText = open("../assets/corpus.jsonl");

export const documents = new SharedArray("inference-documents", () =>
  corpusText
    .split("\n")
    .filter((line) => line.trim())
    .map((line) => JSON.parse(line))
);

const buckets = {};
for (const document of documents) {
  if (!buckets[document.bucket]) {
    buckets[document.bucket] = [];
  }
  buckets[document.bucket].push(document);
}

export const availableProfiles = Object.keys(buckets).sort();

// Two-level deterministic selection: the profile cycles by iteration (so a
// tiny run still covers every length bucket), the row is picked by a prime
// stride over the VU and iteration. No RNG, and the sample_id tag makes any
// failing request reproducible from the corpus.
export function pickDocument(profileNames, offset = 0) {
  const names = profileNames && profileNames.length ? profileNames : ["short"];
  const profile = names[(exec.scenario.iterationInTest + offset) % names.length];
  const bucket = buckets[profile];
  if (!bucket || !bucket.length) {
    throw new Error(`Unknown or empty document profile: ${profile} (known: ${availableProfiles.join(", ")})`);
  }
  const index = (exec.vu.idInTest * 7919 + exec.scenario.iterationInTest * 104729 + offset) % bucket.length;
  return bucket[index];
}

export function documentTags(document) {
  return {
    sample_id: document.id,
    profile: document.bucket,
    label: String(document.label),
    domain: document.domain || "unknown",
    split: document.split,
  };
}
