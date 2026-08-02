# M-4b E10 備註線 plan **v4** — `A6 → A9a-1 → A9d2-1 → A10a`

> **狀態:關卡1 R1 / R2(codex)= NO-GO 已折入 v2/v3;R3(換模型 Fable)= NO-GO 6 must-fix + 4 nit,已折入本版 v4(§0.6),待 R4 確認輪。零行 code、零 migration。**
> 依據 = Sean 2026-08-02 拍板 A(線)+ Q1=**A 寫同交易稽核**(重問後)+ Q2=A 一片一片來。
> R1 findings 逐字 = `docs/reviews/2026-08-02-e10-a6-k1-codex.md`;R2 = `…-k1r2-codex.md`。
> 母 plan = `docs/specs/2026-07-28-e10-order-closure-master-plan-v2.md` row 33(A6)/ 38(A9a)/ **42(A9d2)** / 56(A10a)。

---

## §0 v1 → v2 的四個結構性更正(來自 R1;R2 折入稽核判定其中 9 條為假修,重做見 §0.5)

| # | v1 錯在哪 | v2 |
|---|---|---|
| **[1]** | 說這條線 **3 片**,漏掉 `A9d2`(server actions) | 4 片;寫入呼叫端是 A9d2 不是 A10a(v3 再更正為 **A9d2-1**,見 [49]) |
| **[2]** | 把「只做 notes 投影」叫 A9a,而母 plan `:385` 的 A9a = **notes + procurement** | 改名 **A9a-1**;`A9a-2` 明文留給採購線,片號不重用 |
| **[4][5][6]** | 「`order_notes` 無 `updated_at` ⇒ append-only 由形狀保證 ⇒ 自己就是稽核帳本」 | **這句話是錯的**,見 §3.1;Q1 已重問、Sean 改拍 **A =寫同交易稽核** |
| **[10][11][23]** | 完全沒接到 A3 指名交給 A6 的三條契約債 | 全數進 §4.2 規格與 §7 驗收 |

🔴 v1 那句 append-only 錯話曾成為 Sean Q1 拍板的前提 ⇒ 已重問並重拍。
病根與機制 = memory `feedback_assert-scope-only-after-reading-source-file`(CLAUDE.md 自檢清單已加一條)。

## §0.5 v2 → v3:R2 的 9 條假修重做 + 23 條新 findings 落點

**假修重做(重做 = 換修法,不是在被點名那行加字):**

| # | v2 假修在哪(R2 判定) | v3 真修 |
|---|---|---|
| **[8]** | request_id 只寫進另一張表,無冪等、無 note 關聯 | 🆕 固定碼 `DUPLICATE_REQUEST`(§4.2 步11)+ audit `after` 記 `note_id`(§4.3);誠實邊界:跨單併發重送不擋(§4.3) |
| **[9]** | 自稱「完整約束」仍漏 PK/default/created_at | §3.3 改為**建表檔 `:41-158` 逐條轉錄**,含 PK/default/NOT NULL/索引,並區分 constraint 與 partial unique index |
| **[12]** | 十二碼非窮盡,合法輸入落到 raw exception | §4.2 改為**逐參數值域切割的全域映射**;🆕 `OCCURRED_AT_OUT_OF_RANGE`;RAISE 面明文限縮為 actor/request_id 兩參數;residual DB error 逐條附「經 RPC 不可達」論證(§4.2.1) |
| **[13]** | 步8 內「跨單且已被更正」無子序 | §4.2 步12 子序明文:同單查無(含跨單)→ `CORRECTS_NOT_FOUND` **先於** `ALREADY_CORRECTED`;附對抗向量(manifest C 區子序格) |
| **[16]** | 「上限」無數值無單位 = 無 oracle | `BODY_TOO_LONG` = `char_length(p_body) > 4000`(Unicode 碼位、量原文、零寬字計入);邊界向量 4000/4001(§4.2 步9) |
| **[19]** | 表 ACL 只寫「完整 allowlist」無逐字 | §7.3 逐字釘:表 relacl 攤平恰 `service_role:SELECT:is_grantable=false` 一列、其餘全零(含 [53]) |
| **[23]** | 只禁多列 VALUES/INSERT SELECT,堵不住兩句單列/迴圈/動態 SQL | 結構面改**計數**(兩表 INSERT 各恰 1 次出現 + 零 EXECUTE/LOOP/多列 VALUES/INSERT…SELECT)+ **承重改行為面**:APPENDED 兩表各**恰 +1**(manifest E 區 + D-1);環不可達論證見 §4.4 |
| **[24]** | 沒逐字要求成功時兩表各恰 +1 | §7.2-2 改「**恰好 +1**」逐字;失敗 13 碼兩表**恰 +0** |
| **[27]** | G1-G24 合併重複、無逐格突變 | §7.1 重建為 **61 格有限互斥 manifest**(8 分區,每格 = 一守門 = 一突變 = 一指定紅點;含 [44][45][47][48]) |

**新增 23 條落點**:[36]→§4.2(OUT_OF_RANGE)/ [37]→§4.2 步12 / [38]→§4.4-4(死守門移除)/ [39]→§4.2 步10(FOR UPDATE 序列化)/ [40]→§4.3(audit 失敗必整筆 rollback + 負測 D-7)/ [41]→§4.3(body_sha256)/ [42]→§4.3(note_id + DUPLICATE_REQUEST)/ [43]→同[16] / [44][45]→§7.1 C 區 / [46]→§7.1 E 區 / [47]→§7.1 D 區 / [48]→§7.1 B 區七碼位 / [49]→全文改 A9d2-1 / [50]→§5(mapper 集合運算)/ [51]→§5(排序合約)/ [52]→§4.3(ACL 理由更正)/ [53]→§7.3 / [54]→§3.3 / [55][56]→§9 / [57]→§7.5(十處校正)/ [58]→§11(親驗 7 條)。

