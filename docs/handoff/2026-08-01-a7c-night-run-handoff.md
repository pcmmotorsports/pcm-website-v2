# A7c 退款帳本 — 夜跑交接檔

> **這是唯一入口。開工前整份讀完,不要只讀你覺得相關的段。**
> 產生時間:2026-08-01 03:2x(台北)/ 產生者:上一個 session(HEAD `6274ce5`)
> 前身:`docs/specs/2026-08-01-refund-ledger-redesign-proposal.md`(**已凍結、且其 §2 模型已被推翻,只當歷史讀**)

---

## §0 現況(開工前自己驗一次,不要相信這段)

```bash
cd /Users/sean_1/pcm-website-v2 && bash scripts/a7c-preflight.sh
```

- branch `dev`、HEAD 應為本檔 commit;**5+ commit 未 push**
- **正式站:`A7b-M` 已 apply、`A7b-T` 未 apply**;四張退款表 + `order_cancellations` **全部 0 列**、`orders` 31 列
- 工作樹有兩個**別線的** untracked 目錄:`apps/storefront/src/app/dev-preview/mobile-catalog-ux/`、`docs/superpowers/`
  → **不要碰、不要提交、不要跑 `busboy-end`**(它會掃進去)

### 🔴 A7b-T 已從 migrations 目錄移除(Sean 2026-08-01 拍 A)

`20260731120100_m4b_e10_a7b_t_refund_job_guards.sql`(2062 行)原本躺在目錄裡卻沒登記在
正式站 ledger ⇒ 任何一次 `db push` 都會把它套上正式站。**已 `git rm`。**

- 取回 = `git show e851730:supabase/migrations/20260731120100_m4b_e10_a7b_t_refund_job_guards.sql`
  (親驗 2062 行完整)。**要參考舊設計就用這個指令讀,不要把檔案放回 migrations 目錄。**
- ⚠️ **連帶**:`scripts/a7bt-*.sh` 五支 harness 與 `a7bt-rollback.sql` 的 T 側分支從此指向
  不存在的檔、**跑起來會失敗**。這是預期的(A7b-T 線已停),檔案留著當紀錄與形狀參考。
- ✅ `db push` 現在是乾淨的:migrations 目錄最新 = `20260731120000` = 正式站 ledger 最後一筆。
  **你新增的 A7c migration 會是唯一的未 apply 檔** —— `a7c-preflight.sh` 第 6 項應該只列出它。

---

## §1 Sean 拍板全集(2026-08-01 凌晨;**不得重問、不得自行推翻**)

> ⚠️ **本節在同一晚被 Sean 連續修正三次,以下是最終版。**
> 中途版本(「只能整張退 + 拆單 + 拆單運費留在保留訂單」)**已作廢** ——
> 若在 commit 訊息、STATUS 或別的檔案看到那個字面,**以本節為準**。作廢原因見第 3、4 條。

| # | 拍板 |
|---|---|
| 1 | **換路**:停止繼續堆 A7b-T,退款資料層改走帳本式 |
| 2 | **退款一律從我們自己的後台發起**,不靠人進 TapPay Portal 手動退。理由:Portal 手動退款 PCM 完全沒參與 ⇒ 資料庫永遠不會知道,**且沒有任何東西會發現**(已用 `PTNGY2` 實證,見 §6) |
| 3 | **金額層部分退款**:金額自由填(部分/全額都行),**不追蹤「退的是哪一項、幾件」** —— 退多少錢由 Sean 判斷。⇒ 品項額度、運費差額重算、跨取消單累計**全部不做** |
| 4 | ~~拆單~~ **不做**。既然金額可自由填,缺貨要退多少就退多少,不需要把訂單切開 |
| 5 | **資料庫不做「防止超退」** —— TapPay 自己就擋(退到歸零後 Portal 退款按鈕直接消失)。我們再擋一次是重複,而且**擋不到 Portal 手動退那條路** = 在有效情境下多餘、在需要它的情境下無效 |
| 6 | **不做自動重試工人**:同步呼叫、當場看結果;不確定就按一下「查 TapPay」用 Record API 對帳。⇒ **`order_refund_jobs` 整張表不需要** |
| 7 | 「**部分退款隔日**」這條保守營運規則**維持不變**(Sean 07-31 逐字:比實測保守是刻意的,**不要拿實測去放寬它**) |

