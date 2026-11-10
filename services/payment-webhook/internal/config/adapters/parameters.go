package adapters

import (
	"context"
	"fmt"
	"strings"

	"github.com/aws/aws-sdk-go-v2/aws"
	"github.com/aws/aws-sdk-go-v2/service/ssm"
	"github.com/aws/aws-sdk-go-v2/service/ssm/types"
)

// SSMPrefix is the SSM tree the seeding contract provisions for this service.
const SSMPrefix = "/detectai/payment-webhook/"

// ParametersClient is the transport interface; the SDK ships no service-wide equivalent.
type ParametersClient interface {
	GetParametersByPath(ctx context.Context, params *ssm.GetParametersByPathInput, optFns ...func(*ssm.Options)) (*ssm.GetParametersByPathOutput, error)
}

// ParameterStoreAdapter reads the service's SSM tree: paged, prefix-stripped, plain strings.
type ParameterStoreAdapter struct {
	client ParametersClient
}

func NewParameterStoreAdapter(client ParametersClient) *ParameterStoreAdapter {
	return &ParameterStoreAdapter{client: client}
}

// Fetch returns the plane's key/value map; treat it as read-only.
func (a *ParameterStoreAdapter) Fetch() (map[string]string, error) {
	values := make(map[string]string)
	input := &ssm.GetParametersByPathInput{
		Path:           aws.String(SSMPrefix),
		Recursive:      aws.Bool(true),
		WithDecryption: aws.Bool(false),
	}
	for {
		output, err := a.client.GetParametersByPath(context.Background(), input)
		if err != nil {
			return nil, fmt.Errorf("config: could not read the SSM path %q: %v; %s", SSMPrefix, err, fetchFix)
		}
		for _, parameter := range output.Parameters {
			name := aws.ToString(parameter.Name)
			if parameter.Type == types.ParameterTypeSecureString {
				return nil, fmt.Errorf(
					"config: parameter %q under %q is SecureString; the config plane holds plain String entries only — secrets belong in the secrets blob",
					name, SSMPrefix)
			}
			if key, ok := strings.CutPrefix(name, SSMPrefix); ok && key != "" {
				values[key] = aws.ToString(parameter.Value)
			}
		}
		if output.NextToken == nil {
			return values, nil
		}
		input.NextToken = output.NextToken
	}
}
