"""Turn a Czech/English brief into a valid pathway graph (LLM + repair)."""
from __future__ import annotations

import logging
import re
import unicodedata
from collections import defaultdict, deque

from pydantic import BaseModel, Field, model_validator

from backend.extract import llm
from backend.pathway.formats import FORMATS
from backend.pathway.model import NODE_TYPES, ROLES, validate

log = logging.getLogger(__name__)

KINDS = ("start", "document", "step", "decision", "mdt", "treatment", "handover", "feedback", "end")
KIND_SET = set(KINDS)
PHASES = {"intake", "diagnostics", "mdt", "treatment", "after_mdt"}
ROLE_SET = set(ROLES)
FORMAT_KEYS = [k for k in FORMATS if k != "any"]
IMAGING = ("ct", "pet_ct", "mri", "xray", "ultrasound", "mammography")
REPORT_FORMATS = ["pdf", "docx", "doc"]
SCAN_FORMATS = ["dcm", "dicom", "pdf", "docx", "jpg", "jpeg", "png"]

EXAM_HINTS: list[tuple[str, tuple[str, ...]]] = [
    ("pet_ct", ("pet-ct", "pet/ct", "pet ct", "petct", "pet_ct")),
    ("bronchoscopy", ("bronchoskop", "ebus")),
    ("colonoscopy", ("kolonoskop", "colonoscop")),
    ("mammography", ("mamograf", "mammog")),
    ("ultrasound", ("ultrazvuk", "sono", "ultrasound")),
    ("eus_fnb", ("eus-fnb", "eus fnb", "eus_fnb", "eus")),
    ("histology", ("histolog", "biops")),
    ("mri", ("mri", "magnetick", "mr moz", "mr hlavy", "mr břich", "mr brich")),
    ("xray", ("rtg", "x-ray", "xray", "skiagraf", "rentgen")),
    ("ct", ("ct hrud", "ct břich", "ct brich", "ct scan", "ct moz", "ct ", " ct")),
]
DOC_HINTS: list[tuple[str, tuple[str, ...]]] = [
    ("referral", ("žádost", "zadost", "referral", "odeslán")),
    ("mdt_conclusion", ("závěr mdt", "zaver mdt", "mdt conclusion")),
    ("gp_summary", ("výpis", "vypis", "gp summary")),
    ("histology", ("histolog",)),
    ("lab", ("laboratoř", "laborator", "lab result")),
    ("procedure", ("protokol výkonu", "protokol vykonu", "procedure")),
    ("imaging", ("zobrazov", "imaging")),
]
KIND_ALIASES = {
    "start": "start", "begin": "start", "referral": "start",
    "document": "document", "evidence": "document", "doc": "document", "file": "document",
    "step": "step", "task": "step", "action": "step",
    "decision": "decision", "branch": "decision", "choice": "decision",
    "mdt": "mdt",
    "treatment": "treatment", "plan": "treatment",
    "handover": "handover", "hand-over": "handover",
    "feedback": "feedback", "result": "feedback",
    "end": "end", "close": "end", "closed": "end",
}


class DraftBranch(BaseModel):
    key: str = ""
    label: str = ""
    label_en: str = ""


class DraftNode(BaseModel):
    id: str = ""
    kind: str = "step"
    label: str = ""
    label_en: str = ""
    description: str = ""
    description_en: str = ""
    accepted_formats: list[str] = Field(default_factory=list)
    owner_role: str = ""
    sla_days: int = 0
    phase: str = ""
    branches: list[DraftBranch] = Field(default_factory=list)
    exam_type: str = ""
    doc_type: str = ""

    @model_validator(mode="before")
    @classmethod
    def _alias(cls, v):
        if not isinstance(v, dict):
            return v
        d = dict(v)
        if not d.get("kind") and d.get("type"):
            d["kind"] = d["type"]
        if not d.get("accepted_formats") and d.get("formats"):
            d["accepted_formats"] = d["formats"]
        fmts = d.get("accepted_formats")
        if isinstance(fmts, str):
            d["accepted_formats"] = [x.strip().lstrip(".") for x in re.split(r"[,;|/ ]+", fmts) if x.strip()]
        br = d.get("branches")
        if isinstance(br, list) and br and not isinstance(br[0], dict):
            d["branches"] = [{"label": str(x), "label_en": str(x)} for x in br]
        try:
            d["sla_days"] = int(d.get("sla_days") or 0)
        except (TypeError, ValueError):
            d["sla_days"] = 0
        return d


