import { fail } from "k6";

import { getRuntimeConfig } from "../lib/config.js";
import { createExpectationMetrics, createRpcMetrics } from "../lib/metrics.js";
import {
  chatIds,
  checkHealth,
  createChat,
  createUnderBudget,
  deleteChat,
  expectRejection,
  getChat,
  getChatHistory,
  listChats,
  messageIds,
  renameChat,
  saveUserMessage,
} from "../lib/connect.js";
import { chatTitle, messageContent, oversizedContent, ownerId, runSuffix } from "../lib/data.js";

const metrics = createRpcMetrics("chats_smoke");
const expectations = createExpectationMetrics("chats_smoke");

export const options = {
  vus: 1,
  iterations: 1,
  thresholds: {
    // One pass ticks every row below; any unexpected answer ends the run.
    checks: ["rate==1"],
  },
  tags: {
    service: "chats",
    test_type: "smoke",
  },
};

const SCENARIO = "smoke";

// The lifecycle row: create, write, read back, rename, delete, verify gone.
function lifecycle(config, owner) {
  const createdChat = createChat({
    baseUrl: config.baseUrl,
    apiKey: config.apiKey,
    ownerId: owner,
    content: messageContent(config.contentBytes),
    timeout: config.requestTimeout,
    timeoutMs: config.requestTimeoutMs,
    metrics,
    scenario: SCENARIO,
  });
  if (!createdChat.passed) {
    fail(`Smoke create failed: status=${createdChat.status} code=${createdChat.code}`);
  }
  const chatId = createdChat.chatId;

  const saved = saveUserMessage({
    baseUrl: config.baseUrl,
    apiKey: config.apiKey,
    ownerId: owner,
    chatId,
    content: messageContent(config.contentBytes),
    timeout: config.requestTimeout,
    timeoutMs: config.requestTimeoutMs,
    metrics,
    scenario: SCENARIO,
  });
  if (!saved.passed) {
    fail(`Smoke save failed: status=${saved.status} code=${saved.code}`);
  }

  const fetched = getChat({
    baseUrl: config.baseUrl,
    apiKey: config.apiKey,
    ownerId: owner,
    chatId,
    timeout: config.requestTimeout,
    timeoutMs: config.requestTimeoutMs,
    metrics,
    scenario: SCENARIO,
  });
  if (!fetched.passed) {
    fail(`Smoke get failed: status=${fetched.status} code=${fetched.code}`);
  }
  if (!messageIds(fetched.res).includes(saved.messageId)) {
    fail("Smoke get did not carry the saved message");
  }

  const history = getChatHistory({
    baseUrl: config.baseUrl,
    apiKey: config.apiKey,
    ownerId: owner,
    chatId,
    timeout: config.requestTimeout,
    timeoutMs: config.requestTimeoutMs,
    metrics,
    scenario: SCENARIO,
  });
  if (!history.passed) {
    fail(`Smoke history failed: status=${history.status} code=${history.code}`);
  }
  if (!messageIds(history.res).includes(saved.messageId)) {
    fail("Smoke history did not carry the saved message");
  }

  const listed = listChats({
    baseUrl: config.baseUrl,
    apiKey: config.apiKey,
    ownerId: owner,
    timeout: config.requestTimeout,
    timeoutMs: config.requestTimeoutMs,
    metrics,
    scenario: SCENARIO,
  });
  if (!listed.passed) {
    fail(`Smoke list failed: status=${listed.status} code=${listed.code}`);
  }
  if (!chatIds(listed.res).includes(chatId)) {
    fail("Smoke list did not carry the chat");
  }

  const title = chatTitle();
  const renamed = renameChat({
    baseUrl: config.baseUrl,
    apiKey: config.apiKey,
    ownerId: owner,
    chatId,
    title,
    timeout: config.requestTimeout,
    timeoutMs: config.requestTimeoutMs,
    metrics,
    scenario: SCENARIO,
  });
  if (!renamed.passed) {
    fail(`Smoke rename failed: status=${renamed.status} code=${renamed.code}`);
  }

  const refetched = getChat({
    baseUrl: config.baseUrl,
    apiKey: config.apiKey,
    ownerId: owner,
    chatId,
    timeout: config.requestTimeout,
    timeoutMs: config.requestTimeoutMs,
    metrics,
    scenario: SCENARIO,
  });
  if (!refetched.passed) {
    fail(`Smoke get after rename failed: status=${refetched.status} code=${refetched.code}`);
  }
  try {
    if (refetched.res.json("title") !== title) {
      fail("Smoke rename did not change the chat title");
    }
  } catch (_e) {
    fail("Smoke get after rename carried no title");
  }

  const deleted = deleteChat({
    baseUrl: config.baseUrl,
    apiKey: config.apiKey,
    ownerId: owner,
    chatId,
    timeout: config.requestTimeout,
    timeoutMs: config.requestTimeoutMs,
    metrics,
    scenario: SCENARIO,
  });
  if (!deleted.passed) {
    fail(`Smoke delete failed: status=${deleted.status} code=${deleted.code}`);
  }

  const gone = expectRejection({
    baseUrl: config.baseUrl,
    method: "GetChat",
    body: { chat_id: chatId },
    apiKey: config.apiKey,
    ownerId: owner,
    expectedStatus: 404,
    expectedCode: "not_found",
    timeout: config.requestTimeout,
    metrics: expectations,
    scenario: SCENARIO,
    op: "get",
  });
  if (!gone.passed) {
    fail(`Smoke delete left the chat readable: status=${gone.status} code=${gone.code}`);
  }

  const goneHistory = expectRejection({
    baseUrl: config.baseUrl,
    method: "GetChatHistory",
    body: { chat_id: chatId },
    apiKey: config.apiKey,
    ownerId: owner,
    expectedStatus: 404,
    expectedCode: "not_found",
    timeout: config.requestTimeout,
    metrics: expectations,
    scenario: SCENARIO,
    op: "history",
  });
  if (!goneHistory.passed) {
    fail(`Smoke delete left the history readable: status=${goneHistory.status} code=${goneHistory.code}`);
  }

  const relisted = listChats({
    baseUrl: config.baseUrl,
    apiKey: config.apiKey,
    ownerId: owner,
    timeout: config.requestTimeout,
    timeoutMs: config.requestTimeoutMs,
    metrics,
    scenario: SCENARIO,
  });
  if (!relisted.passed) {
    fail(`Smoke list after delete failed: status=${relisted.status} code=${relisted.code}`);
  }
  if (chatIds(relisted.res).includes(chatId)) {
    fail("Smoke delete left the chat listed");
  }
}

