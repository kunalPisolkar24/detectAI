# The nine secretsctl verbs wrapped for the tool tree. Flags append only when
# their switch is 1, so validate-secrets-vars must reject an invalid PLANE
# first — PLANE_FLAG's default branch would otherwise silently pick --floci.
.PHONY: help-secrets validate-secrets-vars require-service \
	secrets-plan secrets-apply secrets-auto-apply secrets-verify secrets-destroy \
	secrets-drop-seeder secrets-session-clear secrets-session-clear-all secrets-session-refresh-all

SERVICE ?=
PLANE ?= floci
DRY_RUN ?= 0
PURGE_STATE ?= 0
FORCE_DELETE ?= 0
DROP_SEEDER ?= 0
FORCE ?= 0

SECRETSCTL := $(POETRY) run secretsctl
PLANE_FLAG := $(if $(filter aws,$(PLANE)),--aws,--floci)
SECRET_FLAGS := $(if $(filter 1,$(DRY_RUN)),--dry-run)
DESTROY_FLAGS := $(strip $(SECRET_FLAGS) $(if $(filter 1,$(PURGE_STATE)),--purge-state) $(if $(filter 1,$(FORCE_DELETE)),--force-delete) $(if $(filter 1,$(DROP_SEEDER)),--drop-seeder))
SECRETSCTL_SVC := $(strip $(SECRETSCTL) --service $(SERVICE) $(PLANE_FLAG))

validate-secrets-vars:
	@if [ "$(PLANE)" != "floci" ] && [ "$(PLANE)" != "aws" ]; then \
		echo "Invalid PLANE '$(PLANE)'. Use PLANE=floci or PLANE=aws."; exit 1; \
	fi
	@if [ "$(DRY_RUN)" != "0" ] && [ "$(DRY_RUN)" != "1" ]; then \
		echo "Invalid DRY_RUN '$(DRY_RUN)'. Use 0 or 1."; exit 1; \
	fi
	@if [ "$(PURGE_STATE)" != "0" ] && [ "$(PURGE_STATE)" != "1" ]; then \
		echo "Invalid PURGE_STATE '$(PURGE_STATE)'. Use 0 or 1."; exit 1; \
	fi
	@if [ "$(FORCE_DELETE)" != "0" ] && [ "$(FORCE_DELETE)" != "1" ]; then \
		echo "Invalid FORCE_DELETE '$(FORCE_DELETE)'. Use 0 or 1."; exit 1; \
	fi
	@if [ "$(DROP_SEEDER)" != "0" ] && [ "$(DROP_SEEDER)" != "1" ]; then \
		echo "Invalid DROP_SEEDER '$(DROP_SEEDER)'. Use 0 or 1."; exit 1; \
	fi
	@if [ "$(FORCE)" != "0" ] && [ "$(FORCE)" != "1" ]; then \
		echo "Invalid FORCE '$(FORCE)'. Use 0 or 1."; exit 1; \
	fi

require-service:
	@test -n "$(SERVICE)" || { echo "SERVICE=<name> is required for this target (e.g. SERVICE=web)."; exit 1; }

secrets-plan: validate-secrets-vars require-service
	$(SECRETSCTL_SVC) $(SECRET_FLAGS) plan

secrets-apply: validate-secrets-vars require-service
	$(SECRETSCTL_SVC) $(SECRET_FLAGS) apply

secrets-auto-apply: validate-secrets-vars require-service
	$(SECRETSCTL_SVC) $(SECRET_FLAGS) auto-apply

secrets-verify: validate-secrets-vars require-service
	$(SECRETSCTL_SVC) $(SECRET_FLAGS) verify

secrets-destroy: validate-secrets-vars require-service
	$(SECRETSCTL_SVC) $(DESTROY_FLAGS) destroy

secrets-drop-seeder: validate-secrets-vars require-service
	$(SECRETSCTL_SVC) seeder-drop

secrets-session-clear: validate-secrets-vars require-service
	$(SECRETSCTL_SVC) session-clear

secrets-session-clear-all: validate-secrets-vars
	$(SECRETSCTL) session-clear-all

secrets-session-refresh-all: validate-secrets-vars
	$(SECRETSCTL) session-refresh-all $(if $(filter 1,$(FORCE)),--force) $(SECRET_FLAGS)

help-secrets:
	@echo "Secrets verbs (mk/secrets.mk):"
	@echo "  secrets-plan              terraform plan (SERVICE=<name> required)"
	@echo "  secrets-apply             terraform apply (auto on floci, confirm on aws)"
	@echo "  secrets-auto-apply        one shot: plan + apply + verify, stops at the first failure"
	@echo "  secrets-verify            fingerprint check of the live plane against .env"
	@echo "  secrets-destroy           terraform destroy; switches: PURGE_STATE=1 (state bucket), DROP_SEEDER=1 (role), FORCE_DELETE=1 (skip recovery window)"
	@echo "  secrets-drop-seeder       detach the seeder policy and delete the role (SERVICE=<name>)"
	@echo "  secrets-session-clear     drop the service's cached seeder session (SERVICE=<name>)"
	@echo "  secrets-session-clear-all drop every cached seeder session"
	@echo "  secrets-session-refresh-all  mint fresh sessions for every ready service (FORCE=1 re-mints, DRY_RUN=1 lists only)"
	@echo "  Switches: PLANE=floci|aws (default floci) DRY_RUN=0|1 PURGE_STATE=0|1 FORCE_DELETE=0|1 DROP_SEEDER=0|1 FORCE=0|1"
	@echo ""
