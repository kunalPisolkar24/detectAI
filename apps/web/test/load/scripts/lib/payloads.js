// Request bodies for the analyze endpoint, and the matrix of malformed ones
// the load suite expects the service to reject.
//
// The expected statuses below are the contract the service implements in
// app/api/chat/analyze/stream/route.ts. A case that stops matching is a
// behaviour change, not a flaky test.

const MAX_LIVE_ANALYSIS_CHARS = 50000

// The chat the requests are addressed to. The rig's mock backend accepts any
// id, but a real chats service needs one that exists and belongs to the user
// the request carries, or the analyze route answers 500 with NOT_FOUND.
const CHAT_ID = __ENV.WEB_CHAT_ID || 'mock-chat-id'

const SCHEMA_ERROR = 'Invalid request payload'
const JSON_ERROR = 'Invalid JSON body'
const OVERSIZE_ERROR = 'Text exceeds maximum length'
const UNAUTHORIZED_ERROR = 'Unauthorized'

export function validPayload(overrides = {}) {
  return {
    chatId: CHAT_ID,
    content: 'This is a sample text to be analyzed by the AI service during a load test.',
    model: 'spark',
    ...overrides,
  }
}

// Bodies the service must reject with a schema error.
const SCHEMA_CASES = [
  { name: 'missing_chat_id', payload: { content: 'text', model: 'spark' } },
  { name: 'empty_chat_id', payload: { chatId: '', content: 'text', model: 'spark' } },
  { name: 'missing_content', payload: { chatId: 'c', model: 'spark' } },
  { name: 'empty_content', payload: { chatId: 'c', content: '', model: 'spark' } },
  { name: 'missing_model', payload: { chatId: 'c', content: 'text' } },
  { name: 'content_wrong_type', payload: { chatId: 'c', content: 123, model: 'spark' } },
  { name: 'chat_id_wrong_type', payload: { chatId: 42, content: 'text', model: 'spark' } },
  { name: 'model_wrong_type', payload: { chatId: 'c', content: 'text', model: 7 } },
  { name: 'model_unknown_value', payload: { chatId: 'c', content: 'text', model: 'gpt-4' } },
  { name: 'assistant_created_at_invalid', payload: { chatId: 'c', content: 'text', model: 'spark', assistantCreatedAt: 'not-a-date' } },
  { name: 'user_created_at_invalid', payload: { chatId: 'c', content: 'text', model: 'spark', userCreatedAt: 'yesterday' } },
  { name: 'source_message_without_assistant', payload: { chatId: 'c', content: 'text', model: 'spark', sourceMessageId: 'src-1' } },
]

// Bodies that are not valid JSON at all.
const JSON_CASES = [
  { name: 'malformed_json', raw: '{"chatId": "c", "content": ' },
  { name: 'empty_body', raw: '' },
  { name: 'json_null', raw: 'null' },
  { name: 'json_string', raw: '"just a string"' },
  { name: 'json_array', raw: '[]' },
  { name: 'json_number', raw: '42' },
]

/**
 * Every rejection case, each with the status and error the service owes it.
 * `group` drives the per-group thresholds: rejections should be cheaper than
 * the work that actually runs.
 */
export const INVALID_CASES = [
  ...SCHEMA_CASES.map((c) => ({
    ...c,
    group: 'invalid',
    expectedStatus: 400,
    expectError: SCHEMA_ERROR,
  })),
  ...JSON_CASES.map((c) => ({
    ...c,
    group: 'invalid',
    expectedStatus: 400,
    expectError: c.name === 'malformed_json' || c.name === 'empty_body' ? JSON_ERROR : SCHEMA_ERROR,
  })),
  {
    name: 'content_over_max',
    group: 'invalid',
    expectedStatus: 400,
    expectError: OVERSIZE_ERROR,
    payload: { chatId: 'c', content: 'x'.repeat(MAX_LIVE_ANALYSIS_CHARS + 1), model: 'spark' },
  },
  {
    name: 'missing_internal_key',
    group: 'invalid',
    expectedStatus: 401,
    expectError: UNAUTHORIZED_ERROR,
    payload: validPayload(),
    omitInternalKey: true,
  },
  {
    name: 'wrong_internal_key',
    group: 'invalid',
    expectedStatus: 401,
    expectError: UNAUTHORIZED_ERROR,
    payload: validPayload(),
    internalKey: 'not-the-key',
  },
  {
    name: 'wrong_http_method',
    group: 'invalid',
    expectedStatus: 405,
    expectError: null,
    method: 'GET',
    payload: validPayload(),
  },
]

/**
 * Bodies that sit on a boundary and must still be served.
 */
export const BOUNDARY_CASES = [
  {
    name: 'content_at_max',
    group: 'boundary',
    expectedStatus: 200,
    payload: { chatId: CHAT_ID, content: 'x'.repeat(MAX_LIVE_ANALYSIS_CHARS), model: 'spark' },
  },
  {
    name: 'unknown_extra_field',
    group: 'boundary',
    expectedStatus: 200,
    payload: { chatId: CHAT_ID, content: 'text', model: 'spark', unexpectedField: 'ignored' },
  },
]

export const ALL_CASES = [...INVALID_CASES, ...BOUNDARY_CASES]
