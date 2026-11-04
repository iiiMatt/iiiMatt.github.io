// Quiz Friendz flashcards: decrypts cards.enc.json in the browser and runs
// SM-2 spaced repetition. Progress lives in this browser's localStorage and
// can be moved between devices with an export code.

const DAY = 86400000;
const app = document.getElementById("app");
let cfg, categories, person, progress, session;

// ---------- small helpers ----------

function h(tag, attrs = {}, ...children) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === "class") el.className = v;
    else if (k.startsWith("on")) el.addEventListener(k.slice(2), v);
    else if (v === true) el.setAttribute(k, "");
    else if (v !== false && v != null) el.setAttribute(k, v);
  }
  for (const c of children.flat()) {
    if (c != null && c !== false) el.append(c instanceof Node ? c : String(c));
  }
  return el;
}

function render(...nodes) {
  app.replaceChildren(...nodes);
  window.scrollTo(0, 0);
}

const store = {
  get(key) { try { return localStorage.getItem(key); } catch { return null; } },
  set(key, val) { try { localStorage.setItem(key, val); } catch {} },
  del(key) { try { localStorage.removeItem(key); } catch {} },
};

function localDate(t = Date.now()) {
  const d = new Date(t);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
function startOfToday() {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}
function daysUntilQuiz() {
  if (!cfg.quizDate) return null;
  const [y, m, d] = cfg.quizDate.split("-").map(Number);
  return Math.round((new Date(y, m - 1, d).getTime() - startOfToday()) / DAY);
}

const b64 = {
  toBytes: (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0)),
  fromText: (s) => {
    let bin = "";
    for (const byte of new TextEncoder().encode(s)) bin += String.fromCharCode(byte);
    return btoa(bin);
  },
  toText: (s) => new TextDecoder().decode(b64.toBytes(s.trim())),
};

// ---------- decryption ----------

async function decrypt(enc, password) {
  const base = await crypto.subtle.importKey("raw", new TextEncoder().encode(password), "PBKDF2", false, ["deriveKey"]);
  const key = await crypto.subtle.deriveKey(
    { name: "PBKDF2", salt: b64.toBytes(enc.salt), iterations: enc.iter, hash: "SHA-256" },
    base, { name: "AES-GCM", length: 256 }, false, ["decrypt"]
  );
  const plain = await crypto.subtle.decrypt({ name: "AES-GCM", iv: b64.toBytes(enc.iv) }, key, b64.toBytes(enc.data));
  return JSON.parse(new TextDecoder().decode(plain));
}

// ---------- progress ----------

function loadProgress(name) {
  try {
    const p = JSON.parse(store.get("qf.progress." + name));
    if (p && p.cards) return p;
  } catch {}
  return { cards: {}, newDay: null, newCount: 0 };
}
function saveProgress() {
  store.set("qf.progress." + person, JSON.stringify(progress));
}
function newCountToday() {
  return progress.newDay === localDate() ? progress.newCount : 0;
}

// SM-2 with short first steps, capped so every card comes back before quiz day.
// grade: 1 Again, 2 Hard, 3 Good, 4 Easy
function schedule(prev, grade) {
  const s = prev ? { ...prev } : { reps: 0, ef: 2.5, ivl: 0, lapses: 0 };
  const now = Date.now();
  s.last = now;
  if (grade === 1) {
    s.reps = 0;
    s.ivl = 0;
    s.lapses++;
    s.ef = Math.max(1.3, s.ef - 0.2);
    s.due = now + 10 * 60000;
    return s;
  }
  const q = [0, 1, 3, 4, 5][grade];
  if (s.reps === 0) s.ivl = grade === 4 ? 3 : 1;
  else if (s.reps === 1) s.ivl = grade === 2 ? 2 : grade === 4 ? 5 : 3;
  else s.ivl = Math.round(s.ivl * (grade === 2 ? 1.2 : grade === 4 ? s.ef * 1.3 : s.ef));
  s.ivl = Math.max(1, s.ivl);
  const left = daysUntilQuiz();
  if (left != null && left > 0) s.ivl = Math.min(s.ivl, Math.max(1, left - 1));
  s.reps++;
  s.ef = Math.max(1.3, s.ef + 0.1 - (5 - q) * (0.08 + (5 - q) * 0.02));
  s.due = startOfToday() + s.ivl * DAY;
  return s;
}

function intervalLabel(s) {
  if (s.ivl === 0) return "10 min";
  return s.ivl === 1 ? "1 day" : s.ivl + " days";
}

