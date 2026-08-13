# 採購撤銷 plan(採購「改軟」線 片 2)

> **狀態:** v1 草案,**未經 Sean 批准 ⇒ 一行 code 都還沒寫**(鐵則 8)。
> **片型:** 🔴 高風險片(鐵則 12③ DB 結構 / 不可逆寫入)⇒ 關卡 1 codex 對抗審查 → Sean 拍板 → 才動手。
> **上游拍板:** Sean 2026-08-13 凌晨 Q6=A(只做採購「改軟」、不新增採購單實體、不做庫存)/ Q10=A(採購改軟三片先做)。
> **同線:** 片 1 到貨撤銷已收 `4d774876`;片 3 欄位精簡等 OD 定案。
> **需求原文(Sean 2026-08-12 逐字):**「然後採購也要可以取消,有可能 key 錯資訊之類」。

---

## §0 現況重數(開工第一動;每條附 `檔案:行號`)

前代交接的警告逐字:「片 2 派工單那句 `grep`=0 **只證『沒有這個名字的 RPC』**,證不到沒有別條路。」
⇒ 本節不是查一個名字,是把 `order_item_procurement` 的**所有寫入面**逐條列出來。

### §0-A 掃描方法(先寫方法,才能判斷結論的作用域)

| # | 面 | 怎麼掃 | 結果 |
|---|---|---|---|
| 1 | 建表與約束 | 讀 `supabase/migrations/` 建表檔全文,不查 `information_schema`(契約債與交辦寫在註解裡) | §0-B |
| 2 | SQL 寫入語句 | `grep -rn "DELETE FROM public.order_item_procurement\|UPDATE public.order_item_procurement\|INSERT INTO public.order_item_procurement" supabase/migrations/`(三個動詞各自跑、含無 schema 前綴變體) | §0-C |
| 3 | 函式(不猜名字) | 對 21 個提及本表的 migration 逐檔 `awk` 出「函式標頭 + 其後有無提及本表」⇒ 得到**函式清單**,而不是「某個猜出來的名字在不在」 | §0-D |
| 4 | trigger | `grep -rn "CREATE TRIGGER\|CREATE CONSTRAINT TRIGGER" supabase/migrations/ \| grep -i "procurement\|receipt"` | §0-E |
| 5 | view | 全 repo `CREATE (OR REPLACE) VIEW` 清單 × 提及本表的檔案取交集 | **零**(本表零 view) |
| 6 | 表級授權(service_role 直寫) | 讀建表檔 ACL 段 + 該檔自己的 fail-closed 斷言 | §0-F |
| 7 | pg_cron | `grep -rln "cron.schedule" supabase/migrations/` = 2 檔(`20260809170000` 逾期單、`20260723120000` settle sweep),兩檔皆**不在**提及本表的 21 檔清單內 | **零** |
| 8 | 應用層 | `grep -rn "order_item_procurement" apps/ packages/ scripts/` + `admin_*` RPC 名稱全清單抽取 | §0-G |

### §0-B 表與約束(`20260729020000_m4b_e10_a2_order_item_procurement.sql`)

- `:43` `order_item_id uuid NOT NULL REFERENCES public.order_items(id) **ON DELETE RESTRICT**`
- `:69-70` `UNIQUE (order_item_id, supplier_canonical_key)` = 業務鍵(A5a 冪等重放靠它)
- `:73-74` `CHECK (allocated_quantity BETWEEN **1** AND 100000)` ← **允許值不含 0**(案 C 的硬阻礙)
- `:76-77` `CHECK (received_quantity BETWEEN 0 AND allocated_quantity)`
- `:186` 子表 `order_item_procurement_receipts.procurement_id … **ON DELETE RESTRICT**`
  ⇒ 🔴 **有到貨紀錄的採購列,DB 物理上已經刪不掉**(23503)。這是既有防線,不是本片要新建的。
- `:178-181` receipts 檔頭逐字:「append-only(同 order_notes):到貨是既成事實,不改不刪…**登錄錯了的更正機制 = 第 2 批批次到貨 UI 落地時才設計**」

### §0-C 全 repo SQL 寫入語句(三個動詞逐一)

| 動詞 | 命中 | 性質 |
|---|---|---|
| `DELETE FROM public.order_item_procurement` | `20260803140000:697` | 🟡 **DO 區塊內的自我驗收探針**(同檔 `:690` 先 `UPDATE … received_quantity = 2`),非生產路徑 |
| 同上 | `20260729020000:641` | 🟡 建表檔自己的 probe,同上 |
| 同上 | `20260803160000:83` / `20260810230000:115` | 🟡 **註解**(交辦「當日出路 = owner 手動 DELETE」) |
| `UPDATE public.order_item_procurement` | `20260803140000:308` | ✅ 生產:A4a `received_quantity` 同步(旗標路徑) |
| 同上 | `20260803140000:379` | ✅ 生產:A4a backfill |
| 同上 | `20260803160000:354` / `20260806200000:386` | ✅ 生產:A5a upsert 的 update 分支(後者為現行版) |
| `INSERT INTO public.order_item_procurement` | `20260803160000:383` / `20260806200000:415` | ✅ 生產:A5a 的 create 分支 |
| 同上 | 其餘 20+ 處 | 🟡 全在 DO 驗收/probe 區塊 |

