# Contract codegen. The proto in api/proto is the source of truth; the Python
# stubs under app/serving/generated are derived and stay out of git.

.PHONY: proto help-proto

help-proto:
	@echo "  Codegen (mk/proto.mk):"
	@echo "    proto            generate Python gRPC stubs from api/proto into app/serving/generated"
	@echo ""

proto:
	mkdir -p app/serving/generated
	touch app/serving/generated/__init__.py
	poetry run python -m grpc_tools.protoc \
		-Iapi/proto \
		--python_out=app/serving/generated \
		--grpc_python_out=app/serving/generated \
		api/proto/ai_service.proto
	sed -i 's/^import ai_service_pb2/from . import ai_service_pb2/' app/serving/generated/ai_service_pb2_grpc.py
