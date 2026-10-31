# tools/secrets.py: validates infra/.env, drives the terraform stack, and
# its bootstrap/destroy verbs are the steps that touch AWS directly.

# AWS-touching verbs run under the seeder profile (environment exports still win).
AWS_PROFILE ?= dp-seeder
SEEDER_ENV := AWS_PROFILE=$(AWS_PROFILE)

.PHONY: secrets-check secrets-plan secrets-apply secrets-clean secrets-destroy secrets-bootstrap-state secrets-seeder-bootstrap secrets-test help-secrets

help-secrets:
	@echo "  Secrets pipeline (mk/secrets.mk):"
	@echo "    secrets-check            validate infra/.env and preview the plane/vars (no terraform, no AWS)"
	@echo "    secrets-bootstrap-state  create the state bucket for the plane .env selects (idempotent)"
	@echo "    secrets-plan             terraform plan against the plane .env selects"
	@echo "    secrets-apply            terraform apply (auto on Floci, interactive confirm on real AWS)"
	@echo "    secrets-seeder-bootstrap create/update the out-of-stack seeder role (detectai-document-parser-seeder)"
	@echo "    secrets-clean            terraform destroy the secrets blob; keeps the state bucket and ledger"
	@echo "    secrets-destroy          full teardown: terraform destroy, wipe and delete the state bucket, drop the seeder role"
	@echo "    secrets-test             run the focused pytest for tools/secrets.py"
	@echo ""

secrets-test:
	poetry run pytest tests/unit/config/test_secrets_tool.py -q

secrets-check:
	$(SEEDER_ENV) poetry run python tools/secrets.py plan --dry-run

secrets-bootstrap-state:
	$(SEEDER_ENV) poetry run python tools/secrets.py bootstrap

secrets-plan:
	$(SEEDER_ENV) poetry run python tools/secrets.py plan

secrets-apply:
	$(SEEDER_ENV) poetry run python tools/secrets.py apply

secrets-seeder-bootstrap:
	$(SEEDER_ENV) poetry run python tools/secrets.py seeder-bootstrap

secrets-clean:
	$(SEEDER_ENV) poetry run python tools/secrets.py destroy

secrets-destroy:
	$(SEEDER_ENV) poetry run python tools/secrets.py destroy --purge-state --drop-seeder
