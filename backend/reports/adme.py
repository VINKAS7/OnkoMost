"""Current medication of a case and where each drug acts on the body, for the MDT anatomogram (blue layer).

Medications are the `medication` facts of the patient's reports dated on/before the MDT date. Each drug is looked up
in the pharmacolibrary ADME SQLite export (the same file mockup1's <onco-anatomogram> loads in the browser) and gives

  sites         drug · process (absorption / distribution / metabolism / excretion / target) · tissue · genes
  interactions  candidate pairs that share a transporter / enzyme: an inhibitor or inducer of a gene + a substrate of
                it (`ddi_candidate`), or two substrates of the same gene (`shared_substrate`)

Rule-based, ported from mockup1/components/onco-anatomogram/adme.js; no LLM. A name the database does not know
(e.g. a Czech brand) is listed as not found – an LLM guessing brand → generic name was wrong in 2 of 5 tests.

Env: ADME_DB – the .sqlite file or the JSON pointer {"file": …} (default: mockup1's bundled export).
"""
from __future__ import annotations

import json
import os
import re
import sqlite3
from datetime import date
from functools import lru_cache
from pathlib import Path

from backend.config import ROOT
from backend.graph.store import graph

DEFAULT_DB = ROOT / "mockup1" / "components" / "onco-anatomogram" / "data" / "adme-latest.json"
EVIDENCE = ("drugbank_actor",)
# transporter expression rather than a real drug site (mockup1 default `hide-tissues`)
HIDDEN = {"blood-brain barrier", "placenta", "testis", "mammary gland"}
# ADME tissue UBERON id → organ id in the EBI anatomogram, where the drawing uses a proxy organ
PROXY = {"UBERON:0002394": "UBERON_0002110", "UBERON:0001911": "UBERON_0000310", "UBERON:0002097": "UBERON_0000014",
         "CL:0000233": "UBERON_0000178", "UBERON:0011919": "UBERON_0001134"}
TISSUE_CS = {
    "adipose tissue": "tuková tkáň", "adrenal gland": "nadledviny", "bile duct": "žlučové cesty", "blood": "krev",
    "brain": "mozek", "heart": "srdce", "ileum": "ileum", "kidney": "ledviny", "liver": "játra", "lung": "plíce",
    "neuromuscular junction": "nervosvalová ploténka", "ovary": "ovaria", "platelet": "trombocyty",
    "prostate gland": "prostata", "skeletal muscle": "kosterní sval", "skin": "kůže", "small intestine": "tenké střevo",
    "stomach": "žaludek", "testis": "varlata", "placenta": "placenta", "mammary gland": "mléčná žláza",
    "blood-brain barrier": "hematoencefalická bariéra",
}
PERTURB = {"inhibitor", "inducer"}
COMBO_ATC = ("C02L", "C03E", "C07B", "C07C", "C07D", "C07F", "C08G", "C09B", "C09D", "C09X", "C10B", "A10BD", "N02AJ", "R03AL")


def _db_path() -> Path | None:
    p = Path(os.getenv("ADME_DB") or DEFAULT_DB)
    if not p.is_absolute():
        p = ROOT / p
    if p.suffix == ".json" and p.is_file():
        p = p.parent / json.loads(p.read_text(encoding="utf-8"))["file"]
    return p if p.is_file() else None


@lru_cache(maxsize=1)
def _db() -> tuple[sqlite3.Connection, str] | None:
    p = _db_path()
    if not p:
        return None
    con = sqlite3.connect(f"file:{p}?mode=ro", uri=True, check_same_thread=False)
    con.row_factory = sqlite3.Row
    return con, p.name


def _resolve(con: sqlite3.Connection, name: str) -> dict | None:
    n = name.strip().lower()
    r = (con.execute("SELECT slug, generic_name AS name, drugbank_id, atc_codes FROM adme_drug "
                     "WHERE lower(slug) = ? OR lower(generic_name) = ? LIMIT 1", (n, n)).fetchone()
         or con.execute("SELECT d.slug, d.generic_name AS name, d.drugbank_id, d.atc_codes FROM adme_synonym s "
                        "JOIN adme_drug d ON d.slug = s.drug_slug WHERE lower(s.name) = ? LIMIT 1", (n,)).fetchone())
    if not r:
        return None
    codes = [c for c in (r["atc_codes"] or "").split(",") if c]
    # the single-substance code: combinations sit in combination groups or at the 5th level 50+
    mono = [c for c in codes if not c.startswith(COMBO_ATC) and not (c[-2:].isdigit() and int(c[-2:]) >= 50)]
    return {**dict(r), "atc": (mono or codes or [""])[0]}


def _candidates(name: str) -> list[str]:
    """Czech spellings of an INN → database names: amlodipin → amlodipine, kalium chloratum → kalium, Eliquis 5 mg → eliquis."""
    n = re.sub(r"\s+\d.*$", "", name.strip().lower())  # drop the strength
    first = n.split()[0] if n.split() else n
    out = [n, f"{n}e", first, f"{first}e", re.sub(r"um$", "", first), re.sub(r"(in|ol|il)$", r"\1e", first)]
    return list(dict.fromkeys(x for x in out if x))


