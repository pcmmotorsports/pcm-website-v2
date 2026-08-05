# B2 三片 · 26 條 must-fix 逐條消融實測台帳(夜跑視窗 B-2xx)

> 派工單 = `docs/handoff/2026-08-05-night-b2-s1-rework.md` §4 第 1 步。
> 上一棒的 triage 表把 26 條裡 **21 條標為「未驗」**(codex 純靜態推論 + `bash -n`,自述未重跑任何 harness)。
> 本檔 = 夜跑那棒對那 21 條**逐條做消融實測**的結果:先證明 finding 成立,再修。
>
> 🔴 **實測環境**:拋棄庫 `/tmp/b2night`、`PORT=54341`(避開別視窗的 54329/54331),
> 三片 migration 全套 + `d1t2-rehearsal.sh provision` 的完整 seed。全程 `BEGIN … ROLLBACK`、零留痕。
>
> 🔴 **基線先獨立重跑**(codex 從未跑過,本欄是第三方獨立確認的第一次):
> `b2s1a1` = **40/0**、`b2s1a2` = **26/0**、`b2s1b` = **24/0** —— 與上一棒回報的數字**逐一相符**。
> ⇒ 那些綠色數字**不是假的**;問題全在「那些數字證明不了什麼」。

## 結論一句話

**21 條「未驗」全部 CONFIRMED,誤判 0 條。** codex 的靜態推論在本批的命中率 = 21/21。
其中 **#3 比 codex 主張的更糟**(不是「可能仍有 grantee」,是三個角色**全部**都有 EXECUTE),
但**嚴重度比 codex 隱含的低**(trigger 函式在 PG 無法被直呼 ⇒ 該 grant 實際不可利用,詳下)。

---

## A. 逐條消融結果(21 條未驗)

