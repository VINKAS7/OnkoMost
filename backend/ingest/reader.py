"""Read a medical report into ordered blocks + sections + header fields.

.docx is read directly (python-docx). PDFs/images go through Tesseract (Czech) if it is installed;
the sample data never needs OCR.
"""
from __future__ import annotations

import re
import tempfile
import unicodedata
from dataclasses import dataclass, field
from datetime import date
from pathlib import Path

import docx
import docx.table

from backend.ingest.convert import doc_to_docx, pdf_lines

W = "{http://schemas.openxmlformats.org/wordprocessingml/2006/main}"

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


@dataclass
class DocText:
    blocks: list[Block]
    header: dict
    sections: dict[str, str]  # heading -> text
    title: str

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


def read_docx(path: Path) -> list[Block]:
    d = docx.Document(str(path))
    blocks: list[Block] = []
    for el in d.element.body.iterchildren():
        tag = el.tag.split("}")[1]
        if tag == "p":
            t = "".join(x.text or "" for x in el.iter(W + "t")).strip()
            if t:
                blocks.append(Block("p", re.sub(r"[ \t]+", " ", t)))
        elif tag == "tbl":
            tb = docx.table.Table(el, d)
            rows = [[c.text.strip() for c in r.cells] for r in tb.rows]
            blocks.append(Block("table", rows=rows))
    return blocks


def read_ocr(path: Path) -> list[Block]:  # pragma: no cover - optional path
    try:
        import pytesseract
        from PIL import Image
    except ImportError as e:
        raise RuntimeError("OCR needs `pip install pytesseract pillow` and Tesseract with the 'ces' language pack") from e
    if path.suffix.lower() == ".pdf":
        raise RuntimeError("Scanned PDFs: convert pages to images first (pdftoppm) – not needed for the sample data")
    text = pytesseract.image_to_string(Image.open(path), lang="ces")
    return [Block("p", line.strip()) for line in text.splitlines() if line.strip()]


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
        if b.kind == "p" and _is_heading(b.text):
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


def read_document(path: Path) -> DocText:
    suffix = path.suffix.lower()
    if suffix == ".docx":
        blocks = read_docx(path)
    elif suffix == ".doc":  # legacy Word → .docx via LibreOffice (ingest/convert.py)
        with tempfile.TemporaryDirectory() as d:
            blocks = read_docx(doc_to_docx(path, Path(d)))
    elif suffix == ".pdf" and (lines := pdf_lines(path)):
        blocks = [Block("p", line) for line in lines]  # text-layer PDF; scanned PDFs fall through to OCR
    elif suffix in {".png", ".jpg", ".jpeg", ".tif", ".tiff", ".pdf"}:
        blocks = read_ocr(path)
    elif suffix == ".txt":
        blocks = [Block("p", line.strip()) for line in path.read_text(encoding="utf-8").splitlines() if line.strip()]
    else:
        raise ValueError(f"Unsupported file type: {suffix}")
    sections, title = _sections(blocks)
    return DocText(blocks=blocks, header=parse_header(blocks), sections=sections, title=title)
