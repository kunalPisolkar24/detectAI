# test-unit covers the black-box tests/unit tree; test-container drives the
# local compose mongo and redis; test-integration drives the prod config plane
# against floci.

.PHONY: test test-unit test-container test-integration help-tests

help-tests:
	@echo "  Tests (mk/tests.mk):"
	@echo "    test              full suite module-wide"
	@echo "    test-unit         the black-box unit tree (tests/unit)"
	@echo "    test-container    the container-backed tree (tests/container)"
	@echo "    test-integration  the prod config plane against floci (skips when the emulator is down)"
	@echo ""

test:
	go test ./...

test-unit:
	go test ./tests/unit/...

test-container:
	go test ./tests/container/...

test-integration:
	go test ./tests/integration/...
