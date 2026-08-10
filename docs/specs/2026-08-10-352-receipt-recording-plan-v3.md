# #352 plan v3.3 — 到貨登錄(含現貨與溢收)技術規格

> **拍板依據**:Sean 2026-08-10 21:x「三個問題都需要重新思考,不應該有這麼不方便的方式」
> ⇒ **員工方便=首要設計目標**;白話層 = `pcm-mailbox/D-443-STOP.md`(Sean 已讀)。
> **三題全照推薦**:**Q1=A(甲+乙)/ Q2=A(兩入口)/ Q3=A(刪除)**。memory:`project_m4b-352-spot-stock-supplier-decision`。
> **審查鏈**:codex 關卡1 **R1 FAIL 12MF+2nit** → v3.1 → **R2 FAIL 8MF+2nit(全打在折法上)** → v3.2
> → **R3 換模型換角度(Fable)FAIL 2MF+4consider+4nit** → 本檔 **v3.3**。折入紀錄見 §10(三輪 32 條、零重複)。
> 🔴 待批,批准前不動 code。

---

## 1. 這片在解什麼(一句話)

**把「登錄到貨」做出來。** 現貨只是它的其中一個來源,不是一條特殊通道。

現況(D-443 §1 已逐條附出處):`order_item_procurement_receipts` **零寫入路徑**
⇒ `instock` 恆 0 ⇒ 出貨彈窗每件都標「未到貨」⇒ **正式站一件都出不了**。

---

## 2. 資料模型改動

### 2.1 `order_item_procurement_receipts` 加一欄

| 欄 | 型別 | 為什麼 |
|---|---|---|
| `surplus_quantity` | `integer NOT NULL DEFAULT 0` | **乙(溢收)**:供應商送來但這張單裝不下的件數。🔴 **A4a 只 SUM `quantity`,不看本欄** ⇒ 不進 `received_quantity`、不進 `instock`、不碰 C7 ⇒ **A4a 零改動** |

### 2.2 兩條 CHECK 調整

現況 `quantity BETWEEN 1 AND 100000`(`20260729020000:197-198`)⇒ 改成:

```
quantity          BETWEEN 0 AND 100000
surplus_quantity  BETWEEN 0 AND 100000
quantity::bigint + surplus_quantity::bigint BETWEEN 1 AND 100000   -- 「登錄 0 件」仍無意義,擋在這
```

理由:訂單已收滿後才到的貨 = `quantity=0 / surplus=N`,舊 CHECK 會擋掉它,而那正是 Sean Q2 要記進去的那一批。
🔴 `::bigint` 不是裝飾(對齊 C7 `20260730150000:122-124`:兩個 integer 相加先溢位成 22003、紅在錯的地方)。

### 2.3 「店內現貨」供應商種子列

- **固定 UUID**(寫死在 migration 與應用層常數),**不用 label 查** —— label 可改名。
- 🔴 **`is_active = false` 落種(R2-MF5)**,由 **#352-b** 翻成 `true`(載具見 §6,R3-F6)。
  v3.1 寫 `true` 並宣稱「a1 對應用層零行為改變」——**那句是假的**:採購下拉列的就是啟用中的供應商
  ⇒ 一落種員工當場就選得到,但那時登錄到貨的 RPC 與 UI 都不存在 = 把人領進死路。
  `is_active=false` 同時讓 A5a 的 `v_active` 檢查成為天然閘門(不必另造 feature flag)。
- 🔴🔴 **但「零可見改變」仍然是假的 —— 雙線審 MF1(兩線各自獨立抓到)**:
  停用只擋得住**採購下拉**(`listSuppliers()`,`apps/admin/src/lib/supplier.ts:29` 逐字
  `rows.filter((row) => row.is_active)`);
  **「設定 → 供應商」頁看得到它、而且有啟用開關** —— `listSuppliersForSettings()`(`supplier.ts:69`)
  **刻意不濾 `is_active`**(該函式 `:65-66` 逐字:停用列必須回得來,否則 S3b-3 做不到
  「撞到已停用同名時定位到那一列 + 讓員工自己按啟用」,Sean Q2=A)。
  ⇒ 正確說法 = **「不進採購下拉;設定頁看得到且可被啟用」**,
  **紀律:a2/b 落地前不要動那一列的啟用狀態**(這條要進 STATUS 素材,不是只寫在 plan 裡)。
  ⚠️ v3.3 與 migration 檔頭原本寫「S3a/S3b 只列啟用中」**把 S3b 講反了**,已更正。
- 🔴 種子驗法 = **驗 id + label 一致否則 fail**,**不用 `ON CONFLICT DO NOTHING`**:
  `suppliers_label_unique`(`20260801140000:45`)會讓「同名不同 id」靜默降級成不建列。
- `suppliers` 有 block-delete trigger(`20260801140000:101-123`)⇒ 這列刪不掉。
- ⚠️ **文案 `店內現貨` 暫定,歸 Sean**。改名要同步五處(`suppliers.label` / 種子驗法期望字面 / harness 斷言 /
  UI 文案 / 本檔)—— 改名前先 grep 這五處(R1-nit2)。

### 2.4 🆕 `order_item_receipt_requests` — 冪等帳(**真 append-only**:零 UPDATE、零 DELETE)

```
request_id       text        PRIMARY KEY   -- 冪等鍵
procurement_id   uuid        NOT NULL      -- 🔴 刻意【無 FK】,見下
quantity         integer     NOT NULL
surplus_quantity integer     NOT NULL
received_at      timestamptz NOT NULL
note             text                       -- 不可變 payload 的一部分,一起比對
actor            text        NOT NULL
receipt_id       uuid        NOT NULL UNIQUE  -- 🔴 INSERT 當下就填(R3-F3),此後永不改
created_at       timestamptz NOT NULL DEFAULT now()
```

🔴 **R3-F3:`receipt_id` 由 RPC 在 INSERT 前先 `gen_random_uuid()` 產好**,不再「先寫 NULL、寫完 receipt 再回填」;
「這筆被刪了沒」也**改用推導**(ledger 有列、而 `receipts` 查不到那個 id ⇒ 已刪)。
⇒ 本表**沒有任何 UPDATE 路徑** ⇒ 少兩條 UPDATE、少一個 `receipt_deleted_at` 欄,而且**真的是 append-only**。
(R2-nit2 曾要求改名為 tombstone ledger —— 那對 v3.2 的形狀是對的,**F3 把成因移除後 append-only 這個字重新為真**,故改回。)

🔴 **兩個 uuid 欄都刻意不建 FK(R2-MF2/MF3/MF4)**,理由三條:
1. **FK RESTRICT 會凍結一條既有的合法出路**:A5a `:80-84` 逐字「qty=1 的品項指錯供應商後,當日出路 =
   owner 手動 `DELETE FROM public.order_item_procurement WHERE id = …`」。ledger 若對 procurement 建 FK,
   **receipt 被刪之後那筆 ledger 仍永久擋住這條清理路** ⇒ 淨損失。
2. **FK 檢查會吐 raw 23503**,根本到不了具名訊息。
3. **FK 會隱式取 `KEY SHARE`**,讓 §4 的鎖序宣稱不成立。
⇒ 兩欄語意是**歷史指標**,不是活引用。**代價認列**:DB 層不保證指得到現存的列
⇒ **不能拿 ledger 反推現況**,它只做冪等與稽核。

