.PHONY: build run test test-coverage test-integration deps

build:
	go build -o gateway ./cmd/gateway/main.go

run:
	go run cmd/gateway/main.go

test:
	go test -v ./...

test-coverage:
	go test -v -coverprofile=coverage.out ./...
	go tool cover -func=coverage.out

test-integration:
	go test -v -tags=integration ./internal/integration/...

deps:
	go mod tidy
	go get github.com/testcontainers/testcontainers-go
	go get github.com/testcontainers/testcontainers-go/modules/rabbitmq
