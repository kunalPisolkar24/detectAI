# Load rig: infra/.env.load is the single lever; its SCENARIO line picks the script.

LOAD_ENV_FILE := infra/.env.load
LOAD_ENV_EXAMPLE := infra/.env.load.example
CORPUS_PROBE := tests/load/assets/corpus.jsonl
COMPOSE_K6 := docker compose -f infra/compose.k6.yml
LOAD_PROJECT := inference-load
LOAD_E2E_PROJECT := e2e-inference

LOAD_COMPOSE := docker compose -f infra/compose.load.yml
ifeq ($(IMAGE),gpu)
LOAD_COMPOSE += -f infra/compose.gpu.yml
endif

LOAD_FILE_SCENARIO := $(shell test -f $(LOAD_ENV_FILE) && sed -n 's/^SCENARIO=[[:space:]]*//p' $(LOAD_ENV_FILE) | head -n1 | tr -d ' \r')
SCENARIO := $(if $(LOAD_FILE_SCENARIO),$(LOAD_FILE_SCENARIO),smoke)
K6_SCRIPT := $(if $(filter $(SCENARIO),smoke load),scenarios/$(SCENARIO).js,)

.PHONY: load-fixtures load-env load-check load-test load-e2e load-down load-down-remote help-load

load-check:
	@test -n "$(K6_SCRIPT)" || { echo "Invalid SCENARIO '$(SCENARIO)' in $(LOAD_ENV_FILE). Use: smoke|load"; exit 1; }
	@test -f $(CORPUS_PROBE) || { echo "no generated load corpus - generate it once: make load-fixtures"; exit 1; }

help-load:
	@echo "Load + e2e (mk/load.mk): everything is configured in infra/.env.load"
	@echo "  load-env       create infra/.env.load from infra/.env.load.example if missing"
	@echo "  load-fixtures  regenerate the corpus under tests/load/assets (gitignored)"
	@echo "  load-test      container rig: inference + k6 on an isolated network (IMAGE=cpu|gpu)"
	@echo "  load-e2e       k6 only, against whatever the file's GRPC_ADDR names"
	@echo "  load-down      remove the rig and the e2e-run leftovers"
	@echo "  the file's SCENARIO line picks the script; edit the file to change anything"
	@echo ""

load-env:
	@test -f $(LOAD_ENV_FILE) || cp $(LOAD_ENV_EXAMPLE) $(LOAD_ENV_FILE)
	@echo "$(LOAD_ENV_FILE) ready (edit it to configure load + e2e runs)"

load-fixtures:
	poetry run python -m tests.load.generate

load-test: | load-check
	@echo "Load test SCENARIO=$(SCENARIO) script=$(K6_SCRIPT) rig=$(LOAD_PROJECT) IMAGE=$(or $(IMAGE),cpu)"; \
	$(LOAD_COMPOSE) run --build --rm k6 run /load/$(K6_SCRIPT); \
	rc=$$?; \
	$(LOAD_COMPOSE) -p $(LOAD_PROJECT) down -v --remove-orphans || true; \
	exit $$rc

load-e2e: | load-check
	@echo "Load e2e SCENARIO=$(SCENARIO) script=$(K6_SCRIPT) target=$(LOAD_ENV_FILE)"; \
	$(COMPOSE_K6) -p $(LOAD_E2E_PROJECT) run --rm --no-deps k6 run /load/$(K6_SCRIPT)

load-down: load-down-remote
	$(LOAD_COMPOSE) -p $(LOAD_PROJECT) down -v --remove-orphans

load-down-remote:
	$(COMPOSE_K6) -p $(LOAD_E2E_PROJECT) down -v --remove-orphans
