package config

import (
	"context"
	"encoding/json"
	"fmt"
	"os"
	"strconv"
	"strings"
	"time"

	"github.com/aws/aws-sdk-go-v2/aws"
	awsconfig "github.com/aws/aws-sdk-go-v2/config"
	"github.com/aws/aws-sdk-go-v2/service/secretsmanager"
	"github.com/aws/aws-sdk-go-v2/service/ssm"
)

func loadFromAWS(ctx context.Context, cfg *Config) error {
	region := cfg.AWSRegion
	if region == "" {
		region = os.Getenv("AWS_REGION")
		if region == "" {
			region = "ap-south-1"
		}
	}
	opts := []func(*awsconfig.LoadOptions) error{awsconfig.WithRegion(region)}
	if ep := os.Getenv("AWS_ENDPOINT_URL"); ep != "" {
		opts = append(opts, awsconfig.WithBaseEndpoint(ep))
	}
	if _, ok := os.LookupEnv("AWS_ACCESS_KEY_ID"); !ok && isFlociEndpoint(os.Getenv("AWS_ENDPOINT_URL")) {
		opts = append(opts, awsconfig.WithCredentialsProvider(aws.CredentialsProviderFunc(func(ctx context.Context) (aws.Credentials, error) {
			return aws.Credentials{AccessKeyID: "test", SecretAccessKey: "test"}, nil
		})))
	}
	awsCfg, err := awsconfig.LoadDefaultConfig(ctx, opts...)
	if err != nil {
		return fmt.Errorf("load AWS config: %w", err)
	}
	if err := loadSecretsManager(ctx, awsCfg, cfg); err != nil {
		return err
	}
	if err := loadSSMParameters(ctx, awsCfg, cfg); err != nil {
		return err
	}
	return nil
}

func loadSecretsManager(ctx context.Context, awsCfg aws.Config, cfg *Config) error {
	sm := secretsmanager.NewFromConfig(awsCfg)

	// DocumentDB URLs (mongo) — Terraform: detectai/docdb/urls
	docdbSecret := envOr("DOCDB_URLS_SECRET_NAME", envOr("DOCDB_SECRETS_NAME", "detectai/docdb/urls"))
	// Allow legacy override via MONGO_URLS_SECRET_NAME
	if v := os.Getenv("MONGO_URLS_SECRET_NAME"); v != "" {
		docdbSecret = v
	}
	if docdbSecret != "" {
		out, err := sm.GetSecretValue(ctx, &secretsmanager.GetSecretValueInput{
			SecretId: aws.String(docdbSecret),
		})
		if err == nil && out.SecretString != nil {
			secretStr := strings.TrimSpace(*out.SecretString)
			if secretStr != "" {
				var data map[string]string
				if jsonErr := json.Unmarshal([]byte(secretStr), &data); jsonErr == nil {
					applySecretMap(data, cfg)
				} else if strings.HasPrefix(strings.ToLower(secretStr), "mongodb") {
					if cfg.MongoURI == "" {
						cfg.MongoURI = secretStr
					}
				}
			}
		} else if err != nil && !isMissingSecret(err) {
			return fmt.Errorf("get secret %s: %w", docdbSecret, err)
		} else if err != nil && cfg.IsProd() {
			return fmt.Errorf("get secret %s: %w", docdbSecret, err)
		}
	}

	// Redis chat URLs — Terraform: detectai/redis/chat/urls
	redisSecret := envOr("REDIS_URLS_SECRET_NAME", envOr("REDIS_CHAT_URLS_SECRET_NAME", envOr("CHAT_REDIS_URLS_SECRET_NAME", "detectai/redis/chat/urls")))
	if v := os.Getenv("REDIS_SECRETS_NAME"); v != "" {
		redisSecret = v
	}
	if redisSecret != "" && redisSecret != docdbSecret {
		out, err := sm.GetSecretValue(ctx, &secretsmanager.GetSecretValueInput{
			SecretId: aws.String(redisSecret),
		})
		if err == nil && out.SecretString != nil {
			secretStr := strings.TrimSpace(*out.SecretString)
			if secretStr != "" {
				var data map[string]string
				if jsonErr := json.Unmarshal([]byte(secretStr), &data); jsonErr == nil {
					applySecretMap(data, cfg)
				} else if strings.HasPrefix(strings.ToLower(secretStr), "redis") || strings.HasPrefix(strings.ToLower(secretStr), "rediss") {
					if cfg.RedisAddr == "" {
						cfg.RedisAddr = secretStr
					}
				}
			}
		} else if err != nil && !isMissingSecret(err) {
			return fmt.Errorf("get secret %s: %w", redisSecret, err)
		} else if err != nil && cfg.IsProd() {
			return fmt.Errorf("get secret %s: %w", redisSecret, err)
		}
	}

	return nil
}

