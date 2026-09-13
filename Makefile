SHELL := /bin/sh
.DEFAULT_GOAL := help

PROD_ENV := infra/docker/prod/.env
PROD_ENV_EXAMPLE := infra/docker/prod/.env.example
PROD_COMPOSE_FILE := infra/docker/prod/compose.yml
PROD_FLOCI_COMPOSE_FILE := infra/docker/prod/compose.floci.yml
LOCAL_ENV := infra/docker/local/.env
LOCAL_ENV_EXAMPLE := infra/docker/local/.env.example
LOCAL_COMPOSE_FILE := infra/docker/local/compose.yml

FLOCI_ENDPOINT ?= http://localhost:4566
FLOCI_NETWORK ?= documents_default
AWS_REGION ?= ap-south-1

DOCKER_BIN := $(strip $(shell command -v docker 2>/dev/null))
DOCKER_BIN := $(if $(DOCKER_BIN),$(DOCKER_BIN),docker)

PROD_COMPOSE := $(DOCKER_BIN) compose --env-file $(PROD_ENV) -f $(PROD_COMPOSE_FILE)
PROD_COMPOSE_FLOCI := $(DOCKER_BIN) compose --env-file $(PROD_ENV) -f $(PROD_COMPOSE_FILE) -f $(PROD_FLOCI_COMPOSE_FILE)
LOCAL_COMPOSE := $(DOCKER_BIN) compose --env-file $(LOCAL_ENV) -f $(LOCAL_COMPOSE_FILE)

STACK ?=
SERVICE ?=
SERVICE_ARGS := $(strip $(SERVICE))
DETECT_AI_NETWORK := $(strip $(shell awk -F= '/^DETECT_AI_NETWORK=/{print $$2; exit}' $(PROD_ENV) 2>/dev/null))
DETECT_AI_NETWORK := $(if $(DETECT_AI_NETWORK),$(DETECT_AI_NETWORK),detect-ai-network)

.PHONY: help network validate-stack ensure-local-env ensure-prod-env guard-local guard-prod \
	up down logs clean build rebuild shell-web \
	prod-up prod-down prod-logs prod-clean prod-build prod-rebuild prod-config prod-ps prod-migrate \
	prod-up-floci prod-config-floci \
	local-up local-down local-logs local-clean local-build local-rebuild local-config local-ps \
	tf-fmt tf-validate tf-test tf-plan-local tf-apply-local tf-destroy-local floci-seed floci-verify

help:
	@printf "\nDetect AI Docker commands\n\n"
	@printf "Production\n"
	@printf "  make up                Start the prod stack\n"
	@printf "  make down              Stop the prod stack\n"
	@printf "  make logs [SERVICE=x]  Stream prod logs\n"
	@printf "  make clean             Stop prod and remove volumes\n"
	@printf "  make prod-up           Start the prod stack\n"
	@printf "  make prod-down         Stop the prod stack\n"
	@printf "  make prod-logs         Stream prod logs\n"
	@printf "  make prod-clean        Stop prod and remove volumes\n"
	@printf "  make prod-build        Build prod images\n"
	@printf "  make prod-rebuild      Rebuild prod images without cache\n"
	@printf "  make prod-config       Render prod compose config\n"
	@printf "  make prod-ps           Show prod containers\n"
	@printf "  make prod-migrate      Run prod DB migrations once\n\n"
	@printf "Local\n"
	@printf "  make local-up          Start the local stack\n"
	@printf "  make local-down        Stop the local stack\n"
	@printf "  make local-logs        Stream local logs\n"
	@printf "  make local-clean       Stop local and remove volumes\n"
	@printf "  make local-build       Build local images\n"
	@printf "  make local-rebuild     Rebuild local images without cache\n"
	@printf "  make local-config      Render local compose config\n"
	@printf "  make local-ps          Show local containers\n\n"
	@printf "Generic\n"
	@printf "  make build STACK=prod|local [SERVICE=name]\n"
	@printf "  make rebuild STACK=prod|local [SERVICE=name]\n"
	@printf "  make shell-web         Open a shell in the prod frontend container\n\n"
	@printf "Examples\n"
	@printf "  make build STACK=prod SERVICE=frontend\n"
	@printf "  make build STACK=local SERVICE=frontend\n"
	@printf "  make prod-logs SERVICE=worker-analytics\n"
	@printf "  make local-logs SERVICE=frontend\n\n"
	@printf "Terraform (infra/terraform, Floci/LocalStack on localhost:4566)\n"
	@printf "  make tf-fmt            Check terraform formatting\n"
	@printf "  make tf-validate       init + validate + test (mocked)\n"
	@printf "  make tf-test           terraform test (unit, mocked)\n"
	@printf "  make tf-plan-local     plan with envs/floci-local.tfvars\n"
	@printf "  make tf-apply-local    apply with envs/floci-local.tfvars\n"
	@printf "  make tf-destroy-local  destroy with envs/floci-local.tfvars\n\n"
	@printf "Floci (FLOCI_ENDPOINT=$(FLOCI_ENDPOINT))\n"
	@printf "  make floci-seed        Seed app-only secrets Floci doesn't TF-manage\n"
	@printf "  make floci-verify      Check emulator APIs + secrets exist\n"
	@printf "  make prod-up-floci     Start prod stack attached to FLOCI_NETWORK\n"
	@printf "  make prod-config-floci Render prod+Floci merged compose config\n\n"
	@printf "Setup\n"
	@printf "  cp infra/docker/local/.env.example infra/docker/local/.env\n"
	@printf "  cp infra/docker/prod/.env.example infra/docker/prod/.env\n"
	@printf "  (up/build/config targets do this automatically when .env is missing)\n\n"

