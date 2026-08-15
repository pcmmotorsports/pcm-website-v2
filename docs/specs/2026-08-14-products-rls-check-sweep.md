# `products` 的 RLS policy + CHECK constraint 補盤

> 交辦 = `主-B-008-DISPATCH`。**盤點,零寫入**(報價單 repo 收工驗 `git status --porcelain` = 0)。
> 🔴 **mac mini 正本未讀** —— 全部讀 `origin/main`,缺口不消失。
> 方向照交辦:**從 `products` 這張表出發**列出掛在它身上的東西,不從關鍵字猜。

## 0. 🔴 先更正我自己 B-008 的語氣:第六套**預設是關的**

我在 B-008 寫第六套「是唯一在 DB 端擋的、繞過應用層時只剩它」——**「唯一在 DB 端」成立,「只剩它」會誤導。**
`reparse_runtime_state.fencing_enabled` 的欄定義是 **`boolean DEFAULT false NOT NULL`**(`baseline_schema.sql:4692`);
`migrations_archive/20260714_reparse_fencing.sql:8-9` 逐字「**初始 fencing_enabled=false 不生效**」。
開關是兩支具名函式:`activate_reparse_fencing()`(`:141-148`)/ `deactivate_reparse_fencing()`(`:1182-1189`)。
⇒ **它是 reparse 作業期間才拉起來的臨時圍籬,不是常設保護。** 平常繞過應用層 ⇒ **六套一套都不擋**。
(⚠️ 今天實際是開是關**仍要查 DB** —— 我只能證明「預設 false」與「有兩支函式可切」,**不推現況**。)
順帶:同一個旗標還管**第二支** trigger `trg_orphan_parser_guard`(`:2964`,打 `orphan_review` 不是 `products`)。

## 1. `products` 上的 RLS policy —— 3 條,**沒有一條是欄位保護**

`ALTER TABLE public.products ENABLE ROW LEVEL SECURITY`(`:6977`)。

| policy | 動作 / 角色 | 擋什麼 | 繞不繞得過 |
|---|---|---|---|
| `storefront_public_read`(`:7037`) | `SELECT` / `anon` | 只讓看 `major_category` 非空 + `price_store > 0` + `NOT hidden_from_store` 的列 | DB 層;**但 service_role 天生 bypass RLS** |
| `dealer_price_read`(`:6751`) | `SELECT` / `dealer_price_reader` | 只讓看 `is_listed` 的列 | 同上 |
| `pcm_reparse_owner_all`(`:6946`) | **ALL** / `pcm_reparse_owner` | `USING (true) WITH CHECK (true)` = **RLS 這層完全不擋** | 見 §1b —— **欄級 GRANT 才是擋它的那道** |

⇒ **RLS 在這裡是「誰看得到哪些列」,不是「哪些欄不能被改」。** 對乙案的鎖零貢獻。

## 1b. 🔴 第七套:**欄級 GRANT**

> 🔴🔴 **給下一個讀這份檔的人:不要把第七套當成一層保護。**
> 它**只約束 `pcm_reparse_owner` 這一個特殊角色**;fetcher 與所有維運腳本走的 `service_role`
> 拿的是 `GRANT ALL`(`:7675`)= **整表全欄可寫,第七套對它零效力**。
> **在「乙案新增鎖欄要同步哪幾套」這題上,第七套不算數。**

以下是它推翻我上一段剛寫的話的部分:
補掃 `GRANT ...(欄) ON TABLE public.products` 之後:`pcm_reparse_owner` 的 RLS 雖然 `WITH CHECK (true)`,
但它**只拿到 9 個欄的 UPDATE**(`:7707,7715,7722,7729,7786,7821,7828,7835,7842`)=
`brand` `model` `year_start` `year_end` `fitment_parsed` + `manually_corrected` `corrected_at` `corrected_by` `corrected_source_audit_id`。
⇒ **它連 `description_zh` 都寫不了,不是「完全不擋」。**
**這是七套裡唯一「連繞都繞不過」的一道** —— RLS 可以 bypass、trigger 可以關旗標,**欄級 GRANT 是 Postgres 權限本體**。
⚠️ 但對日常寫入沒有保護力:**`GRANT ALL ON TABLE public.products TO service_role`(`:7675`)** ——
fetcher 與所有維運腳本用的就是 service_role,**它整表全欄可寫**。
⇒ **第七套只約束 `pcm_reparse_owner` 這一個特殊角色,不約束主要寫入者。**

