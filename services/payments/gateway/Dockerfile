FROM golang:1.25-alpine AS builder
WORKDIR /app
COPY go.mod go.sum ./
RUN go mod download
COPY . .
ARG VERSION=dev
ARG COMMIT=unknown
RUN go build -ldflags "-X main.buildVersion=${VERSION} -X main.buildCommit=${COMMIT}" -o gateway ./cmd/gateway/main.go

FROM alpine:latest
RUN apk add --no-cache wget && adduser -D -u 10001 appuser
WORKDIR /app
COPY --from=builder /app/gateway .
USER appuser
EXPOSE 8080
HEALTHCHECK --interval=10s --timeout=5s --retries=3 --start-period=15s CMD wget --no-verbose --tries=1 --spider http://localhost:8080/readyz || exit 1
CMD ["./gateway"]
