.PHONY: all proto deps run build test docker-build

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

docker-build:
	docker compose up --build

load-test-smoke:
	k6 run tests/load/scenarios/smoke.js

load-test:
	k6 run tests/load/scenarios/load.js

load-test-stress:
	k6 run tests/load/scenarios/stress.js