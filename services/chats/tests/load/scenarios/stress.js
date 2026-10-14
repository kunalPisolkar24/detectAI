import { sleep, check } from 'k6';
import { generateUserId, generateChatTitle, generateMessage, generateUUID } from '../lib/data.js';
import { config, thresholds } from '../lib/config.js';
import { createChat, saveMessage, getChat, getChatHistory } from '../lib/chat.js';
import { closeClient } from '../lib/grpc.js';

export const options = {
    stages: [
        { duration: '1m', target: Math.floor(config.stressVUs * 0.2) },
        { duration: '1m', target: Math.floor(config.stressVUs * 0.5) },
        { duration: '2m', target: config.stressVUs },
        { duration: config.stressDuration, target: config.stressVUs },
        { duration: '1m', target: 0 },
    ],
    ...(config.rps > 0 ? { rps: config.rps } : {}),
    thresholds: {
        // Stress finds the breaking point, so gate on crash-freedom rather
        // than full SLOs: most RPCs should still succeed and checks pass.
        'chat_rpc_success_rate': ['rate>=0.95'],
        'checks': ['rate>=0.95'],
        'chat_save_message_duration': [`p(99)<${thresholds.saveMessageP99 * 4}`],
    },
};

export function teardown() {
    closeClient();
}

export default function () {
    const userId = generateUserId(__VU, __ITER);

    const chatId = createChat(userId, generateChatTitle());
    if (!chatId) {
        sleep(1);
        return;
    }

    // Rapid writes plus reads so stress covers the Mongo/Redis read path and
    // worker stream lag, not just the write fast-path.
    for (let i = 0; i < 3; i++) {
        saveMessage(chatId, userId, generateMessage(), generateUUID());
    }
    check(getChat(chatId, userId), { 'stress: chat fetched': (c) => c !== null });
    check(getChatHistory(chatId, userId), { 'stress: history read': (h) => h !== null });

    sleep(0.5);
}
