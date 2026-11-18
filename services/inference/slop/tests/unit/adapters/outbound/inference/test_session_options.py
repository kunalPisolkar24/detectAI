import onnxruntime as ort
import pytest

from src.adapters.outbound.inference.loading.session_options import (
    build_session_options,
)


def test_build_session_options_defaults():
    options = build_session_options()

    assert options.intra_op_num_threads == 1
    assert options.inter_op_num_threads == 1
    assert options.graph_optimization_level == ort.GraphOptimizationLevel.ORT_ENABLE_ALL
    assert options.execution_mode == ort.ExecutionMode.ORT_SEQUENTIAL


def test_build_session_options_zero_threads_keeps_ort_default():
    default = ort.SessionOptions()
    options = build_session_options(intra_op_threads=0, inter_op_threads=0)

    assert options.intra_op_num_threads == default.intra_op_num_threads
    assert options.inter_op_num_threads == default.inter_op_num_threads


def test_build_session_options_parallel_and_basic():
    options = build_session_options(execution_mode="parallel", graph_opt_level="basic")

    assert options.execution_mode == ort.ExecutionMode.ORT_PARALLEL
    assert options.graph_optimization_level == ort.GraphOptimizationLevel.ORT_ENABLE_BASIC


@pytest.mark.parametrize("kwargs", [
    {"intra_op_threads": -1},
    {"inter_op_threads": -1},
    {"graph_opt_level": "turbo"},
    {"execution_mode": "sideways"},
])
def test_build_session_options_rejects_invalid(kwargs):
    with pytest.raises(ValueError):
        build_session_options(**kwargs)
