export async function hashSignature(
  ts: string | undefined,
  requestBody: string,
  h1: string | undefined,
  secretKey: string
): Promise<boolean> {
  const encoder = new TextEncoder();
  const payload = ts + ":" + requestBody;
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secretKey),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const signature = await crypto.subtle.sign(
    "HMAC",
    key,
    encoder.encode(payload)
  );
  const signatureHex = Array.from(new Uint8Array(signature))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
  return signatureHex === h1;
}
export function extractValues(input: string): {
  ts: string | undefined;
  h1: string | undefined;
} {
  const matchTs = input.match(/ts=(\d+)/);
  const matchH1 = input.match(/h1=([a-f0-9]+)/);
  return {
    ts: matchTs ? matchTs[1] : "",
    h1: matchH1 ? matchH1[1] : "",
  };
}

export async function validateSignature(
  signature: string,
  body: string,
  secret: string
) {
  const signatureComponents = extractValues(signature);
  return await hashSignature(
    signatureComponents.ts,
    body,
    signatureComponents.h1,
    secret
  );
}
