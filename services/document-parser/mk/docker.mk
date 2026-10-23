COMPOSE := docker compose -f infra/compose.yml
PROJECT := detectai-document-parser

.PHONY: build up down logs ps

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
