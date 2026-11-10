from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from src.infrastructure.composition import container


def _settings(warmup_enabled=True, **overrides):
    settings = SimpleNamespace(
        MODEL_CACHE_DIR="./models",
        INFERENCE_PROVIDERS=["CPUExecutionProvider"],
        SPARK_MODEL_REVISION="9a48004391c71272d6fb1d164ed7c56e1fbfe360",
        FLARE_MODEL_REVISION="e1911c0be59f4e10f0d120f639d1358e46bc2086",
        HF_TOKEN=None,
        ORT_INTRA_OP_THREADS=1,
        ORT_INTER_OP_THREADS=1,
        ORT_GRAPH_OPT_LEVEL="all",
        ORT_EXECUTION_MODE="sequential",
        ORT_WARMUP_ENABLED=warmup_enabled,
        BATCH_SIZE=2,
        BATCH_TIMEOUT=0.05,
        SPARK_BATCH_SIZE=None,
        SPARK_BATCH_TIMEOUT=None,
        FLARE_BATCH_SIZE=None,
        FLARE_BATCH_TIMEOUT=None,
        BATCH_QUEUE_MAX_SIZE=8,
        MAX_CONCURRENT_BATCHES=1,
        CHUNK_TOKEN_LIMIT=4,
        CHUNK_TOKEN_STRIDE=2,
        MAX_GLOBAL_TOKENS=100,
        MAX_INFLIGHT_DOC_CHUNKS=2,
        MAX_TEXT_CHARS=100,
    )
    for key, value in overrides.items():
        setattr(settings, key, value)
    settings.batch_size_for = lambda model_key: (
        {"spark": settings.SPARK_BATCH_SIZE, "flare": settings.FLARE_BATCH_SIZE}.get(model_key)
        or settings.BATCH_SIZE
    )
    settings.batch_timeout_for = lambda model_key: (
        {"spark": settings.SPARK_BATCH_TIMEOUT, "flare": settings.FLARE_BATCH_TIMEOUT}.get(model_key)
        or settings.BATCH_TIMEOUT
    )
    return settings


def _patch_composition():
    loader_cls = patch.object(container, "HuggingFaceLoader")
    spark_cls = patch.object(container, "SparkEngine")
    flare_cls = patch.object(container, "FlareEngine")
    batcher_cls = patch.object(container, "BatchingProxy")
    service_cls = patch.object(container, "DocumentAnalysisService")
    planner_fn = patch.object(container, "build_chunk_planner")
    return loader_cls, spark_cls, flare_cls, batcher_cls, service_cls, planner_fn


@pytest.mark.asyncio
async def test_build_loads_both_models_and_warms_up():
    import concurrent.futures

    patches = _patch_composition()
    with patches[0] as mock_loader_cls, patches[1] as mock_spark_cls, patches[2] as mock_flare_cls, \
         patches[3] as mock_batcher_cls, patches[4] as mock_service_cls, patches[5]:
        loader = mock_loader_cls.return_value
        loader.load.side_effect = lambda key: (f"{key}-session", f"{key}-tokenizer")
        spark_engine = mock_spark_cls.return_value
        flare_engine = mock_flare_cls.return_value
        batcher = MagicMock()
        batcher.start = AsyncMock()
        mock_batcher_cls.return_value = batcher

        with concurrent.futures.ThreadPoolExecutor(max_workers=2) as spark_ex, \
             concurrent.futures.ThreadPoolExecutor(max_workers=2) as flare_ex:
            await container.build_analysis_service(_settings(), MagicMock(), (spark_ex, flare_ex))

        loaded = sorted(call.args[0] for call in loader.load.call_args_list)
        assert loaded == ["flare", "spark"]
        spark_engine.warmup.assert_called_once()
        flare_engine.warmup.assert_called_once()
        assert batcher.start.await_count == 2
        mock_service_cls.assert_called_once()


@pytest.mark.asyncio
async def test_build_skips_warmup_when_disabled():
    import concurrent.futures

    patches = _patch_composition()
    with patches[0] as mock_loader_cls, patches[1] as mock_spark_cls, patches[2] as mock_flare_cls, \
         patches[3] as mock_batcher_cls, patches[4], patches[5]:
        loader = mock_loader_cls.return_value
        loader.load.side_effect = lambda key: (f"{key}-session", f"{key}-tokenizer")
        batcher = MagicMock()
        batcher.start = AsyncMock()
        mock_batcher_cls.return_value = batcher

        with concurrent.futures.ThreadPoolExecutor(max_workers=1) as spark_ex, \
             concurrent.futures.ThreadPoolExecutor(max_workers=1) as flare_ex:
            await container.build_analysis_service(_settings(warmup_enabled=False), MagicMock(), (spark_ex, flare_ex))

        mock_spark_cls.return_value.warmup.assert_not_called()
        mock_flare_cls.return_value.warmup.assert_not_called()


def test_warmup_engine_failure_does_not_raise():
    engine = MagicMock()
    engine.warmup.side_effect = RuntimeError("ort boom")

    container._warmup_engine(engine, "spark")


@pytest.mark.asyncio
async def test_build_passes_per_model_batch_config():
    import concurrent.futures

    patches = _patch_composition()
    with patches[0] as mock_loader_cls, patches[1], patches[2], \
         patches[3] as mock_batcher_cls, patches[4], patches[5]:
        mock_loader_cls.return_value.load.side_effect = lambda key: (f"{key}-session", f"{key}-tokenizer")
        batcher = MagicMock()
        batcher.start = AsyncMock()
        mock_batcher_cls.return_value = batcher

        settings = _settings(FLARE_BATCH_SIZE=6, FLARE_BATCH_TIMEOUT=0.2)
        with concurrent.futures.ThreadPoolExecutor(max_workers=1) as spark_ex, \
             concurrent.futures.ThreadPoolExecutor(max_workers=1) as flare_ex:
            await container.build_analysis_service(settings, MagicMock(), (spark_ex, flare_ex))

        assert mock_batcher_cls.call_count == 2
        spark_call, flare_call = mock_batcher_cls.call_args_list
        assert spark_call.args[1:3] == (2, 0.05)
        assert spark_call.args[3] == "spark"
        assert flare_call.args[1:3] == (6, 0.2)
        assert flare_call.args[3] == "flare"
