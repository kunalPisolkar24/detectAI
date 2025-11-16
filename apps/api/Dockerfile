FROM python:3.11-slim AS builder

RUN apt-get update && apt-get install -y \
    build-essential \
 && rm -rf /var/lib/apt/lists/*

WORKDIR /app

RUN python -m venv /venv
ENV PATH="/venv/bin:$PATH"

COPY requirements.in .
RUN pip install --upgrade pip && \
    pip install --no-cache-dir -r requirements.in

FROM python:3.11-slim

WORKDIR /app

COPY --from=builder /venv /venv

COPY . .

ENV PATH="/venv/bin:$PATH"

ENV TF_USE_LEGACY_KERAS=0

RUN useradd --create-home appuser
USER appuser

EXPOSE 5000

CMD ["python", "app.py"]