/* Report ingredients that are not in the database yet, into a file in the owner's GitHub Gist.
   The site is public, so neither the token nor the (secret) gist id is in this code: the owner pastes them
   once on their phone and they stay in that browser's localStorage. Reports are queued locally first and
   uploaded when the network allows, so nothing is lost in a store with bad reception.
   Only FILE is written; a gist PATCH leaves every other file in the gist untouched. */
(() => {
const FILE = "health-ingredient-reports.json";
const AUTH_KEY = "health-report-auth", QUEUE_KEY = "health-report-queue";
const esc = s => String(s).replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const load = (k, d) => { try { return JSON.parse(localStorage.getItem(k)) ?? d; } catch (e) { return d; } };
const save = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); return true; } catch (e) { return false; } };

let last = { product: document.body.dataset.product, name: "", text: "", unknown: [], sample: true };
let auth = load(AUTH_KEY, null);
let busy = false;

/* ---------- UI ---------- */
const checker = document.querySelector("#check .checker");
if (!checker) return;
const bar = document.createElement("div");
bar.className = "report-bar";
bar.setAttribute("aria-live", "polite");
checker.after(bar);

const dlg = document.createElement("dialog");
dlg.className = "sheet";
dlg.setAttribute("aria-labelledby", "rpTitle");
document.body.append(dlg);

function renderBar(msg) {
  const queue = load(QUEUE_KEY, []);
  const n = last.sample ? 0 : last.unknown.length;
  bar.innerHTML = `
    <div class="rb-main">${n
      ? `<span><b>${n}</b> 項成分還沒收錄</span><button class="btn primary" type="button" data-act="open">回報這些成分</button>`
      : `<span class="fine">掃到資料庫沒有的成分，或比對結果怪怪的？</span><button class="btn" type="button" data-act="open">回報新成分</button>`}</div>
    ${queue.length ? `<div class="rb-queue">有 ${queue.length} 筆回報還沒上傳 <button class="linkish" type="button" data-act="flush">${busy ? "上傳中…" : "現在上傳"}</button></div>` : ""}
    ${msg ? `<div class="rb-msg">${esc(msg)}</div>` : ""}`;
}
bar.addEventListener("click", e => {
  const b = e.target.closest("button[data-act]"); if (!b) return;
  if (b.dataset.act === "open") openSheet();
  if (b.dataset.act === "flush") flush();
});

function openSheet() {
  auth = load(AUTH_KEY, null);
  dlg.innerHTML = auth ? formHtml() : loginHtml();
  if (typeof dlg.showModal === "function") { if (!dlg.open) dlg.showModal(); } else dlg.setAttribute("open", "");
}
const close = () => dlg.close ? dlg.close() : dlg.removeAttribute("open");

const head = t => `<div class="d-head"><h3 id="rpTitle">${t}</h3><button class="d-close" type="button" data-act="close" aria-label="關閉">×</button></div>`;
function loginHtml(err) {
  return `${head("登入以回報")}
  <form class="sheet-body" data-form="login">
    <p class="fine">金鑰只會存在這支手機的瀏覽器裡，不會出現在網站程式碼中。</p>
    <label class="field" for="rpGist">Gist ID</label>
    <input class="txt" id="rpGist" name="gist" autocomplete="off" autocapitalize="off" spellcheck="false" required>
    <label class="field" for="rpToken">GitHub token</label>
    <input class="txt" id="rpToken" name="token" type="password" autocomplete="off" autocapitalize="off" spellcheck="false" required>
    ${err ? `<p class="rb-err">${esc(err)}</p>` : ""}
    <div class="row"><button class="btn primary" type="submit">登入</button></div>
  </form>`;
}
function formHtml() {
  const unk = last.sample ? [] : last.unknown;
  return `${head(`回報新成分 · ${esc(last.name || last.product)}`)}
  <form class="sheet-body" data-form="report">
    <label class="field" for="rpProduct">產品名稱（選填）</label>
    <input class="txt" id="rpProduct" name="product" placeholder="例如：某某牌 薄荷牙膏 120g" autocomplete="off">
    <label class="field" for="rpUnknown">還沒收錄的成分（一行一個）</label>
    <textarea id="rpUnknown" name="unknown" rows="4" spellcheck="false">${esc(unk.join("\n"))}</textarea>
    ${last.text && !last.sample ? `<label class="chk"><input type="checkbox" name="withText" checked> 附上整份成分表（${esc(last.text.length)} 字）</label>` : ""}
    <label class="field" for="rpNote">備註（選填）</label>
    <input class="txt" id="rpNote" name="note" placeholder="例如：掃描時有一行沒讀到" autocomplete="off">
    <div class="row"><button class="btn primary" type="submit">送出回報</button><button class="linkish" type="button" data-act="logout">登出</button></div>
  </form>`;
}

