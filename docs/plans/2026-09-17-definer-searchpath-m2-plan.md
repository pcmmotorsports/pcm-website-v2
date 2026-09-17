# plan:12 支 SECURITY DEFINER 的 `search_path` 收尾(第二批 / M2)

> 依據:Sean 2026-09-17 早上 Q7 拍**甲**(要做)。他批的是「要做」,**還沒批「怎麼做」** ⇒ 照鐵則 8 先批再寫 migration。
> 寫的人:窗 B(後台,worktree `pcm-ops`,branch `agent/ops-17-receipt`),2026-09-17。
> 🔴 本檔所有數字都是**今天對正式庫唯讀實查**來的(`scripts/readonly-prod-sql.sh`),不是抄總表、不是讀 migration。
> 前例:`supabase/migrations/20260905100000_m4b_definer_searchpath_lock_m1a.sql`。
>
> ## 🟢 2026-09-17 Sean 已答(§7 那兩題,兩題都甲)
> - **Q1 什麼時候做 ⇒ 甲:排進下一批,不急。** ⇒ 🛑 **現在不要寫 migration**,本檔停在 plan。
> - **Q2 要不要一支板收完 12 支 ⇒ 甲:一支板全收。** 不拆兩支。
> ⇒ 真的要動工的人:**這兩題不用再問一次**,照上面做。還沒答的只剩「板號」——
>   板要 Sean 逐字說「貼 <編號>」,由主視窗貼,窗 B 不自己貼。

---

## 1. 一句話

把這 12 支 `SECURITY DEFINER` 函式的 `search_path` 從 `public, pg_temp` 改成空字串,**一個字都不動函式本體**。

---

## 2. 名單(正式庫實查,12/12 對得上總表 B.4)

| # | 精確簽名 | 現在的 proconfig | body md5(前置閘要比對) | 掛在哪個 trigger |
|---|---|---|---|---|
| 1 | `admin_update_order_item_workflow(p_item_id uuid, p_expected_version integer, p_patch jsonb, p_actor text, p_request_id text)` | `search_path=public, pg_temp` | `65e18437e755789c57fd0c002bdca77b` | 無(後台直接 `.rpc()` 叫) |
| 2 | `pcm_a2b1_procurement_allocation_guard()` | `search_path=public, pg_temp,lock_timeout=5s` | `9134bce6f547eb6c26c0cae2b11f2626` | `order_item_procurement` |
| 3 | `pcm_a4a_cancellation_summary_recompute()` | `search_path=public, pg_temp,lock_timeout=5s` | `fc05eb19535cc68469a8b6396add9385` | `order_cancellation_items` |
| 4 | `pcm_a4a_procurement_summary_recompute()` | `search_path=public, pg_temp,lock_timeout=5s` | `1e02c103106d16a0464023104af71238` | `order_item_procurement` |
| 5 | `pcm_a4a_receipts_received_sync()` | `search_path=public, pg_temp,lock_timeout=5s` | `4f6e8ea6e68f31dcb002458eb69b981b` | `order_item_procurement_receipts` |
| 6 | `pcm_a4a_received_quantity_guard()` | `search_path=public, pg_temp` | `74ed8fa699ca145dcb660cf4547b497f` | `order_item_procurement` |
| 7 | `pcm_a4a_recompute_order_item_summary(p_order_item_id uuid)` | `search_path=public, pg_temp,lock_timeout=5s` | `463a9b96bf2c3736fce0f0497614d400` | 無(被上面幾支叫,11 處) |
| 8 | `pcm_a7c_refund_immutable_guard()` | `search_path=public, pg_temp` | `589c44d20e6048dd0f3bd6855f17dee5` | `order_refunds` |
| 9 | `pcm_a7c_refund_insert_guard()` | `search_path=public, pg_temp` | `4f2d60495256f6577e4fb5f4a49f21f8` | `order_refunds` |
| 10 | `pcm_assert_cancellation_has_items()` | `search_path=public, pg_temp` | `9356c3ecc4484b2340b8ac5b9bf0d766` | `order_cancellation_items` + `order_cancellations`(2 個) |
| 11 | `pcm_b2_shipments_items_presence()` | `search_path=public, pg_temp,lock_timeout=5s` | `32383cb7c210e2b9984eb343b5f5e828` | `shipments` |
| 12 | `pcm_order_refund_cap_guard()` | `search_path=public, pg_temp` | `65f0e2baaedbe44ab03f5df1d916d93a` | `order_refunds` |

