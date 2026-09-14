SHELL := /bin/sh
.DEFAULT_GOAL := help

PROD_ENV := infra/docker/prod/.env
PROD_ENV_EXAMPLE := infra/docker/prod/.env.example
PROD_COMPOSE_FILE := infra/docker/prod/compose.yml
PROD_FLOCI_COMPOSE_FILE := infra/docker/prod/compose.floci.yml
PROD_GPU_COMPOSE_FILE := infra/docker/prod/compose.gpu.yml
LOCAL_ENV := infra/docker/local/.env
LOCAL_ENV_EXAMPLE := infra/docker/local/.env.example
LOCAL_COMPOSE_FILE := infra/docker/local/compose.yml

FLOCI_ENDPOINT ?= http://localhost:4566
FLOCI_NETWORK ?= documents_default
AWS_REGION ?= ap-south-1

SEED_FILE ?= $(PROD_ENV)
SEED_DIR := tools/seed-secrets
SEED_RUN := poetry -C $(SEED_DIR) run python main.py

DOCKER_BIN := $(strip $(shell command -v docker 2>/dev/null))
DOCKER_BIN := $(if $(DOCKER_BIN),$(DOCKER_BIN),docker)

PROD_COMPOSE := $(DOCKER_BIN) compose --env-file $(PROD_ENV) -f $(PROD_COMPOSE_FILE)
PROD_COMPOSE_FLOCI := $(DOCKER_BIN) compose --env-file $(PROD_ENV) -f $(PROD_COMPOSE_FILE) -f $(PROD_FLOCI_COMPOSE_FILE)
LOCAL_COMPOSE := $(DOCKER_BIN) compose --env-file $(LOCAL_ENV) -f $(LOCAL_COMPOSE_FILE)

# GPU auto-detect for ai-service: GPU=1 forces the overlay, GPU=0 skips it,
# otherwise a GPU is used only if the host has one AND docker can access it
# (nvidia-smi + nvidia container runtime); absent either = CPU fallback.
GPU ?=
_HAS_NVIDIA_GPU := $(strip $(shell command -v nvidia-smi >/dev/null 2>&1 && nvidia-smi -L 2>/dev/null | grep -qi gpu && echo 1))
_HAS_NVIDIA_RUNTIME := $(strip $(shell $(DOCKER_BIN) info 2>/dev/null | grep -qi nvidia && echo 1))
HAS_GPU := $(if $(_HAS_NVIDIA_GPU),$(if $(_HAS_NVIDIA_RUNTIME),1))
USE_GPU := $(if $(filter 1,$(GPU)),1,$(if $(filter 0,$(GPU)),,$(HAS_GPU)))
GPU_MODE := $(if $(filter 1,$(USE_GPU)),gpu,cpu)

PROD_COMPOSE := $(PROD_COMPOSE) $(if $(filter 1,$(USE_GPU)),-f $(PROD_GPU_COMPOSE_FILE))
PROD_COMPOSE_FLOCI := $(PROD_COMPOSE_FLOCI) $(if $(filter 1,$(USE_GPU)),-f $(PROD_GPU_COMPOSE_FILE))

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
	tf-fmt tf-validate tf-test tf-plan-local tf-apply-local tf-destroy-local floci-seed floci-verify \
	seed-install seed-floci seed-floci-dry seed-aws seed-dry prod-floci-bootstrap

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
	@printf "  make floci-seed        Seed app-only secrets Floci doesn't TF-manage (legacy, alias to seed-floci)\n"
	@printf "  make seed-floci        Seed app secrets from SEED_FILE=$(SEED_FILE) into Floci\n"
	@printf "  make seed-floci-dry    Preview seed-floci without writing\n"
	@printf "  make seed-aws          Seed app secrets into real AWS (requires --confirm-prod guard)\n"
	@printf "  make seed-dry          Preview seed against current AWS_ENDPOINT_URL (dry-run)\n"
	@printf "  make floci-verify      Check emulator APIs + secrets exist\n"
	@printf "  make prod-floci-bootstrap Bootstrap: tf-apply-local + seed-floci + verify + DATABASE_URL hint\n"
	@printf "  make prod-up-floci     Start prod stack attached to FLOCI_NETWORK\n"
	@printf "  make prod-config-floci Render prod+Floci merged compose config\n"
	@printf "  ai-service GPU: auto (host GPU + docker nvidia runtime = gpu, else cpu); override with GPU=1 / GPU=0\n\n"
	@printf "Seed (new, .env-driven via poetry, works for Floci and real AWS)\n"
	@printf "  make seed-install      Install seeder deps (poetry -C $(SEED_DIR) install)\n"
	@printf "  make seed-floci SEED_FILE=$(SEED_FILE) FLOCI_ENDPOINT=$(FLOCI_ENDPOINT) AWS_REGION=$(AWS_REGION)\n"
	@printf "  make seed-floci-dry    Preview (no writes)\n"
	@printf "  make seed-aws SEED_FILE=$(SEED_FILE) AWS_REGION=$(AWS_REGION)   # needs confirm\n"
	@printf "  Override: make seed-floci ARGS=\"--only detectai/web/secrets\" SEED_FILE=my.env\n\n"
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
	@echo "ai-service mode: $(GPU_MODE) (GPU=1 force GPU, GPU=0 force CPU)"
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
	@echo "ai-service mode: $(GPU_MODE) (GPU=1 force GPU, GPU=0 force CPU)"
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

