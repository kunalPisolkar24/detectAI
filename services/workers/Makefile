# Variables (VUS empty = per-script default; others match script defaults)
RPS ?= 5
DURATION ?= 10s
SEED_COUNT ?= 1000
VUS ?=

# Worker selector for the docker targets below.
# Usage: make worker-up WORKER=payments
# Valid values mirror the compose files in infra/ and the bun scripts:
#   analytics -> infra/compose.analytics.yml (postgres + redis-users + rabbitmq)
#   cron      -> infra/compose.cron.yml      (postgres + redis-users)
#   payments  -> infra/compose.payments.yml  (postgres + redis-users + redis-events + rabbitmq)
WORKER ?=

# Infra toggles (default 1 = boot the datastore with the stack).
# Set to 0 to reuse a datastore owned by another terminal/stack instead of
# spinning up a second copy (which would start with different data):
#   terminal 1:  make worker-up WORKER=cron
#   terminal 2:  make worker-up WORKER=payments WITH_POSTGRES=0 WITH_REDIS=0 \
#                  DATABASE_URL=postgresql://user:password@host.docker.internal:5432/detect_ai \
#                  REDIS_URL=redis://:user_cache_password@host.docker.internal:6379
# WITH_X=0 requires the matching *_URL to point outside this stack — the
# Makefile fails fast otherwise (see guard below). WITH_EVENTS / WITH_RABBITMQ
# are ignored (with a warning) for workers that don't depend on them.
WITH_POSTGRES ?= 1
WITH_REDIS ?= 1
WITH_EVENTS ?= 1
WITH_RABBITMQ ?= 1

# Local Infrastructure Defaults (pointing to ports mapped by the worker stacks)
DATABASE_URL ?= postgresql://user:password@localhost:5432/detect_ai
REDIS_URL ?= redis://:user_cache_password@localhost:6379
EVENT_REDIS_URL ?= redis://:events_password@localhost:6381
RABBITMQ_URL ?= amqp://guest:guest@localhost:5672

.PHONY: help proxy proxy-stop load-test load-down load-payments load-analytics load-cron \
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
	@echo "Infra toggles (share datastores across terminals instead of duplicating):"
	@echo "  WITH_POSTGRES=0|1 WITH_REDIS=0|1 WITH_EVENTS=0|1 WITH_RABBITMQ=0|1 (default 1)"
	@echo "  WITH_X=0 needs the matching *_URL exported at a shared instance, e.g.:"
	@echo "    make worker-up WORKER=payments WITH_POSTGRES=0 WITH_REDIS=0 \\"
	@echo "      DATABASE_URL=postgresql://user:password@host.docker.internal:5432/detect_ai \\"
	@echo "      REDIS_URL=redis://:user_cache_password@host.docker.internal:6379"
	@echo ""
	@echo "Load Testing (containerized rigs in infra/compose.load-*.yml):"
	@echo "  make load-test WORKER=analytics|payments|cron - Run k6 in containers (params below)"
	@echo "    VUS=10 DURATION=2m RPS=50 SEED_COUNT=1000 (cron seed size)"
	@echo "    e.g. make load-test WORKER=payments VUS=10 DURATION=2m RPS=50"
	@echo "  make load-down WORKER=... - Tear down the load rig (removes volumes)"
	@echo "  make proxy           - Start the load testing proxy on host (for local runs)"
	@echo "  make proxy-stop      - Kill any existing proxy process on port 9999"
	@echo "  make load-payments   - Legacy host run: proxy + local k6 (needs k6 + proxy running)"
	@echo "  make load-analytics  - Legacy host run: proxy + local k6 (needs k6 + proxy running)"
	@echo "  make load-cron       - Legacy host run: proxy + local k6 seed (needs k6 + proxy running)"
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
# infra/.env.example supplies working local defaults. Shell-exported vars
# win over either file. Stacks are isolated compose projects (see `name:`
# in infra/compose.*.yml), so `down -v` on one never touches another.
ENV_FILE := $(if $(wildcard infra/.env),infra/.env,infra/.env.example)

ATOM_DIR := ../../infra/docker
WORKER_FILE := infra/compose.$(WORKER).yml

