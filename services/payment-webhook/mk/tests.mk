# Testing verbs. tests/unit holds the black-box suite (no boot); later trees
# join tests/ with their builds. test covers the module, test-unit the unit tree.

.PHONY: test test-unit help-tests

help-tests:
	@echo "  Tests (mk/tests.mk):"
	@echo "    test        full suite module-wide"
	@echo "    test-unit   the black-box unit tree (tests/unit)"
	@echo ""

test:
	go test ./...

test-unit:
	go test ./tests/unit/...
