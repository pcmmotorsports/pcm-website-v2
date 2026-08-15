# 保護機制反向盤點 · 從 30 支 fetcher 往外找(交辦問「有沒有第五套」,答案是**兩套**)

> 交辦 = `主-B-007-DISPATCH`。**盤點,零寫入**(報價單 repo 收工驗 `git status --porcelain` = 0)。
> 🔴 **mac mini 正本未讀** —— 全部讀 `origin/main`,缺口不消失。
> 方向照交辦**反過來**:先逐支 fetcher 往外找,再往 `scripts/` `lib/` `app/` 擴,**不從常數區向外找**。

## 結論:**找到兩套,不是一套** —— 第五套在維運腳本層、第六套在 DB 層

### 第六套(DB 層,補掃 `supabase/` 才找到)—— `trg_products_parser_guard`
`baseline_schema.sql:6543` `BEFORE UPDATE ON public.products FOR EACH ROW`;函式本體 `:3011-3041`。
形狀**又和前五套都不同**:不看旗標、不看 null,而是看**寫入來源**(`_pcm_write_provenance()`)——
只要這次 UPDATE 動到 `brand/model/year_start/year_end/fitment_parsed` 任一欄,就查來源:
`ingest`(fetcher 例行)與 `maintenance`(人工維護腳本)放行;`reparse:<id>` 要**回查控制表**確認該 task
`status='running'` 且 `lease_expires_at > now()` 才放行(註解逐字「不只信 GUC 字串」)。
整套由 `reparse_runtime_state.fencing_enabled` 這個 runtime 旗標總開關(`:3017`,關掉就整個放行)。
⇒ **這是唯一一套在 DB 端擋的**;前五套都在應用層,繞過應用層就沒了。

### 第五套(維運腳本層)—— `lib/safe_patch.py`
批次 PATCH `products` 的安全外殼,檔頭逐字「兩條施工線共用 (2026-08-13)」、`TABLE = "products"`,共 13 道保護。
**保護什麼欄**:不綁特定欄,對呼叫端指定的任何目標欄生效。**全家還是單家**:逐列(CAS 帶 `id` + 每個目標欄 `eq.<before>`)。
🔴 **綁旗標**:保護 11 逐字「**鎖列預設拒寫**: `translation_locked=true` 要**該列**帶非空理由才准,理由進收據」。
**形狀**:前四套是同步管線內的「不要覆寫」,這套是維運腳本外殼的「改之前先證明你知道現值」。

## 反向掃的過程與數字(可重跑)

**① 逐支 fetcher 找自訂保護常數** —— 分母 **30 支 `.py`**。
`grep -nE "^[A-Z_]+(: *frozenset\[str\])? *[:=].*(frozenset|set)\("` 逐支跑,`base.py` 以外**命中 8 個常數**
(`KNOWN_DOC_TYPE_IDS`、`_KNOWN_UNSCRAPED_CATS`、`_NON_VEHICLE_MARCA`、`FASTENER_CATEGORIES`、
`TEASER_TYPES`…)—— **逐個看過,全是領域分類集,沒有一個是保護集。**
⇒ **沒有 fetcher 自己另寫一套欄位保護。**

**② 逐支 fetcher 看寫入路徑** —— 三種寫入(`supabase_upsert_respect_protected` / 裸 `supabase_upsert` / 自寫 `client.post|patch|put`)
逐支計數,**只有 4 支有直接寫入**,逐支開檔確認打哪張表:

`rpm.py:1343` 走 `respect_protected` 寫 **`products`**(唯一一支);`rpm.py:1384`(`orphan_review`)、
`rpm_menu.py:254`(`rpm_collection_generations`)、`front3d.py:252`(`front3d_sku_cache`)都**不是 products**
——後者註解逐字「只 INSERT 新 mergeKey (PK 衝突忽略, **永不覆蓋既有**)」= 又一種形狀,但不在 products 上。
🔴 `samco_price.py:367` 打的是 **Supabase Edge Function `recompute-prices`** ——**看不到內容**(誠實缺口 1)。
⇒ 其餘 26 支不直接寫、走 `base.py` 共用路徑。**fetcher 這條線上 `products` 的寫入都經過 `respect_protected`。**

**③ 往外擴到 `scripts/` `lib/` `app/`** —— 分母 **517 檔 `.py`/`.ts`/`.tsx`**。
用 `safe_patch` 的:**13 支**(全部是 `apply_*_20260813/20260814` 這一批 + `gen_storefront_ai_copy` + `storefront_copy_lint`)。

🔴 **`scripts/` 內 206 支 `.py` 中,23 支會 PATCH `products` 且不經 `safe_patch`。**
多數是 2026-05~07 的一次性 backfill(`safe_patch` 2026-08-13 才建、**它們更早,不是違規**);
但 `akrapovic_name_backfill.py`(2026-08-14)與它**同期卻沒用它**。
⚠️ **觀察不是指控** —— 我沒看那支改哪些欄,也不知道是否刻意排除。

## 這對乙案的意義(只陳述)
1. 鎖旗標的消費者**不只 fetcher**:第五套也綁 `translation_locked`。新增鎖欄要一併考慮這條線,
   否則會出現「fetcher 尊重、維運腳本不尊重」。
2. 六套保護分屬**三層**(同步管線 / 維運腳本外殼 / DB trigger),**只有第六套在 DB 端** ——
   繞過應用層時只剩它。乙案新增的鎖要不要也落到 DB 層,是個沒被問過的問題。

## 誠實缺口
1. 🔴 **`recompute-prices` Edge Function 不在這個 repo 裡** —— 它會寫價格,**我完全看不到它的內容**,
   也不知道它尊不尊重任何鎖。**這是本次掃描最大的盲區**,且正好落在 Sean 最在意的「價錢」上。
2. 那 23 支不經 `safe_patch` 的腳本 **我沒逐支開檔**看它們改哪些欄 —— 只數了「會 PATCH products 且沒 import safe_patch」。
3. ~~`supabase/` 179 檔沒掃、若保護做在 DB trigger 層會整個漏掉~~ **當場補掃並關閉,而且真的找到東西**
   (第六套 `trg_products_parser_guard`)。數法:`git grep -niE "CREATE +TRIGGER|BEFORE +(UPDATE|INSERT) +ON +(public\.)?products|CREATE +RULE" -- 'supabase/**'`
   ⇒ `products` 上的 trigger **只有這一支**(另一支命中在 `migrations_archive/` 是同一支的舊版)。
   ⚠️ 但我**只掃了 trigger/rule,沒掃 RLS policy 與 CHECK constraint** —— 那層仍未盤。
4. `fencing_enabled` 今天是開是關 **未查**(那是 DB 內容不是 code)⇒ 第六套**可能整個沒在生效**,我不知道。
5. mac mini 正本未讀。
