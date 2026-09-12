package config

import (
	"context"
	"encoding/json"
	"fmt"
	"os"
	"strings"

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
		if isMissingSecret(err) {
			return nil
		}
		return err
	}

	if err := loadSSMParameters(ctx, awsCfg, cfg); err != nil {
		return err
	}
	return nil
}

func loadSecretsManager(ctx context.Context, awsCfg aws.Config, cfg *Config) error {
	sm := secretsmanager.NewFromConfig(awsCfg)

	mqSecret := envOr("MQ_SECRETS_NAME", envOr("MQ_URLS_SECRET_NAME", "detectai/mq/urls"))
	if mqSecret != "" {
		out, err := sm.GetSecretValue(ctx, &secretsmanager.GetSecretValueInput{
			SecretId: aws.String(mqSecret),
		})
		if err == nil && out.SecretString != nil {
			var data map[string]string
			if jsonErr := json.Unmarshal([]byte(*out.SecretString), &data); jsonErr == nil {
				if v, ok := data["RABBITMQ_URL"]; ok && v != "" && allowSecretFromEnv(cfg, "RABBITMQ_URL") {
					cfg.RabbitMQURL = v
				} else if v, ok := data["RABBITMQ_URL"]; ok && v != "" && cfg.IsProd() && cfg.RabbitMQURL == "" {
					cfg.RabbitMQURL = v
				}
				if v, ok := data["RABBITMQ_QUEUE_TYPE"]; ok && v != "" && allowSecretFromEnv(cfg, "RABBITMQ_QUEUE_TYPE") {
					cfg.RabbitMQQueueType = v
				} else if v, ok := data["RABBITMQ_QUEUE_TYPE"]; ok && v != "" && cfg.IsProd() && cfg.RabbitMQQueueType == "" {
					cfg.RabbitMQQueueType = v
				}
				if v, ok := data["RABBITMQ_ENDPOINT"]; ok && v != "" && cfg.RabbitMQURL == "" {
					cfg.RabbitMQURL = v
				}
			} else if strings.HasPrefix(strings.TrimSpace(*out.SecretString), "amqp") {
				if allowSecretFromEnv(cfg, "RABBITMQ_URL") {
					cfg.RabbitMQURL = strings.TrimSpace(*out.SecretString)
				} else if cfg.IsProd() && cfg.RabbitMQURL == "" {
					cfg.RabbitMQURL = strings.TrimSpace(*out.SecretString)
				}
			}
		} else if err != nil && !isMissingSecret(err) {
			return fmt.Errorf("get secret %s: %w", mqSecret, err)
		} else if err != nil && cfg.IsProd() {
			return fmt.Errorf("get secret %s: %w", mqSecret, err)
		}
	}

	gwSecret := envOr("GATEWAY_SECRETS_NAME", envOr("GATEWAY_SECRETS_ARN", "detectai/gateway/secrets"))
	if gwSecret != "" {
		out, err := sm.GetSecretValue(ctx, &secretsmanager.GetSecretValueInput{
			SecretId: aws.String(gwSecret),
		})
		if err == nil && out.SecretString != nil {
			var data map[string]string
			if jsonErr := json.Unmarshal([]byte(*out.SecretString), &data); jsonErr == nil {
				if v, ok := data["PADDLE_WEBHOOK_SECRET"]; ok && v != "" && allowSecretFromEnv(cfg, "PADDLE_WEBHOOK_SECRET") {
					cfg.WebhookSecret = v
				} else if v, ok := data["PADDLE_WEBHOOK_SECRET"]; ok && v != "" && cfg.IsProd() && cfg.WebhookSecret == "" {
					cfg.WebhookSecret = v
				}
				if v, ok := data["INTERNAL_API_KEY"]; ok && v != "" && allowSecretFromEnv(cfg, "INTERNAL_API_KEY") {
					cfg.InternalAPIKey = v
				} else if v, ok := data["INTERNAL_API_KEY"]; ok && v != "" && cfg.IsProd() && cfg.InternalAPIKey == "" {
					cfg.InternalAPIKey = v
				}
				if v, ok := data["RABBITMQ_URL"]; ok && v != "" && cfg.RabbitMQURL == "" && allowSecretFromEnv(cfg, "RABBITMQ_URL") {
					cfg.RabbitMQURL = v
				} else if v, ok := data["RABBITMQ_URL"]; ok && v != "" && cfg.IsProd() && cfg.RabbitMQURL == "" {
					cfg.RabbitMQURL = v
				}
			}
		} else if err != nil && !isMissingSecret(err) {
			return fmt.Errorf("get secret %s: %w", gwSecret, err)
		} else if err != nil && cfg.IsProd() {
			return fmt.Errorf("get secret %s: %w", gwSecret, err)
		}
	}
	return nil
}

func allowSecretFromEnv(cfg *Config, key string) bool {
	if cfg.IsProd() {
		return false
	}
	return os.Getenv(key) == ""
}

func isFlociEndpoint(ep string) bool {
	return strings.Contains(ep, "localhost:4566") || strings.Contains(ep, "127.0.0.1:4566") || strings.Contains(ep, "host.docker.internal:4566")
}

func loadSSMParameters(ctx context.Context, awsCfg aws.Config, cfg *Config) error {
	prefix := envOr("SSM_PREFIX", envOr("SSM_PARAM_PREFIX", ""))
	if prefix == "" {
		prefix = "/detectai/gateway/"
		if os.Getenv("SSM_ENABLED") == "0" || os.Getenv("SSM_ENABLED") == "false" {
			return nil
		}
	}
	if prefix != "" && !strings.HasSuffix(prefix, "/") {
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
			case "RABBITMQ_URL":
				if os.Getenv("RABBITMQ_URL") == "" && cfg.RabbitMQURL == "" {
					cfg.RabbitMQURL = val
				}
			case "RABBITMQ_QUEUE_TYPE", "QUEUE_TYPE":
				if os.Getenv("RABBITMQ_QUEUE_TYPE") == "" && cfg.RabbitMQQueueType == "" {
					cfg.RabbitMQQueueType = val
				}
			case "PADDLE_WEBHOOK_SECRET":
				if os.Getenv("PADDLE_WEBHOOK_SECRET") == "" && cfg.WebhookSecret == "" {
					cfg.WebhookSecret = val
				}
			case "INTERNAL_API_KEY":
				if os.Getenv("INTERNAL_API_KEY") == "" && cfg.InternalAPIKey == "" {
					cfg.InternalAPIKey = val
				}
			case "PORT":
				if os.Getenv("PORT") == "" && cfg.Port == "" {
					cfg.Port = val
				}
			case "GIN_MODE":
				if os.Getenv("GIN_MODE") == "" && cfg.GinMode == "" {
					cfg.GinMode = val
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
