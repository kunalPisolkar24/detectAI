# tools/secrets.py validates infra/.env, drives the terraform stack, and its
# bootstrap/drop verbs are the steps that touch AWS directly. The carrier runs
# session-less: the tool resolves ambient credentials itself (Floci fakes, or
# auto-detected identity + seeder role session on real AWS).

.PHONY: secrets-check secrets-plan secrets-apply secrets-clean secrets-destroy secrets-bootstrap-state secrets-seeder-bootstrap secrets-drop-seeder secrets-session-clear secrets-test help-secrets

help-secrets:
	@echo "  Secrets pipeline (mk/secrets.mk):"
	@echo "    secrets-check            validate infra/.env and preview the plane/vars (no terraform, no AWS)"
	@echo "    secrets-bootstrap-state  create the state bucket for the plane .env selects (idempotent)"
	@echo "    secrets-plan             terraform plan against the plane .env selects"
	@echo "    secrets-apply            terraform apply (auto on Floci, interactive confirm on real AWS)"
	@echo "    secrets-seeder-bootstrap create/update the out-of-stack seeder role (detectai-document-parser-seeder)"
	@echo "    secrets-drop-seeder      detach the seeder policy and delete the role (creator permissions)"
	@echo "    secrets-clean            terraform destroy the secrets blob; keeps the state bucket and ledger"
	@echo "    secrets-destroy          full teardown: terraform destroy, wipe and delete the state bucket, drop the seeder role"
	@echo "    secrets-session-clear    drop the cached seeder session (the next verb re-prompts for MFA)"
	@echo "    secrets-test             run the focused pytest for tools/secrets.py"
	@echo ""

secrets-test:
	poetry run pytest tests/unit/config/test_secrets_tool.py -q

secrets-check:
	poetry run python tools/secrets.py plan --dry-run

secrets-bootstrap-state:
	poetry run python tools/secrets.py bootstrap

secrets-plan:
	poetry run python tools/secrets.py plan

secrets-apply:
	poetry run python tools/secrets.py apply

secrets-seeder-bootstrap:
	poetry run python tools/secrets.py seeder-bootstrap

secrets-drop-seeder:
	poetry run python tools/secrets.py seeder-drop

secrets-clean:
	poetry run python tools/secrets.py destroy

secrets-destroy:
	poetry run python tools/secrets.py destroy --purge-state --drop-seeder

secrets-session-clear:
	poetry run python tools/secrets.py session-clear