## §0.6 v3 → v4:R3(Fable 換模型換角度)10 條落點(6 must-fix + 4 nit,親驗五處行號、駁回 0)

| F# | 缺陷 | v4 修法 |
|---|---|---|
| **F1** must-fix | §4.2.1 對 `author_nonempty` 的「不可達」是假的:步 1 不驗 slug regex ⇒ 大寫或 65-200 字元 actor 通過步 1、撞 raw `23514`(staff 表 `20260726120000:21` 同 regex 只護 A9d2-1 路徑,不護 RPC 契約) | §4.2 步 1 加 `~ '^[a-z0-9_]{1,64}$'`(RAISE 面,鏡像 `:111-112`);§4.2.1 該列改寫;manifest 🆕 I 區 1 格 |
| **F2** must-fix | 步 11 新增 owner 對 audit 的 **SELECT** 依賴,F 區只驗 INSERT ⇒ audit owner 漂移時 migration 全綠、正式站每呼叫炸 42501 | §7.3-5 改「owner 對 audit 有 **SELECT + INSERT**」;F 區 +1 格 |
| **F3** must-fix | `DUPLICATE_REQUEST` 是唯一「其實已成功」的碼;無 14 碼→員工語意映射 ⇒ 顯示成錯誤會誘發員工換 request_id 重送 = 冪等設計反而製造重複備註 | §5 A9d2-1 加三類映射;`DUPLICATE_REQUEST` **按成功處理**(PRG 同結果頁) |
| **F4** must-fix | D-⑧ 一格捆 13 條「恰 +0」,突變記帳不明 ⇒ 12 條斷言判別力未證 | §7.1 明文:D-⑧ 突變**逐 13 碼各做一次**;格數(守門數)與突變總數分開記帳 |
| **F5** must-fix | 三 role 零授權格構造不出只紅它的突變 —— 任何 GRANT 同時讓函式 ACL 攤平格轉紅(樣板 `:384-385` 自承 5e 是縱深) | 該格明文標**縱深、紅點歸屬函式 ACL 格**(v4 編號 F-⑥→F-⑤);「每格一專屬紅點」宣稱同步修正 |
| **F6** must-fix | A10a 沒列更正的 UI 入口與啟用規則 ⇒ R1 [7] 只修了 RPC 半邊,能力仍不可達;或有鈕但不 disable 已更正列 → 員工日常撞 `ALREADY_CORRECTED` 死路 | §5 A10a 明列:每列更正入口 / 已被更正列 disable + 標示 / 「不可撤回」出現在**送出前** confirm |
| **F7** nit | `> now()` 零時鐘容忍 ⇒ 裝置時鐘快 1-2 分,選「現在」被拒 | 步 7 改 `> now() + interval '5 minutes'` 寬限(5 分鐘不構成「未來假證據」窗) |
| **F8** nit | H 區 3 格只給 2 個突變 | 「釘總案例數」格突變 = 拿掉一條案例 → 數字閘紅 |
| **F9** nit | mapper 等價的隱含前提「投影回**全部** notes」未成驗收;PostgREST max-rows 截斷未確認 | §5 A9a-1 加誠實邊界 + 驗收一條:實測 embed 列數上限並記錄 |
| **F10** nit | R7 鎖序論證的舊前提(`20260624120006:15-16`「全庫唯一 orders FOR UPDATE 持有者」)已過時(`20260714130000:113` / `20260716130000:268` 亦鎖)| §6 R7 改列完整持有者清單;A6 migration 檔頭寫正確清單;舊檔不改(已 apply),過時敘述登記為文件債 |

---

## §1 線的組成(4 片,Q2=A:每片收工停下回報再往下)

```
A6 (R, 高風險)  → A9a-1 (A) → A9d2-1 (A, 高風險) → A10a (U, 需肉眼)
owner RPC          notes 讀模型    note server action    明細頁時間軸 + U6
```

**目標** = 27 項驗收第 **3** 項「訂單寫備註」🟡 → ✅(7/26 以來第一項轉綠)。
🔴 **[3] 更正**:只有 **A9a-2**(procurement 投影)與 A10b 屬採購線;A10a 不是採購線的必經工作。
🔴 **[49] 更正**:母 plan `:389` row 42 的 A9d2 = **note + cancel 兩支 action**。本線只做 note 那支
⇒ 片號改 **A9d2-1**;**A9d2-2(cancel action)明文留給取消線,片號不重用、本線收工不得宣稱 A9d2 完成**。
母 plan row 42 的拆分註記列為本線收工 DoD(同 [2] 的處理方式)。

---

## §2 分級與片型

| 片 | L | 片型 | 鐵則 8 | 鐵則 12 |
|---|---|---|---|---|
| **A6** | L1 | **高風險** | ✅ 動 API | ✅ **②權限 + ③DB 結構** ⇒ 關卡1 + 關卡2 |
| **A9a-1** | L1 | 標準片 | ⚠️ 動 `packages/adapters` 共用投影 ⇒ 併本 plan 批 | ❌ 六類逐條不觸發 |
| **A9d2-1** | L1 | **高風險** | ✅ | ✅ **命中②權限**(server action = 授權邊界)⇒ 關卡2 必跑 |
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
⇒ **這正是 Q1=A(寫同交易 `admin_audit_log`)的真正理由**:兩張表分開才需要兩次竄改。
⚠️ 仍不得說滿:owner 同樣能改 `admin_audit_log`。稽核降低的是**單點竄改**,不是「不可竄改」。
🆕 **[41]**:「兩表竄改」宣稱要成立,audit 必須記**內容指紋**而不只長度(同長度替換只動一表即無痕)⇒ §4.3 記 `body_sha256`。

### 3.2 A3 指名交給 A6 的三條契約債

