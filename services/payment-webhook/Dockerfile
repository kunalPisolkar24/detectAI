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

RUN CGO_ENABLED=0 GOOS=linux GOARCH=amd64 \
    go build -trimpath -buildvcs=false -ldflags="-s -w" -o healthcheck ./cmd/healthcheck

# The adapter binary is inert outside Lambda, so this same image stays the compose image.
# Distroless static ships the CA roots the SQS client needs.
FROM gcr.io/distroless/static-debian12:nonroot

ENV AWS_LWA_PORT=8080 \
    AWS_LWA_READINESS_CHECK_PATH=/api/v1/ready

WORKDIR /app

COPY --from=public.ecr.aws/awsguru/aws-lambda-adapter:1.1.0 /lambda-adapter /opt/extensions/lambda-adapter
COPY --from=builder --chown=65532:65532 /app/webhook webhook
COPY --from=builder --chown=65532:65532 /app/healthcheck healthcheck

USER 65532:65532

EXPOSE 8080

CMD ["/app/webhook"]
