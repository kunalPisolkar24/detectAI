package config_test

import (
	"strings"
	"testing"

	"github.com/aws/aws-sdk-go-v2/aws"
	"github.com/aws/aws-sdk-go-v2/service/secretsmanager"
	"github.com/aws/smithy-go"

	"github.com/kunalPisolkar24/detectAI/services/payment-webhook/internal/config/adapters"
)

func TestSecretsAdapterFetchesTheBlob(t *testing.T) {
	fake := &fakeSecrets{output: &secretsmanager.GetSecretValueOutput{
		SecretString: aws.String(`{"ANIMAL":"zebra","RIVER":"okavango"}`),
	}}
	values, err := adapters.NewSecretsManagerAdapter(fake).Fetch()
	if err != nil {
		t.Fatal(err)
	}
	if fake.secretID != adapters.SecretsName {
		t.Errorf("SecretId = %q, want the contract name %q", fake.secretID, adapters.SecretsName)
	}
	if values["ANIMAL"] != "zebra" || values["RIVER"] != "okavango" || len(values) != 2 {
		t.Errorf("values = %v, want the blob's key/value pairs", values)
	}
}

func TestSecretsAdapterFailsOnMissingSecretString(t *testing.T) {
	fake := &fakeSecrets{output: &secretsmanager.GetSecretValueOutput{}}
	_, err := adapters.NewSecretsManagerAdapter(fake).Fetch()
	if err == nil || !strings.Contains(err.Error(), "has no SecretString value") {
		t.Errorf("err = %v, want the missing SecretString failure", err)
	}
}

func TestSecretsAdapterFailsOnBadJSON(t *testing.T) {
	fake := &fakeSecrets{output: &secretsmanager.GetSecretValueOutput{
		SecretString: aws.String("{\"BROKEN\":"),
	}}
	_, err := adapters.NewSecretsManagerAdapter(fake).Fetch()
	if err == nil || !strings.Contains(err.Error(), "is not a JSON blob") {
		t.Errorf("err = %v, want the bad-JSON failure", err)
	}
}

func TestSecretsAdapterFailsOnNonBlobJSON(t *testing.T) {
	fake := &fakeSecrets{output: &secretsmanager.GetSecretValueOutput{
		SecretString: aws.String("[1,2]"),
	}}
	_, err := adapters.NewSecretsManagerAdapter(fake).Fetch()
	if err == nil || !strings.Contains(err.Error(), "is not a JSON blob (got array)") {
		t.Errorf("err = %v, want the array discovery failure", err)
	}
}

func TestSecretsAdapterFailsOnNonStringValue(t *testing.T) {
	fake := &fakeSecrets{output: &secretsmanager.GetSecretValueOutput{
		SecretString: aws.String(`{"RATE":3,"NAME":"zebra"}`),
	}}
	_, err := adapters.NewSecretsManagerAdapter(fake).Fetch()
	if err == nil || !strings.Contains(err.Error(), `value for "RATE" is not a string (got number)`) {
		t.Errorf("err = %v, want the non-string entry failure", err)
	}
}

func TestSecretsAdapterFailsLoudOnAPIErrors(t *testing.T) {
	fake := &fakeSecrets{err: &smithy.GenericAPIError{Code: "AccessDeniedException", Message: "nope"}}
	_, err := adapters.NewSecretsManagerAdapter(fake).Fetch()
	if err == nil {
		t.Fatal("the API failure must fail the fetch")
	}
	if !strings.Contains(err.Error(), `could not fetch secret "detectai/payment-webhook/secrets"`) {
		t.Errorf("err = %v, want the fetch error naming the secret", err)
	}
	if !strings.Contains(err.Error(), "make secrets-apply") {
		t.Errorf("err = %v, want the apply fix hint", err)
	}
}
