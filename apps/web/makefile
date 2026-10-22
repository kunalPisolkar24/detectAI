# Start-only targets (no dev/HMR mode).
# Serving reads apps/web/.env (copy .env.example once). Preview runs
# on ENV_TYPE=preview alone (canned defaults live in lib/config/schema.ts).
# Prod hydrates from AWS Secrets Manager + SSM at runtime (see .env.example).
# Load values are fixed inline below (LOAD_ENV) — reproducible, no env file.
.PHONY: start preview preview-down down logs clean restart load-up load-down load-test load-suite

# Datastores (postgres + user redis) are included in infra/compose.yml and
# always start with the web stack. `down` stops them; `clean -v` removes
# their volumes too.
COMPOSE := docker compose --env-file .env -f infra/compose.yml
PREVIEW_COMPOSE := docker compose -f infra/compose.yml
LOAD_COMPOSE := docker compose -f infra/compose.load.yml
# The abuse limiter caps how fast one account may analyze. Every scenario
# but the rate-limit one runs with it out of the way, so a throughput run
# measures the service rather than the limiter. The rate-limit scenario
# needs it at a value its assertions can reason about: a small limit to
# trip the limiter itself, a large one to leave the daily cap as the only
# limiter standing.
RATE_LIMIT_SCRIPT := chat-api-rate-limit.k6.js
RATE_LIMIT_CASE ?= abuse
ifneq ($(filter $(RATE_LIMIT_SCRIPT),$(SCRIPT)),)
ifeq ($(RATE_LIMIT_CASE),daily)
ABUSE_RATE_LIMIT_ANALYZE_MAX ?= 10000
else
ABUSE_RATE_LIMIT_ANALYZE_MAX ?= 5
endif
else
ABUSE_RATE_LIMIT_ANALYZE_MAX ?= 10000
endif
ABUSE_RATE_LIMIT_ANALYZE_WINDOW_MS ?= 60000

# Datastore values for the shared atoms in compose.load.yml. Must match the
# hardcoded frontend URLs there (db name, redis password).
LOAD_ENV := POSTGRES_USER=postgres POSTGRES_PASSWORD=postgres POSTGRES_DB=detectai_load POSTGRES_PORT=5433 REDIS_PASSWORD=load-redis-password REDIS_PORT=6380 ABUSE_RATE_LIMIT_ANALYZE_MAX=$(ABUSE_RATE_LIMIT_ANALYZE_MAX) ABUSE_RATE_LIMIT_ANALYZE_WINDOW_MS=$(ABUSE_RATE_LIMIT_ANALYZE_WINDOW_MS)

start:
	@if [ ! -f .env ]; then echo "Missing apps/web/.env (copy .env.example once and adjust secrets)."; exit 1; fi
	$(COMPOSE) up -d --build

preview:
	ENV_TYPE=preview $(PREVIEW_COMPOSE) up -d --build --no-deps frontend

preview-down:
	$(PREVIEW_COMPOSE) down --remove-orphans

down:
	$(COMPOSE) down --remove-orphans

logs:
	$(COMPOSE) logs -f

clean:
	$(COMPOSE) down -v --remove-orphans

restart: down start

# Load Testing Targets
.PHONY: load-up load-down load-down-remote load-test

# Opt-in observability: make load-test WITH_OBSERVABILITY=1
# Adds otel-collector-loadtest (-> New Relic EU as deployment.environment=loadtest)
# and points the frontend's OTLP exporter at it. Needs NEW_RELIC_LICENSE_KEY in
# the shell; without a key the collector retries and drops while the app keeps
# serving, so a failed export never fails a run. Default runs stay offline.
# -f paths resolve from the makefile's cwd (apps/web); the volume path inside
# the overlay resolves from the project dir (apps/web/infra).
LOAD_COMPOSE_OBS := $(LOAD_COMPOSE) \
	-f ../../infra/docker/otel/loadtest-observability.yml \
	-f ../../infra/docker/postgres-exporter/standalone.yml \
	-f ../../infra/docker/redis-exporter/standalone.yml \
	-f ../../infra/docker/rabbitmq-exporter/standalone.yml \
	-f infra/compose.load.observability.yml
WITH_OBSERVABILITY ?= 0
# The set actually used for this run.
LOAD_COMPOSE_ACTIVE = $(if $(filter 1,$(WITH_OBSERVABILITY)),$(LOAD_COMPOSE_OBS),$(LOAD_COMPOSE))
# Remote mode points the load test at a deployment that is already running
# instead of starting the rig. The endpoint and the credentials come from
# TARGET_ENV_FILE (see e2e/targets/.env.example). Nothing is provisioned in
# remote mode: the runner starts with --no-deps, so the frontend and its
# datastores stay down. The target's own stack exports its telemetry, so
# WITH_OBSERVABILITY does not apply here.
REMOTE ?= 0
TARGET_ENV_FILE ?=
# The rig's compose project is "web-load"; the remote run gets its own
# project so it can never touch a running local rig.
LOAD_REMOTE_PROJECT := e2e-web

load-up:
	$(LOAD_ENV) $(LOAD_COMPOSE_ACTIVE) up -d --build

load-down:
	$(LOAD_ENV) $(LOAD_COMPOSE_OBS) down -v --remove-orphans

