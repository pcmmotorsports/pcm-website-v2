# 政策統一片 plan **v2**(L5a-2 硬前置)— 卡死出口 + 兩道防重扣閘的政策對齊

> P 窗 / 2026-08-10。**v2 = 依 codex 關卡1 FAIL(8 must-fix)全數改寫**;v1 的結論有兩處事實錯誤,
> 逐條記在 §9「v1 錯在哪」,不刪除、供追線。
> 真權威:母 plan `2026-08-09-l4-l5-settlement-compensation-plan.md` §3.1/§3.2 + Sean Q4=A(`P-294-Q`)。
> 片型=**高風險片**(鐵則 12 ①錢)。**⛔ 本 plan 等 codex R2 PASS + Sean Q3 回覆才動工。**

---

## 0. 範圍(主視窗已核准的「拆半」)

🔴 **Q4=A 的重付鈕,只在「我們確實觀察到、而且觀察結果支持讓路」時才給。**

「付款狀態確認中」底下有**四種** reason(`packages/use-cases/src/settle-charge.ts`),不是一種:

| reason | 意思 | 位置 | 讓路 CAS | 本片範圍 |
|---|---|---|---|---|
| `record_not_found` | 查詢**成功**、TapPay 明確回零筆 | `:129` | ✅ 收 | ✅ **做** |
| `auth_or_pending` | 查得到、恆 4 PENDING | `:405` | ✅ 收(`stuck_pending`) | ✅ **做** |
| `record_unreachable` | **TapPay 打不通 / 查詢 throw** | `:58,:80,:177,:431` | ❌ 拒 | ⛔ 另片,等 Sean Q3 |
| `record_unverified` | 查得到但驗不過 | `:131,:146,:168,:188` | ❌ 拒 | ⛔ 另片,等 Sean Q3 |
| `released_failure_observed` | **released** attempt 讀 Record 觀察到失敗 | `packages/domain/src/payment/types.ts:624,:683` | ❌ 拒 | ⛔ **永遠 fail-closed、不給鈕** |

🔴 **是五種不是四種**(codex R2-MF1;v1/v2 初稿都漏了第五種)。競態下原 pending attempt 可能先被
別的路徑轉成 released,server 重跑 `settleCharge` 就會拿到 `released_failure_observed` ——
它**已經是 released 了**,再讓路沒有意義且會覆寫既有標記(撞 L5a-1 閘⑥ write-once)。
⇒ 實作與驗收都要有這一格,不能只寫四分支。
⚠️ 另兩句逐字口徑:`auth_or_pending` → CAS 收的是轉碼後的 `stuck_pending`;
`settleCharge` 只證明**這一次**觀察到 4 PENDING,**不是**「恆 PENDING」——「恆」要靠 L5 的多次觀察+年齡閘。

CAS 值域是硬閘(`20260810010000_...sql:175` 逐字):
`IF p_reason IS NULL OR p_reason NOT IN ('record_not_found','stuck_pending') THEN RAISE P5A01`。
拒絕是**刻意的**(L5a-1 檔頭第四類):讓路會產生待補償的舊授權,「我沒看清楚」不足以支付這個代價。
**本片不鬆這條線。**

---

## 1. 現況實查(逐字,附 `檔案:行號`)

### 1a. 兩道閘
| 閘 | 位置 | 時限 | 撞到之後 |
|---|---|---|---|
| cart dedup | `20260809210000_...sql:120-160` | **無** | `needs_settle` / `duplicate` |
| per-user 閘 | 同檔 `:163-176` | `created_at > now()-'10 minutes'` | `user_in_flight` |

### 1b. 卡死的具體位置
`apps/storefront/src/app/checkout/charge-actions.ts:526-575` `adjudicateSettlement()`:
`duplicate` / `paid` / `failed` / `no_attempt` 四條都有出口;
**`pending` 一格零出口**——短 hold「狀態確認中」、不放行、不背景輪詢(Q3=A 拍過)、保留 cart key。
⚠️ v1 在此寫「TapPay 不通 ⇒ Record 查無 ⇒ 落 pending」,**錯**(見 §9-①)。

### 1c. 補償盯梢實際看得到什麼(**已縮窄,v1 寫太滿**)
`claim_stuck_unsettled_attempts` **現行本體**(R1c1 `20260624120008` `CREATE OR REPLACE` 過):
```
( (status IN ('pending','charged') AND needs_manual_review=false AND settle_attempt_count<8)
  OR status='released' )                    -- released 繞 manual/ceiling
AND o.payment_status='unpaid' AND (next_settle_at IS NULL OR <= now()) AND created_at < now()-p_age
```
⇒ 誠實版結論:
- `pending`(10 分鐘窗口放行後留下的那種)**自動對帳 8 次為止**,達 ceiling 後
  由 `expire_stuck_attempts_at_ceiling` 轉 `needs_manual_review` ⇒ **進人工佇列,不是永遠自動看**。
