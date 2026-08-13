# 採購撤銷 plan(採購「改軟」線 片 2)

> **版本:** v5(Sean 2026-08-13 拍板後定案版;v4 = R1 26 條 + R2 23 條兩輪全折)。
> **狀態:** 🟢 **方案已定案(Q1=E)。SQL / 骨架 / migration 待主視窗點頭後開始寫,現在仍零 code。**
>
> ### 🏁 Sean 2026-08-13 拍板(逐字,不轉述)
> ```
> q1: a
> q2: a, 但是不要增加太多欄位
> q3: A, 但是到貨的商品要可以轉去庫存那邊
> ```
> - **Q1 = 案 E**(照 shipments 作廢樣板)。
> - **Q2 = 要能取消撤銷**,🔴 附加硬約束「**不要增加太多欄位**」⇒ **本片只加兩欄**(§3 第 1 點)。
> - **Q3 = 擋掉、先撤到貨**,🔴 附加「**到貨的商品要可以轉去庫存那邊**」⇒ **超出本片片界,不做**,
>   但寫成誠實邊界 G7 + 立 backlog(§5)。落點待 Sean 與既有 Q6=A / Q11 拍板釐清(主視窗處理中)。
> - **Q4 = 作廢兩次 ⇒ 拒絕**(主視窗裁,照 `20260807200000:39-41` 既有拍板)。
>
> **片型:** 🔴 高風險片(鐵則 12③)。
> **上游拍板:** Sean 2026-08-13 凌晨 Q6=A(只做採購「改軟」)/ Q10=A(採購改軟三片先做)。
> **需求原文(Sean 2026-08-12 逐字):**「然後採購也要可以取消,有可能 key 錯資訊之類」。
>
> 🔴🔴 **推薦案第二次換:v2 案 A(硬刪)→ v3 案 C′(額度歸零)→ v4 案 E(照 shipments 樣板作廢)。**
> 換的原因不是我改變口味,是**兩輪審查各打掉一個我沒查到的事實**:
> R1 打掉「案 A 不動既有物件」(它廢掉 A5a 的並發證明);R2 打掉「案 B 太貴」——
> **這個 repo 早就把「作廢」做過一遍了,而我三版都沒去查有沒有現成的。**
>
> **所有數字的基準 = `HEAD c7611b64`**(`git rev-parse --short HEAD` 實跑)。換 HEAD 就要重跑。

---

## §-1 R2 折疊台帳(23 條;12 MF + 8 important + 3 nit)

### -1a 🔴 F1 —— 最重的一條:我認,而且要說清楚我錯在哪一步

**事實(我自己 `ls` + `sed` 核過,不是轉抄 R2)**:這個 repo 已經有一整套「作廢」實作 ——

| 物件 | 位置 | 內容 |
|---|---|---|
| 配對 CHECK | `20260805170000_…s1a1_shipments.sql:149-151` | 逐字 `CHECK ((deleted_at IS NULL) = (void_reason IS NULL) AND (void_reason IS NULL OR NOT public.pcm_b2_is_blank(void_reason)))` |
| void RPC | `20260807200000_…w3c1_void_shipment.sql` | 9,974 bytes |
| unvoid RPC | `20260807210000_…w3c2_unvoid_shipment.sql` | 13,244 bytes |
| 併發 harness | `scripts/w6a-unvoid-race.sh` | 41,368 bytes |

⇒ 我 v2/v3 用「案 B 要改五個東西、現在不值得付」推掉的那個方案,**設計成本半個月前就付過了**。

🔴 **我錯在哪一步(精確版,不含糊)**:v2 我確實看了 shipments,但**只看它的「理由」就停手** ——
我寫的是「`deleted_at` 先例的**理由**不轉移(包裹編號永不重用)」。那句話**到今天仍然正確**。
錯的是我拿「理由不轉移」當成「**這個先例對我沒用**」的結論,然後**沒有再往下看它的實作**。
**理由不能轉移 ≠ 實作不能借用。**

**主視窗實數複驗(`git show <sha>:<plan> | grep -c`,三版逐版)**:

| 版本 | `void_shipment` | `20260807200000` / `20260807210000` | `shipments` | `deleted_at` |
|---|---|---|---|---|
| v1 `10a74c1c` | 0 | 0 | 1 | 1 |
| v2 `9d38d4cf` | 0 | 0 | 1 | 1 |
| v3 `c7611b64` | 0 | 0 | **0** | **0** |

⇒ 三版對那套實作全部 0 命中(F1 成立);v1/v2 各提過 `shipments` 一次(就是那句「理由不轉移」);
🔴 **v3 把那句也刪掉了** —— 我折 R1 的時候,連唯一還連著正解的那根線也一起剪掉了。
**這條寫進病根⑤。**

### -1b 其餘 22 條(逐條;✅ = 我開檔核到、成立)

