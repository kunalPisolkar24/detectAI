.DEFAULT_GOAL := run

include mk/local.mk
include mk/docker.mk
include mk/secrets.mk
include mk/tests.mk
include mk/load.mk

.PHONY: help
help: help-local help-docker help-secrets help-tests help-load