func applySecretMap(data map[string]string, cfg *Config) {
	for k, v := range data {
		if v == "" {
			continue
		}
		upper := strings.ToUpper(strings.TrimSpace(k))
		switch upper {
		case "MONGO_URI":
			if cfg.MongoURI == "" {
				cfg.MongoURI = v
			}
		case "MONGO_DATABASE":
			if cfg.MongoDatabase == "" {
				cfg.MongoDatabase = v
			}
		case "MONGO_MODE":
			if cfg.MongoMode == "" {
				cfg.MongoMode = v
			}
		case "CHAT_REDIS_ADDR":
			if cfg.RedisAddr == "" {
				cfg.RedisAddr = v
			}
		case "REDIS_URL":
			if cfg.RedisAddr == "" {
				cfg.RedisAddr = v
			}
		case "REDIS_URL_READER":
			// Ignore reader — chats always uses primary
		case "REDIS_PASSWORD":
			if cfg.RedisPassword == "" {
				cfg.RedisPassword = v
			}
		case "REDIS_TLS_ENABLED":
			if cfg.RedisTLSEnabled == false {
				if b, err := strconv.ParseBool(v); err == nil {
					cfg.RedisTLSEnabled = b
				} else if strings.EqualFold(v, "true") || v == "1" {
					cfg.RedisTLSEnabled = true
				}
			}
		case "MONGO_TLS_ENABLED":
			if !cfg.MongoTLSEnabled {
				if b, err := strconv.ParseBool(v); err == nil {
					cfg.MongoTLSEnabled = b
				}
			}
		case "REDIS_ADDR":
			if cfg.RedisAddr == "" {
				cfg.RedisAddr = v
			}
		default:
			// Generic: allow SSM-like keys to populate if they match known fields and are not already set.
			// This keeps forward-compat for Terraform adding new keys.
			switch upper {
			case "REDIS_ADDR":
				if cfg.RedisAddr == "" {
					cfg.RedisAddr = v
				}
			}
		}
	}
}

func isFlociEndpoint(ep string) bool {
	return strings.Contains(ep, "localhost:4566") || strings.Contains(ep, "127.0.0.1:4566") || strings.Contains(ep, "host.docker.internal:4566")
}

