# Plan — M-4a B-4「通知 email 真值持久化 + cardholder 三分支帶入」(2026-07-24 草稿)

> ⚠️ **本檔 = Claude 過夜自主起草的 plan 草稿,尚未經 Sean 批准、尚未跑 codex 關卡1。**
> B-4 命中**鐵則 12 ①錢**(改 `charge-actions.ts` 成交 path)→ 依過夜硬規**只規劃、不實作 commit**;
> 待 Sean 早上①批准方向 ②回答下方 §9 的一個設計岔路 → 才進 codex 關卡1 審 plan → 實作。
> 真權威來源:PRD `docs/specs/2026-07-18-b0-order-notification-email-prd.md` §3.3/§3.4/§4(B-4 列)/§5;
> 舊字面清單=B-2 plan `docs/specs/2026-07-19-m4a-b2-create-order-9param-plan.md` §8.2。

---

## 1. 目標與動機

B-3 已把結帳收件區加 email 欄 + 四層 flag gate + client/server 共用 canonical schema,但**刻意不持久化真值**:
`charge-actions.ts:247` 現況 `...(notificationEmailEnabled ? { notificationEmail: null } : {})`——flag-on 也只送 `null`。
B-4 補最後一段:**把 canonical email 真值存進 `create_order`**、並**條件帶入 TapPay `cardholder.email`**(§3.3 三分支)。
完成後才有「客人留的 email 真的進 orders + 真的用於刷卡風控」,是通知線 flag 可開(B-6 cutoff)前的最後一塊 code 地基。

## 2. 分級與鐵則

- 內容分級:N/A(不是 L1/L2/L3 內容,是金流 action 接線)。
- **片型=高風險片**(鐵則 12 ①錢:改 `charge-actions.ts` 送 TapPay 的 payload 與 create_order 參數)。
- **鐵則 8**:動 3 檔以下 code + generated types,不動 schema/API 契約(RPC 已 9 參、B-2 建好)→ 非鐵則 8;但因鐵則 12 仍須提 plan 等批。
- **審查(不降級)**:codex 關卡1 審 plan → 實作 → 三綠 → code-reviewer → codex 關卡2 審 diff → Fable(高風險金流配 codex 背書)。
- **零 migration、零 db push、零 flag、零 env**(RPC 已 9 參 on prod;flag 維持 off)。

## 3. 範圍(要改什麼)

