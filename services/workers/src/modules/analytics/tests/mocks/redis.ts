import { mock } from "bun:test";

export const mockMainClient = {
  del: mock(() => Promise.resolve(0)),
  quit: mock(() => Promise.resolve("OK")),
  status: "ready",
  on: mock(),
};
