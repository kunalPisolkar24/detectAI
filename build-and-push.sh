#!/bin/sh
set -o errexit

LOCAL_REGISTRY="localhost:5001"
WEB_IMAGE_NAME="detect-ai-web"
WEB_DOCKERFILE="Dockerfile.prod"
WEB_CONTEXT="."

VERSION_TAG=${1:-latest}
echo "Using version tag for web app: ${VERSION_TAG}"

FULL_WEB_IMAGE_TAG="${LOCAL_REGISTRY}/${WEB_IMAGE_NAME}:${VERSION_TAG}"

echo "\nBuilding Web image: ${FULL_WEB_IMAGE_TAG}"
docker build -f "${WEB_DOCKERFILE}" -t "${FULL_WEB_IMAGE_TAG}" "${WEB_CONTEXT}"

echo "Pushing Web image to local registry..."
docker push "${FULL_WEB_IMAGE_TAG}"

echo "\n🚀 Web app image successfully built and pushed for version: ${VERSION_TAG}"