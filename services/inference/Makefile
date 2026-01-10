.PHONY: install proto run docker-build

install:
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