- `released`(讓路後那種)繞 ceiling、持續低頻對帳。
⇒ **不得**再宣稱「兩條路徑都一直有人自動看」。

🔴 **v1 差點犯的錯**:第一次讀 sweeper **原始片** `20260615120001`(WHERE 只有 `status IN ('pending','charged')`),
照那版讀 released 會被排除、結論完全相反。後面的片改寫掉了它。
(memory `reference_count-objects-from-catalog-not-create-statements`:判 DB 現況要讀**最後一支改它的**本體。)

---

## 2. 拆三片(codex MF7;主視窗傾向核准,片界待 Sean Q3 定案)

| 片 | 內容 | 為何可獨立收工 | 上線安全性 |
|---|---|---|---|
| **P-1 app 核心** | adapter 的讓路 CAS 方法 / domain 型別 / use-case 透傳 / **server 端「重新觀察→推導 reason→呼 CAS」的 action** | 不動 UI、不動 DB;action 存在但無入口 | 零行為改變 |
| **P-2 出口流程**(不只 UI) | 兩態的按鈕/文案 + **CAS false/throw 的 fail-closed UI** + 🔴 **成功後的狀態機**(解鎖/清車/cart key/prime/successor order,見 §3d) | 10 分鐘窗口**原封不動保留** | ⚠️ **不是「只增加出口」** —— 它真的把 attempt `pending→released`,改變付款生命週期;安全性要靠 CAS 四閘 + 身分解析正確 + fail-closed 三者論證,不能靠「只加不減」 |
| **P-3 DB 政策** | 拿掉 per-user 閘 10 分鐘窗口 + migration harness | P-2 驗過之後才做 | 見 §4「不可推薦 A」的前置盤點 |

每片 15-45 分鐘可中斷、可獨立 commit。
⚠️ **「P-3 未做完之前系統仍是現況行為」是錯的**(codex R2-MF3,v2 初稿自相矛盾):P-2 一上線,
按鈕就會真的讓路 ⇒ 行為已改變。正確說法是「**P-3 未做完之前,兩道閘的時限政策仍是現況**」。
⚠️ P-1 若被註冊成可呼的 server action,就是**新增可呼面**、不是「存在但無入口」
⇒ P-1 收工時要附 export/caller graph 證明它沒有對外入口(或明證它只是 private use-case)。

---

## 3. P-1/P-2 要做什麼

### 3a. 🔴 reason 一律 server 端重推,**絕不信任 client**(codex MF1)
按鈕按下 → server action **重跑一次新鮮 `settleCharge`** → 由 server 推導 reason →
落在 §0 的兩種才呼 CAS;其餘一律不讓路、回 fail-closed UI。
**client 不得傳入 reason,也不得傳入任何識別碼**(見 3b)。
理由:信 client 的 reason ⇒ 呼叫端偽造 `stuck_pending` 就能強制釋放一筆可能已扣款的 attempt。

### 3b. 🔴 目標 attempt 一律 server 端解析(我自己查到的,非 codex)
`charge-actions.ts:457-460` 與 `:488-491`:`user_in_flight` **刻意不帶 displayId**
(逐字「🔴 無 displayId(round3 C)」)。`initiate-payment.ts:80-83` 有 `inFlight.orderId`,但 action 丟掉了。
⇒ 修法**不是**把 id 傳給前端,而是 action 自己在 server 端解析。
🔴 **但「server 端解析」不等於「解析正確」**(codex R2-MF2):`begin_charge_attempt` 挑在途單有它自己的
排序 —— `ORDER BY (a.status='charged') DESC, a.created_at DESC, a.id DESC`(`20260809210000_...sql:172-174`)。
新 action 若用不同 predicate/排序,會**釋放另一張 pending 單**、留下不必要的補償標記,
而**真正擋住這次結帳的那張仍然沒被處理** ⇒ 客人照樣付不了、卻多了一筆待補償。
⇒ 硬約束:**目標解析必須與 `begin_charge_attempt` 共用同一套 predicate、排序與鎖**
(最好做成同一支 DB resolver 給兩邊呼,不要各寫一份)。CAS 的 `p_successor_order_id` 怎麼取也要一併寫死。
沿用本檔既有紀律(`:514-515` 逐字「existingOrderId / existing_* 全鏈 server 權威、client 零入口 → 無 IDOR」)。

### 3c. CAS 回 false / throw 的 UI(codex MF5:本片必須負責,不得延到 L5a-2)
- CAS 回 `{superseded:false}`(競態:別人先動了/狀態已變)→ 重新讀狀態後照新狀態顯示,**不重試、不釋鎖**。
- CAS throw(`P5A01` 契約錯誤 / 其他系統錯誤)→ fail-closed hold,**不放行**。
- 兩者都**不得**落進 `chargePaymentAction` 外層 generic catch(那條會回 formError → client 釋鎖 → 潛在雙扣;
  `charge-actions.ts:511-513` 逐字已警告)。

