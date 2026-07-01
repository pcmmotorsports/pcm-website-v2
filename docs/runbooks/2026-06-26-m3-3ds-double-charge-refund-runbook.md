# M-3 3DS 立即重刷雙扣 — 退款候選報表 + 人工退款 Runbook(W1)

> **這份文件做什麼**:當系統偵測到「立即重刷雙扣」(客人付款卡住→以為失敗→重刷→結果兩筆都成交),
> 這份提供 ①「還沒處理的雙扣」對帳查詢單 + ② 一步步安全退款的操作步驟。
>
> **誰執行(Phase 1 = 過渡)**:🔴 **owner / postgres 受控人工流程**(Supabase SQL Editor 以專案 owner 身分跑)。第一次操作**先讀 §0.5**。
> 兩張 anomaly 表上了最嚴的鎖(RLS zero-policy + REVOKE ALL,連 service_role 都擋)→ **只有 DB owner 進得去**;一般員工目前**無法**直接跑。
> **日後一定改為後台 admin 給員工操作**(Sean 2026-06-24 拍板,PRD §9.2 D-B / §9.3)= 緊接 Phase 1 的獨立 milestone(需正式 staff/admin 身分 + RBAC)。本批 = 固定 SQL + runbook,資料層前向相容、不擋未來 admin UI。
>
> **真權威(逐字依據,鐵則 1)**:
> - canonical `docs/specs/2026-06-23-m3-3ds-abandoned-complete-plan.md` §7(行 256-269)+ §2.6(行 108-109)+ §9 表 W1(行 310)+ §14 步 26。
> - PRD `docs/specs/2026-06-24-m3-3ds-anomaly-refund-PRD.md`(過 `prd_review`)§6(行 214-235)+ §4.3(行 187-189)+ §9.2(行 287-294)。
>
> **載體決策(Sean 2026-06-26)**:Q1=B(報表 SQL + runbook 合一單檔)/ Q2=A(MCP 模擬驗證、無 vitest)。

---

## ⚠️ 現在狀態(先讀)

> 🔴 **這份是「前瞻基建」、還不是「現在就在跑的流程」。**
> - 目前 `TAPPAY_3DS_ENABLED` = false 且 prod 結帳尚未開放 → 系統**不會產生任何雙扣紀錄**,§1 報表**現在跑恆回 0 列**。
> - **上線開 flag(§14 步44 之後)+ prod 結帳啟用,本流程才真正生效。** 在那之前**不需**據此巡查雙扣(也巡不到)。
>
> 🔴 **W1 只「清理」雙扣、不「防止」雙扣。** 防止雙扣(客人付款時的 3DS 等待畫面 / 取消 / 關窗 / 彈窗被擋的 fallback)是**還沒做的 A1–A3 前端**。
> 所以「客人端完整體驗」目前**並不完整**——別把「後端能退錢」當成「客人端已安全」。今天沒有真客人受影響,是因為 prod 結帳還沒對外開、真實流量 = 0,不是因為流程已經完備。

---

## 0. 一句話背景(雙扣怎麼來、為什麼這樣退)

1. 客人付款走 3DS,扣款成立但回應遺失 → 該筆「嘗試(attempt)」被「釋放(released)」、訂單仍 unpaid。
2. 客人以為失敗 → 重刷一筆**新單**,新單成交 paid。
3. 系統持續對帳,後來抓到舊那筆其實**也成交了**(late success)→ 同一刻寫一筆 **`open` 雙扣紀錄(anomaly)**。
4. 此時:**舊單 paid + 新單 paid = 雙扣明確化**。

**名詞小抄(白話)**:
- **舊單** = 客人第一次刷、卡住以為失敗的那筆(系統後來發現其實扣款成功了)。
- **新單** = 客人重刷、真正拿到東西的那筆。
- **anomaly_id** = 這筆「雙扣案件」的編號(只在 SQL 內用、不拿去 TapPay)。
- **refund_target_rec_trade_id** = 🔴 **要退的那筆**(= 舊單在 TapPay 的交易編號、拿去 TapPay 退款)。
- **狀態 open / refunding / refunded / dismissed** = 待處理 / 退款中 / 已退完 / 確認非雙扣。
- **sibling** = 同一客人附近時間的其他成功訂單(報表拿來當提示,不是定論)。

> ```
> ┌──────────────────────────────────────────────────────────┐
> │ 🔴 唯一鐵律:只退「舊單」那筆(refund_target_rec_trade_id)。 │
> │    絕對不要退客人重刷的「新單」——那是他真正要的東西。        │
> └──────────────────────────────────────────────────────────┘
> ```

