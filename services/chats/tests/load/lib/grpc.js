import grpc from 'k6/net/grpc';
import { config } from './config.js';

const client = new grpc.Client();
client.load(['../../../api/proto'], 'chat_service.proto');

export function ensureConnected() {
    client.connect(config.target, {
        plaintext: config.plaintext,
        timeout: config.timeout,
    });
    return client;
}

export function closeClient() {
    client.close();
}

export function getMetadata() {
    return {
        // Add auth headers here if needed in future
    };
}
