# Cross-app load testing. One command, one tier parameter.
#
#   make -C e2e load TIER=smoke TARGET=prod
#
# Nothing here provisions infrastructure. Every suite runs the existing
# per-service k6 scripts in remote mode (docker compose run --no-deps), so the
# services under test are whatever the target environment already runs. Only
# the k6 container is started.

E2E_DIR := $(patsubst %/,%,$(dir $(abspath $(lastword $(MAKEFILE_LIST)))))
TARGETS_DIR := $(E2E_DIR)/targets

# Where each service lives. The gateway is nested under services/payments.
SERVICE_DIR_document-parser := $(E2E_DIR)/../services/document-parser
SERVICE_DIR_payment-gateway := $(E2E_DIR)/../services/payments/gateway
SERVICE_DIR_web             := $(E2E_DIR)/../apps/web

COMPOSE_E2E := docker compose -f $(E2E_DIR)/compose.yml -p e2e

TIERS := preflight smoke contract load stress soak
TIER ?= smoke
TARGET ?= local
SERVICE ?=
# Overrides the tier's script for a single run. The document parser and the
# gateway name their scripts after the scenario; the web names them after
# what they exercise, so it takes both a script and a load profile.
SCRIPT ?=
TARGET_FILE ?= $(TARGETS_DIR)/.env.$(TARGET)

# The target file's settings, exported so a service started against this
# target gets the same secrets the test signs with, and so the compose
# interpolation picks up the same endpoints the test uses.
#
# The pairs are set as make variables first and exported by name: `export
# A=1` makes GNU Make hand the value over as "1=", which the broker and the
# compose substitution then read as a different credential.
TARGET_ENV := $(shell sed -n 's/^\([A-Za-z_][A-Za-z0-9_]*\)=\(.*\)$$/\1=\2/p' $(TARGET_FILE) 2>/dev/null)
ifneq ($(strip $(TARGET_ENV)),)
$(foreach pair,$(TARGET_ENV),$(eval $(pair)))
export $(foreach pair,$(TARGET_ENV),$(firstword $(subst =, ,$(pair))))
endif

# Services wired into the harness so far.
WIRED_SERVICES := document-parser payment-gateway web

# The services a run covers. SERVICE narrows it to one.
RUN_SERVICES := $(if $(SERVICE),$(SERVICE),$(WIRED_SERVICES))

# Tier -> k6 scenario, per service. A service with no entry for a tier runs
# the scenario named after the tier.
TIER_SCENARIO_document-parser_smoke    := smoke
TIER_SCENARIO_document-parser_contract := negative
TIER_SCENARIO_document-parser_load     := load
TIER_SCENARIO_document-parser_stress   := stress
TIER_SCENARIO_document-parser_soak     := soak

TIER_SCENARIO_payment-gateway_smoke    := smoke
TIER_SCENARIO_payment-gateway_contract := negative
TIER_SCENARIO_payment-gateway_load     := spike
TIER_SCENARIO_payment-gateway_stress   := stress
TIER_SCENARIO_payment-gateway_soak     := soak

# The web names its scripts after what they exercise, not after the profile
# they run with, so it needs both.
TIER_SCRIPT_web_smoke    := auth.k6.js
TIER_SCRIPT_web_contract := chat-api-invalid.k6.js
TIER_SCRIPT_web_load     := chat-api.k6.js
TIER_SCRIPT_web_stress   := chat-api.k6.js
TIER_SCRIPT_web_soak     := chat-api.k6.js

TIER_SCENARIO_web_smoke    := smoke
TIER_SCENARIO_web_contract := smoke
TIER_SCENARIO_web_load     := load
TIER_SCENARIO_web_stress   := stress
TIER_SCENARIO_web_soak     := load

tier_scenario = $(or $(TIER_SCENARIO_$(1)_$(TIER)),$(TIER))
tier_script = $(or $(TIER_SCRIPT_$(1)_$(TIER)),$(call tier_scenario,$(1)))

# Tier shape. The service's own scenario defaults apply where a tier leaves a
# knob empty. Anything set on the command line wins over the tier.
TIER_VUS_smoke        := 2
TIER_ITERATIONS_smoke := 2
VUS ?= $(TIER_VUS_$(TIER))
ITERATIONS ?= $(TIER_ITERATIONS_$(TIER))

# The per-service make target that starts/stops that service on its own.
SERVICE_UP_document-parser   := parser-up
SERVICE_DOWN_document-parser := parser-down
SERVICE_UP_payment-gateway   := gateway-up
SERVICE_DOWN_payment-gateway := gateway-down
SERVICE_UP_web               := start
SERVICE_DOWN_web             := down

.PHONY: help load $(addprefix load-,$(WIRED_SERVICES)) preflight target-init up down

help:
	@echo "make -C e2e load TIER=<tier> [TARGET=<env>] [SERVICE=<svc>]"
	@echo ""
	@echo "  TIER     $(TIERS)  (default: $(TIER))"
	@echo "  TARGET   an environment file in targets/.env.<name>  (default: $(TARGET))"
	@echo "  SERVICE  one service instead of every wired one"
	@echo ""
	@echo "Shape overrides: VUS= DURATION= RPS= STAGES= MAX_VUS= ITERATIONS="
	@echo ""
	@echo "Other commands: target-init, preflight, up, down"
	@echo ""
	@echo "Wired services: $(WIRED_SERVICES)"
	@echo "Target files:"
	@if ls -1 $(TARGETS_DIR)/.env.* 2>/dev/null | grep -qv '\.env\.example$$'; then \
		ls -1 $(TARGETS_DIR)/.env.* | grep -v '\.env\.example$$' | sed 's|.*/|  |'; \
	else \
		echo "  (none - run 'make -C e2e target-init TARGET=<name>')"; \
	fi

