# secretsctl validates infra/.env, drives the shared terraform plane, and its
# bootstrap/drop verbs are the steps that touch AWS directly. The carrier runs
# session-less: the tool resolves ambient credentials itself (Floci fakes, or
# auto-detected identity + seeder role session on real AWS).
#
# Plane selection: PLANE=floci (default) or PLANE=aws, e.g.
#   make secrets-plan PLANE=aws

SECRETSCTL := poetry -C $(abspath ../../tools/secretsctl) run secretsctl --service document-parser
PLANE ?= floci
PLANE_FLAG := $(if $(filter aws,$(PLANE)),--aws,)

.PHONY: secrets-check secrets-plan secrets-apply secrets-verify secrets-clean secrets-destroy secrets-bootstrap-state secrets-seeder-bootstrap secrets-drop-seeder secrets-session-clear secrets-test help-secrets

help-secrets:
	@echo "  Secrets pipeline (mk/secrets.mk):"
	@echo "    secrets-check            validate infra/.env and preview the plane/vars (no terraform, no AWS)"
	@echo "    secrets-bootstrap-state  create the state bucket for the selected plane (idempotent)"
	@echo "    secrets-plan             terraform plan against the selected plane"
	@echo "    secrets-apply            terraform apply (auto on Floci, interactive confirm on real AWS)"
	@echo "    secrets-verify           read the live plane and match it against infra/.env (fingerprints only)"
	@echo "    secrets-seeder-bootstrap create/update the out-of-stack seeder role (detectai-document-parser-seeder)"
	@echo "    secrets-drop-seeder      detach the seeder policy and delete the role (creator permissions)"
	@echo "    secrets-clean            terraform destroy the secrets blob; keeps the state bucket and ledger"
	@echo "    secrets-destroy          full teardown: terraform destroy, wipe and delete the state bucket, drop the seeder role"
	@echo "    secrets-session-clear    drop the cached seeder session (the next verb re-prompts for MFA)"
	@echo "    secrets-test             run the secretsctl engine test suite"
	@echo "    Override the plane: PLANE=aws make secrets-plan (default PLANE=floci)"
	@echo ""

secrets-test:
	make -C ../../tools/secretsctl test

secrets-check:
	$(SECRETSCTL) $(PLANE_FLAG) plan --dry-run

secrets-bootstrap-state:
	$(SECRETSCTL) $(PLANE_FLAG) bootstrap

secrets-plan:
	$(SECRETSCTL) $(PLANE_FLAG) plan

secrets-apply:
	$(SECRETSCTL) $(PLANE_FLAG) apply

secrets-verify:
	$(SECRETSCTL) $(PLANE_FLAG) verify

secrets-seeder-bootstrap:
	$(SECRETSCTL) $(PLANE_FLAG) seeder-bootstrap

secrets-drop-seeder:
	$(SECRETSCTL) $(PLANE_FLAG) seeder-drop

secrets-clean:
	$(SECRETSCTL) $(PLANE_FLAG) destroy

secrets-destroy:
	$(SECRETSCTL) $(PLANE_FLAG) destroy --purge-state --drop-seeder

secrets-session-clear:
	$(SECRETSCTL) $(PLANE_FLAG) session-clear
