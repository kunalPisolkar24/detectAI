# Local Development Targets
.PHONY: dev build-dev down logs clean restart

dev:
	docker compose -f compose.yml -f compose.dev.yml up -d

build-dev:
	docker compose -f compose.yml -f compose.dev.yml up -d --build

down:
	docker compose -f compose.yml -f compose.dev.yml down --remove-orphans

logs:
	docker compose -f compose.yml -f compose.dev.yml logs -f

clean:
	docker compose -f compose.yml -f compose.dev.yml down -v --remove-orphans

restart: down dev

# Preview Mode Targets (frontend-only, no backend)
# Bare metal (no Docker): pnpm preview:dev  → HMR dev | pnpm preview:build && pnpm preview:start → prod
# Docker (no local Node): make preview / make preview-build
.PHONY: preview preview-build preview-down preview-logs preview-clean preview-restart preview-dev preview-build-standalone preview-start

preview:
	docker compose -f compose.preview.yml up -d

preview-build:
	docker compose -f compose.preview.yml up -d --build

preview-down:
	docker compose -f compose.preview.yml down --remove-orphans

preview-logs:
	docker compose -f compose.preview.yml logs -f

preview-clean:
	docker compose -f compose.preview.yml down -v --remove-orphans

preview-restart: preview-down preview

preview-dev:
	pnpm preview:dev

preview-build-standalone:
	pnpm preview:build

preview-start:
	pnpm preview:start

# Load Testing Targets
.PHONY: load-up load-down load-test

load-up:
	docker compose -f compose.load.yml up -d --build

load-down:
	docker compose -f compose.load.yml down --remove-orphans

load-test: load-down load-up
	@echo "Waiting for frontend to be ready..."
	@until $$(curl --output /dev/null --silent --head --fail http://localhost:3001); do \
		printf '.'; \
		sleep 2; \
	done
	@echo "\nRunning k6 load tests (VUS=$(VUS), DURATION=$(DURATION), SCRIPT=$(SCRIPT))..."
	docker compose -f compose.load.yml run --rm \
		-e VUS=$(VUS) \
		-e DURATION=$(DURATION) \
		k6 run /scripts/$(or $(SCRIPT),landing.k6.js)
	@$(MAKE) load-down