🔴 **`open` 不等於「已確認雙扣」(退款前必判)**:系統在「舊那筆 late success」當下就寫 anomaly,代表**舊那筆確定有一筆扣款成立**;但「是否為雙扣」取決於**客人是否另有一筆真正重複的 paid 單**。報表的 12h sibling 只是**自動提示**:
> - **有真重複 paid 單**(客人重刷也成交)→ 雙扣明確化 → 退舊那筆(步 2→4)。
> - **查無真重複**(客人其實沒重刷成功 / 只有這筆 late success)→ 這筆是客人**真正要的單、不是雙扣** → 走 dismissed(步 7)、**不得退款**(退了會害客人沒拿到他要的東西)。
> 🔴 **因此 claim / 退款前,一律先到 TapPay 對帳(§1.5)確認「舊 + 新」兩筆是否都真扣款**,再決定 refund vs dismissed。

---

## 0.5 操作前準備(不會寫程式也能跟著做)

> 報表 + 退款 SQL 都在 **Supabase 後台**、以 **owner 身分**執行。第一次照下面做:

1. 開瀏覽器 → `https://supabase.com/dashboard` → 登入 → 選專案 **PCM**(專案 ID `bmpnplmnldofgaohnaok`)。
2. 左側選單點 **「SQL Editor」** → 右上 **「New query」** 開新查詢。
3. 把本文件要用的 SQL **整段複製**貼進去 → 按 **「Run」**(或 Cmd/Ctrl + Enter)。結果出現在下方表格,**每一格右上有複製鈕**。
4. 🔴 **身分自檢(第一次必做一次)**:先貼這條跑,確認你是 owner:
   ```sql
   SELECT current_user, session_user;
   ```
   - 看到 `postgres`(或專案 owner role)= **對**、可以繼續。
   - 看到 `anon` / `authenticated` / `service_role` = **連線身分錯了**,你會查到空白結果、會誤以為「沒有雙扣」→ **停手、找 Sean / 工程**,別繼續。
5. SQL Editor 預設就是 owner 連線;**別用 service_role / anon 的 API key 另外接**(那會被資料表的鎖擋成空結果)。

---

## 1. 退款候選報表(固定 SQL,owner 跑)

> 三段:**A 退款候選(只列 open)** / **B 處理中(refunding,不可再領)** / **C refunded·dismissed 不列入**。
> 三段皆**純查詢(SELECT)、零寫入**;**查詢報表本身不寫 event**(event 邊界見 §4)。
>
> 🔴 **連線身分**:必以 **postgres / 專案 owner** 連線(SQL Editor 預設即是)。用 service_role / anon 連會「查無資料」,**勿誤判為「沒有雙扣」**(見 §0.5 身分自檢)。

### 1A. 退款候選 — 只列 `open`(報表已幫你產生好可一鍵複製的退款指令)

撈出「系統已偵測、還沒人認領處理」的雙扣。**最右邊 5 欄是幫你組好的整條退款指令**:UUID 已嵌好,你只要在那一格按複製、貼到新查詢、把指令裡的『請填…』改成真內容再跑 → **完全不用自己手動搬 36 字的 UUID**(消滅貼錯 / 把兩串 UUID 貼混的風險)。

