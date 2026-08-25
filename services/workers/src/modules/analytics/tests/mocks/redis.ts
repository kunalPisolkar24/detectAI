import { mock } from "bun:test";

export const mockMainClient = {
  del: mock(() => Promise.resolve(0)),
  set: mock(() => Promise.resolve("OK")),
  quit: mock(() => Promise.resolve("OK")),
  status: "ready",
  on: mock(),
};
