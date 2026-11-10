# The New Relic flow, driven by tfctl's observability kind: it validates
# envs/.env, resolves the state plane (PLANE=floci|aws, default floci — the
# same contract as document-parser) and drives terraform.

.PHONY: check plan apply auto-apply destroy audit session-clear session-refresh help-newrelic

TFCTL := poetry -C $(abspath ../tools/tfctl) run tfctl
AUDIT := python3 $(CURDIR)/scripts/board-audit.py
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
	@echo "    check        validate envs/.env, preview the plane, resolve the account live, audit the boards"
	@echo "    audit        census the account's boards against the declared templates - fails on duplicates"
	@echo "    plan         terraform plan on the PLANE (floci by default; PLANE=aws rides real AWS)"
	@echo "    apply        terraform apply (auto on Floci, interactive confirm on real AWS; PLANE=aws rides real AWS), then audit"
	@echo "    auto-apply   plan then apply in one run, stopping at the first failure, then audit"
	@echo "    destroy      terraform destroy, auto-approved on both planes (tfctl --purge-state/--drop-seeder add teardown tails)"
	@echo "    session-clear    drop this stack's cached carrier session (other stacks untouched)"
	@echo "    session-refresh  drop and re-mint this stack's carrier session (MFA on real AWS)"
	@echo ""

check:
	$(TFCTL) --stack-dir $(CURDIR) $(PLANE_FLAG) check
	$(AUDIT)

audit:
	$(AUDIT)

plan:
	$(TFCTL) --stack-dir $(CURDIR) $(PLANE_FLAG) plan

apply:
	$(TFCTL) --stack-dir $(CURDIR) $(PLANE_FLAG) apply
	$(AUDIT)

auto-apply:
	$(TFCTL) --stack-dir $(CURDIR) $(PLANE_FLAG) auto-apply
	$(AUDIT)

destroy:
	$(TFCTL) --stack-dir $(CURDIR) $(PLANE_FLAG) destroy

session-clear:
	$(TFCTL) --stack-dir $(CURDIR) $(PLANE_FLAG) session-clear

session-refresh:
	$(TFCTL) --stack-dir $(CURDIR) $(PLANE_FLAG) session-refresh
