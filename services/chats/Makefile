.DEFAULT_GOAL := run

include mk/local.mk
include mk/docker.mk
include mk/tests.mk
include mk/secrets.mk
include mk/load.mk

.PHONY: help
help: help-local help-docker help-tests help-secrets help-load
