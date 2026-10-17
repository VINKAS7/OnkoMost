"""Patient-identifying data lives only in the FHIR server.

  Patient            id = patient_uuid (pseudonym used everywhere else): name, RČ, birth date, sex, insurer,
                     address, phone
  RelatedPerson      contact persons (name, relation, phone) with the sentence they were read from
  DocumentReference  every received document: metadata, the extracted text and the original file

The patient graph (IRIS globals), the GraphRAG chunks and the workflow database only keep the pseudonymous
patient_uuid and point here for identity.
"""
from __future__ import annotations

import base64
import hashlib
import mimetypes
import threading
import time
from datetime import date

from backend.fhir.client import fhir

RC_SYSTEM = "https://onkomost.cz/fhir/sid/rodne-cislo"
EXT = "https://onkomost.cz/fhir/StructureDefinition/"
GENDER = {"F": "female", "M": "male"}
SEX = {v: k for k, v in GENDER.items()}
MAX_ORIGINAL = 10 * 1024 * 1024  # larger originals stay only in storage/raw

_cache: dict[str, tuple[float, dict]] = {}
_cache_lock = threading.Lock()
TTL = 60.0


def _cached(key: str, load) -> dict:
    with _cache_lock:
        hit = _cache.get(key)
        if hit and time.monotonic() - hit[0] < TTL:
            return hit[1]
    value = load()
    with _cache_lock:
        _cache[key] = (time.monotonic(), value)
    return value


def _forget(key: str | None = None) -> None:
    with _cache_lock:
        if key is None:
            _cache.clear()
        else:
            _cache.pop(key, None)


def _ext(res: dict, name: str) -> str | None:
    return next((e.get("valueString") for e in res.get("extension", []) if e.get("url") == EXT + name), None)


def _rid(prefix: str, key: str) -> str:
    return f"{prefix}-{hashlib.sha1(key.encode()).hexdigest()}"


# -- Patient ---------------------------------------------------------------------------------------

def _patient_resource(uuid: str, p: dict) -> dict:
    res: dict = {"resourceType": "Patient", "id": uuid, "active": True}
    if p.get("rc"):
        res["identifier"] = [{"system": RC_SYSTEM, "value": p["rc"]}]
    if p.get("patient_name"):
        parts = p["patient_name"].split()
        name = {"use": "official", "text": p["patient_name"], "family": parts[-1]}
        if parts[:-1]:
            name["given"] = parts[:-1]
        res["name"] = [name]
    if p.get("sex") in GENDER:
        res["gender"] = GENDER[p["sex"]]
    if p.get("dob"):
        res["birthDate"] = p["dob"].isoformat() if isinstance(p["dob"], date) else str(p["dob"])
    if p.get("address"):
        res["address"] = [{"text": p["address"]}]
    if p.get("phone"):
        res["telecom"] = [{"system": "phone", "value": p["phone"]}]
    if p.get("insurer"):
        res["extension"] = [{"url": EXT + "insurer", "valueString": p["insurer"]}]
    return res


def _identity(res: dict | None) -> dict:
    if not res:
        return {}
    name = (res.get("name") or [{}])[0]
    out = {
        "uuid": res["id"], "fhir_id": f"Patient/{res['id']}",
        "patient_name": name.get("text") or " ".join([*name.get("given", []), name.get("family", "")]).strip(),
        "rc": next((i["value"] for i in res.get("identifier", []) if i.get("system") == RC_SYSTEM), None),
        "dob": date.fromisoformat(res["birthDate"]) if res.get("birthDate") else None,
        "sex": SEX.get(res.get("gender", "")),
        "address": (res.get("address") or [{}])[0].get("text"),
        "phone": next((t["value"] for t in res.get("telecom", []) if t.get("system") == "phone"), None),
        "insurer": _ext(res, "insurer"),
    }
    return {k: v for k, v in out.items() if v not in (None, "")}


def identity(uuid: str) -> dict:
    """{uuid, patient_name, rc, dob, sex, address, phone, insurer} – {} when the patient is not on the server."""
    return _cached(f"Patient/{uuid}", lambda: _identity(fhir.read("Patient", uuid)))


def upsert_patient(uuid: str, props: dict) -> dict:
    """Merge the given identity fields (None = keep) into the Patient resource."""
    current = _identity(fhir.read("Patient", uuid))
    merged = {**current, **{k: v for k, v in props.items() if v not in (None, "")}}
    if merged != current:
        fhir.put(_patient_resource(uuid, merged))
    _forget(f"Patient/{uuid}")
    return merged


