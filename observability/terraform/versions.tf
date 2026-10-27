terraform {
  required_version = "~> 1.9"

  required_providers {
    newrelic = {
      source  = "newrelic/newrelic"
      version = "~> 3.0"
    }
  }

  # One backend shape; tools/newrelic.py resolves the plane per run from the
  # .env keys (EMULATOR_ENDPOINT set -> Floci S3, unset -> real AWS) and injects
  # the config through a generated -backend-config file — same contract as
  # document-parser/tools/secrets.py. Bucket default + self-heal on Floci,
  # required + versioned on real AWS. There is no bare local-file state mode:
  # a run without an initialized backend cannot plan/apply on a declared
  # "s3" backend (mk/local.mk's `init -backend=false` is offline-only,
  # for validate/test; there are no backend.*.hcl files).
  backend "s3" {}
}