def _resolve_all(con: sqlite3.Connection, names: list[str]) -> list[dict | None]:
    return [next((x for c in _candidates(n) if (x := _resolve(con, c))), None) for n in names]


def _organ(uberon: str | None) -> str | None:
    return PROXY.get(uberon or "") or (uberon or "").replace(":", "_") or None


def compute(con: sqlite3.Connection, drugs: list[dict]) -> tuple[list[dict], list[dict]]:
    site_of: dict[str, list[sqlite3.Row]] = {}
    for r in con.execute("SELECT gene, process, tissue, uberon FROM adme_site"):
        site_of.setdefault(r["gene"], []).append(r)
    acc: dict[tuple, dict] = {}
    by_gene: dict[str, dict[str, set]] = {}

    def add(drug, process, tissue, uberon, gene):
        row = acc.setdefault((drug, process, tissue), {"drug": drug, "process": process, "tissue": tissue,
                                                       "uberon": uberon, "genes": []})
        if gene and gene not in row["genes"]:
            row["genes"].append(gene)

    ev = ",".join("?" * len(EVIDENCE))
    for d in drugs:
        for a in con.execute(f"SELECT gene, role FROM adme_actor WHERE drug_slug = ? AND evidence IN ({ev})",
                             (d["slug"], *EVIDENCE)):
            for s in site_of.get(a["gene"], []):
                add(d["slug"], s["process"], s["tissue"], s["uberon"], a["gene"])
            by_gene.setdefault(a["gene"], {}).setdefault(d["slug"], set()).add(a["role"])
        for t in con.execute("SELECT process, tissue, uberon FROM adme_text WHERE drug_slug = ?", (d["slug"],)):
            add(d["slug"], t["process"], t["tissue"], t["uberon"], None)
    inter = []
    for gene, per in by_gene.items():
        ds = sorted(per)
        organs = sorted({o for s in site_of.get(gene, []) if s["tissue"] not in HIDDEN and (o := _organ(s["uberon"]))})
        for i in range(len(ds)):
            for j in range(i + 1, len(ds)):
                for p, v in ((ds[i], ds[j]), (ds[j], ds[i])):
                    eff = sorted(per[p] & PERTURB)
                    if eff and "substrate" in per[v]:
                        inter.append({"kind": "ddi_candidate", "gene": gene, "perpetrator": p, "victim": v,
                                      "effect": "/".join(eff), "organs": organs})
                if ("substrate" in per[ds[i]] and "substrate" in per[ds[j]]
                        and not any(x["gene"] == gene and {x.get("perpetrator"), x.get("victim")} == {ds[i], ds[j]} for x in inter)):
                    inter.append({"kind": "shared_substrate", "gene": gene, "a": ds[i], "b": ds[j], "organs": organs})
    return list(acc.values()), inter


def _paused(facts: dict) -> bool:
    return any(f["props"].get("precaution") == "anticoagulant_paused" for f in facts.get("precaution", []))


def case_medications(patient_uuid: str, cutoff: date) -> dict:
    facts = graph.facts(patient_uuid, cutoff)
    meds = []
    for m in facts.get("medication", []):
        p = m["props"]
        src = sorted(m["sources"], key=lambda s: s.get("doc_date") or date.min)
        meds.append({"name": p.get("name", ""), "dose": p.get("dose") or "", "schedule": p.get("schedule") or "",
                     "sources": [{"doc_id": s.get("doc_id"), "date": s.get("doc_date"), "title": s.get("title"),
                                  "quote": (s.get("quote") or "")[:200]} for s in src]})
    meds.sort(key=lambda m: m["name"].lower())
    db = _db()
    if not db:
        return {"medications": meds, "interactions": [], "db": None, "paused_anticoagulant": _paused(facts),
                "error": "Databáze ADME není k dispozici (ADME_DB)."}
    con, file = db
    resolved = _resolve_all(con, [m["name"] for m in meds])
    found = {r["slug"]: r for r in resolved if r}
    sites, inter = compute(con, list(found.values()))
    label = {slug: next((m["name"] for m, r in zip(meds, resolved) if r and r["slug"] == slug), slug) for slug in found}
    for m, r in zip(meds, resolved):
        m["drug"] = {"slug": r["slug"], "name": r["name"], "atc": r["atc"], "drugbank_id": r["drugbank_id"]} if r else None
        m["sites"] = [{"organ": _organ(s["uberon"]), "tissue": s["tissue"], "tissue_cs": TISSUE_CS.get(s["tissue"], s["tissue"]),
                       "process": s["process"], "genes": s["genes"]}
                      for s in sites if r and s["drug"] == r["slug"] and s["tissue"] not in HIDDEN]
    for x in inter:
        for k in ("perpetrator", "victim", "a", "b"):
            if k in x:
                x[k] = label.get(x[k], x[k])
    return {"medications": meds, "interactions": inter, "db": file, "evidence": [*EVIDENCE, "drugbank_text"],
            "hidden": sorted(HIDDEN), "paused_anticoagulant": _paused(facts)}
