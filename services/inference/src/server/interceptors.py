import grpc
from src.config import settings

class AuthInterceptor(grpc.ServerInterceptor):
    def intercept_service(self, continuation, handler_call_details):
        metadata = dict(handler_call_details.invocation_metadata)
        if metadata.get('x-api-key') != settings.API_KEY:
            def abort(ignored_request, context):
                context.abort(grpc.StatusCode.UNAUTHENTICATED, 'Invalid API Key')
                return None
            return grpc.unary_unary_rpc_method_handler(abort)
        
        return continuation(handler_call_details)