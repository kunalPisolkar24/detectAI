MONGO_ENV_FILE := $(if $(wildcard ../../infra/docker/mongo/.env),../../infra/docker/mongo/.env,../../infra/docker/mongo/.env.example)
MONGO_COMPOSE := docker compose --env-file $(MONGO_ENV_FILE) -f ../../infra/docker/mongo/compose.yml
MONGO_PORT_FILE := $(shell sed -n 's/^MONGO_PORT=//p' $(MONGO_ENV_FILE) 2>/dev/null)
REDIS_ENV_FILE := $(if $(wildcard ../../infra/docker/redis/.env),../../infra/docker/redis/.env,../../infra/docker/redis/.env.example)
REDIS_COMPOSE := docker compose --env-file $(REDIS_ENV_FILE) -f ../../infra/docker/redis/compose.yml
REDIS_PORT_FILE := $(shell sed -n 's/^REDIS_PORT=//p' $(REDIS_ENV_FILE) 2>/dev/null)

.PHONY: db-up db-down cache-up cache-down clean help-docker

help-docker:
	@echo "Docker commands (mk/docker.mk):"
	@echo "  db-up      start the local mongo (a running one is left untouched; port lives in infra/docker/mongo/.env)"
	@echo "  db-down    mongo compose down (the volume and its data stay)"
	@echo "  cache-up   start the local redis (a running one is left untouched; port lives in infra/docker/redis/.env)"
	@echo "  cache-down redis compose down (the cache is ephemeral — its contents go with it)"
	@echo "  clean      db-down + cache-down + drop the mongo volume (the data goes with it)"
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

cache-up:
	@if $(REDIS_COMPOSE) ps --services 2>/dev/null | grep -qx redis; then \
		echo "redis already running — left as-is"; \
	else \
		$(REDIS_COMPOSE) up -d --wait && echo "redis up"; \
	fi
	@echo ""
	@echo "  addr    localhost:$(or $(REDIS_PORT),$(REDIS_PORT_FILE),6379)"
	@echo "  next    CHAT_REDIS_ADDR=localhost:$(or $(REDIS_PORT),$(REDIS_PORT_FILE),6379) in infra/.env, then make run"

cache-down:
	$(REDIS_COMPOSE) down --remove-orphans

clean:
	$(MONGO_COMPOSE) down --remove-orphans --volumes
	$(REDIS_COMPOSE) down --remove-orphans --volumes
