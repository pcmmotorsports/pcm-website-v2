# A7c 已上正式站 — 交接檔(2026-08-01 早)

> **接手入口。開工前整份讀完。**
> 前身 = `docs/handoff/2026-08-01-a7c-night-run-handoff.md`(夜跑指令書,**已完成、只當歷史讀**)
> 結果報告 = `docs/handoff/2026-08-01-a7c-night-run-report.md`(細節、四輪審查、未解題)

---

## §0 一句話現況

**A7c 退款帳本已改成「記金額」、已 commit、已 push、已 apply 到正式站、型別已重 gen。**
工作樹乾淨、0 個未推 commit。下一步是**今晚 22:00 後的 sandbox API 退款實測**,
以及之後的 `refund()` 實作片。

```bash
cd /Users/sean_1/pcm-website-v2 && git branch --show-current && git log --oneline -3 && git status --porcelain
```
預期:branch=`dev` / HEAD=`2e0aaa7` / 只有兩個**別線的** untracked 目錄
(`apps/storefront/src/app/dev-preview/mobile-catalog-ux/`、`docs/superpowers/`)
→ **不要碰、不要提交、不要跑 `busboy-end`**(它會掃進去)。

---

## §1 這個 session 做了什麼

| commit | 內容 |
|---|---|
| `44c8ee2` | A7c 退款帳本改記金額 + 十四道守門(migration 712 行 + harness 566 行 + 報告 + STATUS) |
| `2e0aaa7` | 重 gen `database.types.ts` 對齊 apply 後的正式站 |

**兩筆都已 push 到 `origin/dev`。**

### Sean 2026-08-01 早上拍板三題(都依照建議)

- **Q1=A**:帳本改成「記金額」,**改形狀摺進同一支 migration**(不另開檔)
- **Q2=A**:已結案那筆填錯**先不做**更正出口
- **Q3=A**:轉 failed 前的對帳**只寫營運鐵律**,不做 DB 守門

拍板全集 = memory `project_a7c-q1-amount-ledger-decisions`。

### 改形狀砍了什麼

砍兩條 CHECK(`refund_amount = items_amount - shipping_delta`、
`shipping_delta = 後運費 - 前運費`)、兩支主從一致性 CONSTRAINT TRIGGER 與函式
`pcm_assert_refund_ledger_consistent()`、四欄(`items_amount` / `shipping_fee_before` /
`shipping_fee_after` / `shipping_delta`)。`order_refund_items` **保留但凍結**。

三個實測出來的問題因此同時消失:自由金額寫不進去 / 要記「退 300」只能虛構運費 /
折扣單高估(實測實收 7348 的單被逼成 7448、多一個折扣額)。

---

## §2 🔴 正式站狀態(已變更,接手前務必知道)

**A7c 已 apply**(`supabase db push`,2026-08-01 上午,由本 session 執行 —— Sean 授權
「db push 部分都你處理」)。migration ledger 已登記 `20260801120000`,無待套用項目。

**apply 後獨立驗證(MCP 唯讀實查)**:

| 檢查 | 值 |
|---|---|
| 四個舊金額欄是否還在 | **0**(已消失) |
| `rec_trade_id` NOT NULL | **true** |
| A7c trigger 啟用數(origin) | **5** |
| `order_refunds` 列數 | 0 |
| `order_refund_items` 列數 | 0 |

⚠️ **改形狀是破壞性的**:那四個欄位已經不存在,rollback 只能重建結構、**無法還原資料**
(apply 當下兩表為 0 列,所以沒有資料損失)。

---

## §3 下一步(依序)

### 1️⃣ 今晚 22:00 後 — sandbox API 退款實測(**下一片的硬前置**)

sandbox 交易 `D202607314b3cIL` 今天 18:00 送批。**Sean 明確說要等今晚 10 點後才測得了。**

