package adapters

import (
	"context"
	"encoding/json"
	"fmt"

	"github.com/aws/aws-sdk-go-v2/aws"
	"github.com/aws/aws-sdk-go-v2/service/secretsmanager"
)

// SecretsName is the secrets blob the seeding contract provisions for this service.
const SecretsName = "detectai/payment-webhook/secrets"

const fetchFix = "apply the plane it reads (make secrets-apply) and check the runtime role"

// SecretsClient is the transport interface; the SDK ships no service-wide equivalent.
type SecretsClient interface {
	GetSecretValue(ctx context.Context, params *secretsmanager.GetSecretValueInput, optFns ...func(*secretsmanager.Options)) (*secretsmanager.GetSecretValueOutput, error)
}

// SecretsManagerAdapter reads the service's secrets blob as a JSON object of key/value strings.
type SecretsManagerAdapter struct {
	client SecretsClient
	name   string
}

func NewSecretsManagerAdapter(client SecretsClient) *SecretsManagerAdapter {
	return &SecretsManagerAdapter{client: client, name: SecretsName}
}

// Fetch returns the plane's key/value map; treat it as read-only.
func (a *SecretsManagerAdapter) Fetch() (map[string]string, error) {
	output, err := a.client.GetSecretValue(context.Background(),
		&secretsmanager.GetSecretValueInput{SecretId: aws.String(a.name)})
	if err != nil {
		return nil, fmt.Errorf("config: could not fetch secret %q: %v; %s", a.name, err, fetchFix)
	}
	if output.SecretString == nil {
		return nil, fmt.Errorf("config: secret %q has no SecretString value (binary or empty); %s", a.name, fetchFix)
	}
	var blob any
	if err := json.Unmarshal([]byte(*output.SecretString), &blob); err != nil {
		return nil, fmt.Errorf("config: secret %q is not a JSON blob: %v", a.name, err)
	}
	entries, ok := blob.(map[string]any)
	if !ok {
		return nil, fmt.Errorf("config: secret %q is not a JSON blob (got %s)", a.name, jsonShape(blob))
	}
	values := make(map[string]string, len(entries))
	for key, value := range entries {
		text, ok := value.(string)
		if !ok {
			return nil, fmt.Errorf("config: secret %q value for %q is not a string (got %s)", a.name, key, jsonShape(value))
		}
		values[key] = text
	}
	return values, nil
}

// jsonShape names the decoded JSON kind for the failure messages.
func jsonShape(value any) string {
	switch value.(type) {
	case string:
		return "string"
	case bool:
		return "boolean"
	case float64:
		return "number"
	case []any:
		return "array"
	case map[string]any:
		return "object"
	default:
		return "null"
	}
}
