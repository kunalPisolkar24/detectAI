.PHONY: all proto deps run build test test-integration test-ha test-all docker-build load-test load-down load-down-remote chats-up chats-down chats-down-v

all: deps proto build

deps:
	go install google.golang.org/protobuf/cmd/protoc-gen-go@latest
	go install google.golang.org/grpc/cmd/protoc-gen-go-grpc@latest
	go mod tidy

proto:
	protoc --go_out=. --go_opt=paths=source_relative \
    --go-grpc_out=. --go-grpc_opt=paths=source_relative \
    api/proto/chat_service.proto

run:
	go run cmd/server/main.go

build:
	go build -o bin/chat-service cmd/server/main.go

test:
	go test -v ./... 

test-coverage:
	go test -v ./... -cover 

test-integration:
	go test -v -tags integration -timeout=900s -run Test -count=1 ./...

test-sharded:
	go test -v -tags integration -timeout=900s -run TestSharded -count=1 ./...

test-ha:
	go test -v -tags ha -run TestHA -count=1 ./...

test-all:
	go test -v -tags integration,ha -count=1 ./...

docker-build:
	docker compose up --build

# Self-contained load test: compose brings up chat-mongo + chat-redis + service + worker + k6
# on isolated chat_loadnet, no dependency on main stack or local k6 binary.
# Usage: make load-test [SCENARIO=smoke|load|stress|soak|lifecycle|edge] [VUS=2] [DURATION=30s] [RPS=10]
#   tiny smoke: make load-test SCENARIO=smoke VUS=1 DURATION=10s
#   with RPS cap: make load-test SCENARIO=load VUS=10 DURATION=2m RPS=50
# Opt-in observability: make load-test WITH_OBSERVABILITY=1 SCENARIO=load
# (adds otel-collector-loadtest + redis/mongo exporters -> New Relic EU as
# deployment.environment=loadtest; needs NEW_RELIC_LICENSE_KEY in shell;
# ENV_TYPE stays dev).
COMPOSE_LOAD := docker compose -f infra/compose.load.yml
COMPOSE_LOAD_OBS := docker compose -f infra/compose.load.yml -f ../../infra/docker/otel/loadtest-observability.yml -f ../../infra/docker/redis-exporter/standalone.yml -f ../../infra/docker/mongo-exporter/standalone.yml -f infra/compose.load.observability.yml
WITH_OBSERVABILITY ?= 0
# Remote mode points the load test at a deployment that is already running
# instead of starting the rig. The endpoint and the timeouts come from
# TARGET_ENV_FILE (see e2e/targets/.env.example). Nothing is provisioned in
# remote mode: the runner starts with --no-deps, so the chat service and its
# datastores stay down. The target's own stack exports its telemetry, so
# WITH_OBSERVABILITY does not apply here.
REMOTE ?= 0
TARGET_ENV_FILE ?=
# The rig's compose project is "chats-load"; the remote run gets its own
# project so it can never touch a running local rig.
LOAD_REMOTE_PROJECT := e2e-chats
load-test:
	@if [ "$(WITH_OBSERVABILITY)" != "0" ] && [ "$(WITH_OBSERVABILITY)" != "1" ]; then \
		echo "Invalid WITH_OBSERVABILITY '$(WITH_OBSERVABILITY)'. Use 0 or 1."; exit 1; \
	fi
	@if [ "$(REMOTE)" = "1" ]; then \
		$(MAKE) --no-print-directory _load-test-remote; \
	else \
		$(MAKE) --no-print-directory _load-test-local; \
	fi

# The runner against a deployment that is already running. The chat service
# and its datastores are never started.
_load-test-remote:
	@if [ -z "$(TARGET_ENV_FILE)" ]; then \
		echo "REMOTE=1 requires TARGET_ENV_FILE (see e2e/targets/.env.example)."; exit 1; \
	fi
	@if [ ! -f "$(TARGET_ENV_FILE)" ]; then \
		echo "TARGET_ENV_FILE not found: $(TARGET_ENV_FILE)"; exit 1; \
	fi
	@if [ "$(WITH_OBSERVABILITY)" = "1" ]; then \
		echo "WITH_OBSERVABILITY is ignored in remote mode: the target's own stack exports its telemetry."; \
	fi
	@echo "\nRunning k6 load tests against $(TARGET_ENV_FILE) (SCENARIO=$(or $(SCENARIO),smoke), VUS=$(VUS), DURATION=$(DURATION))..."
	$(COMPOSE_LOAD) --env-file $(TARGET_ENV_FILE) -p $(LOAD_REMOTE_PROJECT) run --rm --no-deps \
		k6 run /scripts/scenarios/$(or $(SCENARIO),smoke).js

# The rig: chat-mongo + chat-redis + the service and worker + k6.
_load-test-local:
	@if [ "$(WITH_OBSERVABILITY)" = "1" ]; then \
		if [ -z "$${NEW_RELIC_LICENSE_KEY:-}" ]; then \
			echo "WITH_OBSERVABILITY=1 but NEW_RELIC_LICENSE_KEY is empty — collector will retry/drop, apps keep running."; \
		fi; \
		$(COMPOSE_LOAD_OBS) up --build --abort-on-container-exit --exit-code-from k6; \
	else \
		$(COMPOSE_LOAD) up --build --abort-on-container-exit --exit-code-from k6; \
	fi

load-down:
	$(COMPOSE_LOAD_OBS) down -v --remove-orphans

# Remove the remote compose project: a `run --rm --no-deps` leaves its network
# and the datastore volumes behind. Kept apart from load-down so tearing down
# a remote run never touches the local rig's volumes.
load-down-remote:
	$(COMPOSE_LOAD) -p $(LOAD_REMOTE_PROJECT) down -v --remove-orphans

# The service stack on its own: chat-mongo + chat-redis + the chat service and
# its worker. The load rig is not involved.
COMPOSE := docker compose -f infra/compose.yml
chats-up:
	$(COMPOSE) up -d --build
	$(COMPOSE) ps

chats-down:
	$(COMPOSE) down --remove-orphans

chats-down-v:
	$(COMPOSE) down -v --remove-orphans