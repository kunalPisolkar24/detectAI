# Preview Mode

Run the frontend without any backend services (DB, Redis, gRPC, Turnstile, Paddle, RabbitMQ). All integrations are mocked; chats persist in the browser via IndexedDB (Dexie), inference is simulated in-memory.

Single flick: `PREVIEW=true`. When set, `lib/config/env.ts` skips validation
and resolves every other variable to canned preview defaults (passed-in values
are ignored), so no real credentials are needed. The `Dockerfile`, compose
file, makefile, and `pnpm preview:*` scripts derive the legacy `PREVIEW_MODE`
/ `NEXT_PUBLIC_PREVIEW_MODE` flags from this switch — set `PREVIEW` and
nothing else.

Flags: `PREVIEW=true` (canonical switch)
+ `NEXT_PUBLIC_PREVIEW_MODE=true` (build-time, inlined for the browser bundle)
+ `PREVIEW_MODE=true` (runtime, read on the server). The last two are derived
automatically; the server check uses the runtime flag so `next start` does not
crash even if `.next` is stale.

## What is mocked in preview

- **Auth** – Credentials accept any valid email/password (no DB, no bcrypt). Google/GitHub buttons are disabled with tooltip `Not available in preview mode`. Turnstile uses Cloudflare test keys (`1x...AA`) that always pass – widget still renders and must be ticked.
- **Chat persistence** – `features/preview/lib/preview-db.ts` (Dexie `preview-db` with `chats`/`messages` tables). `features/chat/services/mock-chat-service.ts` implements `IChatService` on top of it. `components/chat` hooks check `isPreviewModeClient()` and read/write Dexie directly; `services/index.ts` returns `MockChatService` on the server as well (in-memory fallback for SSR).
- **Inference** – `features/preview/lib/mock-inference.ts` (`generateMockAnalysis` + `mockStreamDocument`). `/api/chat/analyze/stream` returns a synthetic NDJSON stream (`accepted → started → progress×n → final`) and `features/chat/hooks/use-chat-mutation.ts` drives the same UI state as production, including cancel.
- **Document parsing** – `extractTextFromFile` returns `{ error: "Document parsing is not available in preview mode" }`; attach button (`chat-input.tsx`) is disabled and wrapped in `Tooltip` with the same message.
- **Payments** – No `initializePaddle` / `Checkout.open`. `UpgradeView` opens a local `AlertDialog` ("Are you sure you want to upgrade?") → writes `localStorage preview:isPremium=true` → `updateSession({isPremium:true})` → `router.push("/chat")`. `confirmUpgradeAction`/`cancelSubscriptionAction`/`updateProfileAction` early-return success in preview. `Profile/page.tsx` renders a static preview user; `ProfileView`/`BillingTab` read `preview:isPremium` from localStorage and expose a local downgrade.
- **Rate limiting / analytics / metrics / infra** – `prisma.ts`/`redis.ts`/`redis-limit.ts`/`grpc-client.ts`/`chat-client.ts`/`analytics-publisher.ts` all return no-op proxies when preview so imports don’t crash even with dummy env. `app/(main)/chat/page.tsx` skips `rateLimitService.checkLimit`.
- **Notices** – `features/preview/components/preview-mode-dialog.tsx` dialog on `/login` & `/signup` (“any credentials work”) and on `/chat`/`/profile`/`/upgrade` when authenticated. Checkbox writes `preview:dontShowNotice`.
- **Model gating** – `Flare` stays locked until mock premium, mirroring production.

## Option A — Bare metal (no Docker)

Requires Node 20 + pnpm 9. Start-only (no dev/HMR preview mode).

```bash
cd apps/web
pnpm install

# Production build + serve (single flick lives in the scripts)
pnpm preview:build
pnpm preview:start
# → http://localhost:3000
```

Scripts set internally (from the single switch):
```
PREVIEW=true
PREVIEW_MODE=true
NEXT_PUBLIC_PREVIEW_MODE=true
NEXT_PUBLIC_TURNSTILE_SITE_KEY=1x00000000000000000000AA
TURNSTILE_SECRET_KEY=1x00000000000000000000AA
NEXTAUTH_SECRET=preview-secret-for-local-dev-only-32chars
NEXTAUTH_URL=http://localhost:3000
NEXT_PUBLIC_PADDLE_CLIENT_TOKEN=dummy
```

