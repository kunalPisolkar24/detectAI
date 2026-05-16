import { Trend, Rate } from 'k6/metrics';

export const chatMetrics = {
    createDuration: new Trend('chat_create_duration', true),
    saveMessageDuration: new Trend('chat_save_message_duration', true),
    getHistoryDuration: new Trend('chat_get_history_duration', true),
    getUserChatsDuration: new Trend('chat_get_user_chats_duration', true),
    e2eMessageLatency: new Trend('chat_e2e_message_latency', true),
    rpcSuccessRate: new Rate('chat_rpc_success_rate'),
};
