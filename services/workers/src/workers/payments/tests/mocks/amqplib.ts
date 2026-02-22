import { mock } from "bun:test";

export const mockAck = mock();
export const mockNack = mock();
export const mockConsume = mock();
export const mockAssertQueue = mock(() => Promise.resolve());
export const mockPrefetch = mock(() => Promise.resolve());
export const mockOn = mock();

export const mockChannel = {
    assertQueue: mockAssertQueue,
    prefetch: mockPrefetch,
    consume: mockConsume,
    ack: mockAck,
    nack: mockNack,
};

export const mockConnection = {
    createChannel: mock(() => Promise.resolve(mockChannel)),
    on: mockOn,
};

export const amqpMock = {
    default: {
        connect: mock(() => Promise.resolve(mockConnection)),
    }
};