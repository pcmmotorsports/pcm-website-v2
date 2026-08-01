# 供應商主檔 — 片級 plan **v2**(2026-08-01)

> 取代已作廢的 A5b/A5c。拍板全集 = memory `project_m4b-supplier-master-decisions`。
> 🔴 **命中鐵則 8**(動 schema + 跨 3+ 檔)⇒ **需 Sean 批准才動 code**;鐵則 12 ③ ⇒ 高風險片。
>
> **v1 經 codex 關卡1 判 NO-GO(約 30 must-fix + 3 nit),逐條核實全部成立、駁回 0。**
> 本 v2 為折入版,~~v1 作廢~~。處置見 §10。

---

## §1 Sean 拍板(2026-08-01,逐字)

| # | 逐字 | 落到設計 |
|---|---|---|
| 1 | 「A 下拉選單,供應商還可以自行再增加到下拉選單」 | 主檔 + 選單,不再手打自由文字 |
| 2 | 「那就變成無法刪除就好,只可以修改名稱。」 | 可新增 / 可改名 / **不可刪除** |
| 3 | 停用開關 = A | `is_active`;停用不出現在新單選單、舊紀錄照常顯示 |
| 4 | 「就先這 26 個」 | seed 見 §11(**已確認完整**) |
| 5 | 「名單排序依照字母順序」 | 選單與設定頁一律 `ORDER BY label` |
| 6 | 「名單欄位可以打字快速帶入名單候選」 | 選單 = **typeahead 候選過濾**,非純下拉 |
| 7 | **Q1=A** 改名後歷史採購顯示**新名字** | **不存名稱快照**;代價見 §6 |
| 8 | **Q2=A** 停用旗標先做 | 明知 A10b 之前無人消費,見 §6 |

🔴 拍板 6 順帶補上砍掉機器猜同後的缺口:新增時打「Webike」當場列出已有的 TW/JP/EU
⇒ **用人眼防重複,而且比機器準**(機器會建議把那三家合併,那是錯的)。

---

## §2 實測事實(每條註明查法;🔴 v1 在此節犯過兩次過度概括)

| # | 查什麼 | 結果 | 查法 |
|---|---|---|---|
| 1 | 正式站表名含 `supplier` | **0** | `information_schema.tables` ILIKE |
| 2 | 目標表列數 | procurement **0** / receipts **0** | 唯讀 count |
| 3 | Sean 名單 vs 爬蟲設定 15 家 | **只有 1 家(Gbracing)重疊** | 逐筆正規化比對 |
| 4 | 名單含非 ASCII | **5 家** | `grep -cP '[^\x00-\x7F]'` |
| 5 | 名單含空白或標點 | **9 家** | `grep -cE '[ .]'` |
| 6 | 原 UNIQUE 具名 | **`order_item_procurement_business_key`** | A2 `:69-70` 親讀 |
| 7 | 回滾慣例 | A2 `:667` 逐字「回滾:另立版本號更大的 down migration(**Supabase forward-only**)」 | 親讀 |
| 8 | `supplier-config.ts` 是什麼 | **爬蟲管線設定檔**(檔頭逐字) | 親讀 1-27 行 |

🔴 **v1 的兩處過度概括已撤回**:
- ~~「只有 2 個檔引用 canonical key」~~ —— 我的 grep **只找 `.sql/.sh/.ts/.tsx`、排除了 `.md`**,
  卻下了通則結論。實際至少 8 處(STATUS / master / handoff / review / 舊 plan / 型別 / A2)。
  **限縮搜尋範圍時,結論範圍必須跟著限縮。**
- ~~「改形狀不會打到任何 harness」~~ —— 無獨立 `scripts/` harness屬實,但 **A2 檔內自帶結構驗收與行為探針**。
  (codex 未擊破段落確認:fresh replay 時 A2 先以舊形狀執行、再由本片改形 ⇒ **不需機械改寫已 apply 的 migration**。)
