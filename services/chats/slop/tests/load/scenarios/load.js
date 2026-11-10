import { sleep, check } from 'k6';
import { generateUserId, generateSharedUserId, generateChatTitle, generateNewTitle, generateMessage, generateLargeMessage, generateUUID, pickWeighted } from '../lib/data.js';
import { createChat, saveMessage, getChat, renameChat, deleteChat, getChatHistory, getUserChats } from '../lib/chat.js';
import { thresholds, config } from '../lib/config.js';
import { closeClient } from '../lib/grpc.js';

export const options = {
    stages: [
        { duration: '30s', target: config.loadVUs }, // Ramp up
        { duration: config.loadDuration, target: config.loadVUs }, // Steady state
        { duration: '30s', target: 0 }, // Ramp down
    ],
    ...(config.rps > 0 ? { rps: config.rps } : {}),
    thresholds: {
        'chat_rpc_success_rate': [`rate>=${thresholds.successRate}`],
        'chat_create_duration': [`p(95)<${thresholds.createP95}`],
        'chat_save_message_duration': [`p(95)<${thresholds.saveMessageP95}`, `p(99)<${thresholds.saveMessageP99}`],
        'chat_get_history_duration': [`p(95)<${thresholds.getHistoryP95}`],
        'chat_get_chat_duration': [`p(95)<${thresholds.getChatP95}`],
        'chat_get_user_chats_duration': [`p(95)<${thresholds.getUserChatsP95}`],
        'chat_rename_duration': [`p(95)<${thresholds.renameP95}`],
        'chat_delete_duration': [`p(95)<${thresholds.deleteP95}`],
        'checks': [`rate>=${thresholds.successRate}`],
    },
};

export function teardown() {
    closeClient();
}

function resolveUser() {
    if (config.sharedHotChat) return generateSharedUserId();
    return generateUserId(__VU, __ITER);
}

function readWritePath(userId) {
    let chatId = config.hotChatId || null;
    if (!chatId) {
        chatId = createChat(userId, generateChatTitle());
        check(chatId, { 'load: chat created': (id) => id !== null });
        if (!chatId) return;
    } else {
        check(getChat(chatId, config.hotChatUser), {
            'load: hot chat fetched': (c) => c !== null,
        });
    }
    const writerId = config.hotChatId ? config.hotChatUser : userId;

    const messageCount = 2 + Math.floor(Math.random() * 3);
    for (let i = 0; i < messageCount; i++) {
        const content = Math.random() < 0.15 ? generateLargeMessage() : generateMessage();
        const ok = saveMessage(chatId, writerId, content, generateUUID());
        check(ok, { 'load: message saved': (p) => p === true });
        sleep(Math.random() * 1.5 + 0.5);
    }

    check(getChat(chatId, writerId), { 'load: chat fetched': (c) => c !== null });
    check(getChatHistory(chatId, writerId), { 'load: history read': (h) => h !== null });
    check(getUserChats(writerId), { 'load: user chats listed': (c) => c !== null });
}

function lifecyclePath(userId) {
    // Full CRUD on a VU-owned chat: safe to delete because no other VU
    // references this chat. Skipped for pinned hot chats.
    if (config.hotChatId) {
        readWritePath(userId);
        return;
    }
    const chatId = createChat(userId, generateChatTitle());
    check(chatId, { 'load: lifecycle chat created': (id) => id !== null });
    if (!chatId) return;

    saveMessage(chatId, userId, generateMessage(), generateUUID());
    check(renameChat(chatId, userId, generateNewTitle()), {
        'load: chat renamed': (p) => p === true,
    });
    check(getChat(chatId, userId), { 'load: renamed chat fetched': (c) => c !== null });
    check(getChatHistory(chatId, userId, 1, 10), {
        'load: lifecycle history read': (h) => h !== null,
    });
    check(deleteChat(chatId, userId), { 'load: chat deleted': (p) => p === true });
}

function paginationPath(userId) {
    const chatId = config.hotChatId || createChat(userId, generateChatTitle());
    if (!chatId) return;
    const readerId = config.hotChatId ? config.hotChatUser : userId;

    for (let i = 0; i < 3; i++) {
        saveMessage(chatId, readerId, generateMessage(), generateUUID());
    }
    // Exercise page>1 cold path, oversized page clamping (MaxPageSize=100),
    // and user-chat limit clamping (MaxUserChatsLimit=100).
    check(getChatHistory(chatId, readerId, 1, 10), { 'load: page 1 read': (h) => h !== null });
    check(getChatHistory(chatId, readerId, 2, 10), { 'load: page 2 read': (h) => h !== null });
    check(getChatHistory(chatId, readerId, 1, 500), { 'load: oversized page clamped': (h) => h !== null });
    check(getUserChats(readerId, 200), { 'load: oversized limit clamped': (c) => c !== null });

    if (!config.hotChatId) {
        deleteChat(chatId, userId);
    }
}

export default function () {
    const userId = resolveUser();
    const total = config.mixReadWrite + config.mixLifecycle + config.mixPagination;
    const mode = pickWeighted([
        [config.mixReadWrite / total, 'readwrite'],
        [config.mixLifecycle / total, 'lifecycle'],
        [config.mixPagination / total, 'pagination'],
    ]);

    if (mode === 'lifecycle') lifecyclePath(userId);
    else if (mode === 'pagination') paginationPath(userId);
    else readWritePath(userId);

    sleep(1);
}
