# Authentication

## Flow

```mermaid
sequenceDiagram
    participant C as Client
    participant A as AuthInterceptor
    participant H as Handler
    C->>A: gRPC metadata {authorization, x-api-key}
    alt x-api-key == API_KEY
        A->>H: bind auth_type=api_key user_id=internal_service
    else Bearer token
        A->>A: strip Bearer, len<=8192
        A->>A: jwt.decode HS256 require exp+sub
        alt valid sub
            A->>H: bind auth_type=jwt user_id=sub
        else expired
            A-->>C: UNAUTHENTICATED Token expired
        else invalid/missing
            A-->>C: UNAUTHENTICATED Invalid or missing Bearer token
        end
    else missing
        A-->>C: UNAUTHENTICATED
    end
```

Code at `src/adapters/inbound/grpc/interceptors.py:36`.

* Health `grpc.health.v1.Health/Check|Watch` bypasses auth (`_HEALTH_METHODS`).
* `x-api-key` is constant-time compared to `settings.API_KEY` (16+ chars, from `API_KEY` or `AI_SERVICE_API_KEY`).
* `Bearer` requires `HS256` with `exp` and `sub` claims; `_MAX_TOKEN_LEN=8192` prevents DoS, `_MAX_SUB_LEN=128`, `_MAX_TRACE_ID_LEN=128`.

## Context

On success, interceptor binds via `structlog.contextvars`:

```python
bind_contextvars(auth_type="jwt"|"api_key", user_id=sub, trace_id=...)
```

`MonitoringInterceptor` (outer) ensures auth failures are still counted in `grpc_requests_total`.

## Failure metrics

```text
grpc_auth_failures_total{method, reason}
  reason: missing_or_invalid_token | token_expired
```

Logs use `_truncate` to avoid injection; `Authorization` header never logged.

## Client example

```bash
# API key (internal)
grpcurl -H "x-api-key: $AI_SERVICE_API_KEY" ...

# JWT (load tests)
TOKEN=$(python load/scripts/generate_token.py --secret $AI_SERVICE_API_KEY)
grpcurl -H "authorization: Bearer $TOKEN" ...
```

`load/scripts/generate_token.py` builds `sub=k6-load-tester`, `iat` now, `exp=+3600s`.

## Class view

```mermaid
classDiagram
    class AuthInterceptor {
        -_HEALTH_METHODS
        +intercept_service()
        -build_unauthenticated_handler()
    }
    class MonitoringInterceptor {
        +intercept_service()
        -resolve_trace_id()
        -resolve_model_label()
        -record_metrics()
    }
    class GRPCServer {
        -interceptors: [Monitoring, Auth]
        +start()
    }
    GRPCServer --> MonitoringInterceptor
    GRPCServer --> AuthInterceptor
    MonitoringInterceptor ..> AuthInterceptor : outer wraps inner
```

Order matters: `MonitoringInterceptor` outer → auth failures still observed.
