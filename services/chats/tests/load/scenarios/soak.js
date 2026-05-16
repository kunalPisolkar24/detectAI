import { sleep } from 'k6';
import { config, thresholds } from '../lib/config.js';
import { generateUserId, generateChatTitle, generateMessage, generateUUID } from '../lib/data.js';
import { createChat, saveMessage, getChatHistory } from '../lib/chat.js';
import { closeClient } from '../lib/grpc.js';

export const options = {
    vus: config.soakVUs,
    duration: config.soakDuration,
    thresholds: {
        'chat_rpc_success_rate': [`rate>=${thresholds.successRate}`],
    },
};

export function teardown() {
    closeClient();
}

export default function () {
    const userId = generateUserId(__VU, __ITER);
    const title = generateChatTitle();
    
    const chatId = createChat(userId, title);
    if (!chatId) {
        sleep(5);
        return;
    }

    for (let i = 0; i < 5; i++) {
        const content = generateMessage();
        const messageId = generateUUID();
        saveMessage(chatId, userId, content, messageId);
        sleep(10);
    }

    getChatHistory(chatId, userId);
    sleep(30);
}
