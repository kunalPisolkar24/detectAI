ENV_FILE := $(if $(wildcard infra/.env),infra/.env,infra/.env.example)
COMPOSE := docker compose --env-file $(ENV_FILE) -f infra/compose.yml
COMPOSE_LOAD := docker compose -f infra/compose.load.yml

.PHONY: build run test test-coverage test-integration lint deps load-test load-down parser-build parser-up parser-down parser-down-v parser-logs parser-ps parser-config

build:
	docker build -t detectai-document-parser .

run:
	poetry run uvicorn app.main:app --reload --port 8000

test:
	poetry run pytest -v

test-coverage:
	poetry run pytest --cov=app --cov-report=term-missing --cov-report=html --cov-report=xml

test-integration:
	poetry run pytest -m integration -v

lint:
	poetry run ruff check .

deps:
	poetry install

# Self-contained load test: compose brings up document-parser + k6 on a
# dedicated network, no dependency on the main detect-ai stack.
# Usage: make load-test VUS=50 DURATION=2m RAMP_TIME=30s MODE=vus RPS=100
load-test:
	$(COMPOSE_LOAD) up --abort-on-container-exit --exit-code-from k6

load-down:
	$(COMPOSE_LOAD) down -v --remove-orphans

# Document parser via infra compose files
parser-build:
	docker build -t detectai-document-parser .

parser-up:
	$(COMPOSE) up --build -d
	$(COMPOSE) ps

parser-down:
	$(COMPOSE) down --remove-orphans

parser-down-v:
	$(COMPOSE) down -v --remove-orphans

parser-logs:
	$(COMPOSE) logs -f document-parser

parser-ps:
	$(COMPOSE) ps

parser-config:
	$(COMPOSE) config
