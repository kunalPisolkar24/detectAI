export function exponentialBackoff(attempt: number, baseMs = 1000, capMs = 30000, jitterRatio = 0.5): number {
    const base = baseMs * Math.pow(2, attempt);
    const jitter = Math.random() * jitterRatio * base;
    return Math.min(base + jitter, capMs);
}

export function jitteredInterval(intervalMs: number, ratio = 0.1): number {
    return Math.round(intervalMs * (1 - ratio + Math.random() * 2 * ratio));
}

export function simpleBackoffWithJitter(attempt: number, maxBackoff = 30000): number {
    const base = Math.min(Math.pow(2, attempt) * 1000, maxBackoff);
    const jitter = Math.random() * 1000;
    return base + jitter;
}
