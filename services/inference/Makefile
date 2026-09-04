.PHONY: build run test test-coverage test-integration lint deps \
	load-test load-down load-test-smoke load-test-detect load-test-analyze load-test-soak \
	inference-build inference-up inference-down inference-down-v inference-logs inference-ps \
	install install-prod proto docker-build docker-build-local integration

# Default inference service via infra compose files (CPU base, GPU via GPU=1)
# Usage:
#   make inference-up              # CPU (Dockerfile.local)
#   make inference-up GPU=1        # GPU (Dockerfile + nvidia)
#   make inference-up GPU=1 ENV=production

# Load test via infra/compose.load.yml (self-contained ai-service + k6)
# Usage:
#   make load-test SCENARIO=smoke GPU=0 VUS=1
#   make load-test SCENARIO=detect GPU=1 VUS=50 STAGES=30s:10,1m:20,30s:0 RPS=10 MAX_VUS=100
#   make load-test SCENARIO=analyze GPU=0 VUS=8 DURATION=10m
#   make load-test-smoke GPU=1 VUS=2
#   make load-test-detect GPU=0 VUS=20 STAGES=30s:5,1m:10,30s:0
# Mirrors document-parser (VUS/DURATION/RPS/STAGES) and gateway (SCENARIO) elegance

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

# Alias for parity with document-parser/gateway
build:
	docker build -t ai-service:latest .

test: proto
	poetry run python -m pytest tests/unit -v --cov=src --cov-report=term-missing

test-coverage: proto
	poetry run python -m pytest --cov=src --cov-report=term-missing --cov-report=html --cov-report=xml tests/unit

test-integration: proto
	poetry run python -m pytest tests/integration -v

integration: test-integration

lint:
	poetry run ruff check .

deps:
	poetry install --extras cpu

# Self-contained load test: compose brings up ai-service + k6 on dedicated network.
# No dependency on the main stack. Direct run mirrors gateway/document-parser.
# Usage:
#   make load-test SCENARIO=smoke GPU=0 VUS=1
#   make load-test SCENARIO=detect GPU=1 VUS=50 STAGES=30s:10,1m:20,30s:0 RPS=10 MAX_VUS=100
#   make load-test SCENARIO=analyze GPU=0 VUS=8 DURATION=10m
# Elegant vars: SCENARIO=smoke|detect|analyze|soak GPU=0|1 VUS= RPS= STAGES= DURATION= MAX_VUS=
# Specific overrides still work: INFERENCE_LOAD_DETECT_STAGES=, INFERENCE_LOAD_ANALYZE_VUS= etc
load-test:
	@GPU=$${GPU:-0}; SCENARIO=$${SCENARIO:-smoke}; \
	VUS_VAL="$(VUS)"; RPS_VAL="$(RPS)"; STAGES_VAL="$(STAGES)"; DURATION_VAL="$(DURATION)"; MAX_VUS_VAL="$(MAX_VUS)"; \
	echo "Load test SCENARIO=$$SCENARIO GPU=$$GPU VUS=$${VUS_VAL:-} RPS=$${RPS_VAL:-} DURATION=$${DURATION_VAL:-} STAGES=$${STAGES_VAL:-}"; \
	# Map elegant vars to underlying INFERENCE_LOAD_* envs \
	if [ -n "$$VUS_VAL" ]; then \
		export INFERENCE_LOAD_SMOKE_VUS=$$VUS_VAL; export INFERENCE_LOAD_DETECT_PREALLOCATED_VUS=$$VUS_VAL; \
		export INFERENCE_LOAD_ANALYZE_VUS=$$VUS_VAL; export INFERENCE_LOAD_SOAK_VUS=$$VUS_VAL; \
	fi; \
	if [ -n "$$RPS_VAL" ]; then export INFERENCE_LOAD_DETECT_START_RATE=$$RPS_VAL; fi; \
	if [ -n "$$STAGES_VAL" ]; then export INFERENCE_LOAD_DETECT_STAGES=$$STAGES_VAL; fi; \
	if [ -n "$$DURATION_VAL" ]; then export INFERENCE_LOAD_ANALYZE_DURATION=$$DURATION_VAL; export INFERENCE_LOAD_SOAK_DURATION=$$DURATION_VAL; fi; \
	if [ -n "$$MAX_VUS_VAL" ]; then export INFERENCE_LOAD_DETECT_MAX_VUS=$$MAX_VUS_VAL; fi; \
	# Generate Bearer token if not provided (uses AI_SERVICE_API_KEY or dev fallback) \
	SECRET=$${AI_SERVICE_API_KEY:-$${INFERENCE_LOAD_AUTH_TOKEN_SECRET:-dev-secret-key-16chars-at-least}}; \
	TOKEN=$${INFERENCE_LOAD_AUTH_TOKEN:-$$(python3 load/scripts/generate_token.py --secret "$$SECRET" 2>/dev/null || echo "")}; \
	if [ -z "$$TOKEN" ]; then TOKEN=$$(python3 load/scripts/generate_token.py --secret "dev-secret-key-16chars-at-least" 2>/dev/null || echo "test-token"); fi; \
	export INFERENCE_LOAD_AUTH_TOKEN=$$TOKEN; export SCENARIO=$$SCENARIO; \
	COMPOSE="docker compose -f infra/compose.load.yml"; \
	if [ "$$GPU" = "1" ]; then COMPOSE="$$COMPOSE -f infra/compose.gpu.yml"; echo "GPU mode enabled (Dockerfile + nvidia)"; else echo "CPU mode (Dockerfile.local)"; fi; \
	echo "Starting load test with SCENARIO=$$SCENARIO GPU=$$GPU"; \
	$$COMPOSE up --abort-on-container-exit --exit-code-from k6