// The contract matrix: one row per guard, each on its own owner where the
// guard needs one.
function contractMatrix(config, owner, foreignOwner) {
  const matrixChat = createChat({
    baseUrl: config.baseUrl,
    apiKey: config.apiKey,
    ownerId: owner,
    content: messageContent(config.contentBytes),
    timeout: config.requestTimeout,
    timeoutMs: config.requestTimeoutMs,
    metrics,
    scenario: SCENARIO,
  });
  if (!matrixChat.passed) {
    fail(`Smoke matrix setup failed: status=${matrixChat.status} code=${matrixChat.code}`);
  }
  const chatId = matrixChat.chatId;

  const rows = [
    {
      case: "missing-api-key",
      method: "CreateChat",
      body: { initial_message: "guarded" },
      apiKey: undefined,
      ownerId: owner,
      expectedStatus: 401,
      expectedCode: "unauthenticated",
      op: "create",
    },
    {
      case: "wrong-api-key",
      method: "CreateChat",
      body: { initial_message: "guarded" },
      apiKey: "wrong-key-0123456789abcd",
      ownerId: owner,
      expectedStatus: 401,
      expectedCode: "unauthenticated",
      op: "create",
    },
    {
      case: "missing-user-id",
      method: "CreateChat",
      body: { initial_message: "guarded" },
      apiKey: config.apiKey,
      ownerId: undefined,
      expectedStatus: 401,
      expectedCode: "unauthenticated",
      op: "create",
    },
    {
      case: "empty-content",
      method: "CreateChat",
      body: { initial_message: "" },
      apiKey: config.apiKey,
      ownerId: owner,
      expectedStatus: 400,
      expectedCode: "invalid_argument",
      op: "create",
    },
    {
      case: "oversized-content",
      method: "SaveUserMessage",
      body: { chat_id: chatId, content: oversizedContent() },
      apiKey: config.apiKey,
      ownerId: owner,
      expectedStatus: 400,
      expectedCode: "invalid_argument",
      op: "save",
    },
    {
      case: "unknown-chat",
      method: "GetChat",
      body: { chat_id: "chat_that_does_not_exist" },
      apiKey: config.apiKey,
      ownerId: owner,
      expectedStatus: 404,
      expectedCode: "not_found",
      op: "get",
    },
    {
      case: "foreign-owner",
      method: "GetChat",
      body: { chat_id: chatId },
      apiKey: config.apiKey,
      ownerId: foreignOwner,
      expectedStatus: 404,
      expectedCode: "not_found",
      op: "get",
    },
    {
      case: "invalid-cursor",
      method: "GetChatHistory",
      body: { chat_id: chatId, cursor: "not-a-cursor" },
      apiKey: config.apiKey,
      ownerId: owner,
      expectedStatus: 400,
      expectedCode: "invalid_argument",
      op: "history",
    },
    {
      case: "analysis-without-state",
      method: "SaveAnalysisMessage",
      body: { chat_id: chatId },
      apiKey: config.apiKey,
      ownerId: owner,
      expectedStatus: 400,
      expectedCode: "invalid_argument",
      op: "save",
    },
  ];

  for (const row of rows) {
    const result = expectRejection({
      baseUrl: config.baseUrl,
      method: row.method,
      body: row.body,
      apiKey: row.apiKey,
      ownerId: row.ownerId,
      expectedStatus: row.expectedStatus,
      expectedCode: row.expectedCode,
      timeout: config.requestTimeout,
      metrics: expectations,
      scenario: SCENARIO,
      op: row.op,
    });
    if (!result.passed) {
      fail(`Smoke case ${row.case} answered status=${result.status} code=${result.code}`);
    }
  }

  const deleted = deleteChat({
    baseUrl: config.baseUrl,
    apiKey: config.apiKey,
    ownerId: owner,
    chatId: chatId,
    timeout: config.requestTimeout,
    timeoutMs: config.requestTimeoutMs,
    metrics,
    scenario: SCENARIO,
  });
  if (!deleted.passed) {
    fail(`Smoke matrix cleanup failed: status=${deleted.status} code=${deleted.code}`);
  }
}