> `preview:start` alone requires a prior `preview:build` — the browser bundle
> inlines `NEXT_PUBLIC_PREVIEW_MODE` at build time. If you previously ran a
> regular `pnpm build`, rebuild with `pnpm preview:build` first or the UI
> will not show preview behavior (server is runtime-safe via `PREVIEW`).

Storage: chats live in `indexedDB` → `preview-db`. Clearing site data resets history. `preview:isPremium` and `preview:dontShowNotice` are in `localStorage`.

## Option B — Docker (no local Node)

Standalone image, no `db`/`redis`/`ai-service`/`chat-service`/`document-parser`/`payment-gateway`/`rabbitmq` dependencies. Single flick via `infra/.env.preview`.

```bash
cd apps/web

# Build and run preview frontend only (production standalone)
make preview
# → http://localhost:3000

# Stop and remove
make preview-down
```

`make preview` runs `docker compose --env-file infra/.env.preview -f infra/compose.yml up --build --no-deps frontend`: same unified compose file as the real stack, but only the frontend starts (backends skipped, no separate compose file). Canned values live in `infra/.env.preview` and in code (`lib/config/env.ts`); passed-in values are ignored when `PREVIEW=true`.

## Switching back to normal mode

- Bare: `pnpm dev` / `pnpm build && pnpm start` (ensure real `.env` with `DATABASE_URL`, `NEXTAUTH_SECRET`, `REDIS_*`, `AI_SERVICE_URL`, `CHAT_SERVICE_URL`, `FILE_EXTRACTOR_API_URL`, `RABBITMQ_URL`, `GOOGLE_ID/SECRET`, `GITHUB_ID/SECRET`, `TURNSTILE_*`, `PADDLE_*`).
- Docker: `make start` (requires real `apps/web/.env`; fails fast if missing). To also spin up standalone postgres + user redis: `make start WITH_DATA=1` (merges `infra/docker/data/compose.yml`; same flag on `down`/`clean` includes the data containers). Minimal datastore section for that mode:

```
DATABASE_URL=postgresql://user:password@postgres:5432/detect_ai
DATABASE_URL_REPLICA=postgresql://user:password@postgres:5432/detect_ai
REDIS_MODE=standalone
REDIS_URL=redis://:user_cache_password@redis-app:6379
REDIS_PASSWORD=user_cache_password
REDIS_USAGE_URL=redis://:user_cache_password@redis-app:6379
RABBITMQ_URL=amqp://guest:guest@rabbitmq:5672/
```

(`REDIS_USAGE_URL` points at the same instance until a dedicated analytics redis exists; `RABBITMQ_URL` must be set for validation — without a broker, analytics publishes are logged and dropped. Backend URLs `AI_SERVICE_URL`, `CHAT_SERVICE_URL`, `FILE_EXTRACTOR_API_URL`, `PAYMENT_GATEWAY_URL` come from the root local stack or the services' own composes.)

Note: preview flag is **build-time**. Switching requires a rebuild (`pnpm preview:build` or `make preview`, which builds).

## Verification checklist

- Login/signup with arbitrary email/password succeeds; OAuth buttons disabled with tooltip; Turnstile widget visible and must be ticked (test keys).
- After login, visiting `/chat` shows preview dialog once; “Don’t show again” suppresses it.
- Sending a message creates chat in sidebar, streams progress card, completes with mock highlights; reload persists chats (Dexie); delete/rename from sidebar works; cancel during streaming marks `cancelled`.
- Attach file button disabled with tooltip; hover shows “Not available in preview mode”.
- `Flare` model shows “Upgrade” badge when not premium; `/upgrade` shows local confirm dialog instead of Paddle overlay; confirm upgrades to `isPremium` (user menu hides Upgrade Plan, chat input unlocks Flare); `/profile` billing tab shows downgrade flow.
- `pnpm lint && pnpm test:run && pnpm test:integration:backend` green in non-preview; `pnpm preview:build` succeeds.
