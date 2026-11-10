# Test suites. Unit is the default selection: pytest's addopts deselect the
# `integration` marker, which only runs against a live Floci.

.PHONY: test test-unit test-integration test-all test-cov help-tests

help-tests:
	@echo "  Tests (mk/tests.mk):"
	@echo "    test              unit tests only (no integration)"
	@echo "    test-unit         alias of test"
	@echo "    test-integration  black-box tests against a live Floci"
	@echo "    test-all          unit + integration"
	@echo "    test-cov          unit tests with coverage (fail-under 65)"
	@echo ""

test test-unit:
	$(POETRY) run pytest -q -m "not integration"

test-integration:
	$(POETRY) run pytest -q -m integration -o addopts=""

test-all:
	$(POETRY) run pytest -q -o addopts=""

test-cov:
	$(POETRY) run pytest -m "not integration" --cov=app --cov-report=term-missing --cov-fail-under=65
