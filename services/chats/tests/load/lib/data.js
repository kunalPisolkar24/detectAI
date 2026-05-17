import { crypto } from 'k6/experimental/webcrypto';

export function randomString(length) {
    const charset = 'abcdefghijklmnopqrstuvwxyz0123456789';
    let res = '';
    while (length--) res += charset[Math.floor(Math.random() * charset.length)];
    return res;
}

export function generateUserId(vu, iter) {
    return `load_test_user_${vu}_${iter}_${randomString(4)}`;
}

export function generateChatTitle() {
    return `Chat ${randomString(8)}`;
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

export function generateUUID() {
    return crypto.randomUUID();
}