| # | 出處 | 交辦 |
|---|---|---|
| **D1** | `:102-104` | 「不得晚於現在」**擋不進 CHECK**(`now()` 非 IMMUTABLE)⇒ A6 owner RPC 的責任。CHECK 只擋 infinity 與界外年份(`:106-109`) |
| **D2** | `:90-100` | body **不宣稱窮盡**:`U+2800` / `U+3164` / `U+00AD` 既不在 translate 清單也不屬 `[[:space:]]` ⇒ 照樣入得了庫;最後一道歸 **A6 writer(正規化 + 拒收)** |
| **D3** | `:186-196` | 更正鏈可以成環(單一多列 `INSERT…VALUES` 兩列互指,FK 於 statement 結束才驗)⇒ **A6 一次只准 INSERT 一列**必須寫成驗收條件(v3 修法見 §4.4-1) |

### 3.3 完整約束清單(**[9][54] 重做**:建表檔 `:41-158` 逐條轉錄;「約束」與「索引」分列)

**欄位與行內預設**(`:41-68`):

| 欄 | 定義 | 行號 |
|---|---|---|
| `id` | `uuid PRIMARY KEY DEFAULT gen_random_uuid()` | `:42` |
| `order_id` | `uuid NOT NULL REFERENCES orders(id) ON DELETE RESTRICT` | `:50` |
| `note_type` / `body` | `text NOT NULL` | `:52-53` |
| `channel` / `occurred_at` | nullable(配對規則管) | `:56-57` |
| `author` | `text NOT NULL` | `:62` |
| `corrects_note_id` | `uuid` nullable | `:66` |
| `created_at` | `timestamptz NOT NULL DEFAULT now()` | `:68` |

**表級約束**(`:72-131`):

```
order_notes_id_order_id_key        UNIQUE (id, order_id)                        :72
order_notes_corrects_same_order_fk FK (corrects_note_id, order_id)
                                   → (id, order_id) ON DELETE RESTRICT          :79-81
order_notes_corrects_not_self      CHECK (corrects_note_id IS DISTINCT FROM id) :84-85
order_notes_type_check             note_type ∈ {internal, contact_log,
                                   customer_notified}                            :87-88
order_notes_body_nonempty          translate(body, 200B/200C/200D/FEFF,'')
                                   ~ '[^[:space:]]'                              :99-100
order_notes_occurred_at_sane       NULL 或 (> 2020-01-01 AND < 2100-01-01)      :105-109
order_notes_author_nonempty        author ~ '^[a-z0-9_]{1,64}$'                  :111-112
order_notes_contact_fields_required 非 internal ⇒ channel 與 occurred_at NOT NULL :116-120
order_notes_internal_fields_absent internal ⇒ 兩者皆 NULL                        :123-127
order_notes_channel_check          channel NULL 或 ∈ 五值                        :129-130
```

**索引**(`:146-158`;partial unique 是 **index 不是 constraint**,[54]):

```
order_notes_order_id_created_at_idx  (order_id, created_at DESC)                :146-147
order_notes_notified_idx             partial WHERE note_type='customer_notified' :150-152
order_notes_corrects_note_id_key     UNIQUE INDEX (corrects_note_id)
                                     WHERE NOT NULL ⇒ 一筆最多被更正一次         :156-158
```

### 3.4 U6 告知義務的查詢合約(`:160-196`,**[34][35]** 來源)

- **不得**寫 `EXISTS(… note_type='customer_notified')`;正確語意 = 排除「已被直接指向」的列
  (SQL 形狀 `:164-169`;A9a-1 的 mapper 等價實作見 §5)。
- 🔴 負測必須兩個方向:更正前斷言算 **1**、更正後才斷言算 **0**(`:176-177`;A3 探針自己犯過只測後者)。
- 🔴 **更正不可撤回**(`:179-184`):`A ← B ← C` 裡 C 更正 B 不會讓 A 復活;唯一正解 = 重登一筆新的
  `customer_notified`。**這句要進 A10a 的 UI 文案。**
- 時間軸:被指向的列標成「已更正」,不是不顯示(`:171-172`)。

---

## §4 A6 規格(v4)

檔 = `supabase/migrations/<ts>_m4b_e10_a6_admin_append_order_note.sql`
形狀樣板 = `20260801160000_m4b_e10_s2_admin_upsert_supplier.sql`。

### 4.1 簽章與交易外殼

```
admin_append_order_note(
  p_order_id uuid, p_note_type text, p_body text,
  p_channel text, p_occurred_at timestamptz,
  p_corrects_note_id uuid,
  p_actor text, p_request_id text
) RETURNS text
```
- **[17]** 檔案外殼照樣板:`BEGIN` / `SET LOCAL lock_timeout='5s'` / `SET LOCAL statement_timeout` / `COMMIT`,進 §7 驗收(G 區)。
- **[18]** `COMMENT ON FUNCTION` 合約(固定碼、權限、輸入語意、誠實邊界)列為產物與驗收(G 區)。

### 4.2 輸入守門(**[12][13][36][37][39] 重做**:全域映射 + 明文全序)

**檢查一律照下列順序,先命中先回傳;順序本身是驗收對象**(manifest C 區:相鄰對逐對突變):

