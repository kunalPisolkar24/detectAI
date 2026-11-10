DIR := $(dir $(abspath $(lastword $(MAKEFILE_LIST))))
POETRY := poetry -C $(DIR)

.DEFAULT_GOAL := help

include mk/local.mk
include mk/secrets.mk
include mk/tests.mk

.PHONY: help
help: help-local help-tests help-secrets
