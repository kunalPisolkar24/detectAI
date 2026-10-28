import exec from "k6/execution";

import { readPositiveInt } from "./config.js";

const TXT_MIME = "text/plain";
const PDF_MIME = "application/pdf";
const DOCX_MIME = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";

const txtSmallData = open("../fixtures/sample.txt", "b");
const txtMediumData = open("../fixtures/sample-medium.txt", "b");
const txtLargeData = open("../fixtures/sample-large.txt", "b");
const txtNearLimitData = open("../fixtures/sample-near-limit.txt", "b");
const pdfSmallData = open("../fixtures/sample.pdf", "b");
const docxSmallData = open("../fixtures/sample.docx", "b");

const PROFILE_DEFS = {
  "txt-small": { filename: "sample.txt", mime: TXT_MIME, data: txtSmallData, sizeBucket: "small" },
  "txt-medium": { filename: "sample-medium.txt", mime: TXT_MIME, data: txtMediumData, sizeBucket: "medium" },
  "txt-large": { filename: "sample-large.txt", mime: TXT_MIME, data: txtLargeData, sizeBucket: "large" },
  "txt-near-limit": { filename: "sample-near-limit.txt", mime: TXT_MIME, data: txtNearLimitData, sizeBucket: "near_limit" },
  "pdf-small": { filename: "sample.pdf", mime: PDF_MIME, data: pdfSmallData, sizeBucket: "small" },
  "docx-small": { filename: "sample.docx", mime: DOCX_MIME, data: docxSmallData, sizeBucket: "small" },
};

export const availableProfiles = Object.keys(PROFILE_DEFS);

export function pickFixture(profileNames) {
  const names = profileNames && profileNames.length ? profileNames : ["txt-small"];
  const iteration = exec.scenario.iterationInTest;
  const profileName = names[iteration % names.length];
  const def = PROFILE_DEFS[profileName];
  if (!def) {
    throw new Error(`Unknown document profile: ${profileName} (known: ${availableProfiles.join(", ")})`);
  }
  return {
    profile: profileName,
    filename: def.filename,
    mime: def.mime,
    data: def.data,
    sizeBucket: def.sizeBucket,
    bytes: def.data.byteLength !== undefined ? def.data.byteLength : def.data.length,
  };
}

// One multipart body whose only field is not `file`: a well-formed request
// with nothing to extract, so the parser's generic 422 answers (not a
// malformed-multipart error).
const NO_FILE_BOUNDARY = "----k6negative";

// The rejection matrix, one case per guard of the current route (http.md):
// 401 the key guard, 413 the bounded body read, 415 the sniffed-mime check,
// 422 admission of corrupt content and of a body with no file field. A case
// without `apiKey` carries the configured key, so the rejections test the
// named guard rather than the 401 in front of it.
export function negativePayloads() {
  return [
    {
      case: "missing-api-key",
      filename: "sample.txt",
      mime: TXT_MIME,
      data: txtSmallData,
      expectedStatuses: [401],
      // An empty per-case key means no x-api-key header at all.
      apiKey: "",
    },
    {
      case: "wrong-api-key",
      filename: "sample.txt",
      mime: TXT_MIME,
      data: txtSmallData,
      expectedStatuses: [401],
      apiKey: "load-test-wrong-key",
    },
    {
      case: "unsupported-mime",
      filename: "image.png",
      mime: "image/png",
      data: "\x89PNG\r\n\x1a\nload-test-not-an-image",
      expectedStatuses: [415],
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
      case: "corrupt-pdf",
      filename: "corrupt.pdf",
      mime: PDF_MIME,
      data: "%PDF-1.4 load-test corrupt content, not a real document %%EOF",
      expectedStatuses: [422],
    },
    {
      case: "missing-file",
      filename: null,
      mime: null,
      rawBody: `--${NO_FILE_BOUNDARY}\r\nContent-Disposition: form-data; name="note"\r\n\r\nno file part here\r\n--${NO_FILE_BOUNDARY}--\r\n`,
      contentType: `multipart/form-data; boundary=${NO_FILE_BOUNDARY}`,
      expectedStatuses: [422],
    },
  ];
}

export function pickNegativePayload() {
  const cases = negativePayloads();
  return cases[exec.scenario.iterationInTest % cases.length];
}
