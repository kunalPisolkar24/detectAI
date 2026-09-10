.PHONY: build run test test-coverage test-integration deps load-test load-down load-test-spike load-test-stress load-test-soak load-test-internal gateway-build gateway-up gateway-down gateway-down-v gateway-logs gateway-ps

build:
	go build -o gateway ./cmd/gateway/main.go

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
load-test:
	RABBITMQ_PORT=$${RABBITMQ_PORT:-5673} RABBITMQ_UI_PORT=$${RABBITMQ_UI_PORT:-15673} \
	docker compose -f infra/compose.load.yml up --abort-on-container-exit --exit-code-from k6

load-down:
	docker compose -f infra/compose.load.yml down -v --remove-orphans

load-test-spike:
	@$(MAKE) load-test SCENARIO=spike

load-test-stress:
	@$(MAKE) load-test SCENARIO=stress

load-test-soak:
	@$(MAKE) load-test SCENARIO=soak

load-test-internal:
	@$(MAKE) load-test SCENARIO=internal

deps:
	go mod tidy
	go get github.com/testcontainers/testcontainers-go
	go get github.com/testcontainers/testcontainers-go/modules/rabbitmq

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
