# Never recreate a running elasticmq here — it's in-memory, so a recreate drops the queue state it holds.

MQ_COMPOSE := ../../infra/docker/elasticmq/compose.yml
COMPOSE := docker compose -f $(MQ_COMPOSE)

.PHONY: up down queue-up queue-down logs ps help-docker

help-docker:
	@echo "Docker commands (mk/docker.mk):"
	@echo "  queue-up    start elasticmq + UI (a running elasticmq is left untouched)"
	@echo "  queue-down  compose down (the emulator's in-memory state goes with it)"
	@echo "  logs        compose logs -f"
	@echo "  ps          compose ps"
	@echo "  up down     alias queue-up/queue-down; full-stack verbs once the gateway containerizes"
	@echo ""

up: queue-up
down: queue-down

queue-up:
	@if $(COMPOSE) ps --services 2>/dev/null | grep -qx elasticmq; then \
		echo "elasticmq already running — queue-up left it as-is."; \
	else \
		$(COMPOSE) up -d --wait; \
	fi
	@$(COMPOSE) ps
	@echo "Local SQS wiring: QUEUE_URL=http://localhost:9324/000000000000/payment_events.fifo in infra/.env, and"
	@echo "  export AWS_ENDPOINT_URL_SQS=http://localhost:9324 AWS_REGION=eu-central-1 AWS_ACCESS_KEY_ID=x AWS_SECRET_ACCESS_KEY=x"
	@echo "then: make run"

queue-down:
	$(COMPOSE) down --remove-orphans

logs:
	$(COMPOSE) logs -f

ps:
	$(COMPOSE) ps