12 支的 owner 全是 `postgres`,全部 `prosecdef = true`。

**分母對得上**:`public` schema 裡 proconfig 含 `search_path=public, pg_temp` 的共 21 支(SECDEF 12 / 非 SECDEF 9)。
**正對照**(證明 `proconfig` 這一欄印得出多種值,不是量壞的):同一發查詢印出 12 種不同的 proconfig,其中 `search_path=""` 有 193 支(152 支 SECDEF)。

---

## 3. 🔴 開工前那道「函式體有沒有裸表名」—— 查完了,**12 支全部乾淨**

總表寫「開工前先逐支查函式體有沒有裸表名 —— 有就不能只 ALTER」。已經查完:

- 撈法:`pg_get_functiondef()` 撈 12 支全文(12/12 撈到,0 個 ERROR)。
- **表**:所有 `FROM` / `JOIN` / `INSERT INTO` / `UPDATE` 的對象**全部帶 `public.` 前綴**
  (`public.order_items` / `public.order_item_procurement` / `public.order_cancellation_items` /
  `public.shipment_items` / `public.orders` / `public.order_item_procurement_receipts` /
  `public.shipments` / `public.order_status_options` / `public.order_refunds` /
  `public.order_cancellations` / `public.order_item_quantity_summary` / `public.admin_audit_log`)。
- **函式呼叫**:也全部帶前綴 —— `public.pcm_a4a_recompute_order_item_summary(`(11 處)、
  `public.pcm_order_refundable_remaining(`(1 處)。
  ⚠️ 我第一次掃報出「11 處裸呼叫」是**假警報**:正則把 `public.` 前綴吃掉了才看起來像裸的。重掃才是真的。
- **型別**:只有 `::text` / `::jsonb`,都是 `pg_catalog` 內建 ⇒ 空 search_path 照樣解得到。
- **擴充套件運算子 / 序列**:`<->` `@@` `nextval` `currval` `setval` `similarity(` 全部 0 處。
  ⚠️ 首掃看到 12 個 `@@` 也是**假警報**:那是我自己輸出用的 `@@@FUNC@@@` 分隔符。

**🔵 這把尺會動嗎(負對照)**:同一組正則拿去掃那 9 支**非 SECDEF** 的
(它們 proconfig 也是 `search_path=public, pg_temp`)⇒ **抓得到**裸的
`FROM storefront_search_product_ids(`。⇒ 尺會動,12 支的 0 是真的 0,不是尺壞了。

**⇒ 結論:12 支都可以【只 ALTER、不動 body】,沒有例外。**

---

## 4. 🔴 危險性:比總表寫的低很多(要更正)

總表 B.4 逐字寫:
> 「`public` 可寫、repo **零處** `REVOKE CREATE ON SCHEMA public` ⇒ 同名函式借 owner 身分執行 = SECDEF 提權標準路徑。」

**「repo 零處」是對的,但它回答的是【repo 有沒有寫】,不是【正式庫現在可不可寫】。** 今天實查正式庫:

```
public schema 的 acl:
  {pg_database_owner=UC/pg_database_owner, =U/pg_database_owner, postgres=U/...,
   anon=U/..., authenticated=U/..., service_role=U/..., payment_confirmer=U/..., pcm_readonly=U/...}
                          ↑ PUBLIC 那一項是 =U ⇒ 只有 USAGE, 沒有 C(CREATE)

has_schema_privilege(角色,'public','CREATE'):
  anon f · authenticated f · authenticator f · service_role f · postgres t
```

