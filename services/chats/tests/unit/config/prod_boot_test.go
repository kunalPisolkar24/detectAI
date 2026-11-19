package config_test

import (
	"strings"
	"testing"

	"github.com/aws/aws-sdk-go-v2/aws"
	"github.com/aws/aws-sdk-go-v2/service/secretsmanager"
	"github.com/aws/aws-sdk-go-v2/service/ssm"
	"github.com/aws/smithy-go"

	"github.com/kunalPisolkar24/detectAI/services/chats/internal/config"
	"github.com/kunalPisolkar24/detectAI/services/chats/internal/config/adapters"
	"github.com/kunalPisolkar24/detectAI/services/chats/internal/config/planes"
)

const seededBlob = `{"NEW_RELIC_LICENSE_KEY":"` + testLicenseKey + `"}`

// seedProdPlane builds the prod source through the real adapters: one secrets
// blob and one SSM page, or an SSM fetch failure.
func seedProdPlane(t *testing.T, blob string, params map[string]string, ssmErr error) (config.Source, error) {
	t.Helper()
	secrets := &fakeSecrets{output: &secretsmanager.GetSecretValueOutput{SecretString: aws.String(blob)}}
	parameters := &fakeParameters{err: ssmErr}
	if ssmErr == nil {
		page := &ssm.GetParametersByPathOutput{}
		for name, value := range params {
			page.Parameters = append(page.Parameters, stringParameter(adapters.SSMPrefix+name, value))
		}
		parameters.pages = []*ssm.GetParametersByPathOutput{page}
	}
	return planes.NewProdSource(
		adapters.NewParameterStoreAdapter(parameters),
		adapters.NewSecretsManagerAdapter(secrets),
	)
}

func TestProdSeededBadValuesFailTheBoot(t *testing.T) {
	t.Run("a bad PORT in the SSM tree fails the boot", func(t *testing.T) {
		source, err := seedProdPlane(t, seededBlob, map[string]string{
			"PORT": "70000",
		}, nil)
		if err != nil {
			t.Fatal(err)
		}
		_, resolveErr := config.Resolve(source)
		if resolveErr == nil || !strings.Contains(resolveErr.Error(), "PORT must be an integer between 1 and 65535") {
			t.Errorf("err = %v, want the PORT identity failure off the seeded tree", resolveErr)
		}
	})

	t.Run("a NaN sample ratio seeded into the SSM tree fails the boot", func(t *testing.T) {
		source, err := seedProdPlane(t, seededBlob, map[string]string{
			"PORT":                    "8090",
			"OTEL_TRACE_SAMPLE_RATIO": "NaN",
		}, nil)
		if err != nil {
			t.Fatal(err)
		}
		_, resolveErr := config.Resolve(source)
		if resolveErr == nil || !strings.Contains(resolveErr.Error(), "OTEL_TRACE_SAMPLE_RATIO must lie in the interval (0, 1]") {
			t.Errorf("err = %v, want the sample-ratio failure off the seeded tree", resolveErr)
		}
	})

	t.Run("a set endpoint in the SSM tree with a short blob key fails", func(t *testing.T) {
		source, err := seedProdPlane(t,
			`{"NEW_RELIC_LICENSE_KEY":"lic-short"}`,
			map[string]string{
				"PORT":                        "8090",
				"OTEL_EXPORTER_OTLP_ENDPOINT": testOTelEndpoint,
			}, nil)
		if err != nil {
			t.Fatal(err)
		}
		_, resolveErr := config.Resolve(source)
		if resolveErr == nil || !strings.Contains(resolveErr.Error(), "NEW_RELIC_LICENSE_KEY must be at least 16 characters") {
			t.Errorf("err = %v, want the endpoint gate to demand the seeded blob key", resolveErr)
		}
		if resolveErr != nil && strings.Contains(resolveErr.Error(), "lic-short") {
			t.Errorf("err = %v; the seeded license key must never be echoed", resolveErr)
		}
	})
}

func TestProdSeededSSMFailureFailsTheBoot(t *testing.T) {
	_, err := seedProdPlane(t, seededBlob, nil, &smithy.GenericAPIError{Code: "AccessDeniedException", Message: "nope"})
	if err == nil || !strings.Contains(err.Error(), `could not read the SSM path "/detectai/chats/"`) {
		t.Errorf("err = %v, want the SSM read failure with healthy secrets", err)
	}
}
