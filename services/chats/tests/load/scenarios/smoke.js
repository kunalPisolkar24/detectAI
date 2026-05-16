import { sleep, check } from 'k6';
import { generateUserId, generateChatTitle, generateMessage, generateUUID } from '../lib/data.js';
import { createChat, verifyE2ELatency, getUserChats } from '../lib/chat.js';
import { thresholds, config } from '../lib/config.js';
import { closeClient } from '../lib/grpc.js';

export const options = {
    vus: config.smokeVUs,
    duration: config.smokeDuration,
    thresholds: {
        'chat_rpc_success_rate': ['rate>=1.0'],
    },
};

export function teardown() {
    closeClient();
}

export default function () {
    const userId = generateUserId(__VU, __ITER);
    const title = generateChatTitle();
    
    const chatId = createChat(userId, title);
    check(chatId, {
        'chat created': (id) => id !== null,
    });

    if (chatId) {
        const content = generateMessage();
        const messageId = generateUUID();
        const e2ePassed = verifyE2ELatency(chatId, userId, content, messageId);
        check(e2ePassed, {
            'e2e message latency verified': (p) => p === true,
        });

        const chats = getUserChats(userId);
        check(chats, {
            'user chats retrieved': (c) => c !== null && c.length > 0,
        });
    }

    sleep(1);
}
