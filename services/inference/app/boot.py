"""The boot wiring: resolve the plane, pull the artifacts, load the models, and
build the runtimes the server serves from."""

import logging
import time
from collections.abc import Mapping
from pathlib import Path

from .config import ConfigFactory, Settings, deployment_flick
from .inference.engine import OnnxEngine
from .inference.preprocessing import DocumentPreprocessor, FastTokenizer
from .inference.runtime import ModelRuntime, build_runtime
from .models import LoadedModel, ModelArtifactManager, ModelSpecs
from .models.loading import OnnxModelLoader
from .models.pulling import HuggingFaceStore

logger = logging.getLogger(__name__)


def resolve_settings() -> Settings:
    """Resolve the plane and read the settings; a bad plane or key dies here.

    The seeded log level lands before the plane is announced, so a plane that
    asks for quiet stays quiet.
    """
    flick = deployment_flick()
    provider = ConfigFactory.create(flick)
    settings = Settings.from_provider(provider)
    logging.getLogger().setLevel(settings.log_level)
    logger.info("config plane: %s", flick)
    return settings


def ensure_model_artifacts(settings: Settings) -> Mapping[str, Path]:
    """Pull before serving: a missing or unpullable artifact kills the boot."""
    store = HuggingFaceStore(root=Path(settings.model_cache_dir), token=settings.hf_token)
    return ModelArtifactManager(ModelSpecs.from_settings(settings), store).ensure_all()


def load_models(settings: Settings, artifacts: Mapping[str, Path]) -> Mapping[str, LoadedModel]:
    """Load after pull, before serving: a bad build kills the boot."""
    loader = OnnxModelLoader(
        providers=settings.inference_providers,
        ceilings=settings.max_sequence_lengths(),
        intra_op_threads=settings.ort_intra_op_threads,
    )
    return loader.load_all(artifacts)


def build_runtimes(
    settings: Settings, loaded: Mapping[str, LoadedModel]
) -> Mapping[str, ModelRuntime]:
    """Build after load, before serving: one runtime per model, walking sorted."""
    runtimes: dict[str, ModelRuntime] = {}
    for key, model in sorted(loaded.items()):
        tokenizer = FastTokenizer(model.tokenizer)
        batch_size = settings.batch_size_for(key)
        preprocessor = DocumentPreprocessor(
            tokenizer=tokenizer,
            chunk_token_limit=settings.chunk_token_limit,
            model_max_sequence_length=model.max_sequence_length,
            max_text_chars=settings.max_text_chars,
            chunk_token_overlap=settings.chunk_token_overlap,
        )
        engine = OnnxEngine(
            session=model.session,
            pad_token_id=tokenizer.pad_token_id,
            max_sequence_length=model.max_sequence_length,
            batch_size=batch_size,
        )
        runtimes[key] = build_runtime(
            key=key,
            preprocessor=preprocessor,
            engine=engine,
            batch_size=batch_size,
            max_inflight=settings.max_concurrent_batches,
        )
    logger.info(
        "model runtimes: %s",
        ", ".join(
            f"{key} (batch {runtime.batch_size})"
            for key, runtime in sorted(runtimes.items())
        ),
    )
    return runtimes


def warm_runtimes(runtimes: Mapping[str, ModelRuntime]) -> None:
    """Warm after build, before serving: a model that cannot score kills the boot."""
    for key, runtime in sorted(runtimes.items()):
        started = time.perf_counter()
        runtime.engine.warmup(runtime.preprocessor.window_tokens)
        logger.info("%s: warmed up in %.1fs", key, time.perf_counter() - started)


def close_runtimes(runtimes: Mapping[str, ModelRuntime]) -> None:
    """Close the pools the runtimes opened, once the server has stopped."""
    for key in sorted(runtimes):
        runtimes[key].close()