⇒ **結論(帶作用域):在 migration 文字面上,生產路徑對本表的寫入只有 A5a(I/U)與 A4a(U,僅 received 欄)。全 repo 零生產 DELETE。**

🔴 **這句話的數法(可重現)**:
```bash
cd /Users/sean_1/pcm-procure-undo
grep -rn "DELETE FROM public.order_item_procurement\|DELETE FROM order_item_procurement\|delete from public.order_item_procurement" supabase/migrations/
grep -rn "UPDATE public.order_item_procurement\|UPDATE order_item_procurement" supabase/migrations/
grep -rn "INSERT INTO public.order_item_procurement\|INSERT INTO order_item_procurement" supabase/migrations/
```
命中 **6 / 5 / 30** 行(2026-08-13 實跑;上表逐行分類)。

⚠️ **量具本身的兩個天花板,逐一交代**:

1. **這個 pattern 比目標寬**:`DELETE FROM public.order_item_procurement` 會**一併命中子表** `order_item_procurement_receipts`(前綴相同)。6 行裡有 2 行(`20260810233000:386`、`20260803140000:696`)其實是子表 ⇒ 打到 parent 的 DELETE 只有 4 行,而那 4 行是 2 個 probe + 2 段註解。**分類已在上表逐行寫明,不靠總數說話。**
2. **這個 pattern 比目標窄**:動態 SQL 組出來的表名它看不到。⇒ 另外數一次:
   ```bash
   grep -rn "EXECUTE format" supabase/migrations/          # 2 行
   grep -rn "EXECUTE '\|EXECUTE v_\|EXECUTE sql" supabase/migrations/   # 0 行
   ```
   兩行逐字看過:`20260531142534:57` 是 RLS 自動啟用的 event trigger(`alter table … enable row level security`,DDL 非 DML)、`20260809200000:215` 是**註解**(在講這個天花板本身)。⇒ **全 repo 沒有會寫到本表的動態 SQL**,但這是**另外數的一次**、不是上面三個 grep 涵蓋的。
   🔴 **自我更正**:本節初稿寫「`EXECUTE format` 命中 = 0(實跑)」—— 那是**沒跑就寫**,實際是 2。已改成實跑值與逐行判讀。

### §0-D 函式清單(不是猜名字,是列出來的)

提及本表的函式共 **16 支**(含改版):

| 函式 | 檔:行 | 對本表做什麼 |
|---|---|---|
| `admin_upsert_item_procurement` | `20260803160000:107` → 現行版 `20260806200000:79` | **唯一應用寫入口**(INSERT / UPDATE) |
| `pcm_a4a_recompute_order_item_summary` | `20260803140000:140` → 現行版 `20260806180000:180` | 只讀本表,寫摘要 |
| `pcm_a4a_procurement_summary_recompute` | `20260803140000:220` | trigger 入口(讀) |
| `pcm_a4a_receipts_received_sync` | `20260803140000:258` | 寫 `received_quantity`(旗標路徑) |
| `pcm_a4a_received_quantity_guard` | `20260803140000:195` | BEFORE 守門,擋直寫 `received_quantity`(P4A01) |
| `pcm_a4a_cancellation_summary_recompute` | `20260803140000:322` | 只讀 |
| `pcm_a2b1_procurement_allocation_guard` | `20260803130000:102` | 跨列總量守門(讀) |
| `pcm_suppliers_block_delete` | `20260801140000:101` | 讀本表擋刪供應商 |
| `admin_cancel_order`(a8a1 / a8a2) | `20260804180000:83` / `20260805100000:80` | **只讀**(`:217-218` EXISTS、`:380-413` SUM)—— 取消不刪採購列 |
| `admin_record_item_receipt` / `admin_delete_item_receipt` | `20260810233000:53` / `:280`(`20260811010000:23` 改版) | 只動 **receipts 子表**,不動 parent 列 |
| `admin_search_orders`(347 系列) | `20260809180000:158` 等 | 只讀 |

⇒ **零支函式對 `order_item_procurement` 做 DELETE。** 這句話的作用域 = 上表 16 支的函式體。

### §0-E trigger(四支,全部列出)

**數法(可重現)**:`grep -rn "CREATE TRIGGER\|CREATE CONSTRAINT TRIGGER" supabase/migrations/ | grep -i "procurement\|receipt"` = **4 行**(2026-08-13 實跑,即下表四列)。
⚠️ 天花板:這條靠 trigger **名稱**含 `procurement`/`receipt` 過濾;名稱不含這兩個字卻掛在本表上的 trigger 它抓不到。⇒ 補一條不靠命名的數法,列進 §7a 的 S4:apply 前對正式庫跑 `SELECT tgname FROM pg_trigger WHERE tgrelid='public.order_item_procurement'::regclass AND NOT tgisinternal;`,結果必須恰為下表前三列(第四列在子表上)。**本節目前只有檔案面的證據,正式庫面 = 未確認**(同 §8 G1)。

| trigger | 檔:行 | 事件 | 對 DELETE 的態度 |
|---|---|---|---|
| `order_item_procurement_received_quantity_guard_bt` | `20260803140000:404-406` | BEFORE **I/U** | 不掛 DELETE |
| `order_item_procurement_allocation_guard_ac`(A2b1) | `20260803130000:176-179` | AFTER **I/U** | 🔴 **刻意不掛 DELETE**,`:175` 逐字「不掛 DELETE(刪列只減總量)」 |
| `order_item_procurement_summary_recompute_zc` | `20260803140000:409-412` | AFTER **I/U/D** | ✅ **已支援 DELETE**:`:239-240` `ELSIF TG_OP = 'DELETE' THEN PERFORM recompute(OLD.order_item_id)` |
| `order_item_procurement_receipts_received_sync_ac` | `20260803140000:415-418` | AFTER I/U/D(子表) | 子表面 |

