# Test suites. The two trees are a hard boundary: tests/unit holds pure logic
# with fakes and no boot, tests/integration drives the production boot — the
# dev plane, the gRPC server, and the prod plane through the floci emulator.
# tests/unit/serving pins the generated contract, so the unit targets stub first.

.PHONY: test test-unit test-integration help-tests

help-tests:
	@echo "  Tests (mk/tests.mk):"
	@echo "    test              full suite: unit + integration"
	@echo "    test-unit         pure logic only, no boot (tests/unit)"
	@echo "    test-integration  the production boot: dev plane, gRPC server, floci prod plane (skips when the emulator is down)"
	@echo ""

test: proto
	poetry run pytest tests -q

test-unit: proto
	poetry run pytest tests/unit -q

test-integration:
	poetry run pytest tests/integration -q
