package config

import (
	"fmt"
	"net/url"
	"os"
	"strconv"
	"strings"
	"time"
)

// Config holds all runtime configuration for the chats service.
// It is the single source of truth — no other package should read env directly.
type Config struct {
	EnvType              string
	ServiceRole          string
	GRPCPort             string
	MetricsPort          string
	MongoURI             string
	MongoDatabase        string
	MongoMode            string
	MongoTLSEnabled      bool
	MongoTLSCAFile       string
	MongoMaxPoolSize     uint64
	MongoMinPoolSize     uint64
	MongoServerTimeout   time.Duration
	RedisAddr            string
	RedisPassword        string
	RedisTLSEnabled      bool
	RedisTLSCAFile       string
	RedisPoolSize        int
	BatchSize            int
	StreamPartitionCount int
	CacheTTL             time.Duration
	LogLevel             string
	OtelEndpoint         string
	OtelServiceName      string
	AWSRegion            string
}

// IsProd reports whether the service runs in production (AWS-backed) mode.
func (c *Config) IsProd() bool { return c.EnvType == "prod" }

// IsDev reports whether the service runs in development (local compose) mode.
func (c *Config) IsDev() bool { return c.EnvType == "dev" }

// Validate checks all invariants, normalizes defaults and derived fields.
// It mutates the receiver to fill mode-dependent defaults, mirroring the
// gateway/document-parser Validate pattern.
func (c *Config) Validate() error {
	if c.EnvType != "dev" && c.EnvType != "prod" {
		return fmt.Errorf("ENV_TYPE must be dev or prod, got %q", c.EnvType)
	}

	c.ServiceRole = strings.ToLower(strings.TrimSpace(c.ServiceRole))
	if c.ServiceRole != "api" && c.ServiceRole != "worker" {
		return fmt.Errorf("SERVICE_ROLE must be 'api' or 'worker', got %q", c.ServiceRole)
	}

	if strings.TrimSpace(c.MongoURI) == "" {
		return fmt.Errorf("MONGO_URI is required")
	}
	lowerURI := strings.ToLower(strings.TrimSpace(c.MongoURI))
	if !strings.HasPrefix(lowerURI, "mongodb://") && !strings.HasPrefix(lowerURI, "mongodb+srv://") {
		return fmt.Errorf("MONGO_URI must start with mongodb:// or mongodb+srv://, got %q", redactMongoURI(c.MongoURI))
	}

	if strings.TrimSpace(c.MongoDatabase) == "" {
		c.MongoDatabase = "chat_db"
	}

	c.MongoMode = strings.ToLower(strings.TrimSpace(c.MongoMode))
	if c.MongoMode == "" {
		c.MongoMode = "standalone"
	}
	if c.MongoMode != "standalone" && c.MongoMode != "sharded" {
		return fmt.Errorf("MONGO_MODE must be 'standalone' or 'sharded', got %q", c.MongoMode)
	}
	if c.MongoTLSEnabled && c.MongoTLSCAFile != "" {
		if _, err := os.Stat(c.MongoTLSCAFile); err != nil {
			return fmt.Errorf("MONGO_TLS_CA_FILE not readable %q: %w", c.MongoTLSCAFile, err)
		}
	}
	if c.RedisTLSEnabled && c.RedisTLSCAFile != "" {
		if _, err := os.Stat(c.RedisTLSCAFile); err != nil {
			return fmt.Errorf("REDIS_TLS_CA_FILE not readable %q: %w", c.RedisTLSCAFile, err)
		}
	}

	if err := c.normalizeRedis(); err != nil {
		return err
	}
	if strings.TrimSpace(c.RedisAddr) == "" {
		return fmt.Errorf("CHAT_REDIS_ADDR or REDIS_URL is required (host:port)")
	}
	if !strings.Contains(c.RedisAddr, ":") {
		return fmt.Errorf("CHAT_REDIS_ADDR must be host:port, got %q", c.RedisAddr)
	}

	if c.MongoMaxPoolSize == 0 {
		if c.MongoMode == "sharded" {
			c.MongoMaxPoolSize = 20
		} else {
			c.MongoMaxPoolSize = 100
		}
	}
	if c.MongoMaxPoolSize == 0 || c.MongoMaxPoolSize > 500 {
		return fmt.Errorf("MONGO_MAX_POOL_SIZE must be 1..500, got %d", c.MongoMaxPoolSize)
	}
	if c.MongoMinPoolSize == 0 {
		if c.MongoMode == "sharded" {
			c.MongoMinPoolSize = 5
		} else {
			c.MongoMinPoolSize = 10
		}
	}
	if c.MongoMinPoolSize > c.MongoMaxPoolSize {
		return fmt.Errorf("MONGO_MIN_POOL_SIZE (%d) must be <= MONGO_MAX_POOL_SIZE (%d)", c.MongoMinPoolSize, c.MongoMaxPoolSize)
	}
	if c.MongoServerTimeout == 0 {
		if c.MongoMode == "sharded" {
			c.MongoServerTimeout = 15 * time.Second
		} else {
			c.MongoServerTimeout = 5 * time.Second
		}
	}

	if c.RedisPoolSize <= 0 {
		c.RedisPoolSize = 100
	}
	if c.RedisPoolSize > 500 {
		return fmt.Errorf("REDIS_POOL_SIZE must be <= 500, got %d", c.RedisPoolSize)
	}

	if c.BatchSize <= 0 {
		c.BatchSize = 50
	}
	if c.BatchSize > 500 {
		return fmt.Errorf("BATCH_SIZE must be <= 500, got %d", c.BatchSize)
	}

	if c.StreamPartitionCount <= 0 {
		c.StreamPartitionCount = 16
	}
	if c.StreamPartitionCount > 128 {
		return fmt.Errorf("STREAM_PARTITION_COUNT must be <= 128, got %d", c.StreamPartitionCount)
	}

	if c.CacheTTL <= 0 {
		c.CacheTTL = 24 * time.Hour
	}

	if c.GRPCPort == "" {
		c.GRPCPort = ":50051"
	}
	if c.MetricsPort == "" {
		c.MetricsPort = ":9091"
	}
	if !isValidPort(c.GRPCPort) {
		return fmt.Errorf("GRPC_PORT has invalid format %q", c.GRPCPort)
	}
	if !isValidPort(c.MetricsPort) {
		return fmt.Errorf("METRICS_PORT has invalid format %q", c.MetricsPort)
	}

	if strings.TrimSpace(c.LogLevel) == "" {
		c.LogLevel = "info"
	}
	ll := strings.ToLower(strings.TrimSpace(c.LogLevel))
	allowed := map[string]bool{
		"debug": true, "info": true, "warn": true, "warning": true,
		"error": true, "dpanic": true, "panic": true, "fatal": true,
	}
	if !allowed[ll] {
		return fmt.Errorf("LOG_LEVEL must be one of debug,info,warn,warning,error, got %q", c.LogLevel)
	}
	if ll == "warning" {
		ll = "warn"
	}
	c.LogLevel = ll

	if c.OtelEndpoint != "" {
		if !strings.HasPrefix(c.OtelEndpoint, "http://") && !strings.HasPrefix(c.OtelEndpoint, "https://") {
			return fmt.Errorf("OTEL_EXPORTER_OTLP_ENDPOINT must be http(s) URL, got %q", c.OtelEndpoint)
		}
		if _, err := url.Parse(c.OtelEndpoint); err != nil {
			return fmt.Errorf("OTEL_EXPORTER_OTLP_ENDPOINT invalid URL %q: %w", c.OtelEndpoint, err)
		}
	}
	if strings.TrimSpace(c.OtelServiceName) == "" {
		c.OtelServiceName = "chat-service"
	} else {
		c.OtelServiceName = strings.TrimSpace(c.OtelServiceName)
	}

	if strings.TrimSpace(c.AWSRegion) == "" {
		c.AWSRegion = "ap-south-1"
	}

	return nil
}