| # | 消融手法(實際跑的) | 觀察到的結果 | 判定 |
|---|---|---|---|
| 1 | 以 table owner 身分直寫;非 FORCE RLS 對 owner 的豁免 | harness 每一格都以 owner(postgres)成功 INSERT ⇒「零 writer」只描述 runtime ACL、不涵蓋 owner | ✅ CONFIRMED(註解說過頭) |
| 2 | `DROP TRIGGER` X1 → 寫入「已出貨+submitted+零品項」列 → 重建 X1 → `SET CONSTRAINTS ALL IMMEDIATE` | `BAD_ROW_WRITTEN=1` → `BAD_ROW_SURVIVES_X1=1`。**DEFERRED constraint trigger 只對事件發火,不回頭掃既有列**;S1b 前置閘只數 trigger(`S1B_GATE_TRIGGER_COUNT=7`)⇒ 完全沒注意到 | ✅ CONFIRMED(真缺口) |
| 3 | `aclexplode(proacl)` 實查八支函式的非 owner grantee | **八支全部**對 `anon`/`authenticated`/`service_role` 有 `EXECUTE`(shim 的 default privileges;`REVOKE … FROM PUBLIC` 對具名角色無效)。⚠️ **但**:`SET ROLE anon; SELECT pcm_b2_shipments_items_presence();` → `ERROR: trigger functions can only be called as triggers` ⇒ **不可利用** | ✅ CONFIRMED(斷言為假)/ 🟡 風險=0 |
| 4 | ①`ALTER FUNCTION … SET search_path='pg_temp'` ②`ALTER FUNCTION … OWNER TO b2_evil` | ①`PROCONFIG_ASSERT_COUNT=4` 仍過(斷言只比對 `search_path=%` 前綴,不比對值)②`SECDEF_COUNT_STILL=2` 仍過、`NEW_OWNER=b2_evil`。🔴 **SECURITY DEFINER 函式的 owner 被換成任意角色,零斷言會紅** | ✅ CONFIRMED(判別力) |
| 7 | `hct_status='submitted'` + `hct_request_id=''` / `'   '` | `INSERTED_EMPTY=1`、`INSERTED_BLANK=1` —— 兩者皆**放行** | ✅ CONFIRMED(真缺口) |
| 8 | draft→加品項→出貨+submitted→`UPDATE … hct_status='draft', hct_request_id=NULL, hct_raw_response=NULL` | `REVERT_OK status=draft req=<NULL> shipped=t` ⇒ **已出貨包裹可退回 draft 並清空全部新竹證據,`shipped_at` 仍在** | ✅ CONFIRMED(真缺口) |
| 9 | 把守門改成 `RETURN OLD` 後重跑兩條 grep 斷言 | `grep_RETURN_NULL=0`、`grep_writes_NEW=0` ⇒ **兩條 P1/P1b 斷言對 `RETURN OLD` 完全全盲**(`NEW := OLD` 同理:regex 要求 `NEW.` 後接欄名,無點號的整體賦值不命中) | ✅ CONFIRMED(判別力) |
| 10 | `DROP CONSTRAINT shipments_customer_user_id_fkey` 後重跑約束集合斷言 | `FK_DROPPED_STILL_12=12` ⇒ FK 不在集合內,且斷言只驗「這 12 條都在」、**沒有「不得有多餘」那一半** ⇒ 宣稱的「雙向」不成立 | ✅ CONFIRMED(判別力) |
| 11 | 把 `shipments_hct_request_id_key` 改建在 **`shipment_reference`** 上(仍 partial unique) | `NAME_EXISTS=1`、`IS_PARTIAL=true` ⇒ 三條斷言全過,**索引建在完全錯的欄位上卻無人發現** | ✅ CONFIRMED(判別力) |
| 12 | 對不存在的 trigger 名跑 migration 同形的 `IF (SELECT tgdeferrable …) THEN` | `SILENTLY_PASSED (subquery=NULL, IF 未進入 THEN)` ⇒ 消融 trigger 後該斷言**靜默通過**、不 RAISE | ✅ CONFIRMED(判別力) |
| 13 | grep S1b 的 DO 是否斷言 約束集合/兩支 FK/quantity CHECK/unique 形狀/index 欄位 | 命中 2 處**皆為 CREATE TABLE 內的定義本身**、非驗收斷言;DO 內零相關斷言 | ✅ CONFIRMED(判別力) |
| 14 | 讀 S1a-2 前置閘(`:47-52`)與 S1b 前置閘(`:24-27`) | S1a-2 只數 `contype='c'` = 10;S1b 只數 trigger = 6。**皆為純計數**,無具名集合、無事件面、無啟用狀態 ⇒ 改名/換事件面隱形 | ✅ CONFIRMED(判別力) |
| 19 | grep `b2s1a2-verify.sh` 的 `carrier_note` / `customer_user_id` / `updated_at` 獨立格 | `carrier_note` 只出現在 `:70` 的**合併格**(同句改了 `carrier_code`);`customer_user_id`、`updated_at` **零獨立格** | ✅ CONFIRMED(判別力) |
| 20 | `DROP CONSTRAINT shipments_hct_status_carrier`(X5)後重跑該負測格 | `X5_ABLATED_STILL_RED:23514` ⇒ 該格紅在 **X6**、對 X5 零判別力 | ✅ CONFIRMED(判別力) |
| 21 | `DROP TRIGGER shipments_block_truncate_bt`(父表)後 `TRUNCATE` 兩表 | `STILL_RED:P0001` 且訊息逐字為**子表**的 `包裹內容 append-only … TG_OP=TRUNCATE` ⇒ 只驗 SQLSTATE 的歸因是錯的 | ✅ CONFIRMED(判別力) |
| 22 | 讀 `b2s1b-verify.sh:120-131` 的 X1 五格 | 涵蓋 INSERT(帶 shipped_at)/ UPDATE shipped_at / submitted / failed / 作廢後 submitted。**缺**「直接 INSERT 帶 `hct_status='submitted'`」與「`failed` + 已作廢」兩面 | ✅ CONFIRMED(判別力) |
| 23 | grep `b2s1b-verify.sh` 的 `has_table_privilege`/`relrowsecurity`/`pg_policy`/`proacl`/`proowner` | **0 命中** ⇒ 該支對 RLS/ACL/函式 owner 面完全沒有斷言 | ✅ CONFIRMED(判別力) |
| 24 | 實查 A7 正測所用兩張訂單的 `shipping_address_snapshot` | **兩張完全相同**(`{"line":"演練地址","name":"演練","phone":"0900000000"}`)、`ADDRS_IDENTICAL=true` ⇒ 該格宣稱在證 Q1=B(併箱不比對地址),實際上**構造不出那個區別** | ✅ CONFIRMED(判別力;`feedback_fixture-value-makes-guard-vacuous` 同型) |
| 25 | 把 parent guard 的 `FOR NO KEY UPDATE` **整個移除**後重跑整支 `b2s1b` | **PASS=24 / FAIL=0 —— 全綠**。承重的鎖原語被拿掉,harness 零反應 | ✅ CONFIRMED(規格深度+判別力) |
| 26 | 讀 `b2s1a2-verify.sh` 的作廢面涵蓋 | 有:已出貨作廢(`:75`)、draft 建立即作廢的 fixture(`:61`)、由該 fixture unvoid(`:87`)。**缺**:`submitted` 態作廢、由**已出貨作廢**態 unvoid | ✅ CONFIRMED(判別力) |

