# M-4b E10 備註線 plan **v2** — `A6 → A9a-1 → A9d2 → A10a`

> **狀態:關卡1 R1 = NO-GO(35 條:27 must-fix + 8 nit)已全部折入,待跑 R2。零行 code、零 migration。**
> 依據 = Sean 2026-08-02 拍板 A(線)+ Q1=**A 寫同交易稽核**(重問後)+ Q2=A 一片一片來。
> R1 findings 逐字 = `docs/reviews/2026-08-02-e10-a6-k1-codex.md`。
> 母 plan = `docs/specs/2026-07-28-e10-order-closure-master-plan-v2.md` row 33(A6)/ 38(A9a)/ **42(A9d2)** / 56(A10a)。

---

## §0 v1 → v2 的四個結構性更正(全部來自 R1,親驗成立、駁回 0)

| # | v1 錯在哪 | v2 |
|---|---|---|
| **[1]** | 說這條線 **3 片**,漏掉 `A9d2`(server actions:note / cancel) | **4 片**;寫入呼叫端是 A9d2 不是 A10a |
| **[2]** | 把「只做 notes 投影」叫 A9a,而母 plan `:385` 的 A9a = **notes + procurement** | 改名 **A9a-1**;`A9a-2`(procurement 投影)明文留給採購線,**片號不重用** |
| **[4][5][6]** | 「`order_notes` 無 `updated_at` ⇒ append-only 由形狀保證 ⇒ 自己就是稽核帳本」 | **這句話是錯的**,見 §3.1;Q1 已重問、Sean 改拍 **A =寫同交易稽核** |
| **[10][11][23]** | 完全沒接到 A3 指名交給 A6 的**三條契約債** | 全數進 §4.2 規格與 §7 驗收 |

🔴 **v1 那句 append-only 錯話曾成為 Sean Q1 拍板的前提** ⇒ 已重問並重拍。
病根與機制 = memory `feedback_assert-scope-only-after-reading-source-file`(CLAUDE.md 自檢清單已加一條)。

---

## §1 線的組成(4 片,Q2=A:每片收工停下回報再往下)

```
A6 (R, 高風險)  → A9a-1 (A) → A9d2 (A, 高風險) → A10a (U, 需肉眼)
owner RPC          notes 讀模型    note server action   明細頁時間軸 + U6
```

**目標** = 27 項驗收第 **3** 項「訂單寫備註」🟡 → ✅(7/26 以來第一項轉綠)。
🔴 **[3] 更正**:只有 **A9a-2**(procurement 投影)與 A10b 屬採購線;**A10a 不是採購線的必經工作**,
v1 說「A9a 與 A10a 都是兩條線共用」是錯的。共用的僅為 A9a 這個**片號底下的讀模型檔案**。

---

## §2 分級與片型

| 片 | L | 片型 | 鐵則 8 | 鐵則 12 |
|---|---|---|---|---|
| **A6** | L1 | **高風險** | ✅ 動 API | ✅ **②權限 + ③DB 結構** ⇒ 關卡1 + 關卡2 |
| **A9a-1** | L1 | 標準片 | ⚠️ 動 `packages/adapters` 共用投影 ⇒ 併本 plan 批 | ❌ 六類逐條不觸發 |
| **A9d2** | L1 | **高風險** | ✅ | ✅ **命中②權限**(server action = 授權邊界)⇒ 關卡2 必跑。**[1] 抓到 v1 把它藏進 A10a 並標「不觸發」** |
| **A10a** | L3 內容(後台 CRUD,合規) | 標準片 + **需肉眼** | ❌ | ❌ |

---

## §3 `order_notes` 完整合約(逐條附 `檔案:行號`,取自建表 migration 非 information_schema)

檔 = `supabase/migrations/20260729030000_m4b_e10_a3_order_notes.sql`

### 3.1 🔴 append-only 的真實強度(`:21-27` 逐字)

> DB 層的保證**僅止於**「應用 role…沒有 UPDATE / DELETE 權」…⚠️ **table owner 與 superuser 仍可直接改**,
> 而且就算加了 trigger,owner 也能停用它。真正的 append-only 強制需要 trigger(屬 T 型、不在本片)。
> ⇒ 本片不宣稱「物理不可改」,只宣稱「應用路徑改不到」。
> 另一個誠實邊界:表層 ACL…擋不住**日後某支 SECURITY DEFINER RPC 誤把本表內容授給 authenticated**。

