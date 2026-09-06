# Start-only targets (no dev/HMR mode).
# Preview needs a single flick: `make preview` (PREVIEW=true via infra/.env.preview).
.PHONY: start preview preview-down down logs clean restart load-up load-down load-test

COMPOSE := docker compose -f infra/compose.yml
PREVIEW_COMPOSE := docker compose --env-file infra/.env.preview -f infra/compose.yml
LOAD_COMPOSE := docker compose -f infra/compose.load.yml
# Must match detect_ai_network in infra/.env.preview.
PREVIEW_NETWORK ?= detectai_net

start:
	@if [ ! -f .env ]; then echo "Missing apps/web/.env with real values (preview needs nothing: use 'make preview')."; exit 1; fi
	$(COMPOSE) up -d --build

preview:
	@docker network inspect $(PREVIEW_NETWORK) >/dev/null 2>&1 || docker network create $(PREVIEW_NETWORK)
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
