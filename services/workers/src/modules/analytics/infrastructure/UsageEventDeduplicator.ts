import { type RedisClient } from "@shared/cache/RedisClient";
import { Logger } from "@shared/logging/Logger";

const DEFAULT_TTL_SECONDS = 7 * 24 * 60 * 60;

/**
 * Marks usage events as seen via SET NX so redelivered messages are not
 * counted twice. Fails open: if Redis is unavailable the event is treated
 * as new, preserving availability at the cost of a possible double count.
 */
export class UsageEventDeduplicator {
    constructor(
        private readonly redis: RedisClient,
        private readonly ttlSeconds: number = DEFAULT_TTL_SECONDS,
        private readonly prefix: string = "analytics:usage:event:"
    ) {}

    /** Returns true when this caller owns processing; false for already-seen events. */
    async tryBegin(eventId: string): Promise<boolean> {
        if (!eventId || typeof eventId !== "string" || !eventId.trim()) {
            return true;
        }
        try {
            const result = await this.redis.set(
                `${this.prefix}${eventId}`,
                "1",
                "EX",
                this.ttlSeconds,
                "NX"
            );
            return result === "OK" || (result as unknown) === 1;
        } catch (error) {
            Logger.warn("Usage event dedup check failed; treating event as new", { eventId, error });
            return true;
        }
    }

    async release(eventId: string): Promise<void> {
        if (!eventId || !eventId.trim()) return;
        try {
            await this.redis.del(`${this.prefix}${eventId}`);
        } catch (error) {
            Logger.warn("Failed to release usage dedup claim", { eventId, error });
        }
    }
}
