# `#23` 匯入供應商 Excel · 查證報告

> 交辦 = `主-B-004` 派工 2。**是查證報告,不是 plan。** 零 code。
> `#23` = 員工的一天 33 項的項次(`2026-07-25-admin-backend-rebuild-spec.md` §1-A),不是 backlog 號。
> 報價單專案一律讀 `origin/main`(本機 clone 落後 16 顆),**只讀、零寫入**。

## 0. 🔴 先更正 §1-A 一條:「全 repo 對 `xlsx`/`.xls` 零命中」**不成立**

`package.json:46` 有 `"xlsx": "^0.18.5"`,還有 `papaparse` + `@types/papaparse`(`:28,:39`)。
數法:`grep -rniE "xlsx|\.xls\b|sheetjs|exceljs|openpyxl|csv-parse|papaparse" --include=*.ts --include=*.tsx --include=*.json --include=*.py apps/ packages/ scripts/ package.json`
⇒ 3 行命中,全在 `package.json`。分母 = 1092 個 .ts/.tsx/.py + package.json。
原斷言大概只掃了 `.ts/.tsx` ⇒ **掃描字集比宣稱窄**(memory `feedback_claim-scope-exceeds-fact-three-shapes` 的第四作用域)。

**但結論的方向沒變,只是理由要改**:三個套件都在 **`devDependencies`**(`python3 -c` 讀 package.json 驗過,
`dependencies` 為 `{}`),而且**零 import** ——
`grep -rnE "from ['\"]xlsx['\"]|require\(['\"]xlsx['\"]\)|XLSX\.|from ['\"]papaparse['\"]|Papa\." --include=*.ts --include=*.tsx --include=*.js --include=*.mjs .`(排除 node_modules 與 design-reference)⇒ **0 行**。
git 追來源:`ee51d67c`(2026-05-12)commit 標題逐字「batch install zod/papaparse/xlsx/husky/lint-staged/bundle-analyzer」
⇒ **是一次工具批裝、裝了沒用過的死相依**,不是「有能力沒接 UI」。
⇒ **本 repo 解析 Excel 的能力 = 0 行程式碼**(這句仍成立)。

## 1. 🔴 但報價單專案**已經在解析供應商 Excel**,而且跑很久了

| fetcher | 命中行數 | 做什麼 |
|---|---|---|
| `fetchers/cncracing.py` | 11 | 下載官方 xlsx URL(`:73` `modelli_compatibili_singoli_ENG.xlsx`)→ openpyxl 解析 → 寫 products |
| `fetchers/evotech.py` | 6 | 同型 |
| `fetchers/bonamici.py` | 5 | 見下方三層來源 |
| `cncracing_camoufox.py` / `cncracing_csv.py` / `kspeed.py` | 1 / 2 / 1 | 附帶引用 |

數法:逐檔 `git show origin/main:<f> | grep -ciE "openpyxl|load_workbook|\.xlsx"`,**fetcher 共 30 支、6 支命中**。

`bonamici.py:1104-1123` 的取檔順序(逐字):
1. `.env.local` 的 `BONAMICI_XLSX_URL`(註解逐字「**Google Drive 直連, 同 Evotech**」)
2. 退**本地 `incoming/` 資料夾**取 mtime 最新那支(`_find_latest_xlsx()`,`:1094-1101`)
3. 都沒有 → `None`(註解逐字「純爬蟲, xlsx 只是加分不擋」)

`:1127-1133` 逐字:「讀官方 xlsx bytes (openpyxl read_only) → dict[SKU_UPPER]…**13 欄按名定位**;EUR RRP float-int coerce」。

## 2. 所以「現況離 Sean 要的有多遠」取決於他要的是哪一件

缺的**不是解析能力**,是**上傳這個動作**。
掃報價單 `app/api/*` 與 `app/*/page.tsx` 找 `upload|formdata|multipart` ⇒ **0 行**
⇒ **兩個專案都沒有任何網頁上傳檔案的入口。**

| Sean 可能想要的 | 現況距離 | 做在哪最合理 |
|---|---|---|
| (a) 拿到供應商新報價單 → 讓網站更新 | **已經能做** —— 換掉 Google Drive 上那支檔 / 丟進 `incoming/`,fetcher 自己會吃 | 不用做,但**要確認他知道這條路** |
| (b) 想在網頁上「選檔案 → 上傳」取代換 Drive 檔 | 缺一個上傳頁 + 存檔位置 | **報價單側**(解析器與 13 欄對照都在那) |
| (c) 上傳**任意格式**的新供應商報價單(不是已支援的 6 家) | 缺整支 fetcher / 欄位對照 | 報價單側,且**每家一支**、不是通用功能 |
| (d) 上傳 Excel **直接進網站商品表**、繞過報價單 | 🔴 與同步架構衝突 —— 那批列會落進同步 scope、隔天被判孤兒軟下架(見 `2026-08-14-products-admin-line-recon.md` §2) | **不建議**,要先解 Q-B1 |

## 3. 不做 Excel 解析的替代路徑(交辦第三問)
1. **換 Drive 上那支檔**(現況、零工程)—— 若 Sean 要的是 (a),這就是答案。
2. **給 `incoming/` 一個好放檔的地方**(例如同步資料夾)—— 比蓋上傳頁便宜非常多,且解析器不用動。
3. **上傳頁只負責「把檔案放到 fetcher 找得到的位置」**,不自己解析 —— 這是 (b) 的最小版本,仍在報價單側。
⇒ **三條都不需要在本 repo 寫任何 Excel 解析。**

## 4. 誠實缺口
1. **Sean 到底要 (a)(b)(c)(d) 哪一個,我不知道** —— 這份報告只列出四種可能與各自距離,**沒有替他選**。這是本報告最大的未知。
2. mac mini 正本未讀(全部讀 `origin/main`)。
3. 我沒查 `incoming/` 資料夾**實際在哪台機器、Sean 今天怎麼放檔** —— 那是操作面,repo 裡看不出來。
4. ~~另外 24 支 fetcher 可能有我 pattern 漏掉的寫法~~ **已補掃並關閉**:
   `git grep -niE "read_excel|import pandas|xlrd|pyexcel|read_csv" origin/main -- 'fetchers/*'` ⇒ **0 行**
   ⇒ 那 24 支確實不吃 Excel(兩組 pattern 都掃過:openpyxl 族 + pandas/xlrd 族)。
5. `xlsx` / `papaparse` 兩個死相依要不要移除 —— **是另一件事,本報告只登記,不建議也不動。**
