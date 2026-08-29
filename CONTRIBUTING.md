# Contributing to DetectAI

Thank you for contributing. This document describes how to work with this repository, especially with AI-assisted contributions.

## Branching Strategy

We use a promotion model with `dev` as a junction:

```
feat/*  ──►  dev  ──►  staging  ──►  main
             (junction, no CI)   (CI)    (CI + deploy)
```

- **Feature branches** (`feat/*`, `fix/*`, `chore/*`, `docs/*` etc.) always open pull requests against `dev`.
- `dev` is a **junction** - it collects features but **does not run CI** (`service-*.yaml` triggers only on `staging` and `main`). Merge to `dev` requires human review and evidence of local checks.
- **Integration promotion** `dev -> staging` is human-only. This is where CI (`quality-assurance` jobs) runs for the first time.
- **Release promotion** `staging -> main` is human-only and CI-gated. Only staging that is green is promoted.

Branch naming is flexible but must indicate intent. The PR title and commit messages must **not** use prefixes (see next section).

## Title and Description Hygiene

All issue titles, pull request titles, and commit messages must be **clean, coherent sentences with no prefixes**.

| Good | Bad |
|------|-----|
| `Add retry handling for expired paused subscriptions` | `feat(cron): retry expired paused` |
| `Subscription sweep fails for paused accounts after expiry` | `fix(cron): sweep`, `[Bug] sweep fails` |
| `Clean up expired subscription audit fields and tighten sweep batch sizing` | `chore(cron): audit cleanup` |

Rules:
- No `feat:`, `fix:`, `chore:`, `docs:` prefixes.
- No brackets like `[Bug]`, `[Feature]`.
- No ticket codes in the title like `DP-119`. Put references in the body.
- Write in sentence case, imperative or descriptive, specific and outcome-focused.

Pull request and commit bodies should answer **what** changed and **why**, with concrete bullet points under `Changes`.

## AI Agent Guidelines

AI agents (OpenCode, Cursor, Copilot, etc.) are welcome to **create** issues and pull requests but must handle them gracefully.

### What AI may do

- Open issues using the YAML issue forms. Must complete `Deduplication Check` and `Keywords Searched`.
- Open draft pull requests from `feat/*` against `dev` only. Must use the pull request template.
- Rebase on latest `dev` before marking ready for review.

### What AI must not do

- Never open `dev -> staging` or `staging -> main` pull requests.
- **Never merge** any pull request. All merges are human-only.
- Never bypass the pull request template or open blank issues.
- Never commit secrets, env files, or credentials.

### Required hygiene for AI

1. **Search before create.** Check open and closed issues and pull requests for the same keywords. If a duplicate exists, comment there instead.
2. **Idempotency.** Set `Idempotency Key` in issues (`agent:<name>-<YYYYMMDD>-<short-hash>` or task ID) so reruns do not create duplicates.
3. **Disclosure.** Fill `Agent Disclosure` in issues and `AI Disclosure` in pull requests: agent name, model, task or prompt ID, human approver.
4. **Labels.** Add `agent-generated` and `needs-human-review` where possible, or note it in the body if labels cannot be set.
5. **One task, one PR.** Do not bundle unrelated changes. Do not open more than one PR for the same issue without closing the prior one.
6. **Draft first.** Open as draft, wait for human conversion to ready.
7. **Clean titles.** AI output must also follow the no-prefix rule.

### Handling duplicates gracefully

If an AI run is retried, it should:
- Check for an existing open issue or PR with the same idempotency key or keywords and reuse it.
- If a PR already exists for the task, push to that branch instead of opening a new one.
- If a human closed a duplicate, do not reopen it automatically.

## Local Verification (required for feat -> dev)

Since `dev` does not run CI, the author must provide evidence in the PR under `Testing`:

- For `apps/web`: `pnpm lint`, `pnpm test:run`, `pnpm build` (with dummy env as in `service-web.yaml`).
- For services: relevant `make` targets, `pytest`, or `go test` as applicable, plus `docker build` if Dockerfile changed.
- Describe manual verification steps.

`dev -> staging` and `staging -> main` will be gated by CI. A green CI on the target branch is required for human merge.

## Pull Request Process

1. Fork or create a feature branch from `dev`.
2. Create a pull request against `dev` using the template. Fill `Promotion Path`, `Related Issue`, `Description`, `Changes`, `Testing`, and `AI Disclosure` if applicable.
3. Ensure the title is a clean sentence with no prefix.
4. Request review. All PRs require a human maintainer approval via `CODEOWNERS`.
5. A human merges. AI must not merge.

## Code of Conduct

Be respectful, search before opening, and keep the history coherent.
