# The New Relic flow. tools/newrelic.py is the only brain: it validates
# envs/.env, resolves the state plane (Floci via EMULATOR_ENDPOINT, real
# AWS otherwise — same contract as document-parser) and drives terraform.

.PHONY: check bootstrap plan apply help-newrelic

help-newrelic:
	@echo "  New Relic (mk/newrelic.mk):"
	@echo "    check        validate envs/.env, preview the plane and resolve the account live"
	@echo "    bootstrap    create the state bucket for the plane envs/.env selects (idempotent, no key needed)"
	@echo "    plan         terraform plan against the plane envs/.env selects (Floci or real AWS)"
	@echo "    apply        terraform apply (auto on Floci, interactive confirm on real AWS)"
	@echo ""

check:
	python3 tools/newrelic.py check

bootstrap:
	python3 tools/newrelic.py bootstrap

plan:
	python3 tools/newrelic.py plan

apply:
	python3 tools/newrelic.py apply
