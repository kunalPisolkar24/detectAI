import { sleep, check } from 'k6';
import { generateUserId, generateChatTitle, generateNewTitle, generateMessage, generateUUID } from '../lib/data.js';
import { createChat, getChat, verifyE2ELatency, renameChat, getChatHistory, getUserChats, deleteChat, getErrorCode, rawInvoke, GrpcCode } from '../lib/chat.js';
import { config } from '../lib/config.js';
import { closeClient } from '../lib/grpc.js';

export const options = {
    vus: config.smokeVUs,
    duration: config.smokeDuration,
    ...(config.rps > 0 ? { rps: config.rps } : {}),
    thresholds: {
        'chat_rpc_success_rate': ['rate>=1.0'],
        'checks': ['rate>=1.0'],
    },
};

export function teardown() {
    closeClient();
}

export default function () {
    const userId = generateUserId(__VU, __ITER);

    const chatId = createChat(userId, generateChatTitle());
    check(chatId, { 'smoke: chat created': (id) => id !== null });
    if (!chatId) return;

    const fetched = getChat(chatId, userId);
    check(fetched, {
        'smoke: chat fetched': (c) => c !== null && c.id === chatId,
    });

    const e2ePassed = verifyE2ELatency(chatId, userId, generateMessage(), generateUUID());
    check(e2ePassed, { 'smoke: e2e message visible': (p) => p === true });

    const renamed = renameChat(chatId, userId, generateNewTitle());
    check(renamed, { 'smoke: chat renamed': (p) => p === true });

    const history = getChatHistory(chatId, userId);
    check(history, { 'smoke: history retrieved': (h) => h !== null && h.length > 0 });

    const chats = getUserChats(userId);
    check(chats, {
        'smoke: user chats retrieved': (c) => c !== null && c.some((chat) => chat.id === chatId),
    });

    const deleted = deleteChat(chatId, userId);
    check(deleted, { 'smoke: chat deleted': (p) => p === true });

    // Verify delete lifecycle: GetChat on a deleted chat must be NotFound
    // and must not count against the happy-path success rate.
    const { response } = rawInvoke('GetChat', { chat_id: chatId }, userId);
    check(getErrorCode(response) === GrpcCode.NOT_FOUND, {
        'smoke: deleted chat returns NotFound': (p) => p === true,
    });

    sleep(1);
}
