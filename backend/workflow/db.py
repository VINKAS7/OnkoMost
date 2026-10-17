"""SQLite (SQLAlchemy) for workflow data: KOCs, pathways, votes, cases, tasks, outbox, audit log.

Swapping to Postgres later means changing SQLITE_URL only. Cases refer to the patient by the pseudonymous
patient_uuid; name, RČ and birth date are read from the FHIR Patient resource (backend/fhir/records.py).
"""
from __future__ import annotations

from contextlib import contextmanager
from datetime import date, datetime
from typing import Iterator

from sqlalchemy import (JSON, Boolean, Date, DateTime, ForeignKey, Integer, String, Text, UniqueConstraint,
                        create_engine, event, inspect)
from sqlalchemy.orm import DeclarativeBase, Mapped, Session, mapped_column, relationship, sessionmaker

from backend.config import settings
from backend.fhir import records

engine = create_engine(settings.sqlite_url, connect_args={"check_same_thread": False})


@event.listens_for(engine, "connect")
def _sqlite_pragmas(conn, _):  # pragma: no cover - driver hook
    cur = conn.cursor()
    cur.execute("PRAGMA foreign_keys=ON")
    cur.execute("PRAGMA journal_mode=WAL")
    cur.close()


SessionLocal = sessionmaker(bind=engine, expire_on_commit=False)


class Base(DeclarativeBase):
    pass


class Setting(Base):
    __tablename__ = "settings"
    key: Mapped[str] = mapped_column(String, primary_key=True)
    value: Mapped[str] = mapped_column(String)


class Koc(Base):
    __tablename__ = "kocs"
    id: Mapped[int] = mapped_column(primary_key=True)
    code: Mapped[str] = mapped_column(String, unique=True)
    name: Mapped[str] = mapped_column(String)
    city: Mapped[str] = mapped_column(String, default="")
    coordinator_name: Mapped[str] = mapped_column(String, default="")
    coordinator_email: Mapped[str] = mapped_column(String, default="")
    mdt_members: Mapped[list] = mapped_column(JSON, default=list)
    staff: Mapped[dict] = mapped_column(JSON, default=dict)  # role → name (koc_doctor, pathology, …)
    active: Mapped[bool] = mapped_column(Boolean, default=True)


class Pathway(Base):
    __tablename__ = "pathways"
    id: Mapped[int] = mapped_column(primary_key=True)
    code: Mapped[str] = mapped_column(String, unique=True)
    name: Mapped[str] = mapped_column(String)
    name_en: Mapped[str] = mapped_column(String, default="")
    order: Mapped[int] = mapped_column(Integer, default=99)
    cancer_type: Mapped[str] = mapped_column(String)
    icd_codes: Mapped[list] = mapped_column(JSON, default=list)
    guideline_source: Mapped[str] = mapped_column(Text, default="")
    versions: Mapped[list["PathwayVersion"]] = relationship(back_populates="pathway", order_by="PathwayVersion.version")


class PathwayVersion(Base):
    __tablename__ = "pathway_versions"
    id: Mapped[int] = mapped_column(primary_key=True)
    pathway_id: Mapped[int] = mapped_column(ForeignKey("pathways.id"))
    version: Mapped[int] = mapped_column(Integer)
    status: Mapped[str] = mapped_column(String)  # draft | voting | active | retired | rejected
    graph_json: Mapped[dict] = mapped_column(JSON)
    based_on_version_id: Mapped[int | None] = mapped_column(ForeignKey("pathway_versions.id"), nullable=True)
    created_by_koc_id: Mapped[int | None] = mapped_column(ForeignKey("kocs.id"), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)
    activated_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    pathway: Mapped[Pathway] = relationship(back_populates="versions")


