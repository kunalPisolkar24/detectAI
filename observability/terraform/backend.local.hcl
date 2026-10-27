# Daily default: plain local file state, gitignored by the repo's *.tfstate
# patterns. path names the same default a bare init uses, so
# `init -backend-config=backend.local.hcl` and a bare `init` converge on one
# state file and can never split state in two.
path = "terraform.tfstate"
