PYTHON := python

.PHONY: help
help:
	@echo "Usage:"
	@echo "  make upload-spark v=v1.0.0"
	@echo "  make upload-flare v=v1.0.0"
	@echo "  make upload model=my-model-name v=v1.0.0"

.PHONY: upload-spark
upload-spark:
ifndef v
	$(error Usage: make upload-spark v=v1.0.0)
endif
	@echo "🚀 Deploying Spark Model Version $(v)..."
	$(PYTHON) main.py --model detect-ai-spark --version $(v)

.PHONY: upload-flare
upload-flare:
ifndef v
	$(error Usage: make upload-flare v=v1.0.0)
endif
	@echo "🔥 Deploying Flare Model Version $(v)..."
	$(PYTHON) main.py --model detect-ai-flare --version $(v)

.PHONY: upload
upload:
ifneq ($(and $(model),$(v)),)
	@echo "📦 Deploying $(model) Version $(v)..."
	$(PYTHON) main.py --model $(model) --version $(v)
else
	$(error Usage: make upload model=folder_name v=version_tag)
endif	