# Never recreate a running elasticmq here — it's in-memory, so a recreate drops the queue state it holds.

ENV_FILE := $(if $(wildcard infra/.env),infra/.env,infra/.env.example)
COMPOSE := docker compose --env-file $(ENV_FILE) -f infra/compose.yml
MQ_COMPOSE := docker compose -f ../../infra/docker/elasticmq/compose.yml
PROJECT := detectai-payment-webhook

.PHONY: build up prod-up down logs ps queue-up queue-down help-docker

help-docker:
	@echo "Docker commands (mk/docker.mk):"
	@echo "  build       build the Docker image ($(PROJECT))"
	@echo "  up          queue-up, then the gateway joins it on the dev plane (shell PORT=... wins over the env file)"
	@echo "  prod-up     queue-up, then the gateway boots the prod plane off the seeded floci (ENV_TYPE=prod)"
	@echo "  down        compose down; the emulator keeps running under its own verbs"
	@echo "  queue-up    start the emulator (a running elasticmq is left untouched)"
	@echo "  queue-down  emulator compose down (its in-memory state goes with it)"
	@echo "  logs        compose logs -f (payment-webhook)"
	@echo "  ps          compose ps"
	@echo ""

build:
	docker build -t $(PROJECT) .

up: queue-up
	$(COMPOSE) up --build -d
	$(COMPOSE) ps

prod-up: queue-up
	@curl -sm2 http://localhost:4566/_localstack/health >/dev/null 2>&1 \
		|| { echo "floci is down on :4566 — run 'make floci-up' at the repo root"; exit 1; }
	ENV_TYPE=prod $(COMPOSE) up --build -d
	$(COMPOSE) ps

down:
	$(COMPOSE) down --remove-orphans

queue-up:
	@if $(MQ_COMPOSE) ps --services 2>/dev/null | grep -qx elasticmq; then \
		echo "elasticmq already running — left as-is"; \
	else \
		$(MQ_COMPOSE) up -d --wait && echo "elasticmq up"; \
	fi
	@echo ""
	@echo "  sqs     http://localhost:$(or $(ELASTICMQ_PORT),9324)"
	@echo "  ui      http://localhost:$(or $(ELASTICMQ_UI_PORT),3001)"
	@echo "  next    QUEUE_URL=http://localhost:$(or $(ELASTICMQ_PORT),9324)/000000000000/payment_events.fifo in infra/.env, then make run"

queue-down:
	$(MQ_COMPOSE) down --remove-orphans

logs:
	$(COMPOSE) logs -f payment-webhook

ps:
	$(COMPOSE) ps
