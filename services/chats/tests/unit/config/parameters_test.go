package config_test

import (
	"strings"
	"testing"

	"github.com/aws/aws-sdk-go-v2/aws"
	"github.com/aws/aws-sdk-go-v2/service/ssm"
	"github.com/aws/aws-sdk-go-v2/service/ssm/types"
	"github.com/aws/smithy-go"

	"github.com/kunalPisolkar24/detectAI/services/chats/internal/config/adapters"
)

func stringParameter(name, value string) types.Parameter {
	return types.Parameter{Name: aws.String(name), Value: aws.String(value), Type: types.ParameterTypeString}
}

func TestParametersAdapterFetchesAndMergesPages(t *testing.T) {
	prefix := adapters.SSMPrefix
	fake := &fakeParameters{pages: []*ssm.GetParametersByPathOutput{
		{
			Parameters: []types.Parameter{
				stringParameter(prefix+"PORT", "8090"),
				stringParameter(prefix+"V1", "first"),
				{Name: aws.String("detectai/chats/unprefixed"), Type: types.ParameterTypeString},
			},
			NextToken: aws.String("next"),
		},
		{
			Parameters: []types.Parameter{stringParameter(prefix+"V2", "second")},
		},
	}}
	values, err := adapters.NewParameterStoreAdapter(fake).Fetch()
	if err != nil {
		t.Fatal(err)
	}
	if values["PORT"] != "8090" || values["V1"] != "first" || values["V2"] != "second" || len(values) != 3 {
		t.Errorf("values = %v, want the prefix-stripped merge across both pages", values)
	}
	if len(fake.inputs) != 2 {
		t.Fatalf("GetParametersByPath ran %d times, want one per page", len(fake.inputs))
	}
	first, second := fake.inputs[0], fake.inputs[1]
	if aws.ToString(first.Path) != prefix {
		t.Errorf("Path = %q, want %q", aws.ToString(first.Path), prefix)
	}
	if first.Recursive == nil || !*first.Recursive {
		t.Errorf("Recursive = %v, want true", first.Recursive)
	}
	if first.WithDecryption == nil || *first.WithDecryption {
		t.Errorf("WithDecryption = %v, want false", first.WithDecryption)
	}
	if aws.ToString(second.NextToken) != "next" {
		t.Errorf("paged token = %q, want the first page's NextToken", aws.ToString(second.NextToken))
	}
}

func TestParametersAdapterAcceptsAnEmptyTree(t *testing.T) {
	values, err := adapters.NewParameterStoreAdapter(&fakeParameters{}).Fetch()
	if err != nil {
		t.Fatal(err)
	}
	if len(values) != 0 {
		t.Errorf("values = %v, want an empty plane", values)
	}
}

func TestParametersAdapterRefusesSecureStrings(t *testing.T) {
	prefix := adapters.SSMPrefix
	fake := &fakeParameters{pages: []*ssm.GetParametersByPathOutput{{
		Parameters: []types.Parameter{{
			Name: aws.String(prefix + "NEW_RELIC_LICENSE_KEY"),
			Type: types.ParameterTypeSecureString,
		}},
	}}}
	_, err := adapters.NewParameterStoreAdapter(fake).Fetch()
	if err == nil || !strings.Contains(err.Error(), `parameter "/detectai/chats/NEW_RELIC_LICENSE_KEY" under "/detectai/chats/" is SecureString`) {
		t.Errorf("err = %v, want the SecureString refusal", err)
	}
}

func TestParametersAdapterFailsLoudOnAPIErrors(t *testing.T) {
	fake := &fakeParameters{err: &smithy.GenericAPIError{Code: "AccessDeniedException", Message: "nope"}}
	_, err := adapters.NewParameterStoreAdapter(fake).Fetch()
	if err == nil || !strings.Contains(err.Error(), `could not read the SSM path "/detectai/chats/"`) {
		t.Errorf("err = %v, want the SSM read failure naming the path", err)
	}
	if !strings.Contains(err.Error(), "make secrets-apply") {
		t.Errorf("err = %v, want the apply fix hint", err)
	}
}