冪等三性質怎麼成立:
- **不重複**(R1-MF2):PK 衝突是**跨全表**的,併發交易不管掛哪一列 procurement 都撞同一個 PK。
  `EXCEPTION WHEN unique_violation` 接住 → 重讀 → 查驗式比對,**不讓 raw 23505 外洩**。
- **不誤判**(R1-MF3 + 🔴 R3-F1):比對面 = **全部不可變 payload**
  (`procurement_id`/`quantity`/`surplus_quantity`/`received_at`/`note`/`actor`),
  🔴 **一律用 `IS NOT DISTINCT FROM`,不得用 `=`**。
  理由(R3-F1,**最常見的路徑上的真 bug**):`note` 可為 NULL,`NULL = NULL` 得 **NULL 不是 TRUE**
  ⇒ 走「不符」枝 ⇒ **空備註的合法重放會被當成 caller bug 打回**,而空備註正是最常見的情形。
  (同型先例:B 窗 OP5 的「G8 釘 IS NOT DISTINCT FROM」。)
- **不復活**(R1-MF4):本表**列不可刪**。舊請求延遲重送 ⇒ 命中 PK ⇒ payload 相符 ⇒ 回 `DUPLICATE_REQUEST`
  (即使產物已被刪),**不重新 INSERT** ⇒ 復活路徑物理上不存在。
  🔴 v3 原句「刪除釋放 request_id 是對的」**我收回**。

ACL 同 receipts:`REVOKE ALL` + 只 `GRANT SELECT TO service_role`,RLS on + zero-policy。

### 2.5 既有 COMMENT 的過期字面(R1-MF8;🔴 改在 **a2** 不是 a1,R2-MF6)