⇒ 🔴 **這是本片最重要的一條現況事實:刪一列採購,摘要重算已經是自動的、A4a 三年前就寫好了 DELETE 分支。** 本片不需要碰任何既有 trigger。

### §0-F service_role 能不能直寫(不靠猜,靠建表檔的 ACL 段與斷言)

- `20260729020000:167-168`:`REVOKE ALL … FROM PUBLIC, anon, authenticated, service_role;` + `GRANT **SELECT** ON TABLE … TO service_role;`
- 同檔 `:269-275` 自帶 fail-closed 斷言:三個 role × 四個寫權限(INSERT/UPDATE/DELETE/TRUNCATE)命中數必須 = 0,否則整片回滾。
- 同檔 `:286-311` 另有 grantee allowlist(只准 owner 與 service_role)+ PUBLIC 零授權 + 欄級 ACL 必須不存在。

⇒ **應用層(service_role 金鑰)物理上刪不掉本表任何一列。** 誠實邊界照抄 A5a `:90-91`:owner / SECURITY DEFINER 函式 / 持 owner 憑證的服務仍可直寫 ⇒ **不得說「繞過稽核的路徑不存在」**。

### §0-G 應用層(TypeScript)

- 唯一寫入呼叫端:`apps/admin/src/lib/orders/procurement-repository.ts:144-184`(`upsertItemProcurement`)。
- 全 admin app 的 `admin_*` RPC 名稱清單(抽取式 `grep -rhno "admin_[a-z_]*"`)共 26 個,**無任何採購刪除 RPC**。
- `scripts/d1-orchestrator.ts:148,512`:刪 26 張假單前先數本表引用,有引用就 abort — **它不刪本表,它因為本表而不敢刪**。
- 讀模型:`packages/adapters/src/supabase/mappers/order-procurement.ts:58` 投影**含 `id`**;domain 型別 `packages/domain/src/order/types.ts:554` 逐字「採購列 id(order_item_procurement.id)」。
  ⇒ 🔴 **與片 1 的關鍵差異**:到貨那片畫面上拿不到 receipt id(mapper 檔頭逐字「本片不投影逐批到貨明細」),所以只能撤「剛剛那筆」;**採購列的 id 畫面上本來就有** ⇒ 撤銷鈕可以掛在任意一列,不受「只能撤剛剛那筆」的限制。

### §0-H 既有交辦(migration 註解裡寫著、`information_schema` 查不到)

