_GPU_PROVIDERS = frozenset({"CUDAExecutionProvider", "TensorrtExecutionProvider", "ROCMExecutionProvider"})


def verify_providers(session, model_key: str, repo_id: str, revision: str, requested_providers: list[str], telemetry=None) -> None:
    requested_gpu = any(p in _GPU_PROVIDERS for p in requested_providers)
    active = session.get_providers()
    active_gpu = any(p in _GPU_PROVIDERS for p in active)

    if requested_gpu and not active_gpu:
        _log_gpu_fallback(model_key, repo_id, revision, requested_providers, active)
        _record_fallback(model_key, requested_providers, active, telemetry)
    else:
        _log_loaded(model_key, repo_id, revision, requested_providers, active)


def _log_gpu_fallback(model_key, repo_id, revision, requested, active):
    try:
        from src.adapters.outbound.inference.loader import logger

        logger.warning(
            "gpu_provider_unavailable_falling_back_to_cpu",
            model=model_key,
            repo_id=repo_id,
            revision=revision,
            requested=requested,
            active=active,
        )
        return
    except Exception:
        pass
    import structlog

    structlog.get_logger().warning(
        "gpu_provider_unavailable_falling_back_to_cpu",
        model=model_key,
        repo_id=repo_id,
        revision=revision,
        requested=requested,
        active=active,
    )


def _log_loaded(model_key, repo_id, revision, requested, active):
    try:
        from src.adapters.outbound.inference.loader import logger

        logger.info(
            "model_loaded",
            model=model_key,
            repo_id=repo_id,
            revision=revision,
            requested_providers=requested,
            active_providers=active,
        )
        return
    except Exception:
        pass
    import structlog

    structlog.get_logger().info(
        "model_loaded",
        model=model_key,
        repo_id=repo_id,
        revision=revision,
        requested_providers=requested,
        active_providers=active,
    )


def _record_fallback(model_key, requested, active, telemetry):
    if telemetry is not None:
        try:
            telemetry.record_provider_fallback(model_key, ",".join(requested), ",".join(active), "gpu_missing")
            return
        except Exception:
            pass
    try:
        from src.infrastructure.metrics import record_provider_fallback

        record_provider_fallback(model_key, ",".join(requested), ",".join(active), "gpu_missing")
    except Exception:
        pass