# ---------------------------------------------------------------------------
# Seed app-only secrets (Floci + real AWS) — .env-driven via Python
# ---------------------------------------------------------------------------
# New (recommended): reads SEED_FILE (default infra/docker/prod/.env, gitignored)
# allowlist-only, shared-key sync, dry-run, guarded real-AWS write.
#   make seed-floci          -> Floci/LocalStack at FLOCI_ENDPOINT
#   make seed-floci-dry      -> preview
#   make seed-aws            -> real AWS (needs --confirm-prod)
#   make prod-floci-bootstrap-> tf-apply-local + seed-floci + DATABASE_URL hint
#
# Legacy floci-seed (bash, mirrors infra/docker/local/.env) kept as alias.
# ---------------------------------------------------------------------------

seed-install:
	@poetry -C $(SEED_DIR) install --no-interaction

seed-floci: ensure-prod-env
	@$(SEED_RUN) --env-file "$(SEED_FILE)" --endpoint-url "$(FLOCI_ENDPOINT)" --region "$(AWS_REGION)" $(ARGS)

seed-floci-dry: ensure-prod-env
	@$(SEED_RUN) --env-file "$(SEED_FILE)" --endpoint-url "$(FLOCI_ENDPOINT)" --region "$(AWS_REGION)" --dry-run $(ARGS)

seed-aws:
	@echo "Seeding to REAL AWS (region=$(AWS_REGION), file=$(SEED_FILE)) — requires --confirm-prod"
	@$(SEED_RUN) --env-file "$(SEED_FILE)" --endpoint-url "" --region "$(AWS_REGION)" --confirm-prod $(ARGS)

seed-dry:
	@EP_VAL=""; if [ -f "$(PROD_ENV)" ]; then EP_VAL="$$(awk -F= '/^AWS_ENDPOINT_URL=/{sub("^[^=]*=",""); gsub(/^[ \t]+|[ \t]+$$/,""); print; exit}' $(PROD_ENV) 2>/dev/null)"; fi; \
	if [ -n "$$EP_VAL" ]; then echo "Dry-run against Floci: $$EP_VAL"; else echo "Dry-run against real AWS (empty endpoint)"; fi; \
	$(SEED_RUN) --env-file "$(SEED_FILE)" --endpoint-url "$$EP_VAL" --region "$(AWS_REGION)" --dry-run $(ARGS)

prod-floci-bootstrap: tf-apply-local seed-floci
	@echo ""
	@echo "== DATABASE_URL hint (paste into $(PROD_ENV) if not set) =="
	@terraform -chdir=$(TF_DIR) output -raw database_url 2>/dev/null | sed 's/localhost/host.docker.internal/g; s/127\.0\.0\.1/host.docker.internal/g' | awk '{print "DATABASE_URL="$$0}' || echo "(terraform output not available — run: terraform -chdir=$(TF_DIR) output -raw database_url)"
	@terraform -chdir=$(TF_DIR) output -raw database_url_replica 2>/dev/null | sed 's/localhost/host.docker.internal/g; s/127\.0\.0\.1/host.docker.internal/g' | awk '{print "DATABASE_URL_REPLICA="$$0}' || true
	@echo ""
	@$(MAKE) --no-print-directory floci-verify
	@echo ""
	@echo "Next: make prod-up-floci   (or make prod-config-floci to preview)"

