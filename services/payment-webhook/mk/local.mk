.PHONY: tidy vet env run help-local

help-local:
	@echo "Local commands (mk/local.mk):"
	@echo "  tidy      resolve and update go.mod/go.sum"
	@echo "  vet       go vet ./..."
	@echo "  env       create .env from .env.example if missing"
	@echo "  run       run the API locally on the dev plane (infra/.env seeds the shell; the queue URL is repainted to localhost for the host)"
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
	QUEUE_URL=`echo "$$QUEUE_URL" | sed 's/host\.docker\.internal/localhost/'`; \
	go run ./cmd/api
