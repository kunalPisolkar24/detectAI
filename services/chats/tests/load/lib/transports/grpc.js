import grpc from "k6/net/grpc";

import { getRuntimeConfig } from "../config.js";

const SERVICE = "chats.v1.ChatService";

const VERDICTS = {
  [grpc.StatusOK]: { status: 200, code: "ok" },
  [grpc.StatusInvalidArgument]: { status: 400, code: "invalid_argument" },
  [grpc.StatusOutOfRange]: { status: 400, code: "out_of_range" },
  [grpc.StatusFailedPrecondition]: { status: 400, code: "failed_precondition" },
  [grpc.StatusUnauthenticated]: { status: 401, code: "unauthenticated" },
  [grpc.StatusPermissionDenied]: { status: 403, code: "permission_denied" },
  [grpc.StatusNotFound]: { status: 404, code: "not_found" },
  [grpc.StatusAlreadyExists]: { status: 409, code: "already_exists" },
  [grpc.StatusAborted]: { status: 409, code: "aborted" },
  [grpc.StatusResourceExhausted]: { status: 429, code: "resource_exhausted" },
  [grpc.StatusUnimplemented]: { status: 501, code: "unimplemented" },
  [grpc.StatusInternal]: { status: 500, code: "internal" },
  [grpc.StatusUnknown]: { status: 500, code: "unknown" },
  [grpc.StatusDataLoss]: { status: 500, code: "data_loss" },
  [grpc.StatusCanceled]: { status: 0, code: "canceled" },
  [grpc.StatusDeadlineExceeded]: { status: 0, code: "deadline_exceeded" },
  [grpc.StatusUnavailable]: { status: 0, code: "unavailable" },
};

function normalize(response) {
  const verdict = VERDICTS[response.status] || { status: 500, code: "unknown" };
  const payload =
    response.status === grpc.StatusOK
      ? response.message || {}
      : { ...(response.error || {}), code: verdict.code };
  return {
    status: verdict.status,
    code: verdict.code,
    json(field) {
      return field ? payload[field] : payload;
    },
  };
}

const client = new grpc.Client();
let connected = false;

function ensureConnected() {
  if (connected) {
    return;
  }
  const config = getRuntimeConfig();
  client.connect(config.grpcAddress, {
    plaintext: config.grpcPlaintext,
    reflect: true,
    timeout: config.requestTimeout,
  });
  connected = true;
}

function metadata({ apiKey, ownerId }) {
  const md = {};
  if (apiKey !== undefined && apiKey !== null) {
    md["x-api-key"] = apiKey;
  }
  if (ownerId !== undefined && ownerId !== null) {
    md["x-user-id"] = ownerId;
  }
  return md;
}

export function request({ method, body, apiKey, ownerId, timeout, tags }) {
  ensureConnected();
  let response;
  try {
    response = client.invoke(`/${SERVICE}/${method}`, body, {
      metadata: metadata({ apiKey, ownerId }),
      timeout,
      tags,
    });
  } catch (error) {
    return normalize({ status: grpc.StatusUnavailable, error: { message: String(error) } });
  }
  return normalize(response);
}
