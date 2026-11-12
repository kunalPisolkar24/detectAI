MONGO_ENV_FILE := $(if $(wildcard ../../infra/docker/mongo/.env),../../infra/docker/mongo/.env,../../infra/docker/mongo/.env.example)
MONGO_COMPOSE := docker compose --env-file $(MONGO_ENV_FILE) -f ../../infra/docker/mongo/compose.yml
MONGO_PORT_FILE := $(shell sed -n 's/^MONGO_PORT=//p' $(MONGO_ENV_FILE) 2>/dev/null)

.PHONY: db-up db-down clean help-docker

help-docker:
	@echo "Docker commands (mk/docker.mk):"
	@echo "  db-up      start the local mongo (a running one is left untouched; port lives in infra/docker/mongo/.env)"
	@echo "  db-down    mongo compose down (the volume and its data stay)"
	@echo "  clean      db-down + drop the volume (the data goes with it)"
	@echo ""

db-up:
	@if $(MONGO_COMPOSE) ps --services 2>/dev/null | grep -qx mongo; then \
		echo "mongo already running — left as-is"; \
	else \
		$(MONGO_COMPOSE) up -d --wait && echo "mongo up"; \
	fi
	@echo ""
	@echo "  uri     mongodb://localhost:$(or $(MONGO_PORT),$(MONGO_PORT_FILE),27017)"
	@echo "  next    MONGO_URI=mongodb://localhost:$(or $(MONGO_PORT),$(MONGO_PORT_FILE),27017) MONGO_DATABASE=chat_db in infra/.env, then make run"

db-down:
	$(MONGO_COMPOSE) down --remove-orphans

clean:
	$(MONGO_COMPOSE) down --remove-orphans --volumes
