import { mock } from "bun:test";

export const mockAck = mock();
export const mockNack = mock();
export const mockConsume = mock();
export const mockAssertQueue = mock(() => Promise.resolve());
export const mockAssertExchange = mock(() => Promise.resolve());
export const mockBindQueue = mock(() => Promise.resolve());
export const mockPrefetch = mock(() => Promise.resolve());
export const mockOn = mock();
export const mockPublish = mock(() => true);
export const mockCancel = mock(() => Promise.resolve());

export const mockChannel = {
    assertQueue: mockAssertQueue,
    assertExchange: mockAssertExchange,
    bindQueue: mockBindQueue,
    prefetch: mockPrefetch,
    consume: mockConsume,
    ack: mockAck,
    nack: mockNack,
    publish: mockPublish,
    cancel: mockCancel,
    close: mock(() => Promise.resolve()),
    on: mock(() => {}),
};

export const mockConnection = {
    createChannel: mock(() => Promise.resolve(mockChannel)),
    on: mockOn,
    close: mock(() => Promise.resolve()),
};

export const amqpMock = {
    default: {
        connect: mock(() => Promise.resolve(mockConnection)),
    }
};
