# A9h-M — A5a 加 preserve 模式(migration 片)plan v3

> **狀態:🏁 關卡1 兩輪 findings 全折入 + §6 兩題已拍(`E-127-A`)⇒ **可開寫 SQL**。**
> **R2 明言「修完免 R3」。本檔目前仍零行 SQL。**
> 依 `E-125-A` ②;上游拍板 = Sean `E-124-A:3`(Q4=A)。
> **片型 = 高風險片**(鐵則 12②③)⇒ **apply = Sean 手動停點**。
> 事實親查於 `pcm-refund-wire`;引用一律附 `檔案:行號`。
> v2 曾整份重寫(錯字面「四欄」散在 13 處);v3 是 R2 兩條的定點修正。
>
> 🔴 **關卡1 兩輪都由 `adversarial-reviewer`(fable)跑,不是 codex** —— 新 codex 帳號**撞用量牆**
> (實測 `You've hit your usage limit ... try again at Sep 5th`,燒 12 萬 token、零 findings)。
> ⇒ **codex 跨模型背書仍欠著**,清單見 §8。
>
> **R2 判定**:R1 五條**全部 CLOSED**(含我對 F1 的反駁被獨立驗證成立);
> 新抓 2 must-fix(fixture 空洞化、Q2 排序)+ 2 consider + 2 nit,**本 v3 全數折入**。

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

改簽章會打壞一批**寫死 11 參字面**的地方。**全部必須同 commit 連動改**(v2 只找到三處,解除假設 A3 時又挖出三處 ⇒ 見 §4.1):

| # | 檔案:行號 | 現況(親驗) | 不改會怎樣 |
|---|---|---|---|
| **L1** | `scripts/a5a-verify.sh:21` | `FN="public.admin_upsert_item_procurement(uuid,uuid,integer,text,text,timestamptz,text,text,date,text,text)"` | regprocedure cast 直接 error ⇒ **整組 144 格驗收全滅**,而 §7.1 驗收 9 正是靠它(驗收 8 屬 migration 內斷言、非 harness ── R2 nit 6 更正) |
| **L2** | `docs/runbooks/a4a-summary-rollback.md:21,202,206` | REVOKE / GRANT / 斷言三處同款硬編簽章 | 🔴 **緊急回滾會在唯一需要它的那天噴 undefined function** —— A2b1/A4a 單獨回滾時「A5a 必須同停」的停法就是這三句(同 memory「回滾守門在唯一需要它的那天擋死自己」) |
| **L3** | `packages/adapters/src/supabase/database.types.ts:2386` | Args 為 11 參;🔴 **regen 會沖掉的人工校正不只本函式** —— 檔頭 `:1-4` 自訂「**計數唯一權威在檔頭、下游不得複述數字**」 | TS 端型別與 DB 不符;regen 後**必須照檔頭計數重貼全部校正**,否則校正靜默消失(R2 consider 3:我 v2 寫「五處」是複述數字、正犯該檔禁止的事) |
| **L4** | `apps/admin/src/lib/orders/procurement-repository.ts:52` | 該處註解枚舉「`P0001` 來源理論上只有 actor / request_id / 常數自檢 / 防衛枝」 | 🔴 **M4 新增一個 P0001 來源後,這句誠實邊界註解失真**(R2 consider 4;與 M8 同族 = 契約註解沒跟上行為)⇒ 同 commit 補上「preserve 矛盾意圖」那一項 |

### 4.1 🔴 解除假設 A3 時又挖出三個(v3 補;**這就是「不確認不准施工」的價值**)

| # | 檔案:行號 | 現況(親驗) | 不改會怎樣 |
|---|---|---|---|
| **L2b** | `docs/runbooks/2026-07-30-a7-rollback.md:96,99` | 🔴 **第二份**回滾 runbook,GRANT + 斷言同款硬編 11 參簽章 | 與 L2 完全相同的失效模式(**災難當天才壞**)。v2 只列了 a4a 那份 ⇒ **漏一半** |
| **L5** | `apps/admin/src/lib/orders/procurement-repository.ts:124-138` | `rpc()` 逐欄具名送 11 個參數 | 不送新參數 ⇒ 走 DEFAULT `false` = 現行行為(不會壞),**但批次拿不到 preserve** ⇒ A9h-2 無法開工 |
| **L6** | `apps/admin/src/lib/orders/procurement-repository.test.ts:102-116` | `expect(args).toEqual({…11 鍵…})` **精確比對** + `expect(Object.keys(args)).toHaveLength(11)`(註解逐字「參數個數釘死 = 11」) | 🔴 **測試直接紅** —— 這條是好的守門(它就是為了擋「多送/少送讓 PostgREST 找不到多載」),但**它釘的數字要跟著簽章走** |

**A3 的正向結果**:全 migration 樹**零**其他呼叫端(`grep` 排除本檔後零命中)⇒ DB 內部無連動。
`packages/domain/src/order/types.ts:407` 只引 migration **檔名與舊行號**當註解、不含簽章 ⇒ 不受影響。

⇒ **本片 commit 要動:L1 / L2 / L2b / L4 / L5 / L6**(六處);
**L3 是 apply 後動作**(regen 需要真 DB),寫進 §7.2 驗收 12。

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