```sql
-- 退款候選(只列 open)。owner / postgres 身分執行。最右 5 欄 = 可一鍵複製的退款指令。
SELECT
  a.id                                         AS anomaly_id,                  -- ☆ 案件編號(只在 SQL 內用、別拿去 TapPay)
  oo.display_id                                AS old_order_display_id,        -- 舊單號(被雙扣那單)
  a.refund_target_rec_trade_id                 AS refund_target_rec_trade_id,  -- ★ 要退的那筆(拿這串去 TapPay 退款)
  a.amount                                     AS amount,                      -- 金額(整數、取自 orders.total 快照)
  a.released_at                                AS released_at,
  a.charged_at                                 AS charged_at,
  date_trunc('second', now() - a.charged_at)   AS open_age,                    -- 已 open 多久(越久越優先;未定硬性 SLA)
  sib.sibling_count                            AS sibling_paid_orders_12h,     -- 輔助:12h 內同 user 其他 paid 單數
  sib.sibling_display_ids                      AS sibling_paid_display_ids,    -- 輔助:那些新單號(很可能是客人重刷的)
  sib.amount_match_hint                        AS amount_match_hint,           -- 輔助:有任一同金額 → 更像雙扣
  -- ↓↓ 一鍵指令(複製整格 → 貼新查詢 → resolve 類把『請填…』改成真內容 → Run)↓↓
  format('SELECT public.claim_double_charge_anomaly_for_refund(%L::uuid);', a.id)
                                               AS "步2_認領_SQL",
  format('SELECT public.resolve_double_charge_anomaly(%L::uuid, %L, %L, %L);',
         a.id, 'refunded', '請填退款情況說明', '請填TapPay退款交易號')
                                               AS "步4_確定已退_SQL",
  format('SELECT public.resolve_double_charge_anomaly(%L::uuid, %L, %L, NULL);',
         a.id, 'reopen', '請填為何判定未退款')
                                               AS "步5_確定未退_SQL",
  format('SELECT public.resolve_double_charge_anomaly(%L::uuid, %L, %L, NULL);',
         a.id, 'uncertain', '請填不確定情況')
                                               AS "步6_不確定_SQL",
  format('SELECT public.resolve_double_charge_anomaly(%L::uuid, %L, %L, NULL);',
         a.id, 'dismissed', '請填為何非雙扣')
                                               AS "步7_非雙扣_SQL"
FROM public.payment_double_charge_anomalies a
JOIN public.orders oo
  ON oo.id = a.old_order_id
LEFT JOIN LATERAL (
  SELECT
    count(*)                                      AS sibling_count,
    array_agg(o2.display_id ORDER BY o2.paid_at)  AS sibling_display_ids,
    bool_or(o2.total = a.amount)                  AS amount_match_hint
  FROM public.orders o2
  WHERE o2.customer_user_id = a.user_id
    AND o2.id              <> a.old_order_id        -- 排除舊單本身
    AND o2.payment_status   = 'paid'                -- 只看 paid 單
    AND o2.paid_at IS NOT NULL
    AND o2.paid_at >= a.released_at                 -- released_at 後…
    AND o2.paid_at <  a.released_at + interval '12 hours'  -- …12h 內
) sib ON true
WHERE a.status = 'open'
ORDER BY a.charged_at;
```

**欄位說明 / 操作意涵**

| 欄 | 意義 | 操作怎麼用 |
|---|---|---|
| `anomaly_id` | ☆ 這筆雙扣案件的編號 | **只在 SQL 內用**,已嵌進右側一鍵指令、你不必手動複製 |
| `old_order_display_id` | 被雙扣的舊單號 PCM-YYYY-NNNN | 對帳 / 跟客人溝通 |
| `refund_target_rec_trade_id` | ★ **要退的交易編號** | **拿這串去 TapPay** 退款(別退新單) |
| `amount` | 金額(整數) | 對 TapPay 退款金額 |
| `released_at` / `charged_at` | 釋放時間 / late success 收斂時間 | 判斷時序 |
| `open_age` | 已 open 多久 | 越久越該優先處理 |
| `sibling_paid_orders_12h` / `sibling_paid_display_ids` | 12h 內同 user 其他 paid 單(數量 / 單號) | **輔助**:通常是客人重刷的新單;為 0 / null 仍須人工判斷,不代表非雙扣 |
| `amount_match_hint` | 12h 內有任一同金額單 | **輔助**:true 更像雙扣;**非過濾條件**,false 不代表排除 |
| `步2/4/5/6/7_*_SQL` | 幫你組好的整條退款指令 | **複製整格 → 貼新查詢**;resolve 類把『請填…』改成真內容再跑 |

> 🔴 **`sibling_*` = 0 / null 的成因(別只看報表決定退不退、必到 TapPay 對帳 §1.5)**:① 客人重刷成功但**超過 12h** 才成交(窗外)② 重刷走 **ATM / 非即時付款**(`paid_at` 落窗外)③ 重刷用**另一帳號 / 另一張卡**(`user_id` 不同,報表抓不到跨帳號/跨卡)④ **客人根本沒重刷成功**(只有舊那筆 late success = **非雙扣、應 dismissed**)⑤(罕見)owner 曾手動補單漏設 `paid_at`。**sibling=0 同時可能是「窗外的真雙扣」或「根本非雙扣」→ 一律到 TapPay 對帳(§1.5)確認舊 + 新是否都真扣款,再決定 refund(步 4)vs dismissed(步 7)。**

> **SLA / 責任人**:Phase 1 由 owner(Sean)受控執行,**責任人 = owner**;**PRD 未定硬性 SLA 數字** → 本報表只給 `open_age` 供人工排序,**不杜撰 SLA 閾值**。本報表為**對帳查詢面、非主動告警面**;雙扣**主動告警** = backlog **#250**(獨立、本批不做)——意即「有沒有人記得跑這份報表」目前靠人工,#250 做了才會主動提醒。

