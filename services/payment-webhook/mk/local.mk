.PHONY: tidy test vet run help-local

help-local:
	@echo "Local commands (mk/local.mk):"
	@echo "  tidy      resolve and update go.mod/go.sum"
	@echo "  test      go test ./..."
	@echo "  vet       go vet ./..."
	@echo "  run       run the API locally (go run ./cmd/api, PORT default 8080)"
	@echo ""

tidy:
	go mod tidy

test:
	go test ./...

vet:
	go vet ./...

run:
	go run ./cmd/api
