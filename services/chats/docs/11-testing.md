# Testing

## Commands

```bash
make test              # unit, no Docker
make test-coverage     # with coverage
make test-integration  # standalone integration, needs Docker
make test-ha           # HA integration, needs Docker
make test-all          # both integration + HA
make load-test SCENARIO=smoke VUS=1 DURATION=10s
make load-down
```

See `Makefile` for all targets.

## Unit

No Docker. Uses mocks.

→ [Unit depth](11-testing-unit.md)

## Integration

Needs Docker. `make test-integration`.

→ [Integration depth](11-testing-integration.md)

## HA

Needs Docker. `make test-ha`.

→ [HA depth](11-testing-ha.md)

## Tiers

```ini
unit         -> make test              # fast, every commit
integration  -> make test-integration  # PR, standalone
ha           -> make test-ha           # pre-ship, HA
```

- **Unit** — no Docker, mocks only.
- **Integration** — single-node containers.
- **HA** — same containers with HA flags, validates managed HA behavior.

## Load

See [load tests](../tests/load/README.md).