# Legacy alias (bash, mirrors infra/docker/local/.env) — kept for backward compat
# Prefer: make seed-floci SEED_FILE=infra/docker/prod/.env
floci-seed:
	@EP="$(FLOCI_ENDPOINT)"; R="$(AWS_REGION)"; LOCAL_ENV_FILE="infra/docker/local/.env"; \
	randhex() { openssl rand -hex "$$1" 2>/dev/null || od -An -tx1 -N "$$1" /dev/urandom | tr -d ' \n'; }; \
	local_val() { if [ -f "$$LOCAL_ENV_FILE" ]; then awk -F= -v k="$$1" '$$1==k{sub($$1"=","");print}' "$$LOCAL_ENV_FILE" | tail -n 1; fi; }; \
	with_local() { v="$$(local_val "$$1")"; if [ -n "$$v" ]; then printf '%s' "$$v"; else printf '%s' "$$2"; fi; }; \
	INTERNAL_KEY="$$(randhex 24)"; AI_KEY="$$(randhex 24)"; \
	GOOGLE_ID="$$(with_local GOOGLE_ID floci-test-google-client-id)"; \
	GOOGLE_SECRET="$$(with_local GOOGLE_SECRET floci-test-google-client-secret)"; \
	GITHUB_ID="$$(with_local GITHUB_ID floci-test-github-client-id)"; \
	GITHUB_SECRET="$$(with_local GITHUB_SECRET floci-test-github-client-secret)"; \
	AUTH_SECRET="$$(with_local NEXTAUTH_SECRET "$$(randhex 32)")"; \
	HOOK_SECRET="$$(with_local PADDLE_WEBHOOK_SECRET "$$(randhex 24)")"; \
	PADDLE_KEY="$$(with_local PADDLE_API_KEY mock-paddle-api-key-not-configured)"; \
	CLIENT_TOKEN="$$(with_local NEXT_PUBLIC_PADDLE_CLIENT_TOKEN mock-paddle-client-token-not-configured)"; \
	TS_SITE="$$(with_local NEXT_PUBLIC_TURNSTILE_SITE_KEY 1x00000000000000000000AA)"; \
	TS_SECRET="$$(with_local TURNSTILE_SECRET_KEY 1x0000000000000000000000000000000AA)"; \
	put_secret() { \
		name="$$1"; payload="$$2"; \
		if aws --endpoint-url "$$EP" --region "$$R" secretsmanager describe-secret --secret-id "$$name" >/dev/null 2>&1; then \
			aws --endpoint-url "$$EP" --region "$$R" secretsmanager put-secret-value --secret-id "$$name" --secret-string "$$payload" >/dev/null; \
		else \
			aws --endpoint-url "$$EP" --region "$$R" secretsmanager create-secret --name "$$name" --secret-string "$$payload" >/dev/null; \
		fi; \
		echo "seeded $$name"; \
	}; \
	put_secret "detectai/web/secrets" "{\"NEXTAUTH_SECRET\":\"$$AUTH_SECRET\",\"INTERNAL_API_KEY\":\"$$INTERNAL_KEY\",\"AI_SERVICE_API_KEY\":\"$$AI_KEY\",\"NEXT_PUBLIC_TURNSTILE_SITE_KEY\":\"$$TS_SITE\",\"TURNSTILE_SECRET_KEY\":\"$$TS_SECRET\",\"NEXT_PUBLIC_PADDLE_CLIENT_TOKEN\":\"$$CLIENT_TOKEN\",\"GOOGLE_ID\":\"$$GOOGLE_ID\",\"GOOGLE_SECRET\":\"$$GOOGLE_SECRET\",\"GITHUB_ID\":\"$$GITHUB_ID\",\"GITHUB_SECRET\":\"$$GITHUB_SECRET\",\"PROMETHEUS_WEB_SCRAPE_TOKEN\":\"mock-prometheus-scrape-token-32ch\"}"; \
	put_secret "detectai/gateway/secrets" "{\"PADDLE_WEBHOOK_SECRET\":\"$$HOOK_SECRET\",\"INTERNAL_API_KEY\":\"$$INTERNAL_KEY\"}"; \
	put_secret "detectai/workers/secrets" "{\"PADDLE_API_KEY\":\"$$PADDLE_KEY\",\"PADDLE_ENVIRONMENT\":\"sandbox\"}"; \
	put_secret "detectai/inference/secrets" "{\"API_KEY\":\"$$AI_KEY\"}"; \
	echo "Done. OAuth/Paddle/NextAuth mirrored from local .env; INTERNAL/AI keys in sync."

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
	echo "== secrets (TF-managed + app):"; \
	aws --endpoint-url "$$EP" --region "$$R" secretsmanager list-secrets --query 'SecretList[].Name' --output text; echo; \
	echo "== app secrets present? (empty = not seeded) =="; \
	for s in detectai/web/secrets detectai/gateway/secrets detectai/workers/secrets detectai/inference/secrets; do \
		if aws --endpoint-url "$$EP" --region "$$R" secretsmanager describe-secret --secret-id "$$s" >/dev/null 2>&1; then \
			echo "  ok  $$s"; \
		else \
			echo "  MISSING $$s  (run: make seed-floci)"; \
		fi; \
	done
