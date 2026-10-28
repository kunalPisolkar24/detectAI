# Load + e2e harness (tests/load/): infra/.env.load is the single lever.
#
#   make load-test   provision the container rig (parser + k6) and load it
#   make load-e2e    k6 only, against whatever the file's API_URL names
#   make load-down   remove the rig and any e2e-run leftovers
#
# Compose injects the file wholesale (env_file) into both containers; there
# are no CLI overrides and no shell-env precedence — every knob, SCENARIO
# included, is edited in the file (see infra/.env.load.example).
#
# k6 opens every document from the generated corpus (tests/load/assets); a
# fresh tree carries none until the generator ran once: make load-fixtures.

LOAD_ENV_FILE := infra/.env.load
LOAD_ENV_EXAMPLE := infra/.env.load.example

# The corpus's smallest row; its presence means a generator run happened.
CORPUS_PROBE := tests/load/assets/short.txt
COMPOSE_LOAD := docker compose -f infra/compose.load.yml
COMPOSE_K6 := docker compose -f infra/compose.k6.yml
LOAD_PROJECT := document-parser-load
LOAD_E2E_PROJECT := e2e-document-parser

# SCENARIO comes only from the file. The sed reads the single SCENARIO= line;
# tr strips stray spaces and CRs. Empty file line -> smoke default.
LOAD_FILE_SCENARIO := $(shell test -f $(LOAD_ENV_FILE) && sed -n 's/^SCENARIO=[[:space:]]*//p' $(LOAD_ENV_FILE) | head -n1 | tr -d ' \r')
SCENARIO := $(if $(LOAD_FILE_SCENARIO),$(LOAD_FILE_SCENARIO),smoke)

# Scenario -> k6 script path; empty when the name is unknown, which the
# recipes reject with the valid list.
K6_SCRIPT := $(if $(filter legacy,$(SCENARIO)),script.js,$(if $(filter $(SCENARIO),smoke negative load stress soak),scenarios/$(SCENARIO).js,))

.PHONY: load-env load-test load-e2e load-down load-down-remote help-load
.PHONY: check-load-corpus

# k6's open() demands the corpus on disk; fail before compose with the fix.
check-load-corpus:
	@test -f $(CORPUS_PROBE) || { \
		echo "no generated load corpus (tests/load/assets is empty)"; \
		echo "  generate it once - no running service needed: make load-fixtures"; \
		exit 1; \
	}

help-load:
	@echo "Load + e2e (mk/load.mk): everything is configured in infra/.env.load"
	@echo "  load-env     create infra/.env.load from infra/.env.load.example if missing"
	@echo "  load-fixtures (mk/tests.mk) builds tests/load/assets; k6 needs it once"
	@echo "  load-test    container rig: parser + k6 on an isolated network"
	@echo "  load-e2e     k6 only, against whatever the file's API_URL names"
	@echo "  load-down    remove the rig and the e2e-run leftovers"
	@echo "  the file's SCENARIO line picks the script; edit the file to change anything"
	@echo ""

load-env:
	@test -f $(LOAD_ENV_FILE) || cp $(LOAD_ENV_EXAMPLE) $(LOAD_ENV_FILE)
	@echo "$(LOAD_ENV_FILE) ready (edit it to configure load + e2e runs)"

# Provisions the rig and loads it: `run` boots the parser behind its health
# gate and runs k6; a trailing down removes the parser behind it (run leaves
# dependencies up), and the k6 exit code survives the teardown.
load-test: | check-load-corpus
	@test -f $(LOAD_ENV_FILE) || cp $(LOAD_ENV_EXAMPLE) $(LOAD_ENV_FILE); \
	test -n "$(K6_SCRIPT)" || { echo "Invalid SCENARIO '$(SCENARIO)' in $(LOAD_ENV_FILE). Use: smoke|negative|load|stress|soak|legacy"; exit 1; }; \
	echo "Load test SCENARIO=$(SCENARIO) script=$(K6_SCRIPT) rig=$(LOAD_PROJECT)"; \
	$(COMPOSE_LOAD) run --build --rm k6 run /load/$(K6_SCRIPT); \
	rc=$$?; \
	$(COMPOSE_LOAD) down -v --remove-orphans || true; \
	exit $$rc

# Nothing provisioned: the k6 container runs alone (--rm --no-deps, its own
# compose project) and sends traffic to whatever the file's API_URL names —
# make run, a docker stack, a Lambda function URL, prod.
load-e2e: | check-load-corpus
	@test -f $(LOAD_ENV_FILE) || cp $(LOAD_ENV_EXAMPLE) $(LOAD_ENV_FILE); \
	test -n "$(K6_SCRIPT)" || { echo "Invalid SCENARIO '$(SCENARIO)' in $(LOAD_ENV_FILE). Use: smoke|negative|load|stress|soak|legacy"; exit 1; }; \
	echo "Load e2e SCENARIO=$(SCENARIO) script=$(K6_SCRIPT) target=$(LOAD_ENV_FILE)"; \
	$(COMPOSE_K6) -p $(LOAD_E2E_PROJECT) run --rm --no-deps k6 run /load/$(K6_SCRIPT)

# Removes both compose projects: the rig from a load-test run, and the
# network a `run --rm --no-deps` e2e run leaves behind.
load-down:
	$(COMPOSE_LOAD) -p $(LOAD_PROJECT) down -v --remove-orphans
	$(COMPOSE_LOAD) -p $(LOAD_E2E_PROJECT) down -v --remove-orphans

# The root e2e harness' teardown entry: only the remote project, so tearing
# down an e2e run never touches the rig.
load-down-remote:
	$(COMPOSE_LOAD) -p $(LOAD_E2E_PROJECT) down -v --remove-orphans