func (c *Config) normalizeRedis() error {
	raw := strings.TrimSpace(c.RedisAddr)
	if raw == "" {
		return nil
	}
	lower := strings.ToLower(raw)
	tlsFromScheme := false
	if strings.HasPrefix(lower, "rediss://") {
		raw = raw[len("rediss://"):]
		tlsFromScheme = true
	} else if strings.HasPrefix(lower, "redis://") {
		raw = raw[len("redis://"):]
	}
	if at := strings.LastIndex(raw, "@"); at >= 0 {
		creds := raw[:at]
		raw = raw[at+1:]
		if c.RedisPassword == "" {
			if i := strings.LastIndex(creds, ":"); i >= 0 {
				c.RedisPassword = creds[i+1:]
			} else {
				c.RedisPassword = creds
			}
		}
	}
	c.RedisAddr = strings.TrimSpace(raw)
	if tlsFromScheme {
		c.RedisTLSEnabled = true
	}
	return nil
}

func isValidPort(p string) bool {
	p = strings.TrimSpace(p)
	if p == "" {
		return false
	}
	if strings.HasPrefix(p, ":") {
		portStr := strings.TrimPrefix(p, ":")
		if portStr == "" {
			return false
		}
		port, err := strconv.Atoi(portStr)
		return err == nil && port >= 1 && port <= 65535
	}
	if strings.Contains(p, ":") {
		parts := strings.Split(p, ":")
		portStr := parts[len(parts)-1]
		port, err := strconv.Atoi(portStr)
		return err == nil && port >= 1 && port <= 65535
	}
	port, err := strconv.Atoi(p)
	return err == nil && port >= 1 && port <= 65535
}

func redactMongoURI(raw string) string {
	if !strings.Contains(raw, "@") {
		return raw
	}
	if u, err := url.Parse(raw); err == nil && u.User != nil {
		u.User = url.UserPassword(u.User.Username(), "***")
		return u.String()
	}
	return raw
}
