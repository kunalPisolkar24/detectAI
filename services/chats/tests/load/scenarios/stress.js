import { sleep } from 'k6';
import { generateUserId, generateChatTitle, generateMessage, generateUUID } from '../lib/data.js';
import { config } from '../lib/config.js';
import { createChat, saveMessage } from '../lib/chat.js';
import { closeClient } from '../lib/grpc.js';

export const options = {
    stages: [
        { duration: '1m', target: Math.floor(config.stressVUs * 0.2) },
        { duration: '1m', target: Math.floor(config.stressVUs * 0.5) },
        { duration: '2m', target: config.stressVUs },
        { duration: config.stressDuration, target: config.stressVUs },
        { duration: '1m', target: 0 },
    ],
};

export function teardown() {
    closeClient();
}

export default function () {
    const userId = generateUserId(__VU, __ITER);
    const title = generateChatTitle();
    
    const chatId = createChat(userId, title);
    if (!chatId) {
        sleep(1);
        return;
    }

    const content = generateMessage();
    const messageId = generateUUID();
    saveMessage(chatId, userId, content, messageId);

    sleep(0.5);
}