| 步 | 檢查 | 命中 → 回傳 |
|---|---|---|
| 1 | `actor` / `request_id`:先剝空白 → 非空 → 長度 ≤200 → 零控制字元(照樣板 `:137-179`,**先剝後驗**);🆕 **F1**:`v_actor` 另須 `~ '^[a-z0-9_]{1,64}$'`(鏡像 `author_nonempty` `:111-112`;staff 表同 regex 只護 A9d2-1 路徑、不護 RPC 契約) | **RAISE**(caller-bug 面,非固定碼;本 RPC 唯二的 RAISE 參數) |
| 2 | `p_order_id IS NULL` | `INVALID_INPUT` |
| 3 | `p_note_type` NULL 或不在三值 | `INVALID_TYPE` |
| 4 | `p_channel` 非 NULL 且不在五值 | `INVALID_CHANNEL` |
| 5 | 配對規則:internal 帶任一 → `INTERNAL_FIELDS_FORBIDDEN`;非 internal 缺任一 → `CONTACT_FIELDS_REQUIRED` | 左列 |
| 6 | 🆕 **[36]** `p_occurred_at` 非 NULL 且 NOT(`> 2020-01-01` AND `< 2100-01-01`)(鏡像 `:106-109`,含 ±infinity) | `OCCURRED_AT_OUT_OF_RANGE` |
| 7 | **D1** `p_occurred_at > now() + interval '5 minutes'`(🆕 **F7** 時鐘寬限:裝置時鐘偏移不該拒掉「現在」;5 分鐘不構成「未來假證據」窗) | `OCCURRED_AT_IN_FUTURE` |
| 8 | **D2** `p_body` NULL 或正規化後為空(正規化定義見下) | `INVALID_BODY` |
| 9 | **[16][43]** `pg_catalog.char_length(p_body) > 4000` | `BODY_TOO_LONG` |
| 10 | 🆕 **[39]** 鎖單:`SELECT 1 FROM orders WHERE id = p_order_id FOR UPDATE`(**FOR UPDATE 非 FOR SHARE**:同單 append 全序列化,是步 11/12 pre-check 免競態的前提)→ 查無 | `ORDER_NOT_FOUND` |
| 11 | 🆕 **[8][42]** `EXISTS(SELECT 1 FROM admin_audit_log WHERE action='order_note.append' AND request_id = v_req)`(走既有索引 `20260712210000:78`;owner 可讀該表 —— `:85` 的 REVOKE 清單不含 owner) | `DUPLICATE_REQUEST` |
| 12 | `p_corrects_note_id` 非 NULL 時,子序 **[13][37]**:①`SELECT … FROM order_notes WHERE id = p_corrects AND order_id = p_order_id` 查無(**不存在與跨單同碼** —— 查詢自帶 order_id 條件,跨單天然查無)→ `CORRECTS_NOT_FOUND`;②已被更正(`EXISTS(corrects_note_id = p_corrects)`)→ `ALREADY_CORRECTED` | 左列 |
| 13 | **單列 INSERT**(§4.4)+ 同交易 audit INSERT(§4.3) | `APPENDED` |

**回傳碼全集 = 14 碼**([12] 窮盡):
`APPENDED / ORDER_NOT_FOUND / INVALID_INPUT / INVALID_TYPE / INVALID_CHANNEL /
CONTACT_FIELDS_REQUIRED / INTERNAL_FIELDS_FORBIDDEN / OCCURRED_AT_OUT_OF_RANGE /
OCCURRED_AT_IN_FUTURE / INVALID_BODY / BODY_TOO_LONG / DUPLICATE_REQUEST /
CORRECTS_NOT_FOUND / ALREADY_CORRECTED`

**BODY_TOO_LONG 的 oracle**([16][43]):上限 = **4000**,單位 = **Unicode 碼位**(`char_length` 語意、非 byte),
量測對象 = **原文 `p_body`**(零寬字計入)。邊界向量:4000 → 通過;4001 → `BODY_TOO_LONG`。
量級依據:LINE 單則訊息上限 5000 字,4000 夠貼整段聯絡摘要;此值是輸入衛生上限、非業務規則,實作不繞 Sean。

**D2 正規化定義**:剝 `[[:space:]]` + `U+200B/200C/200D/FEFF` + `U+2800/U+3164/U+00AD` 後判空
(**[48]**:四種零寬也必須是 A6 自己的清單,不能只靠 DB CHECK —— A6 漏掉它們時錯誤會從 `INVALID_BODY`
降級成 raw `23514`,manifest B 區逐碼位釘住);**入庫存原文**(顯示保真),判空用正規化後的值。

### 4.2.1 窮盡論證與 residual DB error([12] 重做的證明義務)

逐參數值域切割:`p_order_id`(NULL→2;查無→10;存在→續)、`p_note_type`(NULL/界外→3;三值→續)、
`p_channel`(界外→4;NULL/五值→5 配對)、`p_occurred_at`(NULL→5 配對;界外→6;未來→7;合法→續)、
`p_body`(NULL/全空白→8;>4000→9;合法→續)、`p_corrects_note_id`(NULL→跳過;非 NULL→12)、
`p_actor`/`p_request_id`(→1 RAISE)。⇒ **任一輸入組合必落在 14 碼或步 1 RAISE,無第三種出口。**

**residual DB constraint 逐條「經 RPC 不可達」論證**(縱深、不捕捉、裸拋 = bug 訊號):

| DB 約束 | 不可達理由 |
|---|---|
| `order_notes_type_check` / `channel_check` / `body_nonempty` / `occurred_at_sane` / 配對兩條 | 步 3-9 先攔;A6 清單 ⊇ DB 清單 |
| `author_nonempty`(`:111-112`) | 🆕 **F1 重做**:步 1 的 slug regex 逐字鏡像該 CHECK(v3 原論證只靠「非空+≤200+零控制字元」**不蘊含** regex,是假的);manifest I 區釘住 |
| `order_id` FK 23503 | 步 10 FOR UPDATE 已鎖住存在的單;RESTRICT + 列鎖使並行 DELETE 必等待且事後失敗(見 §4.4-4) |
| corrects 複合 FK 23503 | 步 12① 同單存在檢查在鎖內,同單寫入已序列化 |
| partial unique 23505 | 步 12② 在鎖內且 corrects 目標必同單(複合 FK)⇒ 併發更正被步 10 序列化(**[39] 的修法**) |
| `corrects_not_self` | 新列 id 由 `gen_random_uuid()` 生成,與既有 id 碰撞機率忽略;縱深 |

### 4.3 同交易稽核(Q1=A;**[40][41][42][47][52] 重做**)

