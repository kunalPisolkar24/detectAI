.PHONY: compile up down build restart network logs

# Run the local pnpm build script
compile:
	pnpm build-start

# Helper to ensure the external network exists before starting
network:
	@docker network inspect detect_ai_network >/dev/null 2>&1 || docker network create detect_ai_network

# Start the Web App + Redis Cluster (Create network if missing)
up: network
	docker compose up -d

# Stop and remove containers
down:
	docker compose down

# Rebuild images and start
build: network
	docker compose up --build -d

# Restart helper
restart: down up

# Tail logs
logs:
	docker compose logs -f