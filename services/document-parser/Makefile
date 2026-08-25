VUS ?= 20
DURATION ?= 1m
RAMP_TIME ?= 30s
RPS ?= 50
MODE ?= vus

COMPOSE_LOAD = docker compose -f compose.load.yml

.PHONY: load-test load-up load-down build run stop

build:
	docker build -t detectai-document-parser .

run:
	PORT_DOC_PARSER=8000 detect_ai_network=detectai_net docker network create detectai_net || true
	PORT_DOC_PARSER=8000 detect_ai_network=detectai_net docker compose up -d

stop:
	PORT_DOC_PARSER=8000 detect_ai_network=detectai_net docker compose down

load-up:
	$(COMPOSE_LOAD) up -d --build

load-down:
	$(COMPOSE_LOAD) down --remove-orphans

load-test: load-down load-up
	@echo "Waiting for document-parser to become healthy..."
	@until $$(curl --output /dev/null --silent --head --fail http://localhost:8000/health); do \
		printf '.'; \
		sleep 2; \
	done
	@echo "\nRunning k6 load test ($(MODE) mode, VUS=$(VUS), RPS=$(RPS), DURATION=$(DURATION), RAMP=$(RAMP_TIME))..."
	$(COMPOSE_LOAD) run --rm \
		-e MODE=$(MODE) \
		-e VUS=$(VUS) \
		-e DURATION=$(DURATION) \
		-e RAMP_TIME=$(RAMP_TIME) \
		-e RPS=$(RPS) \
		k6 run /load/script.js
	@$(MAKE) load-down
