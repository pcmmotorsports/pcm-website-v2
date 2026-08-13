# 採購撤銷 plan(採購「改軟」線 片 2)

> **版本:** v3(關卡1 codex 判 **FAIL**、19 must-fix + 7 important 折疊後重寫)。
> **狀態:** **未經 Sean 批准 ⇒ 一行 code 都還沒寫**(鐵則 8)。
> **片型:** 🔴 高風險片(鐵則 12③)。
> **上游拍板:** Sean 2026-08-13 凌晨 Q6=A(只做採購「改軟」、不新增採購單實體、不做庫存)/ Q10=A(採購改軟三片先做)。
> **需求原文(Sean 2026-08-12 逐字):**「然後採購也要可以取消,有可能 key 錯資訊之類」。
>
> 🔴🔴 **v3 最重要的一句話:推薦案換了。** v2 推薦「硬刪列」,它的兩個承重論點被 codex 打掉(見 §-1 F-A / F-B)。
> v3 推薦 **案 C′「額度歸零」**。上一版的推薦是我在錯前提下寫的,換掉它不是翻案,是把錯的前提拿掉。
>
> **本檔所有數字的量測基準 = `HEAD 9d38d4cf`**(`git rev-parse --short HEAD` 實跑)。
> 換 HEAD 就要重跑 —— v1→v2→v3 已經有三次「數字與 HEAD 不符」,不再假設數字有保鮮期。

---

## §-1 關卡1 折疊台帳(26 條逐條,不挑著折)

### -1a 先講一件影響「怎麼讀這份 findings」的事

🔴 **codex 引用的 migration 檔名,沒有一個對得上 repo 實檔。** 逐條比對(`ls supabase/migrations/` 實查):

| codex 寫的 | repo 實檔 |
|---|---|
| `20260806200000_a5a_procurement_concurrency.sql` | `20260806200000_m4b_e10_a9h_m_a5a_preserve_optional_fields.sql` |
| `20260803160000_a5a_procurement_upsert.sql` | `20260803160000_m4b_e10_a5a_admin_upsert_item_procurement.sql` |
| `20260729020000_procurement.sql` | `20260729020000_m4b_e10_a2_order_item_procurement.sql` |
| `20260810233000_receipt_delete.sql` | `20260810233000_m4b_e10_352a2_receipt_write_rpcs.sql` |
| `20260810230000_receipt_surplus.sql` | `20260810230000_m4b_e10_352a1_receipt_recording_schema.sql` |
| `20260812130000_admin_search_orders.sql` | `20260812130000_m4b_347_fuzzy_admin_search_orders.sql` |
| `20260801140000_supplier_delete_guard.sql` | `20260801140000_m4b_e10_s1a_suppliers.sql` |

時間戳全部是真的、檔名全部是**照內容編出來的**。⇒ 主視窗的裁示我照辦:**每條 finding 我都自己開檔核過**,
下表的「我核到的」欄就是核的結果。**核不到的不折也不丟**,單獨列進 §-1d。
⚠️ 反向紀律也照辦:核不到就**不替它想像想說什麼**(那會變成轉抄一個我自己補完的理由)。

### -1b 框架級四條(全部成立,而且比 codex 講的更嚴重)

#### F-A 🔴🔴 **成立,且是本輪最重的一條**：案 A 會打破 A5a 自己的並發證明

我開檔核到的逐字(`20260806200000_m4b_e10_a9h_m_a5a_preserve_optional_fields.sql:432-433`):

> 「兄弟交易併發首建:23505 只會在對方 COMMIT 之後才拋 ⇒ 第二圈的列鎖查詢
>  必定看得到那筆已提交的列,走 11a/11b;**本表無 DELETE writer ⇒ 不會再空手。**」

同檔 `:450-451` 防衛枝逐字:

> 「防衛枝:兩圈都沒收斂 = 上面的推理被推翻(**例如有人加了 DELETE writer**)。」

🔴 **原作者在半個月前就把我這一片的名字寫進了防衛枝的括號裡。**
⇒ v2 §3 理由②「案 A 改動既有物件 **0 支**」**是假的**。不改它的 code,但**廢掉它的證明**——
而廢掉證明之後,要嘛重寫 A5a 的重試迴圈(= DROP/CREATE 那支 822 行函式),要嘛接受它的防衛枝在生產環境變成可達。
**兩條都不是「0 支」。** 這條同時打掉 v2 §3 的理由②,而理由②正是我用來否決案 C 的那把尺。

#### F-B 🔴 **成立**:「下游全部已備好」漏了讀者面

`20260812130000_m4b_347_fuzzy_admin_search_orders.sql:368-375` 逐字核到:搜尋第 #11 段
`JOIN public.order_item_procurement pc ON pc.order_item_id = oi.id`,對 `pc.supplier_order_no` 做正規化 LIKE。
⇒ **硬刪採購列 = 這張訂單再也不能用那個供應商單號搜到。**

🔴 病根比 codex 講的更一般:我 §0-A 的八個面**全部是「誰會寫它 / 誰會擋它」**,
**沒有一個面在問「誰在讀它」**。⇒ v3 §0-A 加第 9 面「讀者面」,並且**先列讀者再談刪除**。

#### F-C 🔴 **成立**:用 audit 當冪等帳,買的比省的多

三條我都核到:
- `20260803160000:92-93` 逐字「service_role 對 admin_audit_log 有 INSERT ⇒ **可不碰採購表就寫假稽核**」
- `#439` 已立案(audit append-only 只靠 GRANT)
- 我把 audit 寫在 DELETE **之前**(v2 §1a 步 6;v3 已改成 UPDATE 成功之後,見 §3 第 2 點),而 `20260810233000:436` 既有實作是**成功 DELETE 之後**才 audit ⇒ **我抄的形狀跟樣板相反**

⇒ v2 §4 那個「省一張表」的 ponytail **是錯的 ponytail**:它省的是一張表,買回來的是一個**可偽造的冪等判準**。
ponytail 的規矩是「不為投機的需求寫程式」,不是「為了少寫一張表而讓正確性下降」。**撤回。**

#### F-D 🔴 **成立**,而且我重跑之後發現三個數字都要重講

| 我 v2 寫的 | codex 說 | 我在 `9d38d4cf` 重跑 | 判定 |
|---|---|---|---|
| INSERT 30 行 | 33 | **33** | 我錯。v2 那個 30 是**眼睛數 grep 輸出**、不是 `wc -l` |
| 函式 16 支 | 18 支 | **見下** | 三個人三個數字,因為**三個人數的單位不同** |

🔴 **「函式幾支」這個問題本身是壞的** —— 量測單位沒定義,答案就不唯一。三種數法在 `9d38d4cf` 各自的值:
```bash
# ① CREATE FUNCTION 敘述句數(同一支函式改版兩次算兩句)
for f in $(grep -rl "order_item_procurement" supabase/migrations/); do grep -c "^CREATE \(OR REPLACE \)\?FUNCTION" "$f"; done | awk '{s+=$1} END{print s}'   # → 19
# ② 不同名的函式(去重改版)
for f in $(grep -rl "order_item_procurement" supabase/migrations/); do grep -h "^CREATE \(OR REPLACE \)\?FUNCTION" "$f"; done | sed -E 's/^CREATE (OR REPLACE )?FUNCTION //; s/\(.*$//' | sort -u | wc -l   # → 14
# ③ (檔, 函式) 對 —— v2 §0-D 表格實際列出的  → 16
```
⇒ v3 一律講**②不同名函式 = 14 支**,並在表格標明另外兩個數字的定義。**不再寫「N 支」而不說 N 是什麼的 N。**

### -1c 其餘 22 條的折疊結果(逐條)

| # | finding 摘要 | 我核到的 | 折法 |
|---|---|---|---|
| 1 | `20260803160000:80-84` 同段仍明寫正式語意是「採購事實不刪」,把 break-glass 推論成產品語意依據不足 | ✅ 逐字核到,原句是「本片刻意不做…不做 DELETE(採購事實不刪…)」,那句**否定 DELETE**,而我拿它後面那個括號當背書 | **採納**。v3 不再用「設計者指定的出路」當推薦理由(§3 整條刪),改成明寫**這是與原契約相左的取捨、必須 Sean 拍** |
| 2 | `20260729020000:35-37` 的窄義反駁只成立一半 | ✅ | **採納**,理由同上;v3 §2 案 A 直接把「違反建表檔宣稱」列進**成本欄**而不是註腳 |
| 3 | plan 仍稱 receipts append-only,但已改為可受控刪除 | ✅ `20260810233000:45-50` COMMENT 逐字「🔴 2026-08-10 #352-a2 起:**不再是 append-only**」 | **採納**。v2 §0-B 抄的 `20260729020000:178-181` 是**過期字面**(同病根第 3 次) |
| 4 | receipts 已允許 `quantity=0、surplus_quantity>0`;阻擋訊息只顯示「件數」會藏掉溢收 | ✅ `20260810230000:70-98`:新增 `surplus_quantity`、`quantity` CHECK 放寬成 `0..100000`、另加 `quantity+surplus BETWEEN 1 AND 100000` | **採納**。守門訊息改列 **`quantity` 與 `surplus_quantity` 兩個數**;「有沒有到貨」的判準也不能只看 `quantity>0` |
| 5 | RPC 沒有必填撤銷原因 | ✅(v2 簽章確實只有 id/actor/request_id) | **採納**,`p_reason` 改必填、進 audit `reason` 欄 |
| 6 | 「可由 audit 還原」過度承諾:before image 含 generated column | ✅✅ **核到了,而且是我 v2 完全沒讀到的一支 migration**:`20260807130000_m4b_e10_a9b2_m_supplier_order_no_upper.sql:80-82` 加了 `supplier_order_no_upper text GENERATED ALWAYS AS (upper(supplier_order_no)) STORED` | **採納**。⚠️ 這條同時證明 v2 §0-B 的欄位清單**不完整**(同病根第 4 次)。v3 §6 的還原承諾降級成「**有依據、無現成程序**」,並寫出實際可跑的還原 SQL(排除 generated column) |
| 7 | `FOR NO KEY UPDATE` 與 receipt FK 的 key-share 相容 ⇒ 檢查後仍可插入 receipt,DELETE 拋裸 `23503` | ✅ 推理成立(FK RI 對 parent 取 `FOR KEY SHARE`,與 NKU 相容 —— 這正是 `20260803130000:20-23` 記載的相容性) | **採納**。任何「先查後動」的守門都要**同時 catch 對應 SQLSTATE 並翻譯**,不是只靠前置查詢 |
| 8 | app plan 只寫「仿 receipt action」,沒硬性要求授權在 RPC 之前 | ✅ 樣板 `receipt-actions.ts:251-252` 第一句就是 `authorizeAdminMutation()`,但**我的 plan 沒把它寫成條件** | **採納**,**v3 §3 第 3 點**改成逐條硬性清單 |
| 9 | 沒要求驗 procurement → order_item → order 的 ownership | ✅ 樣板 `receipt-actions.ts:262-278` 有做,我沒寫進 plan | **採納**,列成驗收條件 |
| 10-13 | 前置檢查八列判別力不足:只數 trigger 名稱/啟用,不驗事件·時機·目標函式·函式本體;第 7 列只數「任意 RESTRICT FK」;沒驗 RLS/PUBLIC;沒驗 audit 與 SECDEF owner | ✅ 全部成立 | **採納**。🔴 這四條打的**不是**我的方法,是我的**覆蓋範圍** —— 我的突變證明了「這一列被破壞會紅」,codex 指出的是「**還有哪些破壞方式不會紅**」。兩件事都對。**v3 §5** 八列擴成 **13 列**,並改用 `pg_get_triggerdef` / 具名 FK / `pg_proc.prosrc` 錨點 |
| 14 | N7 heredoc 到 EOF 連線就結束、交易回滾 ⇒ 沒測到 blocking | ✅ 我寫的 `psql <<'SQL'` 確實會在 EOF 關連線 | **採納**,改用具名 pipe / `psql -f` 背景 job + `pg_sleep`,並加「終端 2 真的卡住」的正面觀察點 |
| 15 | B4 只驗 JSON key 聯集,值全 null 也過、多筆拼出完整 key 也過 | ✅ | **採納**,改成:①`count(*) = 1` ②逐欄值等於刪除前快照 ③排除 generated column |
| 16-17 | 測試漏 receipt-insert/DELETE 競態、A5a upsert/DELETE 競態、audit 被吞時整筆 rollback、成功 audit 恰一筆;app 測試漏 denied-no-RPC / 跨訂單竄改 / double submit | ✅ | **採納**,**v3 §4** 加格 |
| 18 | fixture 只挑第一張既有訂單,空庫會 NULL/FK 失敗 | ✅ `scripts/352a2-verify.sh` 有 eligible-item 前提與 fail-close,我的骨架沒抄 | **採納**,骨架改成「查不到合格訂單 ⇒ **RAISE**」而非靜默 |
| 19 | N5 只是註解、四種 malformed 沒實跑;N6 只比較是否拋錯 | ✅ | **採納**,寫成真的四發 + N6 加驗 audit 裡的 request_id 正規化後值 |
| 20 | dynamic SQL 掃描只涵蓋少數 `EXECUTE format` 形式 | ✅ 我確實只掃了四種字面 | **採納**,§0 明降級成「**未宣稱掃完**」,並寫出掃了哪四種 |
| 21 | `nit` — plan 說 supplier delete guard 會讀 procurement,實際函式無條件拒絕 | ✅✅ **codex 對,我錯**:`20260801140000:106-108` 函式體只有一句 `RAISE EXCEPTION`,**完全沒有讀本表** | **採納**。🔴 病根值得記:我的 §0-D 是用 `awk`「函式標頭 + 該檔有提及本表」推的 —— **檔案提到 ≠ 函式讀到**(那句 RAISE 的訊息文字裡有「採購紀錄」四個字而已)。這與 `feedback_assert-scope-only-after-reading-source-file` 記的「把『檔案提到路徑』當『載入』」是同一型 |

### -1d 座標核不到的(不折、也不丟)

**零條。** 26 條的引用位置我全部核到了對應內容(檔名雖然是編的,時間戳與行號都對得上)。
⇒ codex 這輪**沒有一條是幻覺**,只有檔名的呈現方式不可靠。

---

## §0 現況重數 v3(基準 `HEAD 9d38d4cf`)

### §0-A 掃描面(v2 八面 → v3 **九面**;新增第 9 面是 F-B 逼出來的)

| # | 面 | 命令 | 結果 |
|---|---|---|---|
| 1 | 建表與其後的**每一次改欄** | `grep -rn "ALTER TABLE public.order_item_procurement" supabase/migrations/` = 22 行(其中 8 行是註解) | §0-B |
| 2 | 三個動詞的 SQL 寫入 | 見 §0-C | 6 / 5 / 33 |
| 3 | 函式 | 見 §0-D | 不同名 14 支 |
| 4 | trigger | `grep -rn "CREATE TRIGGER\|CREATE CONSTRAINT TRIGGER" … \| grep -i "procurement\|receipt"` = 4 | §0-E |
| 5 | view | 交集 = 零 | 零 |
| 6 | 表級授權 | 讀建表檔 ACL 段 | §0-F |
| 7 | pg_cron | 2 檔皆不在提及本表的檔清單內 | 零 |
| 8 | 動態 SQL | **只掃了四種字面**(`EXECUTE format` / `EXECUTE '` / `EXECUTE v_` / `EXECUTE sql`)⇒ **不宣稱掃完**(codex #20 採納) | 2 行,皆非 DML |
| **9** | 🔴 **讀者面(v2 完全沒有這一面)** | 見 §0-I | **搜尋路徑會被硬刪打斷** |

### §0-B 表與約束(🔴 v2 只讀建表檔就寫,v3 逐片追改欄史)

**建表檔** `20260729020000_m4b_e10_a2_order_item_procurement.sql`:
- `:43` `order_item_id … ON DELETE RESTRICT`
- `:73-74` `CHECK (allocated_quantity BETWEEN **1** AND 100000)` ← 案 C′ 要動的就是這條
- `:76-77` `CHECK (received_quantity BETWEEN 0 AND allocated_quantity)`
- `:186` 子表 `procurement_id … ON DELETE RESTRICT`
- ~~`:69-70` `UNIQUE (order_item_id, supplier_canonical_key)`~~ **已作廢**
- ~~`:178-181` receipts append-only~~ **已作廢**

**其後改過這張表的片(v2 全部漏讀,這是 v2 最大的方法缺陷)**:

| 片 | 改了什麼 | 對本 plan 的影響 |
|---|---|---|
| `20260801150000_…s1b…:116-143` | `DROP COLUMN supplier_name, supplier_canonical_key` → `ADD COLUMN supplier_id uuid NOT NULL` FK→`suppliers(id)`;業務鍵改 **`UNIQUE (order_item_id, supplier_id)`** | 改變案 B 的撞鍵成本 |
| 🔴 `20260807130000_…a9b2_m…:80-82` | `ADD COLUMN supplier_order_no_upper text **GENERATED ALWAYS AS (upper(supplier_order_no)) STORED**` | **本表有 generated column** ⇒ audit before-image 不能原樣 INSERT 回去(codex #6) |
| `20260810230000_…352a1…:70-98` | 子表加 `surplus_quantity`;`quantity` CHECK 放寬成 **`0..100000`**;加 `quantity+surplus ≥ 1` | 「有沒有到貨」不能只看 `quantity>0` |
| `20260810233000_…352a2…:45-50` | 子表 COMMENT 逐字改成「**不再是 append-only**」(提供 `admin_delete_item_receipt`) | v2 引用的 append-only 字面作廢 |

### §0-C 三個動詞(`HEAD 9d38d4cf` 實跑)

`DELETE = 6` / `UPDATE = 5` / `INSERT = 33`(各以 `| wc -l` 取值,不是眼睛數)。

⚠️ 量具兩個天花板(v2 已記,v3 保留):**比目標寬**(會一併命中 `_receipts` 子表:6 行 DELETE 裡 2 行是子表,打到 parent 的 4 行 = 2 probe + 2 註解);**比目標窄**(看不到動態 SQL,而動態 SQL 我只掃了四種字面 ⇒ **未宣稱掃完**)。

### §0-D 函式(🔴 先定義量測單位再給數字)

- **不同名函式 = 14 支**(`… | sort -u | wc -l`,命令逐字在 §-1b F-D)
- CREATE FUNCTION **敘述句 = 19 句**(含同名改版)
- (檔, 函式) **對 = 16 對**(v2 表格列的就是這個)

🔴 **v2 §0-D 表格有一列是錯的**:`pcm_suppliers_block_delete` 我寫「讀本表擋刪供應商」——
實際函式體(`20260801140000:106-108`)只有一句無條件 `RAISE EXCEPTION`,**沒有讀本表**。
我的 `awk` 只證「這個檔提到本表」,提到的地方是那句 RAISE 的**訊息文字**。**「檔案提到」≠「函式讀到」。**

⇒ 真正對本表有 SQL 動作的函式,重列如下(逐支開檔核過函式體):

| 函式 | 動作 |
|---|---|
| `admin_upsert_item_procurement`(現行版 `20260806200000:79`) | **INSERT / UPDATE**(唯一應用寫入口) |
| `pcm_a4a_receipts_received_sync`(`20260803140000:258`) | **UPDATE**(僅 `received_quantity`,旗標路徑) |
| `pcm_a4a_recompute_order_item_summary`(現行版 `20260806180000:180`) | 讀 |
| `pcm_a4a_procurement_summary_recompute`(`20260803140000:220`) | 讀(trigger 入口) |
| `pcm_a4a_received_quantity_guard`(`20260803140000:195`) | 守門(擋直寫 `received_quantity`,P4A01) |
| `pcm_a2b1_procurement_allocation_guard`(`20260803130000:102`) | 讀(跨列總量守門) |
| `admin_cancel_order`(a8a1/a8a2) | 讀 |
| `admin_record_item_receipt` / `admin_delete_item_receipt` | 只動子表 |
| `admin_search_orders`(現行版 `20260812130000`) | 讀(🔴 見 §0-I) |
| `pcm_suppliers_block_delete` | **不碰本表**(v2 誤列) |

⇒ **對 parent 表零 DELETE writer。** 這句話的作用域 = 上表逐支開檔核過的函式體。

### §0-E trigger(四支;數法與天花板同 v2,此處不重述)

parent 三支(`allocation_guard_ac` AFTER I/U、`received_quantity_guard_bt` BEFORE I/U、`summary_recompute_zc` AFTER **I/U/D**)+ 子表一支(`receipts_received_sync_ac` AFTER I/U/D)。
`summary_recompute_zc` 的 DELETE 分支逐字在 `20260803140000:239-240`。

### §0-F 表級授權

`20260729020000:167-168` service_role 只有 SELECT;同檔 `:269-311` 自帶 fail-closed 斷言。
⇒ 應用層物理上刪不掉本表。誠實邊界(owner / SECDEF / 持 owner 憑證)照 `20260803160000:90-91` 字面。

### §0-G 應用層

唯一寫入呼叫端 `apps/admin/src/lib/orders/procurement-repository.ts:144-184`。讀模型投影**含列 id**(`mappers/order-procurement.ts:58`、`packages/domain/src/order/types.ts:554`)⇒ 撤銷入口可掛在任意一列。

### §0-H 既有交辦(v2 引用的那句,v3 重新讀完整)

`20260803160000:80-84` 的**主句是否定**:「本片刻意不做(不是忘記)· **不做 DELETE(採購事實不刪**;改派供應商 = 另建一列)」。
括號裡的「當日出路 = owner 手動 DELETE」是**災難日的 break-glass**,不是產品語意的授權。
⇒ 🔴 **v2 §3 理由① 把 break-glass 當設計授權,是誤讀。撤回。**

### §0-I 🔴 讀者面(v3 新增;F-B 逼出來的)

| 讀者 | 位置 | 硬刪之後會怎樣 |
|---|---|---|
| **跨單搜尋(供應商單號)** | `20260812130000_…fuzzy…:368-375`,`JOIN order_item_procurement` 後對 `supplier_order_no` 正規化 LIKE | 🔴 **那張訂單再也搜不到**。而供應商手上還拿著那個單號 |
| 訂單明細採購區塊 | `mappers/order-procurement.ts` | 列消失(這是要的) |
| 摘要三軸 | A4a | 自動重算(這是要的) |
| 到貨登錄畫面 | `receipt-panel.tsx` | 該供應商的列消失 |
| 取消守門 | a8a1 `:217-218` / a8a2 `:380-413` | 讀不到已刪的列 ⇒ 取消閘變寬(方向 = 放行,不是攔截)⚠️ |

⚠️ 最後一列是我自己在補讀者面時發現的,**不在 codex 的 26 條裡**:硬刪會讓「已到貨不可取消」的判斷少看到一列。
今日無實害(有到貨的列刪不掉),但它是「刪除會讓守門看不到證據」的一般形狀,列進案 A 的成本。

---

## §1 四案 + 一個新案(v2 的三案對比整份作廢重算)

> v2 用兩把尺選案:①「改動既有物件幾支」②「下游備好了沒」。**兩把尺都被 F-A / F-B 打斷。**
> v3 換一組尺,而且每一項都寫得出依據:
> **(a) 會不會廢掉既有證明 (b) 會不會打斷既有讀者 (c) 改幾個生產物件 (d) 員工自己救不救得回來 (e) 額度有沒有真的放出來**

| | **A 硬刪列** | **B 軟作廢(新欄)** | **C 額度歸零(經 A5a)** | **🆕 C′ 額度歸零(窄 RPC)** | **D void ledger(codex 提)** |
|---|---|---|---|---|---|
| (a) 廢掉既有證明? | 🔴 **是** —— A5a 並發證明明寫依賴無 DELETE writer(`20260806200000:433,450-451`) | ✅ 否(無 DELETE) | ✅ 否 | ✅ 否 | 🔴 **是**(仍是 DELETE) |
| (b) 打斷既有讀者? | 🔴 **是** —— 供應商單號搜尋(`20260812130000:368-375`);取消守門少看一列 | ✅ 否 | ✅ 否 | ✅ 否 | 🟡 部分(ledger 要另外接進搜尋才補得回來) |
| (c) 改幾個生產物件 | A5a(補證明)+ 新 RPC + 搜尋 = **3** | A2b1 + A4a + A5a + 業務鍵 + 新欄 = **5** | A5a(放寬 0)+ CHECK = **2** | **CHECK 1 個 + 新 RPC**(A5a/A2b1/A4a 皆不動)= **1 改 + 1 新** | A5a + 新表 + 新 RPC + 搜尋 = **4** |
| (d) 員工救得回? | 🔴 否(要工程師從 audit 手工重建,而且有 generated column) | ✅ 是 | ✅ 是(把件數改回來) | ✅ **是**(走既有表單改回 N) | 🔴 否 |
| (e) 額度真的放出來? | ✅ | ✅(要改 A2b1 才成立) | ✅ **免改**(A2b1 `:125-129` 對調降本來就 skip) | ✅ **免改** | ✅ |
| 撞業務鍵? | 不會 | 🔴 會(`UNIQUE(order_item_id, supplier_id)` 不含作廢旗標,`20260801150000:143`)⇒ 要改成 partial unique | 不會(同一列) | 不會 | 不會 |
| 冪等 | 🔴 要另想(audit 不可靠,F-C) | ✅ 欄位自身 | ✅ upsert 天然 | ✅ **UPDATE 到 0 天然冪等** | ✅ ledger |
| generated column 問題 | 🔴 有(還原) | ✅ 無 | ✅ 無 | ✅ **無** | 🔴 有 |

### 為什麼會冒出 C′,以及它跟 C 差在哪

C 的成本全部來自「要改 A5a 才能讓它收下 0」。但**撤銷根本不需要經過 A5a** ——
它只要把 `allocated_quantity` 寫成 0。⇒ **C′ = 一支只會把額度降到 0 的窄 RPC**,A5a 一個字都不動。

⚠️ A9h-M `20260806200000:27` 有一句反對窄版 patch RPC:「窄版仍必須寫 `allocated_quantity` ⇒ 必然複製 A2b1 的 P2B01 catch」。
**那句對 C′ 不成立**:A2b1 只在 **INSERT / 調升 / 換 parent** 時守門(`20260803130000:125-129` skip 分支逐字),
**降到 0 是調降 ⇒ 直接 `RETURN NULL`,永遠不會拋 P2B01** ⇒ 沒有要複製的 catch。
🔴 這是我**開檔核過 skip 分支的實體條件**才敢寫的,不是「應該不會」。

### C′ 的成本與風險(不藏)

1. **要 ALTER 一張已 apply 的表的 CHECK**(`allocated_range` 由 `1..100000` 改 `0..100000`)。
   **有同款先例**:`20260810230000:89-98` 對子表 `quantity` 做過一模一樣的事(1→0),理由也一樣(舊下界把真實業務擋掉)。
2. **`0` 這個值被賦予「已撤銷」的語意 = 隱式編碼。** 這是 C′ 最該被打的地方:
   一個數量欄兼差當狀態旗標,將來要區分「撤銷」與「暫時歸零」就沒有位置。
   ⇒ 緩解:`reply_status` 已有 allowlist,可同時寫入專屬值;但那要動 CHECK 的 enum ⇒ **列成 Q4 給 Sean/審查者裁**,我不自己決定。
3. **受收後不能歸零**:`received_range CHECK (received_quantity BETWEEN 0 AND allocated_quantity)` ⇒ 有到貨就歸不了零(23514)。
   這與案 A 被 FK RESTRICT 擋是**同一個前提**,不是 C′ 額外的限制。
   🔴 且照 codex #7 的教訓:**要 catch 23514 並翻譯**,不能只靠前置查詢(併發插入的 receipt 會從檢查與寫入之間鑽過去)。
4. **搜尋語意**:列留著 ⇒ 供應商單號還搜得到那張訂單。**這是 C′ 對 Sean 的實際好處**(供應商拿著單號打來時他找得到),不是副作用。

---

## §2 v3 推薦:**案 C′**,並附一句我自己的反對意見

**推薦理由(每條對應 §1 的尺)**:
(a) 不廢任何既有證明 (b) 不打斷任何既有讀者 (c) 生產物件動最少 (d) 員工自己救得回來 (e) 額度免改守門就放得出來。

**我自己對 C′ 最大的反對意見**:它把「撤銷」這個狀態塞進一個數量欄(§1 風險 2)。
如果 Sean 之後要問「這筆是撤銷還是還沒談攏」,C′ 答不出來 —— 那時要補的就是案 B 的欄位。
⇒ **C′ 是「先止痛且不欠技術債的最小解」,不是「終局解」。** 終局解是 B,而 B 的成本現在還不值得付。

---

## §3 要改什麼(以 C′ 為準)

1. **migration**:`ALTER TABLE … DROP CONSTRAINT order_item_procurement_allocated_range` → `ADD CONSTRAINT … CHECK (allocated_quantity BETWEEN 0 AND 100000)`(照 `20260810230000:89-98` 的形狀,含「既有列不得違反」的 fail-closed 前提)。
2. **新 owner RPC** `admin_void_item_procurement(p_procurement_id uuid, p_actor text, p_reason text, p_request_id text)`:
   隔離閘 → actor/request_id 正規化(**逐字照抄** `20260810233000:296-345`,不自己重寫)→ `p_reason` 必填(codex #5)→ 鎖 procurement 列 NKU → 前置查 receipts(`quantity` 與 `surplus_quantity` **兩個都看**,codex #4)→ `UPDATE … SET allocated_quantity = 0` → **catch 23514 翻成 `HAS_RECEIPTS`**(codex #7)→ 稽核 **在 UPDATE 成功之後**寫(codex #C,形狀對齊 `20260810233000:436`)。
   固定碼:`VOIDED` / `ALREADY_VOIDED`(`allocated_quantity` 已是 0)/ `PROCUREMENT_NOT_FOUND` / `HAS_RECEIPTS`。
   🔴 **冪等不靠 audit**:`ALREADY_VOIDED` 由**列上的值**判定 —— 這是 C′ 相對 A 的結構性優勢,F-C 整條在 C′ 下不存在。
3. **應用層**(片 2b,**apply 之後才動**):授權必須是 action 第一句(codex #8)、ownership 三段交叉檢查(codex #9)、4 碼窮盡、`HAS_RECEIPTS` 原文照畫。
4. **UI**:額度 0 的列顯示成「**已撤銷**」而不是「0 件」,並保留「改回來」的入口。

**rollback**:`DROP FUNCTION admin_void_item_procurement(...)` + CHECK 改回 `1..100000`
(⚠️ **改回去之前要先確認沒有 `allocated_quantity = 0` 的列**,否則 `ADD CONSTRAINT` 會失敗 —— 這是真的回頭路成本,寫進 migration 檔頭)。

---

## §4 驗收與負測

沿用 v2 §7 的三類格(結構 / 正向 / 負向)+ 突變靶,並依 codex #10-19 擴充:

- **結構**:前置檢查由 8 列擴成 **13 列**(見 §5),trigger 改比 `pg_get_triggerdef` 全文、FK 改比**具名**約束、加驗 RLS/PUBLIC/audit ACL/SECDEF owner。
- **正向**:歸零後 `ordered_quantity` 下降;歸零後對的那家建得起來(**負對照:不歸零就先建 ⇒ `OVER_ALLOCATION`**);歸零後供應商單號**仍搜得到**(C′ 的賣點要有格子頂著)。
- **負向**:①有到貨 ⇒ `HAS_RECEIPTS`(含 `quantity=0 / surplus>0` 的那種)②**併發**:檢查後、UPDATE 前插入 receipt ⇒ 必須紅在翻譯過的碼、不是裸 23514 ③隔離閘 ④actor/request_id 四種壞形狀實跑 ⑤audit 被吞 ⇒ 整筆 rollback ⑥成功時 audit **恰一筆**且逐欄可比對。
- **app**:denied-no-RPC、跨訂單 id 竄改、double submit、失敗不得 revalidate。
- **突變靶**:每一道守門一發,先證突變真的套上了才談紅綠。

🔴 **v2 §8 那四樣「不准放進誠實缺口」的維持不變**,並依 codex #14 補一條:**N7 那種「骨架本身跑不起來」的錯,不算誠實缺口,算沒寫完。**

---

## §5 附錄 A — apply 前置唯讀檢查(v3:8 列 → 13 列)

> v2 那八列的**方法**(逐列反向突變證明零恆真格)已在 PG 17.10 拋棄式庫實跑通過,方法保留。
> codex #10-13 打的是**覆蓋範圍**:我證了「這一列被破壞會紅」,沒證「還有哪些破壞方式不會紅」。⇒ 擴列。
> 🟢 **狀態更正:13 列版本輪已實跑**(下面 §5b 有逐發突變紀錄)。本段初稿寫「尚未實跑」,寫完之後我就跑了 —— 保留這句話會變成過期的自我保守。

新增/改寫的五列:
| 列 | 改成什麼 | 補的是哪個破壞方式 |
|---|---|---|
| 1-3 | trigger 由「數名稱」改成**比 `pg_get_triggerdef()` 全文**(含 `AFTER INSERT OR UPDATE OR DELETE` 事件字面)+ 比 `pg_proc.prosrc` 是否含 `TG_OP = 'DELETE'` 錨點 | DELETE 分支被移除而八列仍全綠 |
| 7 | 由「任意 RESTRICT FK 數」改成**具名**:`conname = 'order_item_procurement_receipts_procurement_id_fkey'` 且 `confdeltype='r'` | 真正那條改 CASCADE、另留無關 RESTRICT FK 仍通過 |
| 9(新) | `relrowsecurity = true` 且 `pg_policies` 零列 且 PUBLIC 零授權 | RLS 被關 / PUBLIC 拿到 SELECT ⇒ 供應商資料外洩 |
| 10(新) | `admin_audit_log` 的 ACL(service_role 應只有 INSERT)+ 無 UPDATE/DELETE 授權 | #439 那條防線是否還在 |
| 11(新) | 本片新函式的 SECDEF owner = 表 owner | 函式可呼叫但 runtime `42501` |
| 12(新) | `allocated_range` CHECK 的**現行述詞字面** | C′ 的 apply 是否真的生效 / 是否被別人改過 |
| 13(新) | `supplier_order_no_upper` 仍是 generated column | 還原程序的前提 |


### §5a 完整 SQL(Sean 一次複製、一次貼上;全部是 `SELECT`,不會改到任何資料)

> 貼進 Supabase → SQL Editor → Run,把整張結果表貼回來。🔴 時機 = migration apply **之前**
>(第 10 列與第 13 列會因為 apply 而翻面,那是預期的)。

```sql
WITH chk(seq, item, actual, expected) AS (VALUES
  (1, '採購表 trigger:名稱＋時機＋事件＋對應函式',
      (SELECT coalesce(pg_catalog.string_agg(
                t.tgname || '=' || CASE WHEN (t.tgtype & 2) > 0 THEN 'B' ELSE 'A' END
                || CASE WHEN (t.tgtype & 4)  > 0 THEN 'I' ELSE '' END
                || CASE WHEN (t.tgtype & 16) > 0 THEN 'U' ELSE '' END
                || CASE WHEN (t.tgtype & 8)  > 0 THEN 'D' ELSE '' END
                || '/' || p.proname, ' | ' ORDER BY t.tgname), '(無)')
         FROM pg_catalog.pg_trigger t JOIN pg_catalog.pg_proc p ON p.oid = t.tgfoid
        WHERE t.tgrelid = 'public.order_item_procurement'::regclass AND NOT t.tgisinternal),
      'order_item_procurement_allocation_guard_ac=AIU/pcm_a2b1_procurement_allocation_guard | order_item_procurement_received_quantity_guard_bt=BIU/pcm_a4a_received_quantity_guard | order_item_procurement_summary_recompute_zc=AIUD/pcm_a4a_procurement_summary_recompute'),
  (2, '摘要重算函式體真的有 DELETE 分支',
      (SELECT (p.prosrc LIKE '%TG_OP%=%''DELETE''%')::text FROM pg_catalog.pg_proc p
        WHERE p.oid = 'public.pcm_a4a_procurement_summary_recompute'::regproc),
      'true'),
  (3, '採購表 trigger 全部在啟用狀態',
      (SELECT count(*)::text FROM pg_catalog.pg_trigger
        WHERE tgrelid = 'public.order_item_procurement'::regclass AND NOT tgisinternal AND tgenabled = 'O'),
      '3'),
  (4, '到貨表 trigger:名稱＋時機＋事件＋對應函式',
      (SELECT coalesce(pg_catalog.string_agg(
                t.tgname || '=' || CASE WHEN (t.tgtype & 2) > 0 THEN 'B' ELSE 'A' END
                || CASE WHEN (t.tgtype & 4)  > 0 THEN 'I' ELSE '' END
                || CASE WHEN (t.tgtype & 16) > 0 THEN 'U' ELSE '' END
                || CASE WHEN (t.tgtype & 8)  > 0 THEN 'D' ELSE '' END
                || '/' || p.proname, ' | ' ORDER BY t.tgname), '(無)')
         FROM pg_catalog.pg_trigger t JOIN pg_catalog.pg_proc p ON p.oid = t.tgfoid
        WHERE t.tgrelid = 'public.order_item_procurement_receipts'::regclass AND NOT t.tgisinternal),
      'order_item_procurement_receipts_received_sync_ac=AIUD/pcm_a4a_receipts_received_sync'),
  (5, '三個應用 role 對採購表的寫入權限(應為零)',
      (SELECT count(*)::text FROM (VALUES ('anon'), ('authenticated'), ('service_role')) AS r(rn)
        CROSS JOIN (VALUES ('INSERT'), ('UPDATE'), ('DELETE'), ('TRUNCATE')) AS p(pv)
        WHERE pg_catalog.has_table_privilege(r.rn, 'public.order_item_procurement', p.pv)),
      '0'),
  (6, 'service_role 讀得到採購表',
      (SELECT pg_catalog.has_table_privilege('service_role', 'public.order_item_procurement', 'SELECT')::text),
      'true'),
  (7, '採購表上非預期的授權對象(應為零)',
      (SELECT count(*)::text FROM pg_catalog.pg_class c
        CROSS JOIN LATERAL pg_catalog.aclexplode(c.relacl) AS a
        WHERE c.oid = 'public.order_item_procurement'::regclass
          AND a.grantee <> 0 AND a.grantee <> c.relowner
          AND pg_catalog.pg_get_userbyid(a.grantee) <> 'service_role'),
      '0'),
  (8, 'RLS 開著＋零 policy＋PUBLIC 零授權(兩張表一起看)',
      (SELECT (SELECT count(*) FROM pg_catalog.pg_class
                WHERE oid IN ('public.order_item_procurement'::regclass,
                              'public.order_item_procurement_receipts'::regclass)
                  AND relrowsecurity)::text || '/' ||
             (SELECT count(*) FROM pg_catalog.pg_policies
               WHERE schemaname = 'public'
                 AND tablename IN ('order_item_procurement','order_item_procurement_receipts'))::text || '/' ||
             (SELECT count(*) FROM pg_catalog.pg_class c
               CROSS JOIN LATERAL pg_catalog.aclexplode(c.relacl) AS a
               WHERE c.oid IN ('public.order_item_procurement'::regclass,
                               'public.order_item_procurement_receipts'::regclass)
                 AND a.grantee = 0)::text),
      '2/0/0'),
  (9, '到貨表那條**具名**外鍵是 ON DELETE RESTRICT',
      (SELECT coalesce((SELECT confdeltype::text FROM pg_catalog.pg_constraint
                         WHERE conrelid = 'public.order_item_procurement_receipts'::regclass
                           AND conname = 'order_item_procurement_receipts_procurement_id_fkey'), '(約束不存在)')),
      'r'),
  (10, '採購件數 CHECK 的現行述詞',
      (SELECT coalesce((SELECT pg_catalog.pg_get_constraintdef(oid) FROM pg_catalog.pg_constraint
                         WHERE conrelid = 'public.order_item_procurement'::regclass
                           AND conname = 'order_item_procurement_allocated_range'), '(約束不存在)')),
      'CHECK (((allocated_quantity >= 1) AND (allocated_quantity <= 100000)))'),
  (11, 'supplier_order_no_upper 仍是產生欄(還原程序的前提)',
      (SELECT coalesce((SELECT attgenerated::text FROM pg_catalog.pg_attribute
                         WHERE attrelid = 'public.order_item_procurement'::regclass
                           AND attname = 'supplier_order_no_upper' AND NOT attisdropped), '(欄不存在)')),
      's'),
  (12, '稽核表:service_role 的權限(應只有 INSERT)',
      (SELECT (SELECT count(*) FROM (VALUES ('SELECT'),('UPDATE'),('DELETE'),('TRUNCATE')) AS p(pv)
                WHERE pg_catalog.has_table_privilege('service_role','public.admin_audit_log',p.pv))::text
             || '/' || pg_catalog.has_table_privilege('service_role','public.admin_audit_log','INSERT')::text),
      '0/true'),
  (13, '這次要新建的函式目前不存在(撞名就停)',
      (SELECT count(*)::text FROM pg_catalog.pg_proc
        WHERE proname IN ('admin_void_item_procurement','admin_delete_item_procurement')
          AND pronamespace = 'public'::regnamespace),
      '0')
)
SELECT seq AS "#", item AS "檢查項", actual AS "實際看到的", expected AS "應該是",
       CASE WHEN actual = expected THEN '✅ 通過' ELSE '🔴 停下來' END AS "判定"
  FROM chk ORDER BY seq;
```

**看到什麼算通過 / 看到什麼要停**

| 情況 | 意思 | 怎麼辦 |
|---|---|---|
| 13 列全 ✅ | 正式庫與我依 migration 檔算出來的完全一致 | ✅ 可以 apply |
| 1 / 2 / 3 / 4 🔴 | trigger 的名稱、時機、事件、對應函式或函式體對不上 | 🔴 **停**。§1 的整組成本比較都建立在這幾支 trigger 的行為上 |
| 5 / 6 / 7 / 8 🔴 | 授權或 RLS 被動過 ⇒「應用層動不了這張表」的前提可能不成立;第 8 列紅還代表**供應商資料可能外洩** | 🔴 **停**,這是 §0-F 的地基 |
| 9 🔴 | 「有到貨就動不了」那道物理防線不在了 | 🔴 **停** |
| 10 🔴 | 件數 CHECK 的述詞跟預期不同(可能已經被改過、或這片已經 apply 過) | 🔴 **停**,不要重複 apply |
| 11 🔴 | 產生欄不見了 ⇒ 還原程序的前提變了 | 🔴 **停** |
| 12 🔴 | 稽核表權限被放寬 | 🔴 **停**(#439 那條防線) |
| 13 🔴 | 已有同名函式 | 🔴 **停**,先問清楚,不要覆蓋 |
| 整段報錯 | 物件不存在 | 🔴 **停**,把錯誤原文貼回來 |

### §5b 這 13 列的實跑紀錄(2026-08-13,PG 17.10 拋棄式庫,跑完 `rm -rf` 零殘留)

**兩件事分開講**(方法沿用 v2,codex 沒有打方法、打的是覆蓋範圍):

1. **可執行性**:stub 庫照真表形狀建(含 `GENERATED ALWAYS AS … STORED` 產生欄、具名 FK、四支 trigger、RLS、三個 role 與稽核表 ACL)⇒ 13 列全回值、零錯誤。
2. **判別力**:**15 發突變,每一發都只讓「該紅的那一列」翻紅**(每發包在 `BEGIN…ROLLBACK` 內,彼此獨立):

   | 突變 | 期望紅 | 實際紅 |
   |---|---|---|
   | M1 trigger 事件砍掉 DELETE(**名稱不變**) | 1 | 1 ✅ |
   | M2 函式體移除 `TG_OP='DELETE'` 分支 | 2 | 2 ✅ |
   | M3 trigger 改指別支函式 | 1 | 1 ✅ |
   | M4 具名 FK 改 `CASCADE` | 9 | 9 ✅ |
   | M5 真 FK 改 `CASCADE` **且另加一條無關的 RESTRICT FK** | 9 | 9 ✅ |
   | M6 關掉 RLS | 8 | 8 ✅ |
   | M7 PUBLIC 拿到 SELECT | 8 | 8 ✅ |
   | M8 稽核表給 service_role SELECT | 12 | 12 ✅ |
   | M9 產生欄改成普通欄 | 11 | 11 ✅ |
   | M10 CHECK 述詞改成 `0..100000` | 10 | 10 ✅ |
   | M11 先建撞名函式 | 13 | 13 ✅ |
   | M12 停用一支 trigger | 3 | 3 ✅ |
   | M13 `GRANT DELETE` 給 service_role | 5 | 5 ✅ |
   | M14 `REVOKE SELECT` service_role | 6 | 6 ✅ |
   | M15 建 outsider role 授 SELECT | 7 | 7 ✅ |

   🔴 **M1 / M3 / M5 正是 codex #10-13 指名的三個破壞方式**(改事件、換函式、拿無關 FK 混淆),
   v2 那八列**全部擋不住**這三發;v3 三發都紅。

⚠️ **這次沒證到的,逐條寫出來**:
- **第 4 列(子表 trigger)沒有單獨突變**(它與第 1 列是同一個構造,M1/M3 已證該構造有效)⇒ **12/13 列有專屬突變**,不宣稱 13/13。
- stub 表是空殼(欄位不完整、無真資料)⇒ **這次實跑不背書任何關於正式庫的斷言**,那正是要 Sean 跑一次的理由(§6 G1)。
- 突變只涵蓋「我想得到的破壞方式」。**這張表證明的是「這 15 種破壞會被抓到」,不是「所有破壞都會被抓到」。**

### §5c v2 附錄 B(負測骨架)的處置 —— 🔴 撤下,不是刪掉

v2 §13 的四個負測骨架是**為案 A(DELETE)寫的**;v3 推薦換成 C′(UPDATE 到 0)⇒ 那組骨架的操作對象已經不存在。
留著會變成「看起來有測試計畫、其實測的是被否決的方案」。

⇒ **處置**:骨架撤下,codex #14 / #15 / #18 / #19 對它們的四條 finding **以「要求」的形式折進 §4**
(N7 不能用 heredoc、B4 要驗恰一筆且逐欄比對、fixture 查不到合格訂單要 RAISE、N5 四發要實跑、N6 要驗 audit 內的正規化值)。
**新骨架等 Sean 拍完 Q1 再寫** —— 案別沒定就寫骨架,是第二次為被否決的方案寫測試。
🔴 這條**不是誠實缺口**(§6 那句「骨架寫錯導致跑不起來不算誠實缺口」同樣適用),是**排序**:先定案、再寫測試。


---

## §6 誠實缺口(v3;只收真的構造不出來的)

| # | 缺口 | 為什麼構造不出來 |
|---|---|---|
| G1 | 正式庫實際 ACL / trigger / CHECK 狀態未連線核對 | 我沒有正式庫連線 ⇒ 已寫成 apply 前置閘要 Sean 跑 |
| G2 | `actor` 是自陳身分(E8-B 未開工) | 照 `20260803160000:94-95` 字面 |
| G3 | owner / SECDEF / 持 owner 憑證仍可直寫本表 | 在權限天花板之上 |
| G4 | `session_replication_role = replica` 可跳過 trigger | 同 `20260803130000:85` |
| G5 | **動態 SQL 未宣稱掃完**(只掃四種字面) | 窮舉不完;降級成「未宣稱」而非「已掃完」 |

🔴 **不准放進誠實缺口的(維持 v2 四樣 + codex 新增一樣)**:併發雙寫、隔離閘、audit 逐欄比對、request_id 零寬正規化、**以及「骨架寫錯導致跑不起來」**。

---

## §7 待 Sean 拍板(v3;Q1 選項與推薦都變了,Q4 是新的)

```
Q1:採購撤銷用哪一案?(🔴 我上一版推薦 A,這一版改推 C′,理由見下)
A: A|B|C'
  C' = 把那筆採購的「件數」歸零、列留著(推薦)
       好處:額度馬上放出來、供應商單號還搜得到那張訂單、你自己按一下就能改回來
       代價:畫面上那列還在(會標「已撤銷」)
  A  = 整列刪掉
       🔴 我上一版推薦這案,現在撤回:①它會讓另一支已上線函式的正確性論證失效
          ②刪掉之後你用供應商單號就搜不到那張訂單了
  B  = 加一個「作廢」欄位
       最完整,但要改五個已經上線的東西,現在不值得付

Q2:撤銷之後,那筆採購的內容還要不要在畫面上看得到?
A: A|B
  A = 看得到(標「已撤銷」)—— C' 的預設
  B = 不要看到 —— 這會把答案推回案 A

Q3:如果那筆採購已經登錄過到貨,撤銷該怎樣?
A: A|B
  A = 擋掉,叫他先去撤到貨(推薦;撤到貨的入口片 1 已經做好了)
  B = 一起撤掉

Q4(新):撤銷這件事要不要在「回覆狀態」欄也留一個專屬值?
A: A|B
  A = 不要,件數 0 就代表撤銷(推薦;最少改動)
     代價:將來要分「撤銷」和「談不攏暫時歸零」會分不出來
  B = 要,多一個狀態值
     代價:要動一條已上線的 CHECK enum
```

---

## §8 相關既有紀錄與連動面

- memory `project_0812-sean-order-ui-workflow-and-undo-needs` / `project_admin-ux-operation-intuitiveness` / `feedback_app-layer-must-not-ship-before-migration-apply` / `feedback_honest-gap-is-for-unconstructible-not-for-cheap`
- 🔴 本輪新踩到的病根(建議升進 `feedback_assert-scope-only-after-reading-source-file` 當新形狀,由主視窗裁):
  ① **查了現況、沒查現況的修訂史**(建表檔讀完 ≠ 這張表的現況;S1b/a9b2-M/352a1/352a2 四片各改過它一次)
  ② **「檔案提到」≠「函式讀到」**(`pcm_suppliers_block_delete` 誤列)
  ③ **給數字前先定義量測單位**(「函式幾支」三個人三個答案,因為單位沒定義)

— END —
