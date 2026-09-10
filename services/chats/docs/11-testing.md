# Testing

Three tiers, same codebase, increasing realism. Use the lightest tier that covers your change.

## Tiers

- **Unit** — No Docker required. Uses mocks for fast feedback on handler and service logic. Run on every commit.
- **Integration** — Requires Docker. Runs against single-node `mongo:7` and `redis:7-alpine` containers to verify end-to-end flows on standalone.
- **HA** — Requires Docker. Reuses the same images with replica set and authentication flags to verify managed HA behavior without hosting Sentinel or mongos.

```ini
unit         -> make test              # fast, every commit
integration  -> make test-integration  # PR
ha           -> make test-ha           # pre-ship
```

## Commands

```bash
make test              # unit, no Docker
make test-coverage     # unit with coverage
make test-integration  # standalone integration, needs Docker
make test-ha           # HA integration, needs Docker
make test-all          # integration + HA
make load-test SCENARIO=smoke VUS=1 DURATION=10s
make load-down
```

See `Makefile` for all targets.

## Unit

Runs without Docker and relies on mocks for isolated validation.

→ [Unit depth](11-testing-unit.md)

## Integration

Runs with Docker against single-node containers.

→ [Integration depth](11-testing-integration.md)

## HA

Runs with Docker using the same images with HA flags to cover managed ElastiCache and DocumentDB paths.

→ [HA depth](11-testing-ha.md)

## Load

Runs with Docker using k6 against isolated containers to validate performance and resilience.

→ [Scenarios and thresholds](../tests/load/README.md)
