.PHONY: tidy vet env run help-local

help-local:
	@echo "Local commands (mk/local.mk):"
	@echo "  tidy      resolve and update go.mod/go.sum"
	@echo "  vet       go vet ./..."
	@echo "  env       create .env from .env.example if missing"
	@echo "  run       run the API locally (go run ./cmd/api, .env supplies the plane)"
	@echo ""

tidy:
	go mod tidy

vet:
	go vet ./...

env:
	@test -f .env || cp .env.example .env
	@echo ".env ready (edit .env to override)"

run:
	ENV_TYPE=dev go run ./cmd/api
