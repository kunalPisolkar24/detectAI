from src.domain.exceptions import (
    AIServiceException,
    InferenceError,
    InvalidInputError,
    ModelLoadError,
)

def test_exceptions_inheritance():
    assert issubclass(ModelLoadError, AIServiceException)
    assert issubclass(InferenceError, AIServiceException)
    assert issubclass(InvalidInputError, AIServiceException)

def test_exception_instantiation():
    err = InferenceError("msg")
    assert str(err) == "msg"