import { sleep, check } from 'k6';
import { generateUserId, generateChatTitle, generateOversizedTitle, generateMessage, generateOversizedMessage, generateUUID, randomString } from '../lib/data.js';
import { createChat, expectErrorCode, GrpcCode } from '../lib/chat.js';
import { thresholds, config } from '../lib/config.js';
import { closeClient } from '../lib/grpc.js';

// Negative/edge-case scenario. All assertions go to
// chat_negative_check_rate so happy-path SLOs in other scenarios stay pure.
// Usage: make load-test SCENARIO=edge VUS=2 DURATION=1m
export const options = {
    vus: config.edgeVUs,
    duration: config.edgeDuration,
    ...(config.rps > 0 ? { rps: config.rps } : {}),
    thresholds: {
        'chat_negative_check_rate': [`rate>=${thresholds.negativeRate}`],
    },
};

export function teardown() {
    closeClient();
}

export default function () {
    const userId = generateUserId(__VU, __ITER);
    const attackerId = `attacker_${randomString(6)}`;

    // 1. CreateChat validation
    check(expectErrorCode('CreateChat', { user_id: '', title: 'No user' }, '', GrpcCode.UNAUTHENTICATED, {}), {
        'edge: create without user is Unauthenticated': (p) => p === true,
    });
    check(expectErrorCode('CreateChat', { user_id: userId, title: '' }, userId, GrpcCode.INVALID_ARGUMENT), {
        'edge: create with empty title is InvalidArgument': (p) => p === true,
    });
    check(expectErrorCode('CreateChat', { user_id: userId, title: generateOversizedTitle() }, userId, GrpcCode.INVALID_ARGUMENT), {
        'edge: create with oversized title is InvalidArgument': (p) => p === true,
    });
    // Header/body user mismatch must be PermissionDenied, never forwarded.
    check(expectErrorCode('CreateChat', { user_id: attackerId, title: 'Mismatch' }, userId, GrpcCode.PERMISSION_DENIED, { 'x-user-id': userId }), {
        'edge: header/body mismatch is PermissionDenied': (p) => p === true,
    });

    const chatId = createChat(userId, generateChatTitle());
    if (!chatId) return;

    // 2. Authz: another user must not read or mutate this chat.
    check(expectErrorCode('GetChat', { chat_id: chatId }, attackerId, GrpcCode.PERMISSION_DENIED), {
        'edge: cross-user GetChat is PermissionDenied': (p) => p === true,
    });
    check(expectErrorCode('GetChatHistory', { chat_id: chatId, page: 1, page_size: 10 }, attackerId, GrpcCode.PERMISSION_DENIED), {
        'edge: cross-user history is PermissionDenied': (p) => p === true,
    });
    check(expectErrorCode('RenameChat', { chat_id: chatId, new_title: 'Hacked' }, attackerId, GrpcCode.PERMISSION_DENIED), {
        'edge: cross-user rename is PermissionDenied': (p) => p === true,
    });
    check(expectErrorCode('DeleteChat', { chat_id: chatId }, attackerId, GrpcCode.PERMISSION_DENIED), {
        'edge: cross-user delete is PermissionDenied': (p) => p === true,
    });

    // 3. Missing auth on auth-required RPCs.
    check(expectErrorCode('GetChat', { chat_id: chatId }, '', GrpcCode.UNAUTHENTICATED, {}), {
        'edge: GetChat without auth is Unauthenticated': (p) => p === true,
    });

    // 4. SaveMessage validation.
    check(expectErrorCode('SaveMessage', { chat_id: '', user_id: userId, role: 'user', content: 'hi' }, userId, GrpcCode.INVALID_ARGUMENT), {
        'edge: save without chat_id is InvalidArgument': (p) => p === true,
    });
    check(expectErrorCode('SaveMessage', { chat_id: chatId, user_id: userId, role: 'user', content: '   ' }, userId, GrpcCode.INVALID_ARGUMENT), {
        'edge: save with blank content is InvalidArgument': (p) => p === true,
    });
    check(expectErrorCode('SaveMessage', { chat_id: chatId, user_id: userId, role: 'user', content: generateOversizedMessage() }, userId, GrpcCode.INVALID_ARGUMENT), {
        'edge: save with oversized content is InvalidArgument': (p) => p === true,
    });
    check(expectErrorCode('SaveMessage', { chat_id: chatId, user_id: userId, role: 'not-a-role', content: 'hi' }, userId, GrpcCode.INVALID_ARGUMENT), {
        'edge: save with bad role is InvalidArgument': (p) => p === true,
    });

    // 5. NotFound paths.
    const missingId = generateUUID();
    check(expectErrorCode('GetChat', { chat_id: missingId }, userId, GrpcCode.NOT_FOUND), {
        'edge: GetChat missing is NotFound': (p) => p === true,
    });
    check(expectErrorCode('GetChatHistory', { chat_id: missingId, page: 1, page_size: 10 }, userId, GrpcCode.NOT_FOUND), {
        'edge: history missing is NotFound': (p) => p === true,
    });

    // 6. One valid write keeps the happy path warm without affecting SLOs.
    check(expectErrorCode('SaveMessage', { chat_id: chatId, user_id: userId, role: 'user', content: generateMessage(), message_id: generateUUID() }, userId, GrpcCode.OK), {
        'edge: valid save still succeeds': (p) => p === true,
    });

    sleep(1);
}