- ~~「supplier-config.ts 證明那 15 家不是下單對象」~~ —— 它只證明那是同步管線設定。
  **真正的證據是 Sean 給的名單本身**(實測 3:26 家裡 25 家不在其中)。

---

## §3 設計

### 3.1 `suppliers`

```sql
CREATE TABLE public.suppliers (
  id         uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  label      text        NOT NULL,
  is_active  boolean     NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT suppliers_label_nonempty   CHECK (pg_catalog.btrim(label) <> ''),
  CONSTRAINT suppliers_label_trimmed CHECK (label = pg_catalog.btrim(label)),
  CONSTRAINT suppliers_label_unique     UNIQUE (label)
);
```

🔴 **`id` 改 uuid、不照 staff 的 text slug**(K1 + 實測 4/5 雙重支持):
staff 用 text PK 是為了相容 `admin_audit_log.actor`(text 無 FK)這個**既有包袱**;
suppliers 零既有資料、id 只是 FK 被參照端、**沒有任何人需要讀它**。
照抄的後果 = 26 家裡 **14 家**(5 中文 + 9 含空白標點)要員工自己造 ASCII slug
⇒ **等於把 canonical key 問題搬到新增畫面**,並未消失。

🔴 **`label` UNIQUE**(K1):PK 只防重複 id,不防兩筆都叫「RPM」——
uuid 之後更是如此。UNIQUE 是「不可分辨的兩個選項」的唯一機器防線。
🔴 **`label = btrim(label)` CHECK**:Sean 原訊息裡 **`RaceSeats ` 帶尾隨空白**(逐字)。
只擋「純空白」會讓 `'RaceSeats '` 與 `'RaceSeats'` 並存 ⇒ CHECK 強制寫入端先 trim。
🟡 **分寸**:**只做 `btrim`(前後空白)**;**不做** NFKC/collation 那套「看起來像」的猜測(A5b 已作廢)。
🔴 ~~「內部連續空白收斂」~~ **撤回(關卡2 R2)**:那句話沒有任何承接者 —— schema 只有 `btrim`,
S2 契約與驗收也都沒有它。**實測 `'Eazi  Grip'`(中間兩個空白)現在插得進去**,
與 `'Eazi Grip'` 會並存為兩家。這是**已知缺口、不是隱藏 bug**:防線是 S3b 新增畫面的 typeahead
(打「Eazi」會同時列出兩筆給人眼看)。日後若要真的收斂,必須另開一支 migration 加 CHECK,
並先決定既有列怎麼處理 —— **不得在文件裡先宣稱它已經成立**。

**不可刪除的三道**(🔴 K1:v1 只有 FK,**擋不住刪除尚未被引用的列**):
1. 不給 `service_role` DELETE / TRUNCATE 權。
2. FK `ON DELETE RESTRICT` —— 擋「已被採購列引用」的。
3. 🆕 **`BEFORE DELETE` trigger 無條件 `RAISE`** —— 這才是擋 owner / SECURITY DEFINER 的那道。
   (依據:A7-t 交接檔已記載「owner / SECURITY DEFINER 不受表級 GRANT 限制」。)

**ACL**:`REVOKE ALL … FROM PUBLIC, anon, authenticated, service_role` 後,
service_role **只補 `SELECT`**。
🔴 **v1 給了 INSERT/UPDATE ⇒ 可繞過 S2 的 RPC 與同交易稽核**(K1);
改為**寫入一律走 owner RPC**,與 07-31 Q1=D 一致。
RLS enable + zero policy;`updated_at` touch trigger 照 staff。

### 3.2 `order_item_procurement` 形狀改

