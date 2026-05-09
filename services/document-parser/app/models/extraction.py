from pydantic import BaseModel

class ExtractionResponse(BaseModel):
    filename: str
    content_type: str
    text_length: int
    text: str

class HealthCheck(BaseModel):
    status: str
