class AIServiceException(Exception):
    pass

class ModelLoadError(AIServiceException):
    pass

class InferenceError(AIServiceException):
    pass

class InvalidInputError(AIServiceException):
    pass