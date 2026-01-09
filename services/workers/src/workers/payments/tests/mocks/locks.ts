import { mock } from "bun:test";

export const mockRelease = mock(() => Promise.resolve());
export const mockAcquire = mock(() => Promise.resolve(mockRelease));

export const lockMock = {
    LockService: {
        acquire: mockAcquire
    }
};