# AGENTS.md

Guidelines for AI and human contributors working in this repo.

## Repo Map

Monorepo. Stay inside the component you were asked to change.

- `apps/web` — Next.js 15 frontend, BFF, auth, UI (`features/`, `lib/`, `infra/`)
- `services/chats` — Go gRPC chat service (`internal/core`, `internal/adapters`)
- `services/payments/gateway` — Go webhook gateway
- `services/inference` — Python gRPC model serving (`src/domain`, `src/application`, `src/adapters`, `src/infrastructure`)
- `services/document-parser` — Python FastAPI text extraction (`app/`)
- `services/workers` — TypeScript background workers (`src/modules`, `src/shared`)
- `infra/terraform` — AWS infrastructure as code
- `tools/` — one-off CLIs (`model-publisher`, `seed-secrets`)

Do not cross service boundaries or share code between services except through explicit APIs or contracts.

## Clean Architecture

Dependencies point inward only. Outer layers may depend on inner layers, never the reverse.

- `apps/web`: UI components render only. Data access and external calls live in `lib/` or `infra/`. No SQL, Prisma, or `fetch` inside `components/` or `features/*/components`.
- `services/chats`: `internal/core` holds business rules with no Mongo, Redis, or gRPC imports. All I/O lives in `internal/adapters`.
- `services/inference`: `domain` has no I/O. `application` holds use cases. `adapters` and `infrastructure` hold ONNX, HuggingFace, and transport code.
- `services/workers`: one folder per bounded context under `src/modules`. Shared helpers go in `src/shared`.

## SOLID and Design Patterns

- Single responsibility: one module, function, or class does one thing.
- Open-closed: extend with new modules or strategies, do not edit stable core paths.
- Liskov substitution: implementations must honor the interface contract without extra preconditions.
- Interface segregation: small focused interfaces over broad ones.
- Dependency inversion: inner layers define interfaces, outer layers implement them. Wire implementations at startup.

Preferred patterns: Dependency Injection, Repository/Adapter, Factory, Strategy, Middleware. Do not introduce a new abstraction for a single use case. Prefer composition over inheritance.

## Code Quality

- Follow the existing layout and naming in the component you touch.
- Keep functions small with explicit inputs and outputs. Handle errors at boundaries and propagate typed errors.
- Reuse existing validation, logging, and observability helpers instead of adding new ones.
- Verify locally before opening a PR since `dev` runs no CI:
  - Web: `pnpm lint`, `pnpm test:run`, `pnpm build`
  - Go: `go vet ./...`, `go test ./...`, `docker build` if Dockerfile changed
  - Python: `pytest`, `ruff check`, `docker build` if Dockerfile changed
  - Terraform: `make tf-fmt`, `make tf-validate`

## Comments

Write self-explanatory code. Add a comment only when the why is not obvious from the code. Never add commented-out code or restate the signature in a docstring.

## Commits and Pull Requests

Commits are one line. Pull request titles are one line. Both use clean sentences with no prefixes.

- No `feat:`, `fix:`, `chore:`, or `docs:` prefixes.
- No brackets like `[Bug]` or `[Feature]`.
- No ticket codes in the title. Put references in the body.
- Use sentence case, specific and outcome-focused.

Good: `Add retry handling for expired paused subscriptions`
Bad: `feat(cron): retry expired paused`

PR body answers what changed and why, plus testing evidence under `Testing`.

## Agent Workflow

See `CONTRIBUTING.md` for the full branching model.

- Create feature branches from `dev` and open pull requests against `dev` only.
- Never open `dev -> staging` or `staging -> main` pull requests. Never merge any pull request.
- Search open and closed issues and PRs before creating new ones.
- One task, one PR. Open as draft and wait for human review.
- Never commit secrets, env files, or credentials.
