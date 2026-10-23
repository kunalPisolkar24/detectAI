.PHONY: build run test test-coverage test-integration deps load-test load-down load-down-remote load-test-smoke load-test-spike load-test-stress load-test-soak load-test-internal load-test-negative load-test-chaos gateway-build gateway-up gateway-down gateway-down-v gateway-logs gateway-ps help

help:
	@echo "Targets: build run test test-coverage test-integration load-test gateway-up/down"

build:
	go build -ldflags "-X main.buildVersion=$${VERSION:-dev} -X main.buildCommit=$${COMMIT:-unknown}" -o gateway ./cmd/gateway/main.go

run:
	go run cmd/gateway/main.go

test:
	go test -v ./...

test-coverage:
	go test -v -coverprofile=coverage.out ./...
	go tool cover -func=coverage.out

test-integration:
	go test -v -tags=integration ./test/integration/...

test-integration-ha:
	go test -v -tags=ha_integration -timeout=600s ./test/integration/... -run TestHA

# Self-contained load test: compose brings up rabbitmq + gateway + k6 on a
# dedicated network, no dependency on the main detect_ai stack.
# Load publishes 5673/15673 (not 5672/15672) so it runs side-by-side with `gateway-up`.
# Usage: make load-test SCENARIO=spike TARGET_VUS=100 DURATION=60s
# Opt-in observability: make load-test WITH_OBSERVABILITY=1 SCENARIO=spike
# (adds otel-collector-loadtest -> New Relic EU as deployment.environment=loadtest;
# needs NEW_RELIC_LICENSE_KEY in shell; ENV_TYPE stays dev).
# Remote mode: make load-test REMOTE=1 TARGET_ENV_FILE=../../e2e/targets/.env.prod
# (runs the k6 container only, against a deployment that is already running).
COMPOSE_LOAD := docker compose -f infra/compose.load.yml
COMPOSE_LOAD_OBS := docker compose -f infra/compose.load.yml -f ../../../infra/docker/otel/loadtest-observability.yml -f infra/compose.load.observability.yml
WITH_OBSERVABILITY ?= 0
# Remote mode points the load test at an already-running deployment instead of
# starting the rig. Endpoints and credentials come from TARGET_ENV_FILE (see
# e2e/targets/.env.example). Nothing is provisioned in remote mode: the k6
# container runs with --no-deps, so the gateway and its broker stay down and
# only the runner is started. The target's own stack exports its telemetry,
# so WITH_OBSERVABILITY does not apply here.
REMOTE ?= 0
TARGET_ENV_FILE ?=
# The rig's compose project is "gateway-load"; the remote run gets its own
# project so it can never touch a running local rig.
LOAD_REMOTE_PROJECT := e2e-payment-gateway
load-test:
	@if [ "$(WITH_OBSERVABILITY)" != "0" ] && [ "$(WITH_OBSERVABILITY)" != "1" ]; then \
		echo "Invalid WITH_OBSERVABILITY '$(WITH_OBSERVABILITY)'. Use 0 or 1."; exit 1; \
	fi
	@if [ "$(REMOTE)" = "1" ]; then \
		if [ -z "$(TARGET_ENV_FILE)" ]; then \
			echo "REMOTE=1 requires TARGET_ENV_FILE (see e2e/targets/.env.example)."; exit 1; \
		fi; \
		if [ ! -f "$(TARGET_ENV_FILE)" ]; then \
			echo "TARGET_ENV_FILE not found: $(TARGET_ENV_FILE)"; exit 1; \
		fi; \
		if [ "$(WITH_OBSERVABILITY)" = "1" ]; then \
			echo "WITH_OBSERVABILITY is ignored in remote mode: the target's own stack exports its telemetry."; \
		fi; \
		if [ "$(SCENARIO)" = "chaos" ]; then \
			echo "SCENARIO=chaos stops the RabbitMQ container mid-run and only works against the rig."; exit 1; \
		fi; \
		if [ -n "$(VUS)" ]; then export SMOKE_VUS="$(VUS)"; export TARGET_VUS="$(VUS)"; fi; \
		if [ -n "$(ITERATIONS)" ]; then export SMOKE_ITERATIONS="$(ITERATIONS)"; fi; \
		$(COMPOSE_LOAD) --env-file $(TARGET_ENV_FILE) -p $(LOAD_REMOTE_PROJECT) run --rm --no-deps k6 run /scripts/scenarios/$(or $(SCENARIO),spike).js; \
	else \
		if [ "$(WITH_OBSERVABILITY)" = "1" ]; then \
			if [ -z "$${NEW_RELIC_LICENSE_KEY:-}" ]; then \
				echo "WITH_OBSERVABILITY=1 but NEW_RELIC_LICENSE_KEY is empty — collector will retry/drop, apps keep running."; \
			fi; \
			RABBITMQ_PORT=$${RABBITMQ_PORT:-5673} RABBITMQ_UI_PORT=$${RABBITMQ_UI_PORT:-15673} \
			$(COMPOSE_LOAD_OBS) up --abort-on-container-exit --exit-code-from k6; \
		else \
			RABBITMQ_PORT=$${RABBITMQ_PORT:-5673} RABBITMQ_UI_PORT=$${RABBITMQ_UI_PORT:-15673} \
			$(COMPOSE_LOAD) up --abort-on-container-exit --exit-code-from k6; \
		fi; \
	fi

load-down:
	$(COMPOSE_LOAD_OBS) down -v --remove-orphans

# Remove the remote compose project: a `run --rm --no-deps` leaves its network
# and the broker volume behind. Kept apart from load-down so tearing down a
# remote run never touches the local rig's volumes.
load-down-remote:
	$(COMPOSE_LOAD) -p $(LOAD_REMOTE_PROJECT) down -v --remove-orphans

