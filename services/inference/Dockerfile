FROM nvidia/cuda:12.1.1-cudnn8-runtime-ubuntu22.04

ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    PYTHONPATH=/app

WORKDIR /app

RUN apt-get update && apt-get install -y --no-install-recommends \
    python3 \
    python3-pip \
    wget \
    && rm -rf /var/lib/apt/lists/*

RUN pip3 install --no-cache-dir poetry

RUN wget -qO/bin/grpc_health_probe https://github.com/grpc-ecosystem/grpc-health-probe/releases/download/v0.4.19/grpc_health_probe-linux-amd64 && \
    chmod +x /bin/grpc_health_probe

COPY pyproject.toml poetry.lock ./
RUN poetry config virtualenvs.create false && \
    poetry install --only main --extras gpu --no-interaction --no-ansi

COPY . .

RUN mkdir -p src/generated && \
    python3 -m grpc_tools.protoc \
    -I./protos \
    --python_out=./src/generated \
    --grpc_python_out=./src/generated \
    ./protos/ai_service.proto && \
    sed -i 's/import ai_service_pb2/from . import ai_service_pb2/' src/generated/ai_service_pb2_grpc.py && \
    touch src/generated/__init__.py

RUN useradd -m -r appuser && chown -R appuser:appuser /app

EXPOSE 50051 8333

HEALTHCHECK --interval=30s --timeout=10s --retries=3 \
    CMD ["/bin/grpc_health_probe", "-addr=:50051"]

USER appuser

CMD ["python3", "-m", "src.main"]