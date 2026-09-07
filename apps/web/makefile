# Start-only targets (no dev/HMR mode).
# Preview needs a single flick: `make preview` (PREVIEW=true via infra/.env.preview).
.PHONY: start preview preview-down down logs clean restart load-up load-down load-test

# Optional standalone datastores (postgres + user redis): `make start WITH_DATA=1`
# merges the atoms below into this project (shared default network, DNS by
# service name). The atoms are imported directly rather than via the data
# bundle because compose `include:` paths resolve from the main file, not
# the including file. Plain `make start` uses the datastore URLs from .env
# instead. Use the same flag on down/clean to include the data containers
# (clean -v removes their volumes too).
# NOTE: this block must stay above COMPOSE — COMPOSE uses immediate (:=)
# expansion, so DATA_COMPOSE has to be set first.
WITH_DATA ?= 0
DATA_COMPOSE := $(if $(filter 1 true yes,$(WITH_DATA)),-f ../../infra/docker/postgres/standalone.yml -f ../../infra/docker/redis/standalone.yml)

COMPOSE := docker compose -f infra/compose.yml $(DATA_COMPOSE)
PREVIEW_COMPOSE := docker compose --env-file infra/.env.preview -f infra/compose.yml
LOAD_COMPOSE := docker compose --env-file infra/.env.load -f infra/compose.load.yml

start:
	@if [ ! -f .env ]; then echo "Missing apps/web/.env with real values (preview needs nothing: use 'make preview')."; exit 1; fi
ifneq ($(DATA_COMPOSE),)
	$(COMPOSE) up -d --wait postgres redis-app
endif
	$(COMPOSE) up -d --build

preview:
	$(PREVIEW_COMPOSE) up -d --build --no-deps frontend

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
	$(LOAD_COMPOSE) up -d --build

load-down:
	$(LOAD_COMPOSE) down --remove-orphans

load-test: load-down load-up
	@echo "Waiting for frontend to be ready..."
	@until $$(curl --output /dev/null --silent --head --fail http://localhost:3001); do \
		printf '.'; \
		sleep 2; \
	done
	@echo "\nRunning k6 load tests (VUS=$(VUS), DURATION=$(DURATION), SCRIPT=$(SCRIPT))..."
	$(LOAD_COMPOSE) run --rm \
		-e VUS=$(VUS) \
		-e DURATION=$(DURATION) \
		k6 run /scripts/$(or $(SCRIPT),landing.k6.js)
	@$(MAKE) load-down
