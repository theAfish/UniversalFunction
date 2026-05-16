// Universal Function — frontend
const $ = (s) => document.querySelector(s);
const api = (path, opts = {}) => fetch(path, opts).then(async (r) => {
  if (!r.ok) {
    const t = await r.text();
    throw new Error(t || r.statusText);
  }
  return r.json();
});

const state = {
  sessionId: null,
  spec: null,
  meta: null,
};

// ---------- Sessions ----------
async function loadSessions() {
  const list = await api("/api/sessions");
  const ul = $("#sessionList");
  ul.innerHTML = "";
  list.forEach((s) => {
    const li = document.createElement("li");
    li.dataset.id = s.id;
    if (s.id === state.sessionId) li.classList.add("active");
    li.innerHTML = `<span class="sname">${escapeHtml(s.name)}</span><button class="sdel" title="delete">×</button>`;
    li.querySelector(".sname").onclick = () => selectSession(s.id);
    li.querySelector(".sdel").onclick = async (e) => {
      e.stopPropagation();
      if (!confirm(`Delete "${s.name}"?`)) return;
      await fetch(`/api/sessions/${s.id}`, { method: "DELETE" });
      if (state.sessionId === s.id) {
        state.sessionId = null;
        showDesignView({});
      }
      loadSessions();
    };
    ul.appendChild(li);
  });
}

async function newSession() {
  const s = await api("/api/sessions", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name: "Untitled f" }),
  });
  await loadSessions();
  selectSession(s.id);
}

async function selectSession(id) {
  state.sessionId = id;
  const s = await api(`/api/sessions/${id}`);
  state.meta = s.meta;
  state.spec = s.spec;
  $("#sessionName").value = s.meta.name || "";
  document.querySelectorAll("#sessionList li").forEach((li) =>
    li.classList.toggle("active", li.dataset.id === id)
  );
  if (s.spec) {
    showRunView(s.spec, s.meta);
  } else {
    showDesignView(s.meta);
  }
}

