# test covers the module; test-unit covers the black-box tests/unit tree;
# test-integration drives the prod config plane against the seeded floci
# emulator (:4566) and the queue plane against a testcontainers ElasticMQ.

.PHONY: test test-unit test-integration help-tests

help-tests:
	@echo "  Tests (mk/tests.mk):"
	@echo "    test              full suite module-wide"
	@echo "    test-unit         the black-box unit tree (tests/unit)"
	@echo "    test-integration  the prod planes: floci config, testcontainers queue (skips when the emulator or Docker is down)"
	@echo ""

test:
	go test ./...

test-unit:
	go test ./tests/unit/...

test-integration:
	go test ./tests/integration/...