⇒ **anon / authenticated / service_role 現在都建不出 `public` 裡的同名函式** ⇒ 那條提權路**現在走不通**。
(這是 PG15 以後的預設:`CREATE` 已從 `PUBLIC` 收掉,不是有人特別設過。)

🔵 **正對照**:同一把尺對 `postgres` 印得出 `t` ⇒ 這個 `f` 是真的 `f`,不是函式壞掉一律回 f。
🔵 **負對照**:同一把尺對 `pg_catalog` 三個角色全 `f`(本來就該 f)。

**那還要不要做?要 —— 但理由要換成真的那個:**
1. **縱深防禦**:哪天有人 `GRANT CREATE ON SCHEMA public`(加擴充、跑工具、開 CI 帳號都可能),這 12 支**當天就變成可利用的**,而沒有人會回頭想起它們。
2. **一致性**:全庫 193 支已經是 `search_path=""`,這 12 支是 09-05 M1a+M1b 那批**沒掃到的漏網**,不是刻意留的例外。
3. 成本極低:不動 body、可完整還原。
4. Sean 09-17 已經拍甲。

🛑 **我不把它講成「正在被攻擊」或「上線擋路」** —— 它現在**不是**。要排在哪由 Sean 決定,總表原本就寫「排,但不是現在」。

---

## 5. 改什麼(migration 的形狀)

整支仿 `20260905100000_m4b_definer_searchpath_lock_m1a.sql`,五段:

1. **前置閘**(任一條不符就 `RAISE EXCEPTION` 中止,整筆不留痕):
   - 12 支簽名**都在**(數量 `= 12`,不是 `>= 12`)。
   - 每一支 `prosecdef = true`。
   - 每一支現在的 `search_path` 那一項**精確等於** `search_path=public, pg_temp`。
   - 每一支 `md5(prosrc)` 精確等於上面表格那一欄 ⇒ **body 從我寫這一片到貼板之間沒被別人改過**。
2. **rollback 表** `public.pcm_definer_searchpath_rollback_20260917xxxxxx`:貼之前先把
   `sig / search_path_before / proconfig_before(整個陣列) / body_md5_before` 寫進去。
3. **動作**:逐支 `EXECUTE format('ALTER FUNCTION public.%s SET search_path = %L', sig, '')`。
   - 🔴 `%L` 給的是 `''` ⇒ 存進去是 `search_path=""`。
     ⛔ **不可以**寫成 `SET search_path = 'public, pg_temp'` 那種單引號包整串的寫法 ——
     存進去會變成帶雙引號的 `"public, pg_temp"`,與原字面**不是同一個東西**(09-05 那支檔頭 `:24-27` 逐字記著)。
   - 🔴 **不用 `CREATE OR REPLACE`**:那會把 `SET` 子句**整組換掉**
     ⇒ 6 支帶著的 `lock_timeout=5s` 會**靜靜消失**。`ALTER FUNCTION ... SET search_path`
     只動 `search_path` 那一項 —— 而我**不靠這句話**,下面第 4 點直接斷言。