class ChangeProposal(Base):
    __tablename__ = "change_proposals"
    id: Mapped[int] = mapped_column(primary_key=True)
    pathway_id: Mapped[int] = mapped_column(ForeignKey("pathways.id"))
    base_version_id: Mapped[int] = mapped_column(ForeignKey("pathway_versions.id"))
    draft_version_id: Mapped[int] = mapped_column(ForeignKey("pathway_versions.id"))
    title: Mapped[str] = mapped_column(String)
    rationale: Mapped[str] = mapped_column(Text, default="")
    author_koc_id: Mapped[int] = mapped_column(ForeignKey("kocs.id"))
    deadline: Mapped[date] = mapped_column(Date)
    status: Mapped[str] = mapped_column(String, default="voting")  # voting | accepted | rejected
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)
    closed_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    votes: Mapped[list["Vote"]] = relationship(back_populates="proposal")


class Vote(Base):
    __tablename__ = "votes"
    __table_args__ = (UniqueConstraint("proposal_id", "koc_id"),)
    id: Mapped[int] = mapped_column(primary_key=True)
    proposal_id: Mapped[int] = mapped_column(ForeignKey("change_proposals.id"))
    koc_id: Mapped[int] = mapped_column(ForeignKey("kocs.id"))
    choice: Mapped[str] = mapped_column(String)  # yes | no | abstain
    comment: Mapped[str] = mapped_column(Text, default="")
    at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)
    proposal: Mapped[ChangeProposal] = relationship(back_populates="votes")


class Case(Base):
    __tablename__ = "cases"
    id: Mapped[int] = mapped_column(primary_key=True)
    patient_uuid: Mapped[str] = mapped_column(String, index=True)
    koc_id: Mapped[int] = mapped_column(ForeignKey("kocs.id"))
    pathway_version_id: Mapped[int] = mapped_column(ForeignKey("pathway_versions.id"))
    referring_doctor: Mapped[dict] = mapped_column(JSON, default=dict)
    suspected_diagnosis: Mapped[str] = mapped_column(String, default="")
    created_on: Mapped[date] = mapped_column(Date)
    accepted_on: Mapped[date | None] = mapped_column(Date, nullable=True)
    mdt_date: Mapped[date | None] = mapped_column(Date, nullable=True)
    mdt_report_path: Mapped[str | None] = mapped_column(String, nullable=True)
    mdt_conclusion: Mapped[dict | None] = mapped_column(JSON, nullable=True)
    # decision node id → {"keys": [...], "on": "YYYY-MM-DD", "by": "..."}  (e.g. lung route, treatment decision)
    decisions: Mapped[dict] = mapped_column(JSON, default=dict)
    k2_handover_on: Mapped[date | None] = mapped_column(Date, nullable=True)
    closed_on: Mapped[date | None] = mapped_column(Date, nullable=True)
    koc: Mapped[Koc] = relationship()
    pathway_version: Mapped[PathwayVersion] = relationship()

    # identity lives in the FHIR server, not in this database
    @property
    def identity(self) -> dict:
        return records.identity(self.patient_uuid)

    @property
    def patient_name(self) -> str:
        return self.identity.get("patient_name", "")

    @property
    def rc(self) -> str:
        return self.identity.get("rc", "")

    @property
    def dob(self) -> date | None:
        return self.identity.get("dob")


class Document(Base):
    __tablename__ = "documents"
    id: Mapped[int] = mapped_column(primary_key=True)
    case_id: Mapped[int] = mapped_column(ForeignKey("cases.id"), index=True)
    sha256: Mapped[str] = mapped_column(String, index=True)
    filename: Mapped[str] = mapped_column(String)
    path: Mapped[str] = mapped_column(String)
    source: Mapped[str] = mapped_column(String, default="upload")  # referral | request | upload | mdt
    uploaded_on: Mapped[date] = mapped_column(Date)
    status: Mapped[str] = mapped_column(String, default="queued")  # queued | processing | done | blocked | error
    error: Mapped[str] = mapped_column(Text, default="")
    doc_type: Mapped[str] = mapped_column(String, default="")
    title: Mapped[str] = mapped_column(String, default="")
    doc_date: Mapped[date | None] = mapped_column(Date, nullable=True)
    facility: Mapped[str] = mapped_column(String, default="")
    author: Mapped[str] = mapped_column(String, default="")
    identity: Mapped[dict] = mapped_column(JSON, default=dict)
    summary: Mapped[dict] = mapped_column(JSON, default=dict)


