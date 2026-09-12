-- Sweep NULL-data audit (issues #189 and #198)
--
-- Run these against a PROD REPLICA before relying on the defensive
-- behaviour shipped in feat/cron-lifecycle-semantics. Both code paths
-- already exclude these rows; the queries confirm whether any exist.

-- #189: legacy rows with no status. NULL = never billable, never swept.
SELECT count(*) FROM "Subscription" WHERE status IS NULL;
SELECT count(*) FROM "Subscription" WHERE status IS NULL AND "endsAt" < NOW();

-- If non-zero, decide between:
--   a) keep lifetime semantics for NULL status rows (no action), or
--   b) terminalize them:
-- UPDATE "Subscription" SET status = 'CANCELED' WHERE status IS NULL AND "endsAt" < NOW();

-- #198: rows with no endsAt are treated as lifetime premium and never swept.
SELECT count(*) FROM "Subscription"
WHERE "endsAt" IS NULL
  AND status IN ('ACTIVE', 'TRIALING', 'PAST_DUE', 'PAUSED');

-- If non-zero, decide whether each is genuinely lifetime or bad webhook data.
-- Suspect rows can be listed with:
SELECT u.id, u.email, s.status, s."paddleSubscriptionId", s."createdAt"
FROM "Subscription" s JOIN "User" u ON u.id = s."userId"
WHERE s."endsAt" IS NULL
  AND s.status IN ('ACTIVE', 'TRIALING', 'PAST_DUE', 'PAUSED')
ORDER BY s."createdAt" ASC;
