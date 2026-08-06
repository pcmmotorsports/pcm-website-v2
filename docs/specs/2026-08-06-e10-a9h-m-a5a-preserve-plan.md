# A9h-M — A5a 加 preserve 模式(migration 片)plan v2

> **狀態:關卡1 R1 NO-GO 的 5 條 must-fix + 3 nit 已折入,等 R2。零行 SQL。**
> 依 `E-125-A` ②;上游拍板 = Sean `E-124-A:3`(Q4=A)。
> **片型 = 高風險片**(鐵則 12②③)⇒ **apply = Sean 手動停點**。
> 事實親查於 `pcm-refund-wire` @ `de29f3d`;引用一律附 `檔案:行號`。**本檔整份重寫、非逐行補丁**
> ——「四欄」這個錯字面散在 13 處,補丁會漏(本 repo 復發 9+ 次的頭號形狀)。
>
> 🔴 **關卡1 R1 由 `adversarial-reviewer`(fable)跑,不是 codex** —— 新 codex 帳號**撞用量牆**
> (實測 `You've hit your usage limit ... try again at Sep 5th`,燒 12 萬 token、零 findings)。
> ⇒ **codex 跨模型背書仍欠著**,清單見 §8。

---

## §1 為什麼要這支 migration

A5a 的 UPDATE 分支(`20260803160000:354-361`)**無條件**用參數覆寫**五個**選填欄:

| 欄 | 批次(Q1=A)有沒有送? | 本片怎麼處理 |
|---|---|---|
| `submitted_at` | ❌ 沒有入口 | ✅ **進 preserve 集合** |
| `supplier_order_no` | ❌ 沒有入口 | ✅ **進 preserve 集合** |
| `exception_reason` | ❌ 沒有入口 | ✅ **進 preserve 集合** |
| `expected_arrival_date` | ❌ 沒有入口 | ✅ **進 preserve 集合** |
| 🔴 `contact_channel`(`:357`) | ✅ **有** —— Q1=A 是「整批共用一個聯絡管道」 | ❌ **不進 preserve**,理由見 §1.1 |

⇒ 批次只填「每列訂多少」時,前四欄會被送 `null` ⇒ **把員工在明細頁填好的供應商單號、
預計到貨日清掉**。動線很正常:先在明細頁記,之後那張單被批次掃到。
關卡1 R1(前一份 plan)裁定逐字:**「警告不能把資料損失變可接受」** ⇒ 必須在 DB 層解決。

**CREATE 分支不受影響**(`:383-391`):新列沒有舊值可保留,插 `null` 本來就對。

### 1.1 🔴 `contact_channel` 為什麼不進 preserve(關卡1 R1 F1 的回應)

R1 指出 `:357` 的 `contact_channel = v_channel` 與那四欄**同形**、我漏了它。
**同形這件事成立**(我親驗 `:353-361`),但**失效模式不同**:

- 那四欄:批次**沒有入口** ⇒ 送 `null` 是「不提供」被誤讀成「清空」= 本片要治的病
- `contact_channel`:Q1=A 明訂它是**整批共用欄、員工會選** ⇒ 批次送的是**真實意圖**,
  把它 preserve 掉反而會讓「員工替整批改管道」失效 = 打壞 Q1=A

⇒ **不進 preserve 集合。** 但 R1 指出的相鄰風險是真的,改掛 A9h-2:

🔴 **A9h-2 待辦**:若批次 UI 允許聯絡管道**留空**,送 `null` 會清掉各列既有值。
⇒ A9h-2 必須**要求必填**、或明確警告。**寫進 §4 認領表,不丟失。**

---

## §2 選型:加一個 preserve 參數,**不做**窄版 patch RPC

```
p_preserve_optional_fields boolean DEFAULT false
```

`true` ⇒ UPDATE 分支的**那四欄**保留現值;`false`(預設)⇒ **現行行為逐字不變**。

### 2.1 為什麼不做窄版 patch RPC(R1 判 PASS,理由已被獨立重建)

