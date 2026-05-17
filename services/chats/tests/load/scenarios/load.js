import { sleep, check } from 'k6';
import { generateUserId, generateChatTitle, generateMessage, generateUUID } from '../lib/data.js';
import { createChat, saveMessage, getChatHistory, getUserChats } from '../lib/chat.js';
import { thresholds, config } from '../lib/config.js';
import { closeClient } from '../lib/grpc.js';

export const options = {
    stages: [
        { duration: '30s', target: config.loadVUs }, // Ramp up
        { duration: config.loadDuration, target: config.loadVUs }, // Steady state
        { duration: '30s', target: 0 }, // Ramp down
    ],
    thresholds: {
        'chat_rpc_success_rate': [`rate>=${thresholds.successRate}`],
        'chat_save_message_duration': [`p(95)<${thresholds.saveMessageP95}`, `p(99)<${thresholds.saveMessageP99}`],
        'chat_get_history_duration': [`p(95)<${thresholds.getHistoryP95}`],
    },
};

export function teardown() {
    closeClient();
}

export default function () {
    const userId = generateUserId(__VU, __ITER);
    const title = generateChatTitle();
    
    const chatId = createChat(userId, title);
    if (!chatId) return;

    // Simulate a user sending a few messages
    for (let i = 0; i < 3; i++) {
        const content = generateMessage();
        const messageId = generateUUID();
        saveMessage(chatId, userId, content, messageId);
        sleep(Math.random() * 2 + 1);
    }

    getChatHistory(chatId, userId);
    getUserChats(userId);

    sleep(1);
}
