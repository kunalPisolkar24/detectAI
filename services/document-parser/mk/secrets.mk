# Secrets pipeline. tools/secrets.py is the only brain here: it validates
# infra/.env, maps it onto TF_VAR_* variables and drives the service terraform
# stack (infra/terraform). Nothing in this file talks to AWS itself.

.PHONY: secrets-check secrets-plan secrets-apply help-secrets

help-secrets:
	@echo "  Secrets pipeline (mk/secrets.mk):"
	@echo "    secrets-check   validate infra/.env and preview the plane/vars (no terraform, no AWS)"
	@echo "    secrets-plan    terraform plan against the plane .env selects"
	@echo "    secrets-apply   terraform apply (auto on Floci, interactive confirm on real AWS)"
	@echo ""

secrets-check:
	poetry run python tools/secrets.py plan --dry-run

secrets-plan:
	poetry run python tools/secrets.py plan

secrets-apply:
	poetry run python tools/secrets.py apply
