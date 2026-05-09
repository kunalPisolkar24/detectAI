.PHONY: load-test build run stop

build:
	docker build -t detectai-document-parser .

run:
	docker compose up -d

stop:
	docker compose down

load-test:
	@echo "Running k6 load test..."
	docker run --rm -i \
		--network host \
		-v $(PWD)/load-tests:/load-tests \
		grafana/k6 run -e API_URL=http://localhost:8000 /load-tests/script.js