### 1B. 處理中 — 列 `refunding`(已被認領、不可再領)

已有人 claim、正在退款流程中的。**列出來只為知情,不可再次 claim**(claim 對非 open 會回 `{claimed:false}`)。

```sql
-- 處理中(refunding,不可再領)。owner / postgres 身分執行。
SELECT
  a.id                                              AS anomaly_id,
  oo.display_id                                     AS old_order_display_id,
  a.refund_target_rec_trade_id                      AS refund_target_rec_trade_id,
  a.amount                                          AS amount,
  a.refund_claimed_at                               AS refund_claimed_at,
  a.refund_claimed_by                               AS refund_claimed_by,   -- DB session role(非真人 staff 身分)
  date_trunc('second', now() - a.refund_claimed_at) AS claim_age            -- 已認領多久(卡太久→見 §2 步6 不確定處置)
FROM public.payment_double_charge_anomalies a
JOIN public.orders oo
  ON oo.id = a.old_order_id
WHERE a.status = 'refunding'
ORDER BY a.refund_claimed_at;
```

> ⚠️ **`refund_claimed_by` Phase 1 無法區分操作者**:owner-only 流程下大家都是同一 `session_user`(owner/postgres)→ 此欄**不能追責到個人**,責任歸屬靠人工排班。
> **協作不撞車(過渡)**:Phase 1 實務上**只有 Sean 一人操作**,看到 `refunding` 就是你自己上一輪領的,照 §1D 稽核軌的時間判斷;若未來多人,先口頭/群組講好「誰處理哪筆」再 claim——系統只擋「同時退兩次」、**不會幫你們分工**。`claim_age` 卡太久 → 多半是退款不確定卡在 refunding(見 §2 步 6)。

### 1C. `refunded` / `dismissed` — **不列入候選報表**

- `refunded` = 已退款完成(終態、不可逆)→ **不列入**。
- `dismissed` = 已確認**不是**雙扣(終態、不可逆)→ **不列入**。
- 兩者只在稽核軌(§1D)查得到,**不會回到候選 / 處理中報表**。

### 1D.(可選)稽核軌 — 單筆 anomaly 的完整 event 時序

退款不確定查證(§2 步6)、或事後稽核時用。**純查詢、不寫 event**。

```sql
-- 單筆 anomaly 的稽核軌(append-only event 表)。把下面那串換成實際 anomaly_id。
SELECT
  e.created_at,
  e.event_type,           -- claim / refund_confirmed / refund_not_executed / refund_uncertain / reopened / dismissed
  e.from_status, e.to_status,
  e.actor_session_role,   -- DB session role(非真人 staff)
  e.note,
  e.provider_reference
FROM public.payment_double_charge_anomaly_events e
WHERE e.anomaly_id = '00000000-0000-0000-0000-000000000000'  -- ← 換成實際 anomaly_id
ORDER BY e.created_at;
```

---

### 1E. Report C — pending-based 雙扣候選(#256 GAP2 治本、**卡住指紋**、owner 跑)

> 🔴 **這是與 1A 不同的偵測**:1A 抓 `released→charged` 那種雙扣(anomaly 主表);本表抓 **GAP2 純 pending 雙扣**——同客戶同金額、短窗兩筆 paid、且其一付款「卡住」(結帳到扣款拖久 = 客人放棄才重付、原 3DS 卻 late-success)。#250 每日告警若報「疑似重複扣款 N 組」,來這裡查是哪幾筆。
>
> 🔴 **這是候選、待查證,不是已確認雙扣**;卡住指紋降誤報(正常「乾脆買兩個」兩筆秒扣不會列),但仍可能有極少數正常客人付款也拖久 → **必到 TapPay Dashboard 逐筆查證**。
>
> 🔴 **退款目標必人工查證(GAP2 無 released 錨點、不可自動退較晚那筆)**:兩筆都是真實成交,要退的是「重複的那筆」(通常 = 卡住那筆的意外成交,或客人重付那筆)。**逐對到 TapPay Dashboard 對帳,確認哪一筆是客人本來就不想要的重複,退它的 rec_trade_id;絕不退客人真正想保留的那筆。**

