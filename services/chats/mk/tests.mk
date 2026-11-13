# test-unit covers the black-box tests/unit tree; test-integration drives the
# container-backed tree against testcontainers and the prod config plane against
# floci. The integration run is serialised so one container set is alive at a time.

.PHONY: test test-unit test-integration help-tests

help-tests:
	@echo "  Tests (mk/tests.mk):"
	@echo "    test              full suite module-wide"
	@echo "    test-unit         the black-box unit tree (tests/unit)"
	@echo "    test-integration  the container-backed tree and the prod config plane (skips without Docker or floci)"
	@echo ""

test:
	go test ./...

test-unit:
	go test ./tests/unit/...

test-integration:
	go test -p 1 ./tests/integration/...
