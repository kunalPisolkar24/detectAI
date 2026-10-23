ENV_FILE := $(if $(wildcard infra/.env),infra/.env,infra/.env.example)
COMPOSE := docker compose --env-file $(ENV_FILE) -f infra/compose.yml
PROJECT := detectai-document-parser

.PHONY: build up down logs ps help-docker

help-docker:
	@echo "Docker commands (mk/docker.mk):"
	@echo "  build     build the Docker image ($(PROJECT))"
	@echo "  up        compose up --build -d (shell PORT=... wins over env file)"
	@echo "  down      compose down"
	@echo "  logs      compose logs -f"
	@echo "  ps        compose ps"
	@echo ""

build:
	docker build -t $(PROJECT) .

up:
	$(COMPOSE) up --build -d
	$(COMPOSE) ps

down:
	$(COMPOSE) down --remove-orphans

logs:
	$(COMPOSE) logs -f document-parser

ps:
	$(COMPOSE) ps