ensure-local-env:
	@if [ ! -f "$(LOCAL_ENV)" ]; then \
		echo "Creating $(LOCAL_ENV) from example (edit it for real secrets)."; \
		cp "$(LOCAL_ENV_EXAMPLE)" "$(LOCAL_ENV)"; \
	fi

ensure-prod-env:
	@if [ ! -f "$(PROD_ENV)" ]; then \
		echo "Creating $(PROD_ENV) from example (fill DATABASE_URL from terraform output)."; \
		cp "$(PROD_ENV_EXAMPLE)" "$(PROD_ENV)"; \
	fi

# Single-stack rule: local and prod must never run at the same time.
guard-local:
	@if [ -f "$(PROD_ENV)" ] && [ -n "$$($(PROD_COMPOSE) ps -q 2>/dev/null)" ]; then \
		echo "Refusing: prod stack is running. Run 'make prod-down' first."; \
		exit 1; \
	fi

guard-prod:
	@if [ -f "$(LOCAL_ENV)" ] && [ -n "$$($(LOCAL_COMPOSE) ps -q 2>/dev/null)" ]; then \
		echo "Refusing: local stack is running. Run 'make local-down' first."; \
		exit 1; \
	fi

network:
	@$(DOCKER_BIN) network inspect $(DETECT_AI_NETWORK) >/dev/null 2>&1 || $(DOCKER_BIN) network create $(DETECT_AI_NETWORK)

validate-stack:
	@if [ -z "$(STACK)" ]; then \
		echo "STACK is required. Use STACK=prod or STACK=local."; \
		exit 1; \
	fi
	@if [ "$(STACK)" != "prod" ] && [ "$(STACK)" != "local" ]; then \
		echo "Invalid STACK '$(STACK)'. Use STACK=prod or STACK=local."; \
		exit 1; \
	fi

up: prod-up

down: prod-down

logs: prod-logs

clean: prod-clean

build: validate-stack
	@$(MAKE) --no-print-directory $(STACK)-build SERVICE="$(SERVICE)"

rebuild: validate-stack
	@$(MAKE) --no-print-directory $(STACK)-rebuild SERVICE="$(SERVICE)"

prod-up: ensure-prod-env guard-prod network
	$(PROD_COMPOSE) up -d

prod-down:
	$(PROD_COMPOSE) down --remove-orphans

prod-logs:
	$(PROD_COMPOSE) logs -f $(SERVICE_ARGS)

prod-clean:
	$(PROD_COMPOSE) down -v --remove-orphans

prod-build: ensure-prod-env
	$(PROD_COMPOSE) build $(SERVICE_ARGS)

prod-rebuild: ensure-prod-env
	$(PROD_COMPOSE) build --no-cache $(SERVICE_ARGS)

prod-config: ensure-prod-env
	$(PROD_COMPOSE) config

prod-ps:
	$(PROD_COMPOSE) ps

prod-migrate: ensure-prod-env guard-prod network
	$(PROD_COMPOSE) run --rm db-migrate

# Floci variants: same project, plus the emulator backing network.
# down/logs/ps/clean work with the base targets (project name is identical).
prod-up-floci: ensure-prod-env guard-prod network
	$(PROD_COMPOSE_FLOCI) up -d

prod-config-floci: ensure-prod-env
	$(PROD_COMPOSE_FLOCI) config

local-up: ensure-local-env guard-local
	$(LOCAL_COMPOSE) up -d

local-down:
	$(LOCAL_COMPOSE) down --remove-orphans

local-logs:
	$(LOCAL_COMPOSE) logs -f $(SERVICE_ARGS)

local-clean:
	$(LOCAL_COMPOSE) down -v --remove-orphans

local-build: ensure-local-env
	$(LOCAL_COMPOSE) build $(SERVICE_ARGS)

local-rebuild: ensure-local-env
	$(LOCAL_COMPOSE) build --no-cache $(SERVICE_ARGS)

local-config: ensure-local-env
	$(LOCAL_COMPOSE) config

local-ps:
	$(LOCAL_COMPOSE) ps

shell-web:
	$(PROD_COMPOSE) exec frontend /bin/sh

# Terraform — floci/localstack on localhost:4566, no AWS
TF_DIR := infra/terraform
TF_VARS_LOCAL := envs/floci-local.tfvars

tf-fmt:
	terraform -chdir=$(TF_DIR) fmt -check -recursive -diff

