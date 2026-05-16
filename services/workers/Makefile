# Variables
RPS ?= 5
DURATION ?= 10s
SEED_COUNT ?= 50

# Local Infrastructure Defaults (pointing to ports mapped by make local-up)
DATABASE_URL ?= postgresql://user:password@localhost:5432/detect_ai
REDIS_URL ?= redis://:user_cache_password@localhost:6379
REDIS_USAGE_URL ?= redis://:usage_cache_password@localhost:6382
RABBITMQ_URL ?= amqp://guest:guest@localhost:5672

.PHONY: help proxy load-payments load-analytics load-cron dev-payments dev-analytics dev-cron test test-integration build-all

help:
	@echo "Workers Service Management"
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
	@echo ""
	@echo "Docker Support:"
	@echo "  make build-all       - Rebuild all worker containers (via root Makefile)"

# Infrastructure
proxy:
	@echo "Starting Load Testing Proxy on http://localhost:9999..."
	@DATABASE_URL=$(DATABASE_URL) \
	 REDIS_URL=$(REDIS_URL) \
	 REDIS_USAGE_URL=$(REDIS_USAGE_URL) \
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

# Docker Support
build-all:
	cd ../.. && make local-build SERVICE=worker-analytics
	cd ../.. && make local-build SERVICE=worker-cron
	cd ../.. && make local-build SERVICE=worker-payments
	cd ../.. && make local-up
