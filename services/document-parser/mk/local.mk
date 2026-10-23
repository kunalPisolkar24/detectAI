.PHONY: deps run

deps:
	poetry install

run:
	poetry run uvicorn app.main:app --reload --port 8000
