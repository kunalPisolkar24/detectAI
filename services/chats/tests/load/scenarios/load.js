import exec from "k6/execution";

import { getRuntimeConfig, readPositiveInt, readRatio, readStages } from "../lib/config.js";
import { createReadinessMetrics, createRpcMetrics } from "../lib/metrics.js";
import {
  checkReadiness,
  createChat,
  deleteChat,
  getChat,
  getChatHistory,
  listChats,
  renameChat,
  saveUserMessage,
} from "../lib/connect.js";
import { chatTitle, messageContent, ownerId, pickWeighted } from "../lib/data.js";

const metrics = createRpcMetrics("chats_load");
const readiness = createReadinessMetrics("chats_load_readiness");

const p95ThresholdMs = readPositiveInt("CHATS_LOAD_P95_MS", 250);
const p99ThresholdMs = readPositiveInt("CHATS_LOAD_P99_MS", 500);
const minSuccessRate = readRatio("CHATS_LOAD_MIN_SUCCESS_RATE", 0.99);

// The shape dial: duration:arrivals-per-second steps read from the file. A
// ramp, a tall spike, and a flat marathon are edits of the same STAGES key;
// the first entry seeds the start rate.
const stages = readStages("STAGES", "5s:1,10s:2,5s:0");

export const options = {
  scenarios: {
    load: {
      executor: "ramping-arrival-rate",
      exec: "loadScenario",
      startRate: stages[0].target,
      timeUnit: "1s",
      // k6 grows the VU pool on demand up to the ceiling; the ceiling is the
      // file's burst headroom (MAX_VUS).
      preAllocatedVUs: readPositiveInt("MAX_VUS", 20),
      maxVUs: readPositiveInt("MAX_VUS", 20),
      stages,
      gracefulStop: "30s",
      tags: {
        service: "chats",
        test_type: "load",
      },
    },
  },
  thresholds: {
    checks: [`rate>=${minSuccessRate}`],
    chats_load_success_rate: [`rate>=${minSuccessRate}`],
    chats_load_duration: [`p(95)<${p95ThresholdMs}`, `p(99)<${p99ThresholdMs}`],
  },
};

// The read path: the chat's meta with its head page, the history page, and
// the owner's sidebar.
function readWorkflow(common, chatId) {
  getChat({ ...common, chatId });
  getChatHistory({ ...common, chatId });
  listChats({ ...common });
}

// The write path: two messages on the chat, then the history that carries
// them.
function writeWorkflow(common, chatId) {
  saveUserMessage({ ...common, chatId, content: messageContent(common.contentBytes) });
  saveUserMessage({ ...common, chatId, content: messageContent(common.contentBytes) });
  getChatHistory({ ...common, chatId });
}

// The lifecycle path: a write, a rename, and the reads that must see both.
function lifecycleWorkflow(common, chatId) {
  saveUserMessage({ ...common, chatId, content: messageContent(common.contentBytes) });
  renameChat({ ...common, chatId, title: chatTitle() });
  getChat({ ...common, chatId });
  getChatHistory({ ...common, chatId });
}

// One arrival is one self-contained conversation: a chat is created, one
// weighted workflow runs against it, and the chat is deleted again, so the
// datastore stays the size it was.
export function loadScenario() {
  const config = getRuntimeConfig();
  const scenario = "load";
  // The burst budgets are counted per owner per minute, so the owner is
  // drawn from a wide pool in a global round robin.
  const owner = ownerId("load_owner", exec.scenario.iterationInTest % config.owners);

  const common = {
    baseUrl: config.baseUrl,
    apiKey: config.apiKey,
    ownerId: owner,
    timeout: config.requestTimeout,
    timeoutMs: config.requestTimeoutMs,
    metrics,
    scenario,
    contentBytes: config.contentBytes,
  };

  const created = createChat({ ...common, content: messageContent(config.contentBytes) });
  if (!created.passed) {
    return;
  }
  const chatId = created.chatId;

  const workflow = pickWeighted([
    [config.mix.read, "read"],
    [config.mix.write, "write"],
    [config.mix.lifecycle, "lifecycle"],
  ]);
  if (workflow === "read") {
    readWorkflow(common, chatId);
  } else if (workflow === "write") {
    writeWorkflow(common, chatId);
  } else {
    lifecycleWorkflow(common, chatId);
  }

  if (Math.random() < config.deleteRate) {
    deleteChat({ ...common, chatId });
  }

  // Sample backpressure every 10th arrival without doubling request volume.
  if (exec.scenario.iterationInTest % 10 === 0) {
    checkReadiness({
      baseUrl: config.baseUrl,
      timeout: "5s",
      metrics: readiness,
      scenario,
    });
  }
}
