import { mock } from "bun:test";

export const mockRedisSpop = mock();
export const mockRedisSadd = mock();
export const mockRedisQuit = mock(() => Promise.resolve("OK"));
export const mockRedisGet = mock();
export const mockRedisSetex = mock();
export const mockRedisWatch = mock(() => Promise.resolve("OK"));
export const mockRedisUnwatch = mock(() => Promise.resolve("OK"));
export const mockRedisExec = mock();

export const mockMultiChain = {
  setex: mockRedisSetex,
  exec: mockRedisExec,
};

mockRedisSetex.mockReturnValue(mockMultiChain);

export const mockRedisMulti = mock(() => mockMultiChain);

export const mockPipelineExec = mock(() => Promise.resolve([]));
export const mockPipelineGet = mock();
export const mockPipelineSet = mock();
export const mockPipelineDecrby = mock();

const pipelineObj = {
  get: mockPipelineGet,
  set: mockPipelineSet,
  decrby: mockPipelineDecrby,
  exec: mockPipelineExec,
};

mockPipelineGet.mockReturnValue(pipelineObj);
mockPipelineSet.mockReturnValue(pipelineObj);
mockPipelineDecrby.mockReturnValue(pipelineObj);

export const mockRedisPipeline = mock(() => pipelineObj);

export const mockRedisClient = {
  spop: mockRedisSpop,
  sadd: mockRedisSadd,
  get: mockRedisGet,
  watch: mockRedisWatch,
  unwatch: mockRedisUnwatch,
  multi: mockRedisMulti,
  pipeline: mockRedisPipeline,
  quit: mockRedisQuit,
  on: mock(),
};

export const redisMock = {
  createRedisClient: mock(() => mockRedisClient),
  redis: mockRedisClient
};