def delete_patient(uuid: str) -> None:
    for rtype in ("DocumentReference", "RelatedPerson"):
        for res in list(fhir.search(rtype, patient=uuid, _elements="id")):
            fhir.delete(rtype, res["id"])
    fhir.delete("Patient", uuid)
    _forget()


# -- RelatedPerson (contact persons) --------------------------------------------------------------

def contact_ref(fact_id: str) -> str:
    return f"RelatedPerson/{_rid('cp', fact_id)}"


def upsert_contact(uuid: str, fact_id: str, props: dict, quote: str) -> str:
    rid = _rid("cp", fact_id)
    res: dict = {"resourceType": "RelatedPerson", "id": rid, "active": True, "patient": {"reference": f"Patient/{uuid}"},
                 "extension": [{"url": EXT + "source-quote", "valueString": quote[:2000]}]}
    if props.get("text"):
        res["extension"].append({"url": EXT + "source-text", "valueString": props["text"]})
    if props.get("name"):
        res["name"] = [{"text": props["name"]}]
    if props.get("relation"):
        res["relationship"] = [{"text": props["relation"]}]
    if props.get("phone"):
        res["telecom"] = [{"system": "phone", "value": props["phone"]}]
    fhir.put(res)
    _forget(f"RelatedPerson/{rid}")
    return f"RelatedPerson/{rid}"


def contact(ref: str) -> dict:
    """{name, relation, phone, text, quote} of a RelatedPerson reference."""
    def load():
        rtype, rid = ref.split("/", 1)
        res = fhir.read(rtype, rid)
        if not res:
            return {}
        out = {"name": ((res.get("name") or [{}])[0]).get("text"),
               "relation": ((res.get("relationship") or [{}])[0]).get("text"),
               "phone": next((t["value"] for t in res.get("telecom", []) if t.get("system") == "phone"), None),
               "text": _ext(res, "source-text"), "quote": _ext(res, "source-quote") or ""}
        return {k: v for k, v in out.items() if v is not None}
    return _cached(ref, load)


def delete_contact(ref: str) -> None:
    rtype, rid = ref.split("/", 1)
    fhir.delete(rtype, rid)
    _forget(ref)


# -- DocumentReference ---------------------------------------------------------------------------

def document_ref(doc_uid: str) -> str:
    return f"DocumentReference/{_rid('doc', doc_uid)}"


def upsert_document(uuid: str, doc_uid: str, meta: dict, text: str = "", original: bytes | None = None) -> str:
    rid = _rid("doc", doc_uid)
    res: dict = {"resourceType": "DocumentReference", "id": rid, "status": "current",
                 "subject": {"reference": f"Patient/{uuid}"},
                 "identifier": [{"system": EXT + "document-uid", "value": doc_uid}],
                 "type": {"text": meta.get("type") or "document"}, "content": []}
    if meta.get("title"):
        res["description"] = meta["title"]
    if isinstance(meta.get("date"), date):
        res["context"] = {"period": {"start": meta["date"].isoformat(), "end": meta["date"].isoformat()}}
    if meta.get("author"):
        res["author"] = [{"display": meta["author"]}]
    if meta.get("facility"):
        res["custodian"] = {"display": meta["facility"]}
    if text:
        res["content"].append({"attachment": {"contentType": "text/plain; charset=utf-8", "language": "cs",
                                              "title": "extracted text",
                                              "data": base64.b64encode(text.encode("utf-8")).decode("ascii")}})
    filename = meta.get("filename") or ""
    if original is not None and len(original) <= MAX_ORIGINAL:
        res["content"].append({"attachment": {
            "contentType": mimetypes.guess_type(filename)[0] or "application/octet-stream", "title": filename,
            "size": len(original), "hash": base64.b64encode(hashlib.sha1(original).digest()).decode("ascii"),
            "data": base64.b64encode(original).decode("ascii")}})
    elif filename:
        res["content"].append({"attachment": {"title": filename, "url": f"onkomost:storage/raw/{meta.get('sha256', '')}"}})
    if not res["content"]:
        res["content"].append({"attachment": {"title": meta.get("title") or doc_uid}})
    fhir.put(res)
    return f"DocumentReference/{rid}"


def delete_document(doc_uid: str) -> None:
    fhir.delete("DocumentReference", _rid("doc", doc_uid))


def forget_cache() -> None:
    _forget()