| 位置 | 現字面 | 改成 |
|---|---|---|
| `20260729020000:178` | `-- 🔴 append-only(同 order_notes):到貨是既成事實,不改不刪。` | 受守門的刪除(#352),仍無 UPDATE 路徑 |
| `20260729020000:224` | 表 COMMENT `…逐批到貨明細,append-only。…` | 同上 |

🔴 **時機(R2-MF6)**:刪除 RPC 到 a2 才存在 ⇒ 放在 a1 會讓 DB 契約宣稱一個還不存在的能力
= **自己製造字面 vs 事實偏離** ⇒ **與刪除 RPC 同一支 migration**。a1 期間 `append-only` 仍為真。

- 清單建法 = 全樹 `grep -rn "append-only" supabase/migrations packages/domain/src packages/adapters/src apps/admin/src | grep -iE "receipt|到貨"`
  ⇒ **恰 2 處**(`20260805100000:493` 是**取消帳本**的 append-only,與本片無關、不得順手改)。
- A2 `:180-181` 逐字:「登錄錯了的更正機制 = 第 2 批批次到貨 UI 落地時才設計,本片不預先發明語意」
  ⇒ **本片就是那一刻**,migration 要明寫是在兌現這條契約債。
- **結構驗收一格**:receipts 的 COMMENT 若仍含 `append-only` 且不含新語意 ⇒ fail。

---

## 3. 兩支新 RPC

兩支都 `SECURITY DEFINER` / `SET search_path = public, pg_temp` / `REVOKE ALL` 後只 `GRANT EXECUTE TO service_role`
(樣板 = A5a)。`v_ws`(31)/`v_zw`(7)常數自檢**逐字沿用** A5a `:127-138`。

### 3.0 錯誤形式與輸入驗證(🔴 R3-nit3 讓這一節整個重排)

**A5a `:32` 逐字立了慣例**:「RAISE 面(= **caller bug**,非固定碼)= actor/request_id 缺失或非法 + 隔離閘 P2B02 + 防衛枝」;
其餘輸入/業務結果一律 **回代碼字串**(`:279` 的 `RETURN 'SUBMITTED_AT_OUT_OF_RANGE'` 那款)。
⇒ 本片照辦,**新 SQLSTATE 從三個降到一個**:

| 情形 | 形式 | 為什麼 |
|---|---|---|
| 超收(`quantity > allocated − received`) | **`RETURN 'QUANTITY_EXCEEDS_ALLOCATED'`** | 業務結果、且此時**尚未寫任何東西**(§3.1 已把守門排到 ledger 之前)⇒ 不需要回滾 ⇒ 不必是 RAISE。**原 `P4A02` 取消** |
| 同 request_id 不同 payload | **RAISE,不具名固定碼** | 這是 **caller bug**(鍵被重用),A5a `:32` 對 caller bug 就是不給固定碼。**原 `P4A04` 取消** |
| 刪除的後置守門不成立 | **RAISE `P4A03`** | 必須**回滾已執行的 DELETE** ⇒ 只有 RAISE 做得到;跨表守門給具名碼與 P2B27/P2B01 同族 |

🔴 ⇒ **主視窗批准的三個碼只用 `P4A03` 一個。**

🔴🔴 **`P4A02` 與 `P4A04` 判定「已焚毀,永不再指派」**(主視窗 2026-08-10 裁定,我同意)。
理由**不是**「沒用到就還回號池」,而是:`D-444-STOP` / `D-445-STOP` 兩封信**已經用具體語意引用過這兩個碼**
(`P4A02 = 超收`、`P4A04 = 冪等 payload 不符`)⇒ 把它們重發給別的語意,會讓那兩封舊信變成**二義**,
正是撞號家族(memory `feedback_ambiguous-identifier-scoped-lookup-collision`)那條教訓的變形。
⇒ **任何人日後翻到 D-444 看見「`P4A02` = 超收」,那句話在當時是對的,但那個碼從未落地、也不會落地。**
本片與未來任何片都不得使用這兩個字面。

輸入驗證:
- **`p_actor`**:鏡像 `received_by` 的 `^[a-z0-9_]{1,64}$`(A2 `:209-210`)。
- **`p_request_id`(R1-MF12)**:**沿用 A5a 慣例**(`:200-207`:btrim `v_ws||v_zw` → 非空 → ≤200 → 無 `[[:cntrl:]]`),
  **不套 `^[a-z0-9_]{1,64}$`** —— 那會拒掉帶連字號的 UUID,而 UUID 正是應用端最可能產的形狀。
  🔴 **額外一條(本鍵是 PK)**:`v_req <> lower(v_req)` ⇒ **拒收**,**不靜默 `lower()`**
  (大小寫兩形會繞過 PK 的重複門,W3-2 判過同型;靜默正規化會讓送出的鍵與表裡的鍵不同字面)。
- **`p_received_at`(R1-MF11 / R2-MF8)——逐字照抄 A5a `:270-282` 的三件套,不自己發明**:
  1. 界線**帶偏移**:`> TIMESTAMPTZ '2020-01-01 00:00:00+00' AND < TIMESTAMPTZ '2100-01-01 00:00:00+00'`
     (A5a `:271-275` 逐字:不帶偏移用**呼叫端 session TimeZone** 解讀;本函式是 runtime 求值必須自己釘死)。
  2. 未來值比 **`clock_timestamp()`**(不是 `now()` —— 交易起始時間在長交易內會把「現在」誤判成未來)。
  3. **`+ interval '5 minutes'` 寬限**:理由字面 A5a `:269`「5 分鐘寬限給裝置時鐘偏移」、實作 `:281`。
     🔴 v3.1 寫「不設寬限」是自己發明的理由且與 repo 慣例不一致,已撤回。
- **`p_note`**:過 `v_zw` 七碼位(A2 CHECK 只擋前四種,`:213-215` 逐字誠實不宣稱窮盡)。

### 3.1 `admin_record_item_receipt` — 登錄一批到貨

```
p_procurement_id    uuid,
p_quantity          integer,      -- 算進這張單的件數
p_surplus_quantity  integer,      -- 多出來的、進店裡的件數(乙)
p_received_at       timestamptz,
p_note              text,
p_actor             text,
p_request_id        text
RETURNS text  -- 'RECORDED' | 'DUPLICATE_REQUEST' | 'PROCUREMENT_NOT_FOUND'
              -- | 'QUANTITY_EXCEEDS_ALLOCATED' | 其餘輸入類代碼字串
```

守門序(**順序是規格**;🔴 **v3.2 的「ledger 先寫」已改成「守門先跑」**,理由見步 4):
1. **隔離閘**:非 `read committed` 拒(逐字沿用 A5a `:170-174`,碼 `P2B02`)。
2. 🔴 **本支【不】下 `SET CONSTRAINTS … IMMEDIATE`(R2-MF7)**:本支守門讀的是 **procurement 列的
   `received_quantity`**,供給它的第一跳 `order_item_procurement_receipts_received_sync_ac` 是
   **NOT DEFERRABLE**(`20260803140000:415-417`)⇒ 恆為即時值 ⇒ 不需要。
   而 `SET CONSTRAINTS` 會**提前引爆外層 pending 的 deferred 事件、且永久改掉該交易的 deferred 模式**
   —— 沒有需要就不付這個副作用。
3. **輸入驗**(§3.0)+ `p_quantity ≥ 0` + `p_surplus_quantity ≥ 0` + 兩者和 `BETWEEN 1 AND 100000`。
4. **鎖 + 存在性**:`SELECT … FROM order_item_procurement WHERE id = p_procurement_id FOR NO KEY UPDATE`;
   查無 ⇒ `RETURN 'PROCUREMENT_NOT_FOUND'`。
   (A5a `:57` 逐字:`FOR UPDATE` 對不存在的列**不留任何鎖** ⇒ 不得靠「鎖住了就安全」的直覺。)
   🔴 **為什麼這一步從 ledger 之後移到之前**:守門排在 ledger 前,超收與查無就都能用 `RETURN`
   而不必為了回滾 ledger 而 RAISE(§3.0)。**冪等的正確性不靠取鎖順序** ——
   靠的是 ledger 的 PK 本身(跨全表)+ `unique_violation` 的查驗式處理,那在任何順序下都成立
   (R1-MF2 要的是「有 PK 且會查驗」,不是「PK 一定最先」)。
   併發同 request_id、不同 procurement:各自先鎖不同的 proc,再撞同一個 ledger PK ⇒ 後者阻塞至前者提交
   ⇒ 進查驗枝;ledger 是**最後取得的葉資源** ⇒ 不成環(§4)。
5. **超收前置拒絕**:`p_quantity > allocated − received` ⇒ `RETURN 'QUANTITY_EXCEEDS_ALLOCATED'`。
   ⚠️ **這一步在 proc 列鎖之內** ⇒ 併發登錄會序列化、第二者讀得到第一者提交後的 `received`(READ COMMITTED)。
   🔴 **不靠 A2 的 `received_range` CHECK 兜底**:那條吐 **raw 23514**、員工看不懂
   (A4a COMMENT `:319` 逐字)。⚠️ 那條 CHECK **仍然留著,它才是權威**;本條只把失敗時機提前、訊息換人話。
   **訊息的拆分由 app 組**(R3-nit1):app 手上已有 `allocated`/`received`,直接算給員工看
   「這列還能記 X 件;你填了 Y 件,多的 Z 件請填在『溢收』欄」——**不要讓員工自己減**。
6. **產 receipt uuid** `v_receipt_id := gen_random_uuid()` → **INSERT ledger(含 `receipt_id`)**(R3-F3)
   - `unique_violation` ⇒ 重讀該列 → **`IS NOT DISTINCT FROM` 比對全部不可變 payload**(R3-F1)
     → 相符回 `DUPLICATE_REQUEST`(產物已被刪也一樣回它,**不重新 INSERT**);
     不符 ⇒ **RAISE(不具名,caller bug)**,訊息白話 + 給救法(R3-nit2):
     「這個提交編號先前已經用過,但內容不一樣。請重新整理頁面再送一次。」
7. **INSERT receipt(`id = v_receipt_id`)** → A4a 級聯重算 → 稽核 `admin_audit_log`。
   ⇒ **ledger 全程零 UPDATE**。

### 3.2 `admin_delete_item_receipt` — 刪掉一筆到貨(Sean Q3)

```
p_receipt_id uuid,
p_actor      text
RETURNS text  -- 'DELETED' | 'ALREADY_DELETED' | 'RECEIPT_NOT_FOUND'
```
**刻意不收 `p_request_id`**:刪除天然冪等(uuid 不重用)。

守門序:
1. 隔離閘 + `p_actor` 形狀(§3.0)。
2. 🔴 **`SET CONSTRAINTS public.order_item_procurement_summary_recompute_zc IMMEDIATE`** —— **本支需要**,見 §3.3。
   ⚠️ 副作用照 A5a 檔頭認列(提前引爆外層 pending 事件 + 永久改該交易 deferred 模式),**寫進 COMMENT**。
3. 查 receipt。**查無 ⇒ 去 ledger 以 `receipt_id` 反查(R2-MF1)**:
   - ledger 有該 `receipt_id` ⇒ `RETURN 'ALREADY_DELETED'`。
   - ledger 也沒有 ⇒ `RETURN 'RECEIPT_NOT_FOUND'`。
     🔴 **不可以也回 `ALREADY_DELETED`** —— 那會讓任何亂數 uuid 都得到成功回應。
   (這就是為什麼 §2.4 的 `receipt_id` 是 `NOT NULL UNIQUE` 且永不改:v3.1 把它清成 NULL,這一枝就實作不出來。)
4. 反查 procurement 列 → **鎖 procurement 列 NKU** → **再鎖 `order_items` NKU**(序見 §4)。
5. **`DELETE … RETURNING id`(R3-F5)**:**回 0 列 ⇒ `RETURN 'ALREADY_DELETED'`**。
   理由:兩個併發刪同一筆時,兩者都在步 3 看得到那列,取鎖序列化後第二者的 DELETE 影響 0 列
   —— 不看 rowcount 就會**拿著已失效的舊值往下走**、還去跑後置守門並宣稱刪除成功。
6. 🔴 **唯一的業務守門(後置、讀重算後的權威值;fail-closed)**:
   ```
   SELECT instock_quantity, shipped_quantity FROM order_item_quantity_summary
    WHERE order_item_id = <該品項>;
   ```
   - **(R1-MF6)先斷言「恰一列」且兩欄皆非 NULL;缺列或任一 NULL ⇒ 直接 RAISE(fail-closed)**,
     不得讓比較式因 NULL 不成立就靜默放行。(A4a 惰性建列 ⇒ 缺列**真的會發生**;
     `types.ts:638-660` 立過「讀不到就不放行」的契約。)
   - 要求 **`instock_quantity ≥ shipped_quantity + pending`**,`pending` = 該品項在**未出貨且未作廢**包裹裡的
     `shipment_items.shipped_quantity` 合計 —— 逐字對齊 w3b2 `20260807180000:244-250` 那段 `LEFT JOIN LATERAL`
     (`sh.shipped_at IS NULL AND sh.deleted_at IS NULL` 兩條件都要),**不自寫第二版**。
   - 不成立 ⇒ RAISE **`P4A03`**,訊息**列出全部相關包裹**(R1-nit1)——依包裹編號升冪、每箱一行
     「PK-xxxx:N 件」+ 合計 + 白話出路。
   - 🔴 **後置而非預測**:讀 A4a 重算後的真值,不自己算 `instock − N`(自己算 = 在 RPC 裡複製重算規則 = 第二真相)。
7. 稽核(記 `quantity`/`surplus_quantity`/`procurement_id`/`request_id` —— **刪掉後就查不到了**)。

### 3.3 為什麼**只有刪除**要 `SET CONSTRAINTS … IMMEDIATE`(R1-MF1 + R2-MF7)

R1 說「外層若延後 A4a trigger,後置守門會讀到刪除前摘要而放行」。**方向對,但它指的那一支不是可延後的那一支**:

| trigger | 掛哪張表 | 可否延後 | 出處 |
|---|---|---|---|
| `order_item_procurement_receipts_received_sync_ac` | receipts | **NOT DEFERRABLE** | `20260803140000:415-417` |
| `order_item_procurement_summary_recompute_zc` | order_item_procurement | **DEFERRABLE INITIALLY IMMEDIATE** | `:409-411` |

⇒ 第一跳(receipts → `received_quantity`)**延後不了**;**第二跳**(`received_quantity` → `order_item_quantity_summary`)
**延後得了**,而 §3.2-6 的守門讀的**正是** `order_item_quantity_summary` ⇒ **finding 成立**。
**修法**照抄 A5a `:176-178`。**登錄那支不需要**(§3.1-2)。
**驗收**:一格「先 `SET CONSTRAINTS … DEFERRED` 再呼叫刪除」必須仍被擋;另一格證明**登錄**在 DEFERRED 下行為不變。

---

## 4. 鎖序論證(無環)

🔴 **canonical 序 = `order_item_procurement` → `order_items`**,由 A2b1 定
(`20260803130000:32-36`;A5a `:74-75` 逐字「不顯式鎖 order_items,鎖了會反轉 A2b1 定的序」)。

**完整鎖圖 —— 含隱式 FK 鎖(R2-MF4:只掃 RPC 的顯式鎖會漏掉它們)**:

| 交易 | 取鎖序(含隱式) | 出處 |
|---|---|---|
| A5a upsert | `suppliers` SHARE(路徑①②)→ proc(**FOR UPDATE**)→ order_items(trigger 內 NKU) | `20260803160000:57-68` |
| A4a(receipts 寫入觸發) | proc(NKU)→ order_items(NKU) | `20260803140000:319` |
| S2 供應商 upsert | **只有** `suppliers`(FOR UPDATE) | A5a `:67` |
| w3b2 掛品項 | **只有** `order_items`(NKU、`ORDER BY oi.id`) | `20260807180000:184-188` |
| **本片 3.1 登錄** | proc(NKU)→ **ledger PK 插入(葉資源、無 FK ⇒ 不取列鎖)** → receipts INSERT(隱式對 proc 取 `KEY SHARE`,自持 NKU 無衝突)→ order_items(trigger 內 NKU) | 本檔 |
| **本片 3.2 刪除** | proc(NKU)→ order_items(顯式 NKU)→ receipts DELETE(隱式 KEY SHARE,同上自持) | 本檔 |

**無環論證**:
- 本片兩支**完全不碰 `suppliers`** ⇒ 與 A5a 路徑①②、S2 無共同互斥資源、不成環。
- 本片與 A5a / A4a 在 `proc → order_items` 這一軸**同向**;w3b2 只取 `order_items` 單一資源。
  **沒有任何一方走 `order_items → proc`** ⇒ 無環。
- 🔴🔴 **ledger 為什麼不參與環 —— 理由第三次重寫(codex 關卡2 MF11 打掉「葉資源」那版)**:
  「葉」的定義是「取得它之後不再取任何鎖」,而 §3.1 的實際序是
  `proc(NKU) → ledger(PK 插入) → receipt INSERT → order_items(trigger 內 NKU)`
  ⇒ 本交易**持有 ledger 之後還會去要 `order_items`** ⇒ **它不是葉,那個字面是假的**。
  **正確的理由(不靠「葉」這個性質)**:
  ① `order_item_receipt_requests` **只有本片的 a2 登錄 RPC 會寫**,沒有任何其他 writer 碰它;
  ② 因此**不可能存在另一個交易「持有 ledger 的某個鍵、再回頭等我們持有的鎖」** ——
     要成環得有人從別的方向進來,而那個人不存在;
  ③ 併發的兩個登錄交易若撞同一個 `request_id`,是**同向**的(都在 `proc → ledger` 之後才碰 order_items),
     後者停在 PK 上等前者提交,單向等待、不成環。
  ⚠️ **這是同一段論證在本檔第三個版本**(v3.2「源點」→ v3.3「葉」→ 現在)。
  前兩版都是**順序改了而理由沒跟著改**。⇒ 若日後再動 §3.1 的守門順序,**這一段要重寫、不得沿用**,
  而且**不要再用「源點/葉」這種依賴取鎖次序的字眼** —— 用「誰會碰這張表」這個不隨順序改變的性質。
- ⚠️ **適用界(A5a `:71-73` 同款)**:限定**每交易單次呼叫本片 RPC、且同交易不混呼 `admin_upsert_supplier`**。
  §5.3/§5.4 的多步流程**必須逐步各自成交易**,不得包成單一交易連呼。

**鎖原語**:對 **`order_items`(parent)** 一律 `FOR NO KEY UPDATE`(`FOR UPDATE` 與 FK 的 `KEY SHARE` 死結,
A2b1 2026-08-03 實測 40P01)。對 **procurement 列本身**本片也用 NKU,而 A5a 用 `FOR UPDATE`
(`20260803160000:57-61`)—— 兩者**互相衝突、照樣序列化** ⇒ 正確性不受影響。
🔴 v3.1 說 NKU「嚴格少擋一種無害併發」**不成立,已刪**(R2-nit1):併發 receipt INSERT 最終仍會在
A4a trigger 裡對 proc 取 NKU 而等待,**只是等待點後移**。選 NKU 的理由降級為「與 parent 同原語」,**不宣稱效能收益**。

🔴 **失效條件**(要有結構驗收釘住):
1. 本片兩支若先鎖 `order_items` 再鎖 proc ⇒ 環立刻成立
   (memory `reference_function-body-scan-blind-to-trigger-locks`:環常整條穿過 trigger)。
2. 有人給 ledger 補上 FK ⇒ 葉性質消失,整段重跑。
3. 有人讓本片碰 `suppliers` ⇒ 同樣重跑。
⇒ **結構驗收 `prosrc` 錨釘住取鎖序**(proc 鎖在 order_items 鎖之前);對調 ⇒ 該格必紅。
⇒ **另一格釘住 ledger 兩欄無 FK**(`pg_constraint` contype='f' 恰 0);補 FK ⇒ 該格必紅。

A2b1 `:32-36` 另立紀律:**多列單交易須依 business key 排序寫入**。本片**每次呼叫恰碰一列 procurement** ⇒ 無排序問題。
🔴 **失效條件**:改成收陣列做批次時這條立刻適用,§4 整段要重跑。

---

## 5. 應用層(#352-b)

### 5.1 共用元件:「登錄到貨」小視窗
欄位:**到貨幾件**(預設 = 該列 `allocated − received`)/ **到貨日期**(預設今天)/ **備註** / **溢收幾件**(預設 0、可收合)。
`request_id` 由**表單一次性產生並隨表單送出**(不是每次 render 重產),否則重送會變成新請求、冪等失效。

**代碼字串 → 中文的對應表**(對齊既有 `procurement-result.ts` 的做法):
`QUANTITY_EXCEEDS_ALLOCATED` 由 app 算出拆分建議(R3-nit1);
`DUPLICATE_REQUEST` **要分兩種文案**(R3-nit4):產物還在 ⇒「這筆到貨先前已經登錄過了」;
產物已被刪 ⇒「這筆到貨先前登錄過,而且後來被刪除了 —— 沒有重新建立」,**不可以只回一個綠色的成功**。

### 5.2 兩個入口(Q2=A)
- **入口 1 — 訂單頁採購區塊**:`item-procurement-section.tsx` 每列尾端加「登錄到貨」。
- **入口 2 — 出貨彈窗**:`blockedReason === 'not_arrived'` 的品項旁加「貨到了」,開同一個小視窗。
  🔴 **只給 `not_arrived`**:四個值各代表完全不同的下一步(`shipment-candidates.ts:77-85` 逐字
  「不要為了少一個分支把它們合併」)⇒ 給 `all_boxed` 一顆「貨到了」是假話。
- 🔴 **登錄成功後彈窗必須就地變成可出(R3-F4)**:D-443 §2B 對 Sean 承諾的是「按下去…**立刻能出**」,
  v3.2 完全沒規格化這一步 = 承諾沒接住。
  作法:server action 成功後 **重新取一次 `loadShipmentCandidates`** 並更新彈窗狀態
  (該品項 `remaining` 由 0 變 N、`blockedReason` 由 `not_arrived` 變 `null`)。
  ⚠️ **不能只靠 `revalidatePath`**:#351④ 肉眼驗已實錘「作廢空箱後列不會從當下明細頁消失、要重整才消」
  ⇒ 彈窗是 client 狀態,**必須明確重取**,不是假設頁面刷新會帶到。
  **驗收 23a** 釘住:入口 2 登錄 2 件 ⇒ **不重整**、同一個彈窗內該品項變成可勾選且可出 2 件。

### 5.3 沒有採購列的品項(店內現貨)
小視窗多問一句「這幾件是哪來的?」→ ①店內現貨 ②選一家供應商。**兩步呼叫、兩個交易,不合併成新 RPC**:
```
① admin_upsert_item_procurement(既有 A5a) → 建/調整那一列
② admin_record_item_receipt                → 記到貨
```
🔴 **刻意不做「一支 RPC 收 order_item_id + supplier_id 自己建列」**:那正是
memory `feedback_null-dispatch-rpc-silently-downgrades` 點名 A5a 的形狀(靠參數 NULL 分流會靜默降級)。

### 5.4 多步流程的失敗與續跑(R2-MF9 + 🔴 R3-F2 重做)

配額不夠時是**三步**,順序**不可對調**(A2b1 逐 statement 發火,`20260803130000:176-179`):
```
① A5a 調降 X 的 allocated(5→3)   ← 調降持平放行(A2b1 COMMENT :164 逐字)
② A5a 建/調升 現貨列 allocated=2   ← 此時 SUM 才有空間
③ admin_record_item_receipt
```
每步各自成交易 ⇒ ① 成功而 ② 失敗會留下 **under-allocation**:這個品項只有 3 件有著落、**帳面短少 2 件**。

🔴 **提示不存在 action 暫態,一律從 DB 推導(R3-F2)**:
v3.2 寫「server action 記錄進行到哪一步 → UI 顯示未完成橫幅」——**那個橫幅是會蒸發的**:
① 成功後員工關掉瀏覽器/重整,暫態就沒了,而帳面短少 2 件**靜默留著**
—— 那正是本節 §5.4 自己說不可接受的情境。
**改成**:採購區塊對每個品項算一個**衍生指標**,🔴 **直接讀既有摘要列的三個欄,不自己再聚合一次**:

```
未登記件數 = quantity − cancelled_quantity − ordered_quantity
             （全部取自 order_item_quantity_summary 的同一列）
```

大於 0 ⇒ 顯示「**這個品項還有 N 件沒有登記來源**」+ 一顆「登記來源」鈕。

🔴 **`ordered_quantity` 就是 `SUM(allocated)`**(`20260730150000:12` 逐字「已向供應商訂了幾件 ←
A2 `order_item_procurement.allocated_quantity` 之和」,由 A4a 維護)⇒ **不要另外寫一個
`SUM(allocated)` 查詢** —— 那會是同一個數字的**第二真相**,正是本檔 §3.2-6 拒絕做的事。
讀模型本來就已經帶著這個摘要(`A9c` 的 nested embed),⇒ **零新查詢**。
**非負性有保證**:A2b1 守 `SUM(allocated) ≤ quantity − SUM(cancelled)`(`20260803130000:164`)
⇒ 這個式子不會是負數,UI 不必處理負值分支。
- **它是持久的**:重整、換裝置、隔天再看都在,因為它是查出來的不是記住的。
- **它比存狀態簡單**:不需要 action 暫態、不需要斷點編號、不需要「繼續」的狀態機。
- ⚠️ **語意誠實**:它說的是「還有 N 件沒著落」,**不是**「流程斷在第幾步」——
  它分不出「從沒開始採購」與「三步做到一半」,而**那兩件事員工的下一步動作本來就一樣**。
  ⇒ 文案不得寫「流程中斷」之類它證明不了的話。
- 三步**全部可重入**(① set-to-value = A5a 路徑④ no-op、② 業務鍵 upsert、③ 有冪等帳)
  ⇒ 從任一步重跑都安全,配合上面的指標就足夠,**不做自動補償**
  (自動回捲要記住原值、會自己失敗、還會與員工同時的手動修改打架)。

⚠️ **已知 UX 缺口(不在本片修)**:若 X 已到貨 4 件,①「改成 3」會撞 A2 的
`received BETWEEN 0 AND allocated`(`:76-77`)吐 **raw 23514**。
本片**在 app 層前置檢查並講白話**(「X 已經到貨 4 件,訂購量不能改到 4 以下」);DB 端不新增守門。

---

## 6. 片界與分級

| 片 | 內容 | 型 | 分級 | 估時 |
|---|---|---|---|---|
| **#352-a1** | migration:§2.1 欄 + §2.2 CHECK 換 + §2.4 ledger 表 + §2.3 種子列(**`is_active=false`**)+ ACL + 結構驗收<br>🔴 **+ `scripts/storefront-projection-leak-guard.test.ts` 登記兩張表名**(施工時發現的必要連動,見下) | M(**+1 支 .ts**) | L2 | ~40 分 |
| **#352-a2** | migration:§3.1 / §3.2 兩支 RPC + §2.5 COMMENT 更正 + `scripts/352a2-verify.sh` harness<br>**+ `database.types.ts` regen**(a1 加了 `surplus_quantity` 與新表,型別要跟上;a1 沒有呼叫端所以不急,a2 有)<br>**+ ⛔ 開工前先上 Sean 桌**:§8-10 溢收列 × 取消閘 | T | L2 | ~45 分 |
| **#352-b** | §5 小視窗 + 兩入口 + 彈窗就地刷新 + 衍生指標 + server actions + smoke test **+ 一支一行 migration 翻種子 `is_active=true`** | U+A(**含一筆 DB 資料寫入**) | L2 | ~45 分 |

🔴 **b 的載具講明(R3-F6)**:翻 `is_active` 用**一支只有一行 `UPDATE` 的 migration**,隨 b 一起 apply、
且**排在 b 上線之前**(否則 UI 有了、供應商還選不到)。
⇒ b 的片型句要誠實寫成「**U+A 且含一筆 DB 資料寫入**」,不是純前端片。
**但它不因此命中鐵則 12③**:12③ 逐字是「DB **結構**與**大量/不可逆**寫入」,而這是**單列、可逆、非結構**的資料更正
⇒ 仍走 code-reviewer;若審查者判它該升,我照辦不爭。

🔴 **a1 施工時發現的必要連動(plan 三輪審查都沒抓到,我實作時才撞上)**:
`scripts/storefront-projection-leak-guard.test.ts` 有一份 `SERVICE_ROLE_ONLY_TABLES` 清單,
backlog **#329** 逐字點名的失效路徑就是「**新表忘登記 = 零防護零訊號**」(該檔 `:62-64` 記著出貨兩張表
2026-08-06 apply 當日補登記的先例)。⇒ 新的冪等帳表**必須同片登記**,否則它對 storefront 洩漏是裸奔的。
**順帶補一條**:`order_item_procurement_receipts` 在此之前是**靠子字串巧合**被涵蓋的
(`order_item_procurement` 是它的前綴,而該守門用 `source.includes(table)`)——
巧合不是設計,上面那條哪天改名或收窄,receipts 會**無聲**失去防護 ⇒ 一併明列。
⇒ **a1 因此含一支 `.ts`**,三綠要跑到 build(鐵則 11)。