dlg.addEventListener("click", e => {
  if (e.target === dlg) return close();
  const b = e.target.closest("button[data-act]"); if (!b) return;
  if (b.dataset.act === "close") close();
  if (b.dataset.act === "logout") { try { localStorage.removeItem(AUTH_KEY); } catch (e) {} auth = null; dlg.innerHTML = loginHtml(); }
});
dlg.addEventListener("submit", async e => {
  e.preventDefault();
  const f = e.target, fd = new FormData(f);
  if (f.dataset.form === "login") {
    const a = { gist: String(fd.get("gist")).trim().replace(/^.*\//, ""), token: String(fd.get("token")).trim() };
    f.querySelector("button[type=submit]").disabled = true;
    try {
      await getGist(a);
      if (!save(AUTH_KEY, a)) throw new Error("這個瀏覽器不能儲存登入資料（可能是無痕模式）。");
      auth = a; dlg.innerHTML = formHtml(); flush();
    } catch (err) { dlg.innerHTML = loginHtml(err.message); }
    return;
  }
  const unknown = String(fd.get("unknown")).split("\n").map(s => s.trim()).filter(Boolean);
  const product = String(fd.get("product") || "").trim(), note = String(fd.get("note") || "").trim();
  if (!unknown.length && !note) { alert("請至少填一個成分或備註。"); return; }
  const r = { id: `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`, at: new Date().toISOString(),
    category: last.product, categoryName: last.name, product, unknown, note,
    ingredients: fd.get("withText") ? last.text : "", page: location.pathname, status: "new" };
  const queue = load(QUEUE_KEY, []); queue.push(r);
  if (!save(QUEUE_KEY, queue)) { alert("無法儲存在這支手機上，請改用一般瀏覽模式。"); return; }
  close();
  flush();
});

/* ---------- gist ---------- */
const api = (a, init = {}) => fetch(`https://api.github.com/gists/${encodeURIComponent(a.gist)}`, {
  ...init, headers: { Accept: "application/vnd.github+json", Authorization: `Bearer ${a.token}`, "X-GitHub-Api-Version": "2022-11-28", ...(init.headers || {}) } });
async function getGist(a) {
  let r;
  try { r = await api(a, { cache: "no-store" }); } catch (e) { throw new Error("連不上 GitHub，請確認網路。"); }
  if (r.status === 401) throw new Error("Token 無效或已過期。");
  if (r.status === 404) throw new Error("找不到這個 Gist，請確認 Gist ID，以及 token 有 gist 權限。");
  if (!r.ok) throw new Error(`GitHub 回應錯誤（${r.status}）。`);
  return r.json();
}
async function readFile(g) {
  const f = g.files && g.files[FILE];
  if (!f) return null;
  const text = f.truncated ? await fetch(f.raw_url, { cache: "no-store" }).then(r => r.text()) : f.content;
  try { return JSON.parse(text); } catch (e) { throw new Error(`${FILE} 的內容不是有效的 JSON，為避免覆蓋，暫停上傳。`); }
}
async function flush() {
  const queue = load(QUEUE_KEY, []);
  if (!queue.length || busy) return renderBar();
  if (!auth) return renderBar(`有 ${queue.length} 筆回報存在手機上，登入後就會上傳。`);
  busy = true; renderBar();
  try {
    const data = (await readFile(await getGist(auth))) || {
      about: "日用品成分檢查站：使用者回報、尚未收錄的成分。依產品類別分組，status 為 new 表示還沒處理。",
      categories: {} };
    data.categories = data.categories || {};
    const seen = new Set(Object.values(data.categories).flatMap(c => (c.reports || []).map(r => r.id)));
    for (const r of queue) {
      if (seen.has(r.id)) continue;
      const c = data.categories[r.category] = data.categories[r.category] || { name: r.categoryName, reports: [] };
      c.reports = c.reports || [];
      c.reports.push(r);
    }
    data.updated = new Date().toISOString();
    const res = await api(auth, { method: "PATCH", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ files: { [FILE]: { content: JSON.stringify(data, null, 2) } } }) });
    if (res.status === 403 || res.status === 404) throw new Error("Token 沒有寫入這個 Gist 的權限。");
    if (!res.ok) throw new Error(`上傳失敗（${res.status}），回報仍存在手機上。`);
    const sent = new Set(queue.map(r => r.id));
    save(QUEUE_KEY, load(QUEUE_KEY, []).filter(r => !sent.has(r.id)));
    busy = false; renderBar(`已上傳 ${queue.length} 筆回報，謝謝！`);
  } catch (err) {
    busy = false;
    renderBar(/fetch|network|連不上/i.test(err.message) ? "目前連不上網路，回報已存在手機上，之後會自動上傳。" : err.message);
  }
}

document.addEventListener("health:checked", e => { last = e.detail; renderBar(); });
window.addEventListener("online", flush);
renderBar();
flush();
})();