## 2. CHECK constraint —— 2 條,**都是值域檢查,不是保護**
表本體內(`CREATE TABLE public.products` 區塊逐行看過):
`products_price_source_currency_check`(幣別限 USD/GBP/TWD/EUR/THB/CNY/JPY 或 NULL)、
`products_stock_status_check`(限 `in_stock|low|out|discontinued` 或 NULL)。
表本體外追加的:`git grep -niE "ALTER TABLE.*products.*ADD CONSTRAINT"`(排除 FK/PK/UNIQUE)⇒ **0 行**。
⇒ **CHECK 層沒有保護機制。**

## 3. 🔴 但盤這一層撞到一件對 Q-B3 很重要的事:`is_listed` 是**算出來的,寫不進去**
`is_listed boolean GENERATED ALWAYS AS ((major_category IS NOT NULL) AND (price_store IS NOT NULL) AND (price_store > 0)) STORED`(`products` 表 `:40`)。
⇒ **報價單側的「上架與否」不是一個可寫的欄,是 `major_category` + `price_store` 推導的結果。**
同一張表另有兩個可寫的下架控制:`delisted_at`(`:46`)與 `hidden_from_store`(`:53`,`DEFAULT false NOT NULL`)。
⚠️ 這代表 Sean 拍的 **Q-B3=B(上下架權威歸我們後台)**,在報價單側**沒有「鎖住 is_listed」這個選項** ——
它連寫都寫不了。**要在那邊表達「別下架這個」只能透過 `delisted_at` / `hidden_from_store`。**
**這只是盤點事實,做法不在本檔。**

## 4. 交辦要的一句話結論:乙案新增鎖欄時,必須同步的有哪幾套

已知七套之中,**必須同步的是 3 套**(其餘 4 套不受新增鎖欄影響):

| 套 | 在哪層 | 為何必須同步 |
|---|---|---|
| **第②套** `PROTECTED_TRANSLATION_FIELDS` 等常數 + `supabase_upsert_respect_protected` | 同步管線 | 新欄要進 frozenset,否則 fetcher 照樣覆寫 |
| **第③套** `PRESERVE_ON_NULL_FIELDS` 防洗網 | 同步管線 | 若新欄同時要「別被 null 洗掉」,要一併加(**兩個集合語意不同,不是二選一**) |
| **第⑤套** `lib/safe_patch.py` 保護 11 | 維運腳本外殼 | 它只認 `translation_locked` 一個旗標;**新增第三個旗標它不會自己知道** ⇒ 否則「fetcher 尊重、腳本不尊重」 |

**不必同步**:①fitment 鎖(欄集不重疊)、④整家凍結 `supplier_freeze`(供應商級、與欄鎖正交)、
⑥DB fencing(只管 5 個 fitment 欄、且預設關)、⑦欄級 GRANT(只約束 `pcm_reparse_owner`,主要寫入者是全欄可寫的 service_role)。

## 5. 誠實缺口
1. `fencing_enabled` **今天實際開關仍未查**(要 DB)—— 我只證了預設 false + 有切換函式。
2. `recompute-prices` Edge Function 仍**完全看不到**(不在任何 repo)—— 它寫價格,是最大盲區。
3. `supplier_freeze` 今天凍了哪幾家哪幾欄 **未查**(DB 內容)。
4. ~~沒盤欄級 `GRANT`~~ **當場補掃並關閉,又翻出東西**(§1b 第七套)。
   數法:`git grep -niE "GRANT [^;]*\([^)]*\)[^;]* ON [^;]*products|REVOKE [^;]* ON [^;]*products" -- 'supabase/**'`。
   ⚠️ 我只盤 `products` **這一張表**;其他表(`product_variants` 等)的欄級授權**未盤**。
5. 第 4 節「必須同步 3 套」是**我從各套的欄集與旗標推的**,**沒有實際改一個欄去驗** —— 是分析不是實測。
6. 🔴 **三份報告下來,自標缺口連續三次補掃都翻出新東西**(第五套 → 第六套 → 第七套)。
   ⇒ **我不該把「七套」當成盤完了。** 現在的正確說法是「**已知七套**」,不是「共七套」。
