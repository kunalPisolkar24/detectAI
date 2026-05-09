FROM golang:1.21-alpine AS builder

WORKDIR /app

COPY . .

RUN go mod tidy
RUN go mod download

RUN go build -o gateway ./cmd/gateway/main.go

FROM alpine:latest

RUN adduser -D -u 10001 appuser

WORKDIR /app

COPY --from=builder /app/gateway .

USER appuser

EXPOSE 8080

CMD ["./gateway"]