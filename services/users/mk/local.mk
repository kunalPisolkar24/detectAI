SQLC_VERSION := v1.31.1
SQLC_BIN := $(shell go env GOPATH)/bin/sqlc

.PHONY: tidy vet env run sqlc-install sqlc-generate help-local

help-local:
	@echo "Local commands (mk/local.mk):"
	@echo "  tidy          resolve and update go.mod/go.sum"
	@echo "  vet           go vet ./..."
	@echo "  env           create infra/.env from infra/.env.example if missing"
	@echo "  run           run the API locally on the selected plane (infra/.env seeds the shell)"
	@echo "  sqlc-install  install the pinned sqlc CLI"
	@echo "  sqlc-generate generate Go code from migrations and queries"
	@echo ""

tidy:
	go mod tidy

vet:
	go vet ./...

env:
	@test -f infra/.env || cp infra/.env.example infra/.env
	@echo "infra/.env ready (edit infra/.env to override)"

run:
	@set -a; if [ -f infra/.env ]; then . infra/.env; fi; set +a; \
	go run ./cmd/api

sqlc-install:
	go install github.com/sqlc-dev/sqlc/cmd/sqlc@$(SQLC_VERSION)

sqlc-generate:
	$(SQLC_BIN) generate -f database/sqlc.yaml