func loadSSMParameters(ctx context.Context, awsCfg aws.Config, cfg *Config) error {
	prefix := envOr("SSM_PREFIX", envOr("SSM_PARAM_PREFIX", ""))
	if prefix == "" {
		prefix = "/detectai/chat/"
		if os.Getenv("SSM_ENABLED") == "0" || strings.EqualFold(os.Getenv("SSM_ENABLED"), "false") {
			return nil
		}
	}
	if !strings.HasSuffix(prefix, "/") {
		prefix += "/"
	}
	client := ssm.NewFromConfig(awsCfg)
	paginator := ssm.NewGetParametersByPathPaginator(client, &ssm.GetParametersByPathInput{
		Path:           aws.String(prefix),
		Recursive:      aws.Bool(true),
		WithDecryption: aws.Bool(true),
	})
	found := false
	for paginator.HasMorePages() {
		out, err := paginator.NextPage(ctx)
		if err != nil {
			if isMissingParam(err) {
				return nil
			}
			return fmt.Errorf("ssm get parameters by path %s: %w", prefix, err)
		}
		for _, p := range out.Parameters {
			if p.Name == nil || p.Value == nil {
				continue
			}
			found = true
			key := strings.TrimPrefix(*p.Name, prefix)
			key = strings.ToUpper(strings.ReplaceAll(key, "-", "_"))
			val := *p.Value
			switch key {
			case "MONGO_URI":
				if os.Getenv("MONGO_URI") == "" && cfg.MongoURI == "" {
					cfg.MongoURI = val
				}
			case "MONGO_DATABASE":
				if os.Getenv("MONGO_DATABASE") == "" && cfg.MongoDatabase == "" {
					cfg.MongoDatabase = val
				}
			case "MONGO_MODE":
				if os.Getenv("MONGO_MODE") == "" && cfg.MongoMode == "" {
					cfg.MongoMode = val
				}
			case "MONGO_TLS_ENABLED":
				if os.Getenv("MONGO_TLS_ENABLED") == "" {
					if b, err := strconv.ParseBool(val); err == nil {
						cfg.MongoTLSEnabled = b
					}
				}
			case "MONGO_TLS_CA_FILE":
				if os.Getenv("MONGO_TLS_CA_FILE") == "" && cfg.MongoTLSCAFile == "" {
					cfg.MongoTLSCAFile = val
				}
			case "MONGO_MAX_POOL_SIZE":
				if os.Getenv("MONGO_MAX_POOL_SIZE") == "" && cfg.MongoMaxPoolSize == 0 {
					if u, err := strconv.ParseUint(val, 10, 64); err == nil {
						cfg.MongoMaxPoolSize = u
					}
				}
			case "MONGO_MIN_POOL_SIZE":
				if os.Getenv("MONGO_MIN_POOL_SIZE") == "" && cfg.MongoMinPoolSize == 0 {
					if u, err := strconv.ParseUint(val, 10, 64); err == nil {
						cfg.MongoMinPoolSize = u
					}
				}
			case "MONGO_SERVER_SELECTION_TIMEOUT":
				if os.Getenv("MONGO_SERVER_SELECTION_TIMEOUT") == "" && cfg.MongoServerTimeout == 0 {
					if d, err := time.ParseDuration(val); err == nil {
						cfg.MongoServerTimeout = d
					}
				}
			case "CHAT_REDIS_ADDR":
				if os.Getenv("CHAT_REDIS_ADDR") == "" && os.Getenv("REDIS_URL") == "" && cfg.RedisAddr == "" {
					cfg.RedisAddr = val
				}
			case "REDIS_URL":
				if os.Getenv("REDIS_URL") == "" && os.Getenv("CHAT_REDIS_ADDR") == "" && cfg.RedisAddr == "" {
					cfg.RedisAddr = val
				}
			case "REDIS_PASSWORD":
				if os.Getenv("REDIS_PASSWORD") == "" && cfg.RedisPassword == "" {
					cfg.RedisPassword = val
				}
			case "REDIS_TLS_ENABLED":
				if os.Getenv("REDIS_TLS_ENABLED") == "" {
					if b, err := strconv.ParseBool(val); err == nil {
						cfg.RedisTLSEnabled = b
					}
				}
			case "REDIS_TLS_CA_FILE":
				if os.Getenv("REDIS_TLS_CA_FILE") == "" && cfg.RedisTLSCAFile == "" {
					cfg.RedisTLSCAFile = val
				}
			case "REDIS_POOL_SIZE":
				if os.Getenv("REDIS_POOL_SIZE") == "" && cfg.RedisPoolSize == 0 {
					if i, err := strconv.Atoi(val); err == nil {
						cfg.RedisPoolSize = i
					}
				}
			case "BATCH_SIZE":
				if os.Getenv("BATCH_SIZE") == "" && cfg.BatchSize == 0 {
					if i, err := strconv.Atoi(val); err == nil {
						cfg.BatchSize = i
					}
				}
			case "STREAM_PARTITION_COUNT":
				if os.Getenv("STREAM_PARTITION_COUNT") == "" && cfg.StreamPartitionCount == 0 {
					if i, err := strconv.Atoi(val); err == nil {
						cfg.StreamPartitionCount = i
					}
				}
			case "CACHE_TTL":
				if os.Getenv("CACHE_TTL") == "" && cfg.CacheTTL == 0 {
					if d, err := time.ParseDuration(val); err == nil {
						cfg.CacheTTL = d
					}
				}
			case "GRPC_PORT":
				if os.Getenv("GRPC_PORT") == "" && cfg.GRPCPort == "" {
					cfg.GRPCPort = val
				}
			case "METRICS_PORT":
				if os.Getenv("METRICS_PORT") == "" && cfg.MetricsPort == "" {
					cfg.MetricsPort = val
				}
			case "LOG_LEVEL":
				if os.Getenv("LOG_LEVEL") == "" && cfg.LogLevel == "" {
					cfg.LogLevel = val
				}
			case "OTEL_EXPORTER_OTLP_ENDPOINT":
				if os.Getenv("OTEL_EXPORTER_OTLP_ENDPOINT") == "" && cfg.OtelEndpoint == "" {
					cfg.OtelEndpoint = val
				}
			case "OTEL_SERVICE_NAME":
				if os.Getenv("OTEL_SERVICE_NAME") == "" && cfg.OtelServiceName == "" {
					cfg.OtelServiceName = val
				}
			case "AWS_REGION":
				if os.Getenv("AWS_REGION") == "" && cfg.AWSRegion == "" {
					cfg.AWSRegion = val
				}
			default:
				// Allow any additional SSM key to populate if env not set and cfg empty —
				// keeps parity with workers/document-parser extra=ignore behaviour.
				// No-op for unknown keys.
			}
		}
	}
	if !found {
		return nil
	}
	return nil
}

func isMissingSecret(err error) bool {
	if err == nil {
		return false
	}
	msg := err.Error()
	return strings.Contains(msg, "ResourceNotFoundException") || strings.Contains(msg, "not found")
}

func isMissingParam(err error) bool {
	if err == nil {
		return false
	}
	msg := err.Error()
	return strings.Contains(msg, "ParameterNotFound") || strings.Contains(msg, "not found")
}
