# Secrets pipeline. tools/secrets.py is the only brain here: it validates
# infra/.env, maps it onto TF_VAR_* variables and drives the service terraform
# stack (infra/terraform). Its `bootstrap` verb creates the plane's state
# bucket, and `destroy --purge-state` deletes it again — the steps that touch
# AWS directly beside terraform itself.

.PHONY: secrets-check secrets-plan secrets-apply secrets-clean secrets-destroy secrets-bootstrap-state secrets-iam-bootstrap secrets-test help-secrets

help-secrets:
	@echo "  Secrets pipeline (mk/secrets.mk):"
	@echo "    secrets-check           validate infra/.env and preview the plane/vars (no terraform, no AWS)"
	@echo "    secrets-bootstrap-state create the state bucket for the plane .env selects (idempotent)"
	@echo "    secrets-plan            terraform plan against the plane .env selects"
	@echo "    secrets-apply           terraform apply (auto on Floci, interactive confirm on real AWS)"
	@echo "    secrets-iam-bootstrap   create/update the out-of-stack deploy role (detectai-document-parser-deploy)"
	@echo "    secrets-clean           terraform destroy the secrets blob; keeps the state bucket and ledger"
	@echo "    secrets-destroy         full teardown: terraform destroy, wipe and delete the state bucket, drop the deploy role"
	@echo "    secrets-test            run the focused pytest for tools/secrets.py"
	@echo ""

secrets-test:
	poetry run pytest tests/unit/test_secrets.py -q

secrets-check:
	poetry run python tools/secrets.py plan --dry-run

secrets-bootstrap-state:
	poetry run python tools/secrets.py bootstrap

secrets-plan:
	poetry run python tools/secrets.py plan

secrets-apply:
	poetry run python tools/secrets.py apply

secrets-iam-bootstrap:
	poetry run python tools/secrets.py iam-bootstrap

secrets-clean:
	poetry run python tools/secrets.py destroy

secrets-destroy:
	poetry run python tools/secrets.py destroy --purge-state --drop-iam
