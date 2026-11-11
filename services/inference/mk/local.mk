.PHONY: install lock clean run help-local

help-local:
	@echo "Local commands (mk/local.mk):"
	@echo "  install   install dependencies (poetry)"
	@echo "  lock      resolve and update poetry.lock"
	@echo "  clean     remove caches and bytecode (app only)"
	@echo "  run       run the gRPC health server locally"
	@echo ""

install:
	poetry install

lock:
	poetry lock

clean:
	rm -rf .pytest_cache .ruff_cache
	find app -type d -name __pycache__ -prune -exec rm -rf {} +
	find app -name "*.py[cod]" -delete

run:
	poetry run python -m app.main
