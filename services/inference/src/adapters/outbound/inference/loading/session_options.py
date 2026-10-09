import onnxruntime as ort

_GRAPH_OPT_LEVELS = {
    "disabled": ort.GraphOptimizationLevel.ORT_DISABLE_ALL,
    "basic": ort.GraphOptimizationLevel.ORT_ENABLE_BASIC,
    "extended": ort.GraphOptimizationLevel.ORT_ENABLE_EXTENDED,
    "all": ort.GraphOptimizationLevel.ORT_ENABLE_ALL,
}

_EXECUTION_MODES = {
    "sequential": ort.ExecutionMode.ORT_SEQUENTIAL,
    "parallel": ort.ExecutionMode.ORT_PARALLEL,
}


def build_session_options(
    intra_op_threads: int = 1,
    inter_op_threads: int = 1,
    graph_opt_level: str = "all",
    execution_mode: str = "sequential",
    enable_mem_pattern: bool = True,
    enable_cpu_arena: bool = True,
) -> ort.SessionOptions:
    if intra_op_threads < 0:
        raise ValueError("intra_op_threads must be >= 0 (0 leaves the ORT default)")
    if inter_op_threads < 0:
        raise ValueError("inter_op_threads must be >= 0 (0 leaves the ORT default)")
    if graph_opt_level not in _GRAPH_OPT_LEVELS:
        raise ValueError(f"Unknown graph_opt_level: {graph_opt_level!r}. Allowed: {sorted(_GRAPH_OPT_LEVELS)}")
    if execution_mode not in _EXECUTION_MODES:
        raise ValueError(f"Unknown execution_mode: {execution_mode!r}. Allowed: {sorted(_EXECUTION_MODES)}")

    options = ort.SessionOptions()
    if intra_op_threads > 0:
        options.intra_op_num_threads = intra_op_threads
    if inter_op_threads > 0:
        options.inter_op_num_threads = inter_op_threads
    options.graph_optimization_level = _GRAPH_OPT_LEVELS[graph_opt_level]
    options.execution_mode = _EXECUTION_MODES[execution_mode]
    options.enable_mem_pattern = enable_mem_pattern
    options.enable_cpu_mem_arena = enable_cpu_arena
    return options
