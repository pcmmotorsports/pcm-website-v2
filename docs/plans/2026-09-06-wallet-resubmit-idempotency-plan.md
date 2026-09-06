# Plan · 儲值金重送重複入帳去重 —— 線【帳號】`account` 2026-09-06

> **狀態:等主視窗批 + codex `-m gpt-6-astra` 審 plan。批了才動碼。本檔零碼改動。**
> 拍板:Sean 2026-09-06 逐字「**甲=上線前必修(帳號窗做,高強度審查)**」。
> 題源:體檢窗 `-89` gpt-6-astra 派工包【2】(全程靜態讀碼)。

## 0. 接單第一動:重數範圍(當場量的)

| 對象 | 量到的 | 怎麼量的 |
|---|---|---|
| RPC 世代 | `admin_adjust_wallet` **newest = `20260716210000`**(repo 裡 **1 代 / 1 個定義點**) | `bash scripts/latest-definition-of.sh admin_adjust_wallet` |
| 正式庫那一支 | `prosrc` md5 **`ad55861bb449dfc98ae6630dceea546f`** · 6 參數 · SECURITY DEFINER · `search_path=""` | `bash scripts/readonly-prod-sql.sh` 查 `pg_proc` |
| 函式在檔裡的位置 | `20260716210000_m4a_admin_adjust_wallet_rpc.sql:37-148` | `grep -n` + `awk` |
| ledger 欄位 | `id · customer_user_id · entry_date · entry_type · amount · note · related_order_id · created_at`(**8 欄, 沒有任何冪等鍵欄位**) | `information_schema.columns` |
| ledger 索引 | `pkey(id)` · `customer_idx` · `date_idx` ⇒ **除了主鍵沒有任何 UNIQUE** | `pg_indexes` |
| 餘額怎麼變 | `customer_wallet_ledger` 的 **AFTER INSERT** trigger `on_wallet_ledger_inserted` ⇒ `sync_wallet_balance_on_ledger_insert()` | `pg_get_triggerdef` |
| 現況存量 | ledger **3** 列 · customers **15** 列 · 稽核 `customer.wallet.adjust` **3** 列 | `count(*)` |

🛑 **存量 3 列 ⇒ 「今天沒有重複入帳」這句話沒有分母**。本片不拿那個 0 當任何論據。

## 1. 病灶(逐字, 不是我重述)

派工包逐字:「員工扣 500, DB 已提交但回應遺失, 同一操作再送 ⇒ 扣 1000;
`FOR UPDATE` 只排順序不辨認同一次業務操作, 前端 pending disable 擋不到提交成功後的重送。」

我開檔核過, **成立**:
```
20260716210000:113  SELECT wallet_balance, total_deposit … FROM public.customers WHERE user_id = … FOR UPDATE;
20260716210000:118  INSERT INTO public.customer_wallet_ledger (customer_user_id, entry_type, amount, note) VALUES (…);
```
⇒ `FOR UPDATE` 只讓兩發**排隊**, 排完**兩發都插**。而 ledger 上沒有任何 UNIQUE 擋得住第二列。

## 2. 🔴🔴 而 backlog `#279` 已經提過一個解法, 而**那個解法擋不到它要擋的情境**

`docs/phase-1-backlog.md:8191` `#279` 的「預期解法」逐字:
> `customer_wallet_ledger` 加 `request_id text` 欄 … RPC 改收 `p_request_id` 入列、撞唯一鍵回 `'DUPLICATE'`

