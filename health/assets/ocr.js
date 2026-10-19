/* Photo → ingredient text, entirely on the device. The photo is read by Tesseract (WebAssembly) inside this
   browser and is never uploaded; the library, engine and Traditional Chinese + English models are served from
   this site (lib/tesseract, about 8 MB on first use, cached by the browser afterwards).
   The result goes into #ingr and fires an input event, so checker.js re-runs the check as if it were typed. */
(() => {
const $ = id => document.getElementById(id);
const btn = $("photoBtn"), input = $("photoInput"), ta = $("ingr");
const box = $("ocrStatus"), thumb = $("ocrThumb"), msg = $("ocrText"), bar = $("ocrBar"), stop = $("ocrStop");
if (!btn || !input) return;
if (typeof WebAssembly !== "object" || !window.Worker) { btn.hidden = true; return; }

const BASE = new URL("lib/tesseract/", document.baseURI).href;
let workerP = null, onLog = () => {}, thumbUrl = null, runId = 0;

function show(text, { progress = null, err = false, busy = false } = {}) {
  box.hidden = false;
  box.classList.toggle("err", err);
  msg.textContent = text;
  bar.hidden = progress === null;
  if (progress !== null) bar.value = progress;
  stop.hidden = !busy;
}
const loadScript = src => new Promise((ok, fail) => {
  const s = document.createElement("script");
  s.src = src; s.onload = ok; s.onerror = () => fail(new Error("load"));
  document.head.append(s);
});
function getWorker() {
  if (!workerP) workerP = (async () => {
    if (!window.Tesseract) await loadScript(BASE + "tesseract.min.js");
    return Tesseract.createWorker(["chi_tra", "eng"], 1, {
      workerPath: BASE + "worker.min.js", corePath: BASE + "core", langPath: BASE + "lang",
      logger: m => onLog(m), errorHandler: () => {} });
  })().catch(e => { workerP = null; throw e; });
  return workerP;
}
const STEP = {
  "loading tesseract core": "下載辨識引擎（第一次使用較久）",
  "loading language traineddata": "下載中文與英文模型（第一次使用較久）",
  "loading language traineddata (from cache)": "載入模型",
  "initializing api": "準備辨識", "initializing tesseract": "準備辨識", "recognizing text": "辨識文字中",
};

/* Downscale (phone photos are ~12 MP, which is slow and no more accurate), convert to grayscale, stretch the
   contrast, and invert light-on-dark labels so the text is always dark on light. */
async function prepare(file) {
  const url = URL.createObjectURL(file);
  try {
    const img = new Image();
    img.src = url;
    await img.decode();
    const k = Math.min(1, 2400 / Math.max(img.naturalWidth, img.naturalHeight));
    const w = Math.round(img.naturalWidth * k), h = Math.round(img.naturalHeight * k);
    const c = document.createElement("canvas");
    c.width = w; c.height = h;
    const ctx = c.getContext("2d", { willReadFrequently: true });
    ctx.drawImage(img, 0, 0, w, h);
    const d = ctx.getImageData(0, 0, w, h), p = d.data, n = w * h;
    const g = new Uint8ClampedArray(n), hist = new Uint32Array(256);
    let sum = 0;
    for (let i = 0; i < n; i++) {
      const v = (p[i * 4] * 299 + p[i * 4 + 1] * 587 + p[i * 4 + 2] * 114) / 1000;
      g[i] = v; hist[g[i]]++; sum += v;
    }
    let lo = 0, hi = 255, acc = 0;
    for (; lo < 255 && (acc += hist[lo]) < n * 0.02; lo++);
    acc = 0;
    for (; hi > 0 && (acc += hist[hi]) < n * 0.02; hi--);
    const span = Math.max(1, hi - lo), invert = sum / n < 110;
    for (let i = 0; i < n; i++) {
      let v = ((g[i] - lo) * 255) / span;
      if (invert) v = 255 - v;
      p[i * 4] = p[i * 4 + 1] = p[i * 4 + 2] = v;
    }
    ctx.putImageData(d, 0, 0);
    return c;
  } finally { URL.revokeObjectURL(url); }
}

/* Tesseract puts spaces between Chinese characters and reads the whole package (brand, directions, warnings),
   so tidy the spacing and keep only the ingredient section when its heading can be found. */
const START = /全成分|成分|成份|ingredients?/i;
const END = /使用方法|用法|注意事項|注意|警語|警告|保存方法|保存|製造日期|製造商|製造廠|原產地|產地|淨重|容量|有效期限|保存期限|directions|warnings?|caution|made in|net wt|distributed by/i;
function clean(raw) {
  let t = raw.normalize("NFKC").replace(/\r/g, "")
    .replace(/(\p{Script=Han})[ \t]+(?=\p{Script=Han})/gu, "$1")
    .replace(/[|~"“”‘’_«»•·*#=<>\[\]{}]+/g, " ")
    .replace(/(^|[ \t])[.\-–—,]+(?=[ \t]|$)/gm, "$1")
    .replace(/[ \t]+([,、;:)])/g, "$1").replace(/\([ \t]+/g, "(");
  const s = t.search(START);
  if (s >= 0) {
    t = t.slice(s);
    const e = t.slice(4).search(END);
    if (e >= 0) t = t.slice(0, e + 4);
  }
  return t.split("\n").map(x => x.trim()).filter(x => /[\p{L}\p{N}]/u.test(x)).join("\n");
}

btn.addEventListener("click", () => {
  getWorker().catch(() => {});   // start downloading the engine while the camera is open
  input.click();
});
input.addEventListener("change", async () => {
  const file = input.files && input.files[0];
  input.value = "";
  if (!file) return;
  const id = ++runId;
  if (thumbUrl) URL.revokeObjectURL(thumbUrl);
  thumbUrl = URL.createObjectURL(file);
  thumb.src = thumbUrl;
  btn.disabled = true;
  onLog = m => { if (id === runId && STEP[m.status]) show(`${STEP[m.status]}…`, { progress: m.progress || 0, busy: true }); };
  show("準備辨識…", { progress: 0, busy: true });
  try {
    const [worker, canvas] = await Promise.all([getWorker(), prepare(file)]);
    if (id !== runId) return;
    const { data } = await worker.recognize(canvas);
    if (id !== runId) return;
    const text = clean(data.text || "");
    if (!text) { show("沒有讀到文字。請拍近一點、對焦清楚，讓成分表填滿畫面。", { err: true }); return; }
    ta.value = text;
    ta.dispatchEvent(new Event("input", { bubbles: true }));
    show(data.confidence < 60
      ? "已填入，但照片可能不夠清楚，辨識結果錯字較多。請對照包裝修正，或換個角度重拍。"
      : "已填入辨識結果。請對照包裝確認，有錯字可以直接修改。");
  } catch (e) {
    if (id !== runId) return;
    show(e && e.message === "load" ? "辨識引擎下載失敗，請確認網路後再試一次。" : "辨識時發生問題，請再試一次，或改用下方的手機內建掃描。", { err: true });
  } finally {
    if (id === runId) btn.disabled = false;
  }
});
stop.addEventListener("click", async () => {
  runId++;
  btn.disabled = false;
  box.hidden = true;
  const w = workerP; workerP = null;   // the only way to abort a running recognition is to end the worker
  if (w) (await w.catch(() => null))?.terminate();
});
})();
