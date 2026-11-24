.DEFAULT_GOAL := run

include mk/local.mk
include mk/secrets.mk
include mk/docker.mk
include mk/migrate.mk

.PHONY: help
help: help-local help-secrets help-docker help-migrate
