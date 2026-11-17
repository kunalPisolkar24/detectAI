# test-unit covers the black-box tests/unit tree; test-integration drives the
# container-backed tree against testcontainers and the prod config plane against
# floci. The integration run is serialised so one container set is alive at a time.
# Coverage targets instrument ./internal/... because the black-box trees import
# it; without -coverpkg those packages report no statements. Full coverage needs
# Docker for the container-backed tree; the floci-only probe skips without it.

COVERAGE_PKG := ./internal/...
COVERAGE_PROFILE := coverage.out

.PHONY: test test-unit test-integration coverage coverage-unit coverage-html coverage-check help-tests

help-tests:
	@echo "  Tests (mk/tests.mk):"
	@echo "    test              full suite module-wide"
	@echo "    test-unit         the black-box unit tree (tests/unit)"
	@echo "    test-integration  the container-backed tree and the prod config plane (skips without Docker or floci)"
	@echo "    coverage          unit + integration coverage of ./internal/... (needs Docker)"
	@echo "    coverage-unit     unit-only coverage, no Docker required"
	@echo "    coverage-html     write coverage.html from the combined run"
	@echo "    coverage-check    fail when combined coverage is below 95%"
	@echo ""

test:
	go test ./...

test-unit:
	go test ./tests/unit/...

test-integration:
	go test -p 1 ./tests/integration/...

coverage:
	go test -p 1 -timeout=900s -coverpkg=$(COVERAGE_PKG) -coverprofile=$(COVERAGE_PROFILE) ./tests/unit/... ./tests/integration/...
	go tool cover -func=$(COVERAGE_PROFILE) | tail -1

coverage-unit:
	go test -coverpkg=$(COVERAGE_PKG) -coverprofile=coverage-unit.out ./tests/unit/...
	go tool cover -func=coverage-unit.out | tail -1

coverage-html: coverage
	go tool cover -html=$(COVERAGE_PROFILE) -o coverage.html

coverage-check: coverage
	@total=$$(go tool cover -func=$(COVERAGE_PROFILE) | awk '/^total:/ {gsub("%", "", $$3); print $$3}'); \
	if awk -v t="$$total" 'BEGIN {exit !(t+0 < 95)}'; then \
		echo "coverage $$total% is below 95%"; exit 1; \
	fi; \
	echo "coverage $$total% meets 95%"
