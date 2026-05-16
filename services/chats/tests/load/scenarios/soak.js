import { sleep } from 'k6';
import { generateUserId, generateChatTitle, generateMessage, generateUUID } from '../lib/data.js';
import { createChat, saveMessage, getChatHistory } from '../lib/chat.js';
import { closeClient } from '../lib/grpc.js';

export const options = {
    vus: 20,
    duration: '2h',
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

    getChatHistory(chatId);
    sleep(30);
}
