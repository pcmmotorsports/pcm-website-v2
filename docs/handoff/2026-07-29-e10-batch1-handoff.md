# E10 第 1 批施工交接(2026-07-29 上午)

> **接手 session 的唯一入口。** 讀完本檔 + `STATUS.md` 就可以直接動工,不需要回頭讀過夜回報。
> 施工權威 = `docs/specs/2026-07-28-e10-order-closure-master-plan-v2.md`(**§5.0 DAG = 唯一順序**、§5.1 = 片全表、§8 + **§8.0** + **§8.7** = 全部拍板)。

---

## ① 現在站在哪裡

**第 1 批 69 片,已完成 9 片,三個開工前置全部解除。**

| 前置 | 狀態 |
|---|---|
| Sean 最終批准規格 | ✅ 2026-07-29 凌晨 |
| 三支 migration apply production | ✅ 已 apply、對帳全綠(見 ③) |
| A9b1 + A10c1 **端到端**驗收 | ✅ **Sean 肉眼驗過**(見 ④)⇒ D1 開工前置真的成立 |

已完成的 9 片:A0a / A0b / A0c(docs)、D0 / A2 / A3(M,**已 apply**)、A9b1(A)、A10c1(U,flag 已開)、A15(A,高風險金流、雙審 PASS)。

---

## ② 🔴 接手第一件事:讀 §8.0 與 §8.7

Sean 2026-07-29 早上一次拍了五題,**全部改變了規格既有字面**。不讀這兩節會照著作廢的舊字面施工。

| 題 | 拍板 | 你會踩到的地方 |
|---|---|---|
| **A0a-1** | 「都沒扣到錢,放心刪除」 | D1 線解封,但**只解除 `PCM-2026-0101` 無 `rec_trade_id` 這一個硬閘**。其餘五筆 read-back 判定矩陣**不降級**、`bank_transaction_id` 替代**仍禁止**。cohort 維持 **26 張**。0101 的證據等級 = **Sean 本人確認、非系統 read-back**,須寫進 migration 註解 / cohort manifest / audit 三處 |
| **A0c-1=A** | 27 項表已改 | 分母是 **✅2 / ⚠️5 / ❌20**(不是 2/6/19)。第 19 項取消訂單的起點是 ❌(動作根本不存在)、不是 ⚠️ |
| **A0b-1=B** | 列表 **13 欄** | 🔴 **「12 欄」全檔作廢**。A11a 依 §5.1a 施工:留「年份廠牌車種」、拿掉「來源 · 管道」 |
| **A3-1=A** | 加更正鏈 | `order_notes.corrects_note_id` 已在 schema。**A9a / A10a 有預先寫死的驗收條件**,見 ⑤ |
| **A2-1=A** | 加逐批到貨明細 | `order_item_procurement_receipts` 已在 schema。**A4a / A4b 有預先寫死的驗收條件**,見 ⑤ |

---

## ③ DB 現況(已 apply,不要再寫一次)

```
20260729010000  D0  訂單編號 expand(legacy_display_id + CHECK 放寬 + pending_invoices 加 voided)
20260729020000  A2  order_item_procurement + order_item_procurement_receipts
20260729030000  A3  order_notes(含 corrects_note_id 更正鏈)
```

apply 後對帳:orders 29 / order_items 39 / attempts 27 / pending_invoices 3 **一列未動**;orders 34→**35 欄**;三張新表 **全部 0 列**;6 支新索引到位;三張新表 **RLS 全開**;**anon/authenticated 對三張新表的 SELECT 權限合計 = 0**(原則 3 守住)。
ledger 零漂移:85 支、local-only 0、remote-only 0、`array_length(statements,1)` = 17/26/18(**>1 = db push 來源**)。

🔴 **`supabase` CLI 被 `.env.local` 的壞字元擋住時的繞法**(不碰 `.env*`):把 `supabase/` 複製到 scratch 目錄、用 `--workdir` 指過去。憑證在 macOS keychain、零密碼提示。詳 memory `reference_supabase-cli-reads-env-local-blocker`。

---

## ④ 已驗 / 未驗(誠實邊界)

