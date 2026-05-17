FROM golang:1.25-alpine AS builder

WORKDIR /app

RUN apk add --no-cache git

COPY go.mod go.sum ./
RUN go mod download

COPY . .

RUN go build -o chat-service ./cmd/server/main.go

FROM alpine:3.19
WORKDIR /app
COPY --from=builder /app/chat-service .

EXPOSE 50051 9091

CMD ["./chat-service"]