**為什麼不成立**(三段, 每段都開了檔):
```
① apps/admin/src/lib/customers/wallet-actions.ts:45   const requestId = await getRequestId();
② apps/admin/src/lib/audit/context.ts:17-20           return store.get(REQUEST_ID_HEADER) ?? generateRequestId();
③ apps/admin/src/lib/request-id.ts:6,13-15            REQUEST_ID_HEADER = 'x-request-id'
                                                       generateRequestId() ⇒ `req_${crypto.randomUUID()}`
```
⇒ 📌 **`request_id` 是「一次 HTTP 請求」的 correlation id** —— middleware 每個請求戳一個, 沒有就現產一個。
⇒ 🔴 **瀏覽器 back-resubmit / 網路重送 = 一個【新的 HTTP 請求】= 一個【新的 request_id】**
   ⇒ 拿它當冪等鍵, **兩發的鍵不同 ⇒ 唯一索引不會撞 ⇒ 照樣扣兩次。**
⇒ 🛑 **`#279` 那個解法會【看起來做完了】而病還在** —— migration 貼了、索引建了、三綠全綠, 而重送照樣重複入帳。

⛔ ~~`#279` 舊拍板「D1=A:island 保留、DB 去重進 backlog 隨 tier 片評」(= 延後)~~
**2026-09-06 Sean 拍甲取代**(上線前必修)。而**它的預期解法也一併作廢**, 理由如上。

## 3. 冪等鍵要怎麼來(這是本片的核心決策)

```
甲(推薦)= 【前端產、隨表單走】—— 表單渲染時產一個 token 放 hidden input,
          重送時瀏覽器把【同一個 token】再送一次 ⇒ 兩發的鍵相同 ⇒ 撞得到。
乙       = 【伺服器算內容雜湊】—— hash(customer + entry_type + amount + note + actor + 時間桶)
丙       = 沿用 request_id(= #279 舊解法)⇒ 🔴 已證不成立, 列在這裡只為了讓搜到的人知道為什麼
```
🔵 **推薦甲的理由**:它是這個問題的定義 —— 「同一次**業務操作**」的身分只有**發起那一刻**知道,
  伺服器事後看不出「這是重送還是他真的想再扣一次」。
🛑 **乙的代價要明寫**:員工**真的想**連續扣兩筆同金額同備註時(例如兩張同價的維修單),
  乙會把第二筆當重複擋掉 ⇒ **那是誤擋, 而客人的錢在裡面**。時間桶調大調小都只是換誤判方向。
⚠️ **甲的天花板也要明寫**:token 住在表單裡 ⇒ **重新整理頁面會拿到新 token** ⇒ 那一發擋不到。
  它擋的是「同一份已渲染的表單被再送一次」(= back-resubmit / 網路重送 / 雙擊)——**那正是派工包描述的那個情境**。

## 4. 重送要回什麼

```
· 撞到同鍵 ⇒ **不重複入帳**, 回一個**與成功不同**的固定碼 'DUPLICATE'
· UI 顯示:「這筆已經處理過了, 沒有重複扣款」——🔴 不是錯誤紅字(它不是失敗)
· 🛑 不回 'ADJUSTED':那會讓呼叫端無法分辨「我這一發做了事」與「上一發做過了」,
  而稽核與對帳都需要那個差別。
```

## 5. 做法(高風險片, 全程走硬閘)

1. **新 migration**:`customer_wallet_ledger` 加 `idempotency_key text`(nullable)
   \+ **partial UNIQUE index**(`WHERE idempotency_key IS NOT NULL`)⇒ 舊列不受影響。
2. **`CREATE OR REPLACE admin_adjust_wallet`**:多收一個參數, `INSERT … ON CONFLICT DO NOTHING`,
   `ROW_COUNT = 0` ⇒ 回 `'DUPLICATE'`。
   🔴 **前置閘照 `20260906700000` 那一套**:多載數 · 簽章語意 · **原始 `prosrc` md5 錨 `ad55861b…`** · COMMENT 錨 · ACL 白名單。
   🛑 **多一個參數 = 新簽章 ⇒ `CREATE OR REPLACE` 會【新增一支多載】而不是換掉它**
   ⇒ 必須 `DROP FUNCTION` 舊簽章, 而 **DROP 要先確認沒有別的呼叫端** —— 這一格要單獨驗。
