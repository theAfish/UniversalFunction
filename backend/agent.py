"""LLM agent: turns user descriptions of x and y into an executable mapping function.

The agent asks the LLM to return a two-part response:
  PART 1 — JSON spec (input/output types, labels, deps) — NO code field
  PART 2 — Python code in a ```python fence

Separating code from JSON avoids escaping nightmares with embedded strings.
"""
from __future__ import annotations

import ast
import json
import os
import re
from typing import Any

from openai import OpenAI

_SYSTEM_PROMPT = """You are the brain of "Universal Function" — a playful tool that
turns ANY user-described mapping `f(x) = y` into a real, runnable Python function.

The user gives you two short freeform descriptions:
  * X_DESCRIPTION — what they want to feed in (e.g. "a protein sequence",
    "a research PDF", "my mood as text", "an image of a cat").
  * Y_DESCRIPTION — what they want out (e.g. "a piece of music",
    "a treasure map", "an emoji story", "a 3D ascii sculpture").

Be CREATIVE, playful, and self-contained. Prefer pure-Python or stdlib tricks.
You may use small popular libraries when truly useful (numpy, pillow, matplotlib,
midiutil, qrcode, markdown, pypdf, mido). Avoid anything that needs API keys,
GPUs, or huge downloads. Code must run offline once dependencies are installed.

Your response MUST have exactly two parts, in this order:

──────────────────────────────
PART 1 — a JSON block (inside ```json fences) with this schema:

{
  "name": "short snake_case name",
  "tagline": "one fun sentence about what this f does",
  "input": {
    "type": "text" | "longtext" | "number" | "file" | "image" | "pdf" | "audio" | "json",
    "label": "placeholder text shown in the input box",
    "accept": "optional MIME hint for file inputs, e.g. 'image/*' or '.pdf'"
  },
  "output": {
    "type": "text" | "markdown" | "html" | "image" | "audio" | "file" | "json",
    "label": "short caption shown above the y box"
  },
  "dependencies": ["pip-installable", "package", "names"]
}

PART 2 — the Python implementation inside ```python fences.
──────────────────────────────

The Python code MUST define exactly:

    def run(input_data, workspace_dir):
        # input_data: see contract below
        # workspace_dir: str path you may read/write inside
        # return: a dict matching the OUTPUT CONTRACT below
        ...

INPUT CONTRACT (what `input_data` will be):
  * text / longtext / json   -> the raw string / parsed object
  * number                   -> float
  * file / image / pdf / audio -> absolute filesystem path (str) to the uploaded file

OUTPUT CONTRACT (what `run` must return):
  Return ONE dict shaped like the declared output type:
    text/markdown/html/json -> {"content": <str or json-serializable>}
    image/audio/file        -> {"path": "<absolute path inside workspace_dir>"}
                               optionally also {"mime": "image/png"}
  You may also include {"caption": "..."} for any type.

RULES:
  * The code must be self-contained — all imports inside the function or at module top.
  * Never call network APIs. Never read env vars. Never exec/eval untrusted strings.
  * Keep runtime under ~20 seconds for typical inputs.
  * If the mapping is genuinely impossible deterministically, fake it CREATIVELY
    using hashes of the input as a seed — this tool is meant to be FUN.
  * Always handle edge cases (empty input, bad file) by returning a friendly result.
  * Write any output files INSIDE workspace_dir using unique filenames.
"""


def _make_client() -> OpenAI:
    api_key = os.getenv("OPENAI_API_KEY")
    base_url = os.getenv("OPENAI_API_BASE") or os.getenv("OPENAI_BASE_URL")
    if not api_key:
        raise RuntimeError("OPENAI_API_KEY not set in environment / .env")
    return OpenAI(api_key=api_key, base_url=base_url)


def _extract_fenced_block(text: str, lang: str) -> str | None:
    """Return the first fenced block matching ```lang ... ``` (content only)."""
    pattern = rf"```{lang}\s*\n(.*?)```"
    m = re.search(pattern, text, re.DOTALL | re.IGNORECASE)
    if m:
        return m.group(1).strip()
    # Fallback: any fenced block if the specific lang isn't found
    if lang != "":
        m = re.search(r"```[a-zA-Z0-9_+-]*\s*\n(.*?)```", text, re.DOTALL)
        if m:
            return m.group(1).strip()
    return None


