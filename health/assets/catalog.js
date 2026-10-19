/* Home and category pages, both rendered from data/categories.json.
   Home: <div id="cats">. Category page: <body data-category="bath"> with <div id="groups">.
   Products live at flat URLs (toothpaste.html), so regrouping only touches the JSON. */
(async () => {
const esc = s => String(s).replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const KIND = { ingredients: "看成分", material: "看材質" };
const cats = document.getElementById("cats"), groups = document.getElementById("groups");

let CATS;
try {
  const r = await fetch("data/categories.json");
  if (!r.ok) throw new Error(r.status);
  CATS = await r.json();
} catch (e) {
  const msg = `<div class="loadfail">資料載入失敗，請重新整理頁面。</div>`;
  if (cats) cats.innerHTML = msg;
  if (groups) groups.innerHTML = msg;
  return;
}
const items = c => c.groups.flatMap(g => g.items);
const item = it => {
  const inner = `<span class="nm">${esc(it.name)}${it.href ? "" : '<span class="badge">整理中</span>'}</span>
    <span class="meta">${esc(KIND[it.kind])} · ${esc(it.contact)}</span>`;
  return it.href ? `<a class="item" href="${esc(it.href)}">${inner}</a>` : `<div class="item soon">${inner}</div>`;
};

if (cats) {
  cats.innerHTML = CATS.map(c => {
    const all = items(c), live = all.filter(i => i.href);
    const body = `<h3>${esc(c.name)}</h3><p>${esc(c.blurb)}</p>
      <p>${all.map(i => i.href ? `<b>${esc(i.name)}</b>` : esc(i.name)).join("、")}</p>
      <span class="count">${live.length ? `${live.length} 項已上線 · ` : ""}共 ${all.length} 項</span>`;
    return c.href ? `<a class="cat" href="${esc(c.href)}">${body}</a>` : `<div class="cat">${body}</div>`;
  }).join("");
  const live = CATS.flatMap(items).filter(i => i.href);
  const liveBox = document.getElementById("live");
  if (liveBox) liveBox.innerHTML = live.map(item).join("");
}

if (groups) {
  const c = CATS.find(x => x.key === document.body.dataset.category);
  if (!c) { groups.innerHTML = `<div class="loadfail">找不到這個分類。</div>`; return; }
  groups.innerHTML = c.groups.map(g => `<div class="group">
    <h3>${esc(g.name)}</h3>${g.blurb ? `<p>${esc(g.blurb)}</p>` : ""}
    <div class="items">${g.items.map(item).join("")}</div>
  </div>`).join("");
}
})();
