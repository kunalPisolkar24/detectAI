import { describe, test, expect, mock } from "bun:test";

const { PrismaUserRepository } = await import("../PrismaUserRepository");

const userModel = (result: { email: string } | null) => ({
    findUnique: mock(() => Promise.resolve(result)),
});

const buildRepository = (reader: any, writer: any) =>
    new PrismaUserRepository(writer, reader, undefined, undefined);

describe("PrismaUserRepository.findUniqueById", () => {
    test("returns the row from the read replica without touching the primary", async () => {
        const reader = { user: userModel({ email: "user@test.com" }) };
        const writer = { user: userModel(null) };
        const repository = buildRepository(reader, writer);

        const found = await repository.findUniqueById("user_1");

        expect(found).toEqual({ email: "user@test.com" });
        expect(reader.user.findUnique).toHaveBeenCalledTimes(1);
        expect(writer.user.findUnique).not.toHaveBeenCalled();
    });

    test("confirms on the primary when the replica has not caught up", async () => {
        // The read replica lags behind the primary, and the replica fallback in
        // PrismaService only covers connection failures. Without the second
        // lookup this would look like a missing user and the caller would
        // dead-letter the event as a permanent failure.
        const reader = { user: userModel(null) };
        const writer = { user: userModel({ email: "user@test.com" }) };
        const repository = buildRepository(reader, writer);

        const found = await repository.findUniqueById("user_1");

        expect(found).toEqual({ email: "user@test.com" });
        expect(reader.user.findUnique).toHaveBeenCalledTimes(1);
        expect(writer.user.findUnique).toHaveBeenCalledTimes(1);
    });

    test("returns null when neither the replica nor the primary has the user", async () => {
        const reader = { user: userModel(null) };
        const writer = { user: userModel(null) };
        const repository = buildRepository(reader, writer);

        const found = await repository.findUniqueById("user_1");

        expect(found).toBeNull();
        expect(writer.user.findUnique).toHaveBeenCalledTimes(1);
    });
});
