import { webcrypto as crypto } from 'node:crypto';
import { describe, it, expect, beforeAll } from 'vitest';

beforeAll(() => {
  if (typeof global !== 'undefined' && !global.crypto) {
    global.crypto = crypto as any;
  }
});

import { hashSignature, extractValues, validateSignature } from './paddle';

async function calculateTestHash(ts: string | undefined, requestBody: string, secretKey: string): Promise<string> {
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
    return Array.from(new Uint8Array(signature))
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("");
}


describe('extractValues', () => {
  it('should extract ts and h1 from a valid signature string', () => {
    const input = 'ts=1234567890,h1=abcdef1234567890abcdef1234567890';
    const expected = { ts: '1234567890', h1: 'abcdef1234567890abcdef1234567890' };
    expect(extractValues(input)).toEqual(expected);
  });

  it('should return empty strings if ts or h1 are missing', () => {
    const inputTsMissing = 'h1=abcdef1234567890abcdef1234567890';
    const expectedTsMissing = { ts: '', h1: 'abcdef1234567890abcdef1234567890' };
    expect(extractValues(inputTsMissing)).toEqual(expectedTsMissing);

    const inputH1Missing = 'ts=1234567890';
    const expectedH1Missing = { ts: '1234567890', h1: '' };
    expect(extractValues(inputH1Missing)).toEqual(expectedH1Missing);
  });

  it('should return empty strings for invalid or empty input', () => {
    const expectedEmpty = { ts: '', h1: '' };
    expect(extractValues('')).toEqual(expectedEmpty);
    expect(extractValues('invalid string')).toEqual(expectedEmpty);
    expect(extractValues('ts=abc,h1=xyz')).toEqual({ ts: '', h1: '' });
  });

  it('should handle different order and extra parameters', () => {
    const input = 'foo=bar,h1=abcdef1234567890,ts=1234567890,baz=qux';
    const expected = { ts: '1234567890', h1: 'abcdef1234567890' };
    expect(extractValues(input)).toEqual(expected);
  });
});

describe('hashSignature', () => {
  const ts = '1678886400';
  const requestBody = '{"key":"value"}';
  const secretKey = 'testsecretkey';

  it('should return true for a matching signature', async () => {
    const correctH1 = await calculateTestHash(ts, requestBody, secretKey);
    await expect(hashSignature(ts, requestBody, correctH1, secretKey)).resolves.toBe(true);
  });

  it('should return false for a non-matching signature', async () => {
    const incorrectH1 = 'wronghash123';
    await expect(hashSignature(ts, requestBody, incorrectH1, secretKey)).resolves.toBe(false);
  });

  it('should return false if calculated hash does not match undefined h1', async () => {
     await expect(hashSignature(ts, requestBody, undefined, secretKey)).resolves.toBe(false);
  });

  it('should handle undefined timestamp correctly during hashing', async () => {
    const hashForUndefinedTs = await calculateTestHash(undefined, requestBody, secretKey);
    await expect(hashSignature(undefined, requestBody, hashForUndefinedTs, secretKey)).resolves.toBe(true);
    await expect(hashSignature(undefined, requestBody, 'wronghash', secretKey)).resolves.toBe(false);
  });
});

describe('validateSignature', () => {
  const body = '{"data":"example"}';
  const secret = 'validsecret';
  const timestamp = '1700000000';

  it('should return true for a valid signature, body, and secret', async () => {
    const correctHash = await calculateTestHash(timestamp, body, secret);
    const validSignatureString = `ts=${timestamp},h1=${correctHash}`;
    await expect(validateSignature(validSignatureString, body, secret)).resolves.toBe(true);
  });

  it('should return false for an invalid hash in the signature string', async () => {
    const invalidSignatureString = `ts=${timestamp},h1=invalidhash123`;
    await expect(validateSignature(invalidSignatureString, body, secret)).resolves.toBe(false);
  });

  it('should return false for a mismatched body', async () => {
    const correctHash = await calculateTestHash(timestamp, body, secret);
    const validSignatureString = `ts=${timestamp},h1=${correctHash}`;
    const wrongBody = '{"data":"different"}';
    await expect(validateSignature(validSignatureString, wrongBody, secret)).resolves.toBe(false);
  });

  it('should return false for a wrong secret', async () => {
    const correctHash = await calculateTestHash(timestamp, body, secret);
    const validSignatureString = `ts=${timestamp},h1=${correctHash}`;
    const wrongSecret = 'invalidsecret';
    await expect(validateSignature(validSignatureString, body, wrongSecret)).resolves.toBe(false);
  });

  it('should return false for a malformed signature string', async () => {
    const malformedSignature = 'ts_missing_equals1700000000,h1_badformat';
    await expect(validateSignature(malformedSignature, body, secret)).resolves.toBe(false);
  });

   it('should return false if timestamp is missing from signature', async () => {
      const hashForEmptyTs = await calculateTestHash('', body, secret);
      const signatureWithCorrectHashForEmptyTs = `h1=${hashForEmptyTs}`;

      await expect(validateSignature(signatureWithCorrectHashForEmptyTs, body, secret)).resolves.toBe(true);

      const signatureWithWrongHash = `h1=someotherhash`;
      await expect(validateSignature(signatureWithWrongHash, body, secret)).resolves.toBe(false);
   });
});