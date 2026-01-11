import time
import pytest
from concurrent import futures
from src.inference.batcher import BatchingProxy

def test_batcher_predict_single(mock_engine):
    batcher = BatchingProxy(mock_engine, batch_size=1, timeout=0.1, model_name="test")
    result = batcher.predict("test input")
    
    assert result == 0.8
    mock_engine.predict_batch.assert_called_once()
    args = mock_engine.predict_batch.call_args[0][0]
    assert args == ["test input"]
    
    batcher.shutdown_flag = True

def test_batcher_groups_requests(mock_engine):
    batcher = BatchingProxy(mock_engine, batch_size=2, timeout=0.5, model_name="test")
    
    future1 = futures.Future()
    future2 = futures.Future()
    
    batcher.queue.put(("text1", future1))
    batcher.queue.put(("text2", future2))
    
    time.sleep(0.2)
    
    assert future1.result() == 0.8
    assert future2.result() == 0.2
    
    mock_engine.predict_batch.assert_called_once()
    args = mock_engine.predict_batch.call_args[0][0]
    assert len(args) == 2
    assert args == ["text1", "text2"]
    
    batcher.shutdown_flag = True

def test_batcher_respects_timeout(mock_engine):
    batcher = BatchingProxy(mock_engine, batch_size=5, timeout=0.1, model_name="test")
    
    start = time.monotonic()
    result = batcher.predict("wait for me")
    duration = time.monotonic() - start
    
    assert duration >= 0.1
    assert result == 0.8
    mock_engine.predict_batch.assert_called_once()
    
    batcher.shutdown_flag = True

def test_batcher_handles_exception(mock_engine):
    mock_engine.predict_batch.side_effect = ValueError("Inference failed")
    batcher = BatchingProxy(mock_engine, batch_size=1, timeout=0.1, model_name="test")
    
    with pytest.raises(ValueError, match="Inference failed"):
        batcher.predict("boom")
        
    batcher.shutdown_flag = True