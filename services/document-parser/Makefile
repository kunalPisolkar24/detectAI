VUS ?= 20
DURATION ?= 1m
RAMP_TIME ?= 30s
API_URL ?= http://localhost:8000

.PHONY: load-test build run stop

build:
	docker build -t detectai-document-parser .

run:
	PORT_DOC_PARSER=8000 detect_ai_network=detectai_net docker network create detectai_net || true
	PORT_DOC_PARSER=8000 detect_ai_network=detectai_net docker compose up -d

stop:
	PORT_DOC_PARSER=8000 detect_ai_network=detectai_net docker compose down

load-test:
	@echo "Running k6 load test with $(VUS) VUs for $(DURATION) (Ramp: $(RAMP_TIME)) against $(API_URL)..."
	docker run --rm -i \
		--network host \
		-v $(PWD)/load-tests:/load-tests \
		-e VUS=$(VUS) \
		-e DURATION=$(DURATION) \
		-e RAMP_TIME=$(RAMP_TIME) \
		-e API_URL=$(API_URL) \
		grafana/k6 run /load-tests/script.js