寫 `admin_audit_log`(欄位合約 `20260712210000:43-62`):
`actor=v_actor` / `action='order_note.append'` / `target='order:<id>'` / `before=NULL` /
`after` = **`note_id`(🆕[42])** / `note_type` / `channel` / `occurred_at` / `corrects_note_id` /
**`body_sha256`(🆕[41]:`encode(sha256(convert_to(body,'UTF8')),'hex')`)** / `body_length` /
`request_id=v_req` / `source_app='admin'`。

- **[40] audit INSERT 不得包在任何 EXCEPTION handler 內**:失敗必往上拋 ⇒ 整筆 rollback,note 不落地。
  負測(manifest D-7):harness 對 audit 表加 `CHECK (action <> 'order_note.append') NOT VALID` 暫時約束
  → 呼叫 RPC → 斷言炸 + `order_notes` 恰 +0 → 撤約束。
- **[41]** 不記 body 全文、記 sha256+length:同長度替換只改 `order_notes` 一表即 hash 不符 = 可證。
  誠實邊界:偵測仍需有人比對(稽核檢視器未來 slice),本片提供的是**可比對的證據**、非自動告警。
- **[52] 不記全文的理由更正**:audit 對 service_role 現況**只有 INSERT、無 SELECT**(`20260712210000:85-89`,
  SELECT 留給未來稽核檢視器 slice 顯式 GRANT)⇒ 真正的理由是 **PII 最小化 + 未來讀取面會開**
  (檢視器上線後全文會曝露給該表全部讀者),不是「ACL 較鬆」。
- **[8][42] 冪等的誠實邊界**:`DUPLICATE_REQUEST`(步 11)在**同單**重送下是免競態的(步 10 序列化);
  **跨單併發重送不擋**(兩張單鎖不同列;audit 表無 `(action, request_id)` unique —— 加它要動已 apply
  共用表 = 另一片的決定)。量級 100-300 單/月 + 呼叫端 request_id 對單生成 ⇒ 登記為已知洞、非忽略。

### 4.4 單列紀律與刻意不做

1. **D3 / [23][46] 重做**:結構斷言改**計數** —— 函式本體 `INSERT INTO public.order_notes` **恰 1 次**出現、
   `INSERT INTO public.admin_audit_log` 恰 1 次、零 `EXECUTE`(動態 SQL)、零 `LOOP`、零多列 VALUES、
   零 `INSERT…SELECT`(manifest E 區)。**承重的是行為面**:`APPENDED` ⇒ 兩表各**恰 +1**(D-1;
   文字層擋不住所有變體,memory `feedback_text-level-tests-cannot-catch-runtime-wiring`)。
   **環不可達論證**:成環需單一 statement 插 ≥2 互指列(`:186-196`);序列單列 INSERT 下
   `a←b` 與 `b←a` 必有一筆在對方不存在時送出 → FK 23503 ⇒ 恰-1-INSERT 紀律成立即環不可達。
2. **不做刪除 / UPDATE** —— 唯一寫入動作是單列 INSERT。
3. **不加 append-only trigger** —— 屬 T 型片(A3 `:24`),owner 可停用它 ⇒ 真正的縱深是 §4.3 兩表分離。明文登記為未關閉的洞。
4. 🆕 **[38] 死守門移除**:v2 的「具名 FK catch 映射 `ORDER_NOT_FOUND`」**刪除** —— 步 10 FOR UPDATE 之後,
   並行 DELETE 只能等待、且 commit 後撞 RESTRICT 失敗的是 DELETE 不是本 INSERT ⇒ 該 catch 靜態不可達,
   拿掉不會轉紅 = 死 guard(memory `feedback_unconstructible-negative-test-means-noop-guard`)。
   23503 一律裸拋(§4.2.1 已證不可達,拋出即 bug 訊號)。
5. **不解決 owner/superuser 竄改** —— 物理上做不到(§3.1)。

---

## §5 A9a-1 / A9d2-1 / A10a

- **A9a-1** — `packages/adapters/src/supabase/SupabaseOrderAdapter.ts` 的 `ADMIN_ORDER_DETAIL_SELECT`(`:92`)
  加 notes 投影 + 型別 + mapper。
  🔴 **[50] 重做:U6 語意搬到 mapper 做集合運算,不進 PostgREST 投影** —— PostgREST 不支援投影內
  `NOT EXISTS` 子查詢(塞進去 runtime 400)、也不開 view/RPC(零 migration)。實作:投影帶 raw notes 欄
  (id / note_type / body / channel / occurred_at / author / corrects_note_id / created_at),mapper 端
  `correctedIds = Set(notes.map(n => n.corrects_note_id).filter(Boolean))`,
  `notified = notes.some(n => n.note_type === 'customer_notified' && !correctedIds.has(n.id))`
  —— 與 §3.4 SQL 形狀**語意等價**(都只排除「被直接指向」的列);SQL 形狀合約保留給未來 SQL 端消費者(母 plan `:716`)。
  🔴 **[34]** 驗收含**雙向**負測(更正前算 1 / 更正後算 0),打在 mapper 測試層。
  🔴 **[51] 排序合約**:mapper 輸出依 `created_at` **ASC**、同時間 tie-break `id` 字典序(PostgREST 內嵌列
  順序不保證);同時間向量進驗收。
  🔴 明細投影 byte-equal 守門在 `SupabaseOrderAdapter.test.ts:636-640`(**[33]**;`:249-260` 是列表投影)。
  🆕 **F9 誠實邊界**:mapper 等價的隱含前提 = 投影回該單**全部** notes;PostgREST max-rows 是否截斷
  embedded rows **未確認** ⇒ A9a-1 驗收加一條:實測 embed 列數上限並記錄(截斷會讓 U6 `notified` 靜默算錯)。
  🔴 **[2]** 本片不宣稱 A9a 完成;A9a-2 明文留給採購線。
