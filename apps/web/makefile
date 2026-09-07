# Start-only targets (no dev/HMR mode).
# Serving reads apps/web/.env (copy .env.example once). Preview runs
# on PREVIEW=true alone (canned defaults live in lib/config/env.ts). Load
# values are fixed inline below (LOAD_ENV) — reproducible, no env file.
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
	PREVIEW=true $(PREVIEW_COMPOSE) up -d --build --no-deps frontend

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

load-up:
	$(LOAD_ENV) $(LOAD_COMPOSE) up -d --build

load-down:
	$(LOAD_ENV) $(LOAD_COMPOSE) down --remove-orphans

load-test: load-down load-up
	@echo "Waiting for frontend to be ready..."
	@until $$(curl --output /dev/null --silent --head --fail http://localhost:3001); do \
		printf '.'; \
		sleep 2; \
	done
	@echo "\nRunning k6 load tests (VUS=$(VUS), DURATION=$(DURATION), SCRIPT=$(SCRIPT))..."
	$(LOAD_ENV) $(LOAD_COMPOSE) run --rm \
		-e VUS=$(VUS) \
		-e DURATION=$(DURATION) \
		k6 run /scripts/$(or $(SCRIPT),landing.k6.js)
	@$(MAKE) load-down
