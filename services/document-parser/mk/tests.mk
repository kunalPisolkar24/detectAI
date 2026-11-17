# Test suites. The two trees are a hard boundary: tests/unit holds pure logic
# with fakes and no boot, tests/integration drives the production app with the
# real lifespan-config boot. The pytest targets always scope to tests/.

.PHONY: test test-unit test-integration test-cov test-cov-unit test-cov-html load-fixtures help-tests

COV_FLAGS := --cov=app --cov-report=term-missing

help-tests:
	@echo "  Tests (mk/tests.mk):"
	@echo "    test              full suite: unit + integration"
	@echo "    test-unit         pure logic only, no boot (tests/unit)"
	@echo "    test-integration  the production app, real lifespan boot (tests/integration)"
	@echo "    test-cov          full suite with coverage, 95% gate (term-missing report)"
	@echo "    test-cov-unit     unit tests with coverage, no gate (tests/unit)"
	@echo "    test-cov-html     full suite with coverage + browsable HTML report (htmlcov/)"
	@echo "    load-fixtures     regenerate the load corpus under tests/load/assets (gitignored)"
	@echo ""

test: test-cov

test-unit:
	poetry run pytest tests/unit -q

test-integration:
	poetry run pytest tests/integration -q

test-cov:
	poetry run pytest tests -q $(COV_FLAGS)

test-cov-unit:
	poetry run pytest tests/unit -q $(COV_FLAGS) --cov-fail-under=0

test-cov-html:
	poetry run pytest tests -q $(COV_FLAGS) --cov-report=html

load-fixtures:
	poetry run python -m tests.load.generate
