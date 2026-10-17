"""Document chunks for GraphRAG in an IRIS SQL table with a VECTOR column (as in iris-vector-rag and
IRIS-Global-GraphRAG).

Retrieval is hybrid and always limited to one patient and the cut-off date:
  keyword – BM25 over the patient's chunks with light Czech stemming
  vector  – VECTOR_COSINE against embeddings from the local Ollama (EMBED_MODEL, by default the multilingual
            qwen3-embedding:0.6b), so an English question finds Czech text
  fusion  – reciprocal rank fusion (RRF) of the two lists
When the embedding model is not configured or not reachable, only the keyword leg runs.
Identifiers of the patient are masked in the stored text: the full record is in the FHIR server.

The global ^OnkIndex("embed") records which model and dimension the stored vectors come from. When EMBED_MODEL or
EMBED_DIM changes, ensure_table() rebuilds the table and re-embeds the stored (already masked) text.

    python -m backend.rag.index --reindex     # re-embed every chunk, e.g. after Ollama was down during uploads
"""
from __future__ import annotations

import logging
import math
import re
import sys
from collections import Counter
from datetime import date

import httpx

from backend.config import settings
from backend.iris import db
from backend.ingest.reader import fold

log = logging.getLogger(__name__)

TABLE = "Onk.DocChunk"
META = "OnkIndex"
RRF_K = 60
VECTOR_TOP = 4
BATCH = 16
# Qwen3-Embedding expects an instruction on the query side only
QUERY_TASK = ("Given a question (English or Czech) about a cancer patient's record, retrieve the passages of the "
              "patient's Czech medical reports that answer it")

# -- embeddings ------------------------------------------------------------------------------------


def _prepare(text: str, kind: str, model: str) -> str:
    """kind = 'query' | 'passage'; adds the prefix the model family was trained with."""
    name = model.lower()
    if "qwen3-embedding" in name:
        return f"Instruct: {QUERY_TASK}\nQuery:{text}" if kind == "query" else text
    if "e5" in name:
        return f"{kind}: {text}"
    return text


def embed(texts: list[str], kind: str) -> list[list[float]] | None:
    """Vectors from the Ollama embedding model, or None (keyword search only) when it is not configured, not
    reachable, or returns vectors of another size than EMBED_DIM."""
    if not settings.embed_model or not texts:
        return None
    out: list[list[float]] = []
    try:
        for i in range(0, len(texts), BATCH):
            r = httpx.post(f"{settings.ollama_url}/api/embed", timeout=120, json={
                "model": settings.embed_model,
                "input": [_prepare(t, kind, settings.embed_model) for t in texts[i:i + BATCH]]})
            r.raise_for_status()
            out += r.json()["embeddings"]
    except (httpx.HTTPError, KeyError, ValueError) as e:
        log.warning("embedding model %s unavailable, keyword search only: %s", settings.embed_model, e)
        return None
    if any(len(v) != settings.embed_dim for v in out):
        log.error("%s returns %d-dim vectors but EMBED_DIM=%d; keyword search only",
                  settings.embed_model, len(out[0]), settings.embed_dim)
        return None
    return out


def _vec(v: list[float]) -> str:
    return "[" + ",".join(f"{x:.6f}" for x in v) + "]"


# -- schema & writes -------------------------------------------------------------------------------

COLS_ALL = "ChunkId, PatientUuid, DocUid, DocId, DocDate, Title, SectionName, Seq, Text"


def _signature() -> str:
    return f"{settings.embed_model}|{settings.embed_dim}"


def _stored_signature() -> str | None:
    with db.native() as n:
        return n.get(META, "embed") or None


def _set_signature(value: str) -> None:
    with db.native() as n:
        n.set(value, META, "embed")


def _create() -> None:
    db.sql(f"""CREATE TABLE {TABLE} (
        ChunkId VARCHAR(200) NOT NULL PRIMARY KEY,
        PatientUuid VARCHAR(40) NOT NULL,
        DocUid VARCHAR(160) NOT NULL,
        DocId INTEGER,
        DocDate DATE,
        Title VARCHAR(1000),
        SectionName VARCHAR(1000),
        Seq INTEGER,
        Text VARCHAR(20000),
        Embedding VECTOR(FLOAT, {settings.embed_dim}))""")
    for name, col in (("OnkChunkPatient", "PatientUuid"), ("OnkChunkDoc", "DocUid")):
        db.sql(f"CREATE INDEX {name} ON {TABLE} ({col})")