完整版含理由與實證:memory `project_a7c-full-refund-only-decisions`。

### 🔴 由 §1 推出的、資料庫真正該守的東西(只有兩條跟錢有關)

TapPay 已經替我們擋掉「退超過原刷卡金額」。**它幫不了我們的只剩兩條**:

1. **退到對的交易** —— 我們若送錯 `rec_trade_id`,TapPay 會乖乖退**別人**的錢,它無從得知
2. **不重複送同一筆** —— `bank_refund_id` 冪等鍵。🔴 **TapPay 對重複鍵的實際行為 PCM 從未測過**

其餘全是記帳與顯示:**退了多少 / 誰按的 / TapPay 回什麼識別碼 / 這張還能退多少**。
🟡 最後那項不是裝飾:Portal 的確認框只顯示**原始總額**(見 §6),**剩餘可退額只有我們算得出來**。

---

## §2 今晚的範圍(硬邊界)

### ✅ 做

**一支新 migration `A7c`,只動 `order_refunds` / `order_refund_items` 兩張表。**

要建立的性質(**具體怎麼實作由你設計,以下是要達成的效果**)。
守門估計 **8-12 道** —— 若你設計出來遠超過這個數,**先停下想想是不是又在守狀態機**:

1. **錢欄不可變** —— 帳本列寫進去之後,金額類欄位任何 UPDATE 一律拒絕
2. 🔴 **`rec_trade_id` 綁定** —— 必須等於該訂單自己的 `orders.tappay_rec_trade_id`(承重、關錢)
3. 🔴 **`bank_refund_id` 冪等** —— UNIQUE、不可變(承重、關錢)
4. **INSERT 初態受限** —— 不得直接 INSERT 成 `confirmed`/`failed` 憑空生出退款紀錄
5. **擋 DELETE / TRUNCATE** —— 帳本是唯一的退款紀錄,被清掉就沒了
6. **訂單必須真的收過錢** —— `payment_status` 閘
7. **算得出「這張訂單還能退多少」** —— 一個 view 或函式即可,**不是守門**
8. **`status` 轉移**:`processing → confirmed | failed`、終態不可轉出(**已存在於 `20260725130100:287-310`,確認它還夠用即可,不要重寫**)

### ❌ 不做(做了就是超出範圍,停下)

- **「防止超退」那一族**(累計 ≤ 訂單總額、品項額度、運費差額、跨取消單累計)—— §1 第 5 條
- **品項層追蹤**(退了哪一項、幾件)—— §1 第 3 條
- **拆單** —— §1 第 4 條
- **`order_refund_jobs` 工單表** —— 保持休眠。🔴 **`CHECK(false)` dormant gate 不要移除**
  (A7b-T 整片存在的目的就是移除它,而我們不走那條路了)
- **`TapPayChargeAdapter.refund()` 實作與後台退款按鈕** —— **下一片**。
  理由:那是「我們的程式真的會動客人的錢」,目前最高風險的一段,要單獨一片、單獨審
  (Sean 未明確答此題,上一個 session 按推薦值定;**Sean 早上可推翻**)
- **任何前台改動**

---

## §3 動工前先自己決定的設計題(不需要 Sean,但**決定要寫進 migration 註解 + commit body**)

