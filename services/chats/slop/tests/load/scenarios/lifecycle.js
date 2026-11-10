import { sleep, check } from 'k6';
import { generateUserId, generateChatTitle, generateNewTitle, generateMessage, generateUUID } from '../lib/data.js';
import { createChat, getChat, saveMessage, renameChat, getChatHistory, getUserChats, deleteChat, getErrorCode, rawInvoke, GrpcCode } from '../lib/chat.js';
import { thresholds, config } from '../lib/config.js';
import { closeClient } from '../lib/grpc.js';

// Dedicated full-lifecycle scenario for CI: create -> message burst ->
// rename -> paginated reads -> delete -> verify-gone. Every chat is
// VU-owned, so deletes never interfere with other VUs.
// Usage: make load-test SCENARIO=lifecycle VUS=5 DURATION=2m
export const options = {
    vus: config.lifecycleVUs,
    duration: config.lifecycleDuration,
    ...(config.rps > 0 ? { rps: config.rps } : {}),
    thresholds: {
        'chat_rpc_success_rate': [`rate>=${thresholds.successRate}`],
        'chat_create_duration': [`p(95)<${thresholds.createP95}`],
        'chat_save_message_duration': [`p(95)<${thresholds.saveMessageP95}`],
        'chat_get_history_duration': [`p(95)<${thresholds.getHistoryP95}`],
        'chat_rename_duration': [`p(95)<${thresholds.renameP95}`],
        'chat_delete_duration': [`p(95)<${thresholds.deleteP95}`],
        'checks': [`rate>=${thresholds.successRate}`],
    },
};

export function teardown() {
    closeClient();
}

export default function () {
    const userId = generateUserId(__VU, __ITER);

    const chatId = createChat(userId, generateChatTitle());
    check(chatId, { 'lifecycle: created': (id) => id !== null });
    if (!chatId) return;

    for (let i = 0; i < 5; i++) {
        check(saveMessage(chatId, userId, generateMessage(), generateUUID()), {
            'lifecycle: message saved': (p) => p === true,
        });
    }

    check(renameChat(chatId, userId, generateNewTitle()), {
        'lifecycle: renamed': (p) => p === true,
    });

    const fetched = getChat(chatId, userId);
    check(fetched, {
        'lifecycle: fetched after rename': (c) => c !== null && c.id === chatId,
    });

    const page1 = getChatHistory(chatId, userId, 1, 3);
    check(page1, { 'lifecycle: page 1 read': (h) => h !== null && h.length > 0 });
    // Page 2 may be empty for a 5-message chat; only assert it responds.
    check(getChatHistory(chatId, userId, 2, 3), {
        'lifecycle: page 2 read': (h) => h !== null,
    });

    check(getUserChats(userId), {
        'lifecycle: listed': (c) => c !== null && c.some((chat) => chat.id === chatId),
    });

    check(deleteChat(chatId, userId), { 'lifecycle: deleted': (p) => p === true });

    const { response: getResp } = rawInvoke('GetChat', { chat_id: chatId }, userId);
    check(getErrorCode(getResp) === GrpcCode.NOT_FOUND, {
        'lifecycle: get after delete is NotFound': (p) => p === true,
    });

    const { response: histResp } = rawInvoke('GetChatHistory', { chat_id: chatId, page: 1, page_size: 10 }, userId);
    check(getErrorCode(histResp) === GrpcCode.NOT_FOUND, {
        'lifecycle: history after delete is NotFound': (p) => p === true,
    });

    const remaining = getUserChats(userId);
    check(remaining, {
        'lifecycle: deleted chat absent from list': (c) => c !== null && !c.some((chat) => chat.id === chatId),
    });

    sleep(1);
}