窄版 RPC 仍必須寫 `allocated_quantity` ⇒ **必然複製** A2b1 的 `P2B01` catch(`:364-372`)、
`unique_violation` 併發首建重試圈(`:399-411`)、供應商閘(`:329-341`)、同交易稽核(`:424-452`)。
⇒ 兩份守門**必然漂移**,而「批次路徑少了一道單列路徑有的守門」正是本 repo 反覆踩的坑
(memory `feedback_guard-drawn-at-narrowest-surface-not-invariant`)。**一支 RPC 一個守門面。**

### 2.2 為什麼不用 COALESCE

`COALESCE` = **永遠**不能清空;**顯式旗標** = 只在呼叫端**明說自己沒有那四欄**時才保留。
⇒ 明細頁單列表單照舊送 `false`,**員工想清空某欄照樣清得掉**。
這是 Sean 拍 A 時的硬約束(`E-124-A:3`「真想清空某欄要做得到」),§7 驗收 3 直接釘它。

---

## §3 migration 要做的八件事

| # | 內容 | 為什麼(證據) |
|---|---|---|
| **M1** | UPDATE 分支(`:354-361`)**那四欄**改為:`preserve=true` 取 `v_before.<欄>`、否則取參數 | 病灶本體 |
| **M2** | 🔴 `NO_CHANGE` 比較基準改成 **「實際將寫入的 effective 值」** | R1 F8:與「preserve 時四欄不參與比較」等價,但讓 M1/M2 **共用同一份欄位來源**,消掉兩處枚舉再漂移的空間 —— 而 F1 那條漏欄正是枚舉漂移的病 |
| **M3** | 🔴 稽核 `after` 改記 **effective 值**,不是參數 | 親驗 `:439-448`:`after` 用 `p_submitted_at`/`v_order_no`/`v_reason`/`p_expected_arrival_date` **組參數** ⇒ preserve 後資料列保留舊值、稽核記 `null` = **兩者矛盾** |
| **M4** | 🔴 **`preserve=true` 且那四欄任一參數非 NULL ⇒ fail-loud** | R1 F4:呼叫端送了值又要求保留 = **矛盾意圖**;靜默丟棄 = 「送了值沒寫入、稽核也不見」(memory `feedback_null-dispatch-rpc-silently-downgrades` 同族)。**§6 定案走哪條** |
| **M5** | **DROP 舊 11 參簽章** + `COUNT(*)=1` 斷言 | 加參數 = 新簽章;兩 overload 並存 ⇒ PostgREST 歧義。前例 A8a1/A8a2 |
| **M6** | 🔴 ACL 重建:先 `REVOKE ALL FROM PUBLIC, anon, authenticated`,再 `GRANT EXECUTE TO service_role`,fail-closed 斷言 | DROP 帶走舊 ACL(該 migration `:809-814` 自己寫了);SECURITY DEFINER **預設 PUBLIC 可執行** ⇒ 只 GRANT 不 REVOKE = 開後門 |
| **M7** | 終態屬性斷言:`pronargs=12` / `pronargdefaults=1` / **DEFAULT 精確為 `false`** / SECDEF / `search_path` / owner / COMMENT | 只斷言數量擋不住「數量對但形狀錯」 |
| **M8** | 🔴 **COMMENT 字面連動**(R1 F7):`:463-464`「選填欄 NULL = 寫成 NULL」在 preserve=true 下**不再恆真**;`:485-793` 的 verify 區 12 條字面錨與 17 碼錨照抄並更新 | 不改 = 契約註解與行為不符 |

### 3.1 🔴 `DEFAULT false` 是承重的

若 DEFAULT 寫成 `true`,**明細頁單列表單會靜默失去清空能力**,而且沒有任何測試會紅
(表單照送、RPC 照回 `UPDATED`、只是那四欄再也清不掉)。⇒ M7 必須逐字斷言它。

---

## §4 連動面(🔴 v1 整節漏掉;R1 F2/F3/F5 全是這一類)

改簽章會打壞三個**寫死 11 參字面**的地方。**三者必須同 commit 連動改**:

