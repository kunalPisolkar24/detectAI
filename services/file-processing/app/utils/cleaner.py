import re

class TextCleaner:
    @staticmethod
    def clean(text: str) -> str:
        if not text:
            return ""

        # Remove page numbers like "Page 1 of 10" or "- 5 -"
        text = re.sub(r'(?i)page\s+\d+\s+of\s+\d+', '', text)
        text = re.sub(r'\n\s*-\s*\d+\s*-\s*\n', '\n', text)
        
        # Remove null bytes
        text = text.replace('\x00', '')
        
        # Collapse excessive whitespace and newlines
        text = re.sub(r'\n{3,}', '\n\n', text)
        text = re.sub(r'[ \t]{2,}', ' ', text)
        
        return text.strip()