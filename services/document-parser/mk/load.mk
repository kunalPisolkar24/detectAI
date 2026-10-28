# Load + e2e harness (tests/load/). infra/.env.load is the single lever:
# compose injects it wholesale into the rig's parser and k6, SCENARIO comes
# from the file, and there are no CLI or shell overrides.

LOAD_ENV_FILE := infra/.env.load
LOAD_ENV_EXAMPLE := infra/.env.load.example
CORPUS_PROBE := tests/load/assets/short.txt
COMPOSE_LOAD := docker compose -f infra/compose.load.yml
COMPOSE_K6 := docker compose -f infra/compose.k6.yml
LOAD_PROJECT := document-parser-load
LOAD_E2E_PROJECT := e2e-document-parser

# SCENARIO comes only from the file (the sed reads its one SCENARIO= line; tr
# strips stray spaces and CRs). Missing file or bare line -> smoke default.
LOAD_FILE_SCENARIO := $(shell test -f $(LOAD_ENV_FILE) && sed -n 's/^SCENARIO=[[:space:]]*//p' $(LOAD_ENV_FILE) | head -n1 | tr -d ' \r')
SCENARIO := $(if $(LOAD_FILE_SCENARIO),$(LOAD_FILE_SCENARIO),smoke)

# Scenario -> k6 script path; empty when the name is unknown, which
# load-check rejects with the valid list.
K6_SCRIPT := $(if $(filter legacy,$(SCENARIO)),script.js,$(if $(filter $(SCENARIO),smoke negative load stress soak),scenarios/$(SCENARIO).js,))

.PHONY: load-env load-test load-e2e load-down load-down-remote help-load
.PHONY: load-check

# Prereq for both run targets: reject an unknown SCENARIO, and fail before
# compose when the generated corpus is missing (k6's open() needs it).
load-check:
	@test -n "$(K6_SCRIPT)" || { echo "Invalid SCENARIO '$(SCENARIO)' in $(LOAD_ENV_FILE). Use: smoke|negative|load|stress|soak|legacy"; exit 1; }
	@test -f $(CORPUS_PROBE) || { echo "no generated load corpus - generate it once: make load-fixtures"; exit 1; }

help-load:
	@echo "Load + e2e (mk/load.mk): everything is configured in infra/.env.load"
	@echo "  load-env     create infra/.env.load from infra/.env.load.example if missing"
	@echo "  load-test    container rig: parser + k6 on an isolated network"
	@echo "  load-e2e     k6 only, against whatever the file's API_URL names"
	@echo "  load-down    remove the rig and the e2e-run leftovers"
	@echo "  the file's SCENARIO line picks the script; edit the file to change anything"
	@echo ""

load-env:
	@test -f $(LOAD_ENV_FILE) || cp $(LOAD_ENV_EXAMPLE) $(LOAD_ENV_FILE)
	@echo "$(LOAD_ENV_FILE) ready (edit it to configure load + e2e runs)"

# `run` boots the parser behind its health gate and runs k6; the trailing down
# removes the parser run leaves behind, and the k6 exit code survives it.
load-test: | load-check
	@echo "Load test SCENARIO=$(SCENARIO) script=$(K6_SCRIPT) rig=$(LOAD_PROJECT)"; \
	$(COMPOSE_LOAD) run --build --rm k6 run /load/$(K6_SCRIPT); \
	rc=$$?; \
	$(COMPOSE_LOAD) down -v --remove-orphans || true; \
	exit $$rc

# The k6 container runs alone against whatever the file's API_URL names —
# make run, a docker stack, a Lambda function URL, prod.
load-e2e: | load-check
	@echo "Load e2e SCENARIO=$(SCENARIO) script=$(K6_SCRIPT) target=$(LOAD_ENV_FILE)"; \
	$(COMPOSE_K6) -p $(LOAD_E2E_PROJECT) run --rm --no-deps k6 run /load/$(K6_SCRIPT)

load-down: load-down-remote
	$(COMPOSE_LOAD) -p $(LOAD_PROJECT) down -v --remove-orphans

# The root e2e harness' teardown entry: only the remote project, so tearing
# down an e2e run never touches the rig.
load-down-remote:
	$(COMPOSE_LOAD) -p $(LOAD_E2E_PROJECT) down -v --remove-orphans
