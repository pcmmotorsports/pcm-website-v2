# 2026-06-21 M-3 3DS settleCharge `queryStatus=2` 誤判修復 plan(v2、codex K1 r1 fold)

> **性質**：審查 session（寫審分離 ROLE=A）起草的 bugfix slice plan。鐵則 8（改對帳脊椎核心邏輯）+ 鐵則 12（payment 結算）。
> **來源** = 2026-06-21 sandbox 3DS 真實刷卡（PCM-2026-0018 / rec `D202606210tqU8C`）暴露：授權成功訂單永遠卡 pending。
> **v2 = codex K1 round1 FAIL→fold**（§3/§4 掃描漏檔補齊、§5 補 adapter raw + record_status×queryStatus=2 table、禁止清單矛盾修正、§6 加 observability）。待 codex K1 r2 + Sean 批准才動 code。

---

## 0. 一句話

settleCharge 把 TapPay 查詢 API 的**成功態** `status=2`（已無更多分頁）誤判為「查詢失敗」→ 永遠讀不到那筆已授權交易 → **所有 3DS 授權成功單都卡 pending、S1「授權即成立」實際從未生效**。修 [settle-charge.ts:85](../../packages/use-cases/src/settle-charge.ts#L85) 的 queryStatus 閘，放行 `{0, 2}`。

---

## 1. 根因（三方實證坐實）

1. **真實刷卡**：PCM-2026-0018，NT$ 94,200，3DS OTP 通過。
2. **TapPay 後台**（Sean 2026-06-21 親查 rec `D202606210tqU8C`）：狀態 = **已授權**、Auth Code `849647`、Bank 3D、金額 94,200 → 即 `record_status=0`（AUTH）。
3. **本機 log**：`recordQuery { status: 2, numberOfTransactions: 1 }` → 查詢回 top `status=2` + **有 1 筆**交易。
4. **卡點**：[settle-charge.ts:85](../../packages/use-cases/src/settle-charge.ts#L85)
   ```js
   if (record.queryStatus !== 0 || record.numberOfTransactions !== 1 || record.records.length !== 1) {
     return { kind: 'pending', reason: 'record_unverified' };   // ← status=2 在此被誤殺
   }
   ```
   `queryStatus !== 0` → status=2 直接判 pending、**到不了** classifyRecordStatus（S1 的 case 0→paid 永不執行）。
5. **錯誤被測試固化**：[settle-charge.test.ts:151-153](../../packages/use-cases/src/settle-charge.test.ts#L151-L153) 斷言「queryStatus=2 → record_unverified」= 把 bug 行為當正確、三綠恆綠、無人察覺。

---

## 2. 官方依據（逐字、非憑記憶；memory `feedback_webfetch-money-enum-hallucination-read-dom`）

- **top `status=2`**（TapPay 官方中文 reference 逐字）：「交易代碼 2 的話代表在當前過濾條件內，**已無更多紀錄**」。
  → 語意 = 「查到的就這些、沒有下一頁」= **查詢成功**；有無紀錄由 `number_of_transactions` / `trade_records.length` 判斷，**非** status=2 就等於無紀錄。單筆 rec 查詢命中即 status=2 + count=1。
- **top `status`** 官方定義 = 「response code，參考 error table」；error table 未內聯 → 採 **fail-closed 白名單**：只放行已逐字確認的成功碼 `{0, 2}`，其餘一律照擋（即使存在未知成功碼也只保守多擋、**絕不誤放行錯誤碼**）。
- **`record_status` enum**（TapPay 官方英文 reference 逐字，與 repo 一致）：`-1=ERROR / 0=AUTH / 1=OK / 2=PARTIALREFUNDED / 3=REFUNDED / 4=PENDING / 5=CANCEL`。**本修不動 record_status 映射**（S1 已對）。

---

## 3. 改動清單（scope 明列；codex K1 r1 補齊）

### 3a. 程式邏輯（核心）
| 檔 | 改動 | 不動 |
|---|---|---|
| [settle-charge.ts:85](../../packages/use-cases/src/settle-charge.ts#L85) | queryStatus 閘 `!== 0` → 抽 named helper `isQuerySucceeded(s)` 放行 `{0,2}`。**保留** `numberOfTransactions===1` + `records.length===1`（縱深不動） | classifyRecordStatus（record_status 映射）/ recordMatchesOrder（識別+金額+弱識別窗）/ settlePaid / markFailed |

### 3b. active 字面 / docstring（語意必正、SSoT）
| 檔:行 | 現況舊字面 | 改成 |
|---|---|---|
| [domain/payment/types.ts:182-184](../../packages/domain/src/payment/types.ts#L182-L184) | 🔴 SSoT「`queryStatus===0` ... 才判 paid」/「2=無更多」 | `queryStatus ∈ {0,2}` 皆查詢成功；有無紀錄由 count/records 判；判 paid 走 1b 全閘 |
| [PollOrderStatus.tsx:5-6](apps/storefront/src/components/PollOrderStatus.tsx#L5-L6) | 「callback 當下 queryStatus=2 **查無**」 | 改述：status=2 是查詢成功；落 pending 之真因見本 fix（L85 誤殺已修）；輪詢保留作 webhook/sweeper/實際延遲後備、同步延遲歸因待 §8 實證 |
| [wire.ts:69/93/104](../../packages/adapters/src/tappay/wire.ts#L69) | L69/93「0=查詢成功有紀錄 / 2=無更多」+ L104「status=2 無紀錄之合法態」（三處）| status=2 = 查詢成功（無更多分頁）；`trade_records` 缺才空陣列、與 status 值正交 |

### 3c. 凍結歷史快照（加 supersede 註記、不改寫歷史語意）
| 檔:行 | 處理 |
|---|---|
| [設計包 2026-06-20 §5.1/§6](../specs/2026-06-20-m3-3ds-auth-settlement-redesign.md)（L71,81）| 加 supersede：「queryStatus=2 查無」歸因經 2026-06-21 fix 釐清為 L85 誤判，非純同步延遲；指向本 plan |
| [S2 callback plan L134](../specs/2026-06-21-m3-3ds-s2-callback-polling-plan.md#L134) | 同上 supersede 註記 |

---

## 4. 字面 vs 事實掃描（執行側必做，memory `feedback_literal-vs-fact-scan-includes-adapter-docstring-ssot`）

- `grep -rn "queryStatus" packages apps`（已知 active：settle-charge / domain types / wire / adapter / PollOrderStatus / payment-status route / notify route / cron route — 逐一核「是否仍宣稱 status===0 才成立 / status=2 查無」）
- `grep -rn "status.*無更多\|status.*無紀錄\|queryStatus.*查無\|status===0\|queryStatus !== 0"` 全 repo
- **active（types/元件/adapter docstring）= 必改正**；**凍結歷史 plan = 加 supersede**（區分二者、見 §3c）。

---

## 5. 新增 / 修改測試（codex K1 r1：補 adapter raw 層 + 全 record_status table）

### 5a. use-case 層（settle-charge.test.ts）
| 測 | 輸入 | 期望 | 守什麼 |
|---|---|---|---|
| R1（root cause 正向）| `queryStatus=2, count=1, record_status=0`（強識別+金額符）| `{ kind:'paid' }` | status=2 成功單能成立（S1 真生效）|
| R2 | `queryStatus=2, record_status=1`（OK）| `{ kind:'paid' }` | 2 放行後 OK 也成立 |
| R3（全 record_status table @ queryStatus=2）| `queryStatus=2` × `record_status ∈ {-1,0,1,2,3,4,5,999}` | -1/5→failed、0/1→paid、4→auth_or_pending、2/3→refund pending、999（未知碼 default 分支）→unverified | 放行 2 後 record_status **仍逐態裁決未弱化**、未知碼仍 fail-closed |
| R4（白名單嚴格）| `queryStatus=99`（未知/error code）| `pending: record_unverified` | 非 {0,2} 一律 fail-closed |
| R5a / R5b（縱深拆兩案）| `queryStatus=2, count=0` ／ `queryStatus=2, records.length≠1` | 皆 `pending: record_unverified` | 放行 status 後仍要求恰 1 筆（count 與 records 各自擋）|
| R-改 | 改 [L151-153](../../packages/use-cases/src/settle-charge.test.ts#L151-L153)：`queryStatus=2` 不再斷言 unverified（移到 R4 用真失敗碼）| — | 移除 bug 固化 |

### 5b. adapter 層（TapPayChargeAdapter.test.ts，codex K1 r1 必補）
| 測 | 輸入（raw fetch mock）| 期望 | 守什麼 |
|---|---|---|---|
| A1（raw status=2 **有**紀錄）| `{ status:2, number_of_transactions:1, trade_records:[AUTH 筆] }` | `queryStatus=2 + records.length===1 + count===1` | 證 adapter 忠實解析 status=2 **不丟** trade_records（今天真實情境）|
| A2（既有 L245 保留）| `{ status:2, msg:'no more' }`（無 trade_records）| `queryStatus=2 + records=[] + count=0` | status=2 無 records 仍合法空（測試名去除「status=2≡無紀錄」誤導）|

---

## 6. 鐵則 / 風險 / rollback / observability

- **鐵則 8**：改對帳脊椎核心判定 → 本 plan + codex K1 + Sean 批 + 執行 session + codex K2 + 審查 sign-off。
- **鐵則 12**：payment 結算成立判定 → 重點驗：① 識別/金額/弱識別窗閘**零變更** ② fail-closed 方向不變（只放行確認成功碼，throw/失敗仍 pending 保留）③ 不偽 paid（record_status 才是成立權威，status 只管「查詢有沒有成功」）。
- **風險**：放行 status 過寬 → 誤讀失敗查詢的 trade_records。緩解 = **白名單 {0,2}**（非「拿掉檢查」）+ `numberOfTransactions===1` + `records.length===1` + recordMatchesOrder 三重縱深全保留。
- **observability（codex K1 r1 PASS 建議、non-blocking）**：當 `queryStatus ∉ {0,2}` 但 `records.length > 0` → 記一行非 PII 警示 log（orderId/queryStatus/count），方便未來追 TapPay error table 是否有未涵蓋的成功碼。不改裁決（仍 fail-closed pending）。
- **rollback**：forward 改、純邏輯、可 revert；無 migration、無 schema、無 env。
- **零 migration / 零 db push / 零 env**。

---

## 7. 驗收（明確 yes/no）

1. 三綠（typecheck + lint + build + full vitest，含 R1-R5b + A1-A2 + 改後既有測試全綠）。
2. 重刷一筆 sandbox 3DS（同 runbook）→ 訂單列表幾秒內由「待付款」→「處理中」（payment_status=paid）。
3. settle-charge.ts diff 僅 L85 status 閘 + helper + 註解；recordMatchesOrder / classifyRecordStatus / settlePaid 零變更（git diff 證）。
4. 字面 vs 事實掃描 0 殘留把 status=2 描述成「查詢失敗 / 等於無紀錄」（active 已改正、歷史已 supersede）。

## 8. forward 觀察（修完實證、不擴本 fix scope）

- **「同步延遲」歸因待驗證**：若修 L85 後 callback **首次** settleCharge 即成立（無需等輪詢/webhook/sweeper），則證明設計包 §5.1「Record 同步延遲」歸因錯誤、真因純為 L85 bug → 後續可 revisit S2 輪詢 / S2b 主動 settle 的必要性（可能可簡化）。本 fix 不動 S2/S2b，僅記觀察。

---

## 禁止清單（基線 + codex K1 r1 矛盾修正）

不改**本 plan §3/§5 明列範圍外**檔 / 不動 classifyRecordStatus 或 recordMatchesOrder 或 settlePaid 邏輯 / 不變 env·deployment / 不改 schema·migration / 不用 `git add .`·`-A`（精準 add）/ 不自動 push / 不動 `.env*` / 不弱化識別·金額·弱識別窗閘 / 不把「放行 status=2」做成「拿掉 status 檢查」（必白名單 fail-closed）/ 不擴到 S2·S2b 簡化（§8 僅觀察、另 slice）

— 禁止清單結束 —
