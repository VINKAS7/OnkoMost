"""Small FHIR R4 REST client for the IRIS for Health FHIR server (infra/iris).

Every resource Onkomost writes carries the meta tag TAG, so `delete_tagged` / `foreign_counts` can tell our data
from anything else on the server.
"""
from __future__ import annotations

from typing import Iterator

import httpx

from backend.config import settings

TAG_SYSTEM = "https://onkomost.cz/fhir/tag"
TAG_CODE = "onkomost"
TAG = {"system": TAG_SYSTEM, "code": TAG_CODE}
TAG_PARAM = f"{TAG_SYSTEM}|{TAG_CODE}"
# Order matters when deleting: resources that reference a Patient go first.
TYPES = ("ImagingStudy", "DocumentReference", "RelatedPerson", "Patient")  # referencing resources before Patient


class FhirError(RuntimeError):
    pass


class FhirClient:
    def __init__(self) -> None:
        self._http: httpx.Client | None = None

    @property
    def http(self) -> httpx.Client:
        if self._http is None:
            self._http = httpx.Client(base_url=settings.fhir_base_url.rstrip("/") + "/",
                                      auth=(settings.iris_user, settings.iris_password), timeout=60,
                                      headers={"Accept": "application/fhir+json"})
        return self._http

    def _check(self, r: httpx.Response, *ok: int) -> httpx.Response:
        if r.status_code not in ok:
            detail = r.text[:500]
            try:
                detail = "; ".join(i.get("diagnostics") or (i.get("details") or {}).get("text", "")
                                   for i in r.json().get("issue", [])) or detail
            except Exception:  # noqa: BLE001
                pass
            raise FhirError(f"FHIR {r.request.method} {r.request.url.path} → {r.status_code}: {detail}")
        return r

    def ping(self) -> str:
        meta = self._check(self.http.get("metadata"), 200).json()
        ours = self.count("Patient", _tag=TAG_PARAM)
        return f"FHIR {meta.get('fhirVersion', '?')} ({(meta.get('software') or {}).get('name', 'IRIS')}), {ours} Onkomost patients"

    def read(self, rtype: str, rid: str) -> dict | None:
        r = self.http.get(f"{rtype}/{rid}")
        if r.status_code in (404, 410):
            return None
        return self._check(r, 200).json()

    def put(self, resource: dict) -> dict:
        """Create or update with our own id (update-as-create)."""
        resource.setdefault("meta", {})["tag"] = [TAG]
        r = self.http.put(f"{resource['resourceType']}/{resource['id']}", json=resource,
                          headers={"Content-Type": "application/fhir+json"})
        self._check(r, 200, 201)
        return resource

    def delete(self, rtype: str, rid: str) -> None:
        self._check(self.http.delete(f"{rtype}/{rid}"), 200, 202, 204, 404, 410)

    def search(self, rtype: str, **params) -> Iterator[dict]:
        """All matching resources, following the `next` links."""
        r = self._check(self.http.get(rtype, params={"_count": 200, **params}), 200).json()
        while True:
            for e in r.get("entry", []):
                if e.get("resource", {}).get("resourceType") == rtype:
                    yield e["resource"]
            nxt = next((l["url"] for l in r.get("link", []) if l.get("relation") == "next"), None)
            if not nxt:
                return
            r = self._check(self.http.get(nxt), 200).json()

    def count(self, rtype: str, **params) -> int:
        r = self._check(self.http.get(rtype, params={"_summary": "count", **params}), 200).json()
        return int(r.get("total") or 0)

    def delete_tagged(self) -> int:
        n = 0
        for rtype in TYPES:
            for res in list(self.search(rtype, _tag=TAG_PARAM, _elements="id")):
                self.delete(rtype, res["id"])
                n += 1
        return n

    def foreign_counts(self) -> dict[str, int]:
        """Resources on the server that Onkomost did not write (must never change)."""
        return {t: self.count(t) - self.count(t, _tag=TAG_PARAM) for t in TYPES}


fhir = FhirClient()
