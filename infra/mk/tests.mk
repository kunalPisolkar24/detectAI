# Offline terraform checks; nothing here touches a plane. init clears the
# recorded backend first: a plane run (Floci or real AWS) leaves an S3
# record in .terraform/ that -backend=false init would still consult.

.PHONY: env fmt init validate test help-tests

TF_DIR := terraform

help-tests:
	@echo "  Tests (mk/tests.mk):"
	@echo "    env        create envs/.env from envs/.env.example if missing"
	@echo "    fmt        terraform fmt -check -recursive -diff"
	@echo "    init       terraform init -backend=false (offline, for validate/test)"
	@echo "    validate   terraform validate"
	@echo "    test       terraform test (mocked, no network, no plane)"
	@echo ""

env:
	@test -f envs/.env || cp envs/.env.example envs/.env
	@echo "envs/.env ready (edit only TF_STATE_BUCKET or AWS_REGION as wanted)"

fmt:
	terraform -chdir=$(TF_DIR) fmt -check -recursive -diff

init:
	rm -f $(TF_DIR)/.terraform/terraform.tfstate
	terraform -chdir=$(TF_DIR) init -backend=false -input=false

validate:
	terraform -chdir=$(TF_DIR) validate

test:
	terraform -chdir=$(TF_DIR) test
