# The New Relic flow, driven by tfctl's observability kind: it validates
# envs/.env, resolves the state plane (Floci via EMULATOR_ENDPOINT, real AWS
# otherwise — the same contract as document-parser) and drives terraform.
# PLANE is optional: unset lets envs/.env decide, `aws` or `floci` overrides
# it for one run (make plan PLANE=aws).

.PHONY: validate-plane check bootstrap plan apply help-newrelic

TFCTL := poetry -C $(abspath ../tools/tfctl) run tfctl
PLANE ?=
PLANE_FLAG := $(if $(filter aws,$(PLANE)),--aws,$(if $(filter floci,$(PLANE)),--floci,))

validate-plane:
	@if [ -n "$(PLANE)" ] && [ "$(PLANE)" != "aws" ] && [ "$(PLANE)" != "floci" ]; then \
		echo "error: PLANE must be empty, aws or floci (got $(PLANE))"; exit 1; fi

help-newrelic:
	@echo "  New Relic (mk/newrelic.mk):"
	@echo "    check        validate envs/.env, preview the plane and resolve the account live"
	@echo "    bootstrap    create the state bucket for the plane envs/.env selects (idempotent, no key needed)"
	@echo "    plan         terraform plan against the plane envs/.env selects (Floci or real AWS; PLANE=aws overrides)"
	@echo "    apply        terraform apply (auto on Floci, interactive confirm on real AWS; PLANE=aws overrides)"
	@echo ""

check: validate-plane
	$(TFCTL) --stack-dir $(CURDIR) $(PLANE_FLAG) check

bootstrap: validate-plane
	$(TFCTL) --stack-dir $(CURDIR) $(PLANE_FLAG) bootstrap

plan: validate-plane
	$(TFCTL) --stack-dir $(CURDIR) $(PLANE_FLAG) plan

apply: validate-plane
	$(TFCTL) --stack-dir $(CURDIR) $(PLANE_FLAG) apply
