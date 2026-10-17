"""Small JSON schemas for the LLM, one per section type (a 4B model does better with small schemas)."""
from __future__ import annotations

from pydantic import BaseModel, Field


class ConditionItem(BaseModel):
    name: str = Field(description="Name of the illness/condition exactly as written in Czech")
    since: str | None = Field(default=None, description="Year or date it started, if written")
    quote: str = Field(description="Exact substring of the input that mentions this condition")


class Conditions(BaseModel):
    conditions: list[ConditionItem] = Field(default_factory=list)


class MedicationItem(BaseModel):
    name: str = Field(description="Drug name as written")
    dose: str | None = Field(default=None, description="Strength, e.g. '5 mg'")
    schedule: str | None = Field(default=None, description="Dosing schedule, e.g. '1-0-1' or 'při bolesti max. 4× denně'")
    quote: str


class Medications(BaseModel):
    medications: list[MedicationItem] = Field(default_factory=list)


class SymptomItem(BaseModel):
    symptom: str = Field(description="Symptom as written in Czech, e.g. 'bolesti břicha v epigastriu'")
    onset: str | None = Field(default=None, description="When it started, as written, e.g. 'od poloviny srpna 2026'")
    quote: str


class Symptoms(BaseModel):
    symptoms: list[SymptomItem] = Field(default_factory=list)


class NoteItem(BaseModel):
    category: str = Field(description="One of: wish, consent, warning, psychosocial, other")
    text: str = Field(description="The note, copied from the input")
    quote: str


class Notes(BaseModel):
    notes: list[NoteItem] = Field(default_factory=list)


class MdtQuestion(BaseModel):
    question: str | None = Field(default=None, description="What the referring doctor asks the cancer centre / MDT to do or decide")
    quote: str | None = None


class TreatmentChoice(BaseModel):
    treatments: list[str] = Field(default_factory=list, description="Allowed treatment keys the MDT recommends now")
    quote: str | None = None


class Keywords(BaseModel):
    keywords: list[str] = Field(default_factory=list, description="Czech medical search terms (nouns, lab names, exam names)")


class CaseAnswer(BaseModel):
    found_in_context: bool = Field(description="True only if the context explicitly contains the information asked for")
    answer: str = Field(description="Short answer (max 6 sentences) with [D<number>] citations after each fact")
    cited_documents: list[int] = Field(default_factory=list, max_length=5,
                                       description="Distinct numbers of the [D<number>] documents the answer is based on")


class NodeFit(BaseModel):
    matches: bool = Field(description="True only if this document is itself the report the step asks for")
    quote: str = Field(default="", description="Exact substring of the document that shows it is that report")


class BranchChoice(BaseModel):
    branch: str = Field(description="One of the allowed branch keys")
    quote: str | None = Field(default=None, description="Exact sentence from the input that supports the choice")


INSTRUCTIONS = {
    "conditions": (
        "List every illness, diagnosis or past operation of the patient in this anamnesis text (comorbidities). "
        "One item per condition. Keep the Czech wording."),
    "medications": "List every medication the patient takes, with dose and schedule exactly as written.",
    "symptoms": (
        "List the patient's current symptoms (complaints such as pain, fever, jaundice, weight loss, nausea) and when "
        "each started. Do NOT include: symptoms that are denied or absent (words 'bez', 'neguje', 'neměla'), "
        "functional status (soběstačná, pracovní neschopnost), treatment effects, or examination findings."),
    "notes": (
        "List important notes for the cancer team: the patient's wishes, consent to share information, "
        "warnings for procedures (e.g. anticoagulants), and psychological/social concerns. "
        "category must be one of: wish, consent, warning, psychosocial, other."),
    "mdt_question": "What does the referring doctor request from the cancer centre / multidisciplinary team (MDT)?",
}