class StepEvent(Base):
    """Manual completion of a pathway node (triage accepted, handover validated, MDT held, …)."""
    __tablename__ = "step_events"
    id: Mapped[int] = mapped_column(primary_key=True)
    case_id: Mapped[int] = mapped_column(ForeignKey("cases.id"), index=True)
    node_id: Mapped[str] = mapped_column(String)
    data: Mapped[dict] = mapped_column(JSON, default=dict)
    on: Mapped[date] = mapped_column(Date)
    by: Mapped[str] = mapped_column(String, default="")


class Task(Base):
    __tablename__ = "tasks"
    __table_args__ = (UniqueConstraint("case_id", "key"),)
    id: Mapped[int] = mapped_column(primary_key=True)
    case_id: Mapped[int] = mapped_column(ForeignKey("cases.id"), index=True)
    key: Mapped[str] = mapped_column(String)
    node_id: Mapped[str] = mapped_column(String, default="")
    kind: Mapped[str] = mapped_column(String)  # to_schedule | action | missing_document | mismatch | missing_field
    title: Mapped[str] = mapped_column(String)
    detail: Mapped[str] = mapped_column(Text, default="")
    title_en: Mapped[str] = mapped_column(String, default="")
    detail_en: Mapped[str] = mapped_column(Text, default="")
    owner_role: Mapped[str] = mapped_column(String, default="coordinator")
    owner_name: Mapped[str] = mapped_column(String, default="")
    external: Mapped[bool] = mapped_column(Boolean, default=False)
    priority: Mapped[str] = mapped_column(String, default="normal")  # high | normal | low
    due_on: Mapped[date | None] = mapped_column(Date, nullable=True)
    status: Mapped[str] = mapped_column(String, default="open")  # open | scheduled | done | dismissed
    scheduled_on: Mapped[date | None] = mapped_column(Date, nullable=True)
    scheduled_place: Mapped[str] = mapped_column(String, default="")
    created_on: Mapped[date] = mapped_column(Date)
    closed_on: Mapped[date | None] = mapped_column(Date, nullable=True)
    resolution: Mapped[str] = mapped_column(Text, default="")


class DocRequest(Base):
    __tablename__ = "doc_requests"
    id: Mapped[int] = mapped_column(primary_key=True)
    case_id: Mapped[int] = mapped_column(ForeignKey("cases.id"), index=True)
    key: Mapped[str] = mapped_column(String)
    facility: Mapped[str] = mapped_column(String)
    item: Mapped[str] = mapped_column(String)
    item_date: Mapped[date | None] = mapped_column(Date, nullable=True)
    status: Mapped[str] = mapped_column(String, default="requested")  # requested | received
    requested_on: Mapped[date] = mapped_column(Date)
    received_on: Mapped[date | None] = mapped_column(Date, nullable=True)
    document_id: Mapped[int | None] = mapped_column(ForeignKey("documents.id"), nullable=True)
    message_id: Mapped[int | None] = mapped_column(ForeignKey("outbox.id"), nullable=True)


class HandoverEntry(Base):
    """Doctor confirmations / edits and coordinator additions on top of the extracted handover."""
    __tablename__ = "handover_entries"
    id: Mapped[int] = mapped_column(primary_key=True)
    case_id: Mapped[int] = mapped_column(ForeignKey("cases.id"), index=True)
    field_key: Mapped[str] = mapped_column(String)
    kind: Mapped[str] = mapped_column(String)  # confirm | edit | add
    value: Mapped[str] = mapped_column(Text, default="")
    by: Mapped[str] = mapped_column(String, default="")
    on: Mapped[date] = mapped_column(Date)