⇒ **[5][6] 成立**:`order_notes` **不是**可自證的稽核帳本。
⇒ **這正是 Q1=A(寫同交易 `admin_audit_log`)的真正理由** —— 不是「合約說要」,
而是**兩張表分開才需要兩次竄改**,單一表的 append-only 在 owner 層是零強度。
⚠️ **仍不得說滿**:owner 同樣能改 `admin_audit_log`。稽核降低的是**單點竄改**,不是「不可竄改」。

### 3.2 A3 指名交給 A6 的三條契約債(v1 一條都沒接到)

| # | 出處 | 交辦 |
|---|---|---|
| **D1** | `:102-103` | 「不得晚於現在」**擋不進 CHECK**(`now()` 非 IMMUTABLE)⇒ **那條是 A6 owner RPC 的責任**。CHECK 只擋 infinity 與 1900 年 |
| **D2** | `:92-99` | body **不宣稱窮盡**:`U+2800` 盲文空白 / `U+3164` Hangul filler / `U+00AD` 軟連字號既不在 translate 清單也不屬 `[[:space:]]` ⇒ **照樣入得了庫**;「最後一道歸 **A6 writer(正規化 + 拒收)**」 |
| **D3** | `:186-195` | **更正鏈可以成環**(Fable 抓 + 正式站交易模擬確認)：單一多列 `INSERT … VALUES (a,…corrects=b),(b,…corrects=a)` 兩列互指,FK/partial unique/`corrects_not_self` **都不擋** ⇒ **「A6 一次只准 INSERT 一列」(禁多列 VALUES、禁 `INSERT…SELECT` 回多列)必須寫成驗收條件** |

### 3.3 完整約束清單(**[9]** 補回 v1 漏掉的三道)

```
note_type   ∈ {internal, contact_log, customer_notified}                    NOT NULL
body        NOT NULL + translate(body, U&'\200B\200C\200D\FEFF','') ~ '[^[:space:]]'
channel     ∈ {line, phone, email, in_person, other} 或 NULL
occurred_at 2020 < x < 2100 或 NULL          ← 上界「不晚於現在」= A6 責任(D1)
author      ~ '^[a-z0-9_]{1,64}$'                                            NOT NULL
配對規則    internal ⇒ channel 與 occurred_at 皆 NULL;非 internal ⇒ 皆 NOT NULL
🆕 corrects_not_self          CHECK (corrects_note_id IS DISTINCT FROM id)
🆕 UNIQUE (id, order_id)      ← 複合 FK 的被參照鍵
🆕 order_notes_corrects_note_id_key   partial UNIQUE (corrects_note_id) WHERE NOT NULL
                              ⇒ 一筆最多只能被更正一次(`:154-158`)
corrects FK (corrects_note_id, order_id) → (id, order_id)  ⇒ 更正鏈不得跨單
order_id FK → orders(id) ON DELETE RESTRICT
```

### 3.4 U6 告知義務的查詢合約(`:160-185`,**[34][35]** 來源)

- **不得**寫 `EXISTS(… note_type='customer_notified')` —— 會把**已被更正的誤選**算成已履行。
  正確形狀必須帶 `AND NOT EXISTS (SELECT 1 FROM order_notes c WHERE c.corrects_note_id = n.id)`。
- 🔴 **負測必須兩個方向**:更正前斷言算 **1**、更正後才斷言算 **0**。
  只測後者的話,**一個「永遠回 0」的壞查詢照樣全綠**(A3 探針自己犯過這個錯)。
- 🔴 **更正不可撤回**:`NOT EXISTS` 只看【直接指向】,`A ← B ← C` 裡 C 更正 B **不會**讓 A 復活;
  partial unique 也不准對 A 再掛第二筆更正 ⇒ **唯一正解是重登一筆新的 `customer_notified`**。
  **這句要進 A10a 的 UI 文案**,不能讓員工以為「更正的更正」會還原。
- 時間軸:被指向的列標成「已更正」,**不是不顯示**。

---

## §4 A6 規格(v2)

檔 = `supabase/migrations/<ts>_m4b_e10_a6_admin_append_order_note.sql`
形狀樣板 = `20260801160000_m4b_e10_s2_admin_upsert_supplier.sql`。

### 4.1 簽章與交易外殼

