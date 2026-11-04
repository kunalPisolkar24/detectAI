# secretsctl validates infra/.env, drives the terraform stack, and its
# bootstrap/drop verbs are the steps that touch AWS directly. The carrier runs
# session-less: the tool resolves ambient credentials itself (Floci fakes, or
# auto-detected identity + seeder role session on real AWS).

SECRETSCTL := poetry -C $(abspath ../../tools/secretsctl) run secretsctl --service document-parser

.PHONY: secrets-check secrets-plan secrets-apply secrets-verify secrets-clean secrets-destroy secrets-bootstrap-state secrets-seeder-bootstrap secrets-drop-seeder secrets-session-clear secrets-test help-secrets

help-secrets:
	@echo "  Secrets pipeline (mk/secrets.mk):"
	@echo "    secrets-check            validate infra/.env and preview the plane/vars (no terraform, no AWS)"
	@echo "    secrets-bootstrap-state  create the state bucket for the plane .env selects (idempotent)"
	@echo "    secrets-plan             terraform plan against the plane .env selects"
	@echo "    secrets-apply            terraform apply (auto on Floci, interactive confirm on real AWS)"
	@echo "    secrets-verify           read the live plane and match it against infra/.env (fingerprints only)"
	@echo "    secrets-seeder-bootstrap create/update the out-of-stack seeder role (detectai-document-parser-seeder)"
	@echo "    secrets-drop-seeder      detach the seeder policy and delete the role (creator permissions)"
	@echo "    secrets-clean            terraform destroy the secrets blob; keeps the state bucket and ledger"
	@echo "    secrets-destroy          full teardown: terraform destroy, wipe and delete the state bucket, drop the seeder role"
	@echo "    secrets-session-clear    drop the cached seeder session (the next verb re-prompts for MFA)"
	@echo "    secrets-test             run the secretsctl engine test suite"
	@echo ""

secrets-test:
	make -C ../../tools/secretsctl test

secrets-check:
	$(SECRETSCTL) plan --dry-run

secrets-bootstrap-state:
	$(SECRETSCTL) bootstrap

secrets-plan:
	$(SECRETSCTL) plan

secrets-apply:
	$(SECRETSCTL) apply

secrets-verify:
	$(SECRETSCTL) verify

secrets-seeder-bootstrap:
	$(SECRETSCTL) seeder-bootstrap

secrets-drop-seeder:
	$(SECRETSCTL) seeder-drop

secrets-clean:
	$(SECRETSCTL) destroy

secrets-destroy:
	$(SECRETSCTL) destroy --purge-state --drop-seeder

secrets-session-clear:
	$(SECRETSCTL) session-clear
