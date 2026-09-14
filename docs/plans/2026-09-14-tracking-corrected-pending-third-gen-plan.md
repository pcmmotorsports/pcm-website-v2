# plan · 更正單號信掃描面改「比號碼」(第三代)—— 2026-09-14

> ⟦5b-SHIPPEDNUMNOTRECORDED1⟧。主視窗 2026-09-14 派:「`sent_tracking_number` 在,但 `pcm_tracking_corrected_email_pending` 還是比時間 ⇒ 改成比號碼(寄過的號 ≠ 現在的號才排更正信)」。鐵則 8(動 view)⇒ 本 plan 先寫,**migration 寫好不貼**。
> 🔴 **版本號不是 20260914080000** —— 那個號**已經被施工窗佔走**(`~/pcm-admin-ui/supabase/migrations/20260914080000_m4b_hct_record_label_raw.sql`,2026-09-14 五個 worktree 全掃)。本 plan 用 **`20260914090000`**。

---

## 1. 現況(逐格從碼裡讀出來的)

| 物件 | 現在長什麼樣 | 出處 |
|---|---|---|
| `email_outbox.sent_tracking_number` / `sent_seq` / `sent_tracking_recorded` | **在**(正式庫已有) | 32 列補掃 2026-09-14 讀數 |
| `pcm_tracking_correction_candidates` | **第二代**:比「我們最後一次告訴這張訂單的號碼」 vs 現在的號碼 | `20260905200000:` 那支 view 的 `CASE` |
| `pcm_tracking_corrected_email_pending` | 🔴 **第一代**:`e0.sent_at < s.tracking_corrected_at`(比時間) | `20260907060000:244-300` |

**為什麼會退回第一代** —— 不是沒做,是**被後來那支蓋掉了**:
`20260905200000` 把 pending 改成讀 `pcm_tracking_correction_candidates`(規則只有一份);而兩天後 `20260907060000`(給五張 view 補「自己 skip 的要能重排」)**用一份自己寫的、時間比較的定義 `CREATE OR REPLACE` 了同一支 view** ⇒ 第二代那一半被安靜換掉,而**三綠、型別、測試全綠**。
📌 這正是 memory `reference_parallel-rpc-generations-later-version-must-be-union` 記的那個形狀:**版本號晚的那一支必須是聯集**。

**🔴 而它還連帶弄壞了第二件事(本次查出來的,不在派工單上):**
`get_tracking_corrected_gap_counts()` 的 `no_recipient_count` **直接讀 `pcm_tracking_correction_candidates`**(`20260905200000:705`),而該函式的 COMMENT 逐字保證「前兩格是互補的兩半…**兩半的和恆等於底面**」。
`20260907060000` 讓 pending **完全不讀底面**,還多加了兩個底面沒有的條件(skip 碼重排、手動單留白不寄)⇒ **那個「結構上的保證」今天不成立**:
- 一列被我們自己 skip 過(`tracking_superseded` 等四碼)⇒ 進得了 pending,**而底面把它排除**;
- 一張手動單 `notification_email` 空、`customers.email` 有 ⇒ pending 排除它,`no_recipient_count` 也不數它(它有收件人)⇒ **兩半都看不到**。

---

## 2. 改什麼

### 2-a 規則回到底面 `pcm_tracking_correction_candidates`(第三代)
把 `20260907060000` 加在 pending 上的**兩個條件搬進底面**,底面原本的 `CASE`(比號碼)一字不動:
- ① **skip 碼重排**:`NOT EXISTS(... AND COALESCE(e.last_error_code,'') NOT IN (四碼))` —— 四碼與其餘四張 view 逐字同一份。
- ② **手動單留白不寄**:`order_source IS NULL OR order_source NOT IN ('manual_phone','manual_line','manual_other') OR notification_email 非空`。
  🔴 `order_source IS NULL` 那一格非加不可:`NULL NOT IN (…)` 回 NULL ⇒ WHERE 當假 ⇒ 來源不明的單會被排除,而 TS 那半(`notification-fallback.ts`)對 `null` 是**照舊寄** ⇒ 兩層相反,少寄一封看不見。

### 2-b `pcm_tracking_corrected_email_pending` 回到「底面 + 有收件人」
逐字照 `20260905200000:543-562` 那一版(11 欄、同名同序 —— `CREATE OR REPLACE VIEW` 只准尾端加欄)。

### 2-c 不動的
`get_tracking_corrected_gap_counts()`、`pcm_tracking_corrected_payload_unparseable`、ACL、TS 那一側(`SupabaseTrackingCorrectedScannerAdapter.ts` 只認 view 名)全部不動。

---

## 3. 影響

- **客人**:出貨信寄出 → 有人改單號 ⇒ 會收到更正信的情形變多兩種:① 寄出後、寫 `sent_at` 前被改的那幾秒(競態);② 改成 B、寄了更正信、**又改回 A** ⇒ 客人手上最後一封說 B,而現在是 A ⇒ 第一代看不到、第三代會寄。
- **方向是多寄不是少寄** ——「多寄一封更正信看得見,少寄一封看不見」。
- **互補保證修回來**:`pending` 與 `no_recipient_count` 兩半的和重新等於底面。
- **零 TS 改動、零 schema 改動(不加欄不加表)**,只換兩支 view 的定義。

