ENV_FILE := $(if $(wildcard infra/.env),infra/.env,infra/.env.example)
COMPOSE := docker compose --env-file $(ENV_FILE) -f infra/compose.yml
PROJECT := detectai-document-parser

.PHONY: build up down logs ps parser-build parser-up parser-down help-docker

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

# Aliases the root e2e harness calls by name (e2e/Makefile SERVICE_UP_*
# and SERVICE_DOWN_*); they are the same commands as build/up/down.
parser-build:
	docker build -t $(PROJECT) .

parser-up:
	$(COMPOSE) up --build -d

parser-down:
	$(COMPOSE) down --remove-orphans
