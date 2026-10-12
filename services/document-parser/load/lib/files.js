import exec from "k6/execution";

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

export function negativePayloads() {
  return [
    {
      case: "unsupported-mime",
      filename: "image.png",
      mime: "image/png",
      data: "\x89PNG\r\n\x1a\nload-test-not-an-image",
      expectedStatuses: [415],
    },
    {
      case: "empty-txt",
      filename: "empty.txt",
      mime: TXT_MIME,
      data: "",
      expectedStatuses: [400, 415, 422],
    },
    {
      case: "corrupt-pdf",
      filename: "corrupt.pdf",
      mime: PDF_MIME,
      data: "%PDF-1.4 load-test corrupt content, not a real document %%EOF",
      expectedStatuses: [400, 415, 422],
    },
    {
      case: "missing-file",
      filename: null,
      mime: null,
      data: null,
      expectedStatuses: [400, 422],
    },
  ];
}

export function pickNegativePayload() {
  const cases = negativePayloads();
  return cases[exec.scenario.iterationInTest % cases.length];
}
