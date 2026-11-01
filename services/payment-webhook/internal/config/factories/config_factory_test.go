package factories

import (
	"strings"
	"testing"

	"github.com/kunalPisolkar24/detectAI/services/payment-webhook/internal/config/planes"
)

func TestCreateDevWiresTheDotenvPlane(t *testing.T) {
	t.Chdir(t.TempDir())

	src, err := ConfigFactory{}.Create("dev")
	if err != nil {
		t.Fatal(err)
	}
	if _, ok := src.(*planes.DevSource); !ok {
		t.Errorf("Create(dev) = %T, want a *planes.DevSource", src)
	}
}

func TestCreateProdRefusesBeforeTheAWSBuild(t *testing.T) {
	_, err := ConfigFactory{}.Create("prod")
	if err == nil || !strings.Contains(err.Error(), "refuses") {
		t.Errorf("err = %v, want the prod plane refusal", err)
	}
}

func TestCreateUnknownFlickFails(t *testing.T) {
	_, err := ConfigFactory{}.Create("qa")
	if err == nil || !strings.Contains(err.Error(), `unknown flick "qa"`) {
		t.Errorf("err = %v, want the unknown-flick error", err)
	}
}
