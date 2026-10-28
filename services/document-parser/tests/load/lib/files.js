import exec from "k6/execution";

import { readPositiveInt } from "./config.js";

const TXT_MIME = "text/plain";
const PDF_MIME = "application/pdf";
const DOCX_MIME = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
const BIN_MIME = "application/octet-stream";

// Every document lives in the generated corpus (tests/load/assets, produced by
// `make load-fixtures`); nothing is handwritten here. Profile keys are the
// corpus file names verbatim, so an asset row and a profile never drift apart.
const PROFILE_DEFS = {
  "short.txt": { mime: TXT_MIME, data: open("../assets/short.txt", "b") },
  "mid.txt": { mime: TXT_MIME, data: open("../assets/mid.txt", "b") },
  "long.txt": { mime: TXT_MIME, data: open("../assets/long.txt", "b") },
  "short.pdf": { mime: PDF_MIME, data: open("../assets/short.pdf", "b") },
  "mid.pdf": { mime: PDF_MIME, data: open("../assets/mid.pdf", "b") },
  "long.pdf": { mime: PDF_MIME, data: open("../assets/long.pdf", "b") },
  "short.docx": { mime: DOCX_MIME, data: open("../assets/short.docx", "b") },
  "mid.docx": { mime: DOCX_MIME, data: open("../assets/mid.docx", "b") },
  "long.docx": { mime: DOCX_MIME, data: open("../assets/long.docx", "b") },
  // The oversize rows stand above the default 3 MiB body cap: they answer 413
  // as-is and become 200 rows on a rig booted with a raised limit.
  "oversize.txt": { mime: TXT_MIME, data: open("../assets/oversize.txt", "b") },
  "oversize.pdf": { mime: PDF_MIME, data: open("../assets/oversize.pdf", "b") },
  "oversize.docx": { mime: DOCX_MIME, data: open("../assets/oversize.docx", "b") },
};

export const availableProfiles = Object.keys(PROFILE_DEFS);

export function pickFixture(profileNames) {
  const names = profileNames && profileNames.length ? profileNames : ["short.txt"];
  const iteration = exec.scenario.iterationInTest;
  const profileName = names[iteration % names.length];
  const def = PROFILE_DEFS[profileName];
  if (!def) {
    throw new Error(`Unknown document profile: ${profileName} (known: ${availableProfiles.join(", ")})`);
  }
  return {
    profile: profileName,
    filename: profileName,
    mime: def.mime,
    data: def.data,
    sizeBucket: profileName.split(".")[0],
    bytes: def.data.byteLength !== undefined ? def.data.byteLength : def.data.length,
  };
}

// The corpus's invalid set, opened by its own names. The generator pins what
// the route answers for each (the table in tests/load/README.md is the
// committed mirror; manifest.json rides the regenerated assets).
const IMPOSTER_PDF = open("../assets/invalid/imposter.pdf", "b");
const UNKNOWN_BIN = open("../assets/invalid/unknown.bin", "b");
const LATIN1_TXT = open("../assets/invalid/latin1.txt", "b");
const EMPTY_ZIP_DOCX = open("../assets/invalid/empty-zip.docx", "b");
const DEAD_PDF = open("../assets/invalid/dead.pdf", "b");
const SURROGATE_DOCX = open("../assets/invalid/surrogate.docx", "b");
const TRUNCATED_DOCX = open("../assets/invalid/truncated.docx", "b");
const BROKEN_XML_DOCX = open("../assets/invalid/broken-xml.docx", "b");
const SCANNED_PDF = open("../assets/invalid/scanned.pdf", "b");

// One multipart body whose only field is not `file`: a well-formed request
// with nothing to extract, so the parser's generic 422 answers (not a
// malformed-multipart error).
const NO_FILE_BOUNDARY = "----k6negative";

// The rejection matrix, one case per guard of the current route (http.md):
// 401 the key guard, 413 the bounded body read, 422 a body with no file
// field, then every generated invalid asset with the route's pinned answer.
// The key cases carry valid short.txt bytes (the guard, not the parser, must
// reject them); there is no file-shaped 413 case on purpose — the bounded
// read rejects on raw size alone (see oversized-body).
export function negativePayloads() {
  return [
    {
      case: "missing-api-key",
      filename: "short.txt",
      mime: TXT_MIME,
      data: PROFILE_DEFS["short.txt"].data,
      expectedStatuses: [401],
      // An empty per-case key means no x-api-key header at all.
      apiKey: "",
    },
    {
      case: "wrong-api-key",
      filename: "short.txt",
      mime: TXT_MIME,
      data: PROFILE_DEFS["short.txt"].data,
      expectedStatuses: [401],
      apiKey: "load-test-wrong-key",
    },
    {
      case: "oversized-body",
      // Raw bytes, not multipart: the bounded read rejects on size alone,
      // before any content handling. Must exceed the target's upload limit
      // (the rig parser caps at 3 MiB).
      filename: "oversized.txt",
      mime: TXT_MIME,
      rawBody: new Uint8Array(readPositiveInt("DOCPARSER_LOAD_OVERSIZE_BYTES", 4194304)),
      expectedStatuses: [413],
    },
    {
      case: "missing-file",
      filename: null,
      mime: null,
      rawBody: `--${NO_FILE_BOUNDARY}\r\nContent-Disposition: form-data; name="note"\r\n\r\nno file part here\r\n--${NO_FILE_BOUNDARY}--\r\n`,
      contentType: `multipart/form-data; boundary=${NO_FILE_BOUNDARY}`,
      expectedStatuses: [422],
    },
    {
      case: "invalid-unknown-bin",
      filename: "unknown.bin",
      mime: BIN_MIME,
      data: UNKNOWN_BIN,
      expectedStatuses: [415],
    },
    {
      case: "invalid-imposter-pdf",
      filename: "imposter.pdf",
      mime: PDF_MIME,
      data: IMPOSTER_PDF,
      expectedStatuses: [415],
    },
    {
      case: "invalid-latin1-txt",
      filename: "latin1.txt",
      mime: TXT_MIME,
      data: LATIN1_TXT,
      expectedStatuses: [415],
    },
    {
      case: "invalid-empty-zip-docx",
      filename: "empty-zip.docx",
      mime: DOCX_MIME,
      data: EMPTY_ZIP_DOCX,
      expectedStatuses: [415],
    },
    {
      case: "invalid-dead-pdf",
      filename: "dead.pdf",
      mime: PDF_MIME,
      data: DEAD_PDF,
      expectedStatuses: [422],
    },
    {
      case: "invalid-surrogate-docx",
      filename: "surrogate.docx",
      mime: DOCX_MIME,
      data: SURROGATE_DOCX,
      expectedStatuses: [422],
    },
    {
      case: "invalid-truncated-docx",
      filename: "truncated.docx",
      mime: DOCX_MIME,
      data: TRUNCATED_DOCX,
      expectedStatuses: [422],
    },
    {
      case: "invalid-broken-xml-docx",
      filename: "broken-xml.docx",
      mime: DOCX_MIME,
      data: BROKEN_XML_DOCX,
      expectedStatuses: [422],
    },
    {
      case: "invalid-scanned-pdf",
      filename: "scanned.pdf",
      mime: PDF_MIME,
      data: SCANNED_PDF,
      expectedStatuses: [422],
    },
  ];
}

export function pickNegativePayload() {
  const cases = negativePayloads();
  return cases[exec.scenario.iterationInTest % cases.length];
}