**已驗**
- 三支 migration 的 fail-closed 驗收 DO block **在 production 實跑通過**。
- A9b1 + A10c1 端到端:flag 開啟後輸入 `PCM-2026-0104` **命中 1 筆**、亂碼 **0 筆**(fail-closed 沒有退化成列出全部)。
- `database.types.ts` 已重 gen,三綠 + `pnpm test` **3076 passed**。

**未驗 / 要小心**
- 🔴 **rowSpan 合併格、`n/m` 膠囊、整單總額** 這三件事在第 1 批**無法用真實資料肉眼驗** —— 那 5 張多品項單全在待刪的 26 張裡(§5.1a 驗收盲區)。A11/A12 必須附假資料 smoke test,**不得因為畫面看起來正常就宣稱已驗**。
- 改 Vercel 環境變數**不 redeploy 不生效**(今天實際踩到)。
- **pcm-admin 正式分支 = `dev`**,推 dev 即部署後台;`main` 是顧客站。

---

## ⑤ 🔴 前面幾片已經被寫死的驗收條件(在 migration 註解裡,不要漏)

| 片 | 條件 |
|---|---|
| **A4a** | ①receipts 的 INSERT 會重算 parent 的 `received_quantity` ②重算違反 `received_range` 時整筆交易 `RAISE` ③A4b 負測涵蓋「分兩批到貨累計正確」與「第二批超量被擋」 |
| **A4b** | **冪等鍵或 double-submit 負測** —— receipts 無去重鍵,重送會讓到貨數虛增(員工據此通知客人「到貨」而貨不在) |
| **A5a** | 只收供應商顯示值,`supplier_canonical_key` 由 SQL 內呼叫 A5b 產,呼叫端不得自帶 |
| **A6** | 🔴 **一次只准 INSERT 一列**(禁多列 VALUES / 禁 `INSERT ... SELECT` 回多列)—— 多列 INSERT **可以把更正鏈繞成環**(PG 非 deferrable FK 到 statement 結束才驗;已用 production 實測坐實,migration 內留有固定探針) |
| **A9a** | ①U6 稽核查詢必須帶 `NOT EXISTS (… corrects_note_id = n.id)` ②負測**兩個方向都要**(更正前算 1 筆、更正後算 0 筆)—— 只測後者的話「永遠回 0」的壞查詢照樣全綠 |
| **A10a** | 走更正鏈必帶 **visited 集合與深度上限**,不得假設鏈一定終止;被更正的列標「已更正」而非隱藏 |
| **D1c** | 鎖列後、DELETE 前必先斷言 `order_item_procurement`(經 `order_items`)與 `order_notes` 對 cohort **零引用**,非零則 abort(兩表對 orders/order_items 都是 `ON DELETE RESTRICT`,而實際 apply 序是 A2/A3 先、D1c 後) |

---

## ⑥ 下一步

照 §5.0 DAG:**D1a0 起的 D1 線**(D1c 前有 Sean 獨立批准閘)與 **A7 / A7b / A1** 等 M 片。

🟡 非阻擋:**D0-1** Sean 未答(全 repo migration 自寫 `BEGIN/COMMIT` 與 CLI 記帳的窄縫 —— A 維持現狀 / B 只改 D0 / C 開 backlog)。

---

## ⑦ 這條線上工具鏈的實況(省得再撞一次)

- **codex 今天逾時三次**(各 10 分鐘、零輸出)。依 `~/.claude/rules/00-work-rules.md` R4「相同錯法第 2 次換路」,審查改由 **Fable(`adversarial-reviewer`, `model: fable`)** 接手 —— 這是換路、不是開平行審查線。
- Fable 首次執行被瞬時網路錯誤(ENOTFOUND)中斷 ⇒ 確認 API 可達後**用 SendMessage 續跑同一 agent**(保留已讀脈絡)比重開便宜。
- 對抗審查實績:A2/A3 擴充片 **FAIL must-fix 4 + nit 3、駁回 0**。最重要一條是**我自己寫在 migration 註解裡的一句話是錯的**(「更正鏈迴圈物理上形不成」)—— 主對話與 Fable 各自獨立命中。**註解裡的斷言跟 code 一樣需要被測**,不能只是寫得篤定。
