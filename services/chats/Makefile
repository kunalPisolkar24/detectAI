.PHONY: all proto deps run build test test-integration test-ha test-all docker-build load-test load-down

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
# Usage: make load-test [SCENARIO=smoke|load|stress|soak] [VUS=2] [DURATION=30s] [RPS=10]
#   tiny smoke: make load-test SCENARIO=smoke VUS=1 DURATION=10s
#   with RPS cap: make load-test SCENARIO=load VUS=10 DURATION=2m RPS=50
# Opt-in observability: make load-test WITH_OBSERVABILITY=1 SCENARIO=load
# (adds otel-collector-loadtest + redis/mongo exporters -> New Relic EU as
# deployment.environment=loadtest; needs NEW_RELIC_LICENSE_KEY in shell;
# ENV_TYPE stays dev).
COMPOSE_LOAD := docker compose -f infra/compose.load.yml
COMPOSE_LOAD_OBS := docker compose -f infra/compose.load.yml -f ../../infra/docker/otel/loadtest-observability.yml -f ../../infra/docker/redis-exporter/standalone.yml -f ../../infra/docker/mongo-exporter/standalone.yml -f infra/compose.load.observability.yml
WITH_OBSERVABILITY ?= 0
load-test:
	@if [ "$(WITH_OBSERVABILITY)" != "0" ] && [ "$(WITH_OBSERVABILITY)" != "1" ]; then \
		echo "Invalid WITH_OBSERVABILITY '$(WITH_OBSERVABILITY)'. Use 0 or 1."; exit 1; \
	fi
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