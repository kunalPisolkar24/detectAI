# Text Cleaning

This document explains how the Document Parser service cleans and normalizes extracted text. Cleaning ensures consistent, readable output regardless of the source format.

## Why Clean Text?

Raw text extracted from documents often contains noise:

- **Inconsistent line endings** -- `\r\n` (Windows) vs `\n` (Unix) vs `\r` (old Mac)
- **Control characters** -- invisible characters that cause display issues
- **Hyphenated line breaks** -- words split across lines like `infor- mation`
- **Excessive whitespace** -- multiple spaces, tabs, trailing spaces
- **Too many blank lines** -- 3, 4, or more consecutive newlines

Cleaning removes this noise so the output is consistent and readable.

## What TextCleaner Does

The `TextCleaner` processes text through these steps:

```mermaid
graph TB
    A[Raw text] --> B[Normalize line endings<br/>\\r\\n -> \\n]
    B --> C[Strip control/invisible chars]
    C --> D[Fix hyphenated line breaks<br/>infor-\\nmation -> information]
    D --> E[Deduplicate spaces<br/>multi-space -> single space]
    E --> F[Collapse excessive newlines<br/>\\n3+ -> \\n\\n]
    F --> G[Clean text]
```

### Step 1: Normalize Line Endings

Converts all line endings to Unix format (`\n`):

```
Before: Hello\r\nWorld\r\n
After:  Hello\nWorld\n
```

### Step 2: Strip Control Characters

Removes invisible characters that don't carry meaning:

- ASCII control codes (except `\n` and `\t`)
- Zero-width characters
- Other invisible Unicode characters

### Step 3: Fix Hyphenated Line Breaks

When a word is split across lines with a hyphen, it's rejoined:

```
Before: The quick brown fo-
        x jumped over the lazy dog.
After:  The quick brown fox jumped over the lazy dog.
```

### Step 4: Deduplicate Spaces

Multiple consecutive spaces are collapsed to a single space:

```
Before: Hello    world    from     me
After:  Hello world from me
```

### Step 5: Collapse Excessive Newlines

More than 2 consecutive newlines are reduced to 2:

```
Before: Hello



        World
After:  Hello


        World
```

## Before and After Example

**Raw extracted text:**
```
Page 1\r\n
\r\n
The quick brown fox   jumped over\r\n
the lazy dog.\r\n
\r\n
\r\n
\r\n
infor-\rmation\r\n
```

**After cleaning:**
```
The quick brown fox jumped over
the lazy dog.


information
```

## Where Cleaning Happens

Cleaning is the **last step** in the extraction pipeline:

```mermaid
graph LR
    A[File] --> B[Strategy.extract]
    B --> C[TextCleaner.clean]
    C --> D[ExtractionResponse]
```

Every extraction -- whether PDF, DOCX, or TXT -- passes through `TextCleaner.clean()` before the response is returned.

## Configuration

Text cleaning behavior is **hardcoded** and does not need configuration. The cleaning rules are designed to produce good output for all supported formats.

If you need different cleaning behavior, modify `app/domain/cleaner.py`.

## Related Documentation

- [Extraction Strategies](extraction-strategies.md) - How raw text is extracted
- [Architecture](architecture.md) - How the pipeline fits together
- [Configuration](../getting-started/configuration.md) - Service settings