1. 🔴 **`order_refund_items` 還要不要用?** §1 第 3 條說**不追蹤品項層** ⇒ 明細列沒有意義。
   但表已 apply、且 `20260725130100:192-242` 有一支 trigger 在對 `Σ line_amount = items_amount`。
   → 決定「一律不寫明細」還是「照寫」。**若選不寫,必須確認那支既有 trigger 不會因此變成
   恆真或恆假**(它掛在明細表上,零明細 ⇒ 永遠不觸發 ⇒ header 的 `items_amount` 就沒人對了)。
   ⚠️ 這題直接連到設計題 2,一起決定。
2. **`items_amount` / `shipping_delta` / `shipping_fee_before|after` 四欄在金額層部分退之下怎麼填?**
   既有 CHECK:`refund_amount = items_amount - shipping_delta`、
   `shipping_delta = shipping_fee_after - shipping_fee_before`(`20260725130100:115-117`,**已 apply、不可違反**)。
   🔴 **這兩條 CHECK 是為「品項退款 + 運費重算」設計的,而我們已經不做那件事了。**
   金額層部分退之下,「退 300 元」要怎麼拆成 `items_amount` 與 `shipping_delta` 才不違反等式?
   可能的答案:全部算 `items_amount`、`shipping_delta = 0`(⇒ 兩條 CHECK 自動成立);
   或另開一支 migration 放寬它們。**兩條都已 apply 到正式站,動它們 = 高風險,要提 plan。**
   **自己驗算一次再寫,不要憑直覺。**
3. **`status` 三態(`processing|confirmed|failed`)在「從後台發起、同步呼叫」流程下的語意。**
   本片不實作 `refund()`(§2 不做清單)⇒ 今晚沒有東西會把 `processing` 翻成 `confirmed`。
   → 決定:今晚是否允許帳本列存在?還是本片只建守門、等下一片才會有第一列?
   這會決定第 4 項(INSERT 初態)怎麼定,也決定驗收要不要造正向鏈。

---

## §4 已驗證的事實(**不要重查,直接用**)

| 事實 | 證據 |
|---|---|
| 四張退款表 + `order_cancellations` 正式站 0 列、`orders` 31 列 | 2026-08-01 Supabase MCP 唯讀親查 |
| 31 張訂單:26 張單品項、5 張三品項 | 同上。⚠️ **大多是測試/舊資料,不可當客人行為證據** |
| `TapPayChargeAdapter.refund()` 是 `throw`(Phase 2) | `packages/adapters/src/tappay/TapPayChargeAdapter.ts:214` |
| 現況退款 = Sean 手動 Portal + 手動改 `payment_status` | `docs/reference/tappay-reference.md:110`(07-17 拍板) |
| **未請款的交易不能部分退款**(`10024`);**全額退款不受此限、即時生效** | sandbox 真打 API 實測,`STATUS.md:20` |
| 中信請款:18:00 前授權 → 18:00 送批 → 20:00 可確認 | 官方銀行表,`STATUS.md:20` |
| PCM **沒開放分期**(pay-by-prime body 無分期欄) | `TapPayChargeAdapter.ts:85-99` |
| 分期/T2P **不支援部分退款** | `docs/reference/tappay-reference.md:105` |
| `shipping_delta` **沒有任何約束逼它 ≤ 0**(可為正) | `20260725130100:117` + 全檔無 sign CHECK |
| 105 道具名守門、其中 `a7bt_e*` 69 道;**只有 5 道讀到會被移走的錢欄** | 抽取式見 proposal §7.1 |

---

## §5 兩份方向審查的 findings(**必須逐條處置,不得整批忽略**)

- codex `gpt-5.6-sol` xhigh = **NO-GO** → `/tmp/a7c-k1-codex.txt`(第 5868 行起是判決與 findings)
- Fable 換模型 = **GO with must-fix** → 全文在上一個 session 的 task 輸出;重點已摘進 memory
- 🔴 **兩者打架的那條,上一個 session 已裁決:codex 對**(`shipping_delta` 可為正 ⇒
  「轉 failed 只會讓額度變鬆」是錯的)。**不要再重審這一條。**

