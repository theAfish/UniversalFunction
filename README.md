# Universal Function

A playful web app where you describe **what x is** and **what y should be**, and an LLM agent writes Python code that creatively maps `f(x) = y`. Pipe a protein into music, a research PDF into a treasure map, your mood into an emoji constellation — anything goes.

## Setup

```powershell
# 1. Create a virtual environment (recommended)
python -m venv .venv
.\.venv\Scripts\Activate.ps1

# 2. Install backend dependencies
pip install -r requirements.txt
```

Make sure your `.env` has at least:

```
OPENAI_API_KEY=sk-...
OPENAI_API_BASE=https://dashscope.aliyuncs.com/compatible-mode/v1
MODEL=openai/glm-5.1
```

`MODEL` defaults to `openai/glm-5.1` if unset. Change it to any model your endpoint serves.

## Run

```powershell
uvicorn backend.main:app --reload --port 8000
```

Open http://localhost:8000 in your browser.

## How it works

1. You type two short descriptions (e.g. `x = a haiku`, `y = a generative SVG`) and click **conjure f**.
2. The backend asks the LLM (via `backend/agent.py`) for a strict JSON spec: input/output types, dependencies, and a Python `def run(input_data, workspace_dir)` body.
3. Any pip dependencies declared by the LLM are installed into the current environment.
4. The function code is saved into a per-session workspace under `workspaces/<id>/`.
5. When you hit **run f(x)**, the function executes in a fresh subprocess with a timeout. Its return dict tells the frontend how to render `y` (text, markdown, html, image, audio, file, json…).

Each session is an isolated folder, so you can keep many `f`s side by side. Sessions are listed in the left sidebar.

## Project layout

```
backend/
  main.py       FastAPI app & endpoints, mounts the frontend
  agent.py      LLM prompt + JSON spec extraction
  executor.py   subprocess runner with timeout + dependency install
  sessions.py   per-session workspace folders
frontend/
  index.html    f(x)=y stage with two description inputs
  style.css     warm, paper-like theme
  app.js        session sidebar, design view, run view, output renderer
workspaces/     created at runtime, one folder per session
```

## ⚠️ Security warning

This project **executes LLM-generated Python code on your machine**. Each run goes through a subprocess with a timeout, but there is no sandbox. Run it only on your own computer with models and inputs you trust. The system prompt asks the LLM to avoid network calls and env-var access, but that is not enforced.

If you want stronger isolation later, the `executor.execute()` subprocess call is the single chokepoint to swap for Docker / firejail / nsjail.

## Tunables

Set in `.env` or shell:

| Variable          | Default                              | Notes                                |
|-------------------|--------------------------------------|--------------------------------------|
| `OPENAI_API_KEY`  | —                                    | required                             |
| `OPENAI_API_BASE` | OpenAI default                       | e.g. dashscope compatible-mode URL   |
| `MODEL`           | `openai/glm-5.1`                     | model name passed to the API         |
| `EXEC_TIMEOUT`    | `60`                                 | per-run subprocess timeout (seconds) |
