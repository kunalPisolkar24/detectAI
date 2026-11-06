package factories

import (
	"context"
	"fmt"

	"github.com/aws/aws-sdk-go-v2/aws"
	awsconfig "github.com/aws/aws-sdk-go-v2/config"
	"github.com/aws/aws-sdk-go-v2/service/secretsmanager"
	"github.com/aws/aws-sdk-go-v2/service/ssm"

	"github.com/kunalPisolkar24/detectAI/services/payment-webhook/internal/config/adapters"
)

// AWSClientFactory resolves the region and optional endpoint override once
// through the SDK's default chain; credentials stay ambient and never enter
// the config planes.
type AWSClientFactory struct {
	base aws.Config
}

// NewAWSClientFactory loads the base AWS config for the prod plane; clients stay method-local.
func NewAWSClientFactory(ctx context.Context) (AWSClientFactory, error) {
	loaded, err := awsconfig.LoadDefaultConfig(ctx)
	if err != nil {
		return AWSClientFactory{}, fmt.Errorf("config: could not load the AWS base config: %w", err)
	}
	if loaded.Region == "" {
		return AWSClientFactory{}, fmt.Errorf(
			"config: the prod plane needs AWS_REGION in the environment; compose injects it from infra/.env")
	}
	return AWSClientFactory{base: loaded}, nil
}

// NewSecretsManagerAdapter builds the secrets blob reader on the resolved config.
func (f AWSClientFactory) NewSecretsManagerAdapter() *adapters.SecretsManagerAdapter {
	return adapters.NewSecretsManagerAdapter(secretsmanager.NewFromConfig(f.base))
}

// NewParameterStoreAdapter builds the SSM tree reader on the resolved config.
func (f AWSClientFactory) NewParameterStoreAdapter() *adapters.ParameterStoreAdapter {
	return adapters.NewParameterStoreAdapter(ssm.NewFromConfig(f.base))
}
