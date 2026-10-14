// Deterministic load identities. Run prefix isolates concurrent runs so
// `make load-down -v` (volume wipe) is the only cleanup needed.
export function randomString(length) {
    const charset = 'abcdefghijklmnopqrstuvwxyz0123456789';
    let res = '';
    while (length--) res += charset[Math.floor(Math.random() * charset.length)];
    return res;
}

export function generateRunId(prefix) {
    return `${prefix}_${Date.now().toString(36)}_${randomString(4)}`;
}

// Pool identities must match POST /seed-users (`${prefix}_${run}_${i}`)
// so pre-seeded rows exist and per-request upserts can be skipped.
export function paymentsUser(run, vu, pool) {
    const slot = Number.isFinite(pool) && pool > 0 ? vu % pool : vu;
    return `pay_${run}_${slot}`;
}

export function analyticsUser(run, vu, iter, pool) {
    const slot = Number.isFinite(pool) && pool > 0 ? (vu + iter) % pool : `${vu}_${iter}`;
    return `ana_${run}_${slot}`;
}

// Stable lifecycle per user: created-first, then valid transitions only.
// Random mixes without this poison the DLQ with InvalidTransitionError.
export function paymentsEventFor(iter) {
    if (iter === 0) return 'subscription.created';
    const eventTypes = [
        'subscription.updated',
        'subscription.updated',
        'subscription.activated',
        'subscription.canceled',
    ];
    return eventTypes[Math.floor(Math.random() * eventTypes.length)];
}

export function analyticsCount() {
    return Math.floor(Math.random() * 10) + 1;
}

export function generateUUID() {
    try {
        if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID();
    } catch (e) { /* fall through */ }
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
        const r = Math.floor(Math.random() * 16);
        const v = c === 'x' ? r : (r & 0x3) | 0x8;
        return v.toString(16);
    });
}

// Weighted pick: pickWeighted([[0.9, 'normal'], [0.05, 'dup'], [0.05, 'invalid']]).
export function pickWeighted(pairs) {
    const r = Math.random();
    let acc = 0;
    for (const [weight, value] of pairs) {
        acc += weight;
        if (r < acc) return value;
    }
    return pairs[pairs.length - 1][1];
}