回答兩個 PCM 從未測過的問題:
- **Refund API 支不支援「多次部分退款」**(Portal 已實證,**API 側全未測**)
- **超額退款會不會被 API 拒絕**
  🔴 **Portal 按鈕消失只證明介面擋住、不證明 API 會拒**,而 API 才是我們要走的路。

**腳本已備好**:`scripts/tappay-sandbox-refund-probe.py`

```bash
python3 scripts/tappay-sandbox-refund-probe.py plan     # 先看測試順序,零 API 呼叫
python3 scripts/tappay-sandbox-refund-probe.py query    # 唯讀:查交易現況
python3 scripts/tappay-sandbox-refund-probe.py refund 10   # 送出一筆部分退款
```

安全設計:端點寫死 sandbox 且送出前再驗 host、身分閘 `merchant_id=pcmmoto_CTBC`、
`partner_key` 絕不進任何輸出、**退款必須顯式給金額**(不帶金額 = TapPay 的全額退款語意,
避免手滑把整筆退掉就沒得測)。金鑰在 `.env.tappay-sandbox`(已 gitignore,**值不要貼進對話**)。

🔴 **第 1 步是唯讀的:先確認 `is_captured=true`。若還是 false 就停** ——
未請款的交易做部分退款必回 `10024`,測了也沒意義。

### 2️⃣ `TapPayChargeAdapter.refund()` 實作 + 後台退款按鈕

**最高風險段:我們的程式真的會動客人的錢。單獨一片、單獨審。**
現況 `packages/adapters/src/tappay/TapPayChargeAdapter.ts:214` 是一行 `throw`。
規格見 `docs/reference/tappay-reference.md` §2.3。開工前應先有 ①的實測結果。

### 3️⃣ 其他待辦(不擋前兩項)

- 訂單 `PTNGY2` 的 `payment_status` 仍是 `paid`,但該筆交易已於 08-01 凌晨全額退完(51+50)
  ⇒ **正式站資料與事實不符**,Sean 說要他在場才改。
- 正式站真刷單 `6XC4VC`(08-01 凌晨約 03:40)⇒ 今晚 22:00-22:30 左右自動請款完成
  → Sean 用它測 Portal 部分退款。🔴 凌晨下單是否同批未觀察 ⇒ **先看 Portal 轉「已請款」再測**。

---

## §4 🔴 唯一會真的退兩次錢的路(Sean Q3=A 只寫規則、不設守門)

拍板⑤ 說「防超退交給 TapPay」,**但 TapPay 只擋「累計超過原始刷卡金額」**:

```
退款其實已經執行 → 但沒拿到 / 沒記到對帳碼
→ 操作者把那筆轉成 failed(我們自己文件寫的更正路徑)
→ pcm_order_refundable_remaining() 算出的剩餘可退額回升
→ 照著那個數字再退一次
→ 兩次部分退款的累計仍在原刷卡額之內 ⇒ TapPay 不會攔
```

⇒ **營運鐵律:轉 failed 之前必須先用 TapPay Record API 對帳。**
已寫進 migration 註解、表 COMMENT、與「禁止 DELETE」的錯誤訊息裡。
做後台退款按鈕那片時,可考慮升級成強制流程(= 報告 Q3 的選項 B)。

---

## §5 未解題(等 Sean 拍板,不擋下一步)

1. **匯款訂單無法登記退款** —— `rec_trade_id` 是 `NOT NULL`,沒有 TapPay 交易的訂單被擋死。
   刻意 fail-closed,但會擋到營運。🔴 STATUS.md 記著「5 筆已付款訂單有 2 筆
   `tappay_rec_trade_id` 為 NULL」(**本 session 未重新查證正式站**,那是既有紀錄)。
2. **`partiallyPaid` 也被擋** —— 匯款可分多筆進來;放寬第 1 項時這道要一起看。
3. **帳本不能容納「事後才發現、系統沒登記過的退款」** —— Portal 手動退後想用 Record API
   補登,會撞上「初態必須 processing」與 `rec_trade_id` 綁定。
