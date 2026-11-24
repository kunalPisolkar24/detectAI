POSTGRES_ENV_FILE := $(if $(wildcard ../../infra/docker/postgres/.env),../../infra/docker/postgres/.env,../../infra/docker/postgres/.env.example)
POSTGRES_COMPOSE := docker compose --env-file $(POSTGRES_ENV_FILE) -f ../../infra/docker/postgres/compose.yml
POSTGRES_PORT_FILE := $(shell sed -n 's/^POSTGRES_PORT=//p' $(POSTGRES_ENV_FILE) 2>/dev/null)
POSTGRES_USER_FILE := $(shell sed -n 's/^POSTGRES_USER=//p' $(POSTGRES_ENV_FILE) 2>/dev/null)
POSTGRES_DB_FILE := $(shell sed -n 's/^POSTGRES_DB=//p' $(POSTGRES_ENV_FILE) 2>/dev/null)
POSTGRES_DSN := postgresql://$(or $(POSTGRES_USER),$(POSTGRES_USER_FILE),users):<password>@localhost:$(or $(POSTGRES_PORT),$(POSTGRES_PORT_FILE),5432)/$(or $(POSTGRES_DB),$(POSTGRES_DB_FILE),users_db)?sslmode=disable
REDIS_ENV_FILE := $(if $(wildcard ../../infra/docker/redis/.env),../../infra/docker/redis/.env,../../infra/docker/redis/.env.example)
REDIS_COMPOSE := docker compose --env-file $(REDIS_ENV_FILE) -f ../../infra/docker/redis/compose.yml
REDIS_PORT_FILE := $(shell sed -n 's/^REDIS_PORT=//p' $(REDIS_ENV_FILE) 2>/dev/null)

.PHONY: db-up db-down cache-up cache-down help-docker

help-docker:
	@echo "Docker commands (mk/docker.mk):"
	@echo "  db-up      start the local postgres (a running one is left untouched; port lives in infra/docker/postgres/.env)"
	@echo "  db-down    postgres compose down (the volume and its data stay)"
	@echo "  cache-up   start the local redis (a running one is left untouched; port lives in infra/docker/redis/.env)"
	@echo "  cache-down redis compose down (the cache is ephemeral — its contents go with it)"
	@echo ""

db-up:
	@if $(POSTGRES_COMPOSE) ps --services 2>/dev/null | grep -qx postgres; then \
		echo "postgres already running — left as-is"; \
	else \
		$(POSTGRES_COMPOSE) up -d --wait && echo "postgres up"; \
	fi
	@echo ""
	@echo "  addr    localhost:$(or $(POSTGRES_PORT),$(POSTGRES_PORT_FILE),5432)"
	@echo "  db      $(or $(POSTGRES_DB),$(POSTGRES_DB_FILE),users_db)"
	@echo "  user    $(or $(POSTGRES_USER),$(POSTGRES_USER_FILE),users)"
	@echo "  next    DATABASE_URL=$(POSTGRES_DSN) in infra/.env"

db-down:
	$(POSTGRES_COMPOSE) down --remove-orphans

cache-up:
	@if $(REDIS_COMPOSE) ps --services 2>/dev/null | grep -qx redis; then \
		echo "redis already running — left as-is"; \
	else \
		$(REDIS_COMPOSE) up -d --wait && echo "redis up"; \
	fi
	@echo ""
	@echo "  addr    localhost:$(or $(REDIS_PORT),$(REDIS_PORT_FILE),6379)"
	@echo "  next    add REDIS_ENDPOINT to infra/.env when the service reads it"

cache-down:
	$(REDIS_COMPOSE) down --remove-orphans