**a1/a2 拆開(R1-MF9)**,中間態已按 R2-MF5/MF6 修正:
- a1 落地後**對員工真的零可見改變**:種子 `is_active=false` ⇒ 不進供應商下拉;零 writer;COMMENT 不動。
  🔴 v3.1 說「零行為改變」時種子是 `true`、COMMENT 也在 a1 改 —— **那時候那句話是假的**,現在才成立。
- a1 可驗收中間態 = 欄位在 / CHECK 行為對(owner 直接測 `quantity=0` 寫得進)/ ledger 表與 ACL 在 / 種子列在且停用。

**分級**:
- **L2 而非 L3**(R1-MF10;R3 判「講得住」、主視窗認可):鐵則 9 的 L1/L2/L3 分的是**內容該 hardcode 還是該做後台 CRUD**。
  到貨紀錄**從頭就是後台 CRUD**(本片正是在做那個 CRUD)⇒ L3 的處方已滿足。
  同家族先例 = 完成地圖項 5/6 走 A5a/A10b 標準片。⚠️ **留給 Sean 推翻的窗口**(主視窗會在下次報告時給)。
- **a1 / a2 命中鐵則 12 ③** ⇒ **codex 關卡1+關卡2 都跑、不降級**。
- **b = 標準片**(code-reviewer 必跑)。🔴 **升級條件寫死**:b 若動到 `packages/ui` 的 props 介面或行為 ⇒ 當場升 12⑥。
- 🔴 **a1/a2 未 apply 前 b 不上線**(memory `feedback_app-layer-must-not-ship-before-migration-apply`)。