class DraftEdge(BaseModel):
    source: str = ""
    target: str = ""
    branch: str = ""
    label: str = ""


class DraftGraph(BaseModel):
    nodes: list[DraftNode] = Field(default_factory=list)
    edges: list[DraftEdge] = Field(default_factory=list)

    @model_validator(mode="before")
    @classmethod
    def _unwrap(cls, v):
        if not isinstance(v, dict):
            return v
        if "nodes" in v:
            return v
        for k in ("graph", "pathway", "draft", "data", "result"):
            inner = v.get(k)
            if isinstance(inner, dict) and "nodes" in inner:
                return inner
        return v


SYSTEM = (
    "You are a clinical pathway designer for a Czech cancer centre (Onkomost). "
    "Read the USER BRIEF carefully. Build the pathway they described — their diagnosis, "
    "site, exams, decisions and treatments. Do not replace their brief with a generic template. "
    "If they name a tumour, stage, biomarker or drug, put that detail in the node descriptions. "
    "Return ONLY JSON. Prefer this shape: "
    "{\"steps\":[{\"kind\":\"start|document|step|decision|mdt|treatment|handover|feedback|end\","
    "\"label\":\"Czech title\",\"label_en\":\"English title\","
    "\"description\":\"Czech, 1–3 sentences from the brief\","
    "\"description_en\":\"English, 1–3 sentences from the brief\","
    "\"formats\":[\"pdf\",\"docx\"],"
    "\"branches\":[\"option A\",\"option B\"]}]}. "
    "You may instead return {\"nodes\":[...],\"edges\":[...]}. "
    "Kinds: start, document (a file the hospital must upload), step, decision, mdt, treatment, handover, feedback, end. "
    "Must include exactly one start, one feedback (result to the referring doctor), one end. "
    "formats without a dot: pdf,docx,doc for reports; dcm,dicom,pdf,jpg for CT/X-ray/MRI/PET. "
    "A decision needs at least two branches. Order steps in clinical sequence."
)


def generate(prompt: str, current: dict | None = None) -> dict:
    """Ask the local model for the pathway the user described, then repair into a valid graph."""
    user = _user_prompt(prompt, current)
    data = llm.complete_json(SYSTEM, user, num_predict=2200, temperature=0.3, num_ctx=4096)
    draft = _draft_from_llm(data)
    if not draft.get("nodes"):
        raise llm.LLMUnavailable("the model returned no steps – describe the diagnosis and the exams in more detail")
    return materialize(draft)


def _draft_from_llm(data: dict) -> dict:
    if data.get("steps") and not data.get("nodes"):
        nodes = []
        for s in data["steps"]:
            if not isinstance(s, dict):
                continue
            item = dict(s)
            if item.get("formats") and not item.get("accepted_formats"):
                item["accepted_formats"] = item["formats"]
            nodes.append(item)
        return {"nodes": nodes, "edges": data.get("edges") or []}
    return data


def materialize(draft: DraftGraph | dict) -> dict:
    """Deterministic repair: kinds, ids, descriptions, formats, wiring, validator."""
    if isinstance(draft, dict):
        draft = DraftGraph.model_validate(draft)
    nodes: list[dict] = []
    used: set[str] = set()
    for i, n in enumerate(draft.nodes):
        node, _nid = _one_node(n, used, i)
        nodes.append(node)
    nodes = _ensure_required(nodes)
    by_id = {n["id"]: n for n in nodes}
    edges = _clean_edges(draft.edges, by_id)
    edges = _wire(nodes, edges)
    graph = {"nodes": nodes, "edges": edges}
    return validate(graph).model_dump(exclude_none=True)