```
admin_append_order_note(
  p_order_id uuid, p_note_type text, p_body text,
  p_channel text, p_occurred_at timestamptz,
  p_corrects_note_id uuid,          -- 🆕 [7]:不收它,更正鏈在唯一核准路徑上不可達
  p_actor text, p_request_id text
) RETURNS text
```
- **[17]** 檔案外殼照樣板:`BEGIN` / `SET LOCAL lock_timeout='5s'` / `SET LOCAL statement_timeout` / `COMMIT`,**並進 §7 驗收**。
- **[18]** `COMMENT ON FUNCTION` 合約(固定碼、權限、輸入語意、誠實邊界)**列為產物與驗收**。

### 4.2 輸入守門(執行順序即優先序,**[13]** 要求明文定序)

**檢查一律照下列順序,先命中先回傳**(順序是正確性的一部分,見 memory `feedback_race-test-without-barrier-proves-nothing` 同型教訓):

1. `actor` / `request_id`:先剝空白 → 非空 → 長度 → 控制字元(**[15]** 照樣板 `:137-179`,失敗一律 `RAISE`,非固定碼)
2. `p_order_id IS NULL` → `INVALID_INPUT`
3. `note_type` 不在三值 → `INVALID_TYPE`
4. `channel` 非 NULL 且不在五值 → `INVALID_CHANNEL`
5. **配對規則**:`internal` 帶任一 → `INTERNAL_FIELDS_FORBIDDEN`;非 internal 缺任一 → `CONTACT_FIELDS_REQUIRED`
6. **D1** `occurred_at > now()` → `OCCURRED_AT_IN_FUTURE`
7. **D2** body 正規化後為空 → `INVALID_BODY`;body 長度 > 上限 → `BODY_TOO_LONG`(**[16]**)
8. `corrects_note_id` 非 NULL 且(不存在 / 不同單 / 已被更正過)→ `CORRECTS_NOT_FOUND` / `ALREADY_CORRECTED`
9. 鎖序 + 存在性:`SELECT 1 FROM orders WHERE id=p_order_id FOR SHARE`(**[14]**)→ 無 → `ORDER_NOT_FOUND`
10. **單列** INSERT(**D3**)+ 同交易 `admin_audit_log` INSERT(**Q1=A**)→ `APPENDED`

**回傳碼全集**(**[12]** 要求窮盡):
`APPENDED / ORDER_NOT_FOUND / INVALID_INPUT / INVALID_TYPE / INVALID_CHANNEL /
CONTACT_FIELDS_REQUIRED / INTERNAL_FIELDS_FORBIDDEN / OCCURRED_AT_IN_FUTURE /
INVALID_BODY / BODY_TOO_LONG / CORRECTS_NOT_FOUND / ALREADY_CORRECTED`

- **[14]** FK 例外只捕捉**具名** `order_notes_order_id_fkey` 並映射 `ORDER_NOT_FOUND`;其餘 23503 往上拋。
- **D2 正規化定義**:剝 `[[:space:]]` + 四種零寬 + `U+2800` / `U+3164` / `U+00AD` 後判空;**入庫存正規化前的原文**(顯示保真),判空用正規化後的值。

### 4.3 同交易稽核(Q1=A)

寫 `admin_audit_log`:`actor` / `action='order_note.append'` / `target='order:<id>'` /
`before=NULL` / `after`(note_type / channel / occurred_at / corrects_note_id;**不含 body 全文**,只記長度)/
`request_id` / `source_app='admin'`。
🔴 **不記 body 全文的理由**:備註含 PII 與內部評語,稽核表的 ACL 與 `order_notes` 不同(`admin_audit_log` 對 service_role 開 INSERT)
⇒ 全文進去等於把內部備註複製到一張權限較鬆的表。**[8]** 的 `request_id` 落點由此解決。

### 4.4 本片刻意不做

1. **不做刪除 / UPDATE** —— 唯一寫入動作是單列 INSERT。
2. **不加 append-only trigger** —— 屬 T 型片(A3 `:24` 已定性),且 owner 可停用它 ⇒ 真正的縱深是 §4.3 的兩表分離。**明文登記為未關閉的洞**,不是忽略。
3. **不解決 owner/superuser 竄改** —— 物理上做不到(見 §3.1)。

---

## §5 A9a-1 / A9d2 / A10a

