# Generated stubs are gitignored, so codegen happens in the image. The result is
# pure Python and shared by both runtime targets.
FROM python:3.14-slim AS source

ENV PIP_NO_CACHE_DIR=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1

RUN pip install --no-cache-dir "grpcio-tools==1.80.0"

WORKDIR /src
COPY api/proto/ai_service.proto api/proto/ai_service.proto
COPY app app

RUN mkdir -p app/serving/generated && \
    touch app/serving/generated/__init__.py && \
    python -m grpc_tools.protoc \
        -Iapi/proto \
        --python_out=app/serving/generated \
        --grpc_python_out=app/serving/generated \
        api/proto/ai_service.proto && \
    sed -i 's/^import ai_service_pb2/from . import ai_service_pb2/' \
        app/serving/generated/ai_service_pb2_grpc.py

# CPU-only image: the lean build for dev and testing.
FROM python:3.14-slim AS cpu-builder

ENV PIP_NO_CACHE_DIR=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1

RUN pip install "poetry==2.5.1"

WORKDIR /app
COPY pyproject.toml poetry.lock ./
RUN poetry config virtualenvs.in-project true && \
    poetry install --only main --no-interaction --no-ansi --no-root
RUN /app/.venv/bin/python -m pip uninstall -y pip || true

COPY --from=source /src/app app

# GPU-capable image: onnxruntime-gpu is a superset and falls back to the CPU
# provider when no card is present. It ships its CUDA/cuDNN libraries, so no
# NVIDIA base image is needed (which would lack Python 3.14).
FROM python:3.14-slim AS gpu-builder

ENV PIP_NO_CACHE_DIR=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1

RUN pip install "poetry==2.5.1"

WORKDIR /app
COPY pyproject.toml poetry.lock ./
RUN poetry config virtualenvs.in-project true && \
    poetry install --only main --no-interaction --no-ansi --no-root && \
    /app/.venv/bin/python -m pip uninstall -y onnxruntime && \
    /app/.venv/bin/python -m pip install --no-cache-dir "onnxruntime-gpu==1.31.1" && \
    /app/.venv/bin/python -c "import onnxruntime; assert 'CUDAExecutionProvider' in onnxruntime.get_available_providers()"
RUN /app/.venv/bin/python -m pip uninstall -y pip || true

COPY --from=source /src/app app

FROM python:3.14-slim AS cpu

ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    PIP_NO_CACHE_DIR=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1 \
    PATH="/app/.venv/bin:$PATH" \
    MODEL_CACHE_DIR=/models

WORKDIR /app

# UID 1000 keeps a bind-mounted models/ writable from the host; EKS can align
# fsGroup to the same value.
RUN useradd -m -u 1000 appuser && mkdir -p /models && chown -R appuser:appuser /app /models

COPY --from=cpu-builder --chown=appuser:appuser /app/.venv .venv
COPY --from=source --chown=appuser:appuser /src/app app

USER appuser
RUN python -m compileall -q /app/app /app/.venv

EXPOSE 50051

HEALTHCHECK --interval=30s --timeout=10s --start-period=300s --retries=3 \
    CMD python -c "import grpc, os; from grpc_health.v1 import health_pb2, health_pb2_grpc as h; r = h.HealthStub(grpc.insecure_channel('127.0.0.1:' + os.getenv('GRPC_PORT', '50051'))).Check(health_pb2.HealthCheckRequest(), timeout=5); raise SystemExit(0 if r.status == health_pb2.HealthCheckResponse.SERVING else 1)"

CMD ["python", "-m", "app.main"]

FROM python:3.14-slim AS gpu

ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    PIP_NO_CACHE_DIR=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1 \
    PATH="/app/.venv/bin:$PATH" \
    MODEL_CACHE_DIR=/models

WORKDIR /app

RUN useradd -m -u 1000 appuser && mkdir -p /models && chown -R appuser:appuser /app /models

COPY --from=gpu-builder --chown=appuser:appuser /app/.venv .venv
COPY --from=source --chown=appuser:appuser /src/app app

USER appuser
RUN python -m compileall -q /app/app /app/.venv

EXPOSE 50051

HEALTHCHECK --interval=30s --timeout=10s --start-period=300s --retries=3 \
    CMD python -c "import grpc, os; from grpc_health.v1 import health_pb2, health_pb2_grpc as h; r = h.HealthStub(grpc.insecure_channel('127.0.0.1:' + os.getenv('GRPC_PORT', '50051'))).Check(health_pb2.HealthCheckRequest(), timeout=5); raise SystemExit(0 if r.status == health_pb2.HealthCheckResponse.SERVING else 1)"

CMD ["python", "-m", "app.main"]
