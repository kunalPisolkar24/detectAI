import fitz
import docx
import io
from fastapi import UploadFile
from app.config import settings

class FileExtractor:
    
    @staticmethod
    def extract_pdf(file_bytes: bytes) -> str:
        text_content = []
        total_length = 0
        
        try:
            with fitz.open(stream=file_bytes, filetype="pdf") as doc:
                for page in doc:
                    text = page.get_text()
                    text_content.append(text)
                    total_length += len(text)
                    
                    if total_length > settings.MAX_TEXT_LENGTH:
                        break
                        
            return "\n".join(text_content)
        except Exception as e:
            raise ValueError(f"PDF processing failed: {str(e)}")

    @staticmethod
    def extract_docx(file_bytes: bytes) -> str:
        try:
            doc = docx.Document(io.BytesIO(file_bytes))
            text_content = []
            total_length = 0
            
            for para in doc.paragraphs:
                text = para.text
                if text.strip():
                    text_content.append(text)
                    total_length += len(text)
                
                if total_length > settings.MAX_TEXT_LENGTH:
                    break
            
            return "\n".join(text_content)
        except Exception as e:
            raise ValueError(f"DOCX processing failed: {str(e)}")

    @staticmethod
    def extract_txt(file_bytes: bytes) -> str:
        try:
            return file_bytes.decode('utf-8')
        except UnicodeDecodeError:
            try:
                return file_bytes.decode('latin-1')
            except Exception as e:
                raise ValueError(f"Text decoding failed: {str(e)}")

    @classmethod
    def process(cls, file: UploadFile, content: bytes) -> str:
        mime = file.content_type
        
        if mime == "application/pdf":
            return cls.extract_pdf(content)
        elif mime == "application/vnd.openxmlformats-officedocument.wordprocessingml.document":
            return cls.extract_docx(content)
        elif mime == "text/plain":
            return cls.extract_txt(content)
        else:
            raise ValueError("Unsupported file type for extraction")