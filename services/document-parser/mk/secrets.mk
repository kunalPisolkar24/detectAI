# Secrets pipeline. tools/secrets.py is the only brain here: it validates
# infra/.env, maps it onto TF_VAR_* variables and drives the service terraform
# stack (infra/terraform). Its `bootstrap` verb (below) is the one step that
# calls AWS directly — the `aws` CLI creating the state bucket.

.PHONY: secrets-check secrets-plan secrets-apply secrets-bootstrap-state secrets-test help-secrets

help-secrets:
	@echo "  Secrets pipeline (mk/secrets.mk):"
	@echo "    secrets-check           validate infra/.env and preview the plane/vars (no terraform, no AWS)"
	@echo "    secrets-bootstrap-state create the state bucket for the plane .env selects (idempotent)"
	@echo "    secrets-plan            terraform plan against the plane .env selects"
	@echo "    secrets-apply           terraform apply (auto on Floci, interactive confirm on real AWS)"
	@echo "    secrets-test            run the focused pytest for tools/secrets.py"
	@echo ""

secrets-test:
	poetry run pytest tests/test_secrets.py -q

secrets-check:
	poetry run python tools/secrets.py plan --dry-run

secrets-bootstrap-state:
	poetry run python tools/secrets.py bootstrap

secrets-plan:
	poetry run python tools/secrets.py plan

secrets-apply:
	poetry run python tools/secrets.py apply
