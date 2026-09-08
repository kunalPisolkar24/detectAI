# Variables
RPS ?= 5
DURATION ?= 10s
SEED_COUNT ?= 50

# Worker selector for the docker targets below.
# Usage: make worker-up WORKER=payments
# Valid values mirror the compose files in infra/ and the bun scripts:
#   analytics -> infra/compose.analytics.yml (postgres + redis-cache + rabbitmq)
#   cron      -> infra/compose.cron.yml      (postgres + redis-cache)
#   payments  -> infra/compose.payments.yml  (postgres + redis-cache + redis-events + rabbitmq)
WORKER ?=

# Local Infrastructure Defaults (pointing to ports mapped by the worker stacks)
DATABASE_URL ?= postgresql://user:password@localhost:5432/detect_ai
REDIS_URL ?= redis://:user_cache_password@localhost:6379
EVENT_REDIS_URL ?= redis://:events_password@localhost:6381
RABBITMQ_URL ?= amqp://guest:guest@localhost:5672

.PHONY: help proxy proxy-stop load-payments load-analytics load-cron \
	dev-payments dev-analytics dev-cron test test-integration \
	worker-up worker-down worker-down-v worker-logs worker-ps worker-build worker-config

help:
	@echo "Workers Service Management"
	@echo ""
	@echo "Docker (per worker, self-contained stacks in infra/):"
	@echo "  make worker-up WORKER=analytics|payments|cron - Start a worker + its datastores"
	@echo "  make worker-down WORKER=...     - Stop the stack (keep volumes)"
	@echo "  make worker-down-v WORKER=...   - Stop the stack and remove volumes"
	@echo "  make worker-logs WORKER=...     - Stream the worker logs"
	@echo "  make worker-ps WORKER=...       - Show the stack containers"
	@echo "  make worker-build WORKER=...    - Build the worker image"
	@echo "  make worker-config WORKER=...   - Render the compose config"
	@echo ""
	@echo "Load Testing:"
	@echo "  make proxy           - Start the load testing proxy (required for tests)"
	@echo "  make proxy-stop      - Kill any existing proxy process on port 9999"
	@echo "  make load-payments   - Run payments load test (params: RPS, DURATION)"
	@echo "  make load-analytics  - Run analytics load test (params: RPS, DURATION)"
	@echo "  make load-cron       - Run cron seed (params: SEED_COUNT)"
	@echo ""
	@echo "Development (Local Bun):"
	@echo "  make dev-payments    - Start payments worker in watch mode"
	@echo "  make dev-analytics   - Start analytics worker in watch mode"
	@echo "  make dev-cron        - Start cron worker in watch mode"
	@echo ""
	@echo "Testing:"
	@echo "  make test            - Run unit tests"
	@echo "  make test-integration - Run integration tests"

# Env resolution: infra/.env wins when present, otherwise the checked-in
# infra/.env.example supplies working local defaults (same project name, so
# stacks share datastore volumes side by side). Shell-exported vars win over
# either file. This keeps `make worker-up WORKER=cron` working with zero setup.
ENV_FILE := $(if $(wildcard infra/.env),infra/.env,infra/.env.example)
COMPOSE = docker compose --env-file $(ENV_FILE) -f infra/compose.$(WORKER).yml

# Resolve + validate WORKER, then run docker compose on its stack file.
worker-%:
	@if [ -z "$(WORKER)" ]; then \
		echo "WORKER is required. Use WORKER=analytics, WORKER=payments or WORKER=cron."; \
		exit 1; \
	fi
	@if [ "$(WORKER)" != "analytics" ] && [ "$(WORKER)" != "payments" ] && [ "$(WORKER)" != "cron" ]; then \
		echo "Invalid WORKER '$(WORKER)'. Use WORKER=analytics, WORKER=payments or WORKER=cron."; \
		exit 1; \
	fi

worker-up: worker-%
	$(COMPOSE) up --build -d
	$(COMPOSE) ps

worker-down: worker-%
	$(COMPOSE) down --remove-orphans

worker-down-v: worker-%
	$(COMPOSE) down -v --remove-orphans

worker-logs: worker-%
	$(COMPOSE) logs -f worker-$(WORKER)

worker-ps: worker-%
	$(COMPOSE) ps

worker-build: worker-%
	$(COMPOSE) build

worker-config: worker-%
	$(COMPOSE) config

# Infrastructure
proxy:
	@echo "Starting Load Testing Proxy on http://localhost:9999..."
	@DATABASE_URL=$(DATABASE_URL) \
	 REDIS_URL=$(REDIS_URL) \
	 EVENT_REDIS_URL=$(EVENT_REDIS_URL) \
	 RABBITMQ_URL=$(RABBITMQ_URL) \
	 bun run src/tests/load/proxy.ts

proxy-stop:
	@echo "Stopping any existing proxy on port 9999..."
	@ss -tlnp | grep :9999 | grep -oP 'pid=\K[0-9]+' | xargs -I {} kill -9 {} 2>/dev/null || true

# Load Testing
load-payments:
	@echo "Running Payments Load Test (RPS=$(RPS), DURATION=$(DURATION))..."
	RPS=$(RPS) DURATION=$(DURATION) ./bin/k6 run src/tests/load/payments.k6.js

load-analytics:
	@echo "Running Analytics Load Test (RPS=$(RPS), DURATION=$(DURATION))..."
	RPS=$(RPS) DURATION=$(DURATION) ./bin/k6 run src/tests/load/analytics.k6.js

load-cron:
	@echo "Running Cron Seed (SEED_COUNT=$(SEED_COUNT))..."
	SEED_COUNT=$(SEED_COUNT) ./bin/k6 run src/tests/load/cron.k6.js

# Development (Local Bun)
dev-payments:
	bun run dev:payments

dev-analytics:
	bun run dev:analytics

dev-cron:
	bun run dev:cron

# Testing
test:
	bun run test

test-integration:
	bun run test:integration
