# health：日用品成分檢查站

純靜態頁面，不需要建置。所有成分比對都在瀏覽器裡完成，照片與文字不會上傳。

## 結構

```
index.html                首頁（由 data/categories.json 產生分類卡片）
bath.html                 分類頁：<body data-category="bath">
toothpaste.html           產品頁：<body data-product="toothpaste">，科普直接寫在 HTML 裡
assets/site.css           共用樣式
assets/catalog.js         首頁與分類頁
assets/checker.js         產品頁：成分檢查、成分資料庫、推薦
data/categories.json      分類 → 小組 → 產品；沒有 href 的產品顯示「整理中」
data/ingredients.json     全站共用成分資料庫
data/products/<key>.json  單一產品的避開選項、範例成分表、推薦清單
```

網址刻意保持扁平（`toothpaste.html` 而非 `bath/toothpaste.html`），調整分類只需改 `categories.json`。

## 新增一個「看成分」的產品（例如洗髮精）

1. 複製 `toothpaste.html` 成 `shampoo.html`，把 `data-product` 改成 `shampoo`，改寫「為什麼要注意」那一段。
2. 新增 `data/products/shampoo.json`（格式同 `toothpaste.json`）。
3. 在 `data/ingredients.json` 中，替會出現在洗髮精裡的成分加上 `by.shampoo`：
   `role`、`human`（0–3）、`sum`、`use`、`hum`，可選 `benefit`。
   名稱、別名、環境評分（`env`、`envT`）、法規與來源是各產品共用的。
   成分資料庫區塊只會列出有 `by.shampoo` 的成分；其他成分仍可比對，但會借用別的產品的說明。
4. 在 `data/categories.json` 對應項目加上 `"href": "shampoo.html"`。

## 本機預覽

`fetch` 不能讀 `file://`，請用本機伺服器：

```
python3 -m http.server   # 然後開 http://localhost:8000/health/
```