## B. 已由上一棒親驗的 5 條(本棒未重驗,沿用)

| # | 上一棒的證據 | 本棒處置 |
|---|---|---|
| 5 | RLS 判別力格退化成 `count(*)=0`,FORCE 開關皆 0 ⇒ 恆真 | 照修(用有資料 fixture 做成對紅綠) |
| 6 | `length(btrim(E'\t'))=1`、tab 餵 `carrier_note` → A3 放行 | 照修(三條守門一起換 `regexp_replace`) |
| 15 / 16 / 17 | `SHIPPED` fixture 為「設了 `shipped_at` 且零品項」,靠每格 `ROLLBACK` 讓 X1 從未發火 | 照修(fixture 合法化 + 每格 `SET CONSTRAINTS ALL IMMEDIATE`) |
| 18 | `expect_landed` 只寫在 S1a-2,S1a-1 檔頭卻照抄了「成功格皆回查落庫」的宣稱 | 照修(`expect_ok` 改為驗 ROW_COUNT + 指定欄終值) |

## C. 對 codex 的兩點事實更正(不是翻案,是把嚴重度校準)

1. **#3 的方向要反過來講**:codex 寫「**可能**仍有 grantee」——實測是**確定**有,而且是三個角色全中。
   但它隱含的風險等級要往下修:PG **拒絕直呼 trigger 函式**(`ERROR: trigger functions can only be
   called as triggers`,編譯期就擋),⇒ 這些 `EXECUTE` grant **不構成可利用路徑**。
   🔴 **修法照做不變**(REVOKE 三角色 + `aclexplode` 零 grantee 斷言),理由不是「堵漏洞」而是
   **「讓 migration 檔頭那句 ACL 宣稱變成真的」** —— 現況是宣稱與事實不符,那才是要修的東西。
2. **#2 的窗口在本批實務上關著**:兩表**零 writer**(service_role 只有 SELECT),
   ⇒ S1a-2 與 S1b 之間沒有任何應用路徑能寫進那筆壞列。但機制面 codex 是對的
   (X1 確實不回頭掃既有列),且本批是 **schema 片、apply 不可逆** ⇒ anti-join 前置閘照補,
   當成「未來 writer 落地前就先站好的哨」,**不宣稱它在修一個今天可觸發的漏洞**。

## D. 方法學備註(給下一棒)

- 本輪有 **一次自造的假陽性**:第一版 #8 消融把 `shipped_at` 設在 INSERT 當下再加品項,
  結果紅在 **parent guard(X3 已出貨禁加品項)** 而非待測的 hct 面 ⇒ 誤讀成「#8 不成立」。
  改成 draft→加品項→出貨 才測到真正的面。**消融失敗時先問「我紅在的是不是我要測的那道」**。
- `FOR NO KEY UPDATE` 那條(#25)是本輪最值錢的一次消融:它證明**單 session 的並發測試
  對鎖原語零判別力**,而這正是 memory `feedback_race-test-without-barrier-proves-nothing` 記過的形狀。
