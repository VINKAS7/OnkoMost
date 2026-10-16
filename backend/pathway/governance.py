"""Changing a pathway: draft → proposal → votes → active (or rejected).

Rules
* Changes are made in a draft copy; the draft is what gets voted on.
* One vote per KOC. The proposal passes only with YES from more than half of ALL active KOCs (not of those who voted).
* There is a deadline. It passes as soon as the threshold is reached, fails as soon as it can no longer be reached,
  and is otherwise decided at the deadline.
* A new version applies to new cases only; running cases keep the version they started on.
"""
from __future__ import annotations

from datetime import date, datetime

from sqlalchemy import select
from sqlalchemy.orm import Session

from backend.pathway.model import diff, validate
from backend.workflow.db import (ChangeProposal, Koc, OutboxMessage, Pathway, PathwayVersion, Vote, audit,
                                 session_scope, today)


class GovernanceError(ValueError):
    pass


def threshold(s: Session) -> tuple[int, int]:
    active = len(list(s.scalars(select(Koc).where(Koc.active.is_(True)))))
    return active // 2 + 1, active  # strictly more than half


def active_version(s: Session, pathway_id: int) -> PathwayVersion:
    v = s.scalars(select(PathwayVersion).where(PathwayVersion.pathway_id == pathway_id,
                                               PathwayVersion.status == "active")).first()
    if not v:
        raise GovernanceError("pathway has no active version")
    return v


def create_draft(pathway_id: int, koc_id: int, graph: dict | None = None) -> int:
    with session_scope() as s:
        base = active_version(s, pathway_id)
        g = graph or base.graph_json
        validate(g)
        last = max(v.version for v in s.get(Pathway, pathway_id).versions)
        v = PathwayVersion(pathway_id=pathway_id, version=last + 1, status="draft", graph_json=g,
                           based_on_version_id=base.id, created_by_koc_id=koc_id)
        s.add(v)
        s.flush()
        audit(s, "pathway.draft_created", s.get(Koc, koc_id).code, None, pathway_id=pathway_id, version=v.version)
        return v.id


def update_draft(version_id: int, graph: dict, koc_id: int) -> None:
    validate(graph)
    with session_scope() as s:
        v = s.get(PathwayVersion, version_id)
        if v.status != "draft":
            raise GovernanceError("only drafts can be edited – this version is " + v.status)
        if v.created_by_koc_id != koc_id:
            raise GovernanceError("only the KOC that created the draft can edit it")
        v.graph_json = graph


def submit(version_id: int, title: str, rationale: str, deadline: date, koc_id: int) -> int:
    with session_scope() as s:
        v = s.get(PathwayVersion, version_id)
        if v.status != "draft":
            raise GovernanceError("only a draft can be submitted")
        if deadline <= today(s):
            raise GovernanceError("the deadline must be in the future")
        base = s.get(PathwayVersion, v.based_on_version_id)
        if base.status != "active":
            raise GovernanceError("the version this draft is based on is no longer active – create a new draft")
        d = diff(base.graph_json, v.graph_json)
        if not any(d.values()):
            raise GovernanceError("the draft has no changes")
        v.status = "voting"
        p = ChangeProposal(pathway_id=v.pathway_id, base_version_id=base.id, draft_version_id=v.id, title=title,
                           rationale=rationale, author_koc_id=koc_id, deadline=deadline)
        s.add(p)
        s.flush()
        author = s.get(Koc, koc_id)
        for k in s.scalars(select(Koc).where(Koc.active.is_(True))):
            s.add(OutboxMessage(kind="proposal", to_name=k.name, to_role="KOC", to_address=k.coordinator_email,
                                subject=f"Hlasování o změně cesty: {title}",
                                body=f"{author.name} navrhuje změnu cesty „{v.pathway.name}“ (v{base.version} → v{v.version}).\n\n"
                                     f"Zdůvodnění: {rationale}\n\nHlasujte do {deadline:%d. %m. %Y}. Změna platí, pokud ji podpoří "
                                     f"více než polovina všech KOC.", sent_on=today(s)))
        audit(s, "proposal.submitted", author.code, None, proposal_id=p.id, title=title)
        return p.id


