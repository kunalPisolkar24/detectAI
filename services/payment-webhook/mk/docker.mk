# Never recreate a running elasticmq here — it's in-memory, so a recreate drops the queue state it holds.

ENV_FILE := $(if $(wildcard infra/.env),infra/.env,infra/.env.example)
COMPOSE := docker compose --env-file $(ENV_FILE) -f infra/compose.yml
MQ_COMPOSE := docker compose -f ../../infra/docker/elasticmq/compose.yml
PROJECT := detectai-payment-webhook

.PHONY: build up down clean logs ps queue-up queue-down help-docker

help-docker:
	@echo "Docker commands (mk/docker.mk):"
	@echo "  build       build the Docker image ($(PROJECT))"
	@echo "  up          queue-up, then compose up --build -d (the flick rides infra/.env; compose run -e for one-offs)"
	@echo "  down        compose down; the emulator keeps running under its own verbs"
	@echo "  queue-up    start the emulator (a running elasticmq is left untouched)"
	@echo "  queue-down  emulator compose down (its in-memory state goes with it)"
	@echo "  clean       down + queue-down + networks/volumes for both compose projects (the image and floci stay)"
	@echo "  logs        compose logs -f (payment-webhook)"
	@echo "  ps          compose ps"
	@echo ""

build:
	docker build -t $(PROJECT) .

up: queue-up
	$(COMPOSE) up --build -d
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

clean:
	$(COMPOSE) down --remove-orphans --volumes
	$(MQ_COMPOSE) down --remove-orphans --volumes

logs:
	$(COMPOSE) logs -f payment-webhook

ps:
	$(COMPOSE) ps