def _user_prompt(prompt: str, current: dict | None) -> str:
    parts = [
        "Available node kinds (use only these): start · document · step · decision · mdt · treatment · handover · feedback · end.",
        "Allowed format keys: " + ", ".join(FORMAT_KEYS) + ".",
        "Follow the USER BRIEF. Their diagnosis, site, exams and treatments become the nodes. Do not invent a generic cancer pathway.",
        "Fill Czech + English title and a description that repeats the clinical detail they wrote. Document steps need formats.",
        "",
        "USER BRIEF:",
        prompt.strip(),
    ]
    brief = _current_brief(current)
    if brief:
        parts += ["", "Current canvas (replace it with the new complete pathway, keeping a step only if the brief still needs it):", brief]
    return "\n".join(parts)


def _current_brief(current: dict | None) -> str:
    if not current or not current.get("nodes"):
        return ""
    nodes = current["nodes"]
    types = {n.get("type") for n in nodes}
    if len(nodes) <= 3 and types <= {"start", "feedback", "end"}:
        return ""
    lines = []
    for n in nodes:
        kind = "document" if n.get("completion") == "evidence" else n.get("type", "step")
        fmts = ",".join(f".{f}" for f in (n.get("accepted_formats") or [])[:6])
        extra = f" formats={fmts}" if fmts else ""
        lines.append(f"- {n.get('id')}: [{kind}] {n.get('label_en') or n.get('label')}{extra}")
    return "\n".join(lines[:40])


def _fold(s: str) -> str:
    return unicodedata.normalize("NFKD", s or "").encode("ascii", "ignore").decode().lower()


def _slug(s: str) -> str:
    t = re.sub(r"[^a-z0-9]+", "_", _fold(s)).strip("_")
    return (t[:40] if t else "step")


def _unique(base: str, used: set[str]) -> str:
    nid, i = base, 2
    while nid in used:
        nid = f"{base}_{i}"
        i += 1
    used.add(nid)
    return nid


def _kind_of(n: DraftNode) -> str:
    raw = (n.kind or "").strip().lower().replace(" ", "_")
    if raw in KIND_SET:
        return raw
    if raw in KIND_ALIASES:
        return KIND_ALIASES[raw]
    if raw in NODE_TYPES:
        return "document" if raw == "step" and (n.accepted_formats or n.exam_type or n.doc_type) else raw
    blob = _fold(f"{n.label} {n.label_en} {n.description}")
    if any(w in blob for w in ("zadost", "referral", "zacatek", "start")):
        return "start"
    if any(w in blob for w in ("mdt", "multidisciplin")):
        return "mdt"
    if any(w in blob for w in ("predani", "handover")):
        return "handover"
    if any(w in blob for w in ("vysledek", "feedback", "praktickemu")):
        return "feedback"
    if any(w in blob for w in ("uzavreno", "closed", "konec")):
        return "end"
    if n.branches or "rozhod" in blob or "decision" in blob:
        return "decision"
    if n.accepted_formats or n.exam_type or n.doc_type:
        return "document"
    if any(k in blob for k, _ in EXAM_HINTS):
        return "document"
    return "step"


def _exam_of(n: DraftNode, blob: str) -> str:
    if n.exam_type:
        return n.exam_type
    for exam, hints in EXAM_HINTS:
        if any(h in blob for h in hints):
            return exam
    return ""


def _doc_of(n: DraftNode, blob: str) -> str:
    if n.doc_type:
        return n.doc_type
    for doc, hints in DOC_HINTS:
        if any(h in blob for h in hints):
            return doc
    return ""


def _formats(n: DraftNode, exam: str, kind: str) -> list[str]:
    raw = [str(f).lower().lstrip(".") for f in (n.accepted_formats or [])]
    out = [f for f in raw if f in FORMATS]
    if kind != "document" and not out:
        return []
    if out:
        return out
    if exam in IMAGING:
        return list(SCAN_FORMATS)
    return list(REPORT_FORMATS)


def _branches(n: DraftNode) -> list[dict]:
    out = []
    used: set[str] = set()
    for i, b in enumerate(n.branches or []):
        label = (b.label or b.label_en or f"option_{i+1}").strip()
        key = _slug(b.key or b.label_en or label) or f"opt_{i+1}"
        key = _unique(key, used)
        out.append({"key": key, "label": b.label or label, "label_en": b.label_en or label})
    if len(out) < 2:
        out = [
            {"key": "yes", "label": "Ano", "label_en": "Yes"},
            {"key": "no", "label": "Ne", "label_en": "No"},
        ]
    return out


