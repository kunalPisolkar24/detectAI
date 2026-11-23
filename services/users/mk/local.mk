.PHONY: tidy vet run help-local

help-local:
	@echo "Local commands (mk/local.mk):"
	@echo "  tidy      resolve and update go.mod/go.sum"
	@echo "  vet       go vet ./..."
	@echo "  run       run the API locally"
	@echo ""

tidy:
	go mod tidy

vet:
	go vet ./...

run:
	go run ./cmd/api