// ---------- screens ----------

async function showLogin(message) {
  const pw = h("input", { type: "password", placeholder: "Password", autocomplete: "current-password" });
  const remember = h("input", { type: "checkbox", checked: true });
  const err = h("p", { class: "error" }, message || "");
  const btn = h("button", { class: "primary", type: "submit" }, "Unlock");
  const form = h("form", {
    onsubmit: async (e) => {
      e.preventDefault();
      btn.disabled = true;
      btn.textContent = "Unlocking…";
      const ok = await unlock(pw.value);
      if (ok) {
        if (remember.checked) store.set("qf.pw", pw.value);
        showPeople();
      } else {
        err.textContent = "Wrong password, or the card file is missing.";
        btn.disabled = false;
        btn.textContent = "Unlock";
      }
    },
  }, pw, h("label", { class: "check" }, remember, "Remember on this device"), err, btn);
  render(
    h("h1", {}, cfg.title || "Flashcards"),
    h("p", { class: "muted" }, "Flashcards for the EELISA Pub Quiz"),
    h("div", { class: "panel" }, form)
  );
  pw.focus();
}

async function unlock(password) {
  try {
    const res = await fetch("cards.enc.json", { cache: "no-cache" });
    const data = await decrypt(await res.json(), password);
    categories = data.categories;
    return true;
  } catch {
    return false;
  }
}

function showPeople() {
  const saved = store.get("qf.person");
  if (saved && cfg.people[saved]) return openPerson(saved);
  render(
    h("h1", {}, "Who's studying?"),
    h("p", { class: "muted" }, "Your progress is saved on this device under your name."),
    h("div", { class: "people" }, Object.keys(cfg.people).map((name) => h("button", { onclick: () => openPerson(name) }, name))),
    h("p", {}, h("button", { class: "link", onclick: logout }, "Lock"))
  );
}

function openPerson(name) {
  person = name;
  store.set("qf.person", name);
  progress = loadProgress(name);
  showHome();
}

function myCategories() {
  return new Set([...(cfg.people[person] || []), ...(cfg.everyone || [])]);
}

function selectedCategories() {
  try {
    const saved = JSON.parse(store.get("qf.cats." + person));
    if (Array.isArray(saved)) return new Set(saved);
  } catch {}
  return myCategories();
}

function catStats(cat) {
  const now = Date.now();
  let due = 0, fresh = 0, learned = 0;
  for (const c of cat.cards) {
    const s = progress.cards[c.id];
    if (!s) fresh++;
    else {
      if (s.due <= now) due++;
      if (s.reps > 0) learned++;
    }
  }
  return { due, fresh, learned, total: cat.cards.length };
}

function showHome() {
  session = null;
  const mine = myCategories();
  const selected = selectedCategories();
  const left = daysUntilQuiz();

  const rows = categories.map((cat) => {
    const st = catStats(cat);
    const box = h("input", {
      type: "checkbox", id: "c-" + cat.category, checked: selected.has(cat.category),
      onchange: (e) => {
        e.target.checked ? selected.add(cat.category) : selected.delete(cat.category);
        store.set("qf.cats." + person, JSON.stringify([...selected]));
        updateButtons();
      },
    });
    return h("div", { class: "cat" },
      box,
      h("label", { for: "c-" + cat.category },
        h("div", {}, cat.title),
        h("div", { class: "stats" }, `${st.due} due · ${st.fresh} new · ${st.learned}/${st.total} learned`)
      ),
      mine.has(cat.category) ? h("span", { class: "tag mine" }, "yours") : null
    );
  });

  const studyBtn = h("button", { class: "primary grow", onclick: () => startSession(false, selected) });
  const cramBtn = h("button", { class: "grow", onclick: () => startSession(true, selected) }, "Practice all (no scheduling)");

  function updateButtons() {
    const { due, fresh } = countQueue(selected);
    studyBtn.textContent = due + fresh ? `Study: ${due} due, ${fresh} new` : "Nothing due right now";
    studyBtn.disabled = due + fresh === 0;
    cramBtn.disabled = selected.size === 0;
  }
  updateButtons();

  render(
    h("div", { class: "top" },
      h("h1", {}, `Hi ${person}`),
      h("button", { class: "link", onclick: () => { store.del("qf.person"); showPeople(); } }, "Switch person")
    ),
    left != null && left >= 0
      ? h("p", { class: "muted" }, left === 0 ? "The quiz is today. Good luck!" : `${left} day${left === 1 ? "" : "s"} until the quiz.`)
      : null,
    h("div", { class: "panel" }, rows),
    h("div", { class: "row" }, studyBtn, cramBtn),
    h("p", { class: "muted", style: "margin-top:12px" },
      `Up to ${cfg.newCardsPerDay} new cards a day, easy ones first. "Practice all" goes through every selected card without changing your schedule.`),
    h("h2", {}, "Other devices"),
    h("div", { class: "row" },
      h("button", { onclick: showExport }, "Export progress"),
      h("button", { onclick: showImport }, "Import progress"),
      h("span", { class: "grow" }),
      h("button", { class: "link", onclick: logout }, "Lock")
    )
  );
}

