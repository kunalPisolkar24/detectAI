import { sleep } from 'k6';
import { generateUserId, generateChatTitle, generateMessage, generateUUID } from '../lib/data.js';
import { createChat, saveMessage } from '../lib/chat.js';
import { closeClient } from '../lib/grpc.js';

export const options = {
    stages: [
        { duration: '2m', target: 50 },
        { duration: '2m', target: 100 },
        { duration: '2m', target: 150 },
        { duration: '2m', target: 200 },
        { duration: '2m', target: 0 },
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