## 4. 風險

- **R1 欄位清單**:`CREATE OR REPLACE VIEW` 不准少欄/改名/換序。正式庫這兩支各 11 欄(`order_source` 是 `20260905080000` 補的第 11 欄,`20260905200000` 檔頭記過它被這件事咬過一次)⇒ **前置閘逐欄比對線上清單是不是我這一版的前綴**,不合就 RAISE。
- **R2 蓋掉別人的版本**:同一支 view 兩天內被兩支 migration 各改一次 ⇒ 本檔前置閘要**認得出線上是哪一代**(找得到 `sent_at < s.tracking_corrected_at` 這個第一代字面才繼續;已經有 `sent_tracking_number` ⇒ 已貼過,RAISE)。
- **R3 skip 碼清單漂移**:五張 view 共用同一份四碼,少一張等於沒修 ⇒ 事後閘檢查底面的 viewdef 含那四個字面。
- **R4 撞號**:`20260914080000` **已被施工窗佔用** ⇒ 本檔用 `20260914090000`,貼的當天重掃一次五個 worktree。

## 5. rollback(可執行)

`supabase/rollbacks/20260914090000-rollback.sql`:把兩支 view 逐字還原成 `20260907060000` 那一版(第一代 + 兩個條件)。`SET LOCAL lock_timeout = '5s'`。
⚠️ 退回去就是退回「比時間」⇒ 那兩種世界又判錯,而**不會有任何東西叫**。

## 6. 驗收(拋棄式 PG,正負對照)

| # | 造什麼 | 第一代 | 第三代(期望) |
|---|---|---|---|
| 1 | 寄 A、改 B,`sent_at < corrected_at` | 進面 | **進面**(不回歸) |
| 2 | 競態:`sent_at > corrected_at` 而寄的是 A、現在是 B | ❌ 不進面 | ✅ **進面** |
| 3 | 改回去:寄 A → 改 B → 更正信說 B → 又改回 A | ❌ 不進面 | ✅ **進面** |
| 4 | 寄的號 = 現在的號 | 進面(時間對就進) | ✅ **不進面** |
| 5 | 自己 skip 過(`tracking_superseded`) | 進面 | **進面**(聯集沒掉) |
| 6 | 手動單 + `notification_email` 空 | 不進面 | **不進面**(聯集沒掉) |
| 7 | 互補:`pending_count + no_recipient_count` = 底面列數 | 今天 ❌ | ✅ **相等** |

**定向突變**:把底面的 `CASE` 換回 `EXISTS(sent_at < …)` ⇒ #2 #3 #4 轉紅;拿掉四碼那一段 ⇒ #5 轉紅;拿掉手動單那一段 ⇒ #6 轉紅。

## 6-b. codex R1(2026-09-14)= FAIL,2 must-fix,已修

**MF1 —— 我漏了第五個 skip 碼,而那正是本檔要修的那個錯法。**
我照 `20260907060000`(四碼)寫聯集,而這支 view 的**最後一代是 `20260907230000`**(五碼,多 `recipient_stale_at_send`,`APPLIED.tsv` 已記)。
⇒ 📌 **我差一點在一支「為了修【後貼的蓋掉先貼的】而寫」的 migration 裡,再犯一次同一個錯。**
修法:五碼進底面、前置閘⑦ 與事後閘② 都要求五碼、rollback 退成五碼版;**挑「最後一代」改成機械的**
`grep -ln 'CREATE OR REPLACE VIEW public.pcm_tracking_corrected_email_pending' supabase/migrations/*.sql | sort` 取最後一支。

**MF2 —— 閘只認字面,擋不住保留字面的邏輯退步。**
前置閘④ 原本找 `tracking_corrected_at`,而那個欄名本來就在 SELECT 清單裡 ⇒ **恆真、零判別力** ⇒ 改成找第一代獨有的 `sent_at < s.tracking_corrected_at`。
事後閘加 ⑥⑦⑧:`AND/OR TRUE|FALSE|1=1` 的繞過形狀、`o.order_source IS NULL` 那一格、`IS DISTINCT FROM`。
🔬 **三個 codex 點名的繞過逐發實測**:`AND FALSE` ⇒ 事後閘⑥紅 · `OR TRUE` ⇒ ⑥紅 · `order_source IS NULL`→`FALSE` ⇒ ⑦紅 · 拿掉第五碼 ⇒ ②紅。
🛑 **而射程寫進碼裡、不寫在 commit 訊息**:`AND (1=2 OR 1=2)` **實測沒被擋**(rc=0)⇒ 這幾道閘防的是**漂移**不是**對手**,行為那一層在拋棄式 PG 的七個世界。

**nit 全收**:ACL 補核 `authenticated`;rollback 補回兩支 view 的 COMMENT。
(nit「⑤⑥ 沒檢查型別」不改 —— 型別不符 PostgreSQL 自己會拒,交易不會半套。)

## 7. 鐵則 12

碰寄信 ⇒ codex 唯讀審,**兩輪內**。must-fix 修完才 commit。

**未貼**:寫好不貼,貼由 Sean 點名編號。