4. **重複扣款那天記不了** —— `orders` 只有一欄 `tappay_rec_trade_id`,同一張訂單被扣兩次時
   「退掉第二筆(重複的)交易」物理上無法登記。**這正是 Sean #301 最在乎的情境**。

---

## §6 給接手的人:這個 session 踩過的坑

### 🔴 重 gen `database.types.ts` 會沖掉的不只中文檔頭

本體 `create_order.Args` 內另有**兩處手動校正**(`p_client_ip` / `p_client_ua` /
`p_notification_email` 的 `| null`)。PostgREST 產生器表達不了「必填但可為 null」,
一律型別化成非 null string ⇒ **漏貼會讓金流建單路徑型別紅**。
本次確實又被沖掉、typecheck 當場轉紅,已重貼並在檔頭加警語。

### 🔴 `.env.local` 會擋住所有 supabase CLI 指令

實測錯誤逐字:`failed to parse environment file: .env.local (unexpected character '¿' in variable name)`。
**即使用 `--project-id` 也會先 parse 它。** 標準做法:跑之前 `mv .env.local <bak>`、
跑完立刻放回(用 `trap ... EXIT` 保證還原)。本 session 每次都驗過「已還原 + 無殘留備份」。

### 🔴 測試騙了我六次(數字是報給 Sean 的,所以每一次都要記)

1. 突變判準把「被**別道**守門擋下」記成「本道承重」⇒ 據此刪掉一條真死規則。
2. 明細保護 oracle 抓錯兇手(比對訊息含表名,而新守門訊息剛好帶表名)。
3. 敏感度測試**自己走了我判定為說謊的那條路**(虛構運費)。
4. INSERT 負測只插 header 就 rollback ⇒ 既有 DEFERRED 不變式**從未執行** ⇒ 5 道守門假綠。
5. 負測多帶一個欄位 ⇒ 突變後被別道接住 ⇒ 又一次假承重。
6. 補掛載點測試時**刪的是空表** —— **BEFORE ROW trigger 對 0 列不觸發** ⇒ 假失敗。

⇒ 通則:**「負測轉紅」有兩種原因**(攻擊真的進去了 / 被別道擋了),不分開就會把
被蘊含的死規則記成承重。harness 現在是三態判準(`NEG-OPEN` / `NEG-OTHER` / `NEG-PASS`)。

### 🔴 fixture 兩次踩同一類坑

先是運費 = 0、後是折扣 = 0,都讓一整族判斷失去判別力。現在 fixture 每個值旁邊都寫著
「為什麼不能是 0」。

---

## §7 驗收 harness 怎麼跑

```bash
bash scripts/d1t2-rehearsal.sh provision /tmp/a7c-work    # 建拋棄式 PG17 + 套全部 migration
bash scripts/a7c-verify.sh /tmp/a7c-work                  # 43 項全綠 / 14 道守門突變全承重
bash scripts/d1t2-rehearsal.sh teardown /tmp/a7c-work
```

harness 自帶安全閘:會驗 `.d1t2-harness` 標記檔 + `data_directory` 對得上,
**確認是拋棄式測試庫才肯跑**(它的 fixture 會對 `orders` 做破壞性 UPDATE)。

---

## §8 沒做的事(明說,不假裝)

- **graphify 地圖未刷**。理由:CLAUDE.md 明訂「`/graphify --update` 不隨每 slice,
  milestone 收尾或每日收工跑一次即可」,本次是 slice 收尾。要刷的話從 repo 根跑。
- **sandbox API 退款實測未跑**(時間未到,Sean 指定今晚 22:00 後)。
- **R4 那三條 must-fix 的修法本身未經審查**(改動很窄:收緊兩處斷言、補一處斷言、
  換一句錯誤訊息、加四條負測與一道 DDL 突變,全部有測試覆蓋)。
- **未跑 `busboy-end`**(它會把別線那兩個 untracked 目錄掃進去)。

— END —
