import http from "k6/http";

const SERVICE = "chats.v1.ChatService";

export function procedureUrl(baseUrl, method) {
  return `${baseUrl}/${SERVICE}/${method}`;
}

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

export function request({ baseUrl, method, body, apiKey, ownerId, timeout, tags }) {
  return http.post(procedureUrl(baseUrl, method), JSON.stringify(body), {
    headers: connectHeaders({ apiKey, ownerId }),
    timeout,
    tags,
  });
}

export function healthCheck({ baseUrl, timeout, tags }) {
  return http.get(`${baseUrl}/api/v1/health`, { timeout, tags });
}
