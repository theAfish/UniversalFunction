"""Run LLM-generated function.py in a subprocess with timeout.

We pass input via a JSON payload on stdin and read a JSON result on stdout.
A small runner script is generated alongside function.py to handle (de)serialization.
"""
from __future__ import annotations

import base64
import json
import os
import subprocess
import sys
from pathlib import Path
from typing import Any

# On Windows, prevent the subprocess from inheriting the console so it cannot
# receive Ctrl+C signals that belong to the uvicorn process.
_CREATION_FLAGS = subprocess.CREATE_NO_WINDOW if sys.platform == "win32" else 0

DEFAULT_TIMEOUT = int(os.getenv("EXEC_TIMEOUT", "60"))

_RUNNER = r'''
import json, sys, traceback, importlib.util, os

payload = json.loads(sys.stdin.read())
fn_path = payload["function_path"]
input_data = payload["input_data"]
workspace_dir = payload["workspace_dir"]

spec = importlib.util.spec_from_file_location("user_function", fn_path)
mod = importlib.util.module_from_spec(spec)
try:
    spec.loader.exec_module(mod)
    if not hasattr(mod, "run"):
        raise RuntimeError("function.py must define `def run(input_data, workspace_dir)`")
    result = mod.run(input_data, workspace_dir)
    if not isinstance(result, dict):
        result = {"content": str(result)}
    print("__UF_RESULT__" + json.dumps(result, default=str))
except Exception as e:
    err = {"error": f"{type(e).__name__}: {e}", "traceback": traceback.format_exc()}
    print("__UF_RESULT__" + json.dumps(err))
'''


def ensure_dependencies(deps: list[str]) -> list[str]:
    """Install any missing dependencies via pip. Returns list of packages actually installed."""
    if not deps:
        return []
    installed: list[str] = []
    for pkg in deps:
        pkg = pkg.strip()
        if not pkg:
            continue
        # Probe import using top-level name (best-effort: pip name == import name)
        probe = pkg.split("[")[0].split("==")[0].split(">=")[0].split("<=")[0].strip()
        try:
            __import__(probe.replace("-", "_"))
            continue
        except Exception:
            pass
        try:
            subprocess.run(
                [sys.executable, "-m", "pip", "install", "--quiet", pkg],
                check=True,
                timeout=180,
            )
            installed.append(pkg)
        except Exception as e:
            # Don't crash — let the function attempt and surface a clearer error.
            installed.append(f"{pkg} (FAILED: {e})")
    return installed


def execute(
    function_path: Path,
    input_data: Any,
    workspace_dir: Path,
    timeout: int = DEFAULT_TIMEOUT,
) -> dict[str, Any]:
    runner_path = function_path.parent / "_runner.py"
    runner_path.write_text(_RUNNER, encoding="utf-8")

    payload = {
        "function_path": str(function_path),
        "input_data": input_data,
        "workspace_dir": str(workspace_dir),
    }
    try:
        proc = subprocess.run(
            [sys.executable, str(runner_path)],
            input=json.dumps(payload),
            capture_output=True,
            text=True,
            timeout=timeout,
            cwd=str(workspace_dir),
            creationflags=_CREATION_FLAGS,
        )
    except subprocess.TimeoutExpired:
        return {"error": f"Function timed out after {timeout}s"}

    stdout = proc.stdout or ""
    marker = "__UF_RESULT__"
    idx = stdout.rfind(marker)
    if idx == -1:
        return {
            "error": "Function did not produce a result",
            "stdout": stdout[-2000:],
            "stderr": (proc.stderr or "")[-2000:],
        }
    try:
        result = json.loads(stdout[idx + len(marker):].strip())
    except json.JSONDecodeError as e:
        return {"error": f"Bad result JSON: {e}", "stdout": stdout[-2000:]}

    # If the result references a file path inside the workspace, also embed as base64
    # so the frontend can render it without a second round-trip.
    if "path" in result and isinstance(result["path"], str):
        p = Path(result["path"])
        if not p.is_absolute():
            p = workspace_dir / p
        if p.exists() and p.is_file():
            try:
                data = p.read_bytes()
                if len(data) <= 8 * 1024 * 1024:  # 8MB cap inline
                    result["data_base64"] = base64.b64encode(data).decode("ascii")
                result["filename"] = p.name
                result["size"] = len(data)
            except Exception:
                pass
    return result
