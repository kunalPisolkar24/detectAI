package config_test

import (
	"context"

	"github.com/aws/aws-sdk-go-v2/aws"
	"github.com/aws/aws-sdk-go-v2/service/secretsmanager"
	"github.com/aws/aws-sdk-go-v2/service/ssm"

	"github.com/kunalPisolkar24/detectAI/services/payment-webhook/internal/config/adapters"
)

// fakeSecrets answers one recorded GetSecretValue call.
type fakeSecrets struct {
	output *secretsmanager.GetSecretValueOutput
	err    error

	secretID string
}

func (f *fakeSecrets) GetSecretValue(_ context.Context, input *secretsmanager.GetSecretValueInput, _ ...func(*secretsmanager.Options)) (*secretsmanager.GetSecretValueOutput, error) {
	f.secretID = aws.ToString(input.SecretId)
	return f.output, f.err
}

var _ adapters.SecretsClient = (*fakeSecrets)(nil)

// fakeParameters answers GetParametersByPath page by page and records every input.
type fakeParameters struct {
	pages []*ssm.GetParametersByPathOutput
	err   error

	inputs []*ssm.GetParametersByPathInput
}

func (f *fakeParameters) GetParametersByPath(_ context.Context, input *ssm.GetParametersByPathInput, _ ...func(*ssm.Options)) (*ssm.GetParametersByPathOutput, error) {
	f.inputs = append(f.inputs, input)
	if f.err != nil {
		return nil, f.err
	}
	if len(f.pages) == 0 {
		return &ssm.GetParametersByPathOutput{}, nil
	}
	page := f.pages[0]
	f.pages = f.pages[1:]
	return page, nil
}

var _ adapters.ParametersClient = (*fakeParameters)(nil)

// fakePlane is an in-memory Plane recording every Fetch into a shared order log.
type fakePlane struct {
	name   string
	log    *[]string
	values map[string]string
	err    error
}

func (f *fakePlane) Fetch() (map[string]string, error) {
	if f.log != nil {
		*f.log = append(*f.log, f.name)
	}
	return f.values, f.err
}
