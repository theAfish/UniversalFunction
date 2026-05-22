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
  busy: false,
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
  // Bail out if a define/run operation is in progress to avoid clobbering state
  if (state.busy) return;
  // Auto-rename legacy sessions that have a spec but still carry the default name.
  if (s.spec?.name && s.meta.name === "Untitled f") {
    await fetch(`/api/sessions/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: s.spec.name }),
    });
    s.meta.name = s.spec.name;
    loadSessions();
  }
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
  const MIN_FONT = 18;
  const MIN_W = 84;
  const MAX_W = 260;
  const MAX_LINES_BEFORE_GROW = 2;
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
    el.style.width = MIN_W + 'px';
    el.style.height = fixedH + 'px';
    return;
  }

  _mc.font = `italic ${BASE_FONT}px ${fontFamily}`;
  const rawW = _mc.measureText(text).width;

  if (rawW + 8 <= MAX_W) {
    // Stage 1: keep large font and only grow width from compact to max.
    el.style.fontSize = BASE_FONT + 'px';
    el.style.width = Math.max(MIN_W, rawW + 8) + 'px';
    el.style.height = fixedH + 'px';
    return;
  }

  // Stage 2: lock width, keep at most two visible lines, and shrink font.
  // Stage 3: once minimum font is reached, start growing height for extra text.
  const fontForMaxLines = (MAX_LINES_BEFORE_GROW * MAX_W * BASE_FONT) / rawW;
  const chosenFont = Math.min(BASE_FONT, Math.max(MIN_FONT, fontForMaxLines));

  el.style.fontSize = chosenFont + 'px';
  el.style.width = MAX_W + 'px';

  if (fontForMaxLines >= MIN_FONT) {
    const twoLineH = fixedH * (chosenFont / BASE_FONT) * MAX_LINES_BEFORE_GROW;
    el.style.height = twoLineH + 'px';
    return;
  }

  el.style.height = 'auto';
  const minTwoLineH = fixedH * (MIN_FONT / BASE_FONT) * MAX_LINES_BEFORE_GROW;
  el.style.height = Math.max(minTwoLineH, el.scrollHeight) + 'px';
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
  } else if (result.data_base64 && (mime === "audio/midi" || mime === "audio/mid" || (result.filename || "").match(/\.midi?$/i))) {
    const bytes = Uint8Array.from(atob(result.data_base64), c => c.charCodeAt(0));
    const blob = new Blob([bytes], { type: "audio/midi" });
    const url = URL.createObjectURL(blob);
    const player = document.createElement("midi-player");
    player.setAttribute("src", url);
    player.setAttribute("sound-font", "");
    host.appendChild(player);
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
  // Capture inputs first — newSession() may reset them via showDesignView
  const x = $("#xDesc").value.trim();
  const y = $("#yDesc").value.trim();
  if (!x || !y) {
    setStatus("describe both x and y first", true);
    return;
  }
  const btn = $("#defineBtn");
  btn.disabled = true;
  state.busy = true;
  if (!state.sessionId) await newSession();
  // Restore inputs and status in case newSession's selectSession cleared them
  $("#xDesc").value = x;
  $("#yDesc").value = y;
  autoResizeDesc($("#xDesc"));
  autoResizeDesc($("#yDesc"));
  setStatus("the LLM is dreaming up your function…");
  try {
    const r = await api(`/api/sessions/${state.sessionId}/define`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ x_description: x, y_description: y }),
    });
    state.spec = r.spec;
    state.meta = r.session.meta;
    // Auto-title the session from the spec name if it hasn't been renamed yet
    if (r.spec.name && state.meta.name === "Untitled f") {
      await fetch(`/api/sessions/${state.sessionId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: r.spec.name }),
      });
      state.meta.name = r.spec.name;
      $("#sessionName").value = r.spec.name;
    }
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
    state.busy = false;
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

// ---------- Settings ----------
async function loadSettings() {
  const s = await api("/api/settings");
  document.getElementById("setApiKey").value = s.OPENAI_API_KEY || "";
  document.getElementById("setApiBase").value = s.OPENAI_API_BASE || "";
  document.getElementById("setModel").value = s.MODEL || "";
  document.getElementById("setExecTimeout").value = s.EXEC_TIMEOUT || "60";
}

async function saveSettings() {
  const statusEl = document.getElementById("settingsStatus");
  statusEl.classList.remove("err");
  statusEl.textContent = "Saving…";
  try {
    await api("/api/settings", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        OPENAI_API_KEY: document.getElementById("setApiKey").value,
        OPENAI_API_BASE: document.getElementById("setApiBase").value,
        MODEL: document.getElementById("setModel").value,
        EXEC_TIMEOUT: document.getElementById("setExecTimeout").value,
      }),
    });
    statusEl.textContent = "Saved ✓";
    setTimeout(() => { statusEl.textContent = ""; }, 2500);
  } catch (e) {
    statusEl.textContent = "Error: " + (e.message || e);
    statusEl.classList.add("err");
  }
}

const settingsOverlay = document.getElementById("settingsOverlay");
document.getElementById("settingsBtn").onclick = () => {
  loadSettings();
  settingsOverlay.classList.remove("hidden");
};
document.getElementById("closeSettingsBtn").onclick = () => settingsOverlay.classList.add("hidden");
settingsOverlay.addEventListener("click", (e) => {
  if (e.target === settingsOverlay) settingsOverlay.classList.add("hidden");
});
document.getElementById("saveSettingsBtn").onclick = saveSettings;

// Toggle password visibility
document.querySelectorAll(".toggle-pw").forEach((btn) => {
  btn.addEventListener("click", () => {
    const inp = document.getElementById(btn.dataset.target);
    inp.type = inp.type === "password" ? "text" : "password";
  });
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
