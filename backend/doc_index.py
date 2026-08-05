"""Semantic search over docs/ — the assistant's answer source for product questions.

"What happens after I flag a claim?" or "how does the dispute lifecycle work?" are
not database questions. They're answered by the ~11k lines of specification in
docs/, so this module makes that corpus searchable:

  1. split every docs/*.md into sections at its `##` / `###` headings
  2. embed each section once with OpenAI text-embedding-3-small
  3. cache the vectors on disk, keyed by a hash of the corpus
  4. answer a query by cosine similarity, in-process with numpy

No vector database and no pgvector: a few hundred sections is small enough that a
single matrix multiply is faster than a network round-trip would be. The cache
rebuilds automatically when any doc changes, so editing a spec is enough.

Rebuild by hand (e.g. after a docs edit, to avoid paying the cost on a user's
first question):
    python -m backend.doc_index
"""

import hashlib
import json
import logging
import re
from pathlib import Path

import numpy as np

from backend.config import get_settings

log = logging.getLogger("doc_index")

DOCS_DIR = Path(__file__).resolve().parent.parent / "docs"
CACHE_DIR = Path(__file__).resolve().parent / "data"
VECTORS_PATH = CACHE_DIR / "doc_index.npy"
MANIFEST_PATH = CACHE_DIR / "doc_index.json"

EMBED_MODEL = "text-embedding-3-small"
# text-embedding-3-small supports truncation to fewer dimensions. 512 keeps the
# cache ~3x smaller and search ~3x faster at negligible quality cost for a corpus
# this size and this kind of query.
EMBED_DIMS = 512
# Sections longer than this are split; roughly 2k characters is a comfortable chunk
# for retrieval — big enough to hold a whole answer, small enough to stay specific.
MAX_SECTION_CHARS = 2000
MIN_SECTION_CHARS = 80

# Docs that describe how to run or deploy the system rather than what it does.
# A payer asking product questions never wants these, and they crowd out real
# answers because they're long and full of prose.
SKIP_DOCS = {"DEPLOYMENT.md", "ENVIRONMENT_SETUP.md"}

_state: dict = {}


# ---------------------------------------------------------------------------
# Chunking
# ---------------------------------------------------------------------------
def _split_sections(text: str, doc_name: str) -> list[dict]:
    """Split markdown at ## / ### headings, keeping the heading trail as context
    so a retrieved chunk can say where it came from."""
    lines = text.splitlines()
    sections: list[dict] = []
    # Keep acronyms intact: BRD.md -> "BRD", not "Brd"; HLD.md -> "HLD".
    h1 = " ".join(w if w.isupper() else w.title()
                  for w in doc_name.replace(".md", "").split("_"))
    heading = h1
    buf: list[str] = []

    def flush():
        body = "\n".join(buf).strip()
        if len(body) < MIN_SECTION_CHARS:
            return
        # Long sections are cut on paragraph boundaries rather than mid-sentence.
        if len(body) <= MAX_SECTION_CHARS:
            parts = [body]
        else:
            parts, current = [], ""
            for para in body.split("\n\n"):
                if current and len(current) + len(para) > MAX_SECTION_CHARS:
                    parts.append(current.strip())
                    current = para
                else:
                    current = f"{current}\n\n{para}" if current else para
            if current.strip():
                parts.append(current.strip())
        for i, part in enumerate(parts):
            sections.append({
                "doc": doc_name,
                "heading": heading if len(parts) == 1 else f"{heading} ({i + 1}/{len(parts)})",
                "text": part,
            })

    for line in lines:
        m = re.match(r"^(#{1,3})\s+(.*)$", line)
        if m:
            flush()
            buf = []
            level, title = len(m.group(1)), m.group(2).strip()
            heading = title if level == 1 else f"{h1} — {title}"
            continue
        buf.append(line)
    flush()
    return sections


def _collect_sections() -> list[dict]:
    sections: list[dict] = []
    for path in sorted(DOCS_DIR.glob("*.md")):
        if path.name in SKIP_DOCS:
            continue
        try:
            sections.extend(_split_sections(path.read_text(encoding="utf-8"), path.name))
        except OSError as e:
            log.warning(f"skipping {path.name}: {e}")
    return sections


def _corpus_hash(sections: list[dict]) -> str:
    h = hashlib.sha256()
    for s in sections:
        h.update(s["doc"].encode())
        h.update(s["heading"].encode())
        h.update(s["text"].encode())
    h.update(f"{EMBED_MODEL}:{EMBED_DIMS}".encode())
    return h.hexdigest()[:16]


# ---------------------------------------------------------------------------
# Embedding
# ---------------------------------------------------------------------------
def _api_key() -> str | None:
    key = (get_settings().openai_api_key or "").strip()
    if not key or "your" in key.lower() or len(key) < 20:
        return None
    return key


