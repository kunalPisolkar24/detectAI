MIGRATE_VERSION := v4.20.1
MIGRATE_BIN := $(shell go env GOPATH)/bin/migrate
MIGRATIONS_PATH := database/migrations
MIGRATE_ARGS := -path $(MIGRATIONS_PATH) -database "$$DATABASE_URL"

.PHONY: migrate-install migrate-check migrate-up migrate-down migrate-version migrate-create help-migrate

help-migrate:
	@echo "Migration commands (mk/migrate.mk):"
	@echo "  migrate-install   install the golang-migrate CLI pinned at $(MIGRATE_VERSION)"
	@echo "  migrate-up        apply all pending migrations"
	@echo "  migrate-down      roll back one migration"
	@echo "  migrate-version   show the current migration version"
	@echo "  migrate-create    create a paired up/down file: make migrate-create name=add_x"
	@echo ""

migrate-install:
	go install -tags 'postgres' github.com/golang-migrate/migrate/v4/cmd/migrate@$(MIGRATE_VERSION)

migrate-check:
	@test -x $(MIGRATE_BIN) || (echo "migrate CLI not installed; run make migrate-install" && exit 1)

migrate-up: migrate-check
	@set -a; . infra/.env; set +a; \
	$(MIGRATE_BIN) $(MIGRATE_ARGS) up

migrate-down: migrate-check
	@set -a; . infra/.env; set +a; \
	$(MIGRATE_BIN) $(MIGRATE_ARGS) down 1

migrate-version: migrate-check
	@set -a; . infra/.env; set +a; \
	$(MIGRATE_BIN) $(MIGRATE_ARGS) version

migrate-create: migrate-check
	@test -n "$(name)" || (echo "usage: make migrate-create name=<name>" && exit 1)
	$(MIGRATE_BIN) create -seq -digits 6 -dir $(MIGRATIONS_PATH) $(name)