def _one_node(n: DraftNode, used: set[str], index: int) -> tuple[dict, str]:
    kind = _kind_of(n)
    label = (n.label or n.label_en or kind).strip()
    label_en = (n.label_en or n.label or kind).strip()
    blob = _fold(f"{label} {label_en} {n.description} {n.description_en}")
    preferred = _slug(n.id) if n.id else ""
    if kind == "start":
        preferred = preferred or "start"
    elif kind == "end":
        preferred = preferred or "end"
    elif kind == "feedback":
        preferred = preferred or "feedback"
    else:
        preferred = preferred or _slug(label_en or label) or f"{kind}_{index+1}"
    nid = _unique(preferred, used)
    exam = _exam_of(n, blob)
    doc = _doc_of(n, blob)
    owner = n.owner_role if n.owner_role in ROLE_SET else _owner(kind, exam)
    phase = n.phase if n.phase in PHASES else _phase(kind)
    sla = int(n.sla_days) if n.sla_days else _sla(kind, exam)
    desc, desc_en = _descriptions(n, kind, label, label_en, exam)
    node: dict = {
        "id": nid, "label": label, "label_en": label_en,
        "description": desc, "description_en": desc_en,
        "owner_role": owner, "phase": phase, "sla_days": sla, "blocking": True,
    }
    if kind == "start":
        node.update(type="start", completion="evidence" if (doc == "referral" or "zadost" in blob or "referral" in blob) else "auto")
        if node["completion"] == "evidence":
            fmts = _formats(n, exam, "document") or list(REPORT_FORMATS)
            node["accepted_formats"] = fmts
            reqs: list[dict] = [{"kind": "described"}]
            if doc:
                reqs.append({"kind": "document", "doc_type": doc})
            node["requires"] = reqs
        else:
            node["completion"] = "auto"
    elif kind == "document":
        fmts = _formats(n, exam, "document")
        reqs = [{"kind": "described"}]
        if exam:
            reqs.append({"kind": "exam", "exam_type": exam})
        elif doc:
            reqs.append({"kind": "document", "doc_type": doc})
        node.update(type="step", completion="evidence", accepted_formats=fmts, requires=reqs)
    elif kind == "decision":
        branches = _branches(n)
        node.update(type="decision", completion="branch", branches=branches, sla_days=0)
    elif kind == "mdt":
        node.update(type="mdt", completion="manual", action=n.label and "Zapsat závěr MDT" or "MDT")
        node["action"] = "Zapsat závěr MDT"
    elif kind == "treatment":
        node.update(type="treatment", completion="branch", phase="treatment")
    elif kind == "handover":
        node.update(type="handover", completion="manual", action="Předat")
    elif kind == "feedback":
        node.update(type="feedback", completion="manual", action="Odeslat výsledek", phase="after_mdt")
    elif kind == "end":
        node.update(type="end", completion="auto", phase="after_mdt", sla_days=0)
    else:
        node.update(type="step", completion="manual", action="Hotovo")
    return node, nid


def _descriptions(n: DraftNode, kind: str, label: str, label_en: str, exam: str) -> tuple[str, str]:
    cz = (n.description or "").strip()
    en = (n.description_en or "").strip()
    if not cz:
        if kind == "document":
            cz = f"{label} – nahrajte oficiální nemocniční dokument tohoto vyšetření (ne jen zmínku v anamnéze)."
        elif kind == "start":
            cz = "První krok cesty – žádost nebo vstup pacienta na cestu."
        elif kind == "feedback":
            cz = "Koordinátor odešle závěr referujícímu lékaři."
        elif kind == "end":
            cz = "Cesta je uzavřená."
        elif kind == "decision":
            cz = f"Lékař zvolí další postup: {label}."
        elif kind == "mdt":
            cz = "Multidisciplinární tým zapíše diagnózu, závěr a doporučení."
        else:
            cz = f"{label} – krok se dokončí ručně v Onkomostu."
    if not en:
        if kind == "document":
            en = f"{label_en} – upload the official hospital file for this exam, not just a mention in the history."
        elif kind == "start":
            en = "First step of the pathway – the referral or the patient entering the route."
        elif kind == "feedback":
            en = "The coordinator sends the conclusion back to the referring doctor."
        elif kind == "end":
            en = "The pathway is closed."
        elif kind == "decision":
            en = f"The doctor picks the next route: {label_en}."
        elif kind == "mdt":
            en = "The multidisciplinary team records the diagnosis, conclusion and advice."
        else:
            en = f"{label_en} – completed by hand in Onkomost."
    return cz, en


