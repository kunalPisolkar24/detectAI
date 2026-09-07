import { describe, test, expect, mock, beforeEach } from "bun:test";
import { MetricsService } from "@shared/monitoring/MetricsService";

mock.module("@shared/logging/Logger", () => ({
    Logger: { info: mock(), error: mock(), warn: mock() }
}));

const { UsageResetter } = await import("../../../application/services/UsageResetter");

describe("UsageResetter", () => {
    let metricsMock: MetricsService;
    let mockUserRepository: { resetStaleDailyUsage: ReturnType<typeof mock> };

    beforeEach(() => {
        mockUserRepository = {
            resetStaleDailyUsage: mock(() => Promise.resolve(3)),
        };
        metricsMock = {
            jobDuration: { startTimer: mock(() => mock()) },
            jobTotal: { inc: mock() },
            jobErrors: { inc: mock() },
            activeJobs: { inc: mock(), dec: mock() },
        } as unknown as MetricsService;
    });

    test("resets stale rows and records metrics", async () => {
        const resetter = new UsageResetter(mockUserRepository as any, metricsMock, 0);
        const count = await resetter.resetIfDue(1_000);
        expect(count).toBe(3);
        expect(mockUserRepository.resetStaleDailyUsage).toHaveBeenCalled();
        expect(metricsMock.jobTotal.inc).toHaveBeenCalledWith({ job_type: "usage_reset" });
    });

    test("skips when called within min interval", async () => {
        const resetter = new UsageResetter(mockUserRepository as any, metricsMock, 60_000);
        await resetter.resetIfDue(1_000);
        const second = await resetter.resetIfDue(2_000);
        expect(second).toBe(0);
        expect(mockUserRepository.resetStaleDailyUsage).toHaveBeenCalledTimes(1);
    });

    test("retries on next call after failure", async () => {
        mockUserRepository.resetStaleDailyUsage.mockRejectedValueOnce(new Error("db down"));
        const resetter = new UsageResetter(mockUserRepository as any, metricsMock, 60_000);
        await expect(resetter.resetIfDue(1_000)).rejects.toThrow("db down");
        expect(metricsMock.jobErrors.inc).toHaveBeenCalledWith({ job_type: "usage_reset", error_type: "db_error" });

        mockUserRepository.resetStaleDailyUsage.mockResolvedValue(1);
        const retry = await resetter.resetIfDue(2_000);
        expect(retry).toBe(1);
    });
});
