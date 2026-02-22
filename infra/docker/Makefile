.PHONY: network up build down clean logs restart

network:
	@docker network inspect detect_ai_network >/dev/null 2>&1 || docker network create detect_ai_network

up: network
	docker compose -f compose.yml up -d

build: network
	docker compose -f compose.yml up -d --build

down:
	docker compose -f compose.yml down --remove-orphans

clean:
	docker compose -f compose.yml down -v --remove-orphans

logs:
	docker compose -f compose.yml logs -f

restart: down up