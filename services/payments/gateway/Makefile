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
	go test -v -tags=integration ./test/integration/...

# Generic load test command: make load-test SCENARIO=spike ARGS="-e TARGET_VUS=100"
load-test:
	docker run --rm -i --network=detectai_prod_network \
		-v $(CURDIR)/test/load:/test \
		-e BASE_URL=http://payment-gateway:8080 \
		-e PADDLE_WEBHOOK_SECRET=$(PADDLE_WEBHOOK_SECRET) \
		-e INTERNAL_API_KEY=$(INTERNAL_API_KEY) \
		$(ARGS) \
		grafana/k6 run /test/scenarios/$(SCENARIO).js

load-test-spike:
	@$(MAKE) load-test SCENARIO=spike

load-test-stress:
	@$(MAKE) load-test SCENARIO=stress

load-test-soak:
	@$(MAKE) load-test SCENARIO=soak

deps:
	go mod tidy
	go get github.com/testcontainers/testcontainers-go
	go get github.com/testcontainers/testcontainers-go/modules/rabbitmq
