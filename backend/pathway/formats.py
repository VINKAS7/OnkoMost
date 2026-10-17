"""Allowed upload formats for a pathway document step. Several values on one node mean OR."""

# key → extensions (without the dot)
FORMATS: dict[str, tuple[str, ...]] = {
    "pdf": ("pdf",),
    "docx": ("docx",),
    "doc": ("doc",),
    "dcm": ("dcm",),
    "dicom": ("dcm", "dicom"),
    "jpg": ("jpg",),
    "jpeg": ("jpeg",),
    "png": ("png",),
    "tiff": ("tif", "tiff"),
    # older saved graphs
    "odt": ("odt",),
    "rtf": ("rtf",),
    "xml": ("xml",),
    "hl7": ("hl7",),
    "any": (),
}

OFFICIAL_EXT = {e for k, exts in FORMATS.items() if k != "any" for e in exts}


def ext_of(filename: str) -> str:
    name = (filename or "").rsplit(".", 1)
    return name[-1].lower() if len(name) == 2 else ""


def format_ok(accepted: list[str] | None, filename: str) -> bool:
    """True if the file may be attached to a node. Empty or 'any' accepts every listed extension."""
    keys = [k for k in (accepted or []) if k in FORMATS]
    if not keys or "any" in keys:
        return True
    ext = ext_of(filename)
    if not ext:
        return True
    allowed = {e for k in keys for e in FORMATS[k]}
    return ext in allowed