| # | 檔案:行號 | 現況(親驗) | 不改會怎樣 |
|---|---|---|---|
| **L1** | `scripts/a5a-verify.sh:21` | `FN="public.admin_upsert_item_procurement(uuid,uuid,integer,text,text,timestamptz,text,text,date,text,text)"` | regprocedure cast 直接 error ⇒ **整組 144 格驗收全滅**,而 §7 驗收 8/9 正是靠它 |
| **L2** | `docs/runbooks/a4a-summary-rollback.md:21,202,206` | REVOKE / GRANT / 斷言三處同款硬編簽章 | 🔴 **緊急回滾會在唯一需要它的那天噴 undefined function** —— A2b1/A4a 單獨回滾時「A5a 必須同停」的停法就是這三句(同 memory「回滾守門在唯一需要它的那天擋死自己」) |
| **L3** | `packages/adapters/src/supabase/database.types.ts:2386` | Args 為 11 參,檔頭 `:10` 載明**五處人工校正**;舊 migration `:796-800` 自己把 regen 列為 apply 後硬前置 | TS 端型別與 DB 不符;regen 後**必須重貼那五處校正**,否則校正靜默消失 |

⇒ **L1/L2 進本片 commit;L3 是 apply 後動作**(regen 需要真 DB),寫進 §7 驗收 11。

---

## §5 R2 十二條 must-fix 的認領(依 `E-125-A:10`,三分類、不丟失)

| R2 # | 摘要 | 歸屬 |
|---|---|---|
| 1 | 稽核 `after` 記參數而非實際寫入值 | ✅ **本片 M3** |
| 2 | 只寫 GRANT 未寫 REVOKE PUBLIC/anon/authenticated | ✅ **本片 M6** |
| 3 | `COUNT(*)=1` 不夠,要釘屬性與 schema-cache | ✅ **本片 M5+M7**(cache reload 與 smoke 進 §7 驗收 10) |
| 4 | 跨訂單批次 vs 單一頂層 `orderId` 矛盾 | ➡️ **A9h-2**(簽章題) |
| 5 | `ok: true\|false\|'unknown'` 判別式 | ➡️ **A9h-2** |
| 6 | 未驗共同欄、數量放行 0 與極大值、無 batch-level 回傳型別 | ➡️ **A9h-2** |
| 7 | 「業務失敗」集合未定義 | ➡️ **A9h-2**(A9h-1 已在 `procurement-result.ts:33` 留下正確指標 `:96-99`) |
| 8 | 歸屬查詢失敗 vs transport 失敗混為一談 | ➡️ **A9h-2** |
| 9 | 無批次上限 / per-row timeout / `maxDuration` 落點 | ➡️ **A9h-2**(需實測 —— 拆片的理由) |
| 10 | A12b read-back 未進硬前置 | ➡️ **A9h-2 + 母 plan row 64 連動** |
| 11 | 「測試矩陣不變」與「新增案例」互斥 | ✅ **已自然消失**(A9h-1 `272b26b` 改用 byte-identity 三條) |
| 12 | action diff 只准加 import+刪函式 vs 還要移除未使用 import | ✅ **已自然消失**(A9h-1 實作時就移除,commit body 具名交代) |
| nit | 重複列理由自相矛盾 | ➡️ **A9h-2** |
| nit | §0 兩片 vs §5 三片 | ✅ **已消失** |
| 🆕 | **批次聯絡管道留空會清掉各列既有值**(本輪 R1 F1 衍生,§1.1) | ➡️ **A9h-2**(必填或警告) |

⇒ **本片吃 3 條、A9h-2 吃 8 條、自然消失 3 條。零丟失。**

---

## §6 待定案一題(不影響開工序,但 M4 要它)

```
Q:preserve=true 但那四欄任一參數非 NULL(矛盾意圖),RPC 該怎麼回?
A) RAISE(走既有 caller-bug 面 P0001)—— 最 fail-loud;呼叫端 TS 已有 ProcurementCallerBugError 承接
B) 新增第 18 個固定碼(如 PRESERVE_WITH_VALUES)—— 可逐列回報不中斷,但動 17 碼全集
   ⇒ COMMENT 錨 :466-469、驗收 8 字面、TS 的 PROCUREMENT_RESULT_CODES 全連動
A: A|B
```

**我推薦 A**:這是**呼叫端 bug、不是業務狀態**(沒有任何合法情境會同時「送值」與「要求保留」),
而 B 會把一個編程錯誤混進業務碼集合、還要動 17 碼全集與三處字面錨。

---

## §7 驗收條件(🔴 依 R1 F6 拆兩段時序)

