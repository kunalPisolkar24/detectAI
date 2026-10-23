.PHONY: install lock env clean run help-local

help-local:
	@echo "Local commands (mk/local.mk):"
	@echo "  install   install dependencies (poetry)"
	@echo "  lock      resolve and update poetry.lock"
	@echo "  env       create infra/.env from infra/.env.example if missing"
	@echo "  clean     remove caches and bytecode (app only, leaves slop/)"
	@echo "  run       run the API locally (uvicorn --reload)"
	@echo ""

install:
	poetry install

lock:
	poetry lock

env:
	@test -f infra/.env || cp infra/.env.example infra/.env
	@echo "infra/.env ready (edit infra/.env to override)"

clean:
	rm -rf .pytest_cache .ruff_cache
	find app -type d -name __pycache__ -prune -exec rm -rf {} +
	find app -name "*.py[cod]" -delete

run:
	poetry run uvicorn app.main:app --reload --port 8000 --timeout-graceful-shutdown 12
