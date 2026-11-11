# test-unit covers the black-box tests/unit tree; test-integration drives the
# prod config plane against floci.

.PHONY: test test-unit test-integration help-tests

help-tests:
	@echo "  Tests (mk/tests.mk):"
	@echo "    test              full suite module-wide"
	@echo "    test-unit         the black-box unit tree (tests/unit)"
	@echo "    test-integration  the prod config plane against floci (skips when the emulator is down)"
	@echo ""

test:
	go test ./...

test-unit:
	go test ./tests/unit/...

test-integration:
	go test ./tests/integration/...
