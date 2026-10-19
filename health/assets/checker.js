/* Product page engine: ingredient checker, ingredient register and picks.
   A page declares <body data-product="toothpaste"> and provides the #check / #library / #picks markup;
   data comes from data/ingredients.json (shared) and data/products/<key>.json.
   Everything runs in the browser: no photo or text ever leaves the device. */
(async () => {
const PRODUCT = document.body.dataset.product;
const LV = ["低", "輕微／因人而異", "中度疑慮", "高度疑慮"];
const esc = s => String(s).replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const $ = id => document.getElementById(id);

const result = $("result"), reg = $("reg"), pickBox = $("pickBox"), ta = $("ingr");
let ALL, P;
try {
  const get = u => fetch(u).then(r => { if (!r.ok) throw new Error(u); return r.json(); });
  [ALL, P] = await Promise.all([get("data/ingredients.json"), get(`data/products/${PRODUCT}.json`)]);
} catch (e) {
  const msg = `<div class="loadfail">資料載入失敗，請重新整理頁面。（若是直接開啟本機檔案，請改用本機伺服器，例如 <code>python3 -m http.server</code>。）</div>`;
  for (const el of [result, reg, pickBox]) if (el) el.innerHTML = msg;
  return;
}

/* An ingredient's role, human score and wording depend on the product (SLS in toothpaste touches mucosa,
   in shampoo it rinses off skin), so each one carries per-product text under `by`. */
const norm = s => s.normalize("NFKC").toLowerCase().replace(/[*†‡]/g, "").replace(/\s+/g, " ").trim();
const DB = ALL.map(d => {
  const own = d.by[PRODUCT];
  const v = { ...d, ...(own || Object.values(d.by)[0]), here: !!own };
  v.aliases = d.aliases.map(norm);
  v.exactAliases = (d.exactAliases || []).map(norm);
  return v;
});
const byId = Object.fromEntries(DB.map(d => [d.id, d]));

/* ---------- matching ---------- */
const SEP = /[,、;]/;
const SKIP = new Set(["ingredients", "ingredient", "inactive ingredients", "inactive ingredient", "active ingredients", "active ingredient",
  "other ingredients", "成分", "全成分", "其他成分", "有效成分", "成份", "全成份"]);
function stripParen(s) { return s.replace(/\(.*?\)/g, "").trim(); }

/* Phone text scanners keep the label's line breaks, which often fall inside a name ("Sodium Lauryl⏎Sulfate").
   When the list has real separators, a line break is just wrapping: join it. Only a list with no separators
   at all is treated as one ingredient per line. */
function prep(text) {
  let t = text.normalize("NFKC").replace(/\r/g, "");
  t = t.replace(/(\p{L})-\n\s*(\p{Ll})/gu, "$1$2");
  if (SEP.test(t)) {
    t = t.replace(/(\p{Script=Han})[ \t]*\n\s*(?=\p{Script=Han})/gu, "$1").replace(/\s*\n\s*/g, " ");
  }
  return t;
}
function tokenize(text) {
  return prep(text).split(/[,、;\n]+|:/).map(norm).filter(t => t && !SKIP.has(t));
}
function matchToken(tok) {
  let best = null, bestLen = 0;
  const bare = stripParen(tok);
  for (const ing of DB) {
    for (const a of ing.aliases) {
      if (tok.includes(a) && a.length > bestLen) { best = ing; bestLen = a.length; }
    }
    for (const a of ing.exactAliases) {
      if ((tok === a || bare === a) && a.length + 100 > bestLen) { best = ing; bestLen = a.length + 100; }
    }
  }
  return best;
}
function analyze(text) {
  const toks = tokenize(text);
  const hits = []; const seen = new Set(); const unknown = [];
  for (const t of toks) {
    const m = matchToken(t);
    if (!m) { unknown.push(t); continue; }
    if (seen.has(m.id)) continue;
    seen.add(m.id); hits.push({ ing: m, raw: t });
  }
  return { toks, hits, unknown };
}
const lvOf = ing => Math.max(ing.human, ing.env);
function judge(hits, prefs) {
  const avoided = hits.filter(h => h.ing.avoid && prefs.has(h.ing.avoid));
  const severe = hits.filter(h => lvOf(h.ing) >= 3);
  const moderate = hits.filter(h => lvOf(h.ing) === 2);
  if (avoided.length) return { cls: "bad", mark: "✕", title: "含你想避開的成分", sub: avoided.map(h => h.ing.zh).join("、") };
  if (severe.length) return { cls: "bad", mark: "!", title: "含高度疑慮成分", sub: severe.map(h => h.ing.zh).join("、") };
  if (moderate.length) return { cls: "warn", mark: "△", title: "符合你的條件，但有中度疑慮成分", sub: moderate.map(h => h.ing.zh).join("、") };
  return { cls: "ok", mark: "✓", title: "符合你的條件", sub: "沒有找到你想避開或中度以上疑慮的成分。" };
}
function meter(kind, v) {
  const segs = [1, 2, 3].map(i => `<i class="${i <= v ? "on" : ""}"></i>`).join("");
  const k = kind === "h" ? "人體" : "環境";
  return `<span class="meter ${kind}" title="${k}：${LV[v]}"><span class="segs">${segs}</span>${k}</span>`;
}
const verdict = v => `<div class="verdict ${v.cls}"><span class="mark" aria-hidden="true">${v.mark}</span><strong>${esc(v.title)}</strong><p>${esc(v.sub)}</p></div>`;

/* ---------- prefs ---------- */
const PREF_KEY = `prefs:${PRODUCT}`;
function loadPrefs() {
  try { const v = JSON.parse(localStorage.getItem(PREF_KEY)); if (Array.isArray(v)) return new Set(v); } catch (e) {}
  return new Set(P.defaultPrefs);
}
function savePrefs() { try { localStorage.setItem(PREF_KEY, JSON.stringify([...prefs])); } catch (e) {} }
let prefs = loadPrefs();
const prefBox = $("prefBox");
prefBox.innerHTML = P.prefs.map(p => `<label class="chip-toggle"><input type="checkbox" value="${p.k}" ${prefs.has(p.k) ? "checked" : ""}><span class="box"></span>${esc(p.label)}</label>`).join("");
prefBox.addEventListener("change", e => {
  if (e.target.type !== "checkbox") return;
  e.target.checked ? prefs.add(e.target.value) : prefs.delete(e.target.value);
  savePrefs(); runCheck(); renderPicks();
});

/* ---------- checker ---------- */
let sampleIdx = 0;
ta.value = P.samples[0];
const hint = $("ingrHint");

/* Tells assets/report.js what the last check found, so unlisted ingredients can be reported. */
const announce = (text, unknown) => document.dispatchEvent(new CustomEvent("health:checked", {
  detail: { product: PRODUCT, name: P.name, text, unknown, sample: P.samples.includes(text) } }));

function runCheck() {
  const text = ta.value.trim();
  if (!text) {
    result.innerHTML = `<p class="hint" style="margin:0">貼上或掃描成分表後就會自動檢查。也可以按「換一組範例」看看效果。</p>`;
    announce("", []);
    return;
  }
  const { toks, hits, unknown } = analyze(text);
  announce(text, unknown);
  const order = hits.slice().sort((a, b) => {
    const av = a.ing.avoid && prefs.has(a.ing.avoid) ? 1 : 0, bv = b.ing.avoid && prefs.has(b.ing.avoid) ? 1 : 0;
    return (bv - av) || (lvOf(b.ing) - lvOf(a.ing));
  });
  const concern = hits.filter(h => lvOf(h.ing) >= 2).length;
  result.innerHTML = `
    ${verdict(judge(hits, prefs))}
    <div class="tally"><span><b>${toks.length}</b>項成分</span><span><b>${toks.length - unknown.length}</b>項已比對</span><span><b>${concern}</b>項中度以上疑慮</span></div>
    <ul class="found">${order.map(h => {
      const av = h.ing.avoid && prefs.has(h.ing.avoid);
      return `<li class="lv${lvOf(h.ing)}${av ? " avoid" : ""}"><button type="button" data-id="${h.ing.id}">
        <span class="nm">${esc(h.ing.zh)}${av ? '<span class="tag avoid">你想避開</span>' : ""}${h.ing.benefit ? '<span class="tag benefit">有益成分</span>' : ""}</span>
        <span class="meters">${meter("h", h.ing.human)}${meter("e", h.ing.env)}</span>
        <span class="src">${esc(h.raw)}</span></button></li>`;
    }).join("")}</ul>
    ${unknown.length ? `<details class="unk"><summary>${unknown.length} 項尚未收錄在資料庫</summary><p>${unknown.map(esc).join(" · ")}</p></details>` : ""}`;
}
let typing;
ta.addEventListener("input", () => {
  hint.hidden = true;
  clearTimeout(typing); typing = setTimeout(runCheck, 350);
});
$("runBtn").addEventListener("click", runCheck);
$("sampleBtn").addEventListener("click", () => { sampleIdx = (sampleIdx + 1) % P.samples.length; ta.value = P.samples[sampleIdx]; hint.hidden = false; runCheck(); });
$("clearBtn").addEventListener("click", () => { ta.value = ""; runCheck(); ta.focus(); });
result.addEventListener("click", e => { const b = e.target.closest("button[data-id]"); if (b) openDetail(b.dataset.id); });

/* ---------- scanning with the phone's own text recognition ---------- */
const ua = navigator.userAgent;
const isIOS = /iPhone|iPad|iPod/.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1);
const isAndroid = /Android/.test(ua);
const scanBox = $("scanHelp"), scanBtn = $("scanBtn");
const IOS = `<div><h4>iPhone／iPad</h4><ol>
  <li>點一下上方的成分欄位。</li>
  <li>在跳出的選單選「掃描文字」（方框裡有幾行字的圖示）；沒看到就按選單右側的箭頭。</li>
  <li>相機對準成分表，等文字被框起來後按「插入」，就會自動檢查。</li></ol>
  <p>需要 iOS 15 以上、iPhone XS 之後的機型。文字辨識在手機上完成。</p></div>`;
const ANDROID = `<div><h4>Android</h4><ol>
  <li>點一下上方的成分欄位，看鍵盤工具列有沒有「掃描文字」或相機圖示，有的話直接對準成分表。</li>
  <li>沒有的話，用相機 App 的文字辨識或 Google 智慧鏡頭拍成分表，選取文字後按「複製」。</li>
  <li>回到這頁，長按成分欄位選「貼上」，就會自動檢查。</li></ol>
  <p>Google 智慧鏡頭可能會把照片傳到 Google 處理；這個網頁本身不會收到照片。</p></div>`;
scanBox.innerHTML = `<div class="os">${isAndroid ? ANDROID : isIOS ? IOS : IOS + ANDROID + "<p>在電腦上可以直接複製貼上成分文字。</p>"}</div>`;
scanBtn.addEventListener("click", () => {
  const open = scanBox.hidden;
  scanBox.hidden = !open;
  scanBtn.setAttribute("aria-expanded", String(open));
  if (open && P.samples.includes(ta.value)) { ta.value = ""; hint.hidden = true; runCheck(); }
  if (open) ta.focus();
});

/* ---------- library ---------- */
let filter = "all";
function renderLib() {
  const q = norm($("libSearch").value || "");
  const rows = DB.filter(d => d.here && d.id !== "water").filter(d => {
    if (filter === "human" && d.human < 2) return false;
    if (filter === "env" && d.env < 2) return false;
    if (filter === "safe" && lvOf(d) > 1) return false;
    if (q && !(d.zh.toLowerCase().includes(q) || d.inci.toLowerCase().includes(q) || d.aliases.some(a => a.includes(q)))) return false;
    return true;
  }).sort((a, b) => (lvOf(b) - lvOf(a)) || ((b.human + b.env) - (a.human + a.env)));
  reg.innerHTML = rows.length ? rows.map(d => `
    <button class="reg-row" type="button" data-id="${d.id}">
      <span class="nm">${esc(d.zh)}<span class="role">${esc(d.role)}</span></span>
      <span class="inci">${esc(d.inci)}</span>
      <span class="meters">${meter("h", d.human)}${meter("e", d.env)}</span>
      <span class="sum">${esc(d.sum)}</span>
    </button>`).join("") : `<div class="empty">沒有符合的成分。</div>`;
}
document.querySelector("#library .seg").addEventListener("click", e => {
  const b = e.target.closest("button[data-f]"); if (!b) return;
  filter = b.dataset.f;
  document.querySelectorAll("#library .seg button").forEach(x => x.setAttribute("aria-pressed", String(x === b)));
  renderLib();
});
$("libSearch").addEventListener("input", renderLib);
reg.addEventListener("click", e => { const b = e.target.closest("button[data-id]"); if (b) openDetail(b.dataset.id); });

/* ---------- picks ---------- */
/* Products of one use come in several forms (body wash vs bar soap); `forms` in the product JSON labels them
   and, when the picks span more than one, adds a filter. */
const FORMS = P.forms || {};
let pickForm = "all";
const pickTools = $("pickTools");
if (pickTools && new Set(P.picks.map(p => p.form).filter(Boolean)).size > 1) {
  pickTools.innerHTML = `<div class="seg" role="group" aria-label="依型態篩選">
    <button type="button" data-form="all" aria-pressed="true">全部</button>
    ${Object.entries(FORMS).map(([k, v]) => `<button type="button" data-form="${k}" aria-pressed="false">${esc(v)}</button>`).join("")}</div>`;
  pickTools.addEventListener("click", e => {
    const b = e.target.closest("button[data-form]"); if (!b) return;
    pickForm = b.dataset.form;
    pickTools.querySelectorAll("button").forEach(x => x.setAttribute("aria-pressed", String(x === b)));
    renderPicks();
  });
}
function renderPicks() {
  pickBox.innerHTML = P.picks.filter(p => pickForm === "all" || p.form === pickForm).map(p => {
    const { toks, hits, unknown } = analyze(p.inci);
    const flagged = hits.filter(h => lvOf(h.ing) >= 1 || (h.ing.avoid && prefs.has(h.ing.avoid)))
      .sort((a, b) => lvOf(b.ing) - lvOf(a.ing));
    return `<article class="pick">
      <div><div class="brandline">${esc(p.brand)}</div><h3>${esc(p.name)}</h3></div>
      <div class="pills">${p.form ? `<span class="pill form">${esc([FORMS[p.form], p.type].filter(Boolean).join(" · "))}</span>` : ""}${p.good.map(g => `<span class="pill good">${esc(g)}</span>`).join("")}${p.trade.map(g => `<span class="pill trade">${esc(g)}</span>`).join("")}</div>
      ${verdict(judge(hits, prefs))}
      <div><div class="fine" style="margin-bottom:6px">需留意的成分（${toks.length - unknown.length}/${toks.length} 項已比對）</div>
        <div class="flags">${flagged.map(h => {
          const av = h.ing.avoid && prefs.has(h.ing.avoid);
          return `<button type="button" class="lv${lvOf(h.ing)}${av ? " avoid" : ""}" data-id="${h.ing.id}">${esc(h.ing.zh)}</button>`;
        }).join("") || '<span class="fine">無</span>'}</div></div>
      <div class="buy"><h4>在哪裡買</h4><div class="stores">${p.stores.map(s => `<span class="store${s.unsure ? " unsure" : ""}">${esc(s.n)}</span>`).join("")}</div></div>
      <p class="fine">${esc(p.note)} <a href="${esc(p.src)}" target="_blank" rel="noopener">成分來源</a></p>
    </article>`;
  }).join("");
}
pickBox.addEventListener("click", e => { const b = e.target.closest("button[data-id]"); if (b) openDetail(b.dataset.id); });

/* ---------- detail ---------- */
const dlg = $("detail");
function openDetail(id) {
  const d = byId[id]; if (!d) return;
  $("dTitle").textContent = d.zh;
  $("dInci").textContent = d.inci + "　·　" + d.role;
  $("dH").textContent = LV[d.human];
  $("dE").textContent = LV[d.env];
  $("dBody").innerHTML = `
    <div><h4>用途</h4><p>${esc(d.use)}</p></div>
    <div><h4>對人體</h4><p>${esc(d.hum)}</p></div>
    <div><h4>對環境</h4><p>${esc(d.envT)}</p></div>
    <div><h4>法規現況</h4><p>${esc(d.law)}</p></div>
    <div><h4>參考來源</h4>${d.src.length ? `<ul>${d.src.map(s => `<li><a href="${esc(s.u)}" target="_blank" rel="noopener">${esc(s.t)}</a></li>`).join("")}</ul>` : `<p class="fine">來源待補（正式版每項成分都會附上出處）。</p>`}</div>`;
  if (typeof dlg.showModal === "function") { if (!dlg.open) dlg.showModal(); } else { dlg.setAttribute("open", ""); }
  dlg.scrollTop = 0;
}
$("dClose").addEventListener("click", () => dlg.close ? dlg.close() : dlg.removeAttribute("open"));
dlg.addEventListener("click", e => { if (e.target === dlg) dlg.close(); });

runCheck(); renderLib(); renderPicks();
})();