3. **app 端**:表單加 hidden token、`adjustCustomerWallet` 多帶一個欄位、`'DUPLICATE'` 的收斂碼與文案。
4. **鑽機**(可重跑, 會紅):拋棄式 PG + 最小 fixtures。
5. **rollback**(含止血步驟與 force 逃生口, 照 `2026-09-06-card-success-supersede-ROLLBACK.sql` 的形狀)。
6. **唯讀對帳**(貼前/貼後各一發)。

## 6. 驗收(每條 yes/no;含指定的那三格)

1. 🔴 **同鍵送兩次, 餘額只動一次** —— 鑽機:`ledger` 增 **1** 列、`customers.wallet_balance` 差 **1 筆金額**、第二發回 `'DUPLICATE'`。
2. 🔴 **不同鍵送兩次, 餘額動兩次** —— 正對照(少了它, 一支「永遠回 DUPLICATE」的壞實作也會讓第 1 格綠)。
3. 🔴 **舊列不受影響** —— `idempotency_key IS NULL` 的既有 3 列仍可查詢、partial index 不擋它們;
   且**再插一列 NULL 鍵仍然成功**(證明那道 UNIQUE 是 partial 不是全表)。
4. migration 的前置閘與事後斷言全過;md5 雙錨(舊 `ad55861b…` / 新的貼完再量)。
5. 三綠 + `vitest` 跑到動到的那些檔(連跑兩發比四個數)。
6. **貼前對帳**印出「線上 = 貼前世界」;貼後由主視窗跑同一支印「貼後世界」。
7. codex `-m gpt-6-astra` 審 **plan** 與 **diff** 各一輪(鐵則 12 ①錢 ③schema, 不降級)。

## 7. Rollback

- 加欄位與索引 ⇒ 還原要 `DROP INDEX` + `DROP COLUMN`;🛑 **`DROP COLUMN` 會丟掉已寫入的鍵**
  ⇒ 還原檔要先印一句「這些鍵會消失, 而它們是去重的唯一依據」讓人確認。
- 函式還原 = `DROP` 新簽章 + `CREATE` 舊簽章(逐字抄 `20260716210000:37-148`)+ md5 錨。
- ⚠️ **不可逆的那一半**:還原之後, 曾被擋下的重送**不會**補扣回來(那是好事, 寫在這裡是因為字面要等於事實)。

## 8. 風險與誠實申報

- 🔴 **改簽章 = 要 DROP** —— 這是本片最危險的一步(比日界那片與 supersede 那片都危險),
  因為 `DROP FUNCTION` 期間任何呼叫端都會炸。⇒ **要在 plan 審查時單獨問這一格怎麼做。**
  🔵 替代:**保留舊簽章當 wrapper**(舊 6 參數版轉呼新版、鍵傳 NULL)⇒ 不用 DROP, 而多一支要維護。
- ⚠️ **存量 3 列** ⇒ 「今天有沒有發生過重複入帳」**量不到**;本片不宣稱修好了一個已發生的問題。
- ⚠️ 我**沒有**碰 `#280`(同支 RPC 的 `v_ws` 空白集不全)—— 那是另一條, 不夾帶。

## 9. 要主視窗裁的

```
Q-wallet1(產品/資料):冪等鍵怎麼來?
  甲 = 前端產、隨表單走(推薦;§3)
  乙 = 伺服器算內容雜湊(會誤擋「真的想扣兩筆一樣的」)
  A: 甲|乙

Q-wallet2(工程):新參數怎麼上?
  甲 = DROP 舊簽章 + CREATE 新簽章(乾淨, 而 DROP 期間呼叫端會炸)
  乙 = 保留舊 6 參數版當 wrapper 轉呼新版(不用 DROP, 多一支要維護)(推薦)
  A: 甲|乙

Q-wallet3(工程):重送回什麼碼?
  甲 = 新固定碼 'DUPLICATE' + 專用文案(推薦;§4)
  乙 = 回 'ADJUSTED' 當成功(呼叫端分不出來)
  A: 甲|乙
```
