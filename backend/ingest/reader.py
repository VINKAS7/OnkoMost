"""Read a medical report into ordered blocks + sections + header fields.

Docling reads Word, PDF (through PDFium), scans and photos (EasyOCR, Czech): headings, paragraphs and real tables in
reading order, plus a Markdown version for the LLM. CT / MRI image series are DICOM and never come here
(backend/ingest/dicom.py).
"""
from __future__ import annotations

import re
import threading
import unicodedata
from dataclasses import dataclass, field
from datetime import date
from pathlib import Path

DATE_RE = r"(\d{1,2})\.\s*(\d{1,2})\.\s*(\d{4})"
TITLE_RE = r"(?:doc\.\s*)?(?:MUDr\.|Mgr\.|Ing\.|RNDr\.|Bc\.|PhDr\.|prof\.)"


def parse_date(text: str) -> date | None:
    m = re.search(DATE_RE, text)
    if not m:
        return None
    d, mth, y = (int(x) for x in m.groups())
    try:
        return date(y, mth, d)
    except ValueError:
        return None


def all_dates(text: str) -> list[tuple[date, int, int]]:
    out = []
    for m in re.finditer(DATE_RE, text):
        d, mth, y = (int(x) for x in m.groups())
        try:
            out.append((date(y, mth, d), m.start(), m.end()))
        except ValueError:
            pass
    return out


def fold(text: str) -> str:
    """Lowercase + strip diacritics, for matching."""
    return "".join(c for c in unicodedata.normalize("NFKD", text.lower()) if not unicodedata.combining(c))


@dataclass
class Block:
    kind: str  # "p" | "table"
    text: str = ""
    rows: list[list[str]] = field(default_factory=list)
    section: str = ""
    heading: bool = False  # Docling recognised it as a section heading (any letter case)


@dataclass
class DocText:
    blocks: list[Block]
    header: dict
    sections: dict[str, str]  # heading -> text
    title: str
    markdown: str = ""  # Docling's Markdown (headings, tables) – what the LLM reads

    @property
    def full_text(self) -> str:
        parts = []
        for b in self.blocks:
            if b.kind == "p":
                parts.append(b.text)
            else:
                parts.extend(" | ".join(r) for r in b.rows)
        return "\n".join(parts)

    def section(self, *names: str) -> str:
        """First section whose folded heading starts with any of `names` (folded)."""
        for want in names:
            fw = fold(want)
            for head, text in self.sections.items():
                if fold(head).startswith(fw):
                    return text
        return ""

    def tables(self) -> list[tuple[str, list[list[str]]]]:
        out, last_p = [], ""
        for b in self.blocks:
            if b.kind == "p":
                last_p = b.text
            else:
                out.append((last_p, b.rows))
        return out


def _is_heading(text: str) -> bool:
    letters = [c for c in text if c.isalpha()]
    return bool(letters) and len(text) <= 90 and all(c.isupper() for c in letters) and len(letters) >= 3


_converter = None
_converter_lock = threading.Lock()


def _docling():
    """One Docling converter per process: loading its layout / table / OCR models takes ~50 s on a CPU, a document
    afterwards a few seconds. The models live in storage/docling-models (downloaded on first use) – a plain folder,
    because Hugging Face's cache needs symlinks, which Windows only allows in Developer Mode."""
    global _converter
    with _converter_lock:
        if _converter is None:
            from docling.backend.pypdfium2_backend import PyPdfiumDocumentBackend
            from docling.datamodel.base_models import InputFormat
            from docling.datamodel.pipeline_options import EasyOcrOptions, PdfPipelineOptions
            from docling.document_converter import DocumentConverter, ImageFormatOption, PdfFormatOption
            from docling.utils.model_downloader import download_models

            from backend.config import settings
            models = settings.docling_models_dir
            if not (models / "EasyOcr").is_dir():
                download_models(models, with_layout=True, with_tableformer=True, with_easyocr=True,
                                with_code_formula=False, with_picture_classifier=False)
            opts = PdfPipelineOptions(
                artifacts_path=models, do_table_structure=True, do_ocr=True,  # OCR only where a page has no text
                ocr_options=EasyOcrOptions(lang=["cs", "en"], model_storage_directory=str(models / "EasyOcr"),
                                           download_enabled=False))
            # PDFium decodes the Czech letters of PDFs with old Mac font encodings, Docling's own parser does not
            _converter = DocumentConverter(format_options={
                InputFormat.PDF: PdfFormatOption(pipeline_options=opts, backend=PyPdfiumDocumentBackend),
                InputFormat.IMAGE: ImageFormatOption(pipeline_options=opts)})
        return _converter


def read_docling(path: Path) -> tuple[list[Block], str]:
    """Word, PDF, scans and photos → blocks in reading order (headings marked, tables as rows) + Markdown for the LLM."""
    from docling_core.types.doc import GroupItem, GroupLabel, TableItem, TextItem
    doc = _docling().convert(str(path)).document
    blocks: list[Block] = []

    def walk(node) -> None:
        for ref in node.children:
            item = ref.resolve(doc)
            if isinstance(item, GroupItem) and item.label == GroupLabel.INLINE:
                # "Pacientka:" + "Alena Procházková, RČ …" are one line of the document
                text = " ".join(t.text.strip() for t in (c.resolve(doc) for c in item.children)
                                if isinstance(t, TextItem) and t.text.strip())
                if text:
                    blocks.append(Block("p", re.sub(r"[ \t]+", " ", text)))
            elif isinstance(item, GroupItem):
                walk(item)
            elif isinstance(item, TableItem):
                blocks.append(Block("table", rows=[[c.text.strip() for c in row] for row in item.data.grid]))
            elif isinstance(item, TextItem):
                label = item.label.value
                if label not in ("page_header", "page_footer") and item.text.strip():
                    blocks.append(Block("p", re.sub(r"[ \t]+", " ", item.text.strip()),
                                        heading=label in ("section_header", "title")))
                if item.children:
                    walk(item)

    walk(doc.body)
    markdown = re.sub(r"\*\*(.+?)\*\*|(?<!\w)\*(?!\s)(.+?)(?<!\s)\*(?!\w)", lambda m: m.group(1) or m.group(2),
                      doc.export_to_markdown())  # bold / italic markers only distract the model
    if sum(len(b.text) + sum(len(c) for r in b.rows for c in r) for b in blocks) < 40:
        raise ValueError("Z dokumentu se nepodařilo přečíst žádný text / Could not read any text from this document")
    return blocks, markdown


