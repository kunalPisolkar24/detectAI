.PHONY: compile install network dev prod build-dev build-prod down logs restart

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

restart: down dev