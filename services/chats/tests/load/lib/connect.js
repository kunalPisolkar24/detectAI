import http from "k6/http";
import { check } from "k6";

// The service name the Connect protocol routes under.
const SERVICE = "chats.v1.ChatService";

// The Connect protocol's unary route: the procedure path under the service name.
export function procedureUrl(baseUrl, method) {
  return `${baseUrl}/${SERVICE}/${method}`;
}

// The Connect protocol's unary headers: the JSON codec, the protocol version,
// and the service's two credential carriers. An absent carrier stays off the
// wire entirely, so a missing key stays missing.
export function connectHeaders({ apiKey, ownerId }) {
  const headers = {
    "Content-Type": "application/json",
    "Connect-Protocol-Version": "1",
  };
  if (apiKey !== undefined && apiKey !== null) {
    headers["x-api-key"] = apiKey;
  }
  if (ownerId !== undefined && ownerId !== null) {
    headers["x-user-id"] = ownerId;
  }
  return headers;
}

// The Connect error body names the code; the status carries the same verdict.
export function errorCode(res) {
  if (res.status === 200) {
    return "ok";
  }
  try {
    return res.json("code") || "";
  } catch (_e) {
    return "";
  }
}

function jsonString(res, field) {
  try {
    const value = res.json(field);
    return typeof value === "string" ? value : "";
  } catch (_e) {
    return "";
  }
}

// The repeated field is a list on the wire or absent when it is empty: the
// JSON codec drops an empty list, but it never sends a scalar in its place.
function carriesRepeated(res, field) {
  try {
    const value = res.json(field);
    return value === undefined || Array.isArray(value);
  } catch (_e) {
    return false;
  }
}

function post({ baseUrl, method, body, apiKey, ownerId, timeout, tags }) {
  return http.post(procedureUrl(baseUrl, method), JSON.stringify(body), {
    headers: connectHeaders({ apiKey, ownerId }),
    timeout,
    tags,
  });
}

// One unary call on the happy path: the checks and the metric record.
function call({ baseUrl, method, body, apiKey, ownerId, timeout, timeoutMs, metrics, scenario, op, checks }) {
  const tags = { scenario, op };
  const startedAt = Date.now();
  const res = post({ baseUrl, method, body, apiKey, ownerId, timeout, tags });
  const duration = Date.now() - startedAt;

  const passed = check(res, checks, tags);
  metrics.duration.add(duration, tags);
  metrics.op[op].add(duration, tags);
  metrics.successRate.add(passed ? 1 : 0, tags);
  if (!passed) {
    metrics.failures.add(1, { ...tags, status: String(res.status), code: errorCode(res) });
  }
  if (res.status === 0 || duration >= timeoutMs) {
    metrics.timeouts.add(1, tags);
  }
  if (res.status === 429) {
    metrics.rateLimited.add(1, tags);
  }
  return { res, passed, duration, status: res.status, code: errorCode(res) };
}

// One unary call on an expected-failure path: the verdict is the point, so
// the row scores against its own metric and never against the happy path.
function expect({ baseUrl, method, body, apiKey, ownerId, timeout, metrics, scenario, op, checks }) {
  const tags = { scenario, op };
  const res = post({ baseUrl, method, body, apiKey, ownerId, timeout, tags });

  const passed = check(res, checks, tags);
  metrics.successRate.add(passed ? 1 : 0, tags);
  if (!passed) {
    metrics.failures.add(1, { ...tags, status: String(res.status), code: errorCode(res) });
  }
  return { res, passed, status: res.status, code: errorCode(res) };
}

export function createChat({ baseUrl, apiKey, ownerId, content, timeout, timeoutMs, metrics, scenario }) {
  const result = call({
    baseUrl,
    method: "CreateChat",
    body: { initial_message: content },
    apiKey,
    ownerId,
    timeout,
    timeoutMs,
    metrics,
    scenario,
    op: "create",
    checks: {
      "status is 200": (r) => r.status === 200,
      "carries a chat id": (r) => jsonString(r, "id") !== "",
    },
  });
  result.chatId = result.passed ? result.res.json("id") : null;
  return result;
}

export function saveUserMessage({ baseUrl, apiKey, ownerId, chatId, content, timeout, timeoutMs, metrics, scenario }) {
  const result = call({
    baseUrl,
    method: "SaveUserMessage",
    body: { chat_id: chatId, content },
    apiKey,
    ownerId,
    timeout,
    timeoutMs,
    metrics,
    scenario,
    op: "save",
    checks: {
      "status is 200": (r) => r.status === 200,
      "carries a message id": (r) => jsonString(r, "id") !== "",
    },
  });
  result.messageId = result.passed ? result.res.json("id") : null;
  return result;
}

export function getChat({ baseUrl, apiKey, ownerId, chatId, timeout, timeoutMs, metrics, scenario }) {
  return call({
    baseUrl,
    method: "GetChat",
    body: { chat_id: chatId },
    apiKey,
    ownerId,
    timeout,
    timeoutMs,
    metrics,
    scenario,
    op: "get",
    checks: {
      "status is 200": (r) => r.status === 200,
      "carries the chat id": (r) => jsonString(r, "id") === chatId,
    },
  });
}