⚠️ 這兩份是審**舊模型**的。新方向(全額退)讓其中一部分自動 moot,
但下列幾條**在新模型下仍然成立、必須處理**:

1. 直接 INSERT 成終態繞過狀態機 —— 帳本 shape CHECK 允許 INSERT 即 `confirmed`(`20260725130100:126`)
2. owner 的 DELETE 清歷史 —— 帳本 header **沒有** BEFORE DELETE 擋(只擋了 TRUNCATE,`:277-281`)
3. `SUM()` 對零列回 **NULL** ⇒ `IF NOT (NULL <= cap)` 不會 RAISE ⇒ 必須 `COALESCE(...,0)`
4. `FOR UPDATE` 後聚合的論證依賴 READ COMMITTED ⇒ 隔離級閘要留

---

## §6 ✅ 已解除:TapPay Portal 部分退款 —— Sean 2026-08-01 在**正式站後台實做並截圖佐證**

**觀察值(截圖逐字,不是推論)**。交易 `D20260730Lu5BOq` / 101 元 / **正式站**
(列表含真刷的 `D20260724gUTcg1` 101 元「已退款」):

| 動作 | 金額 | 退款識別碼 | 結果 | 交易狀態 |
|---|---|---|---|---|
| 授權 | 101 | — | 成功 `2026-07-30 13:38:10` | |
| 請款 | | — | 成功 `2026-07-30 22:10:21` | |
| 退款 ① | 51 | `DR202608019u2aCY` | 成功 | → **部分退款** |
| 退款 ② | 50 | `DR20260801Etkiyx` | 成功 | → **已退款** |

⇒ **請款後可自行輸入金額部分退款,且可多次、累計到歸零。已實證,拆單路徑可執行。**
⇒ 這同時關掉了 memory `project_m4b-a7b-refund-jobs-decisions` 登記的
  「TapPay 多次部分退款官方零明文 + PCM 從未跑過」那個未知數 —— **但只關 Portal 這條路**。

⚠️ **仍未測:Refund API(程式呼叫)的多次部分退款。** Portal 與 API 是兩條路徑,
  不得拿 Portal 的結果宣稱 API 可行(`refund()` 目前仍是 `throw`,見 §4)。

### 🟡 Portal 的 UX 陷阱(這正是後台該補的價值)

第二次退款的確認框逐字:「**這筆交易總金額為 TWD 101 元**,您確定要退款 TWD 50 元嗎?」
—— 它顯示的是**原始總額**,不是**剩餘可退額**。人在第二次退款時看到的數字是 101,
而實際只剩 50 可退。⇒ **「這張訂單還能退多少」正是 A7c 要算給 Sean 看的數字**,
不是可有可無的裝飾。

### 🔴🔴 但它同時推翻了一個架構前提 —— 這是本檔最重要的一段

**退款識別碼是 TapPay 自己產生的(`DR2026...`),不是 PCM 送出的 `bank_refund_id`。**
因為**執行退款的地方是 Portal,PCM 整個沒參與** ⇒ 錢退掉了、我們的資料庫毫不知情。

**⇒ Phase 1 的真相來源是 TapPay,不是我們的帳本。** 我們的守門**擋不住 Sean 在 Portal 多退**,
它只能擋住「我們自己的紀錄寫錯」。任何把 A7c 說成「防止超退」的字面都是**過度宣稱**。

**⇒ 因此 A7c 的定位改成(上一個 session 的設計決定,非 Sean 拍板,審查時應優先攻擊)**:

```
① 後台登記退款意圖  → 系統算出「這張訂單還能退多少」並擋住超額登記
② Sean 照那個數字去 Portal 退
③ 回填 TapPay 給的退款識別碼(DR...)結案 ← 這是唯一的對帳點
```

連帶必須處理:
- `bank_refund_id`(PCM 自產冪等鍵)在手動流程下**沒有用武之地** —— 是否還要 NOT NULL?
- 帳本要能容納「事後才發現的、系統沒登記過的退款」(Record API 對帳補登)
- 「一張訂單至多一筆退款」這條在**我們的帳本內**成立,但**擋不到 TapPay** —— 註解不得寫成擋得到

