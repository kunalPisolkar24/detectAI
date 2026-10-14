export function randomString(length) {
    const charset = 'abcdefghijklmnopqrstuvwxyz0123456789';
    let res = '';
    while (length--) res += charset[Math.floor(Math.random() * charset.length)];
    return res;
}

export function generateUserId(vu, iter) {
    return `load_test_user_${vu}_${iter}_${randomString(4)}`;
}

// Shared user for contention testing: many VUs create/list chats under one
// user to exercise the GetUserChats index path. Safe for deletes because each
// VU still owns its chats; only the user namespace is shared.
export function generateSharedUserId() {
    return 'load_test_shared_user';
}

export function generateChatTitle() {
    return `Chat ${randomString(8)}`;
}

export function generateNewTitle() {
    return `Renamed ${randomString(8)}`;
}

// Near-limit title (MaxTitleLen = 200). Keeps one byte of headroom.
export function generateLongTitle() {
    return `Long ${randomString(190)}`;
}

// Over-limit title (>200 chars) for InvalidArgument edge cases.
export function generateOversizedTitle() {
    return `Oversized ${randomString(220)}`;
}

export function generateMessage() {
    const contents = [
        "Hello, how can you help me today?",
        "I need to analyze this document for AI content.",
        "What is the capital of France?",
        "Can you explain quantum physics in simple terms?",
        "Write a poem about coding at 2am.",
        "Compare the performance of Go and Rust for web services.",
        "How do I implement a Redis Stream consumer in Go?",
    ];
    return contents[Math.floor(Math.random() * contents.length)] + " " + randomString(10);
}

// Large but valid payload (~16KB, under MaxContentLen = 20000).
export function generateLargeMessage() {
    return `Large payload ${randomString(8)} ` + 'lorem-ipsum '.repeat(1300);
}

// Over-limit payload (>20000 chars) for InvalidArgument edge cases.
export function generateOversizedMessage() {
    return 'oversized '.repeat(2500);
}

export function generateUUID() {
    // k6 >=0.50 exposes WebCrypto globally; older versions needed
    // `k6/experimental/webcrypto` (removed in latest). Fallback to manual v4.
    try {
        if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID();
    } catch (e) { /* fall through */ }
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
        const r = Math.floor(Math.random() * 16);
        const v = c === 'x' ? r : (r & 0x3) | 0x8;
        return v.toString(16);
    });
}

// Weighted random pick: pickWeighted([[0.7, 'a'], [0.2, 'b'], [0.1, 'c']]).
export function pickWeighted(pairs) {
    const r = Math.random();
    let acc = 0;
    for (const [weight, value] of pairs) {
        acc += weight;
        if (r < acc) return value;
    }
    return pairs[pairs.length - 1][1];
}
