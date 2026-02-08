FROM nvidia/cuda:12.1.1-cudnn8-runtime-ubuntu22.04

ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    PYTHONPATH=/app

WORKDIR /app

RUN apt-get update && apt-get install -y --no-install-recommends \
    python3 \
    python3-pip \
    && rm -rf /var/lib/apt/lists/*

COPY requirements.txt .
RUN pip3 install --no-cache-dir -r requirements.txt

COPY . .

RUN mkdir -p src/generated && \
    python3 -m grpc_tools.protoc \
    -I./protos \
    --python_out=./src/generated \
    --grpc_python_out=./src/generated \
    ./protos/ai_service.proto && \
    sed -i 's/import ai_service_pb2/from . import ai_service_pb2/' src/generated/ai_service_pb2_grpc.py && \
    touch src/generated/__init__.py

EXPOSE 50051 8333

CMD ["python3", "-m", "src.main"]