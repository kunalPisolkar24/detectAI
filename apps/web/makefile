.PHONY: compile redis-up redis-down redis-build

compile:
	pnpm build-start

# Start the Redis infrastructure in the background
redis-up:
	docker compose -f docker-compose.redis.yml up -d

# Stop and remove the Redis containers
redis-down:
	docker compose -f docker-compose.redis.yml down

# Build (or pull) the Redis images
redis-build:
	docker compose -f docker-compose.redis.yml up --build -d

# Optional: Restart helper
redis-restart: redis-down redis-up