function cardsIn(selected) {
  const out = [];
  for (const cat of categories) {
    if (!selected.has(cat.category)) continue;
    cat.cards.forEach((c, i) => out.push({ ...c, cat, i }));
  }
  return out;
}

// New cards: easiest first, alternating between categories
function orderNew(cards) {
  return cards.sort((a, b) => a.d - b.d || a.i - b.i || categories.indexOf(a.cat) - categories.indexOf(b.cat));
}

function countQueue(selected) {
  const now = Date.now();
  const all = cardsIn(selected);
  const due = all.filter((c) => progress.cards[c.id] && progress.cards[c.id].due <= now).length;
  const allowed = Math.max(0, cfg.newCardsPerDay - newCountToday());
  const fresh = Math.min(allowed, all.filter((c) => !progress.cards[c.id]).length);
  return { due, fresh };
}

function startSession(cram, selected) {
  const all = cardsIn(selected);
  let queue;
  if (cram) {
    queue = all.slice();
    for (let i = queue.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [queue[i], queue[j]] = [queue[j], queue[i]];
    }
  } else {
    const now = Date.now();
    const due = all.filter((c) => progress.cards[c.id] && progress.cards[c.id].due <= now)
      .sort((a, b) => progress.cards[a.id].due - progress.cards[b.id].due);
    const allowed = Math.max(0, cfg.newCardsPerDay - newCountToday());
    const fresh = orderNew(all.filter((c) => !progress.cards[c.id])).slice(0, allowed);
    queue = [...due, ...fresh];
  }
  session = { cram, queue, done: 0, total: queue.length, revealed: false };
  showCard();
}

function showCard() {
  const s = session;
  if (!s.queue.length) return showDone();
  const card = s.queue[0];
  s.revealed = false;

  const answer = h("div", { class: "answer hidden" },
    h("div", { class: "a" }, card.a),
    card.note ? h("div", { class: "note" }, card.note) : null
  );
  const showBtn = h("button", { class: "primary", style: "margin-top:14px", onclick: reveal }, "Show answer");

  let grades;
  if (s.cram) {
    grades = h("div", { class: "grades hidden", style: "grid-template-columns:1fr 1fr" },
      h("button", { class: "g1", onclick: () => grade(1) }, "Again"),
      h("button", { class: "g3", onclick: () => grade(3) }, "Got it")
    );
  } else {
    const prev = progress.cards[card.id];
    const names = ["Again", "Hard", "Good", "Easy"];
    grades = h("div", { class: "grades hidden" },
      names.map((n, i) => h("button", { class: "g" + (i + 1), onclick: () => grade(i + 1) },
        n, h("small", {}, intervalLabel(schedule(prev, i + 1)))))
    );
  }

  function reveal() {
    s.revealed = true;
    answer.classList.remove("hidden");
    grades.classList.remove("hidden");
    showBtn.classList.add("hidden");
  }

  const pct = s.total ? Math.round((s.done / s.total) * 100) : 0;
  render(
    h("div", { class: "top" },
      h("span", { class: "muted" }, `${s.queue.length} left${s.cram ? " · practice" : ""}`),
      h("button", { class: "link", onclick: showHome }, "Stop")
    ),
    h("div", { class: "bar" }, h("div", { style: `width:${pct}%` })),
    h("div", { class: "panel card" },
      h("div", { class: "row" },
        h("span", { class: "tag" }, card.cat.title),
        h("span", { class: "tag" }, ["", "Easy", "Medium", "Hard"][card.d]),
        card.lang === "de" ? h("span", { class: "tag" }, "Deutsch") : null,
        !s.cram && !progress.cards[card.id] ? h("span", { class: "tag mine" }, "new") : null
      ),
      h("div", { class: "q" }, card.q),
      card.opts ? h("ol", {}, card.opts.map((o, i) => h("li", { "data-l": "ABCD"[i] || "" }, o))) : null,
      answer,
      showBtn,
      grades
    ),
    h("p", { class: "muted" }, "Keys: space shows the answer, 1 to 4 grade it.")
  );
  session.reveal = reveal;
}

