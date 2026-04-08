.PHONY: install install-prod proto run docker-build docker-build-local test

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
