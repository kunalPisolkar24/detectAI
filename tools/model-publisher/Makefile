DIR := $(dir $(abspath $(lastword $(MAKEFILE_LIST))))
POETRY := poetry -C $(DIR)
RUN := $(POETRY) run python main.py

.PHONY: help install lint format test test-cov test-all upload-spark upload-flare upload dry-run clean

help:
	@echo "Model Publisher — usage:"
	@echo "  make install               Install deps (poetry install)"
	@echo "  make lint                  Ruff check"
	@echo "  make format                Ruff format --check (use 'ruff format .' to fix)"
	@echo "  make test                  Unit tests (no integration)"
	@echo "  make test-all              All tests (unit + integration, mocked HF)"
	@echo "  make test-cov              Unit tests with coverage (fail-under 70)"
	@echo "  make dry-run model=x v=v1.0.0  Validate only (no upload)"
	@echo "  make upload-spark v=v1.0.0  Deploy Spark model"
	@echo "  make upload-flare v=v1.0.0  Deploy Flare model"
	@echo "  make upload model=my-model v=v1.0.0  Generic deploy"
	@echo "  make clean                 Remove caches"

install:
	$(POETRY) install --no-interaction

lint:
	$(POETRY) run ruff check .

format:
	$(POETRY) run ruff format --check .

test:
	$(POETRY) run pytest -q -m "not integration"

test-all:
	$(POETRY) run pytest -q -o addopts=""

test-cov:
	$(POETRY) run pytest -m "not integration" --cov=src --cov-report=term-missing --cov-fail-under=70

dry-run:
ifndef model
	$(error Usage: make dry-run model=detect-ai-spark v=v1.0.0)
endif
ifndef v
	$(error Usage: make dry-run model=detect-ai-spark v=v1.0.0)
endif
	$(RUN) --model $(model) --version $(v) --dry-run

upload-spark:
ifndef v
	$(error Usage: make upload-spark v=v1.0.0)
endif
	@echo "Deploying Spark Model Version $(v)..."
	$(RUN) --model detect-ai-spark --version $(v)

upload-flare:
ifndef v
	$(error Usage: make upload-flare v=v1.0.0)
endif
	@echo "Deploying Flare Model Version $(v)..."
	$(RUN) --model detect-ai-flare --version $(v)

upload:
ifneq ($(and $(model),$(v)),)
	@echo "Deploying $(model) Version $(v)..."
	$(RUN) --model $(model) --version $(v)
else
	$(error Usage: make upload model=folder_name v=version_tag)
endif

clean:
	rm -rf .pytest_cache .ruff_cache .coverage htmlcov
	find . -type d -name __pycache__ -exec rm -rf {} + 2>/dev/null || true
