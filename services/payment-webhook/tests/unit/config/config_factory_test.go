package config_test

import (
	"strings"
	"testing"

	"github.com/kunalPisolkar24/detectAI/services/payment-webhook/internal/config/factories"
	"github.com/kunalPisolkar24/detectAI/services/payment-webhook/internal/config/planes"
)

func TestCreateDevWiresTheDotenvPlane(t *testing.T) {
	t.Chdir(t.TempDir())

	src, err := factories.ConfigFactory{}.Create("dev")
	if err != nil {
		t.Fatal(err)
	}
	if _, ok := src.(*planes.DevSource); !ok {
		t.Errorf("Create(dev) = %T, want a *planes.DevSource", src)
	}
}

func TestCreateProdNeedsTheRegion(t *testing.T) {
	offlineProd(t, "")
	_, err := factories.ConfigFactory{}.Create("prod")
	if err == nil || !strings.Contains(err.Error(), "needs AWS_REGION") {
		t.Errorf("err = %v, want the missing-region refusal", err)
	}
}

func TestCreateProdFetchesTheSecretsPlaneFirst(t *testing.T) {
	offlineProd(t, "ap-southeast-2")
	t.Setenv("AWS_ENDPOINT_URL_SECRETS_MANAGER", "http://127.0.0.1:1")
	t.Setenv("AWS_ENDPOINT_URL_SSM", "http://127.0.0.1:1")
	_, err := factories.ConfigFactory{}.Create("prod")
	if err == nil || !strings.Contains(err.Error(), `could not fetch secret "detectai/payment-webhook/secrets"`) {
		t.Errorf("err = %v, want the secrets fetch failure", err)
	}
}

func TestCreateUnknownFlickFails(t *testing.T) {
	_, err := factories.ConfigFactory{}.Create("qa")
	if err == nil || !strings.Contains(err.Error(), `unknown flick "qa"`) {
		t.Errorf("err = %v, want the unknown-flick error", err)
	}
}
