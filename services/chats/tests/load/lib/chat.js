import { sleep } from 'k6';
import { ensureConnected, getMetadata } from './grpc.js';
import { chatMetrics } from './metrics.js';
import { config } from './config.js';

const SERVICE_NAME = 'chat.ChatService';

export function createChat(userId, title) {
    const client = ensureConnected();
    const params = { metadata: getMetadata(), timeout: config.rpcTimeoutMs };
    const payload = { user_id: userId, title: title };

    const start = Date.now();
    const response = client.invoke(`${SERVICE_NAME}/CreateChat`, payload, params);
    const duration = Date.now() - start;

    const success = response && response.status === 0;
    chatMetrics.rpcSuccessRate.add(success);
    chatMetrics.createDuration.add(duration);

    return success ? response.message.chat_id : null;
}

export function saveMessage(chatId, userId, content, messageId) {
    const client = ensureConnected();
    const params = { metadata: getMetadata(), timeout: config.rpcTimeoutMs };
    const payload = {
        chat_id: chatId,
        user_id: userId,
        role: 'user',
        content: content,
        message_id: messageId,
        created_at: Date.now(),
    };

    const start = Date.now();
    const response = client.invoke(`${SERVICE_NAME}/SaveMessage`, payload, params);
    const duration = Date.now() - start;

    const success = response && response.status === 0;
    chatMetrics.rpcSuccessRate.add(success);
    chatMetrics.saveMessageDuration.add(duration);

    return success;
}

export function getChatHistory(chatId) {
    const client = ensureConnected();
    const params = { metadata: getMetadata(), timeout: config.rpcTimeoutMs };
    const payload = { chat_id: chatId, page: 1, page_size: 50 };

    const start = Date.now();
    const response = client.invoke(`${SERVICE_NAME}/GetChatHistory`, payload, params);
    const duration = Date.now() - start;

    const success = response && response.status === 0;
    chatMetrics.rpcSuccessRate.add(success);
    chatMetrics.getHistoryDuration.add(duration);

    return success ? response.message.messages : null;
}

export function getUserChats(userId) {
    const client = ensureConnected();
    const params = { metadata: getMetadata(), timeout: config.rpcTimeoutMs };
    const payload = { user_id: userId, limit: 10 };

    const start = Date.now();
    const response = client.invoke(`${SERVICE_NAME}/GetUserChats`, payload, params);
    const duration = Date.now() - start;

    const success = response && response.status === 0;
    chatMetrics.rpcSuccessRate.add(success);
    chatMetrics.getUserChatsDuration.add(duration);

    return success ? response.message.chats : null;
}

export function verifyE2ELatency(chatId, userId, content, messageId) {
    const startTime = Date.now();
    const saved = saveMessage(chatId, userId, content, messageId);
    if (!saved) return false;

    const timeout = startTime + config.e2eTimeoutMs;
    while (Date.now() < timeout) {
        const messages = getChatHistory(chatId);
        if (messages && messages.some(m => m.id === messageId)) {
            const e2eLatency = Date.now() - startTime;
            chatMetrics.e2eMessageLatency.add(e2eLatency);
            return true;
        }
        sleep(config.e2ePollingIntervalMs / 1000);
    }

    return false;
}
