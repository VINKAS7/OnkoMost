"""CT images (offline): grouping slices into series, the identity rules for images, and the viewer's rendering."""
import io
import random
import zipfile
from datetime import date

import numpy as np
import pydicom
from PIL import Image
from pydicom.dataset import Dataset, FileMetaDataset
from pydicom.uid import CTImageStorage, ExplicitVRLittleEndian, generate_uid

from backend.ingest import dicom
from backend.ingest.identity import NO_IDENTITY_IN_IMAGES, check_dicom_identity

STUDY = generate_uid()


def _slice(series: str, z: float, number: int, name: str = "LUNG1-001", removed: bool = True,
           birth: str | None = None, hu: int = 0) -> bytes:
    ds = Dataset()
    ds.file_meta = FileMetaDataset()
    ds.file_meta.TransferSyntaxUID = ExplicitVRLittleEndian
    ds.file_meta.MediaStorageSOPClassUID = CTImageStorage
    ds.file_meta.MediaStorageSOPInstanceUID = uid = generate_uid()
    ds.SOPClassUID, ds.SOPInstanceUID = CTImageStorage, uid
    ds.Modality, ds.StudyInstanceUID, ds.SeriesInstanceUID = "CT", STUDY, series
    ds.StudyDate, ds.BodyPartExamined, ds.Manufacturer = "20260915", "CHEST", "TEST"
    ds.PatientName, ds.PatientID = name, "X1"
    if birth:
        ds.PatientBirthDate = birth
    if removed:
        ds.PatientIdentityRemoved = "YES"
    ds.ImagePositionPatient, ds.InstanceNumber, ds.SliceThickness = [0, 0, z], number, 3
    ds.Rows = ds.Columns = 8
    ds.SamplesPerPixel, ds.PhotometricInterpretation = 1, "MONOCHROME2"
    ds.BitsAllocated, ds.BitsStored, ds.HighBit, ds.PixelRepresentation = 16, 12, 11, 0
    ds.RescaleSlope, ds.RescaleIntercept = 1, -1024
    ds.PixelData = np.full((8, 8), hu + 1024, dtype=np.uint16).tobytes()
    out = io.BytesIO()
    ds.save_as(out, enforce_file_format=True)
    return out.getvalue()


def test_slices_are_grouped_into_series_and_sorted_head_to_feet():
    a, b = generate_uid(), generate_uid()
    files = [(f"a{i}.dcm", _slice(a, z, i)) for i, z in enumerate([-10, 20, 5], 1)]
    files += [(f"IM{i}", _slice(b, z, i)) for i, z in enumerate([0, 3], 1)]  # no extension: found by the DICM marker
    files += [("LICENSE", b"CC BY-NC"), ("zprava.docx", b"PK..")]
    random.Random(1).shuffle(files)
    reports, series, skipped = dicom.split(files)
    assert [n for n, _ in reports] == ["zprava.docx"] and skipped == ["LICENSE"]
    by_uid = {s.meta["series_uid"]: s for s in series}
    assert sorted(s.meta["slices"] for s in series) == [2, 3]
    first = by_uid[a]
    assert first.filename == "CT_CHEST_2026-09-15_3slices.dcm.zip"
    assert first.meta["exam_type"] == "ct" and first.meta["study_date"] == date(2026, 9, 15)
    assert first.meta["identity_removed"] and first.meta["patient_name"] == "LUNG1-001"
    # head first: z 20, 5, -10 → instance numbers 2, 3, 1
    assert [i["number"] for i in first.meta["instances"]] == [1, 2, 3]
    with zipfile.ZipFile(io.BytesIO(first.data)) as z:
        zs = [float(pydicom.dcmread(io.BytesIO(z.read(n))).ImagePositionPatient[2]) for n in sorted(z.namelist())]
    assert zs == [20, 5, -10]


def test_identity_rules_for_images():
    meta = lambda **kw: {"patient_name": "", "identity_removed": False, "birth_date": None, **kw}  # noqa: E731
    pseudonym = check_dicom_identity(meta(patient_name="LUNG1-131", identity_removed=True), "Josef Král", date(1955, 8, 14))
    assert pseudonym["ok"] and pseudonym["issues"] == [NO_IDENTITY_IN_IMAGES]
    same = check_dicom_identity(meta(patient_name="KRAL^JOSEF"), "Josef Král", None)
    assert same["ok"] and same["matched_on"] == ["name"] and not same["issues"]
    other = check_dicom_identity(meta(patient_name="Novak^Petr"), "Josef Král", None)
    assert not other["ok"] and "Novak Petr" in other["issues"][0]
    born = check_dicom_identity(meta(birth_date=date(1960, 1, 1)), "Josef Král", date(1955, 8, 14))
    assert not born["ok"]


def test_render_uses_the_window(tmp_path):
    series = generate_uid()
    s = dicom.group_series([(f"{i}.dcm", _slice(series, float(i), i, hu=0)) for i in range(3)])[0]
    path = tmp_path / s.filename
    path.write_bytes(s.data)
    assert dicom.series_meta(path)["slices"] == 3
    grey = {w: np.asarray(Image.open(io.BytesIO(dicom.render(str(path), 1, w))))[0, 0] for w in dicom.WINDOWS}
    # water (0 HU) is bright in the lung window, mid-grey in the soft-tissue window, dark in the bone window
    assert grey["lung"] > grey["soft"] > grey["bone"]
