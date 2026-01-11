import pytest
import threading
import signal
from unittest.mock import MagicMock, patch
from src.server.grpc_server import GRPCServer

@pytest.fixture
def mock_engines():
    return MagicMock(), MagicMock()

def test_server_initialization(mock_engines):
    with patch("src.server.grpc_server.grpc.server") as mock_grpc_server, \
         patch("src.server.grpc_server.add_health_check") as mock_health:
        
        server_instance = MagicMock()
        mock_grpc_server.return_value = server_instance
        
        server = GRPCServer(*mock_engines)
        
        mock_grpc_server.assert_called_once()
        mock_health.assert_called_once_with(server_instance)
        server_instance.add_insecure_port.assert_not_called() 

def test_server_start_stop(mock_engines):
    with patch("src.server.grpc_server.grpc.server") as mock_grpc_server, \
         patch("src.server.grpc_server.signal.signal") as mock_signal, \
         patch("src.server.grpc_server.add_health_check"):
        
        server_instance = MagicMock()
        mock_grpc_server.return_value = server_instance
        
        server = GRPCServer(*mock_engines)
        
        def stop_trigger():
            server._stop_handler(signal.SIGTERM, None)
            
        threading.Timer(0.1, stop_trigger).start()
        
        server.start()
        
        server_instance.add_insecure_port.assert_called_with('[::]:50051')
        server_instance.start.assert_called_once()
        server_instance.stop.assert_called_once()