def _owner(kind: str, exam: str) -> str:
    if kind == "start":
        return "gp"
    if kind == "mdt" or kind == "decision":
        return "mdt" if kind == "mdt" else "koc_doctor"
    if kind == "treatment":
        return "k2_coordinator"
    if exam in IMAGING:
        return "radiology"
    if exam in {"bronchoscopy", "colonoscopy", "eus_fnb"}:
        return "endoscopy"
    if exam == "histology":
        return "pathology"
    return "coordinator"


def _phase(kind: str) -> str:
    return {
        "start": "intake", "mdt": "mdt", "treatment": "treatment",
        "handover": "after_mdt", "feedback": "after_mdt", "end": "after_mdt",
    }.get(kind, "diagnostics")


def _sla(kind: str, exam: str) -> int:
    if kind in {"start", "decision", "end", "treatment"}:
        return 0
    if kind == "feedback":
        return 2
    if kind == "handover":
        return 3
    if kind == "mdt":
        return 7
    if exam in IMAGING:
        return 10
    return 7


def _ensure_required(nodes: list[dict]) -> list[dict]:
    starts = [n for n in nodes if n["type"] == "start"]
    if not starts:
        nodes.insert(0, {
            "id": _free("start", nodes), "type": "start", "label": "Začátek", "label_en": "Start",
            "phase": "intake", "owner_role": "gp", "completion": "auto", "sla_days": 0,
            "description": "První krok cesty.", "description_en": "First step of the pathway.",
        })
    else:
        for extra in starts[1:]:
            extra["type"] = "step"
            extra["completion"] = extra.get("completion") if extra.get("completion") != "auto" else "manual"
    if not any(n["type"] == "feedback" for n in nodes):
        nodes.append({
            "id": _free("feedback", nodes), "type": "feedback", "label": "Výsledek odeslán", "label_en": "Result sent",
            "phase": "after_mdt", "owner_role": "coordinator", "sla_days": 2, "completion": "manual",
            "action": "Odeslat výsledek",
            "description": "Koordinátor odešle závěr referujícímu lékaři.",
            "description_en": "The coordinator sends the conclusion back to the referring doctor.",
        })
    if not any(n["type"] == "end" for n in nodes):
        nodes.append({
            "id": _free("end", nodes), "type": "end", "label": "Uzavřeno", "label_en": "Closed",
            "phase": "after_mdt", "owner_role": "coordinator", "completion": "auto", "sla_days": 0,
            "description": "Cesta je uzavřená.", "description_en": "The pathway is closed.",
        })
    return nodes


def _free(base: str, nodes: list[dict]) -> str:
    used = {n["id"] for n in nodes}
    return _unique(base, used)


def _clean_edges(raw: list[DraftEdge], by_id: dict[str, dict]) -> list[dict]:
    known = set(by_id)
    aliases = {_slug(i): i for i in known}
    out, seen = [], set()
    for e in raw:
        src = _resolve(e.source, known, aliases)
        dst = _resolve(e.target, known, aliases)
        if not src or not dst or src == dst:
            continue
        key = (src, dst, e.branch or "")
        if key in seen:
            continue
        seen.add(key)
        edge = {"source": src, "target": dst}
        src_n = by_id[src]
        if e.branch and src_n.get("type") == "decision":
            keys = {b["key"] for b in src_n.get("branches") or []}
            br = e.branch if e.branch in keys else _slug(e.branch)
            if br in keys:
                edge["branch"] = br
                edge["label"] = e.label or next(b["label"] for b in src_n["branches"] if b["key"] == br)
        elif e.label:
            edge["label"] = e.label
        out.append(edge)
    return out


