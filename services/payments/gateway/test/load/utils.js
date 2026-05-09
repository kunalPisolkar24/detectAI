import crypto from 'k6/crypto';

export function generatePaddleSignature(body, secret) {
    const ts = Math.floor(Date.now() / 1000).toString();
    const payload = `${ts}:${body}`;
    const h1 = crypto.hmac('sha256', secret, payload, 'hex');
    return `ts=${ts};h1=${h1}`;
}