# Infra file list per worker, minus anything toggled off. Mirrors the
# dependency matrix in infra/.env.example. (Gateway precedent: conditional
# -f merging; compose has no conditional include/depends_on.)
ifeq ($(WORKER),analytics)
ATOM_FILES := $(if $(filter 1,$(WITH_POSTGRES)),-f $(ATOM_DIR)/postgres-users/standalone.yml -f infra/compose.migrate.yml)
ATOM_FILES += $(if $(filter 1,$(WITH_REDIS)),-f $(ATOM_DIR)/redis-users/standalone.yml)
ATOM_FILES += $(if $(filter 1,$(WITH_RABBITMQ)),-f $(ATOM_DIR)/rabbitmq/standalone.yml)
endif
ifeq ($(WORKER),payments)
ATOM_FILES := $(if $(filter 1,$(WITH_POSTGRES)),-f $(ATOM_DIR)/postgres-users/standalone.yml -f infra/compose.migrate.yml)
ATOM_FILES += $(if $(filter 1,$(WITH_REDIS)),-f $(ATOM_DIR)/redis-users/standalone.yml)
ATOM_FILES += $(if $(filter 1,$(WITH_EVENTS)),-f $(ATOM_DIR)/redis-events/standalone.yml)
ATOM_FILES += $(if $(filter 1,$(WITH_RABBITMQ)),-f $(ATOM_DIR)/rabbitmq/standalone.yml)
endif
ifeq ($(WORKER),cron)
ATOM_FILES := $(if $(filter 1,$(WITH_POSTGRES)),-f $(ATOM_DIR)/postgres-users/standalone.yml -f infra/compose.migrate.yml)
ATOM_FILES += $(if $(filter 1,$(WITH_REDIS)),-f $(ATOM_DIR)/redis-users/standalone.yml)
endif

COMPOSE = docker compose --env-file $(ENV_FILE) -f $(WORKER_FILE) $(ATOM_FILES)

# Effective value of a *_URL as compose will interpolate it: shell/command
# line wins, else the env file. Used by the WITH_X=0 guard below.
eff-url = $(if $(filter environment command line,$(origin $1)),$($1),$(shell grep -E '^$1=' $(ENV_FILE) 2>/dev/null | tail -1 | cut -d= -f2-))

# Guard: WITH_X=0 with a URL still pointing at this stack's service DNS can
# never resolve — fail fast with the sharing recipe instead of a cryptic
# connection error after boot.
define guard-shared-url
@if [ "$($1)" = "0" ]; then \
  url='$(call eff-url,$3)'; \
  case "$$url" in \
    *"$(strip $2)"*) \
      echo "ERROR: $1=0 but $3 points inside this stack ($$url)."; \
      echo "Export $3 at the shared instance, e.g.:"; \
      echo "  $3=$(strip $4) make worker-up WORKER=$(WORKER) $1=0 ..."; \
      exit 1;; \
  esac; \
  if [ -z "$$url" ]; then echo "ERROR: $1=0 requires $3 to be set."; exit 1; fi; \
fi
endef

