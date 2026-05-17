.PHONY: all proto deps run build test docker-build
K6 ?= $(shell which k6 2>/dev/null || echo "/home/zeus/content/detectAI/services/workers/bin/k6")

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
	SMOKE_VUS=$(SMOKE_VUS) SMOKE_DURATION=$(SMOKE_DURATION) $(K6) run tests/load/scenarios/smoke.js

load-test:
	LOAD_VUS=$(LOAD_VUS) LOAD_DURATION=$(LOAD_DURATION) $(K6) run tests/load/scenarios/load.js

load-test-stress:
	STRESS_VUS=$(STRESS_VUS) STRESS_DURATION=$(STRESS_DURATION) $(K6) run tests/load/scenarios/stress.js

load-test-soak:
	SOAK_VUS=$(SOAK_VUS) SOAK_DURATION=$(SOAK_DURATION) $(K6) run tests/load/scenarios/soak.js