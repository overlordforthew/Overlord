---
name: document-reader
description: Extract text, summarize, search, and convert documents (PDF, XLSX, CSV, DOCX, TXT, JSON).
metadata: {"clawdbot":{"emoji":"D","requires":{"bins":["python3","pdftotext"],"pip":["openpyxl","python-docx","PyPDF2"]}}}
---

# document-reader

Read, summarize, search, and convert documents from the command line. Supports PDF, XLSX, CSV, DOCX, TXT, and JSON.

## Quick start

```bash
# Extract text from a PDF
/root/overlord/skills/document-reader/scripts/doc-reader.py read report.pdf

# AI summary of a spreadsheet
/root/overlord/skills/document-reader/scripts/doc-reader.py summary data.xlsx

# Search for a term in a DOCX
/root/overlord/skills/document-reader/scripts/doc-reader.py search contract.docx "payment terms"

# Show file metadata (type, size, pages/rows/sheets)
/root/overlord/skills/document-reader/scripts/doc-reader.py info invoice.pdf

# Convert a PDF to plain text
/root/overlord/skills/document-reader/scripts/doc-reader.py convert report.pdf --to txt
```

## Commands

| Command | Description |
|---------|-------------|
| `read <file>` | Extract and print text (auto-detects type) |
| `summary <file>` | Extract text and generate AI summary via `llm` CLI |
| `search <file> <query>` | Case-insensitive text search within a document |
| `info <file>` | File metadata: type, size, pages/sheets/rows |
| `convert <file> --to txt` | Convert document to plain text file |

## Supported formats

- **PDF** — via `pdftotext` (poppler-utils), falls back to PyPDF2
- **XLSX** — via openpyxl (shows sheet names, first 20 rows per sheet)
- **CSV** — via Python built-in csv module
- **DOCX** — via python-docx
- **TXT / JSON** — direct read

## Notes

- Missing pip packages (openpyxl, python-docx, PyPDF2) are auto-installed on first run.
- The `summary` command truncates to ~3000 chars before sending to the LLM.
- The `search` command is case-insensitive and reports matching line numbers.
