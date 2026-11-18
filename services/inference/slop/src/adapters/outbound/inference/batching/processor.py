import asyncio
import math

import structlog

from src.domain.exceptions import InferenceError

logger = structlog.get_logger()
_PROCESSING_TIMEOUT = 30.0


async def process_batch(batch, engine_predict, executor, model_name, telemetry=None):

    active = [p for p in batch if not p.future.done() and not p.future.cancelled()]
    if not active:
        return

    texts = [p.text for p in active]
    futures = [p.future for p in active]

    if telemetry is not None:
        try:
            telemetry.observe_batch_size(model_name, len(active))
        except Exception:
            pass
    else:
        try:
            from src.infrastructure.metrics import BATCH_SIZE_DISTRIBUTION

            BATCH_SIZE_DISTRIBUTION.labels(model=model_name).observe(len(active))
        except Exception:
            pass

    try:
        if telemetry is not None:
            try:
                from src.infrastructure.metrics import BATCH_PROCESSING_TIME

                ctx = BATCH_PROCESSING_TIME.labels(model=model_name).time()
            except Exception:
                ctx = None
            if ctx is not None:
                with ctx:
                    results = await asyncio.wait_for(
                        asyncio.get_running_loop().run_in_executor(executor, engine_predict, texts),
                        timeout=_PROCESSING_TIMEOUT,
                    )
            else:
                results = await asyncio.wait_for(
                    asyncio.get_running_loop().run_in_executor(executor, engine_predict, texts),
                    timeout=_PROCESSING_TIMEOUT,
                )
        else:
            from src.infrastructure.metrics import BATCH_PROCESSING_TIME

            with BATCH_PROCESSING_TIME.labels(model=model_name).time():
                results = await asyncio.wait_for(
                    asyncio.get_running_loop().run_in_executor(executor, engine_predict, texts),
                    timeout=_PROCESSING_TIMEOUT,
                )

        if len(results) != len(futures):
            raise RuntimeError("Batch results length mismatch")

        for fut, res in zip(futures, results):
            if fut.done():
                continue
            try:
                val = float(res)
            except Exception:
                _record_batch_error(model_name, "invalid_result", telemetry)
                if not fut.done():
                    fut.set_exception(InferenceError(f"Invalid batch result {res!r}"))
                continue
            if not math.isfinite(val):
                _record_batch_error(model_name, "invalid_result", telemetry)
                if not fut.done():
                    fut.set_exception(InferenceError(f"Non-finite batch result {val}"))
                continue
            fut.set_result(val)

    except asyncio.CancelledError:
        _record_batch_error(model_name, "cancelled", telemetry)
        for fut in futures:
            if not fut.done():
                fut.set_exception(asyncio.CancelledError("Batch cancelled"))
        raise
    except BaseException as e:
        if isinstance(e, asyncio.TimeoutError):
            _record_batch_error(model_name, "timeout", telemetry)
        elif isinstance(e, RuntimeError) and "length mismatch" in str(e).lower():
            _record_batch_error(model_name, "length_mismatch", telemetry)
        elif isinstance(e, InferenceError):
            _record_batch_error(model_name, "engine_error", telemetry)
        else:
            _record_batch_error(model_name, "engine_error", telemetry)
        for fut in futures:
            if not fut.done():
                if isinstance(e, asyncio.TimeoutError):
                    fut.set_exception(InferenceError(f"{model_name} batch timeout: {e}"))
                else:
                    fut.set_exception(e)
        raise


def _record_batch_error(model_name, error_type, telemetry):
    if telemetry is not None:
        try:
            telemetry.record_batch_error(model_name, error_type)
            return
        except Exception:
            pass
    try:
        from src.infrastructure.metrics import record_batch_error

        record_batch_error(model_name, error_type)
    except Exception:
        pass
