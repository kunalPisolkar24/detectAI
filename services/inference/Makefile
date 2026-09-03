.PHONY: install install-prod proto run docker-build docker-build-local test test-integration integration \
	load-smoke-local load-smoke-prod load-detect-local load-detect-prod \
	load-analyze-local load-analyze-prod load-soak-local load-soak-prod

LOCAL_LOAD_ENV=infra/docker/local/.env
PROD_LOAD_ENV=infra/docker/prod/.env
LOAD_ARGS ?=

install:
	poetry install --extras cpu

install-prod:
	poetry install --only main --extras gpu

proto:
	mkdir -p src/generated
	poetry run python -m grpc_tools.protoc -I./protos --python_out=./src/generated --grpc_python_out=./src/generated ./protos/ai_service.proto
	sed -i 's/import ai_service_pb2/from . import ai_service_pb2/' src/generated/ai_service_pb2_grpc.py
	touch src/generated/__init__.py

run:
	poetry run python -m src.main

docker-build:
	docker build -t ai-service:latest .

docker-build-local:
	docker build -f Dockerfile.local -t ai-service:local .

test: proto
	poetry run python -m pytest tests/unit -v --cov=src --cov-report=term-missing

test-integration: proto
	poetry run python -m pytest tests/integration -v

integration: test-integration

load-smoke-local:
	python3 load/scripts/run_k6.py --env-file $(LOCAL_LOAD_ENV) --script services/inference/load/scenarios/smoke.js -- $(LOAD_ARGS)

load-smoke-prod:
	python3 load/scripts/run_k6.py --env-file $(PROD_LOAD_ENV) --script services/inference/load/scenarios/smoke.js -- $(LOAD_ARGS)

load-detect-local:
	python3 load/scripts/run_k6.py --env-file $(LOCAL_LOAD_ENV) --script services/inference/load/scenarios/detect.js -- $(LOAD_ARGS)

load-detect-prod:
	python3 load/scripts/run_k6.py --env-file $(PROD_LOAD_ENV) --script services/inference/load/scenarios/detect.js -- $(LOAD_ARGS)

load-analyze-local:
	python3 load/scripts/run_k6.py --env-file $(LOCAL_LOAD_ENV) --script services/inference/load/scenarios/analyze.js -- $(LOAD_ARGS)

load-analyze-prod:
	python3 load/scripts/run_k6.py --env-file $(PROD_LOAD_ENV) --script services/inference/load/scenarios/analyze.js -- $(LOAD_ARGS)

load-soak-local:
	python3 load/scripts/run_k6.py --env-file $(LOCAL_LOAD_ENV) --script services/inference/load/scenarios/soak.js -- $(LOAD_ARGS)

load-soak-prod:
	python3 load/scripts/run_k6.py --env-file $(PROD_LOAD_ENV) --script services/inference/load/scenarios/soak.js -- $(LOAD_ARGS)
