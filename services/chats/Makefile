.PHONY: all proto deps run build test test-integration test-ha test-all docker-build load-test load-down

all: deps proto build

deps:
	go install google.golang.org/protobuf/cmd/protoc-gen-go@latest
	go install google.golang.org/grpc/cmd/protoc-gen-go-grpc@latest
	go mod tidy

proto:
	protoc --go_out=. --go_opt=paths=source_relative \
    --go-grpc_out=. --go-grpc_opt=paths=source_relative \
    api/proto/chat_service.proto

run:
	go run cmd/server/main.go

build:
	go build -o bin/chat-service cmd/server/main.go

test:
	go test -v ./... 

test-coverage:
	go test -v ./... -cover 

test-integration:
	go test -v -tags integration -run Test -count=1 ./...

test-ha:
	go test -v -tags ha -run TestHA -count=1 ./...

test-all:
	go test -v -tags integration,ha -count=1 ./...

docker-build:
	docker compose up --build

# Self-contained load test: compose brings up chat-mongo + chat-redis + service + worker + k6
# on isolated chat_loadnet, no dependency on main stack or local k6 binary.
# Usage: make load-test [SCENARIO=smoke|load|stress|soak] [VUS=2] [DURATION=30s] [RPS=10]
#   tiny smoke: make load-test SCENARIO=smoke VUS=1 DURATION=10s
#   with RPS cap: make load-test SCENARIO=load VUS=10 DURATION=2m RPS=50
load-test:
	docker compose -f infra/compose.load.yml up --build --abort-on-container-exit --exit-code-from k6

load-down:
	docker compose -f infra/compose.load.yml down -v --remove-orphans