---

## 7. 驗收(每條可 yes/no)

**a1**
1. 新欄/新表存在;`quantity=0 + surplus=5` 寫得進;`quantity=0 + surplus=0` **被擋**。
2. 種子列 id + label 一致**且 `is_active=false`**;把 label 改掉重跑 ⇒ **fail**。
3. ledger 兩個 uuid 欄**無 FK**(`pg_constraint` contype='f' 恰 0);補 FK ⇒ 該格紅。
4. ACL:**ledger**(a1 新建的那張)表級除 owner 外恰只有 `service_role` 的 `SELECT`、**且那顆 SELECT 確實在**
   (正反兩格)、欄級 ACL 為 0;RLS on + zero-policy。
   ⚠️ **`receipts` 的 ACL 本片不動**(它 2026-07-29 就是 `REVOKE ALL` + 只 `SELECT`)⇒ 不列入本片驗收,
   免得寫成「本片證明了它」。原字面「ledger + receipts 皆只有 SELECT」講大了,已收窄。
5. **a1 中間態**:apply 後供應商下拉**不含**「店內現貨」;receipts 的 COMMENT **仍是** `append-only`。

**a2**
6. `352a2-verify.sh` 全綠,**每條守門各有一格只紅它自己的負測**(消融等長同形)。
7. 正向:`allocated=5 received=0` 登錄 3 件 ⇒ `received=3`、`instock=3`(A4a 級聯真的跑了)。
8. 超收:登錄 6 件 ⇒ `RETURN 'QUANTITY_EXCEEDS_ALLOCATED'`(**不是** raw 23514、**也不是** RAISE)。
9. 溢收:`quantity=0 / surplus=5` 寫得進,`received` 與 `instock` **不變**。
10. 冪等五格:
    ① 同鍵同 payload ⇒ `DUPLICATE_REQUEST` 且**只有一列** receipt
    ① **-a 🔴 `note = NULL` 的同鍵同 payload 重放 ⇒ 必須 `DUPLICATE_REQUEST`**(R3-F1)。
       ⚠️ **這一格的 fixture 必須用 NULL note**;拿非空 note 跑會讓它恆綠 = fixture-vacuous
       (memory `feedback_fixture-value-makes-guard-vacuous` 同型)。把 `IS NOT DISTINCT FROM` 改回 `=` ⇒ 該格必紅。
    ② 同鍵**不同 payload** ⇒ RAISE(caller bug、不具名);訊息含救法
    ③ 同鍵掛**不同 procurement** 的併發 ⇒ 不得外洩 raw 23505
    ④ `p_procurement_id` 不存在 ⇒ `PROCUREMENT_NOT_FOUND`(**不是** raw 23503)**且 ledger 不留孤兒列**
