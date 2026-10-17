"""PDF (text layer) and legacy Word .doc input for reader.read_document, using the poppler and LibreOffice
command-line tools (`pdftotext`, `soffice`) so no new Python dependency is needed. Scanned PDFs without a text
layer still need OCR (reader.read_ocr)."""
from __future__ import annotations

import re
import shutil
import subprocess
import tempfile
from pathlib import Path


def pdf_lines(path: Path) -> list[str]:
    """Text lines of a PDF in reading order; [] when it has no text layer."""
    if not shutil.which("pdftotext"):
        raise RuntimeError("PDF needs `pdftotext` (apt install poppler-utils)")
    out = subprocess.run(["pdftotext", "-layout", "-enc", "UTF-8", str(path), "-"], capture_output=True, timeout=60,
                         check=True).stdout.decode("utf-8", "replace")
    # -layout keeps table columns apart; collapse the padding inside a line
    return [re.sub(r" {2,}", "  ", line).strip() for line in out.splitlines() if line.strip()]


def doc_to_docx(path: Path, out_dir: Path) -> Path:
    """Convert a legacy .doc to .docx with LibreOffice (headless)."""
    soffice = shutil.which("soffice") or shutil.which("libreoffice")
    if not soffice:
        raise RuntimeError(".doc needs LibreOffice (soffice) – or save the file as .docx")
    with tempfile.TemporaryDirectory() as profile:  # own profile: works while a desktop LibreOffice is open
        subprocess.run([soffice, f"-env:UserInstallation=file://{profile}", "--headless", "--convert-to", "docx",
                        "--outdir", str(out_dir), str(path)], capture_output=True, timeout=120, check=True)
    out = out_dir / f"{path.stem}.docx"
    if not out.is_file():
        raise RuntimeError(f"LibreOffice could not convert {path.name}")
    return out