- **A9a-1** — `packages/adapters/src/supabase/SupabaseOrderAdapter.ts` 的 `ADMIN_ORDER_DETAIL_SELECT` 加 notes 投影 + 型別 + mapper。
  🔴 **[33] 行號更正**:明細投影的 byte-equal 守門在 `SupabaseOrderAdapter.test.ts:636-640`(v1 誤寫 `:249-260`,那是**列表**投影)。
  🔴 **[34]** 驗收含 §3.4 的 `NOT EXISTS` 形狀 + **雙向**負測(更正前算 1 / 更正後算 0)。
  🔴 **[2]** 本片**不宣稱 A9a 完成**;`A9a-2` procurement 投影明文留給採購線。
- **A9d2** — note server action(高風險:授權邊界)。照 `staff-actions.ts` / `supplier-actions.ts` 形狀:授權閘 → 純解析器 → repository → PRG。**必須斷言回傳碼**,收到未知碼當呼叫端 bug(memory `feedback_null-dispatch-rpc-silently-downgrades` 同型)。
- **A10a** — `apps/admin/src/app/orders/[id]/page.tsx`(現 76 行)+ 新元件。時間軸 + U6 結構化欄位;
  🔴 **[35]** 必含「**更正不可撤回**」文案 + 走鏈帶 **visited 集合與深度上限**(環是實測可達的,不得假設鏈會終止)。

---

## §6 風險

| # | 風險 | 處置 |
|---|---|---|
| R1 | owner / superuser 可改 `order_notes` **與** `admin_audit_log` | §3.1 誠實邊界;稽核降低單點竄改、非不可竄改。**不得對外說「備註不可竄改」** |
| R2 | A9a-1 動共用 adapter | 純加法、不碰 list 投影與 storefront;收工跑**完整** `pnpm test` |
| R3 | `author` 來自自選 picker cookie、**非驗證身分**(E8-B 未做) | 保證「有一個合法 author 字串」,**非**「那是真的操作者」 |
| R4 | 本機 `.env.local` 用 `SUPABASE_SECRET_KEY`、程式讀 `SUPABASE_SERVICE_ROLE_KEY` | A6 驗證走本機 PG17 從零 provision,不依賴 `.env.local` |
| R5 | **[21]** type re-gen 需 production apply 後 | DoD 拆兩段,見 §7 |
| R6 | **[22]** re-gen 會把 `p_channel` / `p_occurred_at` / `p_corrects_note_id` 產成非 nullable | **手動 `\| null` 校正三處**,與 `create_order` / `admin_upsert_supplier` 同型(既有校正已達七處) |

---

## §7 驗收條件

### 7.1 guard / mutant manifest(**[27]** 要求先列有限清單,不得自我指涉)

| G# | 守門 | 指定紅點 |
|---|---|---|
| G1-G12 | §4.2 十二個回傳碼各自的判斷 | 各自的行為測試 |
| G13 | 檢查**順序**(把 order 存在性移到 type 檢查前 ⇒ 無單 + 爛 type 回錯碼) | 順序測試 |
| G14 | 單列 INSERT(D3) | 結構斷言:函式本體零多列 VALUES / 零 `INSERT…SELECT` |
| G15 | 同交易稽核 | 拿掉 ⇒ 稽核列數不變的斷言轉紅 |
| G16 | D2 正規化(三個非 `[[:space:]]` 碼位) | 三條各自向量 |
| G17 | D1 未來時間 | 明天的 `occurred_at` |
| G18 | 具名 FK 捕捉 | 並行 DELETE 情境 |
| G19-G24 | ACL 六格(見 7.3) | 各自 |

**每格拿掉一次、各紅在指定斷言;基準線先驗證為綠才跑突變**(memory:S3b-1 踩過「基準線本來就紅」整輪作廢)。

### 7.2 行為(**[24][25][26]**)

1. 十二碼**各一條**行為測試。
2. **[24]** `APPENDED` 逐欄驗(body / author / channel / occurred_at / created_at / corrects_note_id);**其餘十一碼各斷言 `order_notes` 與 `admin_audit_log` 列數皆零增**。
3. **[25]** 配對規則**四向**:internal 帶 channel / internal 帶 occurred_at / 非 internal 缺 channel / 非 internal 缺 occurred_at。
4. **[26]** `scripts/a6-verify.sh` 釘**預期案例數**、**0 SKIP**、且 fixture order 存在性先 fail-closed 斷言。

### 7.3 結構與 ACL(**[19][20]**)

