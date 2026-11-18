IMAGE ?= cpu

ifeq ($(IMAGE),cpu)
DOCKER_TARGET := cpu
else ifeq ($(IMAGE),gpu)
DOCKER_TARGET := gpu
else
$(error IMAGE must be cpu or gpu)
endif

COMPOSE_FILES := -f infra/compose.yml
ifeq ($(IMAGE),gpu)
COMPOSE_FILES += -f infra/compose.gpu.yml
endif
COMPOSE := docker compose $(COMPOSE_FILES)

.PHONY: build up down help-docker

help-docker:
	@echo "  Images (mk/docker.mk):"
	@echo "    build     build the selected image (IMAGE=cpu|gpu, default cpu)"
	@echo "    up        start compose with the selected image"
	@echo "    down      stop compose for the selected image"
	@echo "  Switches: IMAGE=cpu|gpu (default cpu)"
	@echo ""

build:
	docker build --target $(DOCKER_TARGET) -t detectai-inference:$(DOCKER_TARGET) .

up:
	$(COMPOSE) up --build -d

down:
	$(COMPOSE) down