---

## 4. 🔴 P-3(拿掉 10 分鐘窗口)**目前不可推薦 A**,先做前置盤點(codex MF3)

codex 指出 A 案會新增**永久卡死**路徑,我核過至少這幾條要先有出口才能動:
1. **TapPay 持續觀察不到** → CAS 拒絕 ⇒ 沒有窗口自動放行就永遠卡(=Sean Q3 那題)。
2. **舊訂單已取消但 attempt 仍 pending** → `begin_charge_attempt` 仍擋,而 CAS 對已取消單**拒絕讓路**
   (L5a-1 鎖下前置 L4 兩張真相表)⇒ 無出口。
3. **`charge_failed_wait`** 現行契約明寫「10 分鐘後再試」(`charge-actions.ts` MSG)⇒ 拿掉窗口那個出口失效。
4. `isInFlightSettledFailed()` 只對 `failed` 放行,其餘 reason 壓成同一個 false ⇒ 不足以安全顯示按鈕。

⇒ **P-3 開工前必須先產出「所有依賴 10 分鐘窗口的 outcome 清單」**,每條各自有出口才動窗口。
盤點結果若顯示成本過高,**維持現況(C 案:只加按鈕、不動窗口)也是可接受結論**。

---

## 5. 發布序(codex MF6;**安全順序與 v1 相反**)

```
L5a-M / L5a-1 apply  →  P-1(無入口)  →  P-2 上線【10 分鐘窗口仍在】 →  觀察驗證  →  P-3 移除窗口
```
- v1 寫「migration 先、app 後」在此**不安全**:先拿掉 DB 窗口、app 還沒上,那段部署空窗會讓客人
  **失去唯一出口**。反過來若 L5a-M/L5a-1 未 apply,新 action 沒有 CAS 可呼。
- 🔴 `feedback_app-layer-must-not-ship-before-migration-apply`(08-07 正式站壞 8 小時那條)在此仍適用:
  **P-1/P-2 上線前必須先確認兩支 migration 已 apply**。

---

## 6. 🔴 要 Sean 拍的(已送 `P-302-Q`,答案會改變片界與文案)

**Q3(已送)**:TapPay 整個連不上時客人該看到什麼?A 放寬 CAS / **B 不給鈕但給明確說明與客服管道(推薦)** / C 加時間條件。

**Q-B 按鈕旁的風險說明**(⚠️ v1 的 B1 是**假承諾**,已更正,見 §9-③):
- **B1'**「若前一筆其實已扣款,我們會盡快為您退回」(不寫「自動/隔日」——L5b 上線後才可升級)
- B2 只寫「系統仍在確認前一筆付款狀態」,不提退款
- B3 收在「?」小圖示裡

**Q-A 按鈕文案**:A1「我要重新付款」/ A2「重新付款」/ A3「換一張卡再試一次」
**Q-C 出現時機**:C1 立刻 / C2 先顯示 30 秒 / C3 立刻但次要樣式
**Q-D 開不開**(新增):等 L5b 上線才開 / 現在就開+明文人工值班窗口 / 只開給 `auth_or_pending`

---

## 7. 驗收矩陣(codex MF8;**每格附「拿掉守門會不會紅」**)

**DB(P-3)**
| 格 | 斷言 | 突變(要能單獨紅它) |
|---|---|---|
| 異 cart + attempt > 10 分鐘 | per-user 閘**單獨**擋住 | 刪整道 per-user 閘 ⇒ 必紅 |
| 同 cart | 由 cart dedup 擋 | 🔴 負測不得被 dedup 供出來(`feedback_negative-test-observation-supplied-by-another-mechanism`) |

**App(P-1/P-2)**
| 格 | 期望 |
|---|---|
| `record_not_found` → CAS → begin 成功 | 恰**一張**新 attempt |
| `auth_or_pending` → 同上 | 恰一張 |
| `record_unreachable` / `record_unverified` | **不讓路**、不出現按鈕 |
| attempt 已 `charged` | **不讓路**(錢可能已動) |
| 舊單已取消 | 不讓路 |
| client 偽造 reason(`stuck_pending`) | **無效**(server 重推) |
| client 偽造 order/attempt id | **無效**(server 解析,3b) |
| 兩裝置同時按 | 只有一個成功建新 attempt |
| CAS false / throw | fail-closed,不釋鎖 |
| app 新版 × migration 舊版(混版) | 安全降級、不崩 |

