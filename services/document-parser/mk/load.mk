# Load + e2e harness (load/): one infra/.env.load drives both commands.
#
#   make load-test   provision the container rig (parser + k6) and load it
#   make load-e2e    k6 only, against whatever the target file's API_URL names
#   make load-down   remove the rig and any e2e-run leftovers
#
# SCENARIO resolves CLI > infra/.env.load > smoke. Every other knob lives in
# infra/.env.load (see infra/.env.load.example); a CLI shape key
# (VUS, ITERATIONS, ...) stays as an escape hatch and wins over the file,
# mirroring how compose lets the shell env beat --env-file.

LOAD_ENV_FILE ?= infra/.env.load
LOAD_ENV_EXAMPLE := infra/.env.load.example
COMPOSE_LOAD := docker compose -f infra/compose.load.yml
LOAD_PROJECT := document-parser-load
LOAD_E2E_PROJECT := e2e-document-parser

# The root e2e harness' remote entry (e2e/Makefile calls load-test REMOTE=1
# with its own target file); on its own, load-e2e targets infra/.env.load.
REMOTE ?= 0
TARGET_ENV_FILE ?= $(LOAD_ENV_FILE)

# SCENARIO from infra/.env.load, which is otherwise invisible to make. The sed
# reads the single SCENARIO= line; tr strips stray spaces and CRs.
LOAD_FILE_SCENARIO := $(shell test -f $(LOAD_ENV_FILE) && sed -n 's/^SCENARIO=[[:space:]]*//p' $(LOAD_ENV_FILE) | head -n1 | tr -d ' \r')
SCENARIO ?= $(if $(LOAD_FILE_SCENARIO),$(LOAD_FILE_SCENARIO),smoke)

# Scenario -> k6 script path; empty when the name is unknown, which the
# recipes reject with the valid list.
K6_SCRIPT := $(if $(filter legacy,$(SCENARIO)),script.js,$(if $(filter $(SCENARIO),smoke negative load stress soak),scenarios/$(SCENARIO).js,))

# Shape overrides handed in on the CLI (or by the root e2e harness) ride as
# shell env, which beats --env-file in compose interpolation.
define load-export-shape
if [ -n "$(VUS)" ]; then export VUS="$(VUS)"; fi; \
if [ -n "$(ITERATIONS)" ]; then export ITERATIONS="$(ITERATIONS)"; fi; \
if [ -n "$(DURATION)" ]; then export DURATION="$(DURATION)"; fi; \
if [ -n "$(RAMP_TIME)" ]; then export RAMP_TIME="$(RAMP_TIME)"; fi; \
if [ -n "$(RPS)" ]; then export RPS="$(RPS)"; fi; \
if [ -n "$(STAGES)" ]; then export STAGES="$(STAGES)"; fi; \
if [ -n "$(MAX_VUS)" ]; then export MAX_VUS="$(MAX_VUS)"; fi; \
if [ -n "$(MODE)" ]; then export MODE="$(MODE)"; fi;
endef

.PHONY: load-env load-test load-e2e load-down load-down-remote help-load

help-load:
	@echo "Load + e2e (mk/load.mk):"
	@echo "  load-env     create infra/.env.load from infra/.env.load.example if missing"
	@echo "  load-test    container rig: parser + k6 on an isolated network"
	@echo "  load-e2e     k6 only, against whatever the target file's API_URL names"
	@echo "  load-down    remove the rig and the e2e-run leftovers"
	@echo "  SCENARIO=<smoke|negative|load|stress|soak|legacy> picks the script;"
	@echo "  every other knob lives in infra/.env.load (template: infra/.env.load.example)"
	@echo ""

load-env:
	@test -f $(LOAD_ENV_FILE) || cp $(LOAD_ENV_EXAMPLE) $(LOAD_ENV_FILE)
	@echo "$(LOAD_ENV_FILE) ready (edit it to configure load + e2e runs)"

# Provisions the rig and loads it.
load-test:
	@if [ "$(REMOTE)" = "1" ]; then \
		$(MAKE) --no-print-directory load-e2e \
			SCENARIO="$(SCENARIO)" TARGET_ENV_FILE="$(TARGET_ENV_FILE)" \
			VUS="$(VUS)" ITERATIONS="$(ITERATIONS)" DURATION="$(DURATION)" \
			RAMP_TIME="$(RAMP_TIME)" RPS="$(RPS)" STAGES="$(STAGES)" \
			MAX_VUS="$(MAX_VUS)" MODE="$(MODE)"; \
		exit; \
	fi; \
	test -f $(LOAD_ENV_FILE) || cp $(LOAD_ENV_EXAMPLE) $(LOAD_ENV_FILE); \
	test -n "$(K6_SCRIPT)" || { echo "Invalid SCENARIO '$(SCENARIO)'. Use: smoke|negative|load|stress|soak|legacy"; exit 1; }; \
	$(load-export-shape) \
	echo "Load test SCENARIO=$(SCENARIO) script=$(K6_SCRIPT) rig=$(LOAD_PROJECT)"; \
	# The rig loads itself: pin the in-network URL ahead of the file's host
	# target (shell env beats --env-file in compose interpolation). K6_SCRIPT
	# rides the same way — the file never carries it.
	K6_SCRIPT="$(K6_SCRIPT)" API_URL=http://document-parser:8000 \
	$(COMPOSE_LOAD) --env-file $(LOAD_ENV_FILE) up --build --abort-on-container-exit --exit-code-from k6

# Nothing provisioned: the k6 container runs alone (--rm --no-deps, its own
# compose project) and sends traffic to whatever the target file's API_URL
# names — make run, a docker stack, a Lambda function URL, prod.
load-e2e:
	@if [ "$(TARGET_ENV_FILE)" = "$(LOAD_ENV_FILE)" ]; then \
		test -f $(LOAD_ENV_FILE) || cp $(LOAD_ENV_EXAMPLE) $(LOAD_ENV_FILE); \
	fi; \
	test -n "$(K6_SCRIPT)" || { echo "Invalid SCENARIO '$(SCENARIO)'. Use: smoke|negative|load|stress|soak|legacy"; exit 1; }; \
	$(load-export-shape) \
	echo "Load e2e SCENARIO=$(SCENARIO) script=$(K6_SCRIPT) target=$(TARGET_ENV_FILE)"; \
	$(COMPOSE_LOAD) --env-file $(TARGET_ENV_FILE) -p $(LOAD_E2E_PROJECT) run --rm --no-deps k6 run /load/$(K6_SCRIPT)

# Removes both compose projects: the rig from `up`, and the network a
# `run --rm --no-deps` e2e run leaves behind.
load-down:
	$(COMPOSE_LOAD) -p $(LOAD_PROJECT) down -v --remove-orphans
	$(COMPOSE_LOAD) -p $(LOAD_E2E_PROJECT) down -v --remove-orphans

# The root e2e harness' teardown entry: only the remote project, so tearing
# down an e2e run never touches the rig.
load-down-remote:
	$(COMPOSE_LOAD) -p $(LOAD_E2E_PROJECT) down -v --remove-orphans
