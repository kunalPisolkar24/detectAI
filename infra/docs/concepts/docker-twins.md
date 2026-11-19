# Docker Twins

Three compose stacks under `infra/docker/` stand in for the fabrics during local development. They are plain containers: the Terraform root never touches them, and they sit outside the tfctl governed path.

## The twins

| Directory | Image | Host port | State | Role |
|-----------|-------|-----------|-------|------|
| `elasticmq/` | `softwaremill/elasticmq-native:1.7.1` | 9324 (UI 3001) | In memory | SQS stand-in, with a web UI |
| `mongo/` | `mongo:8.0` | 27017 | `mongo_data` volume | Durable document store |
| `redis/` | `redis:8-alpine` | 6379 | None | Ephemeral cache |

Each stack has a healthcheck (`wget` on ElasticMQ, `mongosh ping`, `redis-cli ping`) and `restart: unless-stopped`. The compose files declare no networks or container names, so a service can include them in its own compose stack without collisions.

## The local map

```mermaid
graph TB
    subgraph EQ["infra/docker/elasticmq"]
        E1["elasticmq :9324<br/>in-memory SQS"]
        E2["elasticmq-ui :3001<br/>SQS_ENDPOINT → elasticmq:9324"]
        CONF["elasticmq.conf<br/>queues + redrive"]
        E1 --> E2
        CONF --> E1
    end

    subgraph MO["infra/docker/mongo"]
        M1["mongo :27017"]
        VOL["mongo_data volume"]
        M1 --> VOL
    end

    subgraph RE["infra/docker/redis"]
        R1["redis :6379<br/>no volume"]
    end

    E1 --> SVC["services via<br/>QUEUE_URL / AWS_ENDPOINT_URL_SQS"]
    R1 --> CACHE["services via<br/>REDIS_ENDPOINT / REDIS_AUTH_TOKEN"]
    M1 --> DB["services via<br/>MONGO_URI / MONGO_DATABASE"]
```

The endpoints are environment variables on the service side, so the same binary talks to a twin locally and to a fabric on a plane ([Architecture](architecture.md)).

## One consumer, two destinations

```mermaid
sequenceDiagram
    autonumber
    participant S as service
    participant E as env keys
    participant L as local twin
    participant F as plane fabric

    S->>E: read QUEUE_URL / REDIS_ENDPOINT / MONGO_URI
    alt local endpoints
        E-->>S: localhost ports
        S->>L: read / write
        note over L: no plane, no carrier, no state bucket
    else plane endpoints
        E-->>S: queue URLs / rediss:// / mongodb+srv://
        S->>F: read / write
        note over F: credentials come from the service config plane
    end
```

## Up and down

```mermaid
graph TB
    START(["start: local development"]) --> PORTS["defaults in the twin .env files<br/>or copy an .env.example"]
    PORTS --> UP["docker compose up -d<br/>inside the twin's directory"]
    UP --> HEALTH["healthchecks go green"]
    HEALTH --> USE["services point at the localhost ports"]
    USE --> DOWN["docker compose down"]
    DOWN --> WHICH{"which twin?"}
    WHICH -->|"redis / elasticmq"| LOST["data gone:<br/>cache misses repopulate,<br/>queued messages are dropped"]
    WHICH -->|"mongo"| KEPT["mongo_data volume<br/>keeps the documents"]
    LOST --> END(["end: twin stopped"])
    KEPT --> END
```

## Differences from the fabrics

The twins mirror the service contracts, not the Terraform resources. Know the gaps before trusting a local run:

- **ElasticMQ keeps `contentBasedDeduplication = true`** in `elasticmq.conf`; the Terraform queue sets it to `false` because producers send an explicit `MessageDeduplicationId`. Local runs do not exercise that rule.
- **ElasticMQ does not set retention** in its config — 14-day retention stays IaC-only. Its queues are in memory, so `down`/`up` drops every message.
- **Local Redis has no AUTH token and no encryption**; the fabric serves `rediss://` with a token. The cache is ephemeral either way.
- **Local MongoDB has no SCRAM user or access list**; it is a plain container with a durable volume.
- **There is no Atlas twin.** Use a real M0 cluster or a MongoDB container from a service's own compose stack.

## Next Steps

- **[Fabrics](fabrics.md)** — what each twin stands in for
- **[Configuration](../getting-started/configuration.md)** — the port keys and the plane switch
- **[Quick Start](../getting-started/quickstart.md)** — the governed path instead