function grade(g) {
  const s = session;
  const card = s.queue.shift();
  if (!s.cram) {
    if (!progress.cards[card.id]) {
      if (progress.newDay !== localDate()) { progress.newDay = localDate(); progress.newCount = 0; }
      progress.newCount++;
    }
    progress.cards[card.id] = schedule(progress.cards[card.id], g);
    saveProgress();
  }
  if (g === 1) s.queue.splice(Math.min(3, s.queue.length), 0, card);
  else s.done++;
  showCard();
}

function showDone() {
  session = null;
  render(
    h("h1", {}, "Done for now"),
    h("p", {}, "Come back tomorrow for the next cards that are due."),
    h("button", { class: "primary", onclick: showHome }, "Back")
  );
}

function showExport() {
  const code = b64.fromText(JSON.stringify({ v: 1, person, progress }));
  const area = h("textarea", { readonly: true }, code);
  const status = h("span", { class: "muted" });
  render(
    h("h1", {}, "Export progress"),
    h("p", {}, `Copy this code and paste it into "Import progress" on your other device, signed in as ${person}.`),
    area,
    h("div", { class: "row", style: "margin-top:12px" },
      h("button", { class: "primary", onclick: async () => {
        try { await navigator.clipboard.writeText(code); status.textContent = "Copied."; }
        catch { area.select(); status.textContent = "Select the text and copy it."; }
      } }, "Copy"),
      status,
      h("span", { class: "grow" }),
      h("button", { onclick: showHome }, "Back")
    )
  );
}

function showImport() {
  const area = h("textarea", { placeholder: "Paste the export code here" });
  const err = h("p", { class: "error" });
  render(
    h("h1", {}, "Import progress"),
    h("p", {}, "Paste a code from another device. For each card, the more recently studied version is kept, so nothing is lost."),
    area, err,
    h("div", { class: "row" },
      h("button", { class: "primary", onclick: () => {
        try {
          const data = JSON.parse(b64.toText(area.value));
          if (!data.progress || !data.progress.cards) throw new Error();
          if (data.person !== person && !confirm(`This code belongs to ${data.person}. Import it into ${person}'s progress anyway?`)) return;
          let merged = 0;
          for (const [id, st] of Object.entries(data.progress.cards)) {
            const mine = progress.cards[id];
            if (!mine || (st.last || 0) > (mine.last || 0)) { progress.cards[id] = st; merged++; }
          }
          if (data.progress.newDay === localDate() && progress.newDay === localDate()) {
            progress.newCount = Math.max(progress.newCount, data.progress.newCount);
          } else if (data.progress.newDay === localDate()) {
            progress.newDay = data.progress.newDay;
            progress.newCount = data.progress.newCount;
          }
          saveProgress();
          alert(`Imported. ${merged} card${merged === 1 ? "" : "s"} updated.`);
          showHome();
        } catch {
          err.textContent = "That code doesn't look right. Copy the whole thing and try again.";
        }
      } }, "Import"),
      h("span", { class: "grow" }),
      h("button", { onclick: showHome }, "Back")
    )
  );
}

function logout() {
  store.del("qf.pw");
  store.del("qf.person");
  categories = null;
  showLogin();
}

document.addEventListener("keydown", (e) => {
  if (!session || e.target.tagName === "TEXTAREA" || e.target.tagName === "INPUT") return;
  if ((e.key === " " || e.key === "Enter") && !session.revealed) {
    e.preventDefault();
    session.reveal();
  } else if (session.revealed && ["1", "2", "3", "4"].includes(e.key)) {
    const g = Number(e.key);
    // Practice mode only has Again and Got it
    grade(session.cram ? (g === 1 ? 1 : 3) : g);
  }
});

// ---------- start ----------

(async function init() {
  try {
    cfg = await (await fetch("config.json", { cache: "no-cache" })).json();
  } catch {
    render(h("p", { class: "error" }, "Could not load config.json. If you opened the file directly, serve the folder instead (see README)."));
    return;
  }
  cfg.newCardsPerDay = cfg.newCardsPerDay || 20;
  const saved = store.get("qf.pw");
  if (saved && (await unlock(saved))) showPeople();
  else showLogin();
})();