4. **後置斷言**(同一筆交易內,不符就整筆 rollback):
   - 12 支的 `search_path` 那一項**全部** `= search_path=""`。
   - 🔴 **`lock_timeout` 沒被弄丟**:原本有 `lock_timeout=5s` 的那 6 支
     (#2 #3 #4 #5 #7 #11),事後 proconfig 仍含 `lock_timeout=5s`。
     ⇒ 這一條就是「ALTER 只動那一項」的**實證**,不是我用記憶擔保的。
   - 12 支的 `md5(prosrc)` 與貼之前**完全相同** ⇒ 證明真的沒動到 body。
5. **負對照**(照 09-05 那支的做法,對照組今天實查還在):
   `public.rls_auto_enable` 的 `search_path` 現在是 `search_path=pg_catalog`
   ⇒ 貼完必須**還是** `search_path=pg_catalog`。
   不是的話 ⇒ 表示我這支動到了不該動的東西,或對照組本身被人改過 ⇒ **拒 COMMIT**。

還要附一支 `<編號>r_<版本號>_還原_災難用.sql`:從 rollback 表逐支 ALTER 回 `public, pg_temp`。

---

## 6. 影響 / 錯了會怎樣

**白話**:這 12 支裡有 10 支是**看門的**(trigger),掛在錢與訂單的表上 ——
退款(`order_refunds` 3 支)、採購到貨(`order_item_procurement` 系列 4 支)、
取消(`order_cancellations` 2 支)、出貨(`shipments` 1 支)。
它們平常不出聲,**一出聲就是擋下一筆不該過的資料**。

- **如果改壞了**(body 裡有東西解不到)⇒ 那張表的**寫入當場失敗**:登到貨 / 登退款 / 建箱 / 取消單會噴錯。
  客人端不受影響(前台不寫這幾張表),但**後台員工會做不了事**。
- **為什麼我認為不會壞**:§3 逐支查過,零裸名;而且**前置閘 + 後置斷言 + 負對照三道都在同一筆交易裡**,
  任何一條不符就整筆回滾,不會留下半套。
- 🛑 **而 jsdom / typecheck / lint 一個都證不到這件事** —— 這是資料庫端的改動,
  三綠全過跟它對不對**沒有關係**。真的驗是貼完那一發的實查(§5 第 4、5 點)。

**部署時序**:🟢 **沒有時序問題**。本片**不改任何簽章、不加新函式、不加新 view、不加新欄位**
⇒ 舊碼新碼都叫得動,板先貼或碼先推都可以(本片其實**沒有碼**,只有 migration + `APPLIED.tsv` 一列)。
⇒ 不適用 CLAUDE.md〈Git〉那條「改既有函式簽章兩個方向都有空窗」的警告。

---

## 7. ~~🙋 要 Sean 決定的~~ ⇒ 🟢 **2026-09-17 兩題都答甲了**(原文保留在下面備查)

```
Q1:這 12 支的 search_path 收尾, 什麼時候做?
    甲) 排進下一批, 不急 —— 實查後確認那條提權路【現在走不通】(anon/authenticated/
        service_role 都沒有 public 的 CREATE 權), 它是縱深防禦與一致性, 不是破口。(推薦)
    乙) 現在就做 —— 反正不動 body、可完整還原, 一支板收掉十二支漏網。
    A: 甲 | 乙

Q2:12 支要不要【一支板一次全收】?
    甲) 一支板全收 12 支 —— 它們是同一種改動、同一道閘, 分批只是多幾次貼板風險。(推薦)
    乙) 拆兩支:先收 2 支非 trigger 的(admin_update_order_item_workflow /
        pcm_a4a_recompute_order_item_summary), 確認沒事再收 10 支 trigger。
    A: 甲 | 乙
```

🟢 **上面兩題 Sean 2026-09-17 都答甲**:Q1 = 排下一批不急、Q2 = 一支板全收 12 支。
🛑 **而「答甲」不等於「現在做」** —— 甲的內容逐字就是「不急」⇒ **現在仍然不寫 migration 檔**。
板的編號要 Sean 逐字說「貼 <編號>」,由主視窗貼 —— 我自己不貼。

---

## 8. 我沒做、也不打算做的

- 不改任何函式本體。
- 不碰那 9 支**非 SECDEF** 的 `public, pg_temp`(它們不是 DEFINER,沒有提權面;Sean 拍的是那 12 支)。
- 不去改 `scripts/definer-search-path-gate.py`(它只擋 staged 新檔,本來就不擋已 apply 的歷史;鐵則「不加閘」)。
- 不順手 `REVOKE CREATE ON SCHEMA public` —— 那是**另一件事**、影響面大得多,要單獨端 Sean。

— END —
