.PHONY: install lint format clean help-local

help-local:
	@echo "Local commands (mk/local.mk):"
	@echo "  install    install dependencies (poetry)"
	@echo "  lint       ruff check"
	@echo "  format     ruff format --check (use 'ruff format .' to fix)"
	@echo "  clean      remove caches and bytecode"
	@echo ""

install:
	$(POETRY) install --no-interaction

lint:
	$(POETRY) run ruff check .

format:
	$(POETRY) run ruff format --check .

clean:
	rm -rf .pytest_cache .ruff_cache .coverage htmlcov
	find . -type d -name __pycache__ -exec rm -rf {} + 2>/dev/null || true