```sql
-- Report C:pending-based 雙扣候選(owner / postgres 身分)。窗 12h、卡住門檻 10min(對齊 route 常數,可調)。
-- 列出實際訂單對 + 各自 attempt 卡住時長 + rec_trade_id,供人工到 Dashboard 查證退款目標。
SELECT
  o1.customer_user_id,
  o1.display_id            AS order_1,
  o2.display_id            AS order_2,
  o1.total                 AS amount,
  round(abs(extract(epoch FROM (o1.paid_at - o2.paid_at))))  AS paid_at_gap_sec,
  a1.rec_trade_id          AS order_1_rec,
  a2.rec_trade_id          AS order_2_rec,
  round(extract(epoch FROM (a1.updated_at - a1.created_at)))  AS order_1_charge_delay_sec,
  round(extract(epoch FROM (a2.updated_at - a2.created_at)))  AS order_2_charge_delay_sec
FROM public.orders o1
JOIN public.orders o2
  ON o1.customer_user_id = o2.customer_user_id
 AND o1.total            = o2.total
 AND o1.id              <  o2.id
 AND o1.payment_status = 'paid' AND o2.payment_status = 'paid'
 AND o1.paid_at IS NOT NULL AND o2.paid_at IS NOT NULL
 AND abs(extract(epoch FROM (o1.paid_at - o2.paid_at))) < 43200          -- 12h 窗(可調)
LEFT JOIN public.payment_charge_attempts a1 ON a1.order_id = o1.id AND a1.status = 'charged'
LEFT JOIN public.payment_charge_attempts a2 ON a2.order_id = o2.id AND a2.status = 'charged'
WHERE EXISTS (   -- 卡住指紋:其一 charged attempt 拖 > 10min(600s、可調)
  SELECT 1 FROM public.payment_charge_attempts a
   WHERE a.order_id IN (o1.id, o2.id) AND a.status = 'charged'
     AND extract(epoch FROM (a.updated_at - a.created_at)) > 600
)
ORDER BY o1.paid_at DESC;
```

