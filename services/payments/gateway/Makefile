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

# Self-contained load test: compose brings up rabbitmq + gateway + k6 on a
# dedicated network, no dependency on the main detect_ai stack.
# Usage: make load-test SCENARIO=spike TARGET_VUS=100 DURATION=60s
load-test:
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

# Gateway with RabbitMQ via infra compose files
# Usage: make gateway-up [WITH_RABBITMQ=0|1] [WITH_UI=0|1]
#   gateway only:              make gateway-up WITH_RABBITMQ=0
#   gateway + rabbitmq:        make gateway-up WITH_UI=0
#   gateway + rabbitmq + ui:   make gateway-up  (default)
gateway-build:
	docker build -t payment-gateway .

gateway-up:
	@WITH_RABBITMQ=$${WITH_RABBITMQ:-1} WITH_UI=$${WITH_UI:-1}; \
	COMPOSE="docker compose -f infra/compose.yml"; \
	if [ "$$WITH_RABBITMQ" = "1" ]; then COMPOSE="$$COMPOSE -f infra/compose.with-rabbit.yml"; fi; \
	if [ "$$WITH_UI" = "1" ] && [ "$$WITH_RABBITMQ" = "1" ]; then COMPOSE="$$COMPOSE -f infra/compose.with-ui.yml"; fi; \
	echo "Starting gateway with WITH_RABBITMQ=$$WITH_RABBITMQ WITH_UI=$$WITH_UI"; \
	$$COMPOSE up --build -d; \
	$$COMPOSE ps

gateway-down:
	docker compose -f infra/compose.yml -f infra/compose.with-rabbit.yml -f infra/compose.with-ui.yml down --remove-orphans

gateway-down-v:
	docker compose -f infra/compose.yml -f infra/compose.with-rabbit.yml -f infra/compose.with-ui.yml down -v --remove-orphans

gateway-logs:
	docker compose -f infra/compose.yml -f infra/compose.with-rabbit.yml -f infra/compose.with-ui.yml logs -f payment-gateway

gateway-ps:
	docker compose -f infra/compose.yml -f infra/compose.with-rabbit.yml -f infra/compose.with-ui.yml ps