### ⚠️ 順帶記一條與既有紀錄矛盾的觀察(不抹平)

授權 `07-30 13:38` → 請款成功 **同一天 22:10**。
而 `STATUS.md:20` 記著「Cap Today API 與 Portal 手動點擊都只是**排程**,回 `cap_millis` = 隔天 18:00」。
兩者對不上。可能差異:Portal 手動請款 vs API 請款、或當天送批批次時間。**未釐清,不要拿任一句當定論。**

---

## §7 驗收條件(每條都要 yes/no,**不得用「應該可以」結案**)

1. `bash scripts/a7c-preflight.sh` 退出碼 0
2. 從零 provision 的隔離庫上套完**全部既有 migration + A7c** = EXIT 0
3. **重複套用**該 migration → 乾淨停住、零殘留
4. 每一道新守門都有**至少一條負測**,且負測斷言的是**指定的 `CONSTRAINT_NAME`**,不是「反正紅了」
5. **突變測試**:逐一破壞每道守門 → 它的負測必須轉綠(= 該守門承重);**0 個死規則**
6. 正向鏈**坐在邊界上**(退款金額恰等於訂單總額),比較子寫錯一元會全紅
7. 三綠(typecheck + lint;動 .ts/.tsx 加 build)
8. `git status --porcelain` 與開工時相比,只多出你自己的產物

🔴 **fixture 每個欄位值都要問一次「這個值是不是讓某條守門變成恆真」**
(memory `feedback_fixture-value-makes-guard-vacuous` —— 上一輪就是運費 = 0 讓一整族守門失去判別力)。

---

## §8 必停條件(命中任一 → 停下寫報告,等 Sean 早上看)

- 想 `apply` / `db push` / `push` → **停**。apply 是 Sean 手動,且必須在審查收斂之後
- 想改測試期望值、`disable`/`skip`/`ignore` 任何檢查 → **立即停止訊號**
- 同一件事重試 2 輪仍失敗 → 停
- 審查 3 輪仍不收斂 → 停(第 3 輪起必須**換模型、換角度**)
- 發現需要動 §2 的「不做」清單 → 停
- 發現與 §1 任一拍板矛盾 → 停,不要假設 Sean 會同意

---

## §9 紅線

- `git add` **一律精確 pathspec**;add 完立刻 commit。**絕不 `git add .` / `-A`、絕不 `--amend`**
  (🔴 另一個 session 並行在同一個工作目錄)
- **不 push、不 apply、不跑 `busboy-end`**
- 不碰 `.env*`、不碰 `docs/archive/*`
- 不碰別線那兩個 untracked 目錄
- 交辦 subagent **一律顯式指定 model**
- **回報字面 = 事實**:沒驗過的不要寫「應該可以」;做到哪、剩什麼、卡在哪,照實寫

---

## §10 已知的坑(踩過的,別再踩一次)

- `scripts/d1t2-rehearsal.sh provision` **不會**自己清殘留 postmaster(只有 `all` 會)
  → `a7c-preflight.sh` 已代勞,但只清 pgdata 在暫存目錄下的
- psql 變數 **不會**在 dollar-quoted 區塊(`$$ ... $$`)裡展開 —— 突變腳本要用 shell 展開的 heredoc
- `SET TRANSACTION ISOLATION LEVEL` 必須是交易第一句,否則回 `25001`
- 改 migration 內容 → **函式指紋常數要一起改**,並從零 provision 驗它真的套得上去
- `%%` 只在 `RAISE`/`format` 的格式字串裡是轉義;普通 SQL 字串裡是兩個 `%`
- 表計數器會被交易 rollback ⇒ 計次要用 sequence
- 審查前**先凍結版本**(記 mtime),送審後不要再動檔案

— END —