- **A9d2-1** — note server action(高風險:授權邊界)。照 `staff-actions.ts` / `supplier-actions.ts` 形狀:
  授權閘 → 純解析器 → repository → PRG。**必須斷言回傳碼 ∈ 14 碼全集**,收到未知碼當呼叫端 bug
  (memory `feedback_null-dispatch-rpc-silently-downgrades`)。**[49]**:cancel action = A9d2-2,不在本線。
  🆕 **F3:14 碼→員工語意三類映射(本片產物,逐碼列表)**:
  ①**成功型**:`APPENDED`、**`DUPLICATE_REQUEST`(按成功處理 —— 它意謂「這個請求已寫入過」,
  PRG 導向與 APPENDED 同一結果頁;顯示成錯誤會誘發員工換 request_id 重送 = 冪等設計反而製造重複備註)**
  ②**可改輸入型**(顯示欄位級提示):`INVALID_TYPE / INVALID_CHANNEL / CONTACT_FIELDS_REQUIRED /
  INTERNAL_FIELDS_FORBIDDEN / OCCURRED_AT_OUT_OF_RANGE / OCCURRED_AT_IN_FUTURE / INVALID_BODY /
  BODY_TOO_LONG / ALREADY_CORRECTED`(附「已有人先更正」語意)③**呼叫端 bug 型**(叫員工停手,
  同 supplier `r=bug` 慣例):`INVALID_INPUT / ORDER_NOT_FOUND / CORRECTS_NOT_FOUND`(表單流程下不該出現)。
- **A10a** — `apps/admin/src/app/orders/[id]/page.tsx`(現 76 行)+ 新元件。時間軸 + U6 結構化欄位;
  🔴 **[35]** 必含「**更正不可撤回**」文案 + 走鏈帶 **visited 集合與深度上限**(環是實測可達的,不得假設鏈會終止)。
  🆕 **F6:更正的 UI 入口與啟用規則(缺了它,R1 [7] 只修了 RPC 半邊、能力仍不可達)**:
  ①每列提供「更正」入口 ②**已被更正的列 disable 該入口**並標示「已更正」(否則員工日常撞
  `ALREADY_CORRECTED` 死路 —— partial unique `:156-158` 一筆只能被更正一次)
  ③「不可撤回」文案出現在**送出前 confirm**,不只時間軸。

---

## §6 風險

| # | 風險 | 處置 |
|---|---|---|
| R1 | owner / superuser 可改 `order_notes` **與** `admin_audit_log` | §3.1;稽核降低單點竄改、非不可竄改。不得對外說「備註不可竄改」 |
| R2 | A9a-1 動共用 adapter | 純加法、不碰 list 投影與 storefront;收工跑**完整** `pnpm test` |
| R3 | `author` 來自自選 picker cookie、非驗證身分(E8-B 未做) | 保證「有一個合法 author 字串」,非「那是真的操作者」 |
| R4 | 本機 `.env.local` 用 `SUPABASE_SECRET_KEY`、程式讀 `SUPABASE_SERVICE_ROLE_KEY` | A6 驗證走本機 PG17 從零 provision,不依賴 `.env.local` |
| R5 | **[21]** type re-gen 需 production apply 後 | DoD 拆兩段,見 §7.5 |
| R6 | **[22][57]** re-gen 把 nullable 參數產成非 nullable、且沖掉既有校正 | 重 gen 後重貼 = 既有**七處**(口徑 = `database.types.ts:2-6` 檔頭)+ 本片新增 `p_channel` / `p_occurred_at` / `p_corrects_note_id` 三處 = **共十處**;檔頭口徑同步改十處,列為 apply-DoD 產物 |
| 🆕 R7 | 步 10 FOR UPDATE 與其他鎖 `orders` 列的 RPC 並發 | **F10 更正後的持有者清單**:`confirm_order_payment`(orders-only)/ markFailed(`20260624120006`,attempt→orders)/ 改單 workflow(`20260714130000:113`、`20260716130000:268`,orders first)/ A7c trigger(orders FOR SHARE→refunds,同向)。A6 = orders 單列→note 列(同向)⇒ 無反向鎖序、無環。🔴 舊檔 `20260624120006:15-16`「全庫唯一 orders FOR UPDATE 持有者」敘述**已過時**(已 apply、不改檔)⇒ A6 migration 檔頭寫**正確**清單,過時敘述登記為文件債 |

---

## §7 驗收條件

### 7.1 guard / mutant manifest(**[27][44][45][47][48] 重做 + F1/F2/F4/F5/F8 折入**:63 格、9 分區、有限互斥)

**格 = 守門;格數 = 63 為機器可數的加總(14+7+11+8+6+10+3+3+1)。突變另計 = 74**
(**F4**:D-⑧ 逐 13 碼各一個 = 13;**F5**:F-6 縱深格 0 個專屬;其餘 61 格各 1 個)。
**`a6-verify.sh` 釘死兩數,增減守門必先改本表。**
宣稱修正(**F5**):~~每格一專屬紅點~~ → **除 F-6(縱深,紅點歸 F-5)外,每格有專屬紅點**。

