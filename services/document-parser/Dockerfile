# Stage 1: Builder
FROM python:3.11-slim AS builder

ENV PIP_NO_CACHE_DIR=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1

WORKDIR /app

RUN apt-get update && apt-get install -y --no-install-recommends curl \
    && rm -rf /var/lib/apt/lists/*

RUN curl -sSL https://install.python-poetry.org | python3 -
ENV PATH="/root/.local/bin:$PATH"

RUN poetry self add poetry-plugin-export

COPY pyproject.toml poetry.lock ./

RUN poetry export -f requirements.txt --output requirements.txt --without-hashes

# Stage 2: Production
FROM python:3.11-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1 \
    PROMETHEUS_MULTIPROC_DIR=/tmp/prometheus-multiproc

WORKDIR /app

RUN apt-get update \
    && apt-get install -y --no-install-recommends gcc libpq-dev curl libmagic1 \
    && rm -rf /var/lib/apt/lists/*

COPY --from=builder /app/requirements.txt .

RUN pip install -r requirements.txt

COPY . .

RUN mkdir -p /tmp/prometheus-multiproc \
    && groupadd -r appgroup && useradd -r -g appgroup appuser \
    && chown -R appuser:appgroup /tmp/prometheus-multiproc \
    && chown -R appuser:appgroup /app

USER appuser

EXPOSE 8000

HEALTHCHECK --interval=30s --timeout=30s --start-period=5s --retries=3 \
    CMD curl -f http://localhost:8000/health || exit 1

CMD ["sh", "-ec", "rm -rf \"$PROMETHEUS_MULTIPROC_DIR\"/* && exec gunicorn -c gunicorn.conf.py app.main:app --workers \"${WORKERS:-4}\" --worker-class uvicorn.workers.UvicornWorker --bind \"0.0.0.0:${PORT:-8000}\" --access-logfile - --error-logfile -"]
