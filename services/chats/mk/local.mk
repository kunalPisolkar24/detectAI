.PHONY: tidy vet env run help-local

help-local:
	@echo "Local commands (mk/local.mk):"
	@echo "  tidy      resolve and update go.mod/go.sum"
	@echo "  vet       go vet ./..."
	@echo "  env       create .env from .env.example if missing"
	@echo "  run       run the API locally on the dev plane (infra/.env seeds the shell; the datastore and AWS endpoints are repainted to localhost for the host)"
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
	MONGO_URI=`echo "$$MONGO_URI" | sed 's/host\.docker\.internal/localhost/'`; \
	REDIS_ENDPOINT=`echo "$$REDIS_ENDPOINT" | sed 's/host\.docker\.internal/localhost/'`; \
	AWS_ENDPOINT_URL_SECRETS_MANAGER=`echo "$$AWS_ENDPOINT_URL_SECRETS_MANAGER" | sed 's/host\.docker\.internal/localhost/'`; \
	AWS_ENDPOINT_URL_SSM=`echo "$$AWS_ENDPOINT_URL_SSM" | sed 's/host\.docker\.internal/localhost/'`; \
	go run ./cmd/api