# Remove the remote compose project: a `run --rm --no-deps` leaves its network
# and the datastore volumes behind. Kept apart from load-down so tearing down
# a remote run never touches the local rig's volumes.
load-down-remote:
	$(LOAD_COMPOSE) -p $(LOAD_REMOTE_PROJECT) down -v --remove-orphans

# The scripts the suite runs, each in its own rig. A fresh rig per script
# keeps the counters the scenarios drive (usage, abuse) from one run leaking
# into the next. The rate-limit scenario runs twice: the abuse limiter and
# the daily cap need different settings to be the one that refuses.
LOAD_SUITE := landing.k6.js chat-api.k6.js chat-api-invalid.k6.js auth.k6.js chat-api-session.k6.js
LOAD_SUITE_RATE_LIMIT := chat-api-rate-limit.k6.js

# Each run leaves its summary behind in the results volume.
SCRIPT_FILE := $(or $(SCRIPT),landing.k6.js)
SCRIPT_NAME := $(patsubst %.k6.js,%,$(notdir $(SCRIPT_FILE)))
SUMMARY_FILE := /results/$(SCRIPT_NAME)-$(shell date +%Y%m%d-%H%M%S).json

load-test:
	@if [ "$(WITH_OBSERVABILITY)" != "0" ] && [ "$(WITH_OBSERVABILITY)" != "1" ]; then \
		echo "Invalid WITH_OBSERVABILITY '$(WITH_OBSERVABILITY)'. Use 0 or 1."; exit 1; \
	fi
	@if [ "$(REMOTE)" = "1" ]; then \
		$(MAKE) --no-print-directory _load-test-remote; \
	else \
		$(MAKE) --no-print-directory _load-test-local; \
	fi

# The runner against a deployment that is already running. The endpoint and
# the credentials come from TARGET_ENV_FILE; the frontend and its datastores
# are never started.
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
	@if [ "$(SCRIPT_NAME)" = "chat-api-rate-limit" ]; then \
		echo "chat-api-rate-limit needs the abuse limiter's own setting on the frontend, so it only works against the rig."; exit 1; \
	fi
	@mkdir -p test/load/results
	@# The k6 container writes the run summaries as its own user, so the
	@# directory has to be open to it.
	@chmod 777 test/load/results
	@echo "\nRunning k6 load tests against $(TARGET_ENV_FILE) (SCRIPT=$(SCRIPT_FILE), SCENARIO=$(or $(SCENARIO),load), VUS=$(VUS), DURATION=$(DURATION))..."
	$(LOAD_COMPOSE) --env-file $(TARGET_ENV_FILE) -p $(LOAD_REMOTE_PROJECT) run --rm --no-deps \
		-e VUS=$(VUS) \
		-e DURATION=$(DURATION) \
		-e SCENARIO=$(SCENARIO) \
		-e RATE_LIMIT_CASE=$(RATE_LIMIT_CASE) \
		k6 run --summary-export=$(SUMMARY_FILE) /scripts/$(SCRIPT_FILE)

# The rig: a throwaway stack, the frontend in it, and the runner against it.
_load-test-local:
	@if [ "$(WITH_OBSERVABILITY)" = "1" ]; then \
		if [ -z "$${NEW_RELIC_LICENSE_KEY:-}" ]; then \
			echo "WITH_OBSERVABILITY=1 but NEW_RELIC_LICENSE_KEY is empty — collector will retry/drop, app keeps serving."; \
		fi; \
	fi
	@mkdir -p test/load/results
	@# The k6 container writes the run summaries as its own user, so the
	@# directory has to be open to it.
	@chmod 777 test/load/results
	$(MAKE) load-down
	$(MAKE) load-up
	@echo "Waiting for frontend to be ready..."
	@until $$(curl --output /dev/null --silent --head --fail http://localhost:3001); do \
		printf '.'; \
		sleep 2; \
	done
	@echo "\nRunning k6 load tests (SCRIPT=$(or $(SCRIPT),landing.k6.js), SCENARIO=$(or $(SCENARIO),load), VUS=$(VUS), DURATION=$(DURATION))..."
	@status=0; \
	$(LOAD_ENV) $(LOAD_COMPOSE_ACTIVE) run --rm \
		-e VUS=$(VUS) \
		-e DURATION=$(DURATION) \
		-e SCENARIO=$(SCENARIO) \
		-e BASE_URL=http://frontend:3000 \
		-e INTERNAL_KEY=load-test-key \
		-e RATE_LIMIT_CASE=$(RATE_LIMIT_CASE) \
		k6 run --summary-export=$(SUMMARY_FILE) /scripts/$(or $(SCRIPT),landing.k6.js) || status=$$?; \
	echo ""; \
	echo "Run summary written to test/load/results/$(notdir $(SUMMARY_FILE))"; \
	$(MAKE) load-down; \
	exit $$status

load-suite:
	@set -e; \
	for script in $(LOAD_SUITE); do \
		echo ""; \
		echo "=== $$script ==="; \
		$(MAKE) load-test SCRIPT=$$script; \
	done; \
	for rate_limit_case in abuse daily; do \
		echo ""; \
		echo "=== $(LOAD_SUITE_RATE_LIMIT) ($$rate_limit_case) ==="; \
		$(MAKE) load-test SCRIPT=$(LOAD_SUITE_RATE_LIMIT) RATE_LIMIT_CASE=$$rate_limit_case; \
	done