def _resolve(raw: str, known: set[str], aliases: dict[str, str]) -> str | None:
    if raw in known:
        return raw
    s = _slug(raw)
    return aliases.get(s)


def _wire(nodes: list[dict], edges: list[dict]) -> list[dict]:
    ids = [n["id"] for n in nodes]
    by_id = {n["id"]: n for n in nodes}
    start = next(n["id"] for n in nodes if n["type"] == "start")
    feedback = next(n["id"] for n in nodes if n["type"] == "feedback")
    end = next(n["id"] for n in nodes if n["type"] == "end")

    def has_cycle(es: list[dict]) -> bool:
        succ: dict[str, list[str]] = defaultdict(list)
        indeg = {i: 0 for i in ids}
        for e in es:
            succ[e["source"]].append(e["target"])
            indeg[e["target"]] += 1
        q = deque(i for i, d in indeg.items() if d == 0)
        seen = 0
        while q:
            x = q.popleft()
            seen += 1
            for y in succ[x]:
                indeg[y] -= 1
                if indeg[y] == 0:
                    q.append(y)
        return seen != len(ids)

    cleaned = []
    for e in edges:
        trial = cleaned + [e]
        if not has_cycle(trial):
            cleaned.append(e)
    edges = cleaned

    def outs(nid: str) -> list[dict]:
        return [e for e in edges if e["source"] == nid]

    def ins(nid: str) -> list[dict]:
        return [e for e in edges if e["target"] == nid]

    def add(src: str, dst: str, branch: str | None = None):
        if src == dst:
            return
        if any(e["source"] == src and e["target"] == dst for e in edges):
            return
        e = {"source": src, "target": dst}
        if branch:
            e["branch"] = branch
            src_n = by_id[src]
            b = next((x for x in src_n.get("branches") or [] if x["key"] == branch), None)
            if b:
                e["label"] = b["label"]
        trial = edges + [e]
        if not has_cycle(trial):
            edges.append(e)

    for n in nodes:
        if n["type"] != "decision":
            continue
        keys = [b["key"] for b in n.get("branches") or []]
        have = {e.get("branch") for e in outs(n["id"]) if e.get("branch")}
        for key in keys:
            if key in have:
                continue
            # attach a matching treatment or a following step
            dest = next((t["id"] for t in nodes if t["type"] == "treatment" and (
                t["id"].endswith(key) or _slug(t.get("label_en") or t["label"]) == key
            ) and t["id"] != n["id"]), None)
            add(n["id"], dest or feedback, key)

    order = [n["id"] for n in nodes if n["type"] not in {"end"}]
    # linear fallback for isolates
    if not edges:
        chain = [start] + [i for i in ids if i not in {start, end, feedback}] + [feedback, end]
        for a, b in zip(chain, chain[1:]):
            add(a, b)
    else:
        reachable = _reachable(start, edges)
        prev = start
        for nid in order:
            if nid == start:
                continue
            if nid not in reachable and not ins(nid):
                add(prev, nid)
                reachable = _reachable(start, edges)
            if outs(nid) or nid == feedback:
                prev = nid
                continue
            nxt = feedback if nid != feedback else end
            add(nid, nxt)
            prev = nid
        if not outs(start):
            nxt = next((i for i in ids if i != start), feedback)
            add(start, nxt)
        if not outs(feedback):
            add(feedback, end)
        if not ins(end):
            add(feedback, end)
        # anything still unreachable → hang off last reachable non-end
        reachable = _reachable(start, edges)
        last = next((i for i in reversed(order) if i in reachable), start)
        for nid in ids:
            if nid not in reachable and nid != start:
                add(last, nid)
                last = nid
                reachable = _reachable(start, edges)
    return edges


def _reachable(start: str, edges: list[dict]) -> set[str]:
    succ: dict[str, list[str]] = defaultdict(list)
    for e in edges:
        succ[e["source"]].append(e["target"])
    seen = {start}
    q = deque([start])
    while q:
        x = q.popleft()
        for y in succ[x]:
            if y not in seen:
                seen.add(y)
                q.append(y)
    return seen
