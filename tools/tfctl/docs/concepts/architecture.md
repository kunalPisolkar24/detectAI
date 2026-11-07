# Architecture

This document explains how one `tfctl` invocation becomes a governed AWS change. Read the [quick start](../getting-started/quickstart.md) first if you have never run the tool.

## What this engine is

A stack-agnostic CLI that drives any declared stack kind by kind: validate its values file, terraform-plan/apply its stack, and tear it down. Two kinds are registered today — **secrets** (per service: a declared `secrets.toml` plus values in `infra/.env`, verified against the live plane) and **observability** (per stack dir: an `observability.toml` plus values in `envs/.env`, the New Relic-as-code root) — and the registry is the only seam between the engine and them ([Kinds](kinds.md)). The engine contributes everything else: verb dispatch, the carrier, the state machinery, the shell runners.

Both out-of-stack prerequisites are created on demand and converged every run: the state bucket (terraform's ledger) and the seeder carrier role every verb rides ([Carrier](carrier.md)). There is no bootstrap command to run first for the secrets kind — there is nothing to bootstrap to; the observability kind's `bootstrap` verb heals the same ledger for its stack-dir plane.

## The module map

```
tools/tfctl/
├── app/
│   ├── main.py          verb dispatch: flag guards, stack resolution, kind wiring
│   ├── engine/          kind-agnostic machinery: carrier, stack, values, shell runners
│   ├── kinds/           the registry; the secrets and observability kinds (declaration schemas, verb flows)
│   └── __main__.py      python -m app
├── tests/               unit (default) + integration (live Floci)
└── mk/                  make fragments: install, lint, test tiers
```

Shape in toml, values in the `.env`, engine in one package: `main.py` is the composition root *by being the caller* — every kind registers its slot there, and each verb's mechanics live in its own subpackage.

## How one invocation flows

```mermaid
graph LR
    START(["start: tfctl …"]) --> GUARD{"flag guards"}
    GUARD -->|"misplaced flag"| GUARDERR["error + fix line<br/>e.g. --purge-state<br/>only with destroy"] --> HALT(["end: exit 1"])
    GUARD -->|"clean"| WHICH{"which verb?"}
    WHICH -->|"session-clear-all"| CLEARALL["delete every cached<br/>session file"] --> DONE(["end: exit 0"])
    WHICH -->|"session-refresh-all"| REFRESH["the batch verb:<br/>every ready service"] --> DONE
    WHICH -->|"session-clear"| CLEARS["delete this stack's<br/>cache file"] --> DONE
    WHICH -->|"single-stack"| FIND{"--service or --stack-dir?"}
    FIND -->|"--stack-dir"| DIR["the named stack dir,<br/>taken as given"]
    FIND -->|"--service"| DIR["the named service dir,<br/>anchored to the repo root"]
    FIND -->|"neither"| NEAR["nearest declaration file<br/>upward from cwd"]
    DIR --> LOAD{"declaration<br/>loads?"}
    NEAR --> LOAD
    LOAD -->|"no"| TOMLERR["error: <declaration> — …<br/>fix the declaration"] --> HALT
    LOAD -->|"yes"| ENV{"env file present,<br/>valid for this verb?"}
    ENV -->|"no"| ENVERR["named error + fix line"] --> HALT
    ENV -->|"yes"| VERB{"verb"}
    VERB -->|"seeder-drop"| DROP["detach the policy,<br/>delete the role<br/>(no carrier session)"] --> DONE
    VERB -->|"verify"| CAR2["carrier resolve<br/>read-only verbs ride it too"]
    CAR2 --> VERIFY["fingerprint audit flow"] --> DONE
    VERB -->|"plan / apply / destroy"| CAR1["carrier resolve:<br/>converge role,<br/>cached or assumed"]
    VERB -->|"auto-apply"| CAR1
    VERB -->|"check"| DIRECT["no state, no terraform:<br/>the kind's own flow"] --> DONE
    CAR1 --> TF["terraform verb flow<br/>auto-apply: plan → apply → verify"] --> DONE
```

Three details the flow hides:

- **Verb families.** Two verbs never touch a stack at all (`session-clear-all`, `session-refresh-all` — they walk all services), one verb needs only the declaration (`session-clear` deletes its stack's cache file without touching any values), and the rest are single-stack verbs.
- **Validation depth varies by verb.** Terraform-writing verbs run the [full value ladder](values.md); verify and `seeder-drop` run only the region check, because they must be able to comment on a plane even when a value is misedited.
- **Dry runs are stakeouts, not executions.** `--dry-run` resolves no carrier session, prompts for nothing, runs no terraform. What it prints is verb-shaped: the full banner plus backend overrides and exact commands on the terraform verbs, the three read-only aws commands on `verify`, the would-refresh list on the batch verb.
- **Each kind owns its verb shapes.** `check`/`bootstrap` are the observability kind's own flows (no terraform for check, the state bucket alone for bootstrap); the terraform verbs and `verify`/`auto-apply` are the secrets kind's shapes. The registry decides which shapes a stack gets.

## What a verb run looks like end to end

```mermaid
sequenceDiagram
    autonumber
    participant U as you
    participant E as tfctl
    participant A as aws CLI
    participant T as terraform

    U->>E: tfctl --service document-parser apply
    E->>E: flag guards, find + parse secrets.toml, parse + validate .env
    E->>A: sts get-caller-identity (ambient creds)
    A-->>E: the caller becomes the trust principal
    E->>A: converge the service's seeder role<br/>(create, re-anchor, cap, policy)
    E->>A: sts assume-role (MFA prompt on real AWS, the cached triplet rides silently)
    A-->>E: 12-hour seeder session
    E->>A: head-bucket on the derived state bucket (create + version it if missing)
    E->>T: init -reconfigure with the composed backend file, then apply
    T-->>U: plan output → confirm (real AWS) / auto (emulator)
    E-->>U: exit 0 — the plane holds the values, and verify can prove it
```

## Credentials: three sources, clear precedence

| Source | Used when | Where it travels |
|--------|-----------|------------------|
| Carrier triplet (assumed seeder session) | every plane-writing verb on both planes | env overlay on the subprocess; env creds outrank profiles, `AWS_PROFILE` is stripped |
| Ambient credentials (env/profile/SSO) | identity resolution, role convergence, `seeder-drop`, and the real-AWS assume itself | the untouched process environment |
| Emulator fakes (`test`/`test`) | session-less emulator calls (trust resolution, `seeder-drop`) | env overlay on the subprocess |

Nothing is ever written to your `~/.aws` credentials; the cache is the session file in the tool tree only.

## The engine's output contract

Every failure is shaped before it is printed — a `error:` line with a `fix:` line, both human sentences:

```text
error: could not assume arn:aws:iam::123456789012:role/detectai-document-parser-seeder
fix:   check the MFA code and that the seeder role trusts your caller (...details...)
```

| Marker | Means |
|--------|-------|
| `error:` + `fix:` | the run stops; you are told exactly what to type next |
| `note:` | reality logged without opinion (ignored legacy keys, healed buckets, assumed-role substitutions) |
| `warning:` | the run continues but you probably want to look (dev-on-realAWS, window 0) |
| `ok:` / `fail:` | verify's verdict lines |
| `running:` / `created:` / `removed:` | the subprocess narration: each line names exactly what was run, made, or taken away |

Secret values never print — keys appear as `KEY *** (22 chars, hidden)` and comparisons as **lengths and fingerprints** (first 12 hex of a SHA-256). Exit codes are contract too: `0` success, `1` any typed failure, `130` Ctrl+C (prints *interrupted: rerun the same verb when ready; terraform writes are atomic per run*), and EOF at any prompt reads as *cancelled* with exit 1.

## Next Steps

- **[Declaration](declaration.md)** and **[Values](values.md)** — the two inputs every verb above reads
- **[Carrier](carrier.md)** — the resolve step in full: trust ladder, MFA, caching
- **[The terraform lifecycle](../guides/terraform-lifecycle.md)** — the verb flows themselves
