# Troubleshooting

This document covers common issues and their solutions when working with DetectAI infrastructure.

## Quick Diagnosis

### Check Stack Status

```bash
# Local stack
make local-ps

# Production stack
make prod-ps

# Direct Docker Compose
docker compose --env-file infra/docker/local/.env -f infra/docker/local/compose.yml ps
```

### Check Service Logs

```bash
# All services
make local-logs

# Specific service
make local-logs SERVICE=frontend
make local-logs SERVICE=chat-service
make local-logs SERVICE=worker-payments
```

### Check Health

```bash
# Web app
curl http://localhost:3000/api/healthz

# Payment gateway
curl http://localhost:8080/readyz

# Chat service (gRPC)
grpcurl -plaintext localhost:50052 grpc.health.v1.Health/Check

# Document parser
curl http://localhost:8000/api/v1/health
```

## Docker Issues

### "Port already in use"

Another process is using the port:

```bash
# Find what's using the port
lsof -i :3000
netstat -tlnp | grep 3000

# Kill the process
kill <PID>

# Or change the port in .env
PORT_FRONTEND=3001
```

### "Not enough memory"

Docker needs at least 8 GB RAM:

1. Open Docker Desktop
2. Go to Settings > Resources
3. Increase Memory to 8 GB+
4. Apply and restart

### Services keep restarting

Check the logs for the failing service:

```bash
make local-logs SERVICE=<service-name>
```

Common causes:
- Missing environment variables
- Dependency not healthy
- Port conflict

### "Connection refused"

Services may still be starting. Wait 30 seconds:

```bash
# Check health status
docker compose --env-file infra/docker/local/.env -f infra/docker/local/compose.yml ps

# Watch logs
docker compose --env-file infra/docker/local/.env -f infra/docker/local/compose.yml logs -f
```

### "Network already exists"

```bash
# Remove the network
docker network rm detectai-local

# Or use the full clean command
make local-clean
```

## Database Issues

### PostgreSQL won't start

```bash
# Check logs
docker compose --env-file infra/docker/local/.env -f infra/docker/local/compose.yml logs postgres-users

# Common fix: remove corrupted volume
docker compose --env-file infra/docker/local/.env -f infra/docker/local/compose.yml down -v
docker compose --env-file infra/docker/local/.env -f infra/docker/local/compose.yml up -d postgres-users
```

### MongoDB connection refused

```bash
# Check if MongoDB is healthy
docker compose --env-file infra/docker/local/.env -f infra/docker/local/compose.yml ps mongo-chat

# Check MongoDB logs
docker compose --env-file infra/docker/local/.env -f infra/docker/local/compose.yml logs mongo-chat
```

### Redis authentication failed

```bash
# Test Redis connection
redis-cli -h localhost -p 6381 -a test_redis_password ping

# Should return: PONG
```

## Terraform Issues

### "Error: Invalid value for variable"

Check the validation message and fix the value in your `.tfvars` file:

```bash
# See all variables and their constraints
cat infra/terraform/variables.tf
```

### "automatic_failover_enabled must be false when num_cache_clusters == 1"

This is a validation error. For single-node Redis:

```hcl
num_cache_clusters         = 1
automatic_failover_enabled = false
multi_az_enabled           = false
```

### "endpoint is empty"

Set the emulator endpoint:

```bash
# In your .tfvars file
emulator_endpoint = "http://localhost:4566"
```

### "State shows changes outside Terraform"

The emulator was reset. Apply again:

```bash
make tf-apply-local
```

### "plan keeps showing small diffs"

The emulator doesn't persist some fields (like `transit_encryption_enabled`). This is harmless.

### "NoSuchBucket" for S3 backend

Create the bucket in the emulator:

```bash
aws --endpoint-url http://localhost:4566 s3 mb s3://detectai-tfstate-local --region ap-south-1
```

## Secret Issues

### "Secret not found"

```bash
# For Terraform secrets
make tf-apply-local

# For app secrets
make seed-floci

# Verify all secrets exist
make floci-verify
```

### "Cannot overwrite Terraform secret"

This is by design. Terraform-managed secrets should only be updated by Terraform.

### "AUTH failed" from Redis

The emulator runs Valkey without passwords. For local testing, use passwordless endpoints or set the same password in both places.

## Service-Specific Issues

### Chat Service

**Symptom**: Messages not saving

```bash
# Check chat service logs
docker compose --env-file infra/docker/local/.env -f infra/docker/local/compose.yml logs chat-service

# Check MongoDB connection
docker exec -it <chat-service-container> mongosh --eval "db.adminCommand('ping')"
```

**Symptom**: High latency

- Check Redis cache hits: `curl http://localhost:9095/metrics`
- Check MongoDB query performance
- Increase `CACHE_TTL` if needed

### Workers

**Symptom**: Messages stuck in queue

```bash
# Check RabbitMQ management UI
open http://localhost:15672

# Check queue depth
rabbitmqctl list_queues
```

**Symptom**: Worker not processing

```bash
# Check worker logs
make local-logs SERVICE=worker-payments

# Check RabbitMQ connection
docker exec -it <rabbitmq-container> rabbitmqctl status
```

### Payment Gateway

**Symptom**: Webhooks not received

- Check Paddle webhook URL points to `http://localhost:8080`
- Check `PADDLE_WEBHOOK_SECRET` matches Paddle dashboard
- Check gateway logs for signature validation errors

### AI Inference

**Symptom**: Slow inference

- Check if GPU is enabled: `nvidia-smi`
- Check batch size configuration
- Monitor metrics at `http://localhost:8333/metrics`

**Symptom**: Model not loading

```bash
# Check Hugging Face token
docker exec -it <inference-container> printenv HF_TOKEN

# Check model cache
docker exec -it <inference-container> ls -la /cache
```

## Floci/LocalStack Issues

### Emulator not responding

```bash
# Check if Floci is running
curl http://localhost:4566/_localstack/health

# Check Docker containers
docker ps | grep floci
```

### Resources not created

```bash
# Apply Terraform
make tf-apply-local

# Verify resources
make floci-verify
```

### Network connectivity

Services need to be on the Floci network:

```bash
# Use Floci overlay
make prod-up-floci

# Or check network
docker network inspect documents_default
```

## Performance Issues

### High memory usage

1. Check Docker resource limits
2. Reduce batch sizes
3. Check for memory leaks in logs

### Slow database queries

1. Check database connections
2. Review query patterns
3. Add indexes if needed

### Redis memory full

```bash
# Check Redis memory
redis-cli -h localhost -p 6381 info memory

# Flush if needed (development only)
redis-cli -h localhost -p 6381 flushall
```

## Getting Help

### Check Logs First

```bash
# All logs
make local-logs

# Specific service
make local-logs SERVICE=<name>

# Docker events
docker events
```

### Common Commands

```bash
# Restart a service
docker compose --env-file infra/docker/local/.env -f infra/docker/local/compose.yml restart <service>

# Rebuild a service
docker compose --env-file infra/docker/local/.env -f infra/docker/local/compose.yml up -d --build <service>

# Full clean restart
make local-clean
make local-up
```

### Collect Debug Info

```bash
# Docker info
docker info

# Container stats
docker stats

# Disk usage
docker system df
```

## Next Steps

- [Architecture](../concepts/architecture.md) - Understand the system
- [Configuration](../getting-started/configuration.md) - All environment variables
- [Secrets](secrets.md) - How secrets work
