# Builder resolves dependencies into an in-project venv; poetry never ships.
FROM python:3.14-slim AS builder

ENV PIP_NO_CACHE_DIR=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1

RUN pip install "poetry==2.5.1"

WORKDIR /app
COPY pyproject.toml poetry.lock ./
RUN poetry config virtualenvs.in-project true && \
    poetry install --only main --no-interaction --no-ansi --no-root
# The runtime serves files, not the installer tooling.
RUN /app/.venv/bin/python -m pip uninstall -y pip || true

# Runtime carries venv + app only. The adapter binary is inert outside Lambda,
# so this same image stays the compose image.
FROM python:3.14-slim

ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    PIP_NO_CACHE_DIR=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1 \
    PATH="/app/.venv/bin:$PATH" \
    AWS_LWA_PORT=8000 \
    AWS_LWA_READINESS_CHECK_PATH=/api/v1/health

WORKDIR /app

# The user exists before the copies so --chown lands ownership without
# a copy-up layer duplicating the venv.
RUN useradd -m -r appuser

COPY --from=public.ecr.aws/awsguru/aws-lambda-adapter:1.1.0 /lambda-adapter /opt/extensions/lambda-adapter
COPY --from=builder --chown=appuser:appuser /app/.venv .venv
COPY --chown=appuser:appuser app app

USER appuser

# Bytecode baked before the first cold start; runtime writing stays blocked.
RUN python -m compileall -q /app/app /app/.venv

EXPOSE 8000

HEALTHCHECK --interval=30s --timeout=10s --start-period=5s --retries=3 \
    CMD ["python", "-c", "import urllib.request; urllib.request.urlopen('http://127.0.0.1:8000/api/v1/health')"]

# 12 s grace = the 10 s budget plus slack; compose's stop_grace_period outlasts it.
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000", "--timeout-graceful-shutdown", "12"]
