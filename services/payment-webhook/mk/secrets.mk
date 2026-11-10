# tfctl drives this service's whole secrets plane; a rare one-off (an alternate
# values file) runs tfctl directly: poetry -C ../../tools/tfctl run tfctl.

PLANE ?= floci
DRY_RUN ?= 0
FORCE ?= 0
FORCE_DELETE ?= 0

ifeq ($(PLANE),floci)
PLANE_FLAG := --floci
else ifeq ($(PLANE),aws)
PLANE_FLAG := --aws
else
$(error PLANE must be floci or aws)
endif
ifneq ($(filter 0 1,$(DRY_RUN)),$(DRY_RUN))
$(error DRY_RUN must be 0 or 1)
endif
ifneq ($(filter 0 1,$(FORCE)),$(FORCE))
$(error FORCE must be 0 or 1)
endif
ifneq ($(filter 0 1,$(FORCE_DELETE)),$(FORCE_DELETE))
$(error FORCE_DELETE must be 0 or 1)
endif

TFCTL := poetry -C $(abspath ../../tools/tfctl) run tfctl --service payment-webhook
FLAGS := $(PLANE_FLAG) $(if $(filter 1,$(DRY_RUN)),--dry-run) $(if $(filter 1,$(FORCE)),--force) $(if $(filter 1,$(FORCE_DELETE)),--force-delete)

.PHONY: secrets-check secrets-plan secrets-auto-apply secrets-apply secrets-verify secrets-clean secrets-destroy secrets-drop-seeder secrets-session-clear secrets-session-clear-all secrets-session-refresh-all secrets-test help-secrets

help-secrets:
	@echo "  Secrets pipeline (mk/secrets.mk):"
	@echo "    secrets-check            validate infra/.env and preview the plane/vars (no terraform)"
	@echo "    secrets-plan             terraform plan"
	@echo "    secrets-apply            terraform apply (auto on floci, interactive confirm on aws)"
	@echo "    secrets-auto-apply       one-shot seed: validate + terraform plan, apply, verify - stops at the first failure"
	@echo "    secrets-verify           read the live plane and match it against infra/.env (fingerprints only)"
	@echo "    secrets-drop-seeder      detach the seeder policy and delete the role (creator permissions, no confirmation)"
	@echo "    secrets-clean            terraform destroy the secrets blob; keeps the state bucket and ledger"
	@echo "    secrets-destroy          full teardown: terraform destroy, purge the state bucket, drop the seeder role (no confirmations)"
	@echo "    secrets-session-clear    drop the cached seeder session (the next verb assumes the carrier role again)"
	@echo "    secrets-session-clear-all drop every cached seeder session across all services"
	@echo "    secrets-session-refresh-all mint fresh seeder sessions for every ready service in one run"
	@echo "    secrets-test             run the tfctl engine test suite"
	@echo "  Switches: PLANE=floci|aws (default floci) DRY_RUN=0|1 FORCE=0|1 (refresh-all) FORCE_DELETE=0|1 (destroy)"
	@echo ""

secrets-test:
	make -C ../../tools/tfctl test

secrets-check:
	$(TFCTL) plan --dry-run $(PLANE_FLAG)

secrets-plan:
	$(TFCTL) plan $(FLAGS)

secrets-apply:
	$(TFCTL) apply $(FLAGS)

secrets-auto-apply:
	$(TFCTL) auto-apply $(FLAGS)

secrets-verify:
	$(TFCTL) verify $(FLAGS)

secrets-drop-seeder:
	$(TFCTL) seeder-drop $(FLAGS)

secrets-clean:
	$(TFCTL) destroy $(FLAGS)

secrets-destroy:
	$(TFCTL) destroy --purge-state --drop-seeder $(FLAGS)

secrets-session-clear:
	$(TFCTL) session-clear $(FLAGS)

secrets-session-clear-all:
	$(TFCTL) session-clear-all

secrets-session-refresh-all:
	$(TFCTL) session-refresh-all $(FLAGS)
