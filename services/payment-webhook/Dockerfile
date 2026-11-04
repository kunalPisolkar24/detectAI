FROM golang:1.27-bookworm AS builder

# A go.mod bump fails the build here instead of silently pulling a new toolchain.
ENV GOTOOLCHAIN=local \
    GOFLAGS=-mod=readonly

WORKDIR /app
COPY go.mod go.sum ./
RUN go mod download
COPY cmd cmd
COPY internal internal
RUN CGO_ENABLED=0 GOOS=linux GOARCH=amd64 \
    go build -trimpath -buildvcs=false -ldflags="-s -w" -o webhook ./cmd/api

# The adapter binary is inert outside Lambda, so this same image stays the compose image.
FROM debian:bookworm-slim

ENV AWS_LWA_PORT=8080 \
    AWS_LWA_READINESS_CHECK_PATH=/api/v1/ready

WORKDIR /app

# Slim ships no CA roots; the SQS client dials https in production.
RUN apt-get update && \
    apt-get install -y --no-install-recommends ca-certificates && \
    rm -rf /var/lib/apt/lists/*

RUN useradd -m -r appuser

COPY --from=public.ecr.aws/awsguru/aws-lambda-adapter:1.1.0 /lambda-adapter /opt/extensions/lambda-adapter
COPY --from=builder --chown=appuser:appuser /app/webhook webhook

USER appuser

EXPOSE 8080

CMD ["/app/webhook"]
