# The New Relic flow, driven by tfctl's observability kind: it validates
# envs/.env, resolves the state plane (PLANE=floci|aws, default floci — the
# same contract as document-parser) and drives terraform.

.PHONY: check plan apply help-newrelic

TFCTL := poetry -C $(abspath ../tools/tfctl) run tfctl
PLANE ?= floci
ifeq ($(PLANE),floci)
PLANE_FLAG := --floci
else ifeq ($(PLANE),aws)
PLANE_FLAG := --aws
else
$(error PLANE must be floci or aws)
endif

help-newrelic:
	@echo "  New Relic (mk/newrelic.mk):"
	@echo "    check        validate envs/.env, preview the plane and resolve the account live"
	@echo "    plan         terraform plan on the PLANE (floci by default; PLANE=aws rides real AWS)"
	@echo "    apply        terraform apply (auto on Floci, interactive confirm on real AWS; PLANE=aws rides real AWS)"
	@echo ""

check:
	$(TFCTL) --stack-dir $(CURDIR) $(PLANE_FLAG) check

plan:
	$(TFCTL) --stack-dir $(CURDIR) $(PLANE_FLAG) plan

apply:
	$(TFCTL) --stack-dir $(CURDIR) $(PLANE_FLAG) apply