# Create the target file for an environment from the committed template.
target-init:
	@test -f "$(TARGET_FILE)" || cp "$(TARGETS_DIR)/.env.example" "$(TARGET_FILE)"
	@echo "Target file ready: $(TARGET_FILE)"

# Reachability only: is every configured target up?
preflight:
	$(COMPOSE_E2E) --env-file $(TARGET_FILE) run --rm --no-deps k6 run /e2e/preflight.js

load:
	@if ! echo "$(TIERS)" | tr ' ' '\n' | grep -qx "$(TIER)"; then \
		echo "Unknown TIER '$(TIER)'. Use one of: $(TIERS)"; exit 1; \
	fi
	@if [ ! -f "$(TARGET_FILE)" ]; then \
		echo "Missing target file: $(TARGET_FILE)"; \
		echo "Create it with: make -C e2e target-init TARGET=$(TARGET)"; exit 1; \
	fi
	@echo "target=$(TARGET) tier=$(TIER) services=$(RUN_SERVICES)"
	@status=0; \
	if [ "$(TIER)" = "preflight" ]; then \
		$(COMPOSE_E2E) --env-file $(TARGET_FILE) run --rm --no-deps k6 run /e2e/preflight.js || status=$$?; \
	else \
		$(MAKE) -k --no-print-directory $(addprefix load-,$(RUN_SERVICES)) || status=$$?; \
	fi; \
	echo ""; \
	if [ "$$status" -eq 0 ]; then \
		echo "Result: PASS (tier=$(TIER) target=$(TARGET))"; \
	else \
		echo "Result: FAIL (tier=$(TIER) target=$(TARGET))"; \
	fi; \
	exit $$status

load-document-parser:
	@echo ""
	@echo "=== document-parser (tier=$(TIER), scenario=$(or $(SCRIPT),$(call tier_scenario,document-parser))) ==="
	@$(MAKE) --no-print-directory -C $(SERVICE_DIR_document-parser) load-test \
		REMOTE=1 \
		TARGET_ENV_FILE=$(TARGET_FILE) \
		SCENARIO=$(or $(SCRIPT),$(call tier_scenario,document-parser)) \
		VUS=$(VUS) DURATION=$(DURATION) RPS=$(RPS) STAGES=$(STAGES) MAX_VUS=$(MAX_VUS) ITERATIONS=$(ITERATIONS)

load-payment-gateway:
	@echo ""
	@echo "=== payment-gateway (tier=$(TIER), scenario=$(or $(SCRIPT),$(call tier_scenario,payment-gateway))) ==="
	@$(MAKE) --no-print-directory -C $(SERVICE_DIR_payment-gateway) load-test \
		REMOTE=1 \
		TARGET_ENV_FILE=$(TARGET_FILE) \
		SCENARIO=$(or $(SCRIPT),$(call tier_scenario,payment-gateway)) \
		VUS=$(VUS) DURATION=$(DURATION) RPS=$(RPS) STAGES=$(STAGES) MAX_VUS=$(MAX_VUS) ITERATIONS=$(ITERATIONS)

load-web:
	@echo ""
	@echo "=== web (tier=$(TIER), script=$(or $(SCRIPT),$(call tier_script,web)), profile=$(call tier_scenario,web)) ==="
	@$(MAKE) --no-print-directory -C $(SERVICE_DIR_web) load-test \
		REMOTE=1 \
		TARGET_ENV_FILE=$(TARGET_FILE) \
		SCRIPT=$(or $(SCRIPT),$(call tier_script,web)) \
		SCENARIO=$(call tier_scenario,web) \
		VUS=$(VUS) DURATION=$(DURATION) RPS=$(RPS) STAGES=$(STAGES) MAX_VUS=$(MAX_VUS) ITERATIONS=$(ITERATIONS)

# Start a service on its own compose file, the way it normally runs.
up:
	@test -n "$(SERVICE)" || { echo "SERVICE is required (e.g. SERVICE=document-parser)"; exit 1; }
	$(foreach svc,$(SERVICE),$(MAKE) --no-print-directory -C $(SERVICE_DIR_$(svc)) $(SERVICE_UP_$(svc));)

# Stop a service and remove the compose projects a remote load run leaves
# behind: the per-service one and the shared e2e runner. The local load rig is
# left alone.
down:
	@test -n "$(SERVICE)" || { echo "SERVICE is required (e.g. SERVICE=document-parser)"; exit 1; }
	$(foreach svc,$(SERVICE),$(MAKE) --no-print-directory -C $(SERVICE_DIR_$(svc)) $(SERVICE_DOWN_$(svc));)
	$(foreach svc,$(SERVICE),$(MAKE) --no-print-directory -C $(SERVICE_DIR_$(svc)) load-down-remote;)
	$(COMPOSE_E2E) down --remove-orphans