def cast_vote(proposal_id: int, koc_id: int, choice: str, comment: str = "") -> dict:
    if choice not in ("yes", "no", "abstain"):
        raise GovernanceError("choice must be yes | no | abstain")
    with session_scope() as s:
        p = s.get(ChangeProposal, proposal_id)
        if p.status != "voting":
            raise GovernanceError(f"voting is closed ({p.status})")
        if today(s) > p.deadline:
            _decide(s, p)
            raise GovernanceError("the deadline has passed")
        v = s.scalars(select(Vote).where(Vote.proposal_id == proposal_id, Vote.koc_id == koc_id)).first()
        if v:
            v.choice, v.comment, v.at = choice, comment, datetime.utcnow()
        else:
            s.add(Vote(proposal_id=proposal_id, koc_id=koc_id, choice=choice, comment=comment))
        s.flush()
        audit(s, "proposal.vote", s.get(Koc, koc_id).code, None, proposal_id=proposal_id, choice=choice)
        _decide(s, p, early=True)
        return tally(s, p)


def tally(s: Session, p: ChangeProposal) -> dict:
    need, total = threshold(s)
    votes = list(s.scalars(select(Vote).where(Vote.proposal_id == p.id)))
    yes = sum(v.choice == "yes" for v in votes)
    no = sum(v.choice == "no" for v in votes)
    abstain = sum(v.choice == "abstain" for v in votes)
    return {"yes": yes, "no": no, "abstain": abstain, "not_voted": total - len(votes), "total_kocs": total,
            "needed": need, "status": p.status}


def _decide(s: Session, p: ChangeProposal, early: bool = False) -> None:
    t = tally(s, p)
    if t["yes"] >= t["needed"]:
        _close(s, p, accepted=True)
    elif t["yes"] + t["not_voted"] < t["needed"]:
        _close(s, p, accepted=False)  # can no longer pass
    elif not early and today(s) > p.deadline:
        _close(s, p, accepted=False)


def _close(s: Session, p: ChangeProposal, accepted: bool) -> None:
    draft = s.get(PathwayVersion, p.draft_version_id)
    p.status, p.closed_at = ("accepted" if accepted else "rejected"), datetime.utcnow()
    if accepted:
        for v in s.scalars(select(PathwayVersion).where(PathwayVersion.pathway_id == p.pathway_id,
                                                        PathwayVersion.status == "active")):
            v.status = "retired"
        draft.status, draft.activated_at = "active", datetime.utcnow()
        # other drafts/proposals built on the old version are now stale
        for other in s.scalars(select(ChangeProposal).where(ChangeProposal.pathway_id == p.pathway_id,
                                                            ChangeProposal.status == "voting",
                                                            ChangeProposal.id != p.id)):
            other.status, other.closed_at = "rejected", datetime.utcnow()
            s.get(PathwayVersion, other.draft_version_id).status = "rejected"
    else:
        draft.status = "rejected"
    audit(s, "proposal.accepted" if accepted else "proposal.rejected", "governance", None, proposal_id=p.id,
          version=draft.version)


def close_due(s: Session) -> None:
    for p in s.scalars(select(ChangeProposal).where(ChangeProposal.status == "voting")):
        if today(s) > p.deadline:
            _decide(s, p)


def proposal_view(s: Session, p: ChangeProposal) -> dict:
    base = s.get(PathwayVersion, p.base_version_id)
    draft = s.get(PathwayVersion, p.draft_version_id)
    votes = [{"koc_id": v.koc_id, "koc": s.get(Koc, v.koc_id).name, "choice": v.choice, "comment": v.comment, "at": v.at}
             for v in s.scalars(select(Vote).where(Vote.proposal_id == p.id))]
    return {"id": p.id, "pathway_id": p.pathway_id, "pathway": s.get(Pathway, p.pathway_id).name, "title": p.title,
            "rationale": p.rationale, "author": s.get(Koc, p.author_koc_id).name, "author_koc_id": p.author_koc_id,
            "deadline": p.deadline, "status": p.status, "created_at": p.created_at, "closed_at": p.closed_at,
            "base_version": base.version, "draft_version": draft.version, "draft_version_id": draft.id,
            "base_graph": base.graph_json, "draft_graph": draft.graph_json, "diff": diff(base.graph_json, draft.graph_json),
            "votes": votes, "tally": tally(s, p)}
