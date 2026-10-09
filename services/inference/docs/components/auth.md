# Authentication

This document explains how the Inference service authenticates requests and how you can authenticate your API calls.

## What is Authentication?

Authentication is the process of verifying who you are. The Inference service needs to know you're allowed to use it before it will analyze your text.

## Why Authentication Matters

- **Security** - Prevents unauthorized use of the service (it listens on an open port with no TLS of its own)
- **Usage tracking** - Binds `auth_type` and `user_id` (the JWT `sub`) to logs and traces
- **Audit trail** - Metrics record who failed and why via `grpc_auth_failures_total`

> The service does not implement rate limiting itself — it relies on callers and network-level controls for that.

## Authentication Methods

The service supports two authentication methods:

### Method 1: API Key (Internal Services)

API keys are simple strings used for internal service-to-service communication.

```bash
# Pass API key in x-api-key header (the service's own env var is API_KEY;
# AI_SERVICE_API_KEY is a legacy alias that holds the same value)
grpcurl -H "x-api-key: $API_KEY" \
  -d '{"text": "Hello world"}' \
  localhost:50051 aidetection.AIService/Detect
```

**How it works:**
1. Client sends `x-api-key` header
2. Service compares it to the configured `API_KEY`
3. If match, request proceeds with `auth_type=api_key`
4. If no match, the request falls through to the Bearer check and then returns `UNAUTHENTICATED`

**Requirements:**
- API key must be at least 16 characters (enforced at startup)
- Never logged (security)

### Method 2: JWT Token (Load Tests, External Clients)

JWT (JSON Web Token) tokens are used for more complex authentication scenarios.

```bash
# Generate a JWT token
TOKEN=$(python load/scripts/generate_token.py --secret $API_KEY)

# Pass JWT in authorization header
grpcurl -H "authorization: Bearer $TOKEN" \
  -d '{"text": "Hello world"}' \
  localhost:50051 aidetection.AIService/Detect
```

**How it works:**
1. Client sends `authorization: Bearer <token>` header
2. Service validates the JWT:
   - Uses HS256 algorithm
   - Checks `exp` (expiration) claim
   - Checks `sub` (subject) claim
3. If valid, request proceeds with `auth_type=jwt` and `user_id=sub`
4. If invalid or expired, returns `UNAUTHENTICATED`

**Requirements:**
- Token must be HS256 signed
- Must have `exp` and `sub` claims
- Maximum token length: 8192 characters (prevents DoS)
- Maximum `sub` length: 128 characters

## Authentication Flow

`MonitoringInterceptor` wraps `AuthInterceptor`, so metrics and trace IDs are recorded even for rejected requests. The diagram below zooms in on the auth step:

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

## Health Check Bypass

The health check endpoint (`grpc.health.v1.Health/Check` and `Watch`) bypasses authentication. This allows load balancers and monitoring systems to check service health without credentials.

## Context Binding

On successful authentication, the service binds context variables for logging and tracing:

```python
bind_contextvars(auth_type="jwt"|"api_key", user_id=sub, trace_id=...)
```

## Failure Metrics

Failed authentication attempts are tracked:

```
grpc_auth_failures_total{method, reason}
  reason: missing_or_invalid_token | token_expired
```

## Generating JWT Tokens

The service includes a token generator for load testing:

```bash
# Generate a token with default settings
python load/scripts/generate_token.py --secret $API_KEY

# Output: eyJhbGciOiJIUzI1NiIs...
```

**Token details:**
- `sub`: `k6-load-tester`
- `iat`: Current time
- `exp`: Current time + 3600 seconds (1 hour)
- Algorithm: HS256

## Security Notes

- `Authorization` header is never logged
- Log values are truncated to prevent injection
- The API key is a high-entropy shared secret compared with a direct string equality check in `AuthInterceptor`
- JWT tokens have length limits (8192 chars) to prevent DoS

## Troubleshooting

### "UNAUTHENTICATED" Error

**Cause:** Missing or invalid credentials.

**Fix:**
- Check you're sending the correct header (`x-api-key` or `authorization`)
- Verify the API key is at least 16 characters
- For JWT, check the token hasn't expired

### "Token expired" Error

**Cause:** JWT token has passed its expiration time.

**Fix:**
- Generate a new token: `python load/scripts/generate_token.py --secret $API_KEY`
- Tokens expire after 1 hour by default

### "Invalid or missing Bearer token" Error

**Cause:** JWT token is malformed or missing.

**Fix:**
- Ensure the token starts with `eyJ` (JWT format)
- Check the `authorization` header format: `Bearer <token>`
- Verify the token was generated with the correct secret

## Related Documentation

- [API Reference](api.md) - How to use the API
- [Configuration](../getting-started/configuration.md) - Auth settings
- [Architecture](../concepts/architecture.md) - How auth fits in the system