| 檔 | 改動 |
|---|---|
| `apps/storefront/src/app/checkout/charge-actions.ts` | ①`:247` 的 `notificationEmail: null` → 帶 `parsedCheckout.data.notificationEmail`(canonical 真值,B-3 zod 已產、≤254 octet)。②cardholder email 改由三分支選值(§4)後餵 `buildCardholder` / `built.cardholder`。 |
| `apps/storefront/src/lib/payment/cardholder.ts` | email 來源由「無條件 `user.email`」改為「三分支選出的 `cardholderEmail`」;放寬 `email_missing` fail-closed(§4「空字串是合法終態」);更新檔頭註解=記 Sean 07-18 授權「僅 email 一欄、僅通過驗證時可放寬 client 值」(PRD §3.3:68)。 |
| 新 `apps/storefront/src/lib/payment/cardholder-email.ts`(建議) | `selectCardholderEmail(canonical?, sessionEmail?)`:對兩個候選各跑「§3.4 canonical 規則 + `Buffer.byteLength(v,'utf8') <= 40` + RFC 5322」,回第一個通過者、皆不過回 `''`。**與 B-3 的 ≤254 canonical 驗證共用底層規則常數、不各自寫死**(§3.4「三處同源」)。 |
| `packages/adapters/src/supabase/database.types.ts` | **重生** `create_order.Args` 為 9-param(B-2 Q2=A 刻意留 B-4;§8.2 清單 #4)。用 `supabase gen types` 或既有生成流程,**不手改**。 |
| 測試 | `cardholder-email.test.ts`(三分支 + 40/41 octet 邊界 + §3.4 對抗樣本)、`charge-actions` 相關測試補「9 參送真值」「三分支各路徑」、`cardholder.test.ts` 補空字串合法路徑;**銷 §8.2 清單 #6/#7 兩處硬編碼 8 鍵斷言**(不同步=假綠)。 |

**明確不動**:`create_order` RPC 本體(已 9 參)、migration、B-3 的 UI/schema、settle/confirm/3DS 鏈、金額來源、tier、RLS。

## 4. 🔴 核心設計:cardholder email 三分支(本片最需審的一段)

現況(`cardholder.ts:49,75`):`email = (user.email ?? '').trim()`;空 → `email_missing` 拒;否則**無條件**放進 `cardholder.email`——**完全不驗 ≤40 / RFC 5322**,超長或不合規時 TapPay 靜默改預設值、我方無從得知(PRD F11)。

B-4 依 §3.3 改為三分支(候選依序,第一個通過驗證者勝):
1. **canonical `notificationEmail`**(flag-on 才有值)≤40 octet + RFC 5322 + §3.4 全規則 → 帶入;
2. 否則 **session `user.email`** 通過**同一套**驗證 + ≤40 octet → 帶入;
3. 兩者皆不合格 → **帶空字串 `''`**(F11:TapPay 非必填欄位允許空字串;**絕不送已知不合規值**)。

🔴 **驗證規則須鏡像 §3.4(與 B-3 同源)**:trim + domain 轉小寫、拒 CR/LF/控制字元、**只允許可列印 ASCII `^[!-~]+$`**、**禁合成域**(大小寫不敏感 + 去尾點 FQDN + 擋子網域 `%.line.pcmmotorsports.local`)、長度用 **`Buffer.byteLength(v,'utf8')`**(禁 `.length`)。cardholder 上限=**40 octet**(比 notification 的 254 嚴);name/phone 維持 server 權威、不受此放寬。

🔴 **buildCardholder 語意變更(必寫進審查重點)**:現行 `email_missing` 把「email 空」當 fail-closed 拒單。B-4 後**空字串是合法終態**(branch ③)→ 不可再因 email 空而拒單。建議:`selectCardholderEmail` 在 charge-actions 算好後傳入 `buildCardholder`(取代現 `user.email` 參數),`buildCardholder` 移除 `email_missing` 分支(name/phone 的 fail-closed 保留)。⚠️ 動 `buildCardholder` 契約=牽動其單元測試,須同步。

## 5. 🔴 §9 設計岔路直接影響的行為變更(誠實揭示)

三分支忠實實作會**改變現行 flag-off(=prod 當前狀態)的 cardholder.email 行為**:
- 現在 flag-off:無條件送 `user.email`(含 LINE 合成域 `*@line.pcmmotorsports.local`、含 >40 超長)。
- B-4 後 flag-off:branch ① 無值 → 走 branch ②,session email 過不了 §3.4(合成域被禁)或 >40 → **送空字串**。
- 對真實短 email 客人=**零變化**;對 LINE 客人=從「送合成假 email、TapPay 靜默改預設」變「送空字串」=**現況不變差、但沒修好**(PRD §3.3:70 已認)。

這是**動到 live 付款 payload**(即使 flag 維持 off),故列為 Sean 須拍的岔路(§9-Q1),不自行認定。

## 6. 驗證計畫(三綠 + 突變,不降級)

- 三綠:typecheck + lint +(動 .ts)build。
- 單元測試:
  - `selectCardholderEmail` 三分支各命中 + 40 octet 通過 / 41 octet 落下一候選 / 皆不過回 `''`;§3.4 對抗樣本(重音/NBSP/全形空白/合成域/子網域/去尾點)全擋(對齊 B-1 的 12 樣本)。
  - charge-actions:flag-on 送 canonical 真值(非 null)、三分支各路徑餵對 cardholder;flag-off 回歸(§5 行為變更用測試釘住、非默默改)。
  - 銷 §8.2 #6/#7 兩處硬編碼斷言(改 9 鍵)。
- 突變自驗:①把 branch 選值改成無條件 canonical → 41 octet 案例應轉紅 ②把 §3.4 合成域檢查拿掉 → LINE 樣本應轉紅 ③把 `notificationEmail: null` 留著 → 「送真值」測試轉紅。

## 7. 舊字面清單(§8.2,B-4 動 TS 必逐條 grep 核)

B-2 plan §8.2 列 11 項「8 參數」舊字面。B-3 已動 UI/schema 層,但 B-4 動 mapper/adapter/types 層 → **開工先 grep 全樹重建清單**、逐條核哪些 B-3 已銷、哪些 B-4 補。**已知未銷=#4 `database.types.ts:1537-1553` 生成型別(B-2 Q2=A 刻意留 B-4)**;#6/#7 硬編碼 8 鍵斷言隨本片動 TS 必同步(否則假綠)。⚠️ 勿誤改 `order.ts:223` 的 `createOrder()`(domain factory、與 RPC 無關)。

## 8. 跨片順序 + rollback

- 🔴 **跨片唯一合法順序(PRD codex R3 #7)**:B-1/B-2 ✅ → **B-3/B-4 部署但 flag 保持 off** → 開 flag 記 cutoff(=flag 實際開啟時戳,非部署時戳)→ 觀察窗 → B-6 收緊。**B-4 完工後不得代開 flag。**
- **rollback(B-2 §9 步驟 0)**:B-4 上線後 storefront 送第 9 參真值;若要退 DB 必**先退 app 並確認部署生效**才動 DB(否則撞 `42883`/`PGRST202` 結帳全斷)。但 B-4 本身零 migration,rollback = `git revert` 該 commit + 重部署即可。

## 9. 🔴 Sean 須拍/須知情(排隊給早上)

- **B-4-Q1(設計岔路,須拍)**:flag-off 的 cardholder.email 行為要不要跟著三分支一起收緊?
  - **A(推薦、PRD 忠實)**:統一三分支,flag-off 也套 ≤40+§3.4 驗證閘 → LINE/超長客人 cardholder.email 變空字串(比現況乾淨、不更差、符合 §3.4 禁合成域)。
  - **B(最保守)**:flag-off byte-identical(維持無條件送 session email),三分支只在 flag-on 跑 → live 付款 payload 零變更,但保留「送合成/不合規值給 TapPay」的現況。
  - 差別只在 flag-off(=現 prod)那條路徑的 TapPay payload;flag-on 兩案相同。
- **B-4-Q2(知情、非阻擋)**:B-4 上線後,Sean 須跑一筆真實 3DS 交易驗證 TapPay 對超長/不合規 email 的實際行為(PRD R2 UNVERIFIED、sandbox 證不了)。此驗證併入 S3/S5。
- **B-4-Q3(知情)**:B-4 完工=code 就緒,但通知功能**未上線**(flag 仍 off,B-6 才收緊必填);commit/STATUS 不得宣稱「通知功能上線」。

## 10. 估時

實作 + 測試 ≈ 40–60 分鐘(三分支 + 邊界測試 + §8.2 核對是主要耗時);加 codex 關卡1/關卡2 + code-reviewer + Fable 審查。屬高風險片,審查不降級。