| 動作 | 內容 |
|---|---|
| DROP | `supplier_name`、`supplier_canonical_key` |
| DROP | `CONSTRAINT order_item_procurement_business_key`(**具名實查來的**,非猜測) |
| DROP | canonical 單欄索引(A2 `:158-160`) |
| ADD | `supplier_id uuid NOT NULL REFERENCES public.suppliers(id) ON DELETE RESTRICT ON UPDATE RESTRICT` |
| ADD | `CONSTRAINT order_item_procurement_business_key UNIQUE (order_item_id, supplier_id)`(**沿用原名**) |
| ADD | 🆕 `INDEX (supplier_id)` —— K1:新 UNIQUE 以 `order_item_id` 開頭,**代替不了供應商維度查詢** |

**migration 骨架**(🔴 K1;v1 漏、A5b v3 有 —— 同一課沒帶過來):
顯式 `BEGIN; … COMMIT;` + `SET LOCAL lock_timeout` + `SET LOCAL statement_timeout`,
與既有 40 餘支一致(Sean 07-29 D0-1=A)。

---

## §4 拆片(5 片;🔴 v1 的 3 片被 K1 判定過大)

| 片 | 型 | 內容 |
|---|---|---|
| **S1a** | M | `suppliers` 表 + 3 道不可刪除 + ACL/RLS + touch trigger + **seed 26 家** + 檔內結構驗收 + `scripts/s1a-verify.sh` |
| **S1b** | M | `order_item_procurement` 改形狀 + 索引 + **COMMENT 兩方向驗收** + `scripts/s1b-verify.sh`。🔴 **不含型別重 gen** —— 它由正式站 schema 產生、apply 前物理上做不了,改列 apply runbook(見 §5-10;關卡2 R2 抓本欄與 §5-10 直接矛盾) |
| **S2** | R | `admin_upsert_supplier` owner RPC(新增/改名/切停用)+ 同交易 audit |
| **S3a** | A | 讀模型 + server action(`listSuppliers` 含 active 過濾與 `ORDER BY label`) |
| **S3b** | U | `/settings/suppliers` 頁:列表(字母序)+ 新增(typeahead 候選)+ 改名 + 停用開關 |

🔴 **v1 的 S1 同時含新表 + 改既有表 + ACL + 驗收 + harness + mutants + 型別重 gen,
估「15-45 分鐘」沒有可信拆解**(K1)⇒ 拆成 S1a/S1b。
🔴 **v1 的 S3「照 staff」實際對應約 15 個來源/測試檔、1,725 行**(K1 實數)⇒ 拆成 S3a/S3b,
且 **S3b 必須附 file manifest 並逐檔驗 ≤400 行**(鐵則 6;K1 指出 staff 最大檔 381 行、尚未破限但無保證)。

🔴 **本片零項 27 項驗收變綠**(**K1 抓 v1 引用錯項**:v1 說「第 26 項部分綠」,
而第 26 項是「**員工各自帳號與權限**」,供應商設定頁對它零貢獻)。
誠實定位 = **第 5/6 項(標已向供應商下單、記供應商單號)的前置**,那兩項要等 A10b。

---

## §5 驗收條件(每條指名向量;🔴 v1 的驗收幾乎全在 S1,刪掉 S2/S3 仍全綠)