| 區 | 格 | 內容 | 突變 → 指定紅點 |
|---|---|---|---|
| **A 行為碼** | 14 | 14 碼各一條行為測試(每碼一個最小命中向量) | 拿掉該碼的檢查 → 該碼向量回錯結果(APPENDED 格 = 函式縮成無條件 `RETURN 'APPENDED'` → 逐欄驗轉紅,[28] 的反例即此格) |
| **B 正規化碼位** | 7 | `200B/200C/200D/FEFF/2800/3164/00AD` 各一「僅含該碼位」向量斷言 `INVALID_BODY` | 從 A6 清單移除該碼位 → 前四種紅在「錯誤降級成 raw 23514」、後三種紅在「回 APPENDED」([48]) |
| **C 順序** | 11 | §4.2 **檢查步 2→12**(11 個檢查)相鄰對 **10 格** + 步 12 子序 1 格([37]:跨單且已被更正 → `CORRECTS_NOT_FOUND`);每格一個**同時命中兩檢查**的向量,斷言前碼勝 | 交換該對順序 → 該向量回後碼([45]:全序逐對,非單一抽樣) |
| **D 稽核** | 8 | ①APPENDED 兩表各**恰 +1** ②action ③target ④after 必含 note_id+body_sha256+body_length+四欄([47])⑤request_id=剝後值 ⑥source_app ⑦**audit 失敗整筆 rollback**([40],NOT VALID 暫時約束負測)⑧13 失敗碼兩表**恰 +0**(**F4:突變逐 13 碼各做一次**,一格 13 突變) | ①拿掉 audit INSERT ②-⑥逐欄改錯值 ⑦包 EXCEPTION 吞掉 ⑧**逐碼**「先寫後回錯」→ 各自斷言紅 |
| **E 單列結構** | 6 | `INSERT INTO order_notes` 恰 1 次 / audit INSERT 恰 1 次 / 零多列 VALUES / 零 `INSERT…SELECT` / 零 `EXECUTE` / 零 `LOOP`([23][46]) | 各自違反 → 計數斷言紅(行為承重在 D-①) |
| **F ACL/結構** | 10 | ①`proacl IS NOT NULL` 前置 ②owner = `order_notes` 表 owner ③owner 對 audit 有 INSERT ④🆕 **F2:owner 對 audit 有 SELECT**(步 11 的新依賴;audit owner 漂移時缺它 = 正式站每呼叫 42501)⑤函式 ACL 恰 `service_role:EXECUTE:is_grantable=false` ⑥PUBLIC+anon+authenticated 零授權(**F5:縱深格、紅點歸 ⑤** —— 任何 GRANT 同時讓 ⑤ 攤平轉紅,樣板 `:384-385` 自承)⑦表 relacl 恰 `service_role:SELECT:is_grantable=false`([19][53])⑧欄級 attacl 全 NULL ⑨RLS on + 零 policy ⑩SECURITY DEFINER + `search_path=public, pg_temp` + 簽章逐字 | 各自破壞(GRANT 多授/OWNER TO/REVOKE SELECT/改 search_path…)→ 各自斷言紅(⑥除外) |
| **G 外殼** | 3 | `lock_timeout` / `statement_timeout` 存在([17])/ `COMMENT ON FUNCTION` 含 14 碼清單([18]) | 移除 → 存在性斷言紅 |
| **H harness 自檢** | 3 | 釘總案例數 / **0 SKIP** / fixture order 存在性 fail-closed([26]) | 拿掉一條案例 → 數字閘紅(**F8**)/ 加 skip → 0 SKIP 紅 / 清空 fixture → fail-closed 紅 |
| 🆕 **I RAISE 面** | 1 | **F1**:`v_actor` slug regex(鏡像 `author_nonempty` `:111-112`) | 拿掉 regex → 大寫 actor 向量紅在「錯誤類別由 RAISE 降級成 raw 23514」 |

**每格拿掉一次、各紅在指定斷言;基準線先驗證為綠才跑突變**(S3b-1 教訓);
還原用檔案備份非 `git checkout`,每格還原後比對備份(既有紀律)。

### 7.2 行為(**[24][25]**)

1. A 區 14 碼各一條(見 7.1)。
2. **[24]** `APPENDED` 逐欄驗(body 原文 / author=剝後 actor / channel / occurred_at / created_at / corrects_note_id)
   **且兩表各恰 +1**;其餘 13 碼**兩表各恰 +0**(逐字「恰」,非「≥」「零增」的模糊寫法)。
3. **[25]** 配對規則**四向**:internal 帶 channel / internal 帶 occurred_at / 非 internal 缺 channel / 非 internal 缺 occurred_at。
4. **[26]** `scripts/a6-verify.sh` 釘預期案例數、0 SKIP、fixture order 存在性先 fail-closed 斷言(H 區)。

### 7.3 結構與 ACL(F 區的逐字版,**[19][20][53]**)

5. SECURITY DEFINER / `search_path=public, pg_temp` / 簽章逐字 / `proacl IS NOT NULL` 前置 /
   owner = `order_notes` 表 owner / owner 對 `admin_audit_log` 有 **SELECT + INSERT**
   (樣板 `:346-363` / `:421-439`;SELECT 是 **F2**:步 11 dedup 查詢的新依賴,只驗 INSERT 會讓
   owner 漂移在 migration 全綠後才於正式站首呼叫炸 42501)。
6. 函式 ACL 攤平(含 `is_grantable`)恰 `service_role:EXECUTE:is_grantable=false` 一列;PUBLIC / anon / authenticated 零授權。
7. `order_notes` 表 relacl 攤平(含 `is_grantable`)恰 `service_role:SELECT:is_grantable=false` 一列、其餘 grantee 全零
   + 欄級 attacl 全 NULL + RLS on + 零 policy(逐字,與函式 ACL 同精度)。
8. **[17]** apply 外殼的 `lock_timeout` / `statement_timeout` 存在性。
9. **[18]** `COMMENT ON FUNCTION` 存在且含 14 碼清單。

### 7.4 誠實驗收(**[28][29][30]** — 這三條不得單獨當守門證據)

10. 「從零套用成功」只證明可執行;「三綠」不讀 SQL 行為;「審查已跑」是流程證據。
    三者皆列為必要條件、明文標示各自判別力為零;承重的是 7.1-7.3。

### 7.5 apply(**[21][57]** DoD 拆兩段)

