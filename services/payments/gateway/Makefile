.PHONY: build run test test-coverage test-integration deps load-test load-down load-test-spike load-test-stress load-test-soak load-test-internal

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
	go test -v -tags=integration ./test/integration/...

# Self-contained load test: compose brings up rabbitmq + gateway + k6 on a
# dedicated network, no dependency on the main detect_ai stack.
# Usage: make load-test SCENARIO=spike TARGET_VUS=100 DURATION=60s
load-test:
	docker compose -f compose.load.yml up --abort-on-container-exit --exit-code-from k6

load-down:
	docker compose -f compose.load.yml down -v --remove-orphans

load-test-spike:
	@$(MAKE) load-test SCENARIO=spike

load-test-stress:
	@$(MAKE) load-test SCENARIO=stress

load-test-soak:
	@$(MAKE) load-test SCENARIO=soak

load-test-internal:
	@$(MAKE) load-test SCENARIO=internal

deps:
	go mod tidy
	go get github.com/testcontainers/testcontainers-go
	go get github.com/testcontainers/testcontainers-go/modules/rabbitmq