// The burst budget row: the create scope refuses once its window is spent.
function burstBudget(config, owner, accepted) {
  const limit = config.createLimit;
  for (let attempt = 0; attempt < limit * 3; attempt += 1) {
    const result = createUnderBudget({
      baseUrl: config.baseUrl,
      apiKey: config.apiKey,
      ownerId: owner,
      content: messageContent(64),
      timeout: config.requestTimeout,
      metrics: expectations,
      scenario: SCENARIO,
    });
    if (result.refused) {
      return true;
    }
    if (result.chatId) {
      accepted.push(result.chatId);
    }
  }
  return false;
}

// The functional gate: a healthy deployment, one full lifecycle, the
// rejection matrix, and the burst budget — every request of this single pass
// is asserted, so any surprise fails the run.
export default function () {
  const config = getRuntimeConfig();
  const suffix = runSuffix();
  const budgetOwner = ownerId(`smoke_budget_${suffix}`);
  const accepted = [];

  if (!checkHealth({ baseUrl: config.baseUrl, timeout: config.requestTimeout, scenario: SCENARIO })) {
    fail("Smoke health check failed");
  }

  lifecycle(config, ownerId(`smoke_owner_${suffix}`));
  contractMatrix(config, ownerId(`smoke_matrix_${suffix}`), ownerId(`smoke_foreign_${suffix}`));
  const refused = burstBudget(config, budgetOwner, accepted);

  // The budget row's accepted creates leave the datastore clean.
  for (const chatId of accepted) {
    deleteChat({
      baseUrl: config.baseUrl,
      apiKey: config.apiKey,
      ownerId: budgetOwner,
      chatId,
      timeout: config.requestTimeout,
      timeoutMs: config.requestTimeoutMs,
      metrics,
      scenario: SCENARIO,
    });
  }

  if (!refused) {
    fail("Smoke burst budget was never refused");
  }
}