**S1a**
1. 恰 5 欄逐欄比對;具名約束集合恰為 `{suppliers_pkey, suppliers_label_nonempty,
   suppliers_label_trimmed, suppliers_label_unique}`(**4 個**、雙向集合相等)、零未驗證約束。
   🔴 ~~「恰 3 個具名約束」~~ 作廢:那個數字漏算 PK,與已 commit 的 S1a 實作(4 個)分岔
   (關卡2 #3 抓;**驗收的真權威分岔比實作寫錯更危險** —— 它會讓後續片照錯的數字寫斷言)。
2. RLS true + zero policy。
3. **ACL:先斷言 `relacl IS NOT NULL`**(`a7bt-acl-rollback-lock.sh:129` 記載 IS NULL 曾是假綠),
   再驗 grantee 集合恰 `{owner, service_role}`;service_role **恰只有 SELECT**
   (有 INSERT/UPDATE/DELETE/TRUNCATE 任一即紅)。**PG17 八種權限全查含 `MAINTAIN`**。
4. **不可刪除三道各自獨立負測**:①service_role DELETE → `42501`
   ②owner DELETE 未被引用的列 → **BEFORE DELETE trigger 的具名錯誤**(`P0001`)
   ③owner DELETE 已被引用的列 → 🔴 **正常狀態下得到的是 `P0001` 不是 `23503`** ——
   S1a 的 `BEFORE DELETE` trigger 無條件先炸,FK 永遠輪不到 ⇒ **原條件物理上不可達**
   (關卡2 #4;S1b 施工時獨立實測確認)。改為:**停用該 trigger 後** DELETE 已被引用的列 → `23503`,
   並在報告裡註明「FK RESTRICT 是縱深防禦第二層,不是可獨立觀察的第一道」。
   同理 TRUNCATE 在 S1b 之後也變兩層(第一層 = 下游 FK `0A000`,第二層 = trigger `P0001`)。
5. `label` 負測:純空白 → `suppliers_label_nonempty` / 帶尾隨空白 → `suppliers_label_trimmed` /
   重複 label → `suppliers_label_unique`。(~~`suppliers_label_normalized`~~ 是 v2 寫錯的名字,
   已 commit 的 S1a 用的是 `_trimmed`;關卡2 #3。)
5b. `is_active` 的 **DEFAULT 必須是 true** 且 seed 26 家全部 `is_active=true`
   —— 只驗欄數的話,把 DEFAULT 改成 false 會讓 26 家全停用、選單永遠是空的,而驗收照樣全綠(關卡2 #7)。
6. seed:**恰 26 列**、逐字比對 §11 清單、且**全部 `label = btrim(label)`**。

**S1b**
7. 舊兩欄不存在;`supplier_id` NOT NULL;FK `confdeltype='r'` 且 `confupdtype='r'`;
   `order_item_procurement_business_key` 的 constraintdef 逐字為新定義;`(supplier_id)` 索引存在。
8. 負測:插不存在的 `supplier_id` → `23503`;同 `(order_item_id, supplier_id)` 插兩次 → `23505`。
9. **COMMENT 兩個方向都要驗**:①禁字方向 —— `canonical` / `supplier_name` 在表與各欄註解零殘留
   (A2 的 COLUMN COMMENT 隨欄 DROP 自動消失;A1 `20260730150000:170-174` 的 TABLE COMMENT 要整段改寫)
   ②**必要內容方向** —— 表註解必須同時保留 A1 的 `order_item_quantity_summary` 更正與本片說明,
   `supplier_id` 欄註解與 business key 約束註解必須存在且各自載明它負責記住的債。
   🔴 只驗禁字的話,把三段 COMMENT 全部省略不下、舊註解原封留著,驗收仍會全綠(關卡2 #14)。
   🔴 查 `pg_description` 必須帶 `classoid`(鍵是 `(objoid, classoid, objsubid)`;關卡2 #15)。
10. 🔴 **型別重 gen 不屬 S1b,改列為 apply 後的獨立步驟**(關卡2 #5 抓出 plan 與實作打架):
    `database.types.ts` 由**正式站** schema 產生 ⇒ 在 Sean `db push` 之前物理上做不了。
    ⇒ S1b 的 DoD **不含**重 gen;它與「貼回 `create_order.Args` 的三處人工校正
    (`p_client_ip`/`p_client_ua`/`p_notification_email` 的 `| null`)」一起,
    列進 apply runbook,以 typecheck 轉綠為證。
    **在重 gen 之前不得宣稱型別已對齊**(現況安全的理由:全樹只有 `database.types.ts`
    一個檔提到 `order_item_procurement`、零 app code 消費 —— 本片實 grep 確認)。
10b. **相依物前置閘**:DROP 之前必須斷言採購表的索引集合、無繼承子表、無欄級 ACL
    —— `DROP COLUMN` 會靜默連帶刪索引並遞迴子表,事後的結構驗收看不出「消失的只有我打算刪的」(關卡2 #11)。

**S2**
11. RPC 是 `SECURITY DEFINER` + `SET search_path` + `REVOKE ALL FROM PUBLIC` + **只 GRANT service_role**。
    🆕 **另加三條(S2 施工/審查逼出來的)**:①函式 owner 必須等於 `suppliers` 的 owner
    (攤平 ACL 時 owner 那列被排掉 ⇒ 它是唯一沒被釘住的欄位,而 SECURITY DEFINER 的全部語意
    就是「以 owner 身分跑」)②函式 owner 必須對 `admin_audit_log` 有 INSERT(否則 apply 全綠、
    上線第一次呼叫才 42501)③**`suppliers` 必須零欄級 ACL** —— `relacl` 只放表級授權,
    做一次 `GRANT UPDATE (is_active) … TO service_role` 表級攤平**完全看不到**(實測),
    而 service_role 從此可直接停用供應商、零稽核。
11b. 🔴 **apply 之後必須重 gen `database.types.ts`**(關卡2 #16):S2 新增一支 RPC ⇒
    `Functions` 區塊會變,而該檔由**正式站** schema 產生 ⇒ apply 前做不了。
    重 gen 後必須貼回 `create_order.Args` 的三處人工校正(`p_client_ip` / `p_client_ua` /
    `p_notification_email` 的 `| null`),**以 typecheck 轉綠為證**。
    🔴 **片界更正(R3 #N10)**:`admin_upsert_supplier` 的**呼叫端在 S3b**(設定頁的
    新增/改名/停用 action),不是 S3a —— S3a 依 §4 只做讀模型 `listSuppliers`。
    ⇒ 重 gen 是 **apply 之後的固定步驟**,而**第一個真的需要它的片是 S3b**。
    ~~原字面「S3a 要用 typed `.rpc('admin_upsert_supplier')`」~~ 與 §4 的片界分岔,已更正。
11c. 🔴 **apply preflight(R3 #N8)**:11 的第三條(`suppliers` 零欄級 ACL)是**第一次**
    對正式站執行的檢查(S1b 的欄級 ACL preflight 只查了採購表)⇒ `db push` 之前先跑:
    `SELECT count(*) FROM pg_attribute WHERE attrelid='public.suppliers'::regclass
     AND NOT attisdropped AND attacl IS NOT NULL;` 預期 **0**;非 0 先查是誰授的,不要直接 push。
12. **稽核原子性**:RPC 回 **`CREATED` 或 `UPDATED`** ⇒ `admin_audit_log` 同交易恰多一列;
    🔴 **回 `NO_CHANGE` / `NOT_FOUND` / `DUPLICATE_LABEL` 是正常業務結果、必須零稽核**
    (關卡2 #15 抓:原字面「RPC 成功 ⇒ audit +1」會把這三種也算成要寫稽核)。
    RPC 中途失敗 ⇒ **零留痕**,且**三個方向都要測**(關卡2 #7):
    ①主資料寫入失敗 ⇒ 零稽核 ②稽核寫入失敗 ⇒ 已寫的主資料不留 ③稽核寫完之後才失敗 ⇒ 兩邊一起不留。
    ~~「稽核寫完之後才失敗構造不出來」~~ 已被推翻(把 audit 之後的 `RETURN` 突變成 `RAISE` 即可)。
13. 輸入白名單:不得改 `id`、不得寫時間欄。
    🔴 **判別力界線**(關卡2 #9):參數簽章(結構)+ 前後值相等(行為)合起來證的是
    「這些欄的**值**沒有被改動」,**不是**「函式的 SET 清單裡沒有它們」。

**S3a/S3b**
14. `listSuppliers` **預設只回 `is_active=true`**;🔴 **突變:拿掉該過濾必須有測試轉紅**
    (K1:v1 的 criterion 7 只證明 inactive 列 JOIN 得到,**拿掉選單過濾仍全綠** = 沒測到停用的核心承諾)。
15. 排序:`ORDER BY label`,測試含**中英混排**向量(阿毅物流 / AKOSO / Webike TW)釘住實際順序。
16. typeahead:輸入 `Webike` ⇒ 候選恰 3 筆;輸入不存在字串 ⇒ 零候選且**不得**變成自由文字新增。
17. S3b file manifest 逐檔 ≤400 行(鐵則 6)。

**全片**:突變證明 + 零留痕 + 三綠(S3 動 `.tsx` ⇒ 含 build)。
🔴 **突變證明的範圍要講準**(關卡2 #14 抓 —— 原字面「每條具名守門破壞後對應負測必須轉綠」
是**全稱宣稱**,而 S2 的 harness §D 自己就列了做不到的那些,兩處直接打架):

- **行為可觀察**的具名守門 ⇒ 必須有突變格,且攻擊向量只被那一條擋住。
- **被別道嚴格蘊含**的(例:S2 的 `label` 必填被 S1a 的 CHECK 蘊含、`actor` 必填被
  `admin_audit_log` 的 NOT NULL 蘊含)⇒ **構造不出只紅它的向量**,不得硬寫假覆蓋;
  逐條列進 harness 的「沒有突變證明」節並寫明被誰蘊含。
- **純結構**的(簽章 / ACL / owner / 回傳型別 / SECURITY DEFINER / search_path)⇒ 由結構斷言
  搭配 migration 檔內 fail-closed 閘涵蓋,同樣逐條列進該節。

⇒ **驗收條件是「那一節存在且逐條有理由」,不是「突變數 = 守門數」。**

---

## §6 誠實邊界

- 🔴 **改名會追溯改寫所有歷史採購的顯示名**(Sean Q1=A 知情選擇):
  三月向「老吳精品」下的單,八月改名後會顯示「老吳車業」。**不存下單當時的名稱快照。**
  代價 = 翻舊帳時看到的名字與當時單據不一致。**若日後要補快照,需在 procurement 加欄 + 回填。**
- 🔴 **`is_active` 在 A10b 之前是無作用旗標**(Sean Q2=A 知情選擇):S1a-S3b 全部完成後,
  **沒有任何「新單選單」在消費它**。驗收 14 測的是 `listSuppliers` 的過濾,**不是**真實下單流程。
- 🔴 **FK 只驗存在、不驗可用**(K1):A5a 若只收 `supplier_id`,會接受 **inactive** 的供應商。
  ⇒ **等價債重現、非消滅**,已寫進 §8-4 的 A5a 契約債。
- **不做相似名稱機器比對**。`Eazi-Grip` 與 `Eazi Grip` 若被建成兩家,系統不阻止、不提醒;
  防線是拍板 6 的 typeahead(人眼)+ `label` UNIQUE(擋完全相同)。
  🆕 **S2 施工實測補一種形狀**:`label` UNIQUE **區分大小寫** ⇒ `akoso` 與 `AKOSO` 也會並存
  (實跑 `admin_upsert_supplier(NULL,'akoso',…)` 在已有 `AKOSO` 的庫回 `CREATED`)。
  ⇒ 已知不擋的形狀共三種:**內部空白 / 大小寫 / 標點**。**這是清單不是窮舉** ——
  任何「機器會幫我抓重複」的預期在本線都不成立。
- 🔴🔴 **S2 R3 抓到的最重一條契約債(交給 S3b)**:`p_supplier_id` 為 NULL = 新增,這是
  「一支函式靠參數 NULL 分流三種動作」的固有代價 —— **一個改名請求若因呼叫端 bug 弄丟 id,
  會靜默降級成新增**。實測 `admin_upsert_supplier(NULL,'AKOSO 改名後',…)` 回 `CREATED`、
  26→27 家、原本那家原封不動 ⇒ **多一筆永久垃圾列(供應商不可刪除)+ 改名沒發生 + 零錯誤**。
  ⇒ **S3b 的改名 / 停用 action 必須斷言回傳碼 ∈ `{UPDATED, NO_CHANGE}`,收到 `CREATED` 當成呼叫端 bug
  報錯,不得視為成功。** 訊號本來就在回傳碼裡,缺的是有人去看它。
  🔴 根治法 = 拆成 create / update 兩支 RPC(型別層分流、弄丟 id 就是編譯錯),
  但那要動已定的片界、需重提 plan ⇒ **S2 不做**;斷言回傳碼是夠用的便宜解。
  harness 的 `B12c` 已把「目前沒有守門」這個行為釘住 —— 哪天真的加了守門,那一格會轉紅提醒改本節。
- 🆕 **S2 審查發現的新契約債(交給 S3a/S3b,不在 S2 解)**:`admin_upsert_supplier` 撞到
  **已停用**的同名供應商時,回的一樣是 `DUPLICATE_LABEL`;而驗收 14 定 `listSuppliers`
  **預設只回 `is_active=true`** ⇒ 員工會看到「這家已存在」但 typeahead 裡找不到它、
  也無從改名或重新啟用 = **UI 死路**。
  ⇒ **S3b 必須有一條「顯示已停用的同名候選 + 一鍵重新啟用」的出口**,否則這是死角。
  S2 不擴大回傳碼去解它(那要動 S3a/S3b 的資料合約)。
- 🟡 **S2 審查順手查到的相鄰缺口(不屬本線任何一片、登記備查)**:S1a(`20260801140000`)
  對兩支 trigger 函式只 `REVOKE ALL … FROM PUBLIC`、**沒涵蓋 anon/authenticated/service_role**,
  而環境的 `ALTER DEFAULT PRIVILEGES` 會把 EXECUTE 補回給那三個角色。
  **無可利用性**(trigger 函式直呼必炸 `can only be called as triggers`),但寫法與 S2 不一致。
  修它 = 動已 apply 物件的 ACL = 另一支 migration 的決定,**不夾帶進 S2**。
  🔴 **不得宣稱「任何機器名稱處理都不值得」**(K1 抓 v1 此句過度概括)——
  A5b 那 37 條打在 plan 上、函式本體未被擊破;**成立的結論只有「在本片這個形狀下不需要」**。
- **id 是 uuid** ⇒ 沒有「打錯字只能重建」的問題;label 可改所以顯示面永遠可補救。
- 本機 PG17.10 非 Supabase、C locale ≠ 正式站(#305)⇒ harness 全綠不外推。
- 零 TapPay 接觸面、零金額欄位、零業務資料列寫入(seed 除外)。

---

## §7 決策點

**D1 — seed 26 家**(Sean 拍板 4,已確認完整)。~~v1 建議空表~~ 作廢。

**D2 — 排序 collation**:`ORDER BY label` 在中英混排時的順序由 collation 決定
(正式站 `en_US.UTF-8`:拉丁 A-Z 在前、中文在後)。
**建議照 DB 預設、不特別指定**,並由驗收 15 用實際向量**釘住當下行為** ——
這樣哪天 collation 變了會轉紅而不是靜默改順序。
🟡 若 Sean 要中文照筆畫或注音排,需另指定 ICU collation,屬 S3b 的可調項、不影響 schema。

---

## §8 連動落檔

| # | 位置 | 動作 |
|---|---|---|
| 1 | master §5.1 row 27(A5b)/ row 45(A5c) | 標作廢並指向本 plan。🔴 **語意改寫、不得機械換字**(A5b R3 F13 教訓) |
| 2 | master §5.1 **row 24(A2,`:353`)** | 🆕 **K1 抓 v1 漏列** —— 仍宣稱有 `supplier_name` / canonical key / 舊 business key,會繼續指導後片寫錯 |
| 3 | master §5.1 row 32(A5a) | 改為「收 `supplier_id`」 |
| 4 | master row 32 **新增契約債** | 🆕 A5a 必須**拒收 inactive supplier**(FK 只驗存在不驗可用) |
| 5 | master §5.0 DAG + §5.0b 閉環矩陣採購列 | A5b/A5c 移除、S1a-S3b 置入 |
| 6 | A2 `:123-126` 的 name/key 等式債 | 由 S1b migration 內 `COMMENT` 明文結案(**不得靜默跳過**) |
| 7 | 完成地圖 §2 | 🆕 **更正 v1 的引用錯項**:本片零項變綠,是第 5/6 項的前置 |

---

## §9 rollback(🔴 v1 整節被 K1 打掉,重寫)

**依 repo 慣例 = forward-only down migration**(A2 `:667` 逐字)——
**不刪 migration ledger 列**,而是另立版本號更大的 down migration。v1 的「刪兩筆 ledger」作廢。

down migration 必須逐項還原(v1 全漏):
① 兩個非空 CHECK ② canonical 單欄索引 ③ A2 與 A1 的原 COMMENT 逐字
④ **具名** `order_item_procurement_business_key`(匿名 `ADD UNIQUE` 會產生別的名字 ⇒ schema diff 漂移)
⑤ `suppliers` 的 touch function(`DROP TABLE` 只帶走 trigger、**不帶走獨立函式**)
⑥ `database.types.ts` 重 gen 或 git 還原(否則 TS 仍宣稱 `supplier_id`,且可能再沖掉三處人工校正)

🔴 **0-row gate 只防業務資料遺失,證明不了「還原 prior state」**(K1)——
down migration 自己要有結構斷言,不是靠列數閘。

---

## §10 K1 findings 處置(約 30 must-fix + 3 nit,**全成立、駁回 0**)

**設計層**:id 改 uuid(#4/#5)/ label UNIQUE(#10)/ service_role 收回寫入權(#6)/
不可刪除補第三道 trigger(#7)/ 補 `supplier_id` 索引(#11)/ S2 RPC 規格補齊(#7)。
**字面 vs 事實**:「只有 2 個檔」撤回(#1)/「不打到 harness」修正(#2)/
「supplier-config 證明不是下單對象」改由 Sean 名單佐證(#3)/「第 26 項變綠」更正為零項(#12)/
「任何機器名稱處理都不值得」撤回(#11)。
**驗收**:S2/S3 各自有驗收(#16)/ 停用承諾改測選單過濾並配突變(#17)/ 停用在 A10b 前無人消費入誠實邊界(#18)。
**連動**:master A2 row(#13)/ A1 active COMMENT(#14)/ 型別重 gen 與三處校正(#15)/ A5a inactive 債(#16)。
**rollback**:整節重寫(#19-25)。**片大小**:S1→S1a/S1b、S3→S3a/S3b(#26/#27)。
**nit 3 條**:`%supplier%` 查詢語意收窄 / provenance 無法自證(改為註明查法)/
「排除 id 否則斷 FK」理由改為「`ON UPDATE RESTRICT` 會拒絕,排除 id 是避免無謂的失敗路徑」。

**codex 明說未擊破**:正式站三項唯讀查詢結果屬實 / A2 舊驗收在 fresh replay 先跑舊形狀
⇒ 不需機械改寫已 apply migration / 0-row gate 足以防本次業務資料遺失 / 鐵則 6 尚未被實證擊破。

---

## §11 seed 名單(Sean 2026-08-01 逐字,26 家,已確認完整)

```
WRS s.r.l / Extreme-Components / Omnia Racing / Webike TW / Webike JP / Webike EU /
IMPEX / E PLOT / WoodCraft / 阿毅物流 / 安豐達 / 豪元國際 / 老吳精品 / Gbracing /
FOWLER / RaceBikeBitz / PROTI / MAPD / 陳蔚仁 / RaceSeats / MOTOBIKE TH / AKOSO /
RPM Carbon / KINEO IN-MOTION / S2-Concept / VDM PARTS
```
🔴 seed 前逐筆 `btrim`(原訊息 `RaceSeats ` 帶尾隨空白)。順序不代表優先級;顯示序由 §7 D2 決定。

— END —