- **code-DoD**(本片 commit 前):7.1-7.4 全綠 + 關卡1 GO + 關卡2 + 三綠。
- **apply-DoD**(**Sean 批准後另行執行**):`db push` → ledger read-back → type re-gen →
  **重貼共十處手動校正**(既有七處口徑 = `database.types.ts:2-6`;新三處 = §6-R6)→
  檔頭口徑改十處 → typecheck **實際重編** exit 0。
  🔴 A6 的 commit 不以 apply 為前提;未 apply 前 A9a-1 / A9d2-1 不得開工(typed `.rpc()` 會型別紅)。

---

## §8 rollback(**[31][32]**)

- 🔴 **[31]**:「零資料影響」只在 `order_notes` 仍為 0 列時成立。員工開始寫備註之後,DROP 函式不會回到
  A6 前的狀態(既有列 + `ON DELETE RESTRICT` 引用都會留著、會擋刪單)⇒ **「migration 可逆,營運效果不可逆」**。
- **[32]** rollback 走另立較新的 down migration(不改已 apply 檔),撤除順序固定:
  `A10a → A9d2-1 → A9a-1 → 最後才 DROP A6`。先 DROP 會讓線上 action 呼叫不存在的 RPC。

---

## §9 偵察 pass(檔案:行號;**[55][56] 補全**)

- A3 契約:`20260729030000_m4b_e10_a3_order_notes.sql` **`:21-27`(append-only)/ `:41-158`(全部欄位、約束、索引 —— §3.3 逐條轉錄的來源)/ `:90-100`(body)/ `:102-109`(occurred_at 含 CHECK 本體)/ `:111-131`(author、配對、channel)/ `:160-196`(U6 合約 + 成環)**
- 樣板:`20260801160000_m4b_e10_s2_admin_upsert_supplier.sql:84-87 / 137-179 / 302-311 / **346-363**(proacl 前置 + owner 對齊)/ 365-391 / **421-439**(audit 欄位 + owner INSERT 能力)/ 447-458`
- audit 表:`20260712210000_m4a_admin_audit_log.sql:43-62`(欄位與約束)/ `:78`(request_id 索引)/ `:82-89`(ACL:service_role 僅 INSERT)
- 母 plan:`2026-07-28-e10-order-closure-master-plan-v2.md:385(A9a) / 389(A9d2 = note+cancel 兩支) / 716(U6 稽核)`
- 既有稽核合約:`2026-07-25-admin-backend-rebuild-spec.md:373-376`
- 明細投影:`SupabaseOrderAdapter.ts:92`(投影常數)/ `SupabaseOrderAdapter.test.ts:636-640`(byte-equal 守門)
- 型別校正口徑:`packages/adapters/src/supabase/database.types.ts:2-6`
- memory:`project_m4b-notes-line-decisions` / `feedback_assert-scope-only-after-reading-source-file` /
  `feedback_null-dispatch-rpc-silently-downgrades` / `feedback_run-full-vitest-after-shared-component-change` /
  `reference_supabase-service-role-execute-default-grant` / `feedback_unconstructible-negative-test-means-noop-guard` /
  `feedback_text-level-tests-cannot-catch-runtime-wiring`
- **graphify 連動面**:動手前跑,結果補進本節。

---

## §10 Sean 拍板

- **線** = A(備註線),未採採購線 7 片 / 只做守門 trigger / 另指定。
- **Q1 = A 寫同交易 `admin_audit_log`**(🔴 重問後的答案;第一次答「不寫」是根據我錯誤的 append-only 論證)。
- **Q2 = A 一片一片來** —— 每片收工停下回報,Sean 確認再往下。不得自行併片。
- **模型/機制** = A 主模型維持 Opus + 上機制(未採換 Fable)。

## §11 折入紀錄

- **R1**:35 條全折(27 must-fix + 8 nit),駁回 0。親驗 **7 條**(`[1][4][5][6][10][23][33]`)—— 全部開原始檔逐字確認成立(**[58]** 更正:v2 誤寫 6 條)。
- **R2**:折入稽核 26 真修 / **9 假修全部重做**(§0.5 表);新增 23 條(18 must-fix + 5 nit)全折,駁回 0。
  v3 親驗 = 本輪全部引用行號逐一開檔核對(A3 `:41-158` / audit `:43-89` / 樣板三段 / adapter `:92,:319-331` / 母 plan `:389` / types `:1-30`)。
- **R3(Fable `adversarial-reviewer`,換模型換四角度:v3 修法自捅 / 員工可用性 / manifest 假綠面 / 假設審查)= NO-GO,6 must-fix + 4 nit,與 R1/R2 零重疊**。
  主對話親驗五處行號(staff `:21` / 舊鎖序檔頭 `:15-16` / `20260714130000:113` / `20260716130000:268` / 樣板 5e `:384-385`)全成立、其餘五條自 plan 文字與既讀內容核實 ⇒ **駁回 0,v4 折入 10/10**(§0.6)。
  R3 另核過未列 finding 的面:鎖序全 migration 掃描無環、C 區 10 相鄰對逐對可構造、B 區紅點歸屬正確、
  PostgREST embed 可行(orders←order_notes 單支 FK 無歧義)、audit request_id 索引形狀吻合;
  `sha256()` 與 `NOT VALID` enforce 標「官方文件、未實測」→ 本機 harness 首跑即驗。
- 判停條件對照:R3 未重複前輪、未同層打轉 ⇒ 續折正確。
- **R4 確認輪(Fable,同審查者續脈絡)= GO,0 must-fix**:逐條核 F1-F10 **10/10 真修**(親開 v4 現檔、非讀 §0.6 自述);
  機器覆算格數 63 / 突變數 74 與分區加總相符;v3→v4 diff 新洞掃描僅 1 條 nit(§4 標題版本標籤,已修)。
  ⇒ **關卡1 收斂(四輪獨立條目 = R1 35 + R2 新增 23 + R3 10 = 68,全折、駁回 0;R2 另判 R1 的 9 條為假修、已全部重做 —— 不重複計數)。零行 code、零 migration。**