| # | 摘要 | 核到了嗎 | 折法 |
|---|---|---|---|
| F2 | C′ 把撤銷原因放進 plan 自己剛判定不可信的儲存(audit) | ✅ 對照 `20260807200000` 樣板:理由是**寫在列上的配對欄** | **採納**。案 E 的 `void_reason` 在列上 ⇒ 自動解掉 |
| F3 | (d)「員工救得回」不成立:`allocated` 12→0,那個 12 只剩在 audit 裡 | ✅ | **採納**。C′ 在該欄應是 🟡 不是 ✅,而那是 C′ 勝出的四欄之一 ⇒ 整張對比表失效 |
| F4 | 13 列與 15 發突變全為案 A 而寫,C′ 的四個承重點零覆蓋 | ✅ 逐條核:第 1 列 `AIUD` 事件字面、第 2 列 `TG_OP='DELETE'` 錨點、M1/M2/M3 都指向 DELETE 路徑 | **採納**,見 §4b |
| F5 | 骨架用「為案 A 寫的」撤下,同一理由沒套用到附錄 A ⇒ 同一份 plan 兩套標準 | ✅ | **採納**,這條最刺,見 §4b |
| F6 | 承諾折了 SECDEF owner 那一列,SQL 裡沒有;§5 表格編號與 SQL 錯開一格 | ✅ 逐條數 SQL:8=RLS / 9=FK / 10=CHECK / 11=產生欄 / 12=audit ACL / 13=撞名,**SECDEF owner 一列都沒有** | **採納**。v4 刪掉那張會誤導的對照表,**SQL 本身是唯一權威** |
| F7 | 撤銷後的列仍是「登錄到貨」的合法入口 ⇒ 員工看到「超過訂購量」 | ✅ `receipt-repository.ts:359-378` `listProcurementChoices` **零過濾**;`20260811010000:193` 回 `QUANTITY_EXCEEDS_ALLOCATED` | **採納**。隱式編碼的第一個真實誤讀 |
| F8 | 為同一物理狀態新造 `HAS_RECEIPTS`,與既有 `ALLOCATED_BELOW_RECEIVED` 重複 | ✅ `20260806200000:380-381` | **採納**,案 E 沿用既有碼、不新造 |
| F9 | 只反駁 A9h-M 四個理由裡的一個,就宣告「那句對 C′ 不成立」 | ✅ `20260806200000:27-29` 四項 | **採納**。與 §-1a 同形狀:反駁一條就宣告整段不成立 |
| F10 | 新寫入口沒有鎖序合約、沒有 `SET CONSTRAINTS` 的立場 | ✅ 兩個兄弟樣板都明文表態(`20260810233000:370` 要 / `:102-109` 刻意不要) | **採納**,案 E 必須明文表態 |
| F11 | 回退腳本第一次被使用後就做不動了(CHECK 改不回去) | ✅ | **採納**,案 E 回退 = drop 欄位,數量欄完好 |
| F12 | §0-D「`admin_record_item_receipt` 只動子表」是錯的;病根①第五次發作 | ✅ `20260811010000:193` 讀 parent 的 `allocated_quantity`、`:184` 鎖 `order_items` | **採納**,見 §0-A |
| F13 | 新的尺剛好讓新推薦勝出;沒有一把尺量語意/稽核可信度/與既有慣例一致 | ✅ | **採納**,見 §1a:**尺先定完再套** |
| F14 | 「352a1 把子表 1→0」的類比不成立(它同時新增 `surplus_quantity` 承載語意) | ✅ `20260810230000:70-98`;原始意圖 `20260729020000:72` 逐字「allocated 至少 1(建了卻負責 0 件沒有意義)」 | **採納** |
| F15 | 「已作廢再作廢回冪等碼」與 repo 已拍板立場相反 | ✅ `20260807200000:39-41` 逐字「**不做成 no-op**……第二次帶的是另一個理由,靜默吞掉等於丟掉稽核資訊」 | **採納**,案 E 照樣板人話拒絕 |
| F16 | C′ 的賣點(單號還搜得到)同時是新的誤讀面 | ✅ `20260812130000:370` JOIN 不看 `allocated_quantity` | **採納** —— 案 E 下同樣要處理,見 §3 第 5 點 |
| F17 | 「改回來」不是穩定救濟(`< 1` 擋、表單預填 `"0"`、期間額度被吃掉) | ✅ `20260806200000:222-224` + `procurement-view.ts:95` | **採納** |
| F18 | 讀者面沒數完,而且補的是**上一案**的讀者 | ✅ 四個新讀者逐一核到 | **採納**,見 §0-C;並立成常設紀律 |
| F19 | 撤銷後 `reply_status` 留原值 ⇒「已確認 · 訂購 0」自相矛盾 | ✅ `item-procurement-section.tsx:129` | **採納**,案 E 下由 `voided_at` 決定整列呈現 |
| F20 | 突變表沒有一格驗「突變真的套上去了」 | ✅ 我確實沒寫那一格 | **部分採納**,誠實說明見 §4c |
| F21-F23(nit + 方法) | 讀者面那格寫「見 §0-I」沒有可重跑命令 ⇒ F18 就是那樣漏的 | ✅ | **採納**,§0-C 每類讀者都附命令與**輸出筆數** |

**核不到的:零條。** R2 引用的位置我全部開檔核到對應內容。

---

## §0 現況(v4 重建,v5 沿用並補一條隱藏依賴)

### §0-A 修訂鏈(主視窗交辦的前置動作:先列完整,再逐支確認)

```bash
grep -l 'order_item_procurement' supabase/migrations/*.sql | sort
```

**輸出 = 21 支**(2026-08-13 於 `c7611b64` 實跑):