def ensure_table() -> None:
    if not exists():
        _create()
        _set_signature(_signature())
    elif settings.embed_model and _stored_signature() != _signature():
        log.info("chunk vectors are not from %s – rebuilding %s", _signature(), TABLE)
        reindex()


def reindex() -> int:
    """Recreate the table for the current embedding model and re-embed the stored text. Returns the row count.
    The signature is only recorded when every row got a vector, so a rebuild without Ollama is retried later."""
    rows = [list(r) for r in db.sql(f"SELECT {COLS_ALL} FROM {TABLE}")] if exists() else []
    if exists():
        db.sql(f"DROP TABLE {TABLE}")
    _create()
    if _insert(rows, [r[8] or "" for r in rows]) or not rows:
        _set_signature(_signature())
    return len(rows)


def _insert(rows: list[list], texts: list[str]) -> bool:
    """Insert chunk rows (COLS_ALL order) with the embeddings of `texts`. True when vectors were stored."""
    vectors = embed(texts, "passage") if rows else None
    if vectors:
        db.sql_many(f"INSERT INTO {TABLE} ({COLS_ALL}, Embedding) "
                    "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, TO_VECTOR(?, FLOAT))",
                    [row + [_vec(v)] for row, v in zip(rows, vectors)])
        return True
    db.sql_many(f"INSERT INTO {TABLE} ({COLS_ALL}) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)", rows)
    return False


def redact(text: str, identifiers: list[str]) -> str:
    """Mask the patient's name, RČ, phone and address (best effort, whole words)."""
    for ident in sorted({i.strip() for i in identifiers if i and len(i.strip()) >= 3}, key=len, reverse=True):
        if re.fullmatch(r"\d{6}/?\d{3,4}", ident):
            pattern = re.escape(ident[:6]) + r"\s*/?\s*" + re.escape(ident.replace("/", "")[6:])
            text = re.sub(pattern, "[RČ]", text)
        elif re.fullmatch(r"[+\d][\d ]{6,}", ident):
            text = re.sub(r"\s*".join(re.escape(c) for c in ident.replace(" ", "")), "[telefon]", text)
        else:
            text = re.sub(rf"(?<!\w){re.escape(ident)}(?!\w)", "[pacient]", text, flags=re.I)
    return text


def write(patient_uuid: str, doc_uid: str, meta: dict, chunks: list[dict], identifiers: list[str]) -> None:
    delete_doc(doc_uid)
    if not chunks:
        return
    texts = [redact(c["text"], identifiers) for c in chunks]
    doc_date = meta.get("date") if isinstance(meta.get("date"), date) else None
    rows = [[f"{doc_uid}:chunk:{i}", patient_uuid, doc_uid, meta.get("sqlite_id"), doc_date,
             (meta.get("title") or "")[:1000], (c.get("section") or "")[:1000], i, text[:20000]]
            for i, (c, text) in enumerate(zip(chunks, texts))]
    _insert(rows, texts)


def delete_doc(doc_uid: str) -> None:
    db.sql(f"DELETE FROM {TABLE} WHERE DocUid = ?", [doc_uid])


def delete_patient(patient_uuid: str) -> None:
    db.sql(f"DELETE FROM {TABLE} WHERE PatientUuid = ?", [patient_uuid])


def exists() -> bool:
    schema, name = TABLE.split(".")
    return bool(db.sql("SELECT COUNT(*) FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ?",
                       [schema, name])[0][0])


def reset() -> None:
    if exists():
        db.sql(f"DELETE FROM {TABLE}")


def count() -> int:
    return int(db.sql(f"SELECT COUNT(*) FROM {TABLE}")[0][0]) if exists() else 0


# -- retrieval -------------------------------------------------------------------------------------

SUFFIXES = sorted(["ovych", "ovymi", "ovemu", "ovou", "ove", "ova", "ovy", "eho", "emu", "ych", "ymi", "ima", "ami",
                   "ovi", "ach", "ech", "ich", "ou", "em", "um", "ym", "ie", "ii", "im", "om", "y", "a", "e", "i",
                   "o", "u"], key=len, reverse=True)