5. SECURITY DEFINER / `search_path=public, pg_temp` / 簽章逐字 / `proacl IS NOT NULL` **前置** / **owner = `order_notes` 表 owner** / owner 對 `admin_audit_log` 有 INSERT。
6. 函式 ACL 恰 `service_role:EXECUTE:**is_grantable=false**`;**PUBLIC / anon / authenticated 零授權**。
7. `order_notes` 表級 ACL **完整 allowlist 比對**(非只查 `service_role=r`)+ 欄級 ACL=0 + **RLS on** + **zero policy**。
8. **[17]** apply 外殼的 `lock_timeout` / `statement_timeout` 存在性。
9. **[18]** `COMMENT ON FUNCTION` 存在且含固定碼清單。

### 7.4 誠實驗收(**[28][29][30]** — 這三條不得單獨當守門證據)

10. 「從零套用成功」只證明可執行;「三綠」不讀 SQL 行為;「審查已跑」是流程證據。
    ⇒ **三者皆列為必要條件,明文標示各自的判別力為零**,承重的是 7.1-7.3。

### 7.5 apply(**[21]** DoD 拆兩段)

- **code-DoD**(本片 commit 前):7.1-7.4 全綠 + 關卡1 R2 GO + 關卡2 + 三綠。
- **apply-DoD**(**Sean 批准後另行執行**):`db push` → ledger read-back → **type re-gen + §6-R6 三處手動校正** → typecheck 實際重編。
  🔴 **A6 的 commit 不以 apply 為前提**;未 apply 前 A9a-1 / A9d2 不得開工(typed `.rpc()` 會型別紅)。

---

## §8 rollback(**[31][32]**)

- 🔴 **[31] 更正 v1 的錯誤宣稱**:「零資料影響」只在 `order_notes` **仍為 0 列時**成立。
  A6 的用途就是持續 INSERT ⇒ **員工開始寫備註之後,DROP 函式不會回到 A6 前的狀態**:
  既有列、以及它們對 `orders` 的 `ON DELETE RESTRICT` 引用**都會留著**(會擋住刪單)。
  ⇒ 正確說法 = **「migration 可逆,營運效果不可逆」**。
- **[32]** rollback 走**另立較新的 down migration**(不改已 apply 的檔),且**撤除順序固定**:
  `A10a → A9d2 → A9a-1 → 最後才 DROP A6`。先 DROP 會讓線上 action 呼叫不存在的 RPC。

---

## §9 偵察 pass(檔案:行號)

- A3 契約:`20260729030000_m4b_e10_a3_order_notes.sql:21-27 / 88-99 / 100-105 / 150-195`
- 樣板:`20260801160000_m4b_e10_s2_admin_upsert_supplier.sql:84-87 / 137-179 / 302-311 / 365-391 / 447-458`
- 母 plan:`2026-07-28-e10-order-closure-master-plan-v2.md:385(A9a) / 389(A9d2) / 716(U6 稽核)`
- 既有稽核合約:`2026-07-25-admin-backend-rebuild-spec.md:373-376`(§2.3-2「所有新後台寫入照抄」)
- 明細投影守門:`packages/adapters/src/supabase/SupabaseOrderAdapter.test.ts:636-640`
- memory:`project_m4b-notes-line-decisions` / `feedback_assert-scope-only-after-reading-source-file` /
  `feedback_null-dispatch-rpc-silently-downgrades` / `feedback_run-full-vitest-after-shared-component-change` /
  `reference_supabase-service-role-execute-default-grant`
- **graphify 連動面**:動手前跑,結果補進本節。

---

## §10 Sean 拍板

- **線** = A(備註線),未採採購線 7 片 / 只做守門 trigger / 另指定。
- **Q1 = A 寫同交易 `admin_audit_log`**(🔴 **重問後的答案**;第一次答 A「不寫」是根據我錯誤的 append-only 論證)。
- **Q2 = A 一片一片來** —— 每片收工停下回報,Sean 確認再往下。**不得自行併片。**
- **模型/機制** = A 主模型維持 Opus + 上機制(未採換 Fable)。

## §11 R1 折入對照

35 條全折(27 must-fix + 8 nit),駁回 **0**。逐條落點見 §0 表與各節標註的 `[編號]`。
親驗 6 條(`[1][4][5][6][10][23][33]`)—— 全部開原始檔逐字確認成立。
