FROM golang:1.27-bookworm AS builder

# A go.mod bump fails the build here instead of silently pulling a new toolchain.
ENV GOTOOLCHAIN=local \
    GOFLAGS=-mod=readonly

WORKDIR /app
COPY go.mod go.sum ./
RUN go mod download
COPY cmd cmd
COPY internal internal
COPY proto proto
RUN CGO_ENABLED=0 GOOS=linux GOARCH=amd64 \
    go build -trimpath -buildvcs=false -ldflags="-s -w" -o chats ./cmd/api

RUN CGO_ENABLED=0 GOOS=linux GOARCH=amd64 \
    go build -trimpath -buildvcs=false -ldflags="-s -w" -o healthcheck ./cmd/healthcheck

# Distroless static ships the CA roots the mongo, redis and AWS clients need.
FROM gcr.io/distroless/static-debian12:nonroot

ENV PORT=8090

WORKDIR /app

COPY --from=builder --chown=65532:65532 /app/chats chats
COPY --from=builder --chown=65532:65532 /app/healthcheck healthcheck

USER 65532:65532

EXPOSE 8090

CMD ["/app/chats"]