DERIVATIONAL = ("ick", "ck", "sk")  # histologick-é → histolog, like histologi-e


def stem(token: str) -> str:
    for s in SUFFIXES:
        if token.endswith(s) and len(token) - len(s) >= 4:
            token = token[:-len(s)]
            break
    for s in DERIVATIONAL:
        if token.endswith(s) and len(token) - len(s) >= 5:
            return token[:-len(s)]
    return token


def _tokens(text: str) -> list[str]:
    return re.findall(r"[a-z0-9]+", fold(text).lower())


def _bm25(terms: list[str], rows: list[dict], k1: float = 1.2, b: float = 0.75) -> list[tuple[float, dict]]:
    """Score chunks for the OR of the terms. A term with spaces or symbols (e.g. 'CA 19-9') is a phrase."""
    docs = [_tokens(r["text"]) for r in rows]
    stems = [[stem(t) for t in d] for d in docs]
    joined = [" " + " ".join(d) + " " for d in docs]
    avg = sum(len(d) for d in docs) / max(1, len(docs))
    scores = [0.0] * len(rows)
    for term in terms:
        toks = _tokens(term)
        if not toks:
            continue
        if len(toks) > 1:
            needle = " " + " ".join(toks) + " "
            tfs = [j.count(needle) for j in joined]
        else:
            st = stem(toks[0])
            tfs = [Counter(s)[st] for s in stems]
        df = sum(1 for tf in tfs if tf)
        if not df:
            continue
        idf = math.log(1 + (len(rows) - df + 0.5) / (df + 0.5))
        for i, tf in enumerate(tfs):
            if tf:
                scores[i] += idf * tf * (k1 + 1) / (tf + k1 * (1 - b + b * len(docs[i]) / avg))
    return sorted(((s, r) for s, r in zip(scores, rows) if s > 0), key=lambda x: -x[0])


COLS = "ChunkId, Text, SectionName, DocId, Title, DocDate, DocUid"


def _row(r: tuple) -> dict:
    return {"id": r[0], "text": r[1] or "", "section": r[2] or "", "doc_id": r[3], "title": r[4],
            "date": r[5] if isinstance(r[5], date) or r[5] is None else date.fromisoformat(str(r[5])[:10]),
            "doc_uid": r[6]}


# A date bound as a bare `?` does not compare correctly against a DATE column, so the cut-off goes in as an ISO string
BEFORE_CUTOFF = "(DocDate IS NULL OR DocDate <= CAST(? AS DATE))"


def search(patient_uuid: str, terms: list[str], cutoff: date, limit: int = 6, question: str | None = None) -> list[dict]:
    rows = [_row(r) for r in db.sql(
        f"SELECT {COLS} FROM {TABLE} WHERE PatientUuid = ? AND {BEFORE_CUTOFF}", [patient_uuid, cutoff.isoformat()])]
    if not rows:
        return []
    ranked: dict[str, float] = {}
    by_id = {r["id"]: r for r in rows}
    for rank, (_, r) in enumerate(_bm25(terms, rows)[:limit * 3]):
        ranked[r["id"]] = ranked.get(r["id"], 0) + 1 / (RRF_K + rank + 1)
    qv = embed([question], "query") if question else None
    if qv:
        hits = db.sql(f"""SELECT TOP {VECTOR_TOP} ChunkId, VECTOR_COSINE(Embedding, TO_VECTOR(?, FLOAT)) AS Score
                          FROM {TABLE} WHERE PatientUuid = ? AND {BEFORE_CUTOFF}
                            AND Embedding IS NOT NULL ORDER BY Score DESC""",
                      [_vec(qv[0]), patient_uuid, cutoff.isoformat()])
        for rank, (cid, _) in enumerate(hits):
            if cid in by_id:
                ranked[cid] = ranked.get(cid, 0) + 1 / (RRF_K + rank + 1)
    best = sorted(ranked.items(), key=lambda x: -x[1])[:limit]
    return [{**by_id[cid], "score": round(score, 5)} for cid, score in best]


if __name__ == "__main__":
    if "--reindex" in sys.argv:
        print(f"{TABLE}: re-embedded {reindex()} chunks with {_signature()}"
              + ("" if _stored_signature() == _signature() else " – FAILED, rows kept without vectors"))
    else:
        print(__doc__)
