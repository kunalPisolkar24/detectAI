package config_test

import (
	"fmt"
	"strings"
	"testing"

	"github.com/kunalPisolkar24/detectAI/services/payment-webhook/internal/config/planes"
)

func TestProdSourceMergesBothPlanes(t *testing.T) {
	log := []string{}
	source, err := planes.NewProdSource(
		&fakePlane{name: "ssm", log: &log, values: map[string]string{"PORT": "8080"}},
		&fakePlane{name: "secrets", log: &log, values: map[string]string{"PADDLE_WEBHOOK_SECRET": "paddle-secret-16-chars"}},
	)
	if err != nil {
		t.Fatal(err)
	}
	if fmt.Sprint(log) != "[secrets ssm]" {
		t.Errorf("fetch order = %v, want secrets before SSM", log)
	}
	if value, ok := source.Get("PADDLE_WEBHOOK_SECRET"); !ok || value != "paddle-secret-16-chars" {
		t.Errorf("Get(secret) = %q, %t, want the blob value", value, ok)
	}
	if value, ok := source.Get("PORT"); !ok || value != "8080" {
		t.Errorf("Get(PORT) = %q, %t, want the SSM value", value, ok)
	}
	if _, ok := source.Get("ABSENT"); ok {
		t.Errorf("Get(ABSENT) reported presence")
	}
}

func TestProdSourceSurfacesTheSecretsFailureFirst(t *testing.T) {
	log := []string{}
	secretsErr := fmt.Errorf("config: could not fetch secret: boom")
	_, err := planes.NewProdSource(
		&fakePlane{name: "ssm", log: &log, values: map[string]string{"PORT": "8080"}},
		&fakePlane{name: "secrets", log: &log, err: secretsErr},
	)
	if err != secretsErr {
		t.Errorf("err = %v, want the secrets failure surfaced", err)
	}
	if fmt.Sprint(log) != "[secrets]" {
		t.Errorf("fetch order = %v, want SSM never fetched after a secrets failure", log)
	}
}

func TestProdSourceFailsOnCollisions(t *testing.T) {
	t.Run("case-insensitive", func(t *testing.T) {
		_, err := planes.NewProdSource(
			&fakePlane{values: map[string]string{"paddle_webhook_secret": "ssm-copy"}},
			&fakePlane{values: map[string]string{"PADDLE_WEBHOOK_SECRET": "blob-value"}},
		)
		want := "config: key(s) seeded on both planes: paddle_webhook_secret; the secrets blob and the SSM prefix are disjoint by contract — remove the duplicates and re-apply (make secrets-apply)"
		if err == nil || err.Error() != want {
			t.Errorf("err = %v, want the disjointness failure", err)
		}
	})
	t.Run("sorted-when-several", func(t *testing.T) {
		_, err := planes.NewProdSource(
			&fakePlane{values: map[string]string{"port": "8080", "max_body_bytes": "1"}},
			&fakePlane{values: map[string]string{"PORT": "8080", "MAX_BODY_BYTES": "1"}},
		)
		if err == nil || !strings.Contains(err.Error(), "max_body_bytes, port") {
			t.Errorf("err = %v, want the sorted collision list", err)
		}
	})
}

func TestProdSourceAcceptsTwoEmptyPlanes(t *testing.T) {
	source, err := planes.NewProdSource(&fakePlane{values: map[string]string{}}, &fakePlane{values: map[string]string{}})
	if err != nil {
		t.Fatal(err)
	}
	if _, ok := source.Get("anything"); ok {
		t.Errorf("an empty plane served a key")
	}
}