10-a. 🆕 **ledger 與 receipt 同滾(雙線審 consider-1;F3 折面的正主)**:讓步驟 7 的 receipt INSERT 失敗
    ⇒ **ledger 那一列必須一起消失**(同交易);之後用**同一個 `request_id`** 重送 ⇒ 必須**正常成功**
    (回 `RECORDED`),**不得**被誤判成 `DUPLICATE_REQUEST`。
    ⚠️ 這一格是 F3「先產 uuid、ledger 先寫」那個折法的承重點:寫帳與寫產物不同步的話,
    冪等帳會擋住一個從未成功的請求。
11. **不復活**:登錄 → 刪除 → 同一 `request_id` 重送 ⇒ `DUPLICATE_REQUEST` 且 **receipt 沒有被重建**。
11-a. 🔴 **溢收列 × 取消閘(§8-10)**:造一列 `quantity=0 / surplus=5`,然後對該單跑整單取消
    ⇒ **把當下的行為釘成可觀察事實**(是被拒還是放行)。
    Sean 拍板前不預設哪一邊是對的,但**不可以讓它靜默**。
12. **`ALREADY_DELETED` 的判別力**:已刪的 id ⇒ `ALREADY_DELETED`;**隨機不存在的 uuid ⇒ `RECEIPT_NOT_FOUND`**。
13. **併發雙刪(R3-F5)**:兩條連線同時刪同一筆 ⇒ 一個 `DELETED`、另一個 `ALREADY_DELETED`;
    把 `RETURNING` 的 rowcount 判斷拿掉 ⇒ 該格必紅。
