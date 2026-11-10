import { sleep, check } from 'k6';
import { config, thresholds } from '../lib/config.js';
import { generateUserId, generateChatTitle, generateNewTitle, generateMessage, generateUUID } from '../lib/data.js';
import { createChat, saveMessage, getChatHistory, renameChat, deleteChat, getUserChats } from '../lib/chat.js';
import { closeClient } from '../lib/grpc.js';

export const options = {
    vus: config.soakVUs,
    duration: config.soakDuration,
    ...(config.rps > 0 ? { rps: config.rps } : {}),
    thresholds: {
        'chat_rpc_success_rate': [`rate>=${thresholds.successRate}`],
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
    check(chatId, { 'soak: chat created': (id) => id !== null });
    if (!chatId) {
        sleep(5);
        return;
    }

    for (let i = 0; i < 5; i++) {
        check(saveMessage(chatId, userId, generateMessage(), generateUUID()), {
            'soak: message saved': (p) => p === true,
        });
        sleep(10);
    }

    // Periodic rename exercises the UpdateChatTitle + cache path over long
    // runs to surface leaks or stale-cache drift.
    if (Math.random() < 0.5) {
        check(renameChat(chatId, userId, generateNewTitle()), {
            'soak: chat renamed': (p) => p === true,
        });
    }

    check(getChatHistory(chatId, userId), { 'soak: history read': (h) => h !== null });
    check(getUserChats(userId), { 'soak: user chats listed': (c) => c !== null });

    // Delete most chats to exercise DeleteChat/DeleteCache; keep some alive
    // so history/cache retention is also covered over the soak window.
    if (Math.random() < 0.7) {
        check(deleteChat(chatId, userId), { 'soak: chat deleted': (p) => p === true });
    }

    sleep(30);
}
