class MLException(Exception):
    pass

class ArtifactNotFoundException(MLException):
    pass

class UploadFailedException(MLException):
    pass