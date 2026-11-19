# Test suites. Unit is the default pytest selection (`-m "not integration"` in
# addopts); the coverage targets lift it so the gate measures the full tree.
# Integration tests skip cleanly without a live Floci.

.PHONY: test test-unit test-integration test-all test-cov test-cov-unit test-cov-html help-tests

COV_FLAGS := --cov=app --cov-report=term-missing

help-tests:
	@echo "  Tests (mk/tests.mk):"
	@echo "    test              full suite with coverage, 95% gate (test-cov alias)"
	@echo "    test-unit         unit tests only, no boot (no coverage)"
	@echo "    test-integration  black-box tests against a live Floci"
	@echo "    test-all          unit + integration, no coverage"
	@echo "    test-cov          full suite with coverage, 95% gate (term-missing report)"
	@echo "    test-cov-unit     unit tests with coverage, no gate"
	@echo "    test-cov-html     full suite with coverage + browsable HTML report (htmlcov/)"
	@echo ""

test: test-cov

test-unit:
	$(POETRY) run pytest -q -m "not integration"

test-integration:
	$(POETRY) run pytest -q -m integration -o addopts=""

test-all:
	$(POETRY) run pytest -q -o addopts=""

test-cov:
	$(POETRY) run pytest tests -q -o addopts="" $(COV_FLAGS)

test-cov-unit:
	$(POETRY) run pytest tests/unit -q $(COV_FLAGS) --cov-fail-under=0

test-cov-html:
	$(POETRY) run pytest tests -q -o addopts="" $(COV_FLAGS) --cov-report=html
