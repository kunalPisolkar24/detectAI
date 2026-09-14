DIR := $(dir $(abspath $(lastword $(MAKEFILE_LIST))))
POETRY := poetry -C $(DIR)
RUN := $(POETRY) run python main.py

.PHONY: help install
help:
	@echo "Usage:"
	@echo "  make install               Install deps (poetry install)"
	@echo "  make upload-spark v=v1.0.0  Deploy Spark model"
	@echo "  make upload-flare v=v1.0.0  Deploy Flare model"
	@echo "  make upload model=my-model-name v=v1.0.0"

install:
	$(POETRY) install --no-interaction

.PHONY: upload-spark
upload-spark:
ifndef v
	$(error Usage: make upload-spark v=v1.0.0)
endif
	@echo "🚀 Deploying Spark Model Version $(v)..."
	$(RUN) --model detect-ai-spark --version $(v)

.PHONY: upload-flare
upload-flare:
ifndef v
	$(error Usage: make upload-flare v=v1.0.0)
endif
	@echo "🔥 Deploying Flare Model Version $(v)..."
	$(RUN) --model detect-ai-flare --version $(v)

.PHONY: upload
upload:
ifneq ($(and $(model),$(v)),)
	@echo "📦 Deploying $(model) Version $(v)..."
	$(RUN) --model $(model) --version $(v)
else
	$(error Usage: make upload model=folder_name v=version_tag)
endif	