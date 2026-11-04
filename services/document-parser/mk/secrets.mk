# secretsctl validates infra/.env, drives the shared terraform plane, and its
# verbs need no pre-setup: the state bucket and the seeder carrier role are
# created on demand. The carrier is assumed with an MFA prompt on real AWS,
# prompt-free on Floci; the triplet caches for ~12 hours in
# infra/.aws-session.json (secrets-session-clear drops it).
#
# Plane selection: PLANE=floci (default) or PLANE=aws, e.g.
#   make secrets-plan PLANE=aws

SECRETSCTL := poetry -C $(abspath ../../tools/secretsctl) run secretsctl --service document-parser
PLANE ?= floci
PLANE_FLAG := $(if $(filter aws,$(PLANE)),--aws,)

.PHONY: secrets-check secrets-plan secrets-apply secrets-verify secrets-clean secrets-destroy secrets-drop-seeder secrets-session-clear secrets-test help-secrets

help-secrets:
	@echo "  Secrets pipeline (mk/secrets.mk):"
	@echo "    secrets-check            validate infra/.env and preview the plane/vars (no terraform, no AWS)"
	@echo "    secrets-plan             terraform plan against the selected plane"
	@echo "    secrets-apply            terraform apply (auto on Floci, interactive confirm on real AWS)"
	@echo "    secrets-verify           read the live plane and match it against infra/.env (fingerprints only)"
	@echo "    secrets-drop-seeder      detach the seeder policy and delete the role (creator permissions)"
	@echo "    secrets-clean            terraform destroy the secrets blob; keeps the state bucket and ledger"
	@echo "    secrets-destroy          full teardown: terraform destroy, wipe and delete the state bucket, drop the seeder role"
	@echo "    secrets-session-clear    drop the cached seeder session (the next verb assumes the carrier role again)"
	@echo "    secrets-test             run the secretsctl engine test suite"
	@echo "    Override the plane: PLANE=aws make secrets-plan (default PLANE=floci)"
	@echo ""

secrets-test:
	make -C ../../tools/secretsctl test

secrets-check:
	$(SECRETSCTL) $(PLANE_FLAG) plan --dry-run

secrets-plan:
	$(SECRETSCTL) $(PLANE_FLAG) plan

secrets-apply:
	$(SECRETSCTL) $(PLANE_FLAG) apply

secrets-verify:
	$(SECRETSCTL) $(PLANE_FLAG) verify

secrets-drop-seeder:
	$(SECRETSCTL) $(PLANE_FLAG) seeder-drop

secrets-clean:
	$(SECRETSCTL) $(PLANE_FLAG) destroy

secrets-destroy:
	$(SECRETSCTL) $(PLANE_FLAG) destroy --purge-state --drop-seeder

secrets-session-clear:
	$(SECRETSCTL) $(PLANE_FLAG) session-clear
