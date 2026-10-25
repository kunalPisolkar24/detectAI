# Test suites. The two trees are a hard boundary: tests/unit holds pure logic
# with fakes and no boot, tests/integration drives the production app with the
# real lifespan-config boot. The pytest targets always scope to tests/ so the
# legacy slop/ tree can never enter collection.

.PHONY: test test-unit test-integration help-tests

help-tests:
	@echo "  Tests (mk/tests.mk):"
	@echo "    test              full suite: unit + integration"
	@echo "    test-unit         pure logic only, no boot (tests/unit)"
	@echo "    test-integration  the production app, real lifespan boot (tests/integration)"
	@echo ""

test:
	poetry run pytest tests -q

test-unit:
	poetry run pytest tests/unit -q

test-integration:
	poetry run pytest tests/integration -q
