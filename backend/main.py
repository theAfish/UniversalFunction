"""FastAPI app for Universal Function."""
from __future__ import annotations

import json
from pathlib import Path
from typing import Any, List, Optional

from dotenv import load_dotenv
from fastapi import FastAPI, File, Form, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from starlette.concurrency import run_in_threadpool
from fastapi.responses import FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel

# Load .env early so agent.py can read OPENAI_* vars.
load_dotenv(Path(__file__).resolve().parent.parent / ".env")

from . import agent, executor, sessions  # noqa: E402

app = FastAPI(title="Universal Function")
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)


# ---------- Schemas ----------
class CreateSessionBody(BaseModel):
    name: Optional[str] = None


class DefineBody(BaseModel):
    x_description: str
    y_description: str


class RenameBody(BaseModel):
    name: str


# ---------- Session endpoints ----------
@app.get("/api/sessions")
def api_list_sessions() -> List[dict]:
    return sessions.list_sessions()


@app.post("/api/sessions")
def api_create_session(body: CreateSessionBody) -> dict[str, Any]:
    return sessions.create_session(body.name)


@app.get("/api/sessions/{sid}")
def api_get_session(sid: str) -> dict[str, Any]:
    try:
        return sessions.get_session(sid)
    except KeyError:
        raise HTTPException(404, "session not found")


@app.patch("/api/sessions/{sid}")
def api_rename_session(sid: str, body: RenameBody) -> dict[str, Any]:
    try:
        return sessions.update_meta(sid, name=body.name)
    except KeyError:
        raise HTTPException(404, "session not found")


@app.delete("/api/sessions/{sid}")
def api_delete_session(sid: str) -> dict[str, str]:
    sessions.delete_session(sid)
    return {"status": "ok"}


# ---------- Define / execute ----------
@app.post("/api/sessions/{sid}/define")
def api_define(sid: str, body: DefineBody) -> dict[str, Any]:
    try:
        sessions.session_dir(sid)
    except KeyError:
        raise HTTPException(404, "session not found")

    try:
        spec = agent.design_function(body.x_description, body.y_description)
    except Exception as e:
        raise HTTPException(500, f"LLM design failed: {e}")

    sessions.save_spec(sid, spec)
    sessions.update_meta(
        sid,
        x_description=body.x_description,
        y_description=body.y_description,
    )

    installed = executor.ensure_dependencies(spec.get("dependencies", []) or [])
    return {"spec": spec, "installed": installed, "session": sessions.get_session(sid)}


@app.post("/api/sessions/{sid}/run")
async def api_run(
    sid: str,
    payload: str = Form(default="{}"),
    file: Optional[UploadFile] = File(default=None),
) -> JSONResponse:
    try:
        sdir = sessions.session_dir(sid)
    except KeyError:
        raise HTTPException(404, "session not found")

    spec_path = sdir / "spec.json"
    fn_path = sdir / "function.py"
    if not spec_path.exists() or not fn_path.exists():
        raise HTTPException(400, "function not defined yet for this session")

    spec = json.loads(spec_path.read_text(encoding="utf-8"))
    in_type = (spec.get("input") or {}).get("type", "text")

    # Resolve the actual input value.
    try:
        parsed = json.loads(payload) if payload else {}
    except json.JSONDecodeError:
        parsed = {"value": payload}

    input_data: Any
    if in_type in ("file", "image", "pdf", "audio"):
        if file is None:
            raise HTTPException(400, "this function requires a file upload")
        data = await file.read()
        saved = sessions.save_upload(sid, file.filename or "upload.bin", data)
        input_data = str(saved)
    elif in_type == "number":
        try:
            input_data = float(parsed.get("value"))
        except (TypeError, ValueError):
            raise HTTPException(400, "value must be a number")
    elif in_type == "json":
        v = parsed.get("value")
        if isinstance(v, str):
            try:
                input_data = json.loads(v)
            except json.JSONDecodeError:
                input_data = v
        else:
            input_data = v
    else:  # text / longtext / fallback
        input_data = parsed.get("value", "")

    result = await run_in_threadpool(executor.execute, fn_path, input_data, sdir)
    return JSONResponse({"result": result, "spec": spec})


@app.get("/api/sessions/{sid}/file")
def api_get_file(sid: str, name: str) -> FileResponse:
    try:
        sdir = sessions.session_dir(sid)
    except KeyError:
        raise HTTPException(404, "session not found")
    # Restrict to outputs/ and uploads/
    for sub in ("outputs", "uploads"):
        p = (sdir / sub / name).resolve()
        if p.exists() and p.is_file() and str(p).startswith(str(sdir.resolve())):
            return FileResponse(p)
    raise HTTPException(404, "file not found")


# ---------- Static frontend ----------
_FRONTEND = Path(__file__).resolve().parent.parent / "frontend"
if _FRONTEND.is_dir():
    app.mount("/", StaticFiles(directory=str(_FRONTEND), html=True), name="frontend")