### 7.1 commit 前可驗(交易模擬 `BEGIN → 套用 → 驗 → ROLLBACK`)

1. `preserve=true` 更新一列 ⇒ **那四欄原值保留**。
2. `preserve=false`(或不帶)同輸入 ⇒ 四欄**被寫成 null** —— **證明旗標非恆真**(負向對照)。
3. 🔴 **清空能力未受損**:單列表單送空值 + `preserve=false` ⇒ 該欄**真的變 null**
   (Sean 硬約束的直接驗收)。
4. 🔴 `NO_CHANGE` 正確:preserve=true 且只有那四欄「不同」⇒ 回 `NO_CHANGE`、
   **不得**回 `UPDATED`,且 `status_changed_at` 未被推進。
5. 🔴 稽核一致:preserve=true 時 `admin_audit_log.after` 四欄 = **effective 值**、不是 `null`。
6. 🔴 M4 矛盾意圖:preserve=true + 參數非 NULL ⇒ 依 §6 定案的行為(**不得靜默丟棄**)。
7. `contact_channel` 在 preserve=true 下**仍由參數決定**(§1.1 的正向驗證,證明它沒被誤收進 preserve)。
8. `proname` `COUNT(*)=1`;`pronargs=12`;`pronargdefaults=1`;**DEFAULT 精確 `false`**;
   SECDEF;`search_path`;owner;COMMENT 存在。
9. 既有 17 碼在 `preserve=false` 下**逐碼不變** —— `scripts/a5a-verify.sh`(已依 L1 改簽章)
   144 格全綠。
10. 交易模擬零留痕。

### 7.2 apply 後才可驗(Sean 手動停點之後)

11. `NOTIFY pgrst, 'reload schema'` 後 **PostgREST 具名參數 smoke**:12 參與 11 參形態各打一次,
    確認 cache 已重載、DEFAULT 參數向後相容。
12. `database.types.ts` regen + **重貼五處人工校正**(L3),TS 端 typecheck 綠。
13. ACL 終態:`PUBLIC`/`anon`/`authenticated` **零 EXECUTE**;`service_role` EXECUTE=true。

---

## §8 施工紀律與仍欠的背書

- 🔴 **不 `db push`、不 apply** —— commit 押本分支等收割;**apply = Sean 手動停點**,主視窗排時機。
- 🔴 **與 B 線 S2b 是兩條線各自的批、絕不混批**(`E-124-A:10`)。
- 🔴 **回報三綠一律帶 `--force` 或貼 `Cached: 0`**(多 worktree 下 turbo 會跨樹重播快取)。
- 🔴 **codex 跨模型背書仍欠**(用量牆到 2026-09-05)。R1 替身審查明列**四個面仍需 codex 補**:
  ① SQL 寫出後的關卡2 diff 級審查(鐵則 12 不降級)
  ② ACL/SECDEF 終態的實際字面(鐵則 12② 金權面)
  ③ §1.1 `contact_channel` 定案後的 preserve 集合 × M2/M3 連動
  ④ 若 §6 拍 B(動 17 碼全集),全碼行為矩陣重審
  ⇒ **主視窗決定:等 quota 回來再 apply,或改派其他跨模型背書。**

---

## §9 假設清單(不確認不准施工)

| # | 假設 | 怎麼驗 |
|---|---|---|
| A1 | preserve 只需動 UPDATE 分支 | ✅ 已驗:`:383-391` CREATE 分支是新列、無舊值可保留 |
| A2 | `v_before` 已載入那四欄 | 開 `:330-360` 確認 SELECT 欄位清單(**施工前第一件事**) |
| A3 | DROP 舊簽章後無其他呼叫端 | ✅ 已查三處硬編(§4 L1/L2/L3);另需 `pg_proc` 實查 + grep 全 migration 樹 |
| A4 | 加 DEFAULT 參數後舊呼叫端仍走對分支 | §7.2 驗收 11 的 PostgREST smoke 實打 |
| A5 | DDL 期間併發呼叫安全 | R1 已查:PG DDL transactional、函式 DDL 不阻塞執行中呼叫 ⇒ **成立** |

---

**未經關卡1 R2 PASS + §6 定案,不得寫任何 SQL。**

— E 窗(九碼退場窗),2026-08-06
