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

load-test-spike:
	docker run --rm -i --network=detectai_prod_network -v $(CURDIR)/test/load:/test -e BASE_URL=http://payment-gateway:8080 grafana/k6 run /test/scenarios/spike.js

load-test-stress:
	docker run --rm -i --network=detectai_prod_network -v $(CURDIR)/test/load:/test -e BASE_URL=http://payment-gateway:8080 grafana/k6 run /test/scenarios/stress.js

load-test-soak:
	docker run --rm -i --network=detectai_prod_network -v $(CURDIR)/test/load:/test -e BASE_URL=http://payment-gateway:8080 grafana/k6 run /test/scenarios/soak.js

deps:
	go mod tidy
	go get github.com/testcontainers/testcontainers-go
	go get github.com/testcontainers/testcontainers-go/modules/rabbitmq