# Resolve + validate WORKER and flags, then run docker compose on the stack.
worker-%:
	@if [ -z "$(WORKER)" ]; then \
		echo "WORKER is required. Use WORKER=analytics, WORKER=payments or WORKER=cron."; \
		exit 1; \
	fi
	@if [ "$(WORKER)" != "analytics" ] && [ "$(WORKER)" != "payments" ] && [ "$(WORKER)" != "cron" ]; then \
		echo "Invalid WORKER '$(WORKER)'. Use WORKER=analytics, WORKER=payments or WORKER=cron."; \
		exit 1; \
	fi
	@for f in WITH_POSTGRES WITH_REDIS WITH_EVENTS WITH_RABBITMQ; do \
		case $$f in \
		WITH_POSTGRES) v="$(WITH_POSTGRES)";; \
		WITH_REDIS) v="$(WITH_REDIS)";; \
		WITH_EVENTS) v="$(WITH_EVENTS)";; \
		WITH_RABBITMQ) v="$(WITH_RABBITMQ)";; \
		esac; \
		if [ "$$v" != "0" ] && [ "$$v" != "1" ]; then \
			echo "Invalid $$f='$$v'. Use 0 or 1."; exit 1; \
		fi; \
	done
	@if [ "$(WORKER)" != "payments" ] && [ "$(WITH_EVENTS)" = "0" ]; then \
		echo "WARNING: WITH_EVENTS is ignored for WORKER=$(WORKER) (no events-redis dependency)."; \
	fi
	@if [ "$(WORKER)" = "cron" ] && [ "$(WITH_RABBITMQ)" = "0" ]; then \
		echo "WARNING: WITH_RABBITMQ is ignored for WORKER=cron (no broker dependency)."; \
	fi
	$(call guard-shared-url,WITH_POSTGRES,postgres-users,DATABASE_URL,postgresql://user:password@host.docker.internal:5432/detect_ai)
	$(call guard-shared-url,WITH_POSTGRES,postgres-users,DATABASE_URL_REPLICA,postgresql://user:password@host.docker.internal:5432/detect_ai)
	$(call guard-shared-url,WITH_REDIS,redis-users,REDIS_URL,redis://:user_cache_password@host.docker.internal:6379)
	$(call guard-shared-url,WITH_EVENTS,redis-events,EVENT_REDIS_URL,redis://:events_password@host.docker.internal:6381)
	$(call guard-shared-url,WITH_RABBITMQ,rabbitmq,RABBITMQ_URL,amqp://guest:guest@host.docker.internal:5672/)

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

# Containerized load testing: worker + proxy + k6 + isolated datastores.
# Usage: make load-test WORKER=payments VUS=10 DURATION=2m RPS=50
#        make load-test WORKER=cron SEED_COUNT=1000
# k6 exit code propagates (--exit-code-from k6), so threshold breaches fail.
# Load host ports default away from dev stacks so rigs run side by side.
LOAD_POSTGRES_PORT ?= 5440
LOAD_REDIS_PORT ?= 6490
LOAD_EVENTS_PORT ?= 6491
LOAD_RABBITMQ_PORT ?= 5690
LOAD_WORKER_PORT ?= 7199
LOAD_COMPOSE = docker compose --env-file $(ENV_FILE) -f infra/compose.load-$(WORKER).yml
# Host bindings for the rig (dev defaults are usually taken by dev stacks).
LOAD_RUN_ENV = POSTGRES_PORT=$(LOAD_POSTGRES_PORT) REDIS_PORT=$(LOAD_REDIS_PORT) \
	EVENT_REDIS_PORT=$(LOAD_EVENTS_PORT) RABBITMQ_PORT=$(LOAD_RABBITMQ_PORT) \
	WORKER_ANALYTICS_PORT=$(LOAD_WORKER_PORT) WORKER_CRON_PORT=$(LOAD_WORKER_PORT) \
	WORKER_PAYMENTS_PORT=$(LOAD_WORKER_PORT)

load-test: worker-%
	$(LOAD_COMPOSE) build
	$(LOAD_RUN_ENV) $(LOAD_COMPOSE) -f infra/compose.migrate.yml run --rm db-migrate
	$(LOAD_RUN_ENV) VUS=$(VUS) DURATION=$(DURATION) RPS=$(RPS) SEED_COUNT=$(SEED_COUNT) \
	$(LOAD_COMPOSE) up --build --abort-on-container-exit --exit-code-from k6

load-down: worker-%
	$(LOAD_COMPOSE) down -v --remove-orphans

# Legacy host runs (proxy on host + local k6 binary; prefer load-test above)
load-payments:
	@echo "Running Payments Load Test (VUS=$(VUS) RPS=$(RPS), DURATION=$(DURATION))..."
	VUS=$(VUS) RPS=$(RPS) DURATION=$(DURATION) k6 run src/tests/load/payments.k6.js

load-analytics:
	@echo "Running Analytics Load Test (VUS=$(VUS) RPS=$(RPS), DURATION=$(DURATION))..."
	VUS=$(VUS) RPS=$(RPS) DURATION=$(DURATION) k6 run src/tests/load/analytics.k6.js

load-cron:
	@echo "Running Cron Seed (SEED_COUNT=$(SEED_COUNT))..."
	SEED_COUNT=$(SEED_COUNT) k6 run src/tests/load/cron.k6.js

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

test-integration-ha:
	bun run test:integration:ha
