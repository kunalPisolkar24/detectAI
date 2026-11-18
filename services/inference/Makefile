.DEFAULT_GOAL := help

include mk/local.mk
include mk/secrets.mk
include mk/tests.mk
include mk/proto.mk
include mk/docker.mk
include mk/load.mk

.PHONY: help
help: help-local help-secrets help-tests help-proto help-docker help-load