class FlagReview(Base):
    __tablename__ = "flag_reviews"
    __table_args__ = (UniqueConstraint("case_id", "flag_key"),)
    id: Mapped[int] = mapped_column(primary_key=True)
    case_id: Mapped[int] = mapped_column(ForeignKey("cases.id"))
    flag_key: Mapped[str] = mapped_column(String)
    note: Mapped[str] = mapped_column(Text, default="")
    by: Mapped[str] = mapped_column(String, default="")
    on: Mapped[date] = mapped_column(Date)


class OutboxMessage(Base):
    __tablename__ = "outbox"
    id: Mapped[int] = mapped_column(primary_key=True)
    case_id: Mapped[int | None] = mapped_column(ForeignKey("cases.id"), nullable=True)
    kind: Mapped[str] = mapped_column(String)  # doc_request | feedback_gp | feedback_review | proposal | flag
    to_name: Mapped[str] = mapped_column(String)
    to_role: Mapped[str] = mapped_column(String, default="")
    to_address: Mapped[str] = mapped_column(String, default="")
    subject: Mapped[str] = mapped_column(String)
    body: Mapped[str] = mapped_column(Text)
    attachments: Mapped[list] = mapped_column(JSON, default=list)
    sent_on: Mapped[date] = mapped_column(Date)
    ack_token: Mapped[str | None] = mapped_column(String, nullable=True, unique=True)
    acked_on: Mapped[date | None] = mapped_column(Date, nullable=True)
    acked_by: Mapped[str] = mapped_column(String, default="")


class CaseMessage(Base):
    """Questions and answers between the coordinator, the referring doctor (GP) and the insurer's review doctor."""
    __tablename__ = "case_messages"
    id: Mapped[int] = mapped_column(primary_key=True)
    case_id: Mapped[int] = mapped_column(ForeignKey("cases.id"), index=True)
    author_role: Mapped[str] = mapped_column(String)  # coordinator | gp | review
    author: Mapped[str] = mapped_column(String, default="")
    to_role: Mapped[str] = mapped_column(String)  # gp | coordinator | review
    body: Mapped[str] = mapped_column(Text)
    reply_to: Mapped[int | None] = mapped_column(ForeignKey("case_messages.id"), nullable=True)
    resolved: Mapped[bool] = mapped_column(Boolean, default=False)
    on: Mapped[date] = mapped_column(Date)
    at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)


class AuditLog(Base):
    __tablename__ = "audit_log"
    id: Mapped[int] = mapped_column(primary_key=True)
    case_id: Mapped[int | None] = mapped_column(ForeignKey("cases.id"), nullable=True, index=True)
    actor: Mapped[str] = mapped_column(String)
    action: Mapped[str] = mapped_column(String)
    detail: Mapped[dict] = mapped_column(JSON, default=dict)
    on: Mapped[date] = mapped_column(Date)
    at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)


def init_db() -> None:
    insp = inspect(engine)
    if insp.has_table("cases") and "patient_name" in {c["name"] for c in insp.get_columns("cases")}:
        raise RuntimeError(f"{settings.sqlite_url} was created by the Neo4j version and still holds patient identity. "
                           "Rebuild it: python -m scripts.seed_demo --reset-only (or delete the file), then seed again.")
    Base.metadata.create_all(engine)


@contextmanager
def session_scope() -> Iterator[Session]:
    s = SessionLocal()
    try:
        yield s
        s.commit()
    except Exception:
        s.rollback()
        raise
    finally:
        s.close()


# --- demo clock -------------------------------------------------------------------------------
# The sample case runs Oct 2026; the clock lets the seed replay it day by day.

def today(s: Session) -> date:
    row = s.get(Setting, "today")
    return date.fromisoformat(row.value) if row else date.today()


def set_today(s: Session, d: date) -> None:
    row = s.get(Setting, "today")
    if row:
        row.value = d.isoformat()
    else:
        s.add(Setting(key="today", value=d.isoformat()))


def audit(s: Session, action: str, actor: str = "system", case_id: int | None = None, **detail) -> None:
    s.add(AuditLog(case_id=case_id, actor=actor, action=action, detail=detail, on=today(s)))