14. **deferred 兩格**:①先 `SET CONSTRAINTS … DEFERRED` 再呼叫**刪除** ⇒ 守門仍擋得住
    ②同條件呼叫**登錄** ⇒ 行為不變(證明 §3.1-2 的「不需要」不是宣稱)。
15. **fail-closed**:摘要列缺席 ⇒ 刪除被 RAISE 擋下(**不是**靜默放行)。
16. 刪除正向:刪掉 3 件 ⇒ `instock` 回 0;刪除守門:3 件已裝進未出貨包裹 ⇒ `P4A03`、訊息**列出全部包裹**、交易回滾。
17. `p_request_id`:帶連字號小寫 UUID 收得下;同值大寫 ⇒ **拒收**(不是靜默 lower)。
18. `p_received_at`:界線帶 offset(改 session `TimeZone` 後判定不變);超過 `clock_timestamp() + 5 分鐘` 拒;
    **5 分鐘內的未來值收得下**(證明寬限真的在)。
19. **ledger 零 UPDATE 路徑**(R3-F3):跑完整套後 ledger 每列的 `receipt_id` 與 INSERT 當下相同
    (取 `xmin` 或前後快照比對);任何 UPDATE 出現 ⇒ 該格紅。
20. 鎖序錨:`prosrc` 釘住 proc 鎖在 order_items 鎖之前;對調 ⇒ 該格紅。
21. §2.5 兩處 COMMENT 已更正,且結構驗收在字面沒改時會紅。
22. 突變靶打**真實失效形狀**,且**先證突變真的套上了**才談紅綠(D-440 §7-3:二代四次假存活)。
23. 跑前跑後 `git status --porcelain` 皆空。

**b**
24. 三綠(動 .tsx ⇒ 含 build)。
25. smoke:兩入口開出同一個小視窗;`blockedReason` 非 `not_arrived` 的品項**沒有**那顆鈕。
26. **🔴 入口 2 就地可出(R3-F4)**:彈窗內登錄 2 件 ⇒ **不重整**,同一個彈窗該品項變可勾選、可出 2 件。
27. **🔴 衍生指標持久(R3-F2)**:跑完 §5.4 的 ① 後**直接關掉/重整**⇒
    重新進訂單頁,該品項**仍然**顯示「還有 2 件沒有登記來源」。把指標改回讀 action 暫態 ⇒ 該格必紅。
28. §5.3 兩步流程讓 ② 失敗 ⇒ 畫面誠實顯示「採購列已建、到貨未記」,可重送。
29. `DUPLICATE_REQUEST` 兩種文案分得開(產物還在 / 已被刪),後者**不顯示為單純成功**。
30. 種子列已翻 `is_active=true`,供應商下拉出現「店內現貨」。
31. **零投影洩漏**:供應商身分/單號不得進 storefront(A9a-2 三條列表投影守門照舊綠)。

---

## 8. 誠實邊界與已知缺口(不自宣接受)

1. 🔴 **溢收記得住,但還不能用**:`surplus_quantity` 是掛在這張單上、查得到的紀錄,**不會自動變成可出別單的庫存**。
   真正的庫存軸 = **#374**(Phase 2、Sean 已定調「簡化版 ERP」+「要跟報價單整合」)⇒ 本片不偷跑。
   溢收紀錄屆時是 #374 的資料來源之一(Sean 已接受此講法)。
2. **`received_by` / `p_actor` 是自陳身分**(A5a `:94-95` 逐字)⇒ 不保證那是真的操作者。真身分屬 E8-B。
3. **「唯一寫入口」限定 service_role 應用路徑**:owner / SECURITY DEFINER / 持 owner 憑證的服務仍可直寫表
   (A5a `:90-91` 同款界)⇒ 不得說「繞過稽核的路徑不存在」。
4. **稽核不能反證真寫入**:service_role 對 `admin_audit_log` 有 INSERT ⇒ 可不碰 receipts 就寫假稽核。
5. **文字欄隱形字清單是已知形狀、不宣稱窮盡**(A2 `:213-215` / A5a `:98`)。
6. **`p_received_at` 的未來值檢查在 writer 不在 CHECK** ⇒ owner 直寫仍可塞未來時間。
7. **ledger 的兩個 uuid 欄無 FK** ⇒ DB 層不保證指得到現存的列(刻意,§2.4)
   ⇒ **不能拿 ledger 反推現況**,它只做冪等與稽核。
8. **ledger 單向長大**:列不可刪、不清理。量級與 receipts 同階(遠小於訂單量)⇒ Phase 1 不做保留政策。
9. **A2 既有 CHECK 的時區字面本片不動**:`20260729020000:206-207` 不帶偏移。
   ⚠️ **這不是 runtime 漂移**(v3.1 寫錯、R2-MF8 打回):A5a `:274` 逐字「CHECK 在 DDL 當下就綁定了資料庫預設時區」
   ⇒ 它是 **apply 當下一次性綁定**,不隨呼叫端 session 變 ⇒ **沒有需要修的理由**;本條只記錄它與 RPC 寫法為何不同。
10. 🔴🔴 **溢收列會讓「已到貨不可取消」那道閘看不見它(a1 零回歸,但 a2 落地前必須先給 Sean 拍)**
    —— 雙線審 MF4,**本片最重要的一條誠實邊界**。
    兩道取消閘用的述詞都是 `r.quantity > 0`:
    · `20260804180000:217-219`(整單取消前置閘)
    · `20260805100000:411-413`(A8a2:「任一品項有到貨 ⇒ 拒」,即 Sean 2026-07-28 **Q17=B**
      「已到貨不可取消、只能走退貨」)
    ⇒ 一列 `quantity = 0 / surplus_quantity = N` 的**溢收專用列**會被這兩道閘**判成「沒有到貨」**,
    於是「貨其實已經到了 N 件、就放在店裡」的單**可以被整單取消**。
    **可構造性**:成立。`quantity = 0` 在任何 `allocated/received` 組合下都過得了超收前置閘
    ⇒ 員工可以在一列全新的採購列上只記溢收,該品項就會「有 receipts 但全部 quantity = 0」。
    **a1 本身零回歸**:本片沒有 writer,造不出 `quantity = 0` 的列;而 `0` 對 `SUM` 無貢獻,
    既有列的判定完全不變。
    ⇒ **這是產品題不是技術題**(Q17=B 的原意是「貨到了就不能當沒發生」,而溢收的貨確實到了):
    **a2 開工前上 Sean 桌**;在他拍板前,a2 的驗收要有一格把這個行為**釘成可觀察事實**,
    不論答案是哪一邊,都不可以讓它靜默。

