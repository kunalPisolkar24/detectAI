# Start-only targets (no dev/HMR mode).
# Serving reads apps/web/.env (copy .env.example once). Preview runs
# on ENV_TYPE=preview alone (canned defaults live in lib/config/schema.ts).
# Prod hydrates from AWS Secrets Manager + SSM at runtime (see .env.example).
# Load values are fixed inline below (LOAD_ENV) — reproducible, no env file.
.PHONY: start preview preview-down down logs clean restart load-up load-down load-test

# Datastores (postgres + user redis) are included in infra/compose.yml and
# always start with the web stack. `down` stops them; `clean -v` removes
# their volumes too.
COMPOSE := docker compose --env-file .env -f infra/compose.yml
PREVIEW_COMPOSE := docker compose -f infra/compose.yml
LOAD_COMPOSE := docker compose -f infra/compose.load.yml
# Datastore values for the shared atoms in compose.load.yml. Must match the
# hardcoded frontend URLs there (db name, redis password).
LOAD_ENV := POSTGRES_USER=postgres POSTGRES_PASSWORD=postgres POSTGRES_DB=detectai_load POSTGRES_PORT=5433 REDIS_PASSWORD=load-redis-password REDIS_PORT=6380

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
.PHONY: load-up load-down load-test

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

load-up:
	$(LOAD_ENV) $(LOAD_COMPOSE_ACTIVE) up -d --build

load-down:
	$(LOAD_ENV) $(LOAD_COMPOSE_OBS) down -v --remove-orphans

load-test:
	@if [ "$(WITH_OBSERVABILITY)" != "0" ] && [ "$(WITH_OBSERVABILITY)" != "1" ]; then \
		echo "Invalid WITH_OBSERVABILITY '$(WITH_OBSERVABILITY)'. Use 0 or 1."; exit 1; \
	fi
	@if [ "$(WITH_OBSERVABILITY)" = "1" ]; then \
		if [ -z "$${NEW_RELIC_LICENSE_KEY:-}" ]; then \
			echo "WITH_OBSERVABILITY=1 but NEW_RELIC_LICENSE_KEY is empty — collector will retry/drop, app keeps serving."; \
		fi; \
	fi
	$(MAKE) load-down
	$(MAKE) load-up
	@echo "Waiting for frontend to be ready..."
	@until $$(curl --output /dev/null --silent --head --fail http://localhost:3001); do \
		printf '.'; \
		sleep 2; \
	done
	@echo "\nRunning k6 load tests (VUS=$(VUS), DURATION=$(DURATION), SCRIPT=$(SCRIPT))..."
	$(LOAD_ENV) $(LOAD_COMPOSE_ACTIVE) run --rm \
		-e VUS=$(VUS) \
		-e DURATION=$(DURATION) \
		k6 run /scripts/$(or $(SCRIPT),landing.k6.js)
	@$(MAKE) load-down
