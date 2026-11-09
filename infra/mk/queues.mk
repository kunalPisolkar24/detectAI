# The queue fabric flow, driven by tfctl's infra kind: it shapes envs/.env,
# resolves the state plane (PLANE=floci|aws, default floci — the same contract
# as the observability stack) and drives terraform.

.PHONY: plan apply auto-apply destroy seeder-drop session-clear session-refresh help-queues

TFCTL := poetry -C $(abspath ../tools/tfctl) run tfctl
PLANE ?= floci
ifeq ($(PLANE),floci)
PLANE_FLAG := --floci
else ifeq ($(PLANE),aws)
PLANE_FLAG := --aws
else
$(error PLANE must be floci or aws)
endif

help-queues:
	@echo "  Queue fabric (mk/queues.mk):"
	@echo "    plan         terraform plan on the PLANE (floci by default; PLANE=aws rides real AWS)"
	@echo "    apply        terraform apply (auto on Floci, interactive confirm on real AWS)"
	@echo "    auto-apply   plan then apply in one run, stopping at the first failure"
	@echo "    destroy      terraform destroy, auto-approved on both planes"
	@echo "    seeder-drop  detach and delete the stack's seeder carrier role"
	@echo "    session-clear    drop this stack's cached carrier session (other stacks untouched)"
	@echo "    session-refresh  drop and re-mint this stack's carrier session (MFA on real AWS)"
	@echo ""

plan:
	$(TFCTL) --stack-dir $(CURDIR) $(PLANE_FLAG) plan

apply:
	$(TFCTL) --stack-dir $(CURDIR) $(PLANE_FLAG) apply

auto-apply:
	$(TFCTL) --stack-dir $(CURDIR) $(PLANE_FLAG) auto-apply

destroy:
	$(TFCTL) --stack-dir $(CURDIR) $(PLANE_FLAG) destroy

seeder-drop:
	$(TFCTL) --stack-dir $(CURDIR) $(PLANE_FLAG) seeder-drop

session-clear:
	$(TFCTL) --stack-dir $(CURDIR) $(PLANE_FLAG) session-clear

session-refresh:
	$(TFCTL) --stack-dir $(CURDIR) $(PLANE_FLAG) session-refresh