```
 1 20260729020000_m4b_e10_a2_order_item_procurement.sql          ← 建表
 2 20260729030000_m4b_e10_a3_order_notes.sql
 3 20260730150000_m4b_e10_a1_order_item_summary_columns.sql
 4 20260801140000_m4b_e10_s1a_suppliers.sql
 5 20260801150000_m4b_e10_s1b_procurement_supplier_fk.sql        ← 換供應商欄 + 業務鍵
 6 20260803130000_m4b_e10_a2b1_procurement_allocation_guard.sql
 7 20260803140000_m4b_e10_a4a_quantity_summary_recompute.sql
 8 20260803160000_m4b_e10_a5a_admin_upsert_item_procurement.sql
 9 20260804180000_m4b_e10_a8a1_admin_cancel_order.sql
10 20260805100000_m4b_e10_a8a2_partial_cancel.sql
11 20260806180000_m4b_e10_b2_s2b_shipped_recompute_wire.sql      ← A4a 現行版在這
12 20260806200000_m4b_e10_a9h_m_a5a_preserve_optional_fields.sql ← A5a 現行版在這
13 20260807130000_m4b_e10_a9b2_m_supplier_order_no_upper.sql     ← 產生欄(v2 漏讀)
14 20260809020000_m4b_e10_b2_w7d3_recompute_structural_anchors.sql
15 20260809180000_m4b_347_1_admin_search_orders.sql
16 20260809190000_m4b_e10_b2_w2_deferred_trigger_secdef.sql
17 20260810120000_m4b_347_3a_admin_search_orders_date_range.sql
18 20260810230000_m4b_e10_352a1_receipt_recording_schema.sql     ← 溢收欄 + CHECK 放寬
19 20260810233000_m4b_e10_352a2_receipt_write_rpcs.sql
20 20260811010000_m4b_e10_352c_item_level_room_guard.sql         ← 🔴 record 現行版在這(v3 漏讀)
21 20260812130000_m4b_347_fuzzy_admin_search_orders.sql          ← 搜尋現行版在這
```

🔴 **這 21 支 v1 就數出來了 —— 病不是「沒列出來」,是「列了沒讀」。** 這個區別很重要:
v2 漏 #13、v3 漏 #20,兩次都不是掃描面不足,是**掃完之後只挑自己認得的檔去讀**。
⇒ 常設紀律:**引用任何函式的行為之前,先回這張表確認「最後一次改它的是哪一支」。**

**現行版對照(逐支開檔核過函式體,不靠檔名猜)**:

| 函式 | 最後一次改它的片 | v2/v3 引的是 | 對不對 |
|---|---|---|---|
| `admin_upsert_item_procurement` | #12 `20260806200000:79` | #12 | ✅ |
| `pcm_a4a_recompute_order_item_summary` | #11 `20260806180000:180`(`sum(allocated)` 在 `:207`) | #11 | ✅ |
| `admin_record_item_receipt` | 🔴 **#20 `20260811010000:23`** | #19 | 🔴 **錯**(F12) |
| `admin_search_orders` | #21 `20260812130000` | #21 | ✅ |
| `admin_delete_item_receipt` | #19 `20260810233000:280` | #19 | ✅ |

🔴 **F12 的實際內容**:#20 的 `admin_record_item_receipt` **讀 parent 的 `allocated_quantity`**
(`:193` 逐字 `IF p_quantity > (v_proc.allocated_quantity - v_proc.received_quantity) THEN RETURN 'QUANTITY_EXCEEDS_ALLOCATED'`)
並在 `:184` 鎖 `order_items`。⇒ v3 §0-D 那句「只動子表」是錯的,而 **F7 那條誤導訊息就是這個漏讀的直接後果**。

### §0-A2 🔴 v5 開工前的複驗(主視窗交辦第 4 點;`c7611b64` 實跑)

案 E 要動的四個物件,逐一確認「最後一次改它的是哪一支」——
用 `grep -rn "FUNCTION public.<名字>" supabase/migrations/*.sql | grep -i "create\|drop" | sort` 逐支跑:

| 要動的物件 | 所有定義處 | 現行版 | 我要改的位置 |
|---|---|---|---|
| `pcm_a2b1_procurement_allocation_guard` | 只有 `20260803130000:102`(同檔 `:310` 是 down 註解) | `20260803130000` | `:144-146` `sum(p.allocated_quantity)` |
| `pcm_a4a_recompute_order_item_summary` | `20260803140000:140` → **`20260806180000:180`**(OR REPLACE) | `20260806180000` | `:207` `sum(p.allocated_quantity)` |
| `admin_upsert_item_procurement` | `20260803160000:107` → **`20260806200000:79`**(先 DROP `:75` 再 CREATE) | `20260806200000` | `:315` 存在性分流、`:435` unique_violation 名字比對 |
| `order_item_procurement_business_key` | `20260729020000:69` → **`20260801150000:143`**(先 DROP `:117` 再 ADD) | `20260801150000` | 改成 partial unique index |

⇒ **四支全部確認過,沒有第二個更晚的版本。** 這一段就是為了不再犯 F12 那型而跑的。

### §0-B 表與約束(v3 已修的保留,不重述)

FK RESTRICT(`:43` / `:186`)、`allocated_range 1..100000`(`:73-74`)、`received_range`(`:76-77`)、
業務鍵 `UNIQUE (order_item_id, supplier_id)`(`20260801150000:143`)、
產生欄 `supplier_order_no_upper`(`20260807130000:80-82`)、
子表已非 append-only(`20260810233000:45-50`)、子表 `quantity` 可為 0 + `surplus_quantity`(`20260810230000:70-98`)。

