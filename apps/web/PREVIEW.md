# Preview Mode

Run the frontend without any backend services (DB, Redis, gRPC, Turnstile, Paddle, RabbitMQ). All integrations are mocked; chats persist in the browser via IndexedDB (Dexie), inference is simulated in-memory.

Flag: `NEXT_PUBLIC_PREVIEW_MODE=true` (build-time, inlined by Next.js).

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

Requires Node 20 + pnpm 9.

```bash
cd apps/web
pnpm install

# Development (HMR, inlined preview flag + test Turnstile keys)
pnpm preview:dev
# → http://localhost:3000

# Production build + serve (two steps or via compose)
pnpm preview:build
pnpm preview:start
```

Scripts set internally:
```
NEXT_PUBLIC_PREVIEW_MODE=true
NEXT_PUBLIC_TURNSTILE_SITE_KEY=1x00000000000000000000AA
TURNSTILE_SECRET_KEY=1x00000000000000000000AA
NEXTAUTH_SECRET=preview-secret-for-local-dev-only-32chars
NEXTAUTH_URL=http://localhost:3000
SKIP_ENV_VALIDATION=true
```

To use a custom `.env`, copy `.env.preview.example` to `.env` and adjust `NEXTAUTH_SECRET`/`NEXTAUTH_URL`.

Storage: chats live in `indexedDB` → `preview-db`. Clearing site data resets history. `preview:isPremium` and `preview:dontShowNotice` are in `localStorage`.

## Option B — Docker (no local Node, no compose dev stack)

Standalone image, no `db`/`redis`/`ai-service`/`chat-service`/`document-parser`/`payment-gateway`/`rabbitmq` dependencies.

```bash
cd apps/web

# Build and run preview frontend only (production standalone)
docker compose -f compose.preview.yml up --build
# → http://localhost:3000

# Stop and remove
docker compose -f compose.preview.yml down

# Rebuild after code changes
docker compose -f compose.preview.yml up --build --force-recreate
```

`compose.preview.yml` builds `Dockerfile` with `ARG NEXT_PUBLIC_PREVIEW_MODE=true` (so the client bundle is preview) and runs with `SKIP_ENV_VALIDATION=true` plus dummy `DATABASE_URL`/`REDIS`/`RABBITMQ` values. No `depends_on`.

## Switching back to normal mode

- Bare: `pnpm dev` / `pnpm build && pnpm start` (ensure real `.env` with `DATABASE_URL`, `NEXTAUTH_SECRET`, `REDIS_*`, `AI_SERVICE_URL`, `CHAT_SERVICE_URL`, `FILE_EXTRACTOR_API_URL`, `RABBITMQ_URL`, `GOOGLE_ID/SECRET`, `GITHUB_ID/SECRET`, `TURNSTILE_*`, `PADDLE_*`).
- Docker dev stack: `make dev` / `docker compose -f compose.yml -f compose.dev.yml up -d` (as in root README).

Note: preview flag is **build-time**. Switching requires a rebuild (`pnpm preview:build` or `docker compose -f compose.preview.yml up --build`).

## Verification checklist

- Login/signup with arbitrary email/password succeeds; OAuth buttons disabled with tooltip; Turnstile widget visible and must be ticked (test keys).
- After login, visiting `/chat` shows preview dialog once; “Don’t show again” suppresses it.
- Sending a message creates chat in sidebar, streams progress card, completes with mock highlights; reload persists chats (Dexie); delete/rename from sidebar works; cancel during streaming marks `cancelled`.
- Attach file button disabled with tooltip; hover shows “Not available in preview mode”.
- `Flare` model shows “Upgrade” badge when not premium; `/upgrade` shows local confirm dialog instead of Paddle overlay; confirm upgrades to `isPremium` (user menu hides Upgrade Plan, chat input unlocks Flare); `/profile` billing tab shows downgrade flow.
- `pnpm lint && pnpm test:run && pnpm test:integration:backend` green in non-preview; `pnpm preview:build` succeeds.