load-down:
	docker compose -f infra/compose.load.yml -f infra/compose.gpu.yml down -v --remove-orphans

load-test-smoke:
	@$(MAKE) load-test SCENARIO=smoke GPU=$(GPU) VUS=$(VUS) DURATION=$(DURATION) RPS=$(RPS) STAGES=$(STAGES) MAX_VUS=$(MAX_VUS)

load-test-detect:
	@$(MAKE) load-test SCENARIO=detect GPU=$(GPU) VUS=$(VUS) DURATION=$(DURATION) RPS=$(RPS) STAGES=$(STAGES) MAX_VUS=$(MAX_VUS)

load-test-analyze:
	@$(MAKE) load-test SCENARIO=analyze GPU=$(GPU) VUS=$(VUS) DURATION=$(DURATION) RPS=$(RPS) STAGES=$(STAGES) MAX_VUS=$(MAX_VUS)

load-test-soak:
	@$(MAKE) load-test SCENARIO=soak GPU=$(GPU) VUS=$(VUS) DURATION=$(DURATION) RPS=$(RPS) STAGES=$(STAGES) MAX_VUS=$(MAX_VUS)

# Inference service via infra compose files
inference-build:
	docker build -t ai-service:latest .

inference-up:
	@GPU=$${GPU:-0}; COMPOSE="docker compose -f infra/compose.yml"; \
	if [ "$$GPU" = "1" ]; then COMPOSE="$$COMPOSE -f infra/compose.gpu.yml"; echo "Starting inference GPU=$$GPU (Dockerfile + nvidia)"; else echo "Starting inference GPU=$$GPU (Dockerfile.local CPU)"; fi; \
	$$COMPOSE up --build -d; \
	$$COMPOSE ps

inference-down:
	docker compose -f infra/compose.yml -f infra/compose.gpu.yml down --remove-orphans

inference-down-v:
	docker compose -f infra/compose.yml -f infra/compose.gpu.yml down -v --remove-orphans

inference-logs:
	docker compose -f infra/compose.yml -f infra/compose.gpu.yml logs -f ai-service

inference-ps:
	docker compose -f infra/compose.yml -f infra/compose.gpu.yml ps

# Prod variant with restart: always
inference-up-prod:
	@GPU=$${GPU:-1}; COMPOSE="docker compose -f infra/compose.yml -f infra/compose.prod.yml"; \
	if [ "$$GPU" = "1" ]; then COMPOSE="$$COMPOSE -f infra/compose.gpu.yml"; fi; \
	$$COMPOSE up --build -d; $$COMPOSE ps
