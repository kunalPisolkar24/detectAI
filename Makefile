.PHONY: network up build down clean logs shell-web

network:
	@docker network inspect detect_ai_network >/dev/null 2>&1 || docker network create detect_ai_network

up: network
	docker compose up -d

build: network
	docker compose up -d --build

down:
	docker compose down --remove-orphans

clean:
	docker compose down -v --remove-orphans

logs:
	docker compose logs -f

shell-web:
	docker compose exec frontend /bin/sh