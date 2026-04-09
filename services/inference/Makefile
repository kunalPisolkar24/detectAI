.PHONY: install install-prod proto run docker-build docker-build-local test \
	load-smoke-local load-smoke-prod load-detect-local load-detect-prod

LOCAL_LOAD_ENV=../../infra/docker/local/.env
PROD_LOAD_ENV=../../infra/docker/prod/.env
LOAD_ARGS ?=

install:
	pip install -r requirements.local.txt

install-prod:
	pip install -r requirements.txt

proto:
	mkdir -p src/generated
	python -m grpc_tools.protoc -I./protos --python_out=./src/generated --grpc_python_out=./src/generated ./protos/ai_service.proto
	sed -i 's/import ai_service_pb2/from . import ai_service_pb2/' src/generated/ai_service_pb2_grpc.py
	touch src/generated/__init__.py

run:
	python -m src.main

docker-build:
	docker build -t ai-service:latest .

docker-build-local:
	docker build -f Dockerfile.local -t ai-service:local .

test:
	python -m pytest tests/ -v --cov=src --cov-report=term-missing

load-smoke-local:
	python3 load/scripts/run_k6.py --env-file $(LOCAL_LOAD_ENV) --script services/inference/load/scenarios/smoke.js -- $(LOAD_ARGS)

load-smoke-prod:
	python3 load/scripts/run_k6.py --env-file $(PROD_LOAD_ENV) --script services/inference/load/scenarios/smoke.js -- $(LOAD_ARGS)

load-detect-local:
	python3 load/scripts/run_k6.py --env-file $(LOCAL_LOAD_ENV) --script services/inference/load/scenarios/detect.js -- $(LOAD_ARGS)

load-detect-prod:
	python3 load/scripts/run_k6.py --env-file $(PROD_LOAD_ENV) --script services/inference/load/scenarios/detect.js -- $(LOAD_ARGS)
