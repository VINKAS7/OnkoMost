"""Pathway graph JSON: validation, ordering and diff (for governance)."""
from __future__ import annotations

from collections import defaultdict, deque

from pydantic import BaseModel, Field, model_validator

from backend.pathway.formats import FORMATS

NODE_TYPES = {"start", "step", "decision", "mdt", "treatment", "feedback", "handover", "end"}
COMPLETIONS = {"evidence", "manual", "branch", "auto"}
REQUIREMENT_KINDS = {"document", "exam", "lab", "diagnosis", "precaution", "mentioned_exams_received", "described"}
BLANK_GRAPH = {
    "nodes": [
        {"id": "start", "type": "start", "label": "Začátek", "label_en": "Start",
         "phase": "intake", "owner_role": "gp", "completion": "auto",
         "description": "První krok cesty – sem se připojí žádost nebo první dokument.",
         "description_en": "First step of the pathway – attach the referral or the first document here."},
        {"id": "feedback", "type": "feedback", "label": "Výsledek odeslán", "label_en": "Result sent",
         "phase": "after_mdt", "owner_role": "coordinator", "sla_days": 2, "completion": "manual", "action": "Odeslat výsledek",
         "description": "Koordinátor odešle závěr referujícímu lékaři.",
         "description_en": "The coordinator sends the conclusion back to the referring doctor."},
        {"id": "end", "type": "end", "label": "Uzavřeno", "label_en": "Closed",
         "phase": "after_mdt", "owner_role": "coordinator", "completion": "auto"},
    ],
    "edges": [{"source": "start", "target": "feedback"}, {"source": "feedback", "target": "end"}],
}
ROLES = {
    "gp": "Referující lékař (PL)", "coordinator": "Koordinátor KOC", "koc_doctor": "Lékař KOC",
    "endoscopy": "Endoskopie", "pathology": "Patologie", "radiology": "Radiologie", "mdt": "MDT",
    "k2_coordinator": "Koordinátor léčby (K2)", "external": "Externí pracoviště",
}


class Branch(BaseModel):
    key: str
    label: str
    label_en: str = ""


class Node(BaseModel):
    id: str
    type: str = "step"
    label: str
    label_en: str = ""
    phase: str = "diagnostics"
    owner_role: str = "coordinator"
    sla_days: int = 0
    completion: str = "manual"
    requires: list[dict] = Field(default_factory=list)
    skip_if: list[dict] = Field(default_factory=list)
    branches: list[Branch] = Field(default_factory=list)
    multi: bool = False  # decision: several branches may be chosen (e.g. chemotherapy + surgery)
    branch: str | None = None
    blocking: bool = True
    action: str = ""
    description: str = ""
    description_en: str = ""
    # OR-list of official hospital file formats this document step accepts (pdf, docx, dicom, …).
    accepted_formats: list[str] = Field(default_factory=list)

    @model_validator(mode="after")
    def _check(self):
        if self.type not in NODE_TYPES:
            raise ValueError(f"node {self.id}: unknown type {self.type}")
        if self.completion not in COMPLETIONS:
            raise ValueError(f"node {self.id}: unknown completion {self.completion}")
        bad = [f for f in self.accepted_formats if f not in FORMATS]
        if bad:
            raise ValueError(f"node {self.id}: unknown file format {bad[0]}")
        if self.completion == "evidence" and not self.requires:
            if self.description or self.accepted_formats:
                self.requires = [{"kind": "described"}]
            else:
                raise ValueError(f"node {self.id}: a document step needs a description or at least one requirement")
        for r in self.requires:
            if r.get("kind") not in REQUIREMENT_KINDS:
                raise ValueError(f"node {self.id}: unknown requirement kind {r.get('kind')}")
        if self.type == "decision" and len(self.branches) < 2:
            raise ValueError(f"decision {self.id} needs at least two branches")
        return self


class Edge(BaseModel):
    source: str
    target: str
    label: str = ""
    branch: str | None = None


class PathwayGraph(BaseModel):
    nodes: list[Node]
    edges: list[Edge]

    @model_validator(mode="after")
    def _check(self):
        ids = [n.id for n in self.nodes]
        if len(ids) != len(set(ids)):
            raise ValueError("duplicate node ids")
        known = set(ids)
        by_id = {n.id: n for n in self.nodes}
        for e in self.edges:
            if e.source not in known or e.target not in known:
                raise ValueError(f"edge {e.source}→{e.target} points to an unknown node")
            if e.branch is not None:
                src = by_id[e.source]
                if src.type != "decision" or e.branch not in {b.key for b in src.branches}:
                    raise ValueError(f"edge {e.source}→{e.target}: branch '{e.branch}' is not an option of that decision")
        if len([n for n in self.nodes if n.type == "start"]) != 1:
            raise ValueError("a pathway needs exactly one start node")
        if not any(n.type == "end" for n in self.nodes):
            raise ValueError("a pathway needs an end node")
        if not any(n.type == "feedback" for n in self.nodes):
            raise ValueError("a pathway must contain a feedback step (result back to the referring doctor)")
        self.topo_order()  # raises on cycles
        return self

    def node(self, node_id: str) -> Node:
        return next(n for n in self.nodes if n.id == node_id)

    def predecessors(self) -> dict[str, list[str]]:
        p: dict[str, list[str]] = defaultdict(list)
        for e in self.edges:
            p[e.target].append(e.source)
        return p

    def topo_order(self) -> list[str]:
        indeg = {n.id: 0 for n in self.nodes}
        succ: dict[str, list[str]] = defaultdict(list)
        for e in self.edges:
            indeg[e.target] += 1
            succ[e.source].append(e.target)
        q = deque(n.id for n in self.nodes if indeg[n.id] == 0)
        order = []
        while q:
            x = q.popleft()
            order.append(x)
            for y in succ[x]:
                indeg[y] -= 1
                if indeg[y] == 0:
                    q.append(y)
        if len(order) != len(self.nodes):
            raise ValueError("the pathway contains a cycle")
        return order


def validate(graph: dict) -> PathwayGraph:
    return PathwayGraph.model_validate(graph)


def diff(base: dict, draft: dict) -> dict:
    """Node/edge level diff for the governance view."""
    bn = {n["id"]: n for n in base["nodes"]}
    dn = {n["id"]: n for n in draft["nodes"]}
    ekey = lambda e: f"{e['source']}->{e['target']}"  # noqa: E731
    be = {ekey(e): e for e in base["edges"]}
    de = {ekey(e): e for e in draft["edges"]}
    changed = []
    for nid in bn.keys() & dn.keys():
        fields = sorted(k for k in set(bn[nid]) | set(dn[nid]) if bn[nid].get(k) != dn[nid].get(k) and k != "position")
        if fields:
            changed.append({"id": nid, "fields": fields,
                            "before": {k: bn[nid].get(k) for k in fields}, "after": {k: dn[nid].get(k) for k in fields}})
    return {
        "added_nodes": sorted(dn.keys() - bn.keys()),
        "removed_nodes": sorted(bn.keys() - dn.keys()),
        "changed_nodes": changed,
        "added_edges": sorted(de.keys() - be.keys()),
        "removed_edges": sorted(be.keys() - de.keys()),
    }
