# secretsctl validates infra/.env, drives the shared terraform plane, and its
# verbs need no pre-setup: the state bucket and the seeder carrier role are
# created on demand. The carrier is assumed with an MFA prompt on real AWS,
# prompt-free on Floci; each service's triplet caches for ~12 hours inside
# the secretsctl tree (.session-cache/<service>.json; secrets-session-clear drops it).
#
# Flags pass through verbatim to secretsctl; the default plane is floci, e.g.
#   make secrets-plan ARGS:='--aws'

SECRETSCTL := poetry -C $(abspath ../../tools/secretsctl) run secretsctl --service document-parser

.PHONY: secrets-check secrets-plan secrets-auto-apply secrets-apply secrets-verify secrets-clean secrets-destroy secrets-drop-seeder secrets-session-clear secrets-session-clear-all secrets-test help-secrets

help-secrets:
	@echo "  Secrets pipeline (mk/secrets.mk):"
	@echo "    secrets-check            validate infra/.env and preview the plane/vars (no terraform, no AWS)"
	@echo "    secrets-plan             terraform plan against the selected plane"
	@echo "    secrets-apply            terraform apply (auto on Floci, interactive confirm on real AWS)"
	@echo "    secrets-auto-apply       one-shot seed: validate + terraform plan, apply, verify - stops at the first failure"
	@echo "    secrets-verify           read the live plane and match it against infra/.env (fingerprints only)"
	@echo "    secrets-drop-seeder      detach the seeder policy and delete the role (creator permissions)"
	@echo "    secrets-clean            terraform destroy the secrets blob; keeps the state bucket and ledger"
	@echo "    secrets-destroy          full teardown: terraform destroy, wipe and delete the state bucket, drop the seeder role"
	@echo "    secrets-session-clear    drop the cached seeder session (the next verb assumes the carrier role again)"
	@echo "    secrets-session-clear-all drop every cached seeder session across all services (no service needed)"
	@echo "    secrets-test             run the secretsctl engine test suite"
	@echo "    Flags pass through verbatim: make secrets-plan ARGS:='--aws --dry-run' (default plane: floci)"
	@echo ""

secrets-test:
	make -C ../../tools/secretsctl test

secrets-check:
	$(SECRETSCTL) plan --dry-run $(ARGS)

secrets-plan:
	$(SECRETSCTL) plan $(ARGS)

secrets-apply:
	$(SECRETSCTL) apply $(ARGS)

secrets-auto-apply:
	$(SECRETSCTL) auto-apply $(ARGS)

secrets-verify:
	$(SECRETSCTL) verify $(ARGS)

secrets-drop-seeder:
	$(SECRETSCTL) seeder-drop $(ARGS)

secrets-clean:
	$(SECRETSCTL) destroy $(ARGS)

secrets-destroy:
	$(SECRETSCTL) destroy --purge-state --drop-seeder $(ARGS)

secrets-session-clear:
	$(SECRETSCTL) session-clear $(ARGS)

secrets-session-clear-all:
	$(SECRETSCTL) session-clear-all