def _embed(texts: list[str], key: str) -> np.ndarray:
    from openai import OpenAI
    client = OpenAI(api_key=key, timeout=60)
    out: list[list[float]] = []
    # Batched: one request per 96 sections keeps each payload well inside limits.
    for i in range(0, len(texts), 96):
        batch = texts[i:i + 96]
        resp = client.embeddings.create(model=EMBED_MODEL, input=batch, dimensions=EMBED_DIMS)
        out.extend(d.embedding for d in resp.data)
        log.info(f"embedded {min(i + len(batch), len(texts))}/{len(texts)} sections")
    arr = np.asarray(out, dtype=np.float32)
    # Pre-normalize so a query is a plain dot product later.
    norms = np.linalg.norm(arr, axis=1, keepdims=True)
    return arr / np.maximum(norms, 1e-9)


def build(force: bool = False) -> dict:
    """Build (or reuse) the on-disk index. Returns a small status dict."""
    sections = _collect_sections()
    if not sections:
        return {"ok": False, "error": "no_docs", "message": f"No markdown found in {DOCS_DIR}."}

    corpus_hash = _corpus_hash(sections)
    if not force and MANIFEST_PATH.exists() and VECTORS_PATH.exists():
        try:
            manifest = json.loads(MANIFEST_PATH.read_text(encoding="utf-8"))
            if manifest.get("corpus_hash") == corpus_hash:
                return {"ok": True, "cached": True, "sections": len(sections)}
        except (OSError, json.JSONDecodeError):
            pass

    key = _api_key()
    if not key:
        return {"ok": False, "error": "no_api_key",
                "message": "OPENAI_API_KEY is not configured, so docs can't be embedded."}

    log.info(f"building doc index: {len(sections)} sections from {DOCS_DIR}")
    vectors = _embed([f"{s['heading']}\n\n{s['text']}" for s in sections], key)

    CACHE_DIR.mkdir(parents=True, exist_ok=True)
    np.save(VECTORS_PATH, vectors)
    MANIFEST_PATH.write_text(json.dumps({
        "corpus_hash": corpus_hash,
        "model": EMBED_MODEL,
        "dims": EMBED_DIMS,
        "sections": sections,
    }), encoding="utf-8")
    _state.clear()
    return {"ok": True, "cached": False, "sections": len(sections)}


def _load() -> dict | None:
    """Load the index into memory once per process."""
    if _state.get("vectors") is not None:
        return _state
    status = build()
    if not status.get("ok"):
        _state["error"] = status
        return None
    try:
        manifest = json.loads(MANIFEST_PATH.read_text(encoding="utf-8"))
        _state["vectors"] = np.load(VECTORS_PATH)
        _state["sections"] = manifest["sections"]
        return _state
    except (OSError, KeyError, json.JSONDecodeError, ValueError) as e:
        log.warning(f"doc index unreadable, rebuilding: {e}")
        if build(force=True).get("ok"):
            _state["vectors"] = np.load(VECTORS_PATH)
            _state["sections"] = json.loads(MANIFEST_PATH.read_text(encoding="utf-8"))["sections"]
            return _state
        return None


# ---------------------------------------------------------------------------
# The tool
# ---------------------------------------------------------------------------
MAX_RESULTS = 4
MAX_CHARS_PER_RESULT = 1200
MIN_SCORE = 0.25


def search_docs(query: str, limit: int = 3) -> dict:
    """Search the product's own specification documents. Use for questions about
    how the product works — screens, workflows, dispute lifecycle, scoring method,
    roles — as opposed to questions about the plan's data."""
    q = (query or "").strip()
    if len(q) < 3:
        return {"error": "query_too_short", "message": "Give a fuller question to search for."}

    state = _load()
    if not state:
        err = _state.get("error", {})
        return {"error": err.get("error", "index_unavailable"),
                "message": err.get("message", "The documentation index is unavailable.")}

    key = _api_key()
    if not key:
        return {"error": "no_api_key",
                "message": "OPENAI_API_KEY is not configured, so docs can't be searched."}

    try:
        qv = _embed([q], key)[0]
    except Exception as e:                       # network/API failure shouldn't 500
        log.warning(f"query embedding failed: {e}")
        return {"error": "embedding_failed",
                "message": "Couldn't search the documentation just now."}

    scores = state["vectors"] @ qv
    limit = max(1, min(limit, MAX_RESULTS))
    top = np.argsort(-scores)[:limit]

    results = []
    for i in top:
        if float(scores[i]) < MIN_SCORE:
            continue
        s = state["sections"][int(i)]
        text = s["text"]
        results.append({
            "doc": s["doc"],
            "section": s["heading"],
            "relevance": round(float(scores[i]), 3),
            "text": text if len(text) <= MAX_CHARS_PER_RESULT else text[:MAX_CHARS_PER_RESULT] + " …",
        })

    if not results:
        return {"query": q, "results": [],
                "message": ("Nothing in the product documentation covers that. Say so rather "
                            "than guessing — this corpus is the whole product spec.")}
    return {"query": q, "results": results,
            "source_note": "Quoted from this product's own specification documents in docs/."}


if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
    print(build(force=True))