11. 🆕 **§5.4 的衍生指標分不出成因**:它只說「還有 N 件沒著落」,證明不了「流程斷在哪一步」。
    這是刻意的取捨(持久 > 精確),但代表**它不能當「有人操作到一半」的告警**。
11. **本片不做**:批次到貨(UX §2 #7 第 2 批 / A10c2)、退貨收回(第 3 批 `order_returns`)。

## 9. Rollback(R1-MF7:誠實承認不可完全還原)

- **a2** 可逆:`DROP` 兩支 RPC + COMMENT 改回。**b** 的一行 migration 可逆(翻回 `is_active=false`)。
- 🔴 **apply 檢查表要帶一條(a1 雙線審 nit)**:migration 內對 `pg_get_constraintdef()` 做**逐字**比對的那幾格,
  比的是 **PG 的 deparse 輸出**。若正式庫的 PG 版本與本機(17.10)不同、deparse 格式有差,
  那幾格會紅在「定義非預期」。**那時要先分辨是「格式變了」還是「語意變了」**,
  不可以直接把期望值改成新輸出(那等於把守門改成恆真)。
  ⚠️ 實證:我第一版手打那串 deparse 期望值就少了一層外括號、當場誤紅 —— 手打必錯,一律從實際輸出取。
- **a1 不可完全還原**,三件寫進 runbook(不是只寫註解):
  1. 🔴 **`quantity` 的舊 CHECK(`BETWEEN 1`)在有 `quantity=0` 的溢收列時還原不回去** ——
     v3 寫「匯出 surplus 就好」是**錯的**,匯出不能讓 `ADD CONSTRAINT` 成功。
     ⇒ **回滾前必須先拍板那些列怎麼辦**(轉成 `quantity=1`?封存後刪?還是接受「舊 CHECK 不還原」?)
     —— **這是回滾的前置決策點,不是執行細節**;沒拍板就不准跑回滾。
  2. 種子供應商列**刪不掉**(block trigger)⇒ 回滾只能維持 `is_active=false`。
  3. `DROP surplus_quantity` = **溢收數字永久遺失**;`DROP` ledger = 冪等保護消失 ⇒ 兩者都要先匯出留存。

---

## 10. 審查鏈折入紀錄(plan 三輪 **34** 條 + a1 雙線審 16 條,零重複)

⚠️ **數字更正(a1 雙線審 nit)**:原寫「32 條」是我自己加錯 —— 逐項為
R1 `12+2` / R2 `8+2` / R3 `2+4+4` = **34**。(這正是「自己算的數字要重量一次」那條。)

- **R1(codex,審 v3)= FAIL 12MF+2nit** —— 打原始設計。全折。
- **R2(codex,專打 v3.1 的折法)= FAIL 8MF+2nit** —— 🔴 **八條全是我折 R1 時新寫的東西**。全折。
- **R3(Fable,換模型換角度)= FAIL 2MF+4consider+4nit** —— 角度 = 過度複雜 / 員工方便 / 抽驗 §10 折帳。全折。

**R3 逐條**:

| # | finding | 處置 |
|---|---|---|
| **F1 (MF)** | 冪等比對用 `=`,`note` 可為 NULL ⇒ `NULL=NULL` 得 NULL 走「不符」枝 ⇒ **空備註(最常見)的合法重放被當 caller bug 打回** | ✅ §2.4 明寫 `IS NOT DISTINCT FROM`;驗收 10①-a 加 `note=NULL` 重放格,並註明 **fixture 必須用 NULL**(非空 note 會讓該格恆綠 = fixture-vacuous) |
| **F2 (MF)** | §5.4 斷點橫幅若存 action 暫態,① 成功後關瀏覽器 ⇒ 橫幅蒸發、帳面短少 2 件靜默 —— 正是本節自己說不可接受的情境 | ✅ §5.4 改成**從 DB 推導的衍生指標**(`quantity − cancelled − SUM(allocated)`),持久且**比存狀態簡單**;驗收 27 加「① 後放棄重整、指標仍在」格;§8-10 認列它分不出成因 |
| F3 | ledger 兩條 UPDATE 可消(RPC 先產 receipt uuid 免回填 + 已刪改推導)⇒ 表變**真** append-only | ✅ §2.4 + §3.1-6;連帶 **R2-nit2 的改名不再需要**(成因移除) |
| F4 | 入口 2 登錄成功後彈窗刷新未規格化 ⇒ D-443 承諾「立刻能出」沒接住 | ✅ §5.2:明確重取 `loadShipmentCandidates`;並引 #351④ 肉眼驗實錘說明**不能只靠 `revalidatePath`**;驗收 26 |
| F5 | 併發雙刪 DELETE 影響 0 列仍走舊值 | ✅ §3.2-5 改 `DELETE … RETURNING`,0 列 ⇒ `ALREADY_DELETED`;驗收 13 |
| F6 | b 片翻 `is_active` 的載具未指明;若用 migration 則 b 含 DB 寫入面 | ✅ §6:講明是一支一行 migration、排在 b 上線前,片型句改成「U+A 含一筆 DB 資料寫入」,並說明為何仍不命中 12③ |
| nit1 | `QUANTITY_EXCEEDS_ALLOCATED` 訊息要代員工算拆分 | ✅ §3.1-5 + §5.1:由 app 算「還能記 X / 你填了 Y / 多的 Z 填溢收」 |
| nit2 | 同鍵不同 payload 的訊息要白話 + 給救法 | ✅ §3.1-6 |
| nit3 | 具名碼與 A5a `:32`「caller bug 非固定碼」慣例不一致 | ✅ **§3.0 整節重排**:超收改 `RETURN` 代碼、payload 不符改不具名 RAISE ⇒ **新 SQLSTATE 從 3 個降到 1 個**,`P4A02`/`P4A04` **退回主視窗** |
| nit4 | 刪後重放回 `DUPLICATE_REQUEST` 的 UI 文案 | ✅ §5.1:兩種文案分開,已刪那種**不顯示為單純成功** |

🔴 **R3 也抽驗了 §10 的折帳字面**(我對自己折法的自述),結論 = **字面全等事實、無第四次實錘**。
🔴 **R3 親讀了所有被引用的 migration** ⇒ 引用零造假。

**收斂訊號**:R3 的十條裡有**六條讓設計變小**(消兩條 UPDATE、消一欄、消兩個錯誤碼、消掉整個斷點狀態機),
兩條補承諾沒接住的洞(F4/F2),兩條純文案。**方向持續收斂。**

---

**狀態**:三輪折完,等主視窗核 + 批三片。
**錯誤碼**:主視窗批准的三個之中**只用 `P4A03`**;🔴 **`P4A02` / `P4A04` 退回**(§3.0 改用 A5a 的代碼字串慣例後不需要)。

— D 窗三代,2026-08-10
