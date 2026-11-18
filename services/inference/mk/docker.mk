IMAGE ?= cpu

ifeq ($(IMAGE),cpu)
DOCKER_TARGET := cpu
else ifeq ($(IMAGE),gpu)
DOCKER_TARGET := gpu
else
$(error IMAGE must be cpu or gpu)
endif

.PHONY: build help-docker

help-docker:
	@echo "  Images (mk/docker.mk):"
	@echo "    build     build the selected image (IMAGE=cpu|gpu, default cpu)"
	@echo ""

build:
	docker build --target $(DOCKER_TARGET) -t detectai-inference:$(DOCKER_TARGET) .