async function renameSession() {
  if (!state.sessionId) return;
  const name = $("#sessionName").value.trim() || "Untitled f";
  await fetch(`/api/sessions/${state.sessionId}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name }),
  });
  loadSessions();
}

// ---------- Views ----------
const _mc = document.createElement('canvas').getContext('2d');
let _descBaseH = null;

function autoResizeDesc(el) {
  const BASE_FONT = 96;
  const MIN_FONT = 22;
  const MAX_W = 260;
  const fontFamily = getComputedStyle(el).fontFamily;

  // Cache the natural single-line height at BASE_FONT (measured once)
  if (_descBaseH === null) {
    const sv = el.value;
    el.value = '\u00A0';
    el.style.fontSize = BASE_FONT + 'px';
    el.style.width = MAX_W + 'px';
    el.style.height = 'auto';
    _descBaseH = el.scrollHeight;
    el.value = sv;
  }
  const fixedH = _descBaseH;

  const text = el.value;
  if (!text) {
    el.style.fontSize = BASE_FONT + 'px';
    el.style.width = '84px';
    el.style.height = fixedH + 'px';
    return;
  }

  _mc.font = `italic ${BASE_FONT}px ${fontFamily}`;
  const rawW = _mc.measureText(text).width;

  if (rawW + 8 <= MAX_W) {
    // Fits on one line at BASE_FONT — no shrinking needed
    el.style.fontSize = BASE_FONT + 'px';
    el.style.width = Math.max(84, rawW + 8) + 'px';
    el.style.height = fixedH + 'px';
    return;
  }

  // Text wider than MAX_W. Binary-search for the largest font where
  // wrapped text still fits within fixedH.
  let lo = MIN_FONT, hi = BASE_FONT, bestFont = MIN_FONT;
  for (let i = 0; i < 20; i++) {
    const mid = (lo + hi) / 2;
    _mc.font = `italic ${mid}px ${fontFamily}`;
    const w = _mc.measureText(text).width;
    const lines = Math.ceil(w / MAX_W);
    // Scale the known single-line height by the font-size ratio
    const estimatedH = lines * fixedH * (mid / BASE_FONT);
    if (estimatedH <= fixedH) {
      bestFont = mid;
      lo = mid;
    } else {
      hi = mid;
    }
  }

  el.style.fontSize = bestFont + 'px';
  el.style.width = MAX_W + 'px';
  el.style.height = 'auto';
  // Only grow beyond fixedH when text is truly too long (min-font overflow)
  el.style.height = Math.max(fixedH, el.scrollHeight) + 'px';
}

function showDesignView(meta) {
  $("#designView").classList.remove("hidden");
  $("#runView").classList.add("hidden");
  $("#xDesc").value = meta?.x_description || "";
  $("#yDesc").value = meta?.y_description || "";
  autoResizeDesc($("#xDesc"));
  autoResizeDesc($("#yDesc"));
  $("#tagline").textContent = "";
  setStatus("");
}

function showRunView(spec, meta) {
  $("#designView").classList.add("hidden");
  $("#runView").classList.remove("hidden");
  $("#runName").textContent = spec.name || "f";
  $("#runTagline").textContent = spec.tagline || "";
  $("#xLabel").textContent = (spec.input?.label) || "input";
  $("#yLabel").textContent = (spec.output?.label) || "output";
  $("#codeView").textContent = spec.code || "";
  buildInputWidget(spec.input || {});
  $("#yWidget").innerHTML = '<div class="placeholder">y will appear here</div>';
  setStatus("");
}

function buildInputWidget(input) {
  const host = $("#xWidget");
  host.innerHTML = "";
  const t = input.type || "text";
  if (t === "file" || t === "image" || t === "pdf" || t === "audio") {
    const inp = document.createElement("input");
    inp.type = "file";
    inp.id = "xFile";
    if (input.accept) inp.accept = input.accept;
    else if (t === "image") inp.accept = "image/*";
    else if (t === "pdf") inp.accept = ".pdf,application/pdf";
    else if (t === "audio") inp.accept = "audio/*";
    host.appendChild(inp);
    if (input.label) {
      const hint = document.createElement("div");
      hint.style.color = "var(--ink-soft)";
      hint.style.fontSize = "13px";
      hint.textContent = input.label;
      host.appendChild(hint);
    }
  } else if (t === "number") {
    const inp = document.createElement("input");
    inp.type = "number";
    inp.id = "xValue";
    inp.placeholder = input.label || "";
    inp.step = "any";
    host.appendChild(inp);
  } else if (t === "text") {
    const inp = document.createElement("input");
    inp.type = "text";
    inp.id = "xValue";
    inp.placeholder = input.label || "";
    host.appendChild(inp);
  } else {
    // longtext, json, fallback
    const ta = document.createElement("textarea");
    ta.id = "xValue";
    ta.placeholder = input.label || "";
    if (t === "json") ta.placeholder = (input.label || "") + "  (JSON)";
    host.appendChild(ta);
  }
}

function collectInput(input) {
  const t = input.type || "text";
  if (t === "file" || t === "image" || t === "pdf" || t === "audio") {
    const f = $("#xFile").files[0];
    if (!f) throw new Error("please choose a file");
    return { file: f, payload: {} };
  }
  const el = $("#xValue");
  return { file: null, payload: { value: el ? el.value : "" } };
}

// ---------- Render output ----------
function renderOutput(spec, result) {
  const host = $("#yWidget");
  host.innerHTML = "";
  if (!result) {
    host.innerHTML = '<div class="placeholder">no result</div>';
    return;
  }
  if (result.error) {
    const div = document.createElement("div");
    div.className = "err";
    div.textContent = result.error + (result.traceback ? "\n\n" + result.traceback : "")
      + (result.stderr ? "\n\nSTDERR:\n" + result.stderr : "");
    host.appendChild(div);
    return;
  }
  const out = spec.output || {};
  const t = out.type || "text";
  const mime = result.mime || guessMime(t, result.filename || "");

  if (result.data_base64 && (t === "image" || mime.startsWith("image/"))) {
    const img = document.createElement("img");
    img.src = `data:${mime || "image/png"};base64,${result.data_base64}`;
    host.appendChild(img);
  } else if (result.data_base64 && (t === "audio" || mime.startsWith("audio/"))) {
    const a = document.createElement("audio");
    a.controls = true;
    a.src = `data:${mime || "audio/wav"};base64,${result.data_base64}`;
    host.appendChild(a);
  } else if (t === "html" && typeof result.content === "string") {
    const wrap = document.createElement("div");
    wrap.innerHTML = result.content;
    host.appendChild(wrap);
  } else if (t === "markdown" && typeof result.content === "string") {
    const pre = document.createElement("div");
    pre.innerHTML = renderMarkdown(result.content);
    host.appendChild(pre);
  } else if (t === "json") {
    const pre = document.createElement("pre");
    pre.textContent = typeof result.content === "string"
      ? result.content
      : JSON.stringify(result.content, null, 2);
    host.appendChild(pre);
  } else if (typeof result.content === "string") {
    const pre = document.createElement("pre");
    pre.textContent = result.content;
    host.appendChild(pre);
  } else if (result.path && state.sessionId) {
    const name = result.filename || result.path.split(/[\\/]/).pop();
    const url = `/api/sessions/${state.sessionId}/file?name=${encodeURIComponent(name)}`;
    const a = document.createElement("a");
    a.href = url;
    a.className = "download";
    a.textContent = `↓ ${name}`;
    a.download = name;
    host.appendChild(a);
  } else {
    const pre = document.createElement("pre");
    pre.textContent = JSON.stringify(result, null, 2);
    host.appendChild(pre);
  }

  if (result.caption) {
    const cap = document.createElement("div");
    cap.className = "caption";
    cap.textContent = result.caption;
    host.appendChild(cap);
  }
}

function guessMime(type, filename) {
  const ext = (filename.split(".").pop() || "").toLowerCase();
  const map = {
    png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", gif: "image/gif",
    webp: "image/webp", svg: "image/svg+xml",
    wav: "audio/wav", mp3: "audio/mpeg", ogg: "audio/ogg", mid: "audio/midi",
    pdf: "application/pdf", json: "application/json", txt: "text/plain",
  };
  if (map[ext]) return map[ext];
  if (type === "image") return "image/png";
  if (type === "audio") return "audio/wav";
  return "";
}

// Tiny markdown renderer (headers, bold, italics, code, lists)
function renderMarkdown(md) {
  const esc = escapeHtml(md);
  return esc
    .replace(/^### (.*)$/gm, "<h3>$1</h3>")
    .replace(/^## (.*)$/gm, "<h2>$1</h2>")
    .replace(/^# (.*)$/gm, "<h1>$1</h1>")
    .replace(/\*\*(.+?)\*\*/g, "<b>$1</b>")
    .replace(/\*(.+?)\*/g, "<i>$1</i>")
    .replace(/`([^`]+)`/g, "<code>$1</code>")
    .replace(/\n\n/g, "</p><p>")
    .replace(/\n/g, "<br>")
    .replace(/^/, "<p>") + "</p>";
}

function escapeHtml(s) {
  return String(s ?? "")
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

function setStatus(msg, isErr = false) {
  const el = $("#status");
  el.textContent = msg;
  el.classList.toggle("err", !!isErr);
}

// ---------- Define / Run ----------
async function defineFunction() {
  if (!state.sessionId) await newSession();
  const x = $("#xDesc").value.trim();
  const y = $("#yDesc").value.trim();
  if (!x || !y) {
    setStatus("describe both x and y first", true);
    return;
  }
  const btn = $("#defineBtn");
  btn.disabled = true;
  setStatus("the LLM is dreaming up your function…");
  try {
    const r = await api(`/api/sessions/${state.sessionId}/define`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ x_description: x, y_description: y }),
    });
    state.spec = r.spec;
    state.meta = r.session.meta;
    if (r.installed && r.installed.length) {
      setStatus("installed: " + r.installed.join(", "));
    } else {
      setStatus("ready");
    }
    showRunView(r.spec, r.meta);
    loadSessions();
  } catch (e) {
    setStatus(String(e.message || e), true);
  } finally {
    btn.disabled = false;
  }
}

