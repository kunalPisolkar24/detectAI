import grpc from 'k6/net/grpc';
import { config } from './config.js';

const client = new grpc.Client();
// PROTO_DIR=/proto in compose.load.yml (mounted ../api/proto:/proto:ro),
// fallback to repo-relative path for local `k6 run` from services/chats/
const protoDirs = [];
if (__ENV.PROTO_DIR) protoDirs.push(__ENV.PROTO_DIR);
protoDirs.push('../../../api/proto');
client.load(protoDirs, 'chat_service.proto');

let connected = false;

export function ensureConnected() {
    if (!connected) {
        client.connect(config.target, {
            plaintext: config.plaintext,
            timeout: config.timeout,
        });
        connected = true;
    }
    return client;
}

export function closeClient() {
    try {
        client.close();
    } catch (e) {
        // Ignore close errors during teardown; k6 reaps VU runtimes anyway.
    } finally {
        connected = false;
    }
}

export function getMetadata(userId) {
    const meta = {};
    if (userId) {
        meta['x-user-id'] = userId;
    }
    return meta;
}