- **判讀**:`*_charge_delay_sec` 大的那筆 = 卡住的(客人放棄的原單 late-success);查 Dashboard 兩筆 rec 對帳,確認客人真意 → 退重複那筆 rec。查證流程沿用 §1.5 + §2(7 步退款、只是退款目標由本表 rec 決定、非 anomaly 主表)。
- **同單多 charged attempt(罕見)**:實務每單至多一筆 charged(begin `ON CONFLICT` 佔鎖 + 成交轉 paid 後不再開新 attempt),故通常一對一列;若某單真有多筆 charged 致同對展開多列,以 **`*_charge_delay_sec` 最大者** 為卡住判準、rec 逐筆到 Dashboard 對(本表為人工偵察查詢、非自動退款,誤差在人工查證環節吸收)。
- **誠實限制**:本表為 SELECT-only 偵測,**不寫 anomaly 主表 / 無 claim/resolve 生命週期**(#256 Q2=A 輕量;若日後要 W1 式追蹤 → 另開持久候選表)。退完在對帳本自行記錄,避免重複處理。

---

## 1.5 怎麼去 TapPay 對帳(決定「該不該退」)

> 報表的 sibling 只是提示。**退款前(尤其 sibling=0 時)一定要到 TapPay 後台親自確認**:舊那筆到底扣款成立沒、是不是真的有第二筆重複扣款。這一步**靠人不靠報表**。

1. 登入 TapPay 商戶後台 → 交易查詢。
2. **查舊單**:用報表的 `refund_target_rec_trade_id` 搜 → 看它的交易狀態。
3. **查有沒有重複的第二筆**:用客人 email / 訂單金額 `amount` / 卡號末四碼 / 時間範圍搜同一客人 → 看有沒有第二筆「成功扣款」的交易(這就是新單,通常就是報表 sibling 列出的)。
4. 對照下表決定:

| 舊單(refund_target)狀態 | 有沒有第二筆重複成功扣款 | 結論 → 動作 |
|---|---|---|
| **扣款成立** | **有**(客人重複付了兩次) | **真雙扣** → 步 2 認領 → 步 3 退舊單 → 步 4 |
| **扣款成立** | **沒有**(只有這一筆) | **不是雙扣**(這是客人要的單)→ 步 7 dismissed、**不退** |
| **已退款 / 未成立** | — | 別重退 → 先看 §1D 稽核軌 → 多半已處理或該 dismissed |

> 看不懂 TapPay 畫面、或不確定算不算「成立」→ **別猜**,先走步 6 uncertain 凍結這筆、找 Sean / 工程一起看。

---

## 2. 7 步人工退款 Runbook(過渡;逐字依 canonical §7 行 261-269 / PRD §6.2)

> 每步的「狀態操作 / 退款結果」一律經受控 RPC(claim / resolve),RPC **同交易**寫對應 event。
> 下方指令以 **owner / postgres 身分**在 SQL Editor 執行;**建議直接用 §1A 報表幫你產生好的「步X_*_SQL」整格指令**,不必手動拼。

> **一頁流程圖(先看這張)**:
> ```
> 跑 §1A 報表
>    │
>    ▼
> 到 TapPay 對帳(§1.5)──→ 不是雙扣 ──→ 步7 dismissed(不退)
>    │ 是真雙扣
>    ▼
> 步2 claim ──→ 回 {claimed:false}? ──→ 別退,查 §1B/§1D(見步2 下表)
>    │ 回 {claimed:true}
>    ▼
> 步3 到 TapPay 退「舊單」refund_target
>    │
>    ▼
> 退款結果?
>    ├─ 明確成功 ──→ 步4 refunded ✅(結案)
>    ├─ 明確沒退 ──→ 步5 reopen(回 open 重來)
>    └─ 不確定   ──→ 步6 uncertain(凍結、當天找人查)
> ```

1. **查 `open` anomaly**(跑 §1A 報表)。先到 §1.5 TapPay 對帳確認**這是真雙扣**,並確認 `refund_target_rec_trade_id` = 要退的舊那筆。

2. **認領(claim):`open → refunding`**(複製 §1A 的「步2_認領_SQL」整格貼上跑):
   ```sql
   SELECT public.claim_double_charge_anomaly_for_refund('<anomaly_id>'::uuid);
   -- 回 {"claimed": true}  = 認領成功(已轉 refunding、寫 refund_claimed_by=session_user + claim event)
   -- 回 {"claimed": false} = 沒領到(非 open / 已被領 / 不存在)
   ```
   🔴 **必須 `claimed:true` 才往下做。** 看到 `false`(沒領到)照下表處理:

   | 用 anomaly_id 查… | 代表 | 你該做 |
   |---|---|---|
   | 出現在 §1B(refunding) | 已被(你上一輪 / 別人)領走、正在退 | 不用管這筆 |
   | §1D 最後一筆是 refunded / dismissed | 已處理完 | 結案、不用管 |
   | §1A / §1B / §1D 都查不到 | 狀態異常 | 別硬退、找 Sean / 工程 |

3. **成功 claim 後**,才去 **TapPay Dashboard** 對 `refund_target_rec_trade_id` 退款(退**舊那筆、不退新單**)。

4. **Dashboard 明確顯示退款成功** → `refunding → refunded`(複製 §1A 的「步4_確定已退_SQL」、把兩個『請填…』改成真內容):
   ```sql
   SELECT public.resolve_double_charge_anomaly(
     '<anomaly_id>'::uuid, 'refunded',
     '退款情況說明(必填非空)',
     'TapPay 退款交易號 / 退款證據(必填非空)');
   -- 回 {"resolved": true, "status": "refunded"};寫 refund_confirmed event
   ```

5. **Dashboard 明確確認「未退款 / 未執行」** → `refunding → open`(reopen,回乾淨 open 重新可領):
   ```sql
   SELECT public.resolve_double_charge_anomaly(
     '<anomaly_id>'::uuid, 'reopen',
     '為何判定未退款(必填非空)', NULL);
   -- 回 {"resolved": true, "status": "open"};清主表稽核欄回乾淨 open 重新可領
   --   (RPC 實際顯式清六欄:refund_claimed_at/by + refund_provider_reference + resolved_at/by + resolution_note;
   --    後三者在 refunding 態經一致性 CHECK 本即 NULL,清後結果等價、機械自足);
   -- reopen 不抹稽核歷史:event 表寫 refund_not_executed + reopened 兩筆、前次 claim event 留存
   ```

6. 🔴 **退款結果不確定 / Dashboard 回應遺失** → **維持 `refunding`**(fail-closed):
   ```sql
   SELECT public.resolve_double_charge_anomaly(
     '<anomaly_id>'::uuid, 'uncertain',
     '不確定的情況(必填非空)', NULL);
   -- 回 {"resolved": false, "status": "refunding"};只寫 refund_uncertain event、主表零變動
   ```
   **什麼時候算「不確定」(下列任一即是)**:TapPay 頁面一直轉圈超過 ~3 分鐘沒結果 / 你按了退款但**沒看到明確「退款成功」字樣** / 中途網路斷掉 / 你就是不確定到底退成功沒。
   選 uncertain 後這筆會**凍結保護**(不得再 claim、不得重退)。→ **當天聯絡 Sean / 工程**,一起到 TapPay 對帳查清楚:
   - **查明確定「未退款」** → 回步 5 reopen。
   - **查明確定「已退款」** → 回步 4 refunded(補退款證據)。

7. **`dismissed`** 僅用於確認**這不是雙扣**(直接對 `open` 處置,不需 claim / 退款。複製 §1A 的「步7_非雙扣_SQL」):
   ```sql
   SELECT public.resolve_double_charge_anomaly(
     '<anomaly_id>'::uuid, 'dismissed',
     '為何判定非雙扣(必填非空)', NULL);  -- ⚠️ dismissed 不得帶退款證據
   -- 回 {"resolved": true, "status": "dismissed"};寫 dismissed event(由 open 直接終態)
   ```

> **自動退款(TapPay Refund API)= 上線前 backlog**(canonical §7 行 269);Phase 1 一律人工 Dashboard 退。
> **部分退款 / 退一半 / 金額不符**:Phase 1 假設雙扣 = 兩筆完全同額、退舊全額,**不支援部分退款**(PRD §1.2);若實務遇到金額不一致,別自己硬湊,找 Sean / 工程。

### RPC 速查(實際合約)

| RPC | 允許轉移 | 必填 | 回傳 |
|---|---|---|---|
| `claim_double_charge_anomaly_for_refund(uuid)` | `open → refunding`(CAS) | — | `{claimed: bool}`(false=未領到,不報錯) |
| `resolve_…(uuid,'refunded',note,provider)` | `refunding → refunded` | note + provider 皆非空 | `{resolved:true, status:'refunded'}` |
| `resolve_…(uuid,'reopen',note,NULL)` | `refunding → open` | note | `{resolved:true, status:'open'}` |
| `resolve_…(uuid,'uncertain',note,NULL)` | 維持 `refunding` | note | `{resolved:false, status:'refunding'}` |
| `resolve_…(uuid,'dismissed',note,NULL)` | `open → dismissed` | note(**禁** provider) | `{resolved:true, status:'dismissed'}` |

### SQL Editor 跳「紅字錯誤」怎麼辦

> 😌 **先別慌**:跳紅字 = 系統幫你**擋下不安全的動作、資料沒有被改壞**(fail-closed,不會誤改、不會亂退錢)。照下表看意思 + 下一步。

| 紅字大概長這樣(開頭) | 白話意思 | 你該做 |
|---|---|---|
| `...僅允許 refunding` / `...僅允許 open` | 這筆狀態已經變了、不是你以為的那個 | 回 §1 重查現在狀態,照新狀態走 |
| `...anomaly ... 不存在` | anomaly_id 貼錯 / 貼少字 | 重新從 §1A 複製整格指令 |
| `...resolution_note 必填非空` | 你忘了把『請填…』改成真說明 | 把指令裡的『請填…』改成實際說明再跑 |
| `...不得帶 refund_provider_reference` | dismissed / reopen / uncertain 不能帶退款證據 | 用 §1A 產生的對應指令(provider 已是 NULL) |
| `permission denied` / 查無資料 | 連線身分不是 owner | 回 §0.5 身分自檢 |

> 🔴 **重點**:resolve 對「現態不符」是**直接 RAISE(跳紅字)、不是回 `{resolved:false}`**(唯一回 `resolved:false` 的是 uncertain 維持 refunding)。所以看到紅字 = 停手、回 §1 重查,別重複亂跑。

---

## 3. 🔴 誠實限制(canonical §7 行 260 / PRD §4.3,**不得過度承諾**)

- `old_attempt_id` UNIQUE **只防重複建立 anomaly row**;**不防** Dashboard 重複退款。
- claim CAS **只能序列化「系統內」退款工作**(同一筆同一時間只一人領到),
  **無法物理阻止 Sean / 操作者在 TapPay Dashboard 手動點兩次退款**。
- 真正的防呆 = **claim CAS + 本 runbook(先 claim 才退)+ TapPay 狀態查證(§1.5)+ 不確定時 fail-closed 保持 `refunding` + append-only 稽核**。
- 🔴 **本報表 / runbook / commit 不得宣稱「CAS 完全防止 Dashboard 重複退款」。** 操作者仍須照步驟、退之前先在 Dashboard 查清楚該筆是否已退。
- **報表的自動關聯能力有天花板**:跨帳號 / 跨卡 / 超過 12h / ATM 的真雙扣,報表 sibling 抓不到(會 sibling=0),只能靠 §1.5 人工對帳。報表「沒提示」**不代表「沒雙扣」**。

---

## 4. event 寫入邊界(canonical §9 W1 驗收 / PRD 行 233)

- **每個狀態操作 / 退款結果** → 透過受控 RPC(claim / resolve)**同交易**寫對應 event(含 reopen 的兩筆)。
- **查詢 `open` 報表(§1)/ 人工前往 TapPay Dashboard 本身 → 不寫 event**(那是唯讀查詢 / 外部動作)。
- 稽核欄 `actor_session_role` / `refund_claimed_by` / `resolved_by` 一律寫 **`session_user`**(DB session role,**非真人 staff 身分**;真人 staff 身分屬日後 admin milestone)。

---

## 5. 驗證紀錄(W1,2026-06-26;Q2=A MCP 模擬、零留痕)

報表 SQL 經 Supabase MCP(project `bmpnplmnldofgaohnaok`、PG17)模擬驗證,**全為 SELECT / BEGIN…RAISE rollback、跑後 anomaly 兩表 residue=0**:

- **真表執行**(§1A/§1B 對線上空表跑)→ 各 0 列、無錯;證欄名 / 型別 / JOIN / `payment_status` enum / `format()` 一鍵指令欄對真 schema 有效。
- **VALUES 邏輯模擬(Report A)**:open 帶 12h 內同金額 sibling → `sibling_count=1` / `amount_match_hint=true`(自身舊單、+13h 窗外、unpaid、他 user 四種干擾全正確排除);open 無 sibling → `0/null/null`;`refunding`/`refunded`/`dismissed` **全不列入**。
- **VALUES 邏輯模擬(Report B)**:只列 `refunding`,`open`/`refunded` 不列。
- **真表 synthetic + RAISE rollback(黃金標準)**:塞 4 筆 anomaly(open/refunding/refunded/dismissed,引用 prod 既有 attempt/order FK)+ 暫標 PCM-2026-0002 為 12h paid sibling → 跑真報表 → 斷言(Report A 只 1 筆 open + sibling 抓到 PCM-2026-0002 + amount_match=true;Report B 只 1 筆 refunding;非 open 零洩漏)→ `RAISE 'W1_SIM4_OK'` 強制 rollback → 跑後 anomaly=0 / events=0 / PCM-2026-0002 回 `unpaid`/`paid_at=null`。

**三視角複驗(2026-06-26,operator 好用性 + 真實客人情境 + 端到端正確性)**:端到端正確性 8 項 check 7 項成立(genesis 只 released→charged 觸發、refund_target 綁死舊 rec 且程式碼層 immutable、12h sibling paid_at 可靠〔confirm RPC 唯一翻 paid 路徑恆設 paid_at〕、RPC 合約逐字符、prod 物件已落地 residue=0);唯一「不成立」= flag off 下整條鏈休眠不觸發 → 本文件為**前瞻基建**(已於頂部「現在狀態」明標)。客人情境主場景處理完整,落差 = W1 只清理不防止(A1-A3 未做)+ sibling 對跨帳號/跨卡/窗外雙扣無鑑別力(已於 §0.5/§1A/§1.5/§3 補手把手指引 + 誠實揭露)。好用性原評不及格 → 本版已補 §0.5 操作前準備 + §1A 一鍵指令 + §1.5 對帳決策表 + §2 流程圖 + claim false/uncertain/紅字三套處置 + 名詞小抄。

> 退款目標規則(退舊 rec 不退新單)由 genesis(R1b1c)寫死 `refund_target_rec_trade_id` + I2 immutable 保證;本報表逐筆輸出該欄供操作者核對。

---

## 6. 相關 backlog / 銜接

- **A1–A3(前端付款等待 / popup / fallback)= 雙扣的「源頭防線」、尚未實作**:今天 prod 是整頁跳轉 TapPay、彈窗被擋會卡住(#239),無等待畫面 / 無「回購物車」鈕 → 這是最容易誘發客人重刷的環境。**W1 只負責事後清理,源頭要靠 A1-A3。**(目前 prod flag off + 結帳未開,雙扣窗尚未對客人開。)
- **#250** 雙扣 anomaly **主動告警**:本報表 = 對帳查詢面、**非告警面**;沒做之前「有沒有人記得跑報表」靠人工。
- **後台 admin 退款介面**(查詢 / claim / resolve / reopen 給員工操作)= 緊接 Phase 1 的**獨立 milestone**(PRD §9.2 D-B / §9.3);沿用同一批 claim/resolve RPC,本報表資料層**前向相容、不擋未來 admin UI**。記真人 staff actor 身分可能需獨立 migration(actor_staff_id / wrapper RPC),屬該 milestone、本批不預做。
- **自動退款(TapPay Refund API)** = 上線前 backlog(canonical §7 行 269);Phase 1 一律人工 Dashboard 退。