HEADER_PATTERNS = {
    "patient_name": r"^Pacient(?:ka)?:\s*([^,\n]+)",
    "rc": r"(?:Rodné číslo:|RČ)\s*(\d{6}/\d{3,4})",
    "insurer": r"(?:Zdravotní pojišťovna:|ZP)\s*(\d{3})\b",
    "dob": r"^Datum narození:\s*(" + DATE_RE + ")",
    "address": r"^Bydliště:\s*(.+)$",
    "phone": r"^Telefon:\s*(\+?[\d ]{9,})",
    "contact_person": r"^Kontaktní osoba:\s*(.+)$",
    "indicating_doctor": r"^(?:Indikující lékař|Odesílající lékař|Odesílající):\s*(.+)$",
    "addressee": r"^Adresát:\s*(.+)$",
}

# Which date is "the" date of a report, in priority order.
DATE_KEYS = [r"^Datum výkonu:", r"^Datum vyšetření:", r"^Datum vydání:", r"^Datum:", r"^Odběr:", r"^Vydáno:", r"\bdne\b"]


def parse_header(blocks: list[Block]) -> dict:
    paras = [b.text for b in blocks if b.kind == "p"]
    h: dict = {}
    for line in paras:
        for key, pat in HEADER_PATTERNS.items():
            if key in h:
                continue
            m = re.search(pat, line)
            if m:
                h[key] = m.group(1).strip()
    if "dob" in h:
        h["dob"] = parse_date(h["dob"])
    for key in DATE_KEYS:
        hit = next((parse_date(line) for line in paras if re.search(key, line) and parse_date(line)), None)
        if hit:
            h["doc_date"] = hit
            break
    # Facility = first line after the "FIKTIVNÍ PACIENTKA" banner (or first line).
    start = 1 if paras and fold(paras[0]).startswith("fiktivni") else 0
    if len(paras) > start:
        h["facility"] = re.sub(r"\s*\(fiktivní\)", "", paras[start]).strip()
        h["facility_lines"] = [re.sub(r"\s*\(fiktivní\)", "", p) for p in paras[start:start + 4]]
    # Author = last line that starts with an academic title, before any "Kopie:" line.
    signers = [p for p in paras if re.match(TITLE_RE, p) and not p.startswith("Kopie")]
    if signers:
        h["author"] = signers[-1].strip()
        idx = paras.index(signers[-1])
        if idx + 1 < len(paras) and not re.match(TITLE_RE, paras[idx + 1]) and not paras[idx + 1].startswith("Kopie"):
            h["author_role"] = paras[idx + 1].split(",")[0].strip()
    m = re.search(r"Tel\.?:\s*(\+?[\d ]{9,})", "\n".join(paras[:6]))
    if m:
        h["facility_phone"] = m.group(1).strip()
    return h


def _sections(blocks: list[Block]) -> tuple[dict[str, str], str]:
    sections: dict[str, list[str]] = {}
    current = "_header"
    title = ""
    footer = re.compile(r"^(V\s.+\sdne\s|Datum:\s|Vydal:|Vydáno:|Kopie:)")
    for b in blocks:
        if b.kind == "p" and (b.heading or _is_heading(b.text)):
            current = b.text
            sections.setdefault(current, [])
        elif b.kind == "p" and current not in ("_header", "_footer") and footer.match(b.text):
            # Place/date/signature lines at the end of a report are not part of the last section.
            current = "_footer"
            sections.setdefault(current, []).append(b.text)
        else:
            if b.kind == "p":
                sections.setdefault(current, []).append(b.text)
            else:
                sections.setdefault(current, []).extend(" | ".join(r) for r in b.rows)
        b.section = current
    # Title: the line that names the report type (first non-banner paragraph after the facility block that
    # contains a typical report word).
    for b in blocks:
        if b.kind == "p" and re.search(r"zpráva|Výsled|Epikríza|Protokol|Bioptický|žádost|Zápis", b.text, re.I) and len(b.text) < 120:
            title = b.text
            break
    return {k: "\n".join(v) for k, v in sections.items()}, title


DOCLING_SUFFIXES = {".docx", ".pdf", ".png", ".jpg", ".jpeg", ".tif", ".tiff"}


def read_document(path: Path) -> DocText:
    suffix = path.suffix.lower()
    if suffix in DOCLING_SUFFIXES:
        blocks, markdown = read_docling(path)
    elif suffix == ".txt":
        blocks = [Block("p", line.strip()) for line in path.read_text(encoding="utf-8").splitlines() if line.strip()]
        markdown = "\n".join(b.text for b in blocks)
    else:
        raise ValueError(f"Unsupported file type: {suffix}")
    sections, title = _sections(blocks)
    return DocText(blocks=blocks, header=parse_header(blocks), sections=sections, title=title, markdown=markdown)
