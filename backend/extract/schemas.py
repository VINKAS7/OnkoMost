"""Small JSON schemas for the LLM, one per section type (small schemas give more precise extraction)."""
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


class LabValue(BaseModel):
    analyte: str = Field(description="Name of the test as written, e.g. 'CA 19-9', 'celkový bilirubin', 'Hb'")
    value: str = Field(description="The value exactly as written, e.g. '486', '7,8'")
    unit: str = Field(default="", description="Unit as written, e.g. 'kU/l'")
    ref: str = Field(default="", description="Reference range only if the document writes one next to the value")
    flag: str = Field(default="", description="'H' or 'L' only if the document itself marks the value as high or low")
    date: str = Field(default="", description="Date of the test as DD. MM. YYYY if the document states it")
    quote: str = Field(description="Exact substring of the document that contains this value")


class ReportedExam(BaseModel):
    name: str = Field(description="The examination as written, e.g. 'CT hrudníku, břicha a pánve'")
    exam_type: str = Field(description="One of: ct, mri, pet_ct, ultrasound, xray, eus_fnb, histology, bronchoscopy, "
                                       "colonoscopy, mammography, other")
    date: str = Field(default="", description="Date of the examination as DD. MM. YYYY")
    finding: str = Field(description="Its result or conclusion, copied verbatim (may be several sentences)")
    quote: str = Field(description="Exact substring of the document with the finding")


class Measure(BaseModel):
    measure: str = Field(description="One of: weight, height, ecog")
    value: float = Field(description="kg for weight, cm for height, 0-4 for ECOG")
    quote: str = Field(description="Exact substring of the document with the value")


class DocumentContent(BaseModel):
    document_title: str = Field(default="", description="What this document is, in Czech, e.g. 'Žádost o převzetí do "
                                                        "KOC', 'CT hrudníku', 'Histologické vyšetření'")
    facility: str = Field(default="", description="The hospital or department that issued it, if stated; else empty")
    labs: list[LabValue] = Field(default_factory=list)
    exams: list[ReportedExam] = Field(default_factory=list)
    symptoms: list[SymptomItem] = Field(default_factory=list)
    measures: list[Measure] = Field(default_factory=list)


class StepMatch(BaseModel):
    step_id: str = Field(description="The id of a step from the list, exactly as given")
    quote: str = Field(description="Exact substring of the document that proves it fulfils this step")


class DocumentSteps(BaseModel):
    document_date: str = Field(default="", description="The date this document was written or issued, as DD. MM. YYYY "
                                                       "(not the date of an exam it mentions); empty if not stated")
    steps: list[StepMatch] = Field(default_factory=list,
                                   description="The steps whose required data this document contains; empty if none")


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
    "whole": (
        "Read this whole Czech medical document and list: (1) every laboratory value, with its date when stated; "
        "(2) every examination whose RESULT the document reports (imaging, endoscopy, biopsy, histology, ...), with "
        "its type, date and the finding copied verbatim - not exams that are only planned or recommended; (3) the "
        "patient's current symptoms and when each started (not symptoms that are denied or absent); (4) weight, "
        "height and ECOG performance status if stated. Copy values exactly as written; never add or compute values."),
}
