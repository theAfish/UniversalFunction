"""Per-session workspace management.

Each session has its own folder under WORKSPACES_ROOT containing:
  meta.json        — session metadata (name, x_desc, y_desc, current spec)
  function.py      — the latest LLM-generated code
  spec.json        — the latest LLM spec (input/output schema, deps, etc.)
  uploads/         — user-uploaded input files
  outputs/         — files produced by run()
"""
from __future__ import annotations

import json
import shutil
import time
import uuid
from pathlib import Path
from typing import Any

WORKSPACES_ROOT = Path(__file__).resolve().parent.parent / "workspaces"
WORKSPACES_ROOT.mkdir(parents=True, exist_ok=True)


def _now() -> float:
    return time.time()


def _meta_path(session_dir: Path) -> Path:
    return session_dir / "meta.json"


def list_sessions() -> list[dict[str, Any]]:
    out = []
    for d in sorted(WORKSPACES_ROOT.iterdir(), key=lambda p: p.stat().st_mtime, reverse=True):
        if not d.is_dir():
            continue
        meta = _read_meta(d)
        if meta is None:
            continue
        out.append({
            "id": d.name,
            "name": meta.get("name", "untitled"),
            "updated_at": meta.get("updated_at", 0),
            "has_function": (d / "spec.json").exists(),
        })
    return out


def _read_meta(session_dir: Path) -> dict[str, Any] | None:
    p = _meta_path(session_dir)
    if not p.exists():
        return None
    try:
        return json.loads(p.read_text(encoding="utf-8"))
    except json.JSONDecodeError:
        return None


def _write_meta(session_dir: Path, meta: dict[str, Any]) -> None:
    meta["updated_at"] = _now()
    _meta_path(session_dir).write_text(
        json.dumps(meta, indent=2, ensure_ascii=False), encoding="utf-8"
    )


def create_session(name: str | None = None) -> dict[str, Any]:
    sid = uuid.uuid4().hex[:12]
    d = WORKSPACES_ROOT / sid
    (d / "uploads").mkdir(parents=True, exist_ok=True)
    (d / "outputs").mkdir(parents=True, exist_ok=True)
    meta = {
        "id": sid,
        "name": name or "Untitled f",
        "x_description": "",
        "y_description": "",
        "created_at": _now(),
    }
    _write_meta(d, meta)
    return get_session(sid)


def session_dir(session_id: str) -> Path:
    d = WORKSPACES_ROOT / session_id
    if not d.is_dir() or not _meta_path(d).exists():
        raise KeyError(f"Unknown session: {session_id}")
    return d


def get_session(session_id: str) -> dict[str, Any]:
    d = session_dir(session_id)
    meta = _read_meta(d) or {}
    spec = None
    sp = d / "spec.json"
    if sp.exists():
        try:
            spec = json.loads(sp.read_text(encoding="utf-8"))
        except json.JSONDecodeError:
            spec = None
    return {
        "id": session_id,
        "meta": meta,
        "spec": spec,
    }


def update_meta(session_id: str, **fields: Any) -> dict[str, Any]:
    d = session_dir(session_id)
    meta = _read_meta(d) or {}
    meta.update(fields)
    _write_meta(d, meta)
    return get_session(session_id)


def save_spec(session_id: str, spec: dict[str, Any]) -> None:
    d = session_dir(session_id)
    (d / "spec.json").write_text(
        json.dumps(spec, indent=2, ensure_ascii=False), encoding="utf-8"
    )
    code = spec.get("code", "")
    (d / "function.py").write_text(code, encoding="utf-8")


def delete_session(session_id: str) -> None:
    d = WORKSPACES_ROOT / session_id
    if d.is_dir():
        shutil.rmtree(d, ignore_errors=True)


def save_upload(session_id: str, filename: str, data: bytes) -> Path:
    d = session_dir(session_id) / "uploads"
    safe = filename.replace("\\", "_").replace("/", "_")
    target = d / f"{int(_now()*1000)}_{safe}"
    target.write_bytes(data)
    return target


def outputs_dir(session_id: str) -> Path:
    return session_dir(session_id) / "outputs"