🔴 **文案與程式是同一條不變式**(`feedback_copy-and-code-are-one-invariant`):
按鈕文案承諾什麼、程式就得允許什麼,逐格對照(尤其 Q-B 那句退款說法)。

**審查**:關卡2 + code-reviewer + R3 換模型,**錢面不降級**(照 L5a-1 的標準)。

---

## 8. L5a-2 剩餘觸發點:**逐項列名**(codex R1-MF5 要求、R2-MF6 指出我上一版沒真的做)

🔴 上一版我在這裡寫了一句「必須逐項列名」就當折完了 —— **那是把要求複述一遍冒充執行**。
以下是實查 `settleCharge` **全部呼叫點**(`grep -rn "settleCharge(" --include=*.ts --include=*.tsx`,
排除測試與 `.next`)之後的完整盤點,並逐條判「需不需要讓路」:

| # | 呼叫點 | 情境 | 有沒有「新單在等」? | 需要讓路? | 歸屬 |
|---|---|---|---|---|---|
| 1 | `charge-actions.ts:538`(`adjudicateSettlement`) | 同 cart 原地重試撞 dedup | ✅ 有 | ✅ 是 | **本線 P-1/P-2** |
| 2 | `charge-actions.ts:391`(`isInFlightSettledFailed`) | 異 cart 撞 per-user 閘 | ✅ 有 | ✅ 是 | **本線 P-1/P-2** |
| 3 | `reconcile-actions.ts:101` | 客人在結帳頁手動按「重新確認」 | ⚠️ **看情境** | ⚠️ **待判** | 🔴 **未決,見下** |
| 4 | `callback/page.tsx:125` | 3DS 導回 | ❌ 無(就是這張單) | ❌ 否 | 不需 |
| 5 | `api/orders/[orderId]/payment-status/route.ts:139` | 會員輪詢訂單狀態 | ❌ 無 | ❌ 否 | 不需 |
| 6 | `api/checkout/tappay-notify/[secret]/route.ts:191` | TapPay webhook 快路徑 | ❌ 無 | ❌ 否 | 不需 |
| 7 | `sweep-settlements.ts:173`(inbox)/`:211`(stuck) | cron 對帳 | ❌ 無 | ❌ 否 | 不需 |
| 8 | `reconfirm-expired-orphans.ts:96` | B1b 過期孤兒重確認 | ❌ 無 | ❌ 否 | 不需 |

**判準**:讓路的用途是「**讓一張新單走得通**」。4-8 都是純對帳路徑(沒有客人正在等著建新單),
它們只需要 settle,不需要也不應該讓路 —— 對它們讓路等於憑空製造待補償的舊授權。

🔴 **第 3 項是唯一未決的**,我不自己判:`reconcile-actions.ts` 是客人主動按的「重新確認」,
它**可能**在客人想重新結帳的脈絡下被按,也可能只是想看看狀態。
要不要在那裡給讓路入口,取決於**對客體驗 spec**(§10)怎麼定義「重新確認」與「重新付款」的關係。
⇒ 列為 spec 的第六個政策點,**不在 P-1 範圍內**。

⇒ 結論:**L5a-2 的「其他觸發點」實際上只有第 3 項一個**,其餘已被 1/2 覆蓋或確認不需要。
母 plan §3.1 觸發 A/B 的覆蓋面因此比原本以為的窄。

## 8b. 這片不做
不碰 `confirm_order_payment` 鎖(B 線)/ 不做 L5b 本體 / 不改 Q3=A「不背景輪詢」/
不鬆 CAS 的 reason 值域 / 不做 `record_unreachable`·`record_unverified` 的出口(Sean Q3 未回)。

## 9. v1 錯在哪(不刪,供追線)
1. **「TapPay 不通 ⇒ Record 查無」是錯的**:打不通是 `record_unreachable`,查得到但零筆才是
   `record_not_found`。我把兩者混為一談,導致 v1 以為按鈕能覆蓋 Q4 原本的情境。**這條推翻了 v1 的範圍**。
2. **「兩條路徑都有人看 ⇒ 沒有補償洞」寫太滿**:pending 分支有 `settle_attempt_count<8`,
   第 8 次後退出 sweeper 轉人工佇列。結論方向仍對(不是洞),但射程要縮。
3. **「每一次讓路都有決策紀錄」撤回**:既有 `preflightReleaseSibling` 會在 CAS 前把 attempt 轉 released
   且**不寫** `superseded_*`(L5a-1 檔頭 C6 自承)。A 案的「紀錄完整性」理由不成立,已移除。
4. **B1 文案是假承諾**:自動補償退款是 L5b 的功能,L5b 未上線 ⇒ 該期間只能靠值班人工查
   (L5a-1 檔頭 C5 逐字)。已改 B1'。
5. **發布序寫反**:v1 的「migration 先、app 後」會在部署空窗移除唯一出口。已改 §5。
