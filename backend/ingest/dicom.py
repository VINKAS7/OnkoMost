"""CT / MRI / PET images (DICOM): one uploaded series becomes one document.

A scanner exports one file per slice, so a single CT is 100+ files. They are grouped by series, sorted head to feet
and packed into one zip (`<modality>_<body part>_<date>_<n>slices.dcm.zip`) that is stored like any other upload.
Only the headers are read on upload; slices are decoded when the viewer asks for them.
"""
from __future__ import annotations

import io
import re
import zipfile
from dataclasses import dataclass, field
from datetime import date
from functools import lru_cache
from pathlib import Path

import numpy as np
import pydicom
from PIL import Image

SUFFIX = ".dcm.zip"
# window level / width in Hounsfield units, as radiologists use them for a chest CT
WINDOWS = {"lung": (-600, 1500), "soft": (40, 400), "bone": (400, 1800)}
EXAM_TYPE = {"CT": "ct", "MR": "mri", "PT": "pet_ct"}


@dataclass
class Series:
    filename: str
    data: bytes
    meta: dict = field(default_factory=dict)


def is_dicom(name: str, data: bytes) -> bool:
    return name.lower().endswith((".dcm", ".dicom")) or data[128:132] == b"DICM"


def _expand(files: list[tuple[str, bytes]]) -> list[tuple[str, bytes]]:
    """A .zip upload counts as the files inside it."""
    out = []
    for name, data in files:
        if name.lower().endswith(".zip") and not name.lower().endswith(SUFFIX):
            with zipfile.ZipFile(io.BytesIO(data)) as z:
                out += [(n, z.read(n)) for n in z.namelist() if not n.endswith("/")]
        else:
            out.append((name, data))
    return out


REPORT_SUFFIXES = {".docx", ".pdf", ".png", ".jpg", ".jpeg", ".tif", ".tiff", ".txt"}


def split(files: list[tuple[str, bytes]]) -> tuple[list[tuple[str, bytes]], list[Series], list[str]]:
    """Uploaded files → (reports, image series, skipped names). A CT folder or zip usually carries extras such as a
    LICENSE or DICOMDIR; next to images, only files that are reports are kept."""
    docs, images = [], []
    for name, data in _expand(files):
        (images if is_dicom(name, data) else docs).append((name, data))
    skipped = [n for n, _ in docs if images and Path(n).suffix.lower() not in REPORT_SUFFIXES]
    docs = [(n, d) for n, d in docs if n not in skipped]
    return docs, group_series(images), skipped


def _date(value) -> date | None:
    m = re.fullmatch(r"(\d{4})(\d{2})(\d{2})", str(value or "").strip())
    try:
        return date(int(m.group(1)), int(m.group(2)), int(m.group(3))) if m else None
    except ValueError:
        return None


def _meta(ds, slices: list) -> dict:
    first = slices[0][1]
    body = str(ds.get("BodyPartExamined") or "").strip()
    return {
        "modality": str(ds.get("Modality") or ""), "exam_type": EXAM_TYPE.get(str(ds.get("Modality") or ""), "imaging"),
        "study_uid": str(ds.get("StudyInstanceUID") or ""), "series_uid": str(ds.get("SeriesInstanceUID") or ""),
        "study_date": _date(ds.get("StudyDate") or ds.get("SeriesDate")), "body_part": body,
        "description": str(ds.get("SeriesDescription") or ds.get("StudyDescription") or "").strip(),
        "manufacturer": " ".join(str(x).strip() for x in (ds.get("Manufacturer"), ds.get("ManufacturerModelName")) if x),
        "slices": len(slices), "rows": int(first.get("Rows") or 0), "columns": int(first.get("Columns") or 0),
        "slice_thickness": float(ds.get("SliceThickness") or 0) or None,
        "patient_name": str(ds.get("PatientName") or "").strip(), "patient_id": str(ds.get("PatientID") or "").strip(),
        "birth_date": _date(ds.get("PatientBirthDate")),
        "identity_removed": str(ds.get("PatientIdentityRemoved") or "").strip().upper() == "YES",
        "instances": [{"uid": str(d.get("SOPInstanceUID") or ""), "sop_class": str(d.get("SOPClassUID") or ""),
                       "number": i + 1} for i, (_, d) in enumerate(slices)],
    }


def group_series(files: list[tuple[str, bytes]]) -> list[Series]:
    """DICOM slices → one Series per SeriesInstanceUID, sorted head to feet (then by instance number)."""
    by_series: dict[str, list] = {}
    for name, data in files:
        ds = pydicom.dcmread(io.BytesIO(data), stop_before_pixels=True, force=True)
        by_series.setdefault(str(ds.get("SeriesInstanceUID") or name), []).append((data, ds))
    out = []
    for slices in by_series.values():
        def order(item):
            pos = item[1].get("ImagePositionPatient")
            return (-float(pos[2]) if pos else 0.0, int(item[1].get("InstanceNumber") or 0))
        slices.sort(key=order)
        meta = _meta(slices[0][1], slices)
        buf = io.BytesIO()
        with zipfile.ZipFile(buf, "w", zipfile.ZIP_STORED) as z:  # pixel data barely compresses; storing is faster
            for i, (data, _) in enumerate(slices):
                z.writestr(f"{i + 1:04d}.dcm", data)
        when = meta["study_date"].isoformat() if meta["study_date"] else "undated"
        body = re.sub(r"[^A-Za-z0-9]+", "-", meta["body_part"] or "series").strip("-")
        out.append(Series(f"{meta['modality'] or 'IMG'}_{body}_{when}_{len(slices)}slices{SUFFIX}", buf.getvalue(), meta))
    return out


def series_meta(path: Path) -> dict:
    """Meta of a stored series (headers only)."""
    with zipfile.ZipFile(path) as z:
        names = sorted(n for n in z.namelist() if n.endswith(".dcm"))
        slices = [(None, pydicom.dcmread(io.BytesIO(z.read(n)), stop_before_pixels=True, force=True)) for n in names]
    return _meta(slices[0][1], slices)


@lru_cache(maxsize=512)
def render(path: str, index: int, window: str = "lung") -> bytes:
    """One slice as a greyscale PNG in the given window (lung / soft / bone)."""
    with zipfile.ZipFile(path) as z:
        names = sorted(n for n in z.namelist() if n.endswith(".dcm"))
        ds = pydicom.dcmread(io.BytesIO(z.read(names[max(0, min(index, len(names) - 1))])), force=True)
    hu = ds.pixel_array.astype(np.float32) * float(ds.get("RescaleSlope") or 1) + float(ds.get("RescaleIntercept") or 0)
    level, width = WINDOWS.get(window, WINDOWS["lung"])
    img = np.clip((hu - (level - width / 2)) / width * 255.0, 0, 255).astype(np.uint8)
    out = io.BytesIO()
    Image.fromarray(img).save(out, format="PNG", optimize=False)
    return out.getvalue()