load-test-smoke:
	@$(MAKE) load-test SCENARIO=smoke

load-test-spike:
	@$(MAKE) load-test SCENARIO=spike

load-test-stress:
	@$(MAKE) load-test SCENARIO=stress

load-test-soak:
	@$(MAKE) load-test SCENARIO=soak

load-test-internal:
	@$(MAKE) load-test SCENARIO=internal

load-test-negative:
	@$(MAKE) load-test SCENARIO=negative

# Failure injection: stops RabbitMQ mid-run and restarts it. Requests during
# the outage must fast-fail 503 with Retry-After; traffic recovers after.
# chaos.js holds 20 VUs for ~4min (30s ramp, 3m hold, 30s down); the outage
# runs from t+75s to t+135s. Fails if no 503 was observed (orchestration
# broken) or if traffic does not recover.
load-test-chaos:
	@if [ "$(REMOTE)" = "1" ]; then \
		echo "load-test-chaos stops the RabbitMQ container mid-run and only works against the rig."; exit 1; \
	fi
	RABBITMQ_PORT=$${RABBITMQ_PORT:-5673} RABBITMQ_UI_PORT=$${RABBITMQ_UI_PORT:-15673} \
	docker compose -f infra/compose.load.yml up -d rabbitmq payment-gateway
	@echo "Waiting for gateway healthy..."; \
	for i in $$(seq 1 24); do \
		if docker compose -f infra/compose.load.yml exec -T payment-gateway wget -q -O /dev/null http://localhost:8080/readyz 2>/dev/null; then break; fi; \
		if [ $$i -eq 24 ]; then echo "Gateway never became healthy"; $(MAKE) load-down; exit 1; fi; \
		sleep 5; \
	done
	RABBITMQ_PORT=$${RABBITMQ_PORT:-5673} RABBITMQ_UI_PORT=$${RABBITMQ_UI_PORT:-15673} \
	SCENARIO=chaos docker compose -f infra/compose.load.yml run --rm -T k6 & \
	K6PID=$$!; \
	sleep 75; \
	RABBITMQ_CID=$$(docker compose -f infra/compose.load.yml ps -q rabbitmq); \
	echo "Stopping RabbitMQ $${RABBITMQ_CID} (outage start)"; \
	docker stop $${RABBITMQ_CID}; \
	sleep 60; \
	echo "Starting RabbitMQ $${RABBITMQ_CID} (outage end)"; \
	docker start $${RABBITMQ_CID}; \
	wait $$K6PID; CODE=$$?; \
	$(MAKE) load-down; \
	exit $$CODE

deps:
	go mod tidy

# Gateway with RabbitMQ via shared infra atoms (infra/docker/rabbitmq/*)
# Usage: make gateway-up [WITH_RABBITMQ=0|1] [WITH_UI=0|1] [RABBITMQ_URL=...]
#   gateway only:              make gateway-up WITH_RABBITMQ=0 RABBITMQ_URL=amqp://user:pass@host:5672/
#   gateway + rabbitmq:        make gateway-up WITH_UI=0
#   gateway + rabbitmq + ui:   make gateway-up  (default)
# WITH_RABBITMQ=0 needs an external RABBITMQ_URL (gateway fast-fails 503 otherwise).
# RabbitMQ templates live at infra/docker/rabbitmq/standalone.yml (+ management.yml)
# Any service can `include: path: ../../../infra/docker/rabbitmq/standalone.yml`.
gateway-build:
	docker build -t payment-gateway .

gateway-up:
	@WITH_RABBITMQ=$${WITH_RABBITMQ:-1} WITH_UI=$${WITH_UI:-1}; \
	if [ "$$WITH_UI" = "1" ] && [ "$$WITH_RABBITMQ" != "1" ]; then echo "WARNING: WITH_UI needs WITH_RABBITMQ=1, ignoring UI"; WITH_UI=0; fi; \
	if [ "$$WITH_RABBITMQ" != "1" ] && [ -z "$${RABBITMQ_URL:-}" ]; then echo "WARNING: WITH_RABBITMQ=0 without RABBITMQ_URL — gateway will fast-fail 503 until an external broker is set"; fi; \
	COMPOSE="docker compose -f infra/compose.yml"; \
	if [ "$$WITH_RABBITMQ" = "1" ]; then COMPOSE="$$COMPOSE -f ../../../infra/docker/rabbitmq/standalone.yml"; fi; \
	if [ "$$WITH_UI" = "1" ] && [ "$$WITH_RABBITMQ" = "1" ]; then COMPOSE="$$COMPOSE -f ../../../infra/docker/rabbitmq/management.yml"; fi; \
	echo "Starting gateway with WITH_RABBITMQ=$$WITH_RABBITMQ WITH_UI=$$WITH_UI"; \
	$$COMPOSE up --build -d; \
	$$COMPOSE ps

gateway-down:
	docker compose -f infra/compose.yml -f ../../../infra/docker/rabbitmq/standalone.yml -f ../../../infra/docker/rabbitmq/management.yml down --remove-orphans

gateway-down-v:
	docker compose -f infra/compose.yml -f ../../../infra/docker/rabbitmq/standalone.yml -f ../../../infra/docker/rabbitmq/management.yml down -v --remove-orphans

gateway-logs:
	docker compose -f infra/compose.yml -f ../../../infra/docker/rabbitmq/standalone.yml -f ../../../infra/docker/rabbitmq/management.yml logs -f payment-gateway

gateway-ps:
	docker compose -f infra/compose.yml -f ../../../infra/docker/rabbitmq/standalone.yml -f ../../../infra/docker/rabbitmq/management.yml ps
