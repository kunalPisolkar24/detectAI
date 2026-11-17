# Test suites. The two trees are a hard boundary: tests/unit holds pure logic
# with fakes and no boot, tests/integration drives the production boot — the
# dev plane, the gRPC server, and the prod plane through the floci emulator.
# The serving tests import the generated stubs, so the test targets stub first.

.PHONY: test test-unit test-integration test-cov test-cov-unit test-cov-html help-tests

COV_FLAGS := --cov=app --cov-report=term-missing

help-tests:
	@echo "  Tests (mk/tests.mk):"
	@echo "    test              full suite: unit + integration"
	@echo "    test-unit         pure logic only, no boot (tests/unit)"
	@echo "    test-integration  the production boot: dev plane, gRPC server, floci prod plane (skips when the emulator is down)"
	@echo "    test-cov          full suite with coverage, 95% gate (term-missing report)"
	@echo "    test-cov-unit     unit tests with coverage, no gate (tests/unit)"
	@echo "    test-cov-html     full suite with coverage + browsable HTML report (htmlcov/)"
	@echo ""

test: test-cov

test-unit: proto
	poetry run pytest tests/unit -q

test-integration: proto
	poetry run pytest tests/integration -q

test-cov: proto
	poetry run pytest tests -q $(COV_FLAGS)

test-cov-unit: proto
	poetry run pytest tests/unit -q $(COV_FLAGS) --cov-fail-under=0

test-cov-html: proto
	poetry run pytest tests -q $(COV_FLAGS) --cov-report=html
