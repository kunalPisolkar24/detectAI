FROM golang:1.25-alpine AS builder

WORKDIR /app

COPY . .

RUN go mod tidy
RUN go mod download

ARG VERSION=dev
ARG COMMIT=unknown

RUN go build -ldflags "-X main.buildVersion=${VERSION} -X main.buildCommit=${COMMIT}" -o gateway ./cmd/gateway/main.go

FROM alpine:latest

RUN adduser -D -u 10001 appuser

WORKDIR /app

COPY --from=builder /app/gateway .

USER appuser

EXPOSE 8080

CMD ["./gateway"]
