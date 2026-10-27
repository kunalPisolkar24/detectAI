# Offline terraform tasks; nothing here needs a New Relic key. init clears
# the recorded backend first: a plane run (Floci or real AWS) leaves an S3
# record in .terraform/ that -backend=false init would still consult.

.PHONY: env fmt init validate test help-local

help-local:
	@echo "  Local (mk/local.mk):"
	@echo "    env        create envs/.env from envs/.env.example if missing"
	@echo "    fmt        terraform fmt -check -recursive -diff"
	@echo "    init       terraform init -backend=false (offline, for validate/test)"
	@echo "    validate   terraform validate"
	@echo "    test       terraform test (mocked, no network, no key)"
	@echo ""

env:
	@test -f envs/.env || cp envs/.env.example envs/.env
	@echo "envs/.env ready (edit envs/.env to fill NEW_RELIC_API_KEY)"

fmt:
	terraform fmt -check -recursive -diff

init:
	rm -f .terraform/terraform.tfstate
	terraform init -backend=false -input=false

validate:
	terraform validate

test:
	terraform test
