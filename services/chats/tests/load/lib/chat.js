import { sleep } from 'k6';
import { ensureConnected, getMetadata } from './grpc.js';
import { chatMetrics } from './metrics.js';
import { config } from './config.js';

const SERVICE_NAME = 'chat.ChatService';

// gRPC status codes (mirrors google.rpc.Code for edge assertions).
export const GrpcCode = {
    OK: 0,
    INVALID_ARGUMENT: 3,
    NOT_FOUND: 5,
    PERMISSION_DENIED: 7,
    UNAUTHENTICATED: 16,
};

function invoke(method, payload, userId, metadataOverride) {
    const client = ensureConnected();
    const metadata = metadataOverride !== undefined ? metadataOverride : getMetadata(userId);
    const params = { metadata: metadata, timeout: config.rpcTimeoutMs };
    const start = Date.now();
    const response = client.invoke(`${SERVICE_NAME}/${method}`, payload, params);
    const duration = Date.now() - start;
    return { response, duration };
}

// Best-effort extraction of the gRPC status code from a k6 invoke response.
// k6 populates response.error on failure; shape varies by version, so probe
// error.code, error.status, and the top-level status field.
export function getErrorCode(response) {
    if (!response) return -1;
    if (response.error === null || response.error === undefined) return GrpcCode.OK;
    const err = response.error;
    if (typeof err === 'object') {
        if (Number.isFinite(err.code)) return err.code;
        if (Number.isFinite(err.status)) return err.status;
    }
    if (Number.isFinite(response.status)) return response.status;
    return -1;
}

export function getErrorMessage(response) {
    if (!response || response.error === null || response.error === undefined) return '';
    const err = response.error;
    if (typeof err === 'string') return err;
    if (typeof err === 'object') return err.message || err.details || JSON.stringify(err);
    return String(err);
}

export function createChat(userId, title) {
    const payload = { user_id: userId, title: title };
    const { response, duration } = invoke('CreateChat', payload, userId);

    const success = !!(response && (response.error === null || response.error === undefined) && response.message && response.message.chatId);
    chatMetrics.rpcSuccessRate.add(success);
    chatMetrics.createDuration.add(duration);

    return success ? response.message.chatId : null;
}

export function saveMessage(chatId, userId, content, messageId) {
    const payload = {
        chat_id: chatId,
        user_id: userId,
        role: 'user',
        content: content,
        message_id: messageId,
        created_at: Math.floor(Date.now() / 1000),
    };
    const { response, duration } = invoke('SaveMessage', payload, userId);

    const success = !!(response && (response.error === null || response.error === undefined) && response.message && response.message.messageId);
    chatMetrics.rpcSuccessRate.add(success);
    chatMetrics.saveMessageDuration.add(duration);

    return success;
}

export function getChat(chatId, userId) {
    const payload = { chat_id: chatId };
    const { response, duration } = invoke('GetChat', payload, userId);

    const success = !!(response && (response.error === null || response.error === undefined) && response.message && response.message.id);
    chatMetrics.rpcSuccessRate.add(success);
    chatMetrics.getChatDuration.add(duration);

    return success ? response.message : null;
}

export function renameChat(chatId, userId, newTitle) {
    const payload = { chat_id: chatId, new_title: newTitle };
    const { response, duration } = invoke('RenameChat', payload, userId);

    const success = !!(response && (response.error === null || response.error === undefined) && response.message && response.message.success === true);
    chatMetrics.rpcSuccessRate.add(success);
    chatMetrics.renameDuration.add(duration);

    return success;
}

export function deleteChat(chatId, userId) {
    const payload = { chat_id: chatId };
    const { response, duration } = invoke('DeleteChat', payload, userId);

    const success = !!(response && (response.error === null || response.error === undefined) && response.message && response.message.success === true);
    chatMetrics.rpcSuccessRate.add(success);
    chatMetrics.deleteDuration.add(duration);

    return success;
}

export function getChatHistory(chatId, userId, page, pageSize) {
    const payload = { chat_id: chatId, page: page || 1, page_size: pageSize || 50 };
    const { response, duration } = invoke('GetChatHistory', payload, userId);

    const success = !!(response && (response.error === null || response.error === undefined) && response.message && response.message.messages !== undefined);
    chatMetrics.rpcSuccessRate.add(success);
    chatMetrics.getHistoryDuration.add(duration);

    return success ? response.message.messages : null;
}

export function getUserChats(userId, limit) {
    const payload = { user_id: userId, limit: limit || 10 };
    const { response, duration } = invoke('GetUserChats', payload, userId);

    const success = !!(response && (response.error === null || response.error === undefined) && response.message && response.message.chats !== undefined);
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
        const messages = getChatHistory(chatId, userId);
        if (messages && messages.some(m => m.id === messageId)) {
            const e2eLatency = Date.now() - startTime;
            chatMetrics.e2eMessageLatency.add(e2eLatency);
            return true;
        }
        sleep(config.e2ePollingIntervalMs / 1000);
    }

    return false;
}

// Raw RPC access for edge-case assertions. These never touch
// rpcSuccessRate; callers record expectations in negativeCheckRate.
export function rawInvoke(method, payload, userId, metadataOverride) {
    return invoke(method, payload, userId, metadataOverride);
}

export function expectErrorCode(method, payload, userId, wantCode, metadataOverride) {
    const { response } = invoke(method, payload, userId, metadataOverride);
    const gotCode = getErrorCode(response);
    const passed = gotCode === wantCode;
    chatMetrics.negativeCheckRate.add(passed);
    return passed;
}