tf-validate:
	terraform -chdir=$(TF_DIR) init -backend=false
	terraform -chdir=$(TF_DIR) validate
	terraform -chdir=$(TF_DIR) test

tf-test:
	terraform -chdir=$(TF_DIR) test

tf-plan-local:
	terraform -chdir=$(TF_DIR) init -reconfigure -backend-config=backend.local-s3.hcl
	terraform -chdir=$(TF_DIR) plan -var-file=$(TF_VARS_LOCAL)

tf-apply-local:
	terraform -chdir=$(TF_DIR) init -reconfigure -backend-config=backend.local-s3.hcl
	terraform -chdir=$(TF_DIR) apply -var-file=$(TF_VARS_LOCAL)

tf-destroy-local:
	terraform -chdir=$(TF_DIR) init -reconfigure -backend-config=backend.local-s3.hcl
	terraform -chdir=$(TF_DIR) destroy -var-file=$(TF_VARS_LOCAL)

# Seed app-only secrets on Floci (Terraform manages detectai/{pg,docdb,
# redis/*/mq}/urls; these it does NOT). One random value per shared key is
# generated once and stored in every secret that needs it, so web/gateway/
# inference stay in sync. Idempotent: creates or overwrites in place.
# Override endpoint: make floci-seed FLOCI_ENDPOINT=http://host:4566
floci-seed:
	@EP="$(FLOCI_ENDPOINT)"; R="$(AWS_REGION)"; \
	randhex() { openssl rand -hex "$$1" 2>/dev/null || od -An -tx1 -N "$$1" /dev/urandom | tr -d ' \n'; }; \
	INTERNAL_KEY="$$(randhex 24)"; AI_KEY="$$(randhex 24)"; HOOK_SECRET="$$(randhex 24)"; AUTH_SECRET="$$(randhex 32)"; \
	put_secret() { \
		name="$$1"; payload="$$2"; \
		if aws --endpoint-url "$$EP" --region "$$R" secretsmanager describe-secret --secret-id "$$name" >/dev/null 2>&1; then \
			aws --endpoint-url "$$EP" --region "$$R" secretsmanager put-secret-value --secret-id "$$name" --secret-string "$$payload" >/dev/null; \
		else \
			aws --endpoint-url "$$EP" --region "$$R" secretsmanager create-secret --name "$$name" --secret-string "$$payload" >/dev/null; \
		fi; \
		echo "seeded $$name"; \
	}; \
	put_secret "detectai/web/secrets" "{\"NEXTAUTH_SECRET\":\"$$AUTH_SECRET\",\"INTERNAL_API_KEY\":\"$$INTERNAL_KEY\",\"AI_SERVICE_API_KEY\":\"$$AI_KEY\",\"NEXT_PUBLIC_TURNSTILE_SITE_KEY\":\"1x00000000000000000000AA\",\"TURNSTILE_SECRET_KEY\":\"1x00000000000000000000AA\",\"NEXT_PUBLIC_PADDLE_CLIENT_TOKEN\":\"mock-paddle-client-token-not-configured\"}"; \
	put_secret "detectai/gateway/secrets" "{\"PADDLE_WEBHOOK_SECRET\":\"$$HOOK_SECRET\",\"INTERNAL_API_KEY\":\"$$INTERNAL_KEY\"}"; \
	put_secret "detectai/workers/secrets" "{\"PADDLE_API_KEY\":\"mock-paddle-api-key-not-configured\",\"PADDLE_ENVIRONMENT\":\"sandbox\"}"; \
	put_secret "detectai/inference/secrets" "{\"API_KEY\":\"$$AI_KEY\"}"; \
	echo "Done. INTERNAL_API_KEY/AI_SERVICE_API_KEY are in sync across web/gateway/inference."

# Verify the emulator has the TF-managed infra + seeded secrets.
floci-verify:
	@EP="$(FLOCI_ENDPOINT)"; R="$(AWS_REGION)"; \
	echo "== emulator health: $$EP"; \
	curl -fsS "$$EP/_localstack/health" | head -c 400; echo; \
	echo "== rds clusters:"; \
	aws --endpoint-url "$$EP" --region "$$R" rds describe-db-clusters --query 'DBClusters[].DBClusterIdentifier' --output text; \
	echo "== docdb clusters:"; \
	aws --endpoint-url "$$EP" --region "$$R" docdb describe-db-clusters --query 'DBClusters[].DBClusterIdentifier' --output text; \
	echo "== elasticache groups:"; \
	aws --endpoint-url "$$EP" --region "$$R" elasticache describe-replication-groups --query 'ReplicationGroups[].ReplicationGroupId' --output text; \
	echo "== mq brokers:"; \
	aws --endpoint-url "$$EP" --region "$$R" mq list-brokers --query 'BrokerSummaries[].BrokerName' --output text; \
	echo "== secrets:"; \
	aws --endpoint-url "$$EP" --region "$$R" secretsmanager list-secrets --query 'SecretList[].Name' --output text