def _parse_response(raw: str) -> tuple[dict[str, Any], str]:
    """Extract (spec_dict_without_code, python_code) from the two-part LLM response."""
    # --- Extract JSON spec ---
    json_block = _extract_fenced_block(raw, "json")
    if json_block is None:
        # Maybe the LLM omitted fences — try to find a bare {...}
        start = raw.find("{")
        end = raw.rfind("}")
        if start != -1 and end > start:
            json_block = raw[start: end + 1]
        else:
            raise ValueError("LLM response contains no JSON block.\n" + raw[:600])
    try:
        spec = json.loads(json_block)
    except json.JSONDecodeError as e:
        raise ValueError(f"JSON parse error: {e}\nJSON block:\n{json_block[:600]}") from e

    # --- Extract Python code ---
    code = _extract_fenced_block(raw, "python")
    if code is None:
        # Fallback: look for any ```...``` block that isn't the JSON one
        blocks = re.findall(r"```[a-zA-Z0-9_+-]*\s*\n(.*?)```", raw, re.DOTALL)
        # The first block was (likely) JSON, so take the second if available
        if len(blocks) >= 2:
            code = blocks[1].strip()
        elif blocks:
            code = blocks[0].strip()
        else:
            raise ValueError("LLM response contains no Python code block.\n" + raw[:600])

    if "def run(" not in code:
        raise ValueError("Generated code does not define `def run(input_data, workspace_dir)`.")

    return spec, code


def _validate_code_syntax(code: str) -> str | None:
    """Return a human-readable error string if the code has a syntax error, else None."""
    try:
        ast.parse(code)
        return None
    except SyntaxError as e:
        return f"SyntaxError at line {e.lineno}: {e.msg}\n  {e.text or ''}"


_MAX_DEBUG_RETRIES = 3


def design_function(x_description: str, y_description: str) -> dict[str, Any]:
    """Ask the LLM to design a mapping function. Returns the parsed spec dict (with code).

    After generating code the agent validates the syntax and, if broken, feeds the
    error back to the LLM for a fix — up to _MAX_DEBUG_RETRIES times.
    """
    client = _make_client()
    model = os.getenv("MODEL", "qwen-plus")

    user_prompt = (
        f"X_DESCRIPTION: {x_description.strip() or '(unspecified)'}\n"
        f"Y_DESCRIPTION: {y_description.strip() or '(unspecified)'}\n\n"
        "Design the most fun, creative, runnable mapping. "
        "Reply with the JSON block first (```json ... ```) then the Python code (```python ... ```)."
    )

    messages: list[dict] = [
        {"role": "system", "content": _SYSTEM_PROMPT},
        {"role": "user", "content": user_prompt},
    ]

    last_error: str | None = None
    for attempt in range(1, _MAX_DEBUG_RETRIES + 1):
        resp = client.chat.completions.create(
            model=model,
            messages=messages,
            temperature=0.9,
        )
        raw = resp.choices[0].message.content or ""

        try:
            spec, code = _parse_response(raw)
        except ValueError as e:
            # Structural parse error — ask LLM to re-emit the full response correctly.
            last_error = str(e)
            messages.append({"role": "assistant", "content": raw})
            messages.append({
                "role": "user",
                "content": (
                    f"Your previous response could not be parsed (attempt {attempt}/{_MAX_DEBUG_RETRIES}).\n"
                    f"Error: {last_error}\n\n"
                    "Please re-send the FULL response: ```json ... ``` block first, "
                    "then the ```python ... ``` block. Fix any issues."
                ),
            })
            continue

        syntax_error = _validate_code_syntax(code)
        if syntax_error is None:
            # Code is syntactically valid — we're done.
            break

        # Syntax error found — ask the LLM to fix it.
        last_error = syntax_error
        messages.append({"role": "assistant", "content": raw})
        messages.append({
            "role": "user",
            "content": (
                f"Your Python code has a syntax error (attempt {attempt}/{_MAX_DEBUG_RETRIES}):\n\n"
                f"```\n{syntax_error}\n```\n\n"
                "Please re-send the FULL response (```json``` block then fixed ```python``` block). "
                "Make sure the Python code parses without any SyntaxError."
            ),
        })
    else:
        raise ValueError(
            f"LLM failed to produce valid Python after {_MAX_DEBUG_RETRIES} attempts. "
            f"Last error: {last_error}"
        )

    # Attach code and fill defaults
    spec["code"] = code
    spec.setdefault("name", "universal_function")
    spec.setdefault("tagline", "")
    spec.setdefault("dependencies", [])
    spec.setdefault("input", {})
    spec.setdefault("output", {})
    spec["input"].setdefault("type", "text")
    spec["input"].setdefault("label", "your input")
    spec["output"].setdefault("type", "text")
    spec["output"].setdefault("label", "result")
    return spec
