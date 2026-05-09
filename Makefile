SHELL := /bin/sh
.DEFAULT_GOAL := help

PROD_ENV := infra/docker/prod/.env
PROD_COMPOSE_FILE := infra/docker/prod/compose.yml
PROD_MONITORING_COMPOSE_FILE := infra/docker/prod/compose.monitoring.yml
LOCAL_ENV := infra/docker/local/.env
LOCAL_COMPOSE_FILE := infra/docker/local/compose.yml

DOCKER_BIN := $(strip $(shell command -v docker 2>/dev/null))
DOCKER_BIN := $(if $(DOCKER_BIN),$(DOCKER_BIN),docker)

PROD_COMPOSE := $(DOCKER_BIN) compose --env-file $(PROD_ENV) -f $(PROD_COMPOSE_FILE)
PROD_MONITORING_COMPOSE := $(DOCKER_BIN) compose --env-file $(PROD_ENV) -f $(PROD_COMPOSE_FILE) -f $(PROD_MONITORING_COMPOSE_FILE)
LOCAL_COMPOSE := $(DOCKER_BIN) compose --env-file $(LOCAL_ENV) -f $(LOCAL_COMPOSE_FILE)

STACK ?=
SERVICE ?=
SERVICE_ARGS := $(strip $(SERVICE))
PROD_NETWORK := $(strip $(shell awk -F= '/^detect_ai_network=/{print $$2; exit}' $(PROD_ENV) 2>/dev/null))
PROD_NETWORK := $(if $(PROD_NETWORK),$(PROD_NETWORK),detect_ai_network)

.PHONY: help network validate-stack \
	up down logs clean build rebuild shell-web \
	prod-up prod-down prod-logs prod-clean prod-build prod-rebuild prod-config prod-ps prod-migrate \
	prod-monitoring-up prod-monitoring-down prod-monitoring-logs prod-monitoring-config prod-monitoring-ps \
	local-up local-down local-logs local-clean local-build local-rebuild local-config local-ps

help:
	@printf "\nDetect AI Docker commands\n\n"
	@printf "Production\n"
	@printf "  make up                Start the prod stack\n"
	@printf "  make down              Stop the prod stack\n"
	@printf "  make logs [SERVICE=x]  Stream prod logs\n"
	@printf "  make clean             Stop prod and remove volumes\n"
	@printf "  make prod-up           Start the prod stack\n"
	@printf "  make prod-down         Stop the prod stack\n"
	@printf "  make prod-logs         Stream prod logs\n"
	@printf "  make prod-clean        Stop prod and remove volumes\n"
	@printf "  make prod-build        Build prod images\n"
	@printf "  make prod-rebuild      Rebuild prod images without cache\n"
	@printf "  make prod-config       Render prod compose config\n"
	@printf "  make prod-ps           Show prod containers\n"
	@printf "  make prod-migrate      Run prod DB migrations once\n\n"
	@printf "Monitoring\n"
	@printf "  make prod-monitoring-up     Start the prod stack with Prometheus and Grafana\n"
	@printf "  make prod-monitoring-down   Stop the prod stack with monitoring\n"
	@printf "  make prod-monitoring-logs   Stream prod logs with monitoring\n"
	@printf "  make prod-monitoring-config Render prod compose config with monitoring\n"
	@printf "  make prod-monitoring-ps     Show prod containers with monitoring\n\n"
	@printf "Local\n"
	@printf "  make local-up          Start the local stack\n"
	@printf "  make local-down        Stop the local stack\n"
	@printf "  make local-logs        Stream local logs\n"
	@printf "  make local-clean       Stop local and remove volumes\n"
	@printf "  make local-build       Build local images\n"
	@printf "  make local-rebuild     Rebuild local images without cache\n"
	@printf "  make local-config      Render local compose config\n"
	@printf "  make local-ps          Show local containers\n\n"
	@printf "Testing\n"
	@printf "  make test              Run all unit tests\n"
	@printf "  make test-integration  Run integration tests (requires Docker)\n\n"
	@printf "Generic\n"
	@printf "  make build STACK=prod|local [SERVICE=name]\n"
	@printf "  make rebuild STACK=prod|local [SERVICE=name]\n"
	@printf "  make shell-web         Open a shell in the prod frontend container\n\n"
	@printf "Examples\n"
	@printf "  make build STACK=prod SERVICE=frontend\n"
	@printf "  make build STACK=local SERVICE=frontend\n"
	@printf "  make prod-logs SERVICE=worker-analytics\n"
	@printf "  make local-logs SERVICE=frontend\n\n"

network:
	@$(DOCKER_BIN) network inspect $(PROD_NETWORK) >/dev/null 2>&1 || $(DOCKER_BIN) network create $(PROD_NETWORK)

validate-stack:
	@if [ -z "$(STACK)" ]; then \
		echo "STACK is required. Use STACK=prod or STACK=local."; \
		exit 1; \
	fi
	@if [ "$(STACK)" != "prod" ] && [ "$(STACK)" != "local" ]; then \
		echo "Invalid STACK '$(STACK)'. Use STACK=prod or STACK=local."; \
		exit 1; \
	fi

up: prod-up

down: prod-down

logs: prod-logs

clean: prod-clean

build: validate-stack
	@$(MAKE) --no-print-directory $(STACK)-build SERVICE="$(SERVICE)"

rebuild: validate-stack
	@$(MAKE) --no-print-directory $(STACK)-rebuild SERVICE="$(SERVICE)"

prod-up: network
	$(PROD_COMPOSE) up -d

prod-down:
	$(PROD_COMPOSE) down --remove-orphans

prod-logs:
	$(PROD_COMPOSE) logs -f $(SERVICE_ARGS)

prod-clean:
	$(PROD_COMPOSE) down -v --remove-orphans

prod-build:
	$(PROD_COMPOSE) build $(SERVICE_ARGS)

prod-rebuild:
	$(PROD_COMPOSE) build --no-cache $(SERVICE_ARGS)

prod-config:
	$(PROD_COMPOSE) config

prod-ps:
	$(PROD_COMPOSE) ps

prod-migrate: network
	$(PROD_COMPOSE) run --rm db-migrate

prod-monitoring-up: network
	$(PROD_MONITORING_COMPOSE) up -d

prod-monitoring-down:
	$(PROD_MONITORING_COMPOSE) down --remove-orphans

prod-monitoring-logs:
	$(PROD_MONITORING_COMPOSE) logs -f $(SERVICE_ARGS)

prod-monitoring-config:
	$(PROD_MONITORING_COMPOSE) config

prod-monitoring-ps:
	$(PROD_MONITORING_COMPOSE) ps

local-up:
	$(LOCAL_COMPOSE) up -d

local-down:
	$(LOCAL_COMPOSE) down --remove-orphans

local-logs:
	$(LOCAL_COMPOSE) logs -f $(SERVICE_ARGS)

local-clean:
	$(LOCAL_COMPOSE) down -v --remove-orphans

local-build:
	$(LOCAL_COMPOSE) build $(SERVICE_ARGS)

local-rebuild:
	$(LOCAL_COMPOSE) build --no-cache $(SERVICE_ARGS)

local-config:
	$(LOCAL_COMPOSE) config

local-ps:
	$(LOCAL_COMPOSE) ps

shell-web:
	$(PROD_COMPOSE) exec frontend /bin/sh

test:
	@echo "Running unit tests..."
	cd services/payments/gateway && go test -v ./...

test-integration:
	@echo "Running integration tests..."
	cd services/payments/gateway && go test -v -tags=integration ./internal/integration/...
