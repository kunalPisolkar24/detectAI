.PHONY: compile install network dev prod build-dev build-prod down logs restart clean

compile:
	pnpm build-start

install:
	pnpm install

network:
	@docker network inspect detect_ai_network >/dev/null 2>&1 || docker network create detect_ai_network

dev: network
	docker compose -f compose.yml -f compose.dev.yml up -d

prod: network
	docker compose -f compose.yml up -d

build-dev: network
	docker compose -f compose.yml -f compose.dev.yml up -d --build

build-prod: network
	docker compose -f compose.yml up -d --build

down:
	docker compose -f compose.yml -f compose.dev.yml down --remove-orphans

logs:
	docker compose -f compose.yml -f compose.dev.yml logs -f

clean:
	docker compose -f compose.yml -f compose.dev.yml down -v --remove-orphans

restart: down dev

# Load Testing
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