🔴 v4 新增一條(F14 逼出來的)`20260729020000:72` 逐字:**「allocated 至少 1(建了卻負責 0 件沒有意義)」**
—— 這是 `allocated_range` 下界的**原始設計意圖**,案 C′ 要推翻的正是它。

### §0-C 讀者面(🔴 F18 立的常設紀律:**換案就要重數讀者面**)

> **紀律**:讀者面不是「這張表有誰讀」數一次就好,是「**這個方案造出來的狀態,誰會讀錯**」。
> 換方案 = 換狀態 = 讀者面全部重數。v3 補的是「案 A 刪列會怎樣」的讀者,對 C′ / E 都不適用。

**三類讀者,各附可重跑命令與輸出筆數(`c7611b64` 實跑)**:

```bash
# R1 SQL 讀者(migration 內 FROM/JOIN 本表)
grep -rn "FROM public.order_item_procurement\b\|JOIN public.order_item_procurement\b" supabase/migrations/*.sql          # → 43 行
# R2 應用層直接查表
grep -rn "from('order_item_procurement')" apps/ packages/ --include="*.ts" --include="*.tsx" | grep -v '\.test\.'        # → 2 行
# R3 應用層消費 domain 讀模型
grep -rn "\.procurements\b\|allocatedQuantity" apps/admin/src packages/adapters/src packages/domain/src --include="*.ts" --include="*.tsx" | grep -v '\.test\.'   # → 28 行 / 13 檔
```

**案 E(留一列、掛 `voided_at`)之下,每個讀者要怎麼處理**:

| # | 讀者 | 位置 | 案 E 下要做什麼 |
|---|---|---|---|
| 1 | A2b1 跨列總量守門 | `20260803130000:144-146` `sum(p.allocated_quantity)` | 加 `AND p.voided_at IS NULL` |
| 2 | A4a 三軸重算 | `20260806180000:207` `sum(p.allocated_quantity)` | 加 `AND p.voided_at IS NULL` |
| 3 | A5a upsert 的存在性分流 | `20260806200000:315` | 撞到 voided 列的處置要明文(§3 第 4 點) |
| 4 | 🔴 `admin_record_item_receipt` | `20260811010000:193,224,237` | voided 列要**先拒絕並給正確理由**,不能讓它掉進 `QUANTITY_EXCEEDS_ALLOCATED`(F7) |
| 5 | 供應商單號搜尋 | `20260812130000:370` | **維持搜得到**(這是好事),但畫面要標「已撤銷」(F16) |
| 6 | 取消守門 a8a1 / a8a2 | `20260804180000:217` / `20260805100000:380,400,412` | 讀的是 receipts;voided 列 received=0 ⇒ 不受影響。**但要有一格測試頂著**,不是用推的 |
| 7 | `listProcurementChoices`(到貨供應商選單) | `receipt-repository.ts:363` | **必須過濾 voided**(F7 的直接修法) |
| 8 | `findProcurementRemaining` | `receipt-repository.ts:329` | voided 列不該走到這裡(#7 過濾後自然不會) |
| 9 | `cancel-view.ts:431` zero-inferable | `item.procurements.length === 0` | 改成「非 voided 的筆數 === 0」,否則 fallback 永久失效(F18) |
| 10 | 採購區塊列表 | `item-procurement-section.tsx:126,129,145` | voided 列整列改呈現,`reply_status` 不再單獨顯示(F19) |
| 11 | 採購表單編輯模式 | `item-procurement-form.tsx:226` | voided 列不進編輯模式,改成「復原」入口 |
| 12 | 讀模型投影 | `mappers/order-procurement.ts` + `domain/types.ts:553` | 加 `voidedAt` / `voidReason` 兩欄 |

⇒ **案 E 的讀者面 = 12 處。這個數字是案 E 專屬的,換案要重數。**

---

## §1 四案重算(🔴 F13:尺先定完,再套)

### §1a 七把尺(先寫死,才去看哪個案得幾分)

1. **(S1) 廢不廢掉既有證明** —— 有沒有讓某支已上線函式的正確性論證失效
2. **(S2) 打不打斷既有讀者** —— §0-C 三類讀者裡有幾個會讀錯
3. **(S3) 改幾個生產物件**
4. **(S4) 原始資料保不保得住** —— 撤銷後「原本訂幾件」還在不在列上
5. **(S5) 稽核可信度** —— 撤銷的理由與事實,存在可信的地方還是可偽造的地方
6. **(S6) 與既有作廢慣例一致** —— 這個 repo 已經有的作廢語意,是否沿用
7. **(S7) 語意可讀性** —— 下游判斷「這筆撤了沒」,靠一個明示述詞還是靠推論

> 🔴 S4-S7 是 R2 指出我**完全沒量**的四軸。S1-S3 是我原本就有的。
> 「先定完再套」的意思是:下表我照這七欄**逐格填**,不是先選好案再挑欄位。

### §1b 五案對照

| | A 硬刪 | B 軟作廢(自創) | C′ 額度歸零 | **E 照 shipments 樣板作廢** | D void ledger |
|---|---|---|---|---|---|
| S1 廢既有證明 | 🔴 是(`20260806200000:433,450-451`) | 否 | 否 | **否** | 🔴 是 |
| S2 讀者讀錯 | 🔴 搜尋失效 + 取消守門少看一列 | 少數 | 🔴 **12 處要改,其中 4 處會靜默讀錯**(F7/F16/F18/F19) | **12 處要改,但靠一個明示述詞一次判完** | 🟡 |
| S3 改幾個物件 | 3 | 5 | **1 改 + 1 新** | 4 改 + 2 新(void/unvoid) | 4 |
| S4 原始資料 | 🔴 只在 audit | ✅ 保住 | 🔴 **`allocated` 被抹掉**(F3) | **✅ 保住** | 🔴 只在 audit |
| S5 稽核可信度 | 🔴 audit(可偽造) | ✅ 列上 | 🔴 **audit**(F2) | **✅ 列上配對欄** | ✅ ledger |
| S6 與既有慣例一致 | 🔴 相反 | 🟡 同型但自創 | 🔴 無關 | **✅ 逐字沿用 `shipments_void_pair`** | 🟡 |
| S7 語意可讀性 | n/a(列不在) | ✅ 明示 | 🔴 **隱式編碼**(0 兼差當狀態旗標) | **✅ 明示述詞 `voided_at IS NULL`** | ✅ |
| 設計成本 | 自己想 | 自己想 | 自己想 | **🔴 半個月前付過了** | 自己想 |
| 加幾個欄位 | 0 | 2-3 | 0 | **2**(Sean 08-13 明文約束「不要增加太多欄位」;實查 shipments 樣板也正好是 2) | 一整張表 |

🔴 **S3 那格我必須誠實:案 E 的「4 改 + 2 新」比 C′ 多。**
C′ 只在 S3 這一欄贏,而它在 S4 / S5 / S6 / S7 四欄全輸 —— 那四欄正是我 v3 沒有量的四欄。
**v3 的對比表之所以讓 C′ 勝出,是因為那張表只有 C′ 會贏的欄位。** 這就是 F13 講的事,我認。

---

## §2 v4 推薦:**案 E**

**理由(對應七把尺)**:S1 不廢證明、S4 資料無損、S5 理由寫在列上、S6 沿用 repo 既有作廢語意、
S7 下游靠一個明示述詞判完(而不是每個讀者各自推論)。S3 多付一點,買到的是上面五項。

**加上一條 ponytail 層的理由**:ponytail 階梯第 2 階逐字是
「**Already in this codebase? A helper, util, type, or pattern that already lives here → reuse it. Look before you write**」。
我 v2 / v3 **直接跳過第 2 階**,在第 6/7 階(「能不能一行」「最小可行 code」)上比較三個自己發明的方案。
🔴 **少寫程式碼的正解不是「發明一個更小的方案」,是「用已經寫好的那個」。**

**我自己對案 E 的反對意見(不藏)**:

1. S3 確實最貴(4 改 + 2 新),其中「A2b1 / A4a 兩處 `sum` 加述詞」是**動已上線守門** —— 鐵則 12③,不可降級。
2. `unvoid` 要不要做是獨立決定。shipments 有 unvoid,是因為它有「作廢後又要救回」的真實情境;
   採購撤銷有沒有同樣情境,**我沒有問過 Sean** ⇒ 成題 Q2。
3. 案 E **沒有**自動解掉 F16(搜到訂單但畫面沒說這筆撤了)—— 那要 UI 自己做,已列進 §3 第 5 點。

---

## §3 案 E 要改什麼

1. **schema**:`order_item_procurement` **只加兩欄** `voided_at timestamptz` / `void_reason text`
   + **逐字照抄** `shipments_void_pair` 的配對 CHECK 形狀(`20260805170000:149-151`)。
   🔴 **兩欄是 Sean 08-13 的明文約束**(「不要增加太多欄位」)。~~`voided_by`~~ **v4 曾規劃的第三欄已拿掉**。
   **我核過樣板,兩欄做得到**:`shipments` 全檔只有 `deleted_at`(`:89`)與 `void_reason`(`:90`)兩欄、
   **沒有 `voided_by`**(`grep -n "voided_by\|deleted_by" 20260805170000…` 零命中);
   `:205` 逐字「🔴 **可 unvoid**(清回 NULL,需同時清 `void_reason`)」⇒ **unvoid = 兩欄一起清回 NULL**,
   配對 CHECK 天然保證同進同出,不需要第三欄。
   ⚠️ 代價照樣板認列:「誰撤的」只在 `admin_audit_log` 裡。
   🔴 **樣板作者自己劃的兩條界,逐字抄過來、不改寫**:
   - `20260805170000:205`(`deleted_at` 的 COLUMN COMMENT)逐字:
     「🔴 **可 unvoid**(清回 NULL,**需同時清 `void_reason`**)。」
     ⇒ **unvoid 的語意樣板已經定義好了,我不自己發明。**
   - `20260805170000:207` 逐字:
     「`void_reason` + 稽核是唯一事後追溯手段。**不得宣稱「作廢有防呆」。**」
     ⇒ 🔴 **本 plan 任何一句暗示「作廢比硬刪安全」的話,都要配這句一起讀** ——
     安全的是**可追溯**,不是**不會出錯**。作廢一樣撤得掉不該撤的東西。
   ⚠️ 另有一條理由**不轉移**(v2 就寫對的那句):`20260805170000:243` 逐字
   「包裹永不硬刪……否則**包裹編號的「永不重用」保證會破**」—— 採購沒有對外編號 ⇒ 這個理由對本表不成立。
   **理由不轉移、實作轉移**,兩件事分開。

1b. 🔴 **配對 CHECK 用到的 `pcm_b2_is_blank`:我去核了,而且實測出一條 plan 必須寫進去的事**

   - **存在且可用**:`20260805170000:56-68` `CREATE FUNCTION public.pcm_b2_is_blank(t text)`,
     `LANGUAGE sql IMMUTABLE PARALLEL SAFE SET search_path = pg_catalog`,在 `public` schema、
     全 repo **零 DROP**(`grep -rn "DROP FUNCTION.*pcm_b2_is_blank"` 只命中一行**註解**)⇒ 本片看得到它,不必改寫等價版。
   - 🔴 **但它 `REVOKE ALL … FROM PUBLIC, anon, authenticated, service_role`(`:77`)**,
     而 **CHECK 約束在 DML 當下會檢查函式的 EXECUTE 權限**。這句我**沒有用推的** ——
     本機 PG 17.10 拋棄式庫實測(建等價 stub、跑完拆掉、零殘留):

     | 測 | 做法 | 結果 |
     |---|---|---|
     | A | `SET ROLE service_role` 後**直接 INSERT**(該 role 無 EXECUTE) | 🔴 `ERROR: permission denied for function pcm_b2_is_blank` |
     | B | 經 owner `SECURITY DEFINER` 函式寫入 | ✅ 成功 |
     | C | 理由是純空白 `'   '` | ✅ 被 CHECK 擋下(`violates check constraint`) |

   ⇒ **對本片無害**:`order_item_procurement` 對三個應用 role **零寫權**(`20260729020000:167-168`),
     所有寫入都走 owner SECDEF RPC = 測 B 那條路。
   ⚠️ **但要寫進 migration 檔頭當交辦**:日後若有人給這張表直接寫權,
     這條 CHECK 會噴一個**看起來與作廢無關**的權限錯。這是**縱深防禦的副作用,不是 bug**。
2. **業務鍵**:`UNIQUE (order_item_id, supplier_id)` → **partial unique `WHERE voided_at IS NULL`**
   (否則同一家撤銷後重下單撞鍵)。
   🔴 **這一步有一條 v4 沒看到的隱藏依賴,開工前必須先處理**:PG 的 `UNIQUE` **表約束不支援 `WHERE`**
   ⇒ partial 版只能是 `CREATE UNIQUE INDEX`,而那會讓 `pg_constraint` 少掉這一列。
   而 **A5a 的 `unique_violation` 處理是比對約束名字**(`20260806200000:435` 逐字
   `IF v_con IS DISTINCT FROM 'order_item_procurement_business_key' THEN RAISE;`)。
   ⇒ **新索引必須沿用同一個名字**(唯一索引違反時 `CONSTRAINT_NAME` 回的是索引名),
   並且**要有一格負測頂著**「A5a 撞鍵時仍走它自己的重試圈、不是裸 23505 往上拋」。
   **這一格不准用推的**(我現在寫的就是推論,harness 要把它變成觀察)。
3. **兩處 `sum(allocated_quantity)` 加 `AND voided_at IS NULL`**:A2b1 `20260803130000:144-146`、A4a `20260806180000:207`。
   🔴 兩支都是走過 30+ 條對抗審查的高風險物件 ⇒ 鐵則 12③,**改動範圍窄到只有那一個述詞**,各配負測。
4. **A5a 撞到 voided 列的處置** —— 🔴 **2a-1 的 harness 已經把這題從「待決定」變成「已觀察」**:

   2026-08-13 於拋棄式庫實跑(全 migration 重放 + 真 seed + 真 A5a 呼叫),五格結果:

   | # | 動作 | 結果 |
   |---|---|---|
   | ① | 對 A 家建 3 件(品項 quantity=3) | `CREATED` ✅ |
   | ② | 額度滿時對 B 家再建 3 件 | `OVER_ALLOCATION` ✅ **(這就是 Sean 的痛點,harness 有格頂著)** |
   | ③ | 作廢 A 家之後查 `ordered_quantity` | **0** ✅(A4a 新述詞生效) |
   | ④ | 作廢後對 B 家建 3 件 | `CREATED` ✅(A2b1 新述詞生效 ⇒ **額度真的放出來了**) |
   | ⑤ | 對**已作廢的 A 家**重新下 1 件 | 🔴 **`UPDATED`** —— 不是我預期的 |

   🔴 **⑤ 的實際行為**:A5a 的存在性分流**看不到 `voided_at`** ⇒ 它找到那筆**已作廢的列**、走 UPDATE 路徑,
   把 `allocated_quantity` 改成 1 而**那一列仍然是作廢狀態**。A2b1 因為是「調降」而 skip、不守。
   ⇒ 結果是一筆「已作廢、但欄位被改過」的列,語意自相矛盾。

   **對 2a-1 的影響 = 零**(正式庫沒有任何 voided 列,這條路徑走不到);**對 2a-2 = must-fix**。
   ⇒ 2a-2 必須明文決定:A5a 撞到 voided 列時要 **(i)** 視同不存在、走 create(靠 partial unique 不撞)
   還是 **(ii)** 回一個新固定碼叫員工先「取消撤銷」。**這題現在有實測資料可以拿去問 Sean,不是憑空猜。**
   ⚠️ 並連帶影響 `20260806200000:432-433` 的重試圈論證 ⇒ 那段證明在 2a-2 要重寫。

4c. 🔴 **2a-2 的第二個 must-fix(關卡2 抓到,我沒想到)—— unvoid 會繞過 A2b1**
   A2b1 的 skip 分支(`20260803130000:125-129`)是「同 parent 且**未調升**就放行」。
   **unvoid 只清兩欄、`allocated_quantity` 一個字都沒動** ⇒ 命中「未調升」早退 ⇒ **守門不跑**。
   後果具體:A 家 3 件作廢 → B 家補 3 件(合法)→ **unvoid A 家** ⇒ 有效額度變成 **6 件、而品項只有 3 件**。
   ⇒ **2a-2 的 unvoid RPC 必須自己重驗總量**(不能靠 A2b1),或改動 skip 分支的條件。
   🔴 **R2 補了我沒列到的第三面**:**`void` 本身也走同一個早退** —— 作廢只寫兩個新欄、
   `allocated_quantity` 一樣沒動 ⇒ 同樣命中「未調升」放行。
   ⇒ 正確的說法是「**2a-2 的 void 與 unvoid 兩支都不能依賴 A2b1**」,不是只有 unvoid。
   我原本只想到 unvoid,是因為我只在想「哪個方向會讓額度變多」;
   **但守門跑不跑與方向無關 —— 只要 alloc 沒變它就早退。**
   ⚠️ 這條**不影響 2a-1**(本片沒有 unvoid),但它是 Q2=A「要能取消撤銷」帶來的直接代價,
   **在 2a-2 動手前必須先解決**,否則作廢功能會變成一個繞過總量守門的洞。

4b. 🔴 **「撞鍵」這件事的精確版**(我原本承諾「harness 真的撞一次」,結果發現要分兩層講):
   - **型別層(已觀察)**:唯一**索引**違反時 `GET STACKED DIAGNOSTICS CONSTRAINT_NAME` **回索引名** ——
     拋棄式庫實測 `z_business_key`,且把第一筆填上 `voided_at` 之後同鍵**可以再插一次**。
     ⇒ A5a `:435` 的名字比對仍然認得它。**推論已升級為觀察。**
   - **行為層(觀察到的是另一回事)**:走**真的 A5a** 時**根本撞不到那個索引** ——
     因為存在性分流先找到那筆 voided 列、走了 UPDATE(見上面 ⑤)。
     ⇒ 真正會撞索引的只剩**併發首建**那條路。**那一格 2a-1 沒有覆蓋**(要兩個 session),
     誠實列進 §5 G8,並排進 2a-2 的 harness。
5. **`admin_record_item_receipt`(#20)對 voided 列先拒絕**並給正確理由(F7);**搜尋結果畫面標「已撤銷」**(F16)。
6. **void / unvoid 兩支 RPC**:形狀照 `20260807200000` / `20260807210000`;
   **「已作廢再作廢」照樣板人話拒絕、不做 no-op**(`20260807200000:39-41` 逐字,F15);
   鎖序與 `SET CONSTRAINTS` 立場**明文表態**(F10)。
7. **應用層**:授權必須是 action 第一句、ownership 三段交叉檢查、§0-C 的 12 個讀者逐一處理。

**rollback**:drop 兩(三)欄 + partial unique 改回 + 兩處述詞還原 + drop 兩支 RPC。
**數量欄全程未被動過** ⇒ 沒有 C′ 那種「回退第一次使用後就做不動」的問題(F11)。

---

## §4 驗收

### §4a 一般紀律

沿用 v3 的分類與 codex #14-19 折進來的要求(N7 不能用 heredoc、before-image 要驗恰一筆且逐欄、
fixture 查不到合格訂單要 RAISE、malformed 輸入要實跑)。**新骨架等 Sean 拍完 Q1 再寫。**

### §4b 🔴 F5 我認:附錄 A 的 13 列與 15 發突變一併撤下

R2 說得對 —— 我用「為案 A 寫的」把負測骨架撤下,卻把 13 列 / 15 發當戰功留著,**同一份 plan 兩套標準**。

**誠實拆解(不是全撤、也不是全留;逐列判)**:

- **環境列(與案別無關,案 E 仍要跑)**:trigger 清單與事件、trigger 啟用、三 role 寫入權、
  service_role SELECT、非預期 grantee、RLS/policy/PUBLIC、具名 FK、產生欄、audit ACL、撞名檢查。
- **案 A 專屬列(撤下)**:`prosrc` 含 `TG_OP='DELETE'` 錨點(案 E 不走 DELETE)、
  `allocated_range` 述詞(那是 C′ 要改的,案 E 不動它)。
- **案 E 需要、目前零覆蓋(尚未寫)**:配對 CHECK 是否建成、partial unique 的述詞、
  A2b1 / A4a 兩處 `sum` 是否真的帶了 `voided_at IS NULL`、`SECDEF owner`(F6 指出我承諾了卻沒寫)。

⇒ **v3 §5 那張「新增/改寫五列」對照表 v4 直接刪掉**(F6:編號與 SQL 錯開一格,Sean 照它判讀會對錯列)。
**SQL 本身才是唯一權威**,而案 E 版的 SQL **要等 Q1 拍完才寫** —— 理由與骨架相同,不重複犯第二次。

### §4c F20 的誠實回答(部分採納)

R2 說我沒有一格驗「突變真的套上去了」。**我確實沒寫那一格。**
那 15 發的判準方向讓它**部分自證**:突變若沒套上 ⇒ 該列不會紅 ⇒ 我的腳本印 `CHECK` 而不是 `OK`;
15 發全部印 `OK` ⇒ 15 發都套上了。
🔴 **這是推論,不是獨立觀察** —— 例如「突變套上了、但同時弄壞別的東西讓該列剛好也紅」它分不出來。
⇒ 案 E 版重寫時,突變格一律加一句**正面斷言**(改完先查物件定義字面、證明改到了,才跑判準)。

---

## §5 誠實缺口(只收真的構造不出來的)

| # | 缺口 | 為什麼 |
|---|---|---|
| G1 | 正式庫實際狀態未連線核對 | 我沒有連線 ⇒ 寫成 apply 前置閘要 Sean 跑 |
| G2 | `actor` 是自陳身分 | E8-B 未開工 |
| G3 | owner / SECDEF 路徑仍可直寫 | 權限天花板之上 |
| G4 | `session_replication_role=replica` 可跳過 trigger | `20260803130000:85` |
| G5 | 動態 SQL 只掃四種字面 ⇒ **未宣稱掃完** | 窮舉不完 |
| G8 | **併發首建撞 partial unique index 那一格,2a-1 沒有覆蓋** | 要兩個 session 接力,單一 `DO` 區塊構造不出來。⚠️ **這不是「不用測」** —— 已排進 2a-2 的 harness,並照 codex #14 的教訓**不得用 heredoc**(連線到 EOF 就結束、交易回滾 ⇒ 根本沒測到 blocking) |
| ~~G6~~ | ~~unvoid 有沒有真實需求~~ | ✅ **已解:Sean 08-13 Q2=A 要做** |
| 🔴 G7 | **撤到貨之後,那些實體已經在倉庫的貨,系統裡沒有去處** | Sean 08-13 逐字「到貨的商品要可以轉去庫存那邊」。**本片不做**:與既有拍板 Q6=A(不做庫存)、Q11(庫存落點在報價單 repo)的關係要 Sean 自己釐清(主視窗處理中)。⇒ 它是**撤到貨流程的下游缺口**,不是本片的實作項,但也不是可以忽略的東西 ⇒ 已請主視窗發 backlog 號 |

🔴 **不准放進誠實缺口的**:併發、隔離閘、audit 逐欄比對、request_id 正規化、骨架寫錯跑不起來、
**以及「repo 裡有沒有現成樣板」(F1 那型 —— 一條 `ls` 就查得到)**。

---

## §6 拍板紀錄(v4 的四題已全數裁定,決策題段落作廢)

| 題 | 結果 | 出處 |
|---|---|---|
| Q1 用哪一案 | **E**(照 shipments 作廢樣板) | Sean 08-13 逐字 `q1: a` |
| Q2 要不要能取消撤銷 | **要**,🔴 附加「不要增加太多欄位」⇒ **只加兩欄** | Sean 08-13 逐字 `q2: a, 但是不要增加太多欄位` |
| Q3 已有到貨時撤銷 | **擋掉、先撤到貨**;🔴 附加「到貨的商品要可以轉去庫存那邊」⇒ **本片不做**,見 G7 | Sean 08-13 逐字 `q3: A, 但是到貨的商品要可以轉去庫存那邊` |
| Q4 作廢兩次 | **拒絕、不做 no-op** | 主視窗裁,照 `20260807200000:39-41` |

🔴 **Q3 附加條件的處理立場(寫清楚,免得被當成已做)**:
Sean 那句話講的是**實體的貨**——撤掉到貨紀錄之後,那批貨還在倉庫,系統裡沒有它的位置。
這與既有拍板 **Q6=A**(只做採購改軟、不做庫存)與 **Q11**(庫存落點在報價單 repo)的關係**要 Sean 自己釐清**,
主視窗已回去問。**本片照 Q3=A 做(擋掉、叫他先撤到貨),不碰庫存。**
⇒ 進誠實缺口 G7 + 請主視窗發 **1 條 backlog**。

---

## §7 病根(五條;①②③④ 主視窗已裁採納,⑤ 本輪新增)

① **查了現況、沒查現況的修訂史** —— v4 找到更精確的版本:**修訂鏈 v1 就列全了 21 支,病在「列了沒讀」**,不是掃描面不足。
② **「檔案提到」≠「函式讀到」**(`pcm_suppliers_block_delete`)。
③ **給數字前先定義量測單位**(「函式幾支」三個人三個答案)。
④ **查了「誰改過它」還不夠,要查「有沒有人已經做過同一件事」**(F1)。
   ⇒ 操作化:動手設計任何機制之前,先 `grep -rl` 一次同義詞(作廢 / void / cancel / undo / revert),**這比讀十支 migration 便宜**。
⑤ **折 finding 時順手刪掉的「看似無關的引用」,可能是唯一還連著正解的那根線**(v3 把 v2 唯一那句 `shipments` 刪掉了)。

— END —
