ENV_FILE := $(if $(wildcard infra/.env),infra/.env,infra/.env.example)
COMPOSE := docker compose --env-file $(ENV_FILE) -f infra/compose.yml
COMPOSE_LOAD := docker compose -f infra/compose.load.yml
COMPOSE_LOAD_OBS := docker compose -f infra/compose.load.yml -f ../../infra/docker/otel/loadtest-observability.yml -f infra/compose.load.observability.yml
WITH_OBSERVABILITY ?= 0
SCENARIO ?= load

.PHONY: build run test test-coverage test-integration lint deps load-test load-test-smoke load-test-load load-test-stress load-test-soak load-test-negative load-down parser-build parser-up parser-down parser-down-v parser-logs parser-ps parser-config

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
# Usage: make load-test SCENARIO=smoke|load|stress|soak|negative
#        make load-test SCENARIO=load VUS=20 DURATION=1m RAMP_TIME=30s
#        make load-test SCENARIO=stress RPS=20 STAGES="10s:5,30s:20,10s:0"
#        make load-test SCENARIO=legacy MODE=rps VUS=50 RPS=100 DURATION=2m
# Opt-in observability: make load-test WITH_OBSERVABILITY=1 SCENARIO=load
# (adds otel-collector-loadtest -> New Relic EU as deployment.environment=loadtest;
# needs NEW_RELIC_LICENSE_KEY in shell; ENV_TYPE stays dev).
# Note: the load stack intentionally runs WORKERS=1 (override with WORKERS=4)
# so k6 and the service fit on one machine. Do not read these numbers as
# production capacity without accounting for that.
load-test:
	@if [ "$(WITH_OBSERVABILITY)" != "0" ] && [ "$(WITH_OBSERVABILITY)" != "1" ]; then \
		echo "Invalid WITH_OBSERVABILITY '$(WITH_OBSERVABILITY)'. Use 0 or 1."; exit 1; \
	fi
	@if [ "$(WITH_OBSERVABILITY)" = "1" ]; then \
		if [ -z "$${NEW_RELIC_LICENSE_KEY:-}" ]; then \
			echo "WITH_OBSERVABILITY=1 but NEW_RELIC_LICENSE_KEY is empty — collector will retry/drop, apps keep running."; \
		fi; \
		$(MAKE) --no-print-directory _load-test COMPOSE_TARGET=obs; \
	else \
		$(MAKE) --no-print-directory _load-test COMPOSE_TARGET=base; \
	fi

_load-test:
	@SCENARIO_VAL="$(SCENARIO)"; MODE_VAL="$(MODE)"; \
	case "$$SCENARIO_VAL" in smoke|load|stress|soak|negative|legacy) ;; \
		*) echo "Invalid SCENARIO '$$SCENARIO_VAL'. Use smoke|load|stress|soak|negative|legacy."; exit 1;; \
	esac; \
	if [ "$$SCENARIO_VAL" = "legacy" ]; then K6_SCRIPT="script.js"; \
	else K6_SCRIPT="scenarios/$$SCENARIO_VAL.js"; fi; \
	export K6_SCRIPT; export SCENARIO="$$SCENARIO_VAL"; \
	if [ -n "$(VUS)" ]; then \
		export DOCPARSER_LOAD_SMOKE_VUS="$(VUS)"; \
		export VUS="$(VUS)"; \
		export DOCPARSER_LOAD_SOAK_VUS="$(VUS)"; \
		export DOCPARSER_LOAD_NEGATIVE_VUS="$(VUS)"; \
		export DOCPARSER_LOAD_STRESS_PREALLOCATED_VUS="$(VUS)"; \
	fi; \
	if [ -n "$(DURATION)" ]; then \
		export DURATION="$(DURATION)"; \
		export DOCPARSER_LOAD_SOAK_DURATION="$(DURATION)"; \
	fi; \
	if [ -n "$(RAMP_TIME)" ]; then export RAMP_TIME="$(RAMP_TIME)"; fi; \
	if [ -n "$(RPS)" ]; then \
		export RPS="$(RPS)"; \
		export DOCPARSER_LOAD_STRESS_START_RATE="$(RPS)"; \
	fi; \
	if [ -n "$(STAGES)" ]; then \
		export DOCPARSER_LOAD_STAGES="$(STAGES)"; \
		export DOCPARSER_LOAD_STRESS_STAGES="$(STAGES)"; \
	elif [ -n "$(VUS)$(DURATION)$(RAMP_TIME)" ]; then \
		_VUS="$$(if [ -n "$(VUS)" ]; then echo "$(VUS)"; else echo 5; fi)"; \
		_DUR="$$(if [ -n "$(DURATION)" ]; then echo "$(DURATION)"; else echo 10s; fi)"; \
		_RAMP="$$(if [ -n "$(RAMP_TIME)" ]; then echo "$(RAMP_TIME)"; else echo 5s; fi)"; \
		export DOCPARSER_LOAD_STAGES="$$_RAMP:$$_VUS,$$_DUR:$$_VUS,$$_RAMP:0"; \
	fi; \
	if [ -n "$(MAX_VUS)" ]; then export DOCPARSER_LOAD_STRESS_MAX_VUS="$(MAX_VUS)"; fi; \
	echo "Load test SCENARIO=$$SCENARIO_VAL K6_SCRIPT=$$K6_SCRIPT MODE=$${MODE_VAL:-vus}"; \
	if [ "$(COMPOSE_TARGET)" = "obs" ]; then \
		$(COMPOSE_LOAD_OBS) up --abort-on-container-exit --exit-code-from k6; \
	else \
		$(COMPOSE_LOAD) up --abort-on-container-exit --exit-code-from k6; \
	fi

load-test-smoke:
	@$(MAKE) load-test SCENARIO=smoke VUS=$(VUS) DURATION=$(DURATION) RAMP_TIME=$(RAMP_TIME) RPS=$(RPS) STAGES=$(STAGES) MAX_VUS=$(MAX_VUS)

load-test-load:
	@$(MAKE) load-test SCENARIO=load VUS=$(VUS) DURATION=$(DURATION) RAMP_TIME=$(RAMP_TIME) RPS=$(RPS) STAGES=$(STAGES) MAX_VUS=$(MAX_VUS)

load-test-stress:
	@$(MAKE) load-test SCENARIO=stress VUS=$(VUS) DURATION=$(DURATION) RAMP_TIME=$(RAMP_TIME) RPS=$(RPS) STAGES=$(STAGES) MAX_VUS=$(MAX_VUS)

load-test-soak:
	@$(MAKE) load-test SCENARIO=soak VUS=$(VUS) DURATION=$(DURATION) RAMP_TIME=$(RAMP_TIME) RPS=$(RPS) STAGES=$(STAGES) MAX_VUS=$(MAX_VUS)

load-test-negative:
	@$(MAKE) load-test SCENARIO=negative VUS=$(VUS) DURATION=$(DURATION) RAMP_TIME=$(RAMP_TIME) RPS=$(RPS) STAGES=$(STAGES) MAX_VUS=$(MAX_VUS)

load-down:
	$(COMPOSE_LOAD_OBS) down -v --remove-orphans

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