## §6 決策 —— 🏁 兩題全拍(`E-127-A`,2026-08-06 Sean),**已無活選項**

| 題 | 拍板 | 連動 |
|---|---|---|
| **Q1** 矛盾意圖(preserve=true + 那四欄任一參數非 NULL)怎麼回 | 🏁 **A:RAISE 走既有 caller-bug 面 `P0001`**,不新增第 18 碼 | M4;TS 端 `procurement-repository.ts:66` 只看 `code` 不看訊息 ⇒ **自動被 `ProcurementCallerBugError` 承接**、無需改判別式(但 `:52` 的來源枚舉註解要補 = §4 L4) |
| **Q2** 批次「聯絡管道留空」語意 | 🏁 **A:必填** —— A9h-2 的 UI 不准留空 | **DB 層不動、12 參簽章一次定案**;`contact_channel` 不進 preserve 集合(§1.1)**隨之定案**、不再是待議項 |

**Q1=A 的無誤傷證明**(R2 獨立驗證,我保留):批次那四欄無入口、單列一律送 `false`
⇒ **構造不出合法情境觸發 RAISE**;且批次逐列各自交易,單列 RAISE **不回滾兄弟列**
⇒ 不存在「一列打錯、整批中止」的面。

**Q2=A 的連帶**:原本「若拍 B 需第 13 參、六個連動面全部再跑一次」的風險**已解除**。
🔴 但這條紀律留著:**簽章一旦 apply 就不該再加參數** —— 下次要加,六個連動面(§4/§4.1)全部要再跑。

## §7 驗收條件(🔴 依 R1 F6 拆兩段時序)

### 7.1 commit 前可驗(交易模擬 `BEGIN → 套用 → 驗 → ROLLBACK`)

> 🔴🔴 **fixture 前態硬約束(R2 must-fix 1;沒有這段,下面 1/2/4/7 四條全是恆真)**
>
> 親驗 `20260803160000:313-321`:同值 no-op 判定對**七欄全部**用 `IS NOT DISTINCT FROM`
> ⇒ **「四欄都是 NULL 的列 × 送 NULL 參數」本來就回 `NO_CHANGE`**,
> **preserve 完全沒實作也會全綠**。而用 RPC 自然新建的 fixture 恰好就是四欄 NULL。
>
> ⇒ **驗收 1/2/4 的 fixture:那四欄前態必須全部非 NULL 且互不相同**
> (例如 `submitted_at='2026-08-01T10:00+08'` / `supplier_order_no='SO-A'` /
> `exception_reason='缺料'` / `expected_arrival_date='2026-08-20'`)。
> ⇒ **驗收 7 的 channel 參數必須非 NULL 且 ≠ 現值**(否則同樣恆真)。
> 依據:memory `feedback_fixture-value-makes-guard-vacuous`(fixture 裡「碰巧」的值
> 會讓整族守門變恆真)。**每格 fixture 前態逐欄寫進 harness、不得沿用自然新建值。**

1. `preserve=true` 更新一列(前態四欄皆非 NULL)⇒ **那四欄原值保留**。
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
12. `database.types.ts` regen + **照該檔檔頭的計數重貼全部人工校正**(L3;
    🔴 **不要在這裡複述數字** ── 該檔 `:1-4` 明訂計數唯一權威在檔頭),TS 端 typecheck 綠。
13. ACL 終態:`PUBLIC`/`anon`/`authenticated` **零 EXECUTE**;`service_role` EXECUTE=true。

---

## §8 施工紀律與仍欠的背書

- 🔴 **不 `db push`、不 apply** —— commit 押本分支等收割;**apply = Sean 手動停點**,主視窗排時機。
- 🔴 **與 B 線 S2b 是兩條線各自的批、絕不混批**(`E-124-A:10`)。
- 🔴 **回報三綠一律帶 `--force` 或貼 `Cached: 0`**(多 worktree 下 turbo 會跨樹重播快取)。
- 🔴 **codex 跨模型背書仍欠**(用量牆到 2026-09-05)。R1 替身審查明列**四個面仍需 codex 補**:
  ① SQL 寫出後的關卡2 diff 級審查(鐵則 12 不降級)
     🔴 含 `scripts/a5a-verify.sh` **改簽章後自身的對帳**(`EXPECTED_TOTAL=144` / `EXPECTED_MUT` 是否仍相符)
     ── harness 改動後自己假綠是有前科的族(memory `feedback_negative-test-harness-self-false-green`)
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
| A3 | DROP 舊簽章後無其他呼叫端 | ✅ **已解除(2026-08-06)**:全 migration 樹零其他呼叫端;全樹不限副檔名 grep **又挖出三處**(§4.1 L2b/L5/L6)⇒ 連動面從 3 條變 **6 條**。⚠️ 仍欠 `pg_proc` 實查(需真 DB,排 apply 前) |
| A4 | 加 DEFAULT 參數後舊呼叫端仍走對分支 | §7.2 驗收 11 的 PostgREST smoke 實打 |
| A5 | DDL 期間併發呼叫安全 | R1 已查:PG DDL transactional、函式 DDL 不阻塞執行中呼叫 ⇒ **成立** |

---

**未經關卡1 R2 PASS + §6 定案,不得寫任何 SQL。**

— E 窗(九碼退場窗),2026-08-06
