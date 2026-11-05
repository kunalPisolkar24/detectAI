DIR := $(dir $(abspath $(lastword $(MAKEFILE_LIST))))
POETRY := poetry -C $(DIR)

.PHONY: help install lint format test test-unit test-integration test-all test-cov clean

help:
	@echo "SecretsCTL — usage:"
	@echo "  make install               Install deps (poetry install)"
	@echo "  make lint                  Ruff check"
	@echo "  make format                Ruff format --check (use 'ruff format .' to fix)"
	@echo "  make test                  Unit tests (no integration)"
	@echo "  make test-integration      Black-box tests against a live Floci"
	@echo "  make test-all              All tests (unit + integration)"
	@echo "  make test-cov              Unit tests with coverage (fail-under 65)"
	@echo "  make clean                 Remove caches"

install:
	$(POETRY) install --no-interaction

lint:
	$(POETRY) run ruff check .

format:
	$(POETRY) run ruff format --check .

test test-unit:
	$(POETRY) run pytest -q -m "not integration"

test-integration:
	$(POETRY) run pytest -q -m integration -o addopts=""

test-all:
	$(POETRY) run pytest -q -o addopts=""

test-cov:
	$(POETRY) run pytest -m "not integration" --cov=app --cov-report=term-missing --cov-fail-under=65

clean:
	rm -rf .pytest_cache .ruff_cache .coverage htmlcov
	find . -type d -name __pycache__ -exec rm -rf {} + 2>/dev/null || true
