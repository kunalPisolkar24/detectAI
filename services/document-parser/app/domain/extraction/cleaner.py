import re

class TextCleaner:
    @staticmethod
    def clean(text: str) -> str:
        if not text:
            return ""

        text = text.replace('\r\n', '\n').replace('\r', '\n')
        text = text.replace('\xa0', ' ').replace('\x0c', '')
        text = re.sub(r'(?i)page\s+\d+\s+of\s+\d+\n?', '', text)
        text = re.sub(r'\n\s*-\s*\d+\s*-\s*\n', '\n', text)

        text = re.sub(r'[ \t]+', ' ', text)
        lines = [line.strip() for line in text.split('\n')]
        text = '\n'.join(lines)

        text = re.sub(r'\n{3,}', '\n\n', text)

        return text.strip()