export function getChatHistory({ baseUrl, apiKey, ownerId, chatId, cursor = "", limit = 50, timeout, timeoutMs, metrics, scenario }) {
  return call({
    baseUrl,
    method: "GetChatHistory",
    body: { chat_id: chatId, cursor, limit },
    apiKey,
    ownerId,
    timeout,
    timeoutMs,
    metrics,
    scenario,
    op: "history",
    checks: {
      "status is 200": (r) => r.status === 200,
      "carries messages": (r) => carriesRepeated(r, "messages"),
    },
  });
}

export function listChats({ baseUrl, apiKey, ownerId, limit = 50, timeout, timeoutMs, metrics, scenario }) {
  return call({
    baseUrl,
    method: "ListChats",
    body: { limit },
    apiKey,
    ownerId,
    timeout,
    timeoutMs,
    metrics,
    scenario,
    op: "list",
    checks: {
      "status is 200": (r) => r.status === 200,
      "carries chats": (r) => carriesRepeated(r, "chats"),
    },
  });
}

export function renameChat({ baseUrl, apiKey, ownerId, chatId, title, timeout, timeoutMs, metrics, scenario }) {
  return call({
    baseUrl,
    method: "RenameChat",
    body: { chat_id: chatId, title },
    apiKey,
    ownerId,
    timeout,
    timeoutMs,
    metrics,
    scenario,
    op: "rename",
    checks: {
      "status is 200": (r) => r.status === 200,
      "carries the new title": (r) => jsonString(r, "title") === title,
    },
  });
}

export function deleteChat({ baseUrl, apiKey, ownerId, chatId, timeout, timeoutMs, metrics, scenario }) {
  return call({
    baseUrl,
    method: "DeleteChat",
    body: { chat_id: chatId },
    apiKey,
    ownerId,
    timeout,
    timeoutMs,
    metrics,
    scenario,
    op: "delete",
    checks: {
      "status is 200": (r) => r.status === 200,
    },
  });
}

// A rejection row asserts the exact verdict its guard answers with; the code
// row pins the protocol's own name, not just the status.
export function expectRejection({ baseUrl, method, body, apiKey, ownerId, expectedStatus, expectedCode, timeout, metrics, scenario, op }) {
  const checks = {
    "rejected with the expected status": (r) => r.status === expectedStatus,
  };
  if (expectedCode) {
    checks["rejected with the expected code"] = (r) => errorCode(r) === expectedCode;
  }
  return expect({
    baseUrl,
    method,
    body,
    apiKey,
    ownerId,
    timeout,
    metrics,
    scenario,
    op,
    checks,
  });
}

// The burst budget row: the create is accepted until the window is spent and
// refused after it, so both answers are expected and the row scores on the
// refusal it is looking for.
export function createUnderBudget({ baseUrl, apiKey, ownerId, content, timeout, metrics, scenario }) {
  const tags = { scenario, op: "create" };
  const res = post({
    baseUrl,
    method: "CreateChat",
    body: { initial_message: content },
    apiKey,
    ownerId,
    timeout,
    tags,
  });

  const passed = check(
    res,
    { "the create is accepted or refused": (r) => r.status === 200 || r.status === 429 },
    tags,
  );
  metrics.successRate.add(passed ? 1 : 0, tags);
  if (!passed) {
    metrics.failures.add(1, { ...tags, status: String(res.status), code: errorCode(res) });
  }
  return {
    res,
    passed,
    status: res.status,
    code: errorCode(res),
    refused: res.status === 429,
    chatId: res.status === 200 ? jsonString(res, "id") : null,
  };
}

export function checkHealth({ baseUrl, timeout, scenario }) {
  const tags = { scenario };
  const res = http.get(`${baseUrl}/api/v1/health`, { timeout, tags });
  return check(
    res,
    {
      "status is 200": (r) => r.status === 200,
      "status is ok": (r) => {
        try {
          return r.json("status") === "ok";
        } catch (_e) {
          return false;
        }
      },
    },
    tags,
  );
}

// Readiness samples backpressure during a run; a 503 is a not-ready tick, not
// a failure.
export function checkReadiness({ baseUrl, timeout, metrics, scenario }) {
  const tags = { scenario };
  const res = http.get(`${baseUrl}/api/v1/ready`, { timeout, tags });
  metrics.checks.add(1, tags);
  const ready = res.status === 200;
  if (!ready) {
    metrics.notReady.add(1, { ...tags, status: String(res.status) });
  }
  check(res, { "readiness reachable": (r) => r.status === 200 || r.status === 503 }, tags);
  return { res, ready };
}

// The chat ids and message ids of a response, read defensively.
export function chatIds(res) {
  try {
    const chats = res.json("chats");
    return Array.isArray(chats) ? chats.map((chat) => chat && chat.id).filter(Boolean) : [];
  } catch (_e) {
    return [];
  }
}

export function messageIds(res) {
  try {
    const messages = res.json("messages");
    return Array.isArray(messages) ? messages.map((message) => message && message.id).filter(Boolean) : [];
  } catch (_e) {
    return [];
  }
}