async function runFunction() {
  if (!state.sessionId || !state.spec) return;
  let collected;
  try {
    collected = collectInput(state.spec.input || {});
  } catch (e) {
    setStatus(e.message, true);
    return;
  }
  const btn = $("#runBtn");
  btn.disabled = true;
  setStatus("running f(x)…");
  $("#yWidget").innerHTML = '<div class="placeholder">computing…</div>';
  try {
    const fd = new FormData();
    fd.append("payload", JSON.stringify(collected.payload));
    if (collected.file) fd.append("file", collected.file);
    const res = await fetch(`/api/sessions/${state.sessionId}/run`, {
      method: "POST",
      body: fd,
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.detail || res.statusText);
    renderOutput(data.spec, data.result);
    setStatus(data.result.error ? "f errored" : "done");
  } catch (e) {
    setStatus(String(e.message || e), true);
    $("#yWidget").innerHTML = `<div class="err">${escapeHtml(e.message)}</div>`;
  } finally {
    btn.disabled = false;
  }
}

// ---------- Wire up ----------
$("#newSessionBtn").onclick = newSession;
$("#defineBtn").onclick = defineFunction;
$("#runBtn").onclick = runFunction;
$("#redesignBtn").onclick = () => showDesignView(state.meta || {});
$("#sessionName").addEventListener("change", renameSession);
["xDesc", "yDesc"].forEach(id => {
  const el = document.getElementById(id);
  el.addEventListener("input", () => autoResizeDesc(el));
  autoResizeDesc(el);
});

(async function init() {
  await loadSessions();
  const list = await api("/api/sessions");
  if (list.length === 0) {
    await newSession();
  } else {
    selectSession(list[0].id);
  }
})();