- `20260803160000:80-84` 逐字:「本片刻意不做(不是忘記)· 不做 DELETE(採購事實不刪;改派供應商 = 另建一列。⚠️ **qty=1 的品項指錯供應商後,正確那家會永遠 OVER_ALLOCATION** —— 當日出路 = owner 手動 `DELETE FROM public.order_item_procurement WHERE id = …`(A4a trigger 會自動重算摘要;receipts 的 FK RESTRICT 會擋住有到貨紀錄的誤刪)。根治歸**第 3 批採購退貨線**;plan §9 債④」
- `20260803130000:49-52` 契約債③ 逐字:「死配額列膨脹 SUM…原列 `allocated_quantity ≥ 1` 禁歸零、A5a 只 upsert 無 delete ⇒ 守門把死列照算、**誤攔改派**(方向 = 過度攔截 fail-closed,非放行)。自然家 = 第 3 批採購退貨線」
- `20260803130000:53` 契約債④ 逐字:「減量方向(DELETE 採購列 / 調降)**完全不守** —— 那是帳實不符問題,A4a 重算層的事。」
- `docs/specs/2026-07-28-e10-order-closure-master-plan-v2.md:511`:取消後 `ordered_quantity` 不自動下降,差額歸第 3 批採購退貨。

⇒ **設計者早就預期會痛在這裡,並且已經指定了「刪列」是當日出路。本片等於把那條手動出路做成員工按得動的入口。**

### §0-I 現況重數的結論(三句,各自帶作用域)

1. **在 §0-A 八個面之內,`order_item_procurement` 今天沒有任何刪除或作廢入口** —— 應用層沒有、DB 函式沒有、trigger 沒有、表級授權物理上不允許。唯一救濟是 owner 手動 SQL。
2. **但「刪列」這件事的下游已經全部備好了**:A4a 的 DELETE 分支(`20260803140000:239-240`)、receipts 的 FK RESTRICT(`20260729020000:186`)、A2b1 刻意不守減量(`20260803130000:175`)。缺的只有「入口 + 業務守門 + 稽核」。
3. **未查證面(誠實列出,不當已查)**:正式庫的**實際** ACL / trigger 狀態沒有連線核對(本節全部依 migration 檔文字 + `supabase/APPLIED.tsv` 顯示八支相關 migration 皆 applied=1);正式庫若有人手動 `GRANT` 或建過臨時物件,本節看不到。

---

## §1 要改什麼(以推薦案 A 為準;三案對照見 §2)

### 1a 新增一支 owner RPC `public.admin_delete_item_procurement(uuid, text, text)`

新 migration 檔(不動任何已 apply 的檔 —— 已 apply migration 連純註解都不能動,APPLIED.tsv 釘 sha256)。
形狀**逐句照抄** `admin_delete_item_receipt`(`20260810233000:280-460`),這是同一族的既有樣板:

| 步 | 內容 | 依據 |
|---|---|---|
| 1 | 隔離閘:非 read committed ⇒ `P2B02` | 352a2 `:317-321` |
| 2 | `p_actor` 形狀閘 `^[a-z0-9_]{1,64}$`;`p_request_id` 正規化(31 字元空白集 + 7 字元零寬集)+ 形狀閘,兩組常數帶長度自檢 | 352a2 `:296-345`(逐字照抄,**不得自己重寫一份**——352a2 `:291-295` 記著兩支正規化不一致踩過的坑) |
| 3 | 找列:`SELECT * FROM order_item_procurement WHERE id = p_procurement_id` | |
| 3b | 查無 ⇒ 查 `admin_audit_log`(action `procurement.delete`、target `procurement:<id>`)分辨 `ALREADY_DELETED` / `PROCUREMENT_NOT_FOUND` | 352a2 `:347-356` 同語意;本片用稽核表代替冪等帳(§4 論證) |
| 4 | 業務守門(**唯一一道**):該列有 receipts ⇒ 回 `HAS_RECEIPTS`,訊息**逐批列出**到貨日期與件數 + 白話出路「要先撤掉那幾筆到貨,才能撤銷這筆採購」 | 見 §1b |
| 5 | 取鎖(canonical 序):`order_item_procurement` 該列 `FOR NO KEY UPDATE` → `order_items` 該品項 `FOR NO KEY UPDATE` | 352a2 `:372-379`;A2b1 `:32-36` 定的 procurement→order_items 序 |
| 6 | 稽核 **在 DELETE 之前**寫 before-image(**全欄**,刪掉就查不到了) | 352a2 `:436-437` 逐字 |
| 7 | `DELETE … WHERE id = …` + `GET DIAGNOSTICS ROW_COUNT`;0 列 ⇒ `ALREADY_DELETED` | 352a2 `:381-391`(併發雙刪的理由逐字在那裡) |
| 8 | `RETURN 'DELETED'` | |

**固定碼全集(4 個,呼叫端必須斷言 ∈ 全集)**:`DELETED` / `ALREADY_DELETED` / `PROCUREMENT_NOT_FOUND` / `HAS_RECEIPTS`。
RAISE 面(= 呼叫端 bug,非固定碼):actor / request_id 缺失或非法、隔離閘 `P2B02`、防衛枝。

**ACL**:`REVOKE ALL ON FUNCTION … FROM PUBLIC, anon, authenticated, service_role;` → `GRANT EXECUTE TO service_role;`(照 352a2 的收尾段)。

### 1b 為什麼守門只有一道(而不是照抄 352a2 的 `P4A03` 出貨守門)

352a2 的刪除要擋「刪了到貨紀錄之後 `instock` 不夠出貨」。**本片不需要那一道**,論證:

- 有 receipts 的採購列在步 4 就被擋掉了 ⇒ 走到 DELETE 的列必然 `receipts = 0`。
- `instock_quantity` 的真相來源是 receipts JOIN(`20260803140000:170-173`)⇒ 該列對 `instock` 的貢獻恆為 0
  ⇒ 刪掉它 **不可能**讓 `instock` 下降 ⇒ 不可能讓已出貨/待出貨的量落空。
- 刪掉它只讓 `ordered_quantity` 下降,而 A2b1 `:53` 契約債④ 逐字寫明減量方向本來就不守。

⚠️ 這條論證的承重點是「步 4 擋掉所有有 receipts 的列」。步 4 若被日後改寬,這段論證同時失效 ⇒ **論證要寫進 migration 檔頭**,不是只寫在 plan 裡。

### 1c 為什麼不需要 `SET CONSTRAINTS … IMMEDIATE`

352a2 `:358-370` 需要它,是因為它的**後置守門要讀重算後的摘要**。本片沒有後置守門(§1b)⇒ 不讀摘要 ⇒ 不需要拉回 IMMEDIATE,也就不必付「永久改掉呼叫端交易 deferred 模式」的代價。
(A2b1 guard 不掛 DELETE ⇒ 也沒有「延後發火逃出 catch」的面。)

### 1d 應用層(片 2b;**必須排在 migration apply 之後**)

- `apps/admin/src/lib/orders/procurement-repository.ts` 加 `deleteItemProcurement()`:4 碼窮盡收斂、未知碼/null 一律拋 `ProcurementCallerBugError`(照同檔 `:176-183` 既有形狀)。
- `apps/admin/src/lib/orders/procurement-actions.ts` 加 server action + action-state(照 `receipt-actions.ts` / `receipt-action-state.ts`)。
- `apps/admin/src/components/orders/item-procurement-section.tsx`:每一列採購加「撤銷這筆採購」鈕(列 id 已在讀模型內,§0-G)。
  - 二次確認(這是不可逆刪除,不是 toggle)。
  - `HAS_RECEIPTS` 的 DB 原文**照畫不改寫**(`whitespace-pre-line`),理由逐字見 `receipt-repository.ts` 檔頭與 `receipt-undo-bar.tsx:89-91`。
  - 文案寫「撤銷這筆採購」不寫「刪除」(操作直覺化準則;`project_admin-ux-operation-intuitiveness`)。

### 1e 不做的事(明寫,免得下一個人以為忘了)

- **不做跨訂單調撥**(Sean 那句「其實要先給另外一個訂單」)—— 那要動 `order_item_id` NOT NULL FK 的語意,是另一題。
- **不做採購單層 / 庫存**(Q6=A、Q11 落點已定在報價單 repo)。
- **不動 A5a / A2b1 / A4a 任何一支**(本案的全部價值就在於不必動它們)。
- **不建冪等帳表**(§4)。

---

## §2 三案對照(🔴 這不是二選一)

### 案 A —— 硬刪列(`admin_delete_item_procurement`)【推薦】

| 面 | 內容 |
|---|---|
| 語意 | 這筆採購**沒發生過**。列從表上消失,稽核 before-image 保住全欄內容。 |
| 資料風險 | 🟢 中低。刪掉的內容 100% 進 `admin_audit_log.before`(352a2 `:436` 同款)。真正不可逆的只有「列的 id」。有到貨的列刪不掉(FK RESTRICT + 步 4 雙層)。 |
| 可逆性 | 🟡 **單向**。要還原得從稽核 before-image 手動重建(owner SQL),不是員工能做的事。**但重建路徑存在且資料完整**。 |
| 對員工的差別 | 最直覺:按「撤銷」→ 那列不見了 → 換一家重新建。與他的心智模型(「key 錯了」)一致。 |
| 對額度的效果 | ✅ 立即釋放。`ordered_quantity` 由 A4a 自動重算,正確那家不再 `OVER_ALLOCATION`(§0-H 那條交辦當場消滅)。 |
| 動到既有物件 | **零**。新增一支函式,四支既有 trigger 全部不動。 |
| rollback | `DROP FUNCTION public.admin_delete_item_procurement(uuid,text,text);` — 一句,零資料影響。 |
| 與設計者原意 | ✅ 一致 —— `20260803160000:82-83` 指定的當日出路就是刪列。 |

### 案 B —— 軟作廢(加 `voided_at` / `void_reason` 欄)

| 面 | 內容 |
|---|---|
| 語意 | 這筆採購**發生過但作廢了**。列留在表上。 |
| 資料風險 | 🔴 **高**。要改三支已 apply 的守門/重算函式:A2b1 的 SUM 要排除作廢列(`20260803130000:144-146`)、A4a 的三軸重算要排除(`20260803140000:166-173`)、A5a 的存在性分流要排除(否則作廢後重建同一家會撞業務鍵)。**漏改任一支 = 額度沒釋放(白做)或摘要算錯(帳實不符)。** |
| 可逆性 | 🟢 最好 —— 反作廢就是清欄位。 |
| 對員工的差別 | 作廢的列**還留在畫面上**。Sean 的原始場景是「key 錯資訊」= 他不想再看到它;留著一列灰字反而增加噪音,與片 3「欄位精簡」的方向相反。 |
| 業務鍵衝突 | 🔴 `UNIQUE (order_item_id, supplier_canonical_key)`(`20260729020000:69-70`)不含作廢旗標 ⇒ 作廢後對**同一家**重下單會撞鍵。要改成 partial unique index = 動已 apply 的約束。 |
| 有沒有先例 | 有,但**理由不轉移**:`shipments` 走 `deleted_at` 軟作廢並用 trigger 擋硬刪(`20260805170000:243`),理由逐字是「**包裹編號的「永不重用」保證**」。採購列沒有對外編號、沒有永不重用的承諾 ⇒ 那個理由在本表不成立。 |
| rollback | 難:欄位加了、三支函式改了,要退回得再寫一支反向 migration + 處理已寫入的作廢列。 |

### 案 C —— 額度歸屬變更(`allocated_quantity` 歸零 / 移轉)

| 面 | 內容 |
|---|---|
| 語意 | 這筆採購**還在,但不再負責任何件數**(或件數移轉給另一列)。 |
| 資料風險 | 🟡 中。核心阻礙:`CHECK (allocated_quantity BETWEEN **1** AND 100000)`(`20260729020000:73-74`)+ A5a 的 `INVALID_ALLOCATED`(`20260806200000:222-224`)兩層都禁 0 ⇒ 要 **ALTER 已 apply 表的 CHECK** + **DROP/CREATE 那支 822 行的 A5a**。改 A5a = 改**所有採購寫入**的唯一入口,回歸面遠大於本片。 |
| 可逆性 | 🟢 好 —— 把件數改回來即可。 |
| 對員工的差別 | 🔴 最不直覺:他要撤銷,系統要他「把數量改成 0」。而且那列會永遠掛在畫面上顯示「0 件」。 |
| 對額度的效果 | ✅ 立即釋放(A2b1 `:125-129` 對調降本來就 skip)。 |
| 額外好處 | 保住「我們確實聯絡過這家」的事實,最貼近 `20260729020000:113-114` 「採購真相表」的原意。 |
| rollback | 中等:CHECK 要改回去(但已寫入的 0 值列會擋住還原)、A5a 要還原成前一版。 |
| 隱藏成本 | `received_range CHECK (received_quantity BETWEEN 0 AND allocated_quantity)` ⇒ 歸零只在 `received = 0` 時成立 = **與案 A 完全相同的前提**,卻付出改兩個生產物件的代價。 |

### 混合案(記錄在案,不推薦現在做)

案 A + 未來的「採購退貨線」(§0-H 指名的第 3 批)。真正需要「作廢而非刪除」的是**已到貨後要退回供應商**,那時候列必須留著(有錢與貨的軌跡)。⇒ 案 A 不擋案 B 的未來:到那天再加 `voided_at`,對象是**有 receipts 的列**,與本片(零 receipts 的列)不重疊。

---

## §3 推薦:案 A,理由四條

1. **它是設計者指定的出路**。`20260803160000:82-83` 逐字寫了當日出路 = `DELETE FROM public.order_item_procurement WHERE id = …`,並且逐字說明了「A4a trigger 會自動重算摘要;receipts 的 FK RESTRICT 會擋住有到貨紀錄的誤刪」。本片 = 把那句話包成員工按得動的鈕,**不是發明新語意**。
2. **零既有物件改動**。A2b1 / A4a / A5a 三支都是走過 30+ 條對抗審查才上線的高風險物件;案 B 要改三支、案 C 要改兩支,案 A 改零支。rollback 是一句 `DROP FUNCTION`。
3. **語意與 Sean 的場景一致**。他說的是「key 錯資訊」= 這件事根本不該存在,不是「發生過但取消」。案 B 的灰列與案 C 的「0 件」都是把「不該存在」記成「存在但沒用」。
4. **資料不真的消失**。稽核 before-image 存全欄(352a2 `:436` 同款),要翻帳查得到、要重建有依據。「不可逆」的只有列 id。

⚠️ 誠實反對意見(不藏):案 A 確實**違反建表檔的宣稱**「採購事實是真相,不得無聲消失」(`20260729020000:35-37`)。反駁 = 那句話防的是 **CASCADE 的「無聲」**,不是「有稽核、有守門、有員工按鈕的明示刪除」。這條是 Sean 該知道的取捨,不是我可以自己吞掉的。

---

## §4 為什麼不建冪等帳表(而 352a2 建了)

352a2 的**登錄**那支需要冪等帳(`order_item_receipt_requests`),因為「同一批貨重送兩次」在業務上分不出來(`20260729020000:137-143` 逐字:receipts 沒有自然鍵)。它的**刪除**那支只是**借用**那本帳來分辨 `ALREADY_DELETED` / `RECEIPT_NOT_FOUND`(352a2 `:350-355`)。

本片:
- 刪除天然冪等(`ROW_COUNT = 0` ⇒ `ALREADY_DELETED`)。
- 「刪過了」vs「從來不存在」的分辨,用 `admin_audit_log` 查 `action = 'procurement.delete' AND target = 'procurement:' || id`。稽核列是本 RPC 自己在同交易寫的 ⇒ 資料一定在。
- `admin_audit_log` 對 service_role **無 SELECT**(`20260712210000:85-89`),但本 RPC 是 SECURITY DEFINER(definer = 表 owner)⇒ 讀得到。
- ⇒ **省掉一張表**。ponytail:新表要 RLS + ACL + 斷言 + 索引,而它買的東西一次查詢就有。

⚠️ 誠實邊界:稽核表**不是**冪等帳,它可以被 owner 改(`#439` 已立案記著 append-only 只靠 GRANT)。這條分辨的可靠度上限 = 稽核表的可靠度上限,不宣稱更高。

---

## §5 預期影響面

| 層 | 影響 | 風險 |
|---|---|---|
| DB schema | 只新增一支函式 | 🟢 |
| DB 既有 trigger / 函式 | **零改動** | 🟢 |
| `order_item_quantity_summary` | `ordered_quantity` 會因刪列而下降(A4a 自動) | 🟡 這是**要的效果**,但它是本片唯一的資料語意變化 ⇒ 驗收要正面量到 |
| A2b1 總量守門 | 刪列後額度釋放 ⇒ 原本 `OVER_ALLOCATION` 的改派會通過 | 🟢 這是本片要修的痛 |
| 出貨 / 取消 | 無(§1b 論證:零 receipts 的列對 `instock` 貢獻恆 0) | 🟢 |
| 前台顧客站 | **零**。本表對 anon/authenticated 零權限、零 view(§0-A #5/#6) | 🟢 |
| 報價單 repo | 零(跨 repo 無共用) | 🟢 |
| 稽核 | 新增一個 action 值 `procurement.delete` | 🟡 稽核 viewer(尚未建)日後要認得它 |

---

## §6 rollback

| 階段 | 出事怎麼退 |
|---|---|
| migration apply 後、UI 上線前 | `DROP FUNCTION public.admin_delete_item_procurement(uuid,text,text);` — 零列受影響(還沒有呼叫端) |
| UI 上線後發現守門有洞 | ① 先 revert UI 那顆 commit(鈕消失、員工回到現況)② 再視情況 DROP FUNCTION。**順序不可反**(`feedback_app-layer-must-not-ship-before-migration-apply` 的鏡像面:UI 還在、函式沒了 = 每按必炸) |
| 誤刪了真的要留的列 | 從 `admin_audit_log.before` 取全欄 JSON,owner 手動 INSERT 回去(id 會變)。⚠️ **這條路徑本身要在 migration 檔頭寫死**(A7b D8 教訓:災難日不臨時拼 SQL) |
| migration 本身 apply 失敗 | 整檔包在單一交易 ⇒ 自動全回滾 |

---

## §7 驗收條件(每條可 yes/no)+ 負測怎麼構造

harness = `scripts/procurement-undo-verify.sh`,形狀照 `scripts/352a2-verify.sh`(拋棄式庫 + 身分閘 + 計數器 + 全程 `BEGIN…ROLLBACK` 零留痕 + **DB 內突變靶:每發先證突變真的套上了才談紅綠**)。

### 7a 結構(靜態)

| # | 條件 | yes/no 怎麼判 |
|---|---|---|
| S1 | 同名函式恰一支,簽章逐字 `p_procurement_id uuid, p_actor text, p_request_id text` | `pg_get_function_arguments` 字串等值 |
| S2 | `prosecdef = true`、`proconfig` 含 `search_path=public, pg_temp` | 查 `pg_proc` |
| S3 | 函式 ACL:PUBLIC / anon / authenticated 零 EXECUTE,service_role 有 EXECUTE | `has_function_privilege` × 4 |
| S4 | 四支既有 trigger 的 `tgtype` 與定義**與本片前逐字相同**(證明沒被順手改到) | `pg_get_triggerdef` 對照釘值 |
| S5 | 表 ACL 仍是「三 role 零寫權」 | 照抄 `20260729020000:269-275` 的斷言 |
| S6 | 函式 COMMENT 含四個固定碼字面 | `LIKE` × 4 |

### 7b 行為(正向)

| # | 條件 | 構造 |
|---|---|---|
| B1 | 刪一列零到貨的採購 ⇒ 回 `DELETED`,列真的不見 | 建品項 qty=3 → 建採購 3 件 → 呼叫 → `count(*) = 0` |
| B2 | 刪除後 `ordered_quantity` **實際下降** | B1 之後查 `order_item_quantity_summary.ordered_quantity` = 0(**不是查 trigger 有沒有掛,是查數字**) |
| B3 | 額度真的釋放:刪掉錯的那家之後,對的那家 3 件建得起來 | B1 後呼 `admin_upsert_item_procurement` 建供應商 B 3 件 ⇒ 回 `CREATED`(**負對照:不刪就先建 ⇒ `OVER_ALLOCATION`**) |
| B4 | 稽核 before-image 含全欄 | 查 `admin_audit_log.before` 的 key 集合 ⊇ 表的全部欄名(用 `jsonb_object_keys` 對 `information_schema.columns` 取差集 = 空) |
| B5 | 重放同一個 id ⇒ `ALREADY_DELETED`(不是 `PROCUREMENT_NOT_FOUND`) | B1 後再呼一次 |
| B6 | 亂數 uuid ⇒ `PROCUREMENT_NOT_FOUND` | 直接呼 |

### 7c 行為(負向 —— 每道守門一發,🔴 不接受「構造不出來」)

| # | 守門 | 負測構造 | 期望 |
|---|---|---|---|
| N1 | 有到貨 ⇒ 擋 | 建採購 → `admin_record_item_receipt` 登一批 → 呼刪除 | 回 `HAS_RECEIPTS`,訊息含該批日期與件數,列**還在** |
| N2 | 兩批到貨 ⇒ 訊息列出**兩批**(不是只講一批) | 同上登兩批 | 訊息含兩行(352a2 `:419` 「列出全部相關包裹」同紀律) |
| N3 | 隔離閘 | `BEGIN ISOLATION LEVEL REPEATABLE READ` 後呼叫 | `P2B02` |
| N4 | actor 形狀 | `p_actor = 'Sean 王'` / `''` / NULL / 65 字元 | 各自 RAISE |
| N5 | request_id 形狀 | 大寫 / 含空白 / 純零寬(`U+200B`)/ 201 字元 | 各自 RAISE |
| N6 | request_id 正規化與登錄那支**一致** | 前置 `U+200B` 的 request_id 送兩支 RPC | 兩支結論相同(352a2 `:291-295` 踩過的坑,不再踩第二次) |
| N7 | 併發雙刪 | 兩個 session 同時刪同一列(A 先 commit) | B 回 `ALREADY_DELETED`,**不是**假裝成功 |
| N8 | FK RESTRICT 仍在(不是被本片繞過) | 直接 `DELETE FROM order_item_procurement` where 有 receipts(owner 身分) | 23503 |

### 7d 突變靶(證明守門有判別力,不是恆真)

| # | 突變 | 期望 |
|---|---|---|
| M1 | 把步 4 的 receipts 檢查整段刪掉 | N1 / N2 必須翻紅 |
| M2 | 把步 7 的 `ROW_COUNT` 判定改成恆真 | N7 必須翻紅 |
| M3 | 把稽核那段搬到 `DELETE` **之後** | B4 必須翻紅(before-image 會查不到那列) |
| M4 | 把隔離閘拿掉 | N3 必須翻紅 |
| M5 | 把 `p_request_id` 的零寬剝除拿掉 | N5 / N6 必須翻紅 |

🔴 突變紀律照 352a2 harness 檔頭:**每一發先證突變真的套上了**(查函式定義字面),才談紅綠。

### 7e 應用層(片 2b)

| # | 條件 |
|---|---|
| A1 | 4 碼窮盡:未知碼 / null ⇒ 拋 `ProcurementCallerBugError`(單測) |
| A2 | `HAS_RECEIPTS` 的 DB 原文原樣顯示、換行保留(單測斷言含換行與件數字面) |
| A3 | 撤銷後畫面該列消失(`revalidate` 有跑) |
| A4 | 三綠 + build |

---

## §8 誠實缺口(🔴 只收**真的**構造不出來的)

| # | 缺口 | 為什麼構造不出來 | 怎麼降低 |
|---|---|---|---|
| G1 | **正式庫的實際 ACL / trigger 狀態未連線核對**。§0 全部依 migration 檔文字 + APPLIED.tsv | 我沒有正式庫連線;交易模擬只能在拋棄式庫跑 | apply 前置閘加一條:對正式庫跑 §7a 的 S4/S5 兩條斷言(唯讀查詢,Sean 貼結果) |
| G2 | **`actor` 是自陳身分**,稽核只保證「有一個合法非空字串」,不保證那是真的操作者 | E8-B 真認證尚未開工(STATUS 逐字) | 照抄 A5a `:94-95` 的誠實邊界進檔頭,不宣稱更高 |
| G3 | **owner / SECDEF / 持 owner 憑證的路徑仍可直寫本表** | 那在本片的權限天花板之上,任何 DB 內守門都擋不住 | 照抄 A5a `:90-91` 字面 |
| G4 | **`session_replication_role = replica` 可跳過 trigger** ⇒ 極端情況下刪列不重算摘要 | 同 A2b1 `:85` 記載的天花板,不是本片能修的 | 只列界,不宣稱涵蓋 |

**🔴 明確不放進誠實缺口的(十幾行就能測、必須真的測)**:併發雙刪(N7 用兩個 psql session)、隔離閘(N3 一句 `BEGIN ISOLATION LEVEL`)、稽核 before-image 完整性(N4/B4 一句 `jsonb_object_keys` 差集)、request_id 零寬正規化(N5/N6 直接送字串)。這四樣一條都不准用「構造不出來」豁免。

---

## §9 施工序與片界

| 片 | 內容 | 前置 | 三綠 | 審查 |
|---|---|---|---|---|
| 2a | migration + `scripts/procurement-undo-verify.sh` + 拋棄式庫實跑全綠 | plan 批准 | .sql 語法守門 | 🔴 鐵則 12③ ⇒ codex 關卡 2 審 diff |
| **停點** | **Sean apply**(`supabase db push`;前置閘含 G1 那兩條) | 2a 收工 | | |
| 2b | repository + action + UI 鈕 + 單測 | 🔴 **apply 完成才動**(`feedback_app-layer-must-not-ship-before-migration-apply`:應用層不得先於 migration 上線) | typecheck + lint + build | code-reviewer;命中鐵則 12 才加 codex |

估時:2a 約 60-90 分(RPC + harness 五類格)⇒ **超過鐵則 4 的 15-45 分上限**,但 migration + 它的 harness 是同一個不可分的驗證單元(拆了 harness 就是無驗證的 migration)⇒ 判斷不拆,理由寫進 commit body。2b 約 30-40 分。

---

## §10 待 Sean 拍板

```
Q1:採購撤銷用哪一案?
A: A|B|C
  A = 硬刪列(推薦):按「撤銷」那列就不見了,內容進稽核。零改動既有守門,rollback 一句話。
      代價:要救回來得工程師手動,不是你自己按得回來的。
  B = 軟作廢:列留著、變灰。你隨時反悔得回來。
      代價:要改三支已經上線的守門函式,任一支漏改就是「額度沒放出來」或「數字算錯」;
            而且那列會一直待在畫面上,跟你要的「欄位精簡」反方向。
  C = 把件數改成 0:列留著、顯示 0 件。
      代價:要改所有採購寫入都會經過的那支主函式(回歸面最大),
            而且你要撤銷時系統叫你「把數量改成 0」,不直覺。

Q2:撤銷之後,那筆採購的內容還要不要能查得到?
A: A|B
  A = 只留在稽核軌(工程師查得到、你查不到)—— 案 A 的預設
  B = 要在畫面上查得到 —— 這會把答案推向案 B(等於改拍 Q1)

Q3:如果那筆採購已經有登錄到貨,撤銷該怎樣?
A: A|B
  A = 直接擋掉,告訴他「要先撤掉那幾筆到貨」(推薦;片 1 已經給了撤到貨的入口)
  B = 一起撤掉(採購 + 它底下的到貨全刪)
      ⚠️ 我不推薦 B:到貨紀錄是 append-only、建表檔逐字寫「到貨是既成事實,不改不刪」;
         一鍵連刪會讓「已經進來的貨」在系統裡憑空消失。
```

---

## §11 相關既有紀錄與連動面

- memory `project_0812-sean-order-ui-workflow-and-undo-needs` —— 需求原文 + 「刻意不做的已知債」實查
- memory `project_admin-ux-operation-intuitiveness` —— 文案寫怎麼做、不寫內部語彙
- memory `feedback_app-layer-must-not-ship-before-migration-apply` —— §9 的停點紀律
- memory `feedback_honest-gap-is-for-unconstructible-not-for-cheap` —— §8 的收斂紀律
- `docs/specs/2026-07-28-e10-order-closure-master-plan-v2.md:511` —— 第 3 批採購退貨線的落點
- 片 1 產物(`4d774876`):`admin_delete_item_receipt` 的 RPC / repository / UI 三層,本片逐層照抄形狀

— END —
