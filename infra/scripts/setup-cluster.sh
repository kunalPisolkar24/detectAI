#!/bin/sh
set -o errexit

reg_name='kind-registry'
reg_port='5001'
if [ "$(docker inspect -f '{{.State.Running}}' "${reg_name}" 2>/dev/null || true)" != 'true' ]; then
  docker run \
    -d --restart=always -p "127.0.0.1:${reg_port}:5000" --name "${reg_name}" \
    registry:2
fi

kind create cluster --config kind-cluster-config.yaml --name detectai-cluster

docker network connect "kind" "${reg_name}"

echo "Waiting for Ingress controller to be ready..."
kubectl apply -f https://raw.githubusercontent.com/kubernetes/ingress-nginx/main/deploy/static/provider/kind/deploy.yaml
kubectl wait --namespace ingress-nginx \
  --for=condition=available deployment/ingress-nginx-controller \
  --timeout=90s

echo "✅ Cluster 'detectai-cluster' is ready."