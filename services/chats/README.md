# Chats

Go/ConnectRPC service that stores chats and messages in MongoDB, serves hot reads from a Redis overlay, and emits OTel telemetry — specification in [specification/](specification/README.md), full documentation in [docs/](docs/README.md).

## Run

Run `make help` for the full command index.

```sh
make env                # creates infra/.env from infra/.env.example
make db-up cache-up     # local MongoDB + Redis
make run                # API on :8090 (H2C + HTTP/1.1)
```

## Verify

```sh
curl http://localhost:8090/api/v1/health
# {"status":"ok"}
curl http://localhost:8090/api/v1/ready
# {"status":"ready"}   # pings MongoDB
```

## First RPC

Reflection is mounted, so `grpcurl` needs no schema file:

```sh
grpcurl -plaintext \
  -H "x-api-key: local-dev-api-key-16-chars" \
  -H "x-user-id: user-1" \
  -d '{"initial_message":"hello"}' \
  localhost:8090 chats.v1.ChatService/CreateChat
```

## Docker

```sh
make build
make up
make down
```

## Tests + load

```sh
make test                        # full go suite
make load-env && make load-test  # k6 rig; SCENARIO lives in infra/.env.load
```
