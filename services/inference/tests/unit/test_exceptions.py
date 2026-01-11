from src.core.exceptions import (
    AIServiceException,
    ModelLoadError,
    InferenceError,
    InvalidInputError
)

def test_exceptions_inheritance():
    assert issubclass(ModelLoadError, AIServiceException)
    assert issubclass(InferenceError, AIServiceException)
    assert issubclass(InvalidInputError, AIServiceException)

def test_exception_instantiation():
    err = InferenceError("msg")
    assert str(err) == "msg"