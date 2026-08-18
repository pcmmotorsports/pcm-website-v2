# B1 關卡1 第三 / 四 / 五輪 · codex findings 逐條裁定

> 🔴 **本檔含三輪**:R3 在 §1-§4、R4 在 §5-§7、**R5 在 §8-§10**(全部 2026-08-18 同日)。檔名只寫 r3 是因為它先存在,**不改檔名以免既有指標斷掉**。
> 🔴🔴 **主視窗 2026-08-18 裁定:R5 折完就停,不開 R6** —— 理由與我的回應見 §10。

> **跑的是誰**:codex CLI(`-m gpt-5.6-sol`、`-s read-only`,2026-08-18 下午,G5 窗,唯讀零留痕)。
> **為什麼是第三輪**:`docs/specs/2026-08-16-m4b-e8b-b1-spec.md:21` 逐字「兩輪皆 FAIL、findings 已折;**第三輪換模型待跑**」。
> **換的是什麼**:前兩輪的框架是「SQL 正確性 / 兩個資料庫有沒有搞混」;
> 本輪 prompt 明文禁止在同一框架內找更細的問題,改跑四個角度 ——
> **假設審查 / 災難當天可用性 / 測試假綠 / 回歸與權限面**。
> 📎 依據 memory:**第 3 輪起必須換角度、換模型**(同模型再審傾向在同一框架內找更細的問題)。
>
> **結果:`VERDICT: FAIL`,15 條全標 must-fix(其中 2 條 codex 自標 `[不確定]`)。**
> **原文逐字保存在 §1,一個字沒改。裁定在 §2。**
> 🔴 **本檔不是「已修」的證據** —— 裁定寫「已折」的那幾條,證據是那支檔的 diff,不是本檔這一格。

---

## §1 codex 原文(逐字,未編輯)

### 角度 1 · 假設審查

- [b2-seed-migration-draft.sql:128](/Users/sean_1/pcm-website-v2/docs/specs/2026-08-16-m4b-e8b-b2-seed-migration-draft.sql:128) UUID 只驗「存在」，沒驗屬於指定 email；貼到另一個既有帳號時，所有斷言仍綠並綁錯人。— must-fix

- [b1-spec.md:137](/Users/sean_1/pcm-website-v2/docs/specs/2026-08-16-m4b-e8b-b1-spec.md:137) 規格防止刪除 Auth user，卻沒防 email、密碼或帳號持有人被換掉；UUID 不變時稽核身分可靜默換人。— must-fix

- [b1-spec.md:161](/Users/sean_1/pcm-website-v2/docs/specs/2026-08-16-m4b-e8b-b1-spec.md:161) 已更正為兩個帳號，但同檔 :177-183 仍指示開三個帳號、seed 三列；apply 人可能多開一個無主帳號。— must-fix

- [b1-spec.md:303](/Users/sean_1/pcm-website-v2/docs/specs/2026-08-16-m4b-e8b-b1-spec.md:303) [不確定] 只用 psql 證明內嵌 `COMMIT`，未證 MCP migration ledger 與 SQL 同交易；若 SQL 已提交後 ledger／連線失敗，會留下「物件已建、migration 未登記」。— must-fix

### 角度 2 · 災難當天可用性

- [b1b-migration-draft.sql:21](/Users/sean_1/pcm-website-v2/docs/specs/2026-08-16-m4b-e8b-b1b-migration-draft.sql:21) 「本支全退」只刪 `no_delete` 函式；`no_truncate`、`no_rebind` 兩支會殘留，下一次重建直接撞名。— must-fix

- [b2-seed-migration-draft.sql:20](/Users/sean_1/pcm-website-v2/docs/specs/2026-08-16-m4b-e8b-b2-seed-migration-draft.sql:20) 退場三步沒有交易包覆；DELETE 後若斷線或 ENABLE 失敗，資料已刪且 trigger 永久停用。— must-fix

- [b2-seed-migration-draft.sql:24](/Users/sean_1/pcm-website-v2/docs/specs/2026-08-16-m4b-e8b-b2-seed-migration-draft.sql:24) DELETE 沒有預期列數，ENABLE 後也沒有驗 trigger 狀態；刪到 0／1 列或忘做第三步，都沒有成功條件會紅。— must-fix

- [b1a-migration-draft.sql:54](/Users/sean_1/pcm-website-v2/docs/specs/2026-08-16-m4b-e8b-b1a-migration-draft.sql:54) rollback 以硬編碼舊 label／comment 覆寫；apply 後若有人更新它們，退場會靜默蓋掉較新的人工狀態。— must-fix

### 角度 3 · 測試假綠

- [b1a-migration-draft.sql:203](/Users/sean_1/pcm-website-v2/docs/specs/2026-08-16-m4b-e8b-b1a-migration-draft.sql:203) 「其他 staff 未被動到」只驗啟用總數為 3；一個真人被停用、另一個系統帳號被啟用時仍是 3，整支照綠。— must-fix

- [b2-seed-migration-draft.sql:171](/Users/sean_1/pcm-website-v2/docs/specs/2026-08-16-m4b-e8b-b2-seed-migration-draft.sql:171) 檔案已承認 CHECK 多放一個合法值仍會全綠；這代表「白名單恰好三人」目前沒有斷言保護。— must-fix

- [b2-seed-migration-draft.sql:338](/Users/sean_1/pcm-website-v2/docs/specs/2026-08-16-m4b-e8b-b2-seed-migration-draft.sql:338) DELETE 探針只打 `sean`，函式若只保護 sean、放行 staff_2 仍綠；它證不到全列禁刪。— must-fix

- [b2-seed-migration-draft.sql:356](/Users/sean_1/pcm-website-v2/docs/specs/2026-08-16-m4b-e8b-b2-seed-migration-draft.sql:356) UPDATE 探針只改 `staff_id`；函式若仍擋 staff_id、但放行 `auth_user_id` 重綁，元資料與行為探針都會綠。— must-fix

### 角度 4 · 回歸與權限面

- [b1b-migration-draft.sql:252](/Users/sean_1/pcm-website-v2/docs/specs/2026-08-16-m4b-e8b-b1b-migration-draft.sql:252) 規格稱寫入唯一入口是 migration，卻永久授予共用 `service_role` INSERT；所有既有 fetcher／server service key 都同步取得新增身分映射的能力。— must-fix

- [b2-seed-migration-draft.sql:52](/Users/sean_1/pcm-website-v2/docs/specs/2026-08-16-m4b-e8b-b2-seed-migration-draft.sql:52) B2 自稱確認「仍是 B1-b 的版本」，但沒重驗 ACL 與零 policy；兩支之間若重開 anon 權限並加 permissive policy，真人映射會被塞進已外露的表。— must-fix

- [b1b-migration-draft.sql:347](/Users/sean_1/pcm-website-v2/docs/specs/2026-08-16-m4b-e8b-b1b-migration-draft.sql:347) [不確定] anon/authenticated 只驗 `has_table_privilege`，沒驗可 `SET ROLE` 到 service_role 的路；NOINHERIT 成員路徑可讓斷言綠、實際仍可達。— must-fix

VERDICT: FAIL

---

## §2 逐條裁定(G5 窗當場開檔核實;**核實 = 我打開那個行號讀了那段**)

> 編號 `A1-A4`=角度1、`B1-B4`=角度2、`C1-C4`=角度3、`D1-D3`=角度4,照原文順序。
> **狀態欄只有三種**:`已折`(檔案已改,附 commit)/ `已折-寫成殘餘風險`(不改行為,明寫進檔)/ `未折`(附為什麼)。

| # | 一句話 | 核實 | 裁定 |
|---|---|---|---|
| **A1** | uuid 只驗存在、沒驗屬於指定 email | ✅ 開檔核實:原 `0.3` 只有 `EXISTS(… WHERE u.id = x.id)`,全檔零 email 比對 | **已折** — 改成 uuid ↔ email 成對比對,訊息列出三種可能(帳號沒開/貼錯/email 被改) |
| **A2** | 帳號的 email／密碼／持有人被換掉,uuid 不變 ⇒ 稽核靜默換人 | ✅ 屬實:`b1-spec.md:139-140` 逐字「換 email 不影響:綁的是 `auth.users.id`」—— 那句是**設計意圖**,而 codex 指的是它的**代價** | **已折-寫成殘餘風險** — `b2-seed` 檔尾新增 `R3-A2`。**不改行為**:修法住在「誰進得了 Auth 後台」,那是 Sean 一個人;第二個人拿到權限時它就從殘餘風險變成真缺口 |
| **A3** | 已改成兩列,但同檔表格仍寫「開三個帳號 / seed 三列」 | ✅ 開檔核實:更正段在散文、**動作表沒跟著改** | **已折** — 三列全部加刪除線 + 新值。**判別句留檔**:照著做的人會讀哪一半? |
| **A4** | `[不確定]` MCP ledger 與 SQL 是否同交易未證 | ✅ 屬實:§4 整節只證 SQL 內嵌 `COMMIT`,**台帳那一半全檔沒提** | **已折(把未知變成會被發現的狀態)** — apply 成功後的下一個動作固定兩問:物件在不在 / 台帳登了沒;① 有 ② 無 ⇒ 補登、**不得再 apply 一次** |
| **B1** | 「本支全退」只刪 `no_delete`,`no_truncate` / `no_rebind` 殘留 | ✅ 開檔核實:本檔建 **3 函式 + 3 trigger**(`:153`/`:173`/`:201`),退場只列 1 支 | **已折** — 退場改列三支 trigger + 三支函式,並註明 `DROP TABLE` 會帶走 trigger(留著是為半退場) |
| **B2** | 退 seed 三步沒有交易包覆 | ✅ 屬實:原文是三行裸 SQL + 一句「第 3 步不可省」 | **已折** — 改寫成 `BEGIN … COMMIT` 整段 |
| **B3** | 沒有預期列數、沒有驗 trigger 回到啟用 | ✅ 屬實 | **已折** — 加 `RETURNING` 列數斷言(不是 2 就 `1/0` 中止)+ `pg_trigger.tgenabled <> 'D'` 斷言。**留一句誠實邊界**:DDL 交易性是我推的、退場當天先在拋棄式庫跑一次 |
| **B4** | b1a rollback 用硬編碼舊值覆寫,會蓋掉較新的人工狀態 | ✅ 開檔核實:第 2 條旁有警語、**第 3 條(COMMENT)沒有** ⇒ 同一個坑只補一半 | **已折** — 加「退場第 0 步:先 SELECT 現值留底」,附兩行查詢;現值 ≠ 檔內舊值 ⇒ 停下來問 |
| **C1** | 「其他 staff 未被動到」只驗啟用總數 = 3 | ✅ 開檔核實:`count(*) WHERE is_active` ⇒ **一停一啟仍是 3** | **已折** — 改驗 `string_agg(id ORDER BY id) = 'sean,staff_1,staff_2'`,數量留在訊息裡幫診斷 |
| **C2** | 「白名單恰好三人」沒有斷言(檔案自己已承認) | ✅ 屬實,而**原本被寫成「判別力上限、選擇不做」** | **已折(推翻原本的取捨)** — 改用**數單引號字面顆數 = 3**:不看排版、不看 `::text`、不看 `IN` vs `ANY(ARRAY[…])` ⇒ 原本「全等比對會誤紅」那個理由**不適用這個做法** |
| **C3** | DELETE 探針只打 `sean` | ✅ 開檔核實 | **已折** — 改成不帶 `WHERE` 打全表:`FOR EACH ROW` 只要有一列漏擋就會刪掉 ⇒ 一句涵蓋兩列且不必枚舉代號 |
| **C4** | UPDATE 探針只改 `staff_id`,`auth_user_id` 那半沒測 | ✅ 開檔核實:`no_rebind`(`b1b:201`)的 `IF` 有**兩個**條件,而探針只餵一個 | **已折** — 加第二支探針改 `auth_user_id`;**刻意不接受 FK 例外當「有擋到」**(那樣 no_rebind 仍未知) |
| **D1** | 永久授 `service_role` INSERT,與「寫入唯一入口 = migration」相矛盾 | ✅ 開檔核實:`GRANT SELECT, INSERT … TO service_role`。**誰真的需要 INSERT?只有 B2-seed,而它以 owner 跑** | **已折(改設計)** — 改成只 `GRANT SELECT`,並加一道斷言「service_role 不得有任何寫入權」+ 對照組「SELECT 必須有」。🔴 **附一個未查證前提**:`apply_migration` 若以 service_role 連線,B2 會被權限擋 ⇒ 緩解 = B2 前提斷言會自己說明 |
| **D2** | B2 沒重驗 ACL 與零 policy | ✅ 開檔核實:前提斷言只看 `to_regclass` + `pg_constraint` | **已折** — B2 前提加四道:RLS 開著 / 零 policy / anon+authenticated 七種權限全無 / **對照組 service_role 必須有 SELECT**(否則前三道在「誰都碰不到」的世界恆真) |
| **D3** | `[不確定]` 只驗 `has_table_privilege`,沒驗 `SET ROLE` 路徑 | 🟡 **無法在本機核實** ⇒ ⛔ **2026-08-18 更正:正式庫【已經量過了】** —— `docs/specs/2026-08-17-b1-apply-preflight.md:30` 逐字「✅ **已量 = 0 列**(2026-08-17 05:12 UTC,E 窗)」,而同一列也寫「**0 不是安全**:它代表第 2 層在正式庫上判別力為零;**apply 當天必須當場重跑**」 | **未折,附待驗查詢** — 我的理由是「Supabase 的切換者是 `authenticator`,`anon` 不是 service_role 的成員」,**而那句是我從架構推的不是查到的** ⇒ 查詢已寫進 `b1b` 該段旁邊,apply 當天貼上去跑;結果出現 `anon`/`authenticated` 當 member ⇒ 停下來回報 |

---

## §3 折完之後還沒做的事(不要讀成「B1 可以 apply 了」)

1. 🔴 **依輪次紀律要跑 R4**:R3 判 FAIL、我折了 14 條 ⇒ **修完要再跑一輪確認**(記憶逐字:R1 FAIL 才 R2;這裡是 R3 FAIL ⇒ R4)。
   ⚠️ **而 R4 要再換一次角度或模型** —— 同模型同角度會在同一框架內找更細的東西。
2. ⛔ ~~**本輪所有折入都是【檔案改動】,沒有一條被實跑過**~~
   🔴 **2026-08-18 當場推翻我自己這句:折完之後全部在拋棄式 PG 17.10 上跑過了,見 §4。**
   **而那一跑抓到我兩個【自己改出來的】錯**(§4 那兩條)—— 所以這一句留著劃掉,不刪:
   **「我折得對不對」與「我折進去的東西跑不跑得起來」是兩件事,而我原本打算只交前者。**
3. ⛔ ~~`B1-a` 執行前仍要跑 `select distinct actor …`(**仍未跑**)~~ ⇒ **2026-08-18 第六輪(GR `#8`)抓到三方字面不一致**:`2026-08-17-b1-apply-preflight.md:27` 逐字「可選(已跑過一次:`sean` 48 / `staff_1` 17)」、`b1-spec.md` §0.5 我當天已自我更正,**而本檔這一句沒跟** ⇒ 正確狀態是**已跑過一次、`B1-a` 執行前【建議重跑】**(值會變)。📎 形狀:**我修了兩處、漏了第三處** —— 而「折了一處」與「折完了」是兩件事(同一天第三次)。
4. apply 本身仍需 **Sean 在場**(MCP `apply_migration`;報價單 repo 明文禁 `supabase db push`)。


---

## §4 折完之後的實跑(拋棄式 PG 17.10,2026-08-18 · G5 窗)

**環境**:本機 `initdb` 起的拋棄式叢集(`127.0.0.1:55501`),PCM bootstrap 照
`docs/runbooks/throwaway-postgres-for-migration-verification.md` §2(roles / `auth.users` 骨架 —— 🔴 **本輪多加了 `email` 欄**,因為 A1 的修法要比對它)。
**用完當回合拆掉,兩層都驗過**:程序零命中 + `lsof -iTCP:55501` 零命中 + 資料目錄已刪。

### 4.1 三支草稿 apply 結果

| 支 | 結果 |
|---|---|
| `b1a`(A 庫) | ✅ 全綠(前提斷言 + 落地斷言全過) |
| `b1b`(報價單庫) | ✅ 全綠 —— **但第一次是紅的,見 4.2** |
| `b2-seed` | ✅ 全綠(`2 列、每個 uuid 精確配對到人`) |
| 三支的靜態檢查 `scripts/migration-static-checks.sh` | ✅ 三支各三道全過 |

### 4.2 🔴🔴 實跑抓到我【自己折出來的】兩個錯 —— 讀 SQL 讀不出來

**① `D1` 拿掉 `GRANT INSERT` 之後,同一支檔裡的收權斷言當場紅**
```
ERROR: 新物件收權斷言:service_role 的【有效 + 可達權限】不符,預期恰好 {SELECT, INSERT}
       不符處:表級 INSERT
```
⇒ **「可接受的權限集合」寫在兩個地方**(`GRANT` 一份、斷言的 `IN (…)` 一份),改一份不會有東西提醒你改另一份。
⇒ 已一起改成 `{SELECT}`,**並補回欄級 `INSERT` 那一問** ——
原本不查欄級 INSERT 的理由是「表級已為真」,而**那個前提剛剛被我自己拿掉**,不補就會從兩道之間漏過去。
📎 **這一條不在 codex 的 finding 裡:折 finding 的動作本身會製造新的面。**

**② `C3` 我的第一版修法是錯的,而且錯得很像對的**
> 🔴 **2026-08-18 補量(被「全稱句守門」擋下之後才發現的)**:我原本寫「突變實測打臉」,
> **而當時實際跑過的是【修好之後】的版本** —— 「打全表那版會是綠的」那句**是我從 PG 語意推的,不是量的**。
> ⇒ 當場補一發專門的對照(拋棄式 PG 17.10,`no_delete` 改成只保護 `sean`,兩種探針各打一次):
> ```
> 打全表版:被擋下了(SQLSTATE=P0001) ⇒ 探針【綠】,而 staff_2 其實沒被保護
> 逐列版(staff_2):【沒被擋】 ⇒ 探針會紅 = 抓到了
> ```
> **⇒ 現在它是量到的。** 📎 而這一條本身就是本檔的母題再演一次:
> **「我是跑出來的」與「我是推出來的」在紙面上長得一樣**,而我寫的時候沒有分。
我原本把 DELETE 探針從 `WHERE staff_id='sean'` 改成**不帶 WHERE 打全表**,理由寫得很漂亮
(「`FOR EACH ROW` 只要有一列漏擋就會刪掉」)。**突變實測打臉**:
`BEFORE DELETE FOR EACH ROW` 只要**任何一列**被擋,**整句就中止** ⇒
一支「只保護 `sean`」的函式,打全表**照樣被擋** ⇒ **探針還是綠的,codex 指的洞一點都沒補到。**
⇒ 改成**每一列 × 每一個識別欄各打一次**(`FOREACH v_who IN ARRAY ['sean','staff_2']`)。

### 4.3 突變測試(每一格都先讓它綠,再讓它紅)

| 突變 | 期望 | 實得 |
|---|---|---|
| (對照組)不突變 | GREEN | ✅ GREEN |
| `auth.users` 把 `staff_2` 的 email 改掉(uuid 不動) | RED | ✅ RED —— `A1` 那道 |
| 白名單 CHECK 多塞一個 `'x9'` | RED | ✅ RED —— `C2` 數字面顆數那道 |
| `GRANT SELECT … TO anon` | RED | ✅ RED —— `D2` |
| 加一條 permissive policy | RED | ✅ RED —— `D2` |
| `DISABLE ROW LEVEL SECURITY` | RED | ✅ RED —— `D2` |
| `no_delete` 改成**只保護 `sean`** | RED | ✅ RED(`DELETE(staff_2) 沒有被擋下`)—— `C3` |
| `no_delete` **整支掏空** | RED | ✅ RED(`DELETE(sean) 沒有被擋下`) |
| `no_rebind` 改成**只看 `staff_id`** | RED | ✅ RED(`UPDATE(sean.auth_user_id) 是被外鍵擋下的,不是 no_rebind`)—— `C4` |
| `service_role` 被 `GRANT INSERT` | RED | ✅ RED —— `D1` 新斷言的負向對照 |
| `staff` 一停一啟(`staff_1` 停、`op4_backfill` 啟) | RED | ✅ RED —— `C1` |

🔴 **`C1` 那一格的「舊斷言會綠」不是我推的,是量的**:同一個突變世界裡
`select count(*) from public.staff where is_active and id <> 'test_01'` ⇒ **`3`**
⇒ **舊的 `count = 3` 斷言在那個世界【剛好通過】**,而新的 id 集合斷言紅。

⚠️ **`m_rebind_half` 那格的訊息第一版是錯的**:原本走 `WHEN OTHERS` 印「探針出現非預期錯誤」——
**紅在對的地方,說錯了原因**(讀的人會去查探針,而壞掉的是那支函式)。
已改成明捕 `foreign_key_violation`:`BEFORE` trigger 比 FK 早跑 ⇒ 走到 FK 代表 **no_rebind 已經放行**。

### 4.4 本機實跑證不到的(效度限定,照 runbook §5)

- **不是** Supabase:本機的 `service_role` 是我自己 `CREATE ROLE … BYPASSRLS` 造的,
  **正式庫的 ADP / role membership 與這裡不同** ⇒ `D3`(`SET ROLE` 可達性)這裡量不到,仍待 apply 當天那條查詢。
- **不是** `apply_migration`:這裡走的是 `psql`,而台帳(`A4`)與連線角色(`D1` 的未查證前提)都只有 MCP 那條路才問得到。
- `auth.users` 是**骨架**(`id` + `email` 兩欄),不是真的 GoTrue 表。


---

# §5 第四輪(再換一次角度)· codex 原文(逐字,未編輯)

> **為什麼跑**:R3 判 FAIL、我折了 14 條 ⇒ 依輪次紀律修完要再一輪確認。
> **換了什麼**:R4 的四個角度是 **①折入自己製造的新面 ②診斷正確性(紅了之後那個人會去改什麼)
> ③apply 當天的順序與人 ④斷言之間的相依(誰遮蔽誰、誰恆真)** —— 與 R1/R2/R3 都不同。
> **結果:`VERDICT: FAIL`,15 條(11 must-fix + 4 nit)。**
> 🔴🔴 **角度 1 一口氣抓到 5 條,而那 5 條【全部是我 R3 折進去的東西造出來的】** ——
> 這正是我在 R3 triage §4.2 自己寫下的那句話的第三、四、五個例子:**折 finding 的動作本身會製造新的面。**

### 角度 1 · 折入自己製造的新面

- `docs/specs/2026-08-16-m4b-e8b-b1b-migration-draft.sql:149` 已撤銷 `service_role INSERT`，永久資料表註解卻仍宣稱有 `SELECT/INSERT`，後續維護者可能依註解把寫權補回。— must-fix

- `docs/specs/2026-08-16-m4b-e8b-b2-seed-migration-draft.sql:142` R3 新增的 ACL 陣列只列七項、漏掉 PG17 的 `MAINTAIN`；授給 `anon` 後 B2 仍綠，且公開角色可執行維護／鎖表操作。— must-fix

- `docs/specs/2026-08-16-m4b-e8b-b2-seed-migration-draft.sql:149` 只重驗 `service_role SELECT`，未重驗 B1-b 承重的 `rolbypassrls`；兩支之間若撤掉 BYPASSRLS，B2 仍會 seed，但登入永遠讀不到映射。— must-fix

- `docs/specs/2026-08-16-m4b-e8b-b2-seed-migration-draft.sql:47` R3 新增的退場檢查仍用 `tgenabled <> 'D'`；trigger 若變成 `R`，正常連線下等同停用，檢查卻允許 COMMIT。— must-fix

- `docs/specs/2026-08-16-m4b-e8b-b2-seed-migration-draft.sql:469` 新迴圈把涵蓋列寫成另一份手工陣列；複製本檔新增員工時若忘記同步，新增列的 DELETE／兩種 UPDATE 保護完全沒被探測且全綠。— must-fix

- `docs/specs/2026-08-16-m4b-e8b-b1-spec.md:191` 動作表已改成兩個帳號，但硬規則仍要求驗「三個 uuid」；apply 人會再次遇到兩套互斥數字。— nit

### 角度 2 · 診斷正確性

- `docs/specs/2026-08-16-m4b-e8b-b1b-migration-draft.sql:290` 若寫權來自繼承角色，這道較早的有效權限檢查會先 RAISE，使後面能指出「拆 role membership」的診斷永遠到不了；照訊息撤 `service_role` 直授不會修好。— must-fix

- `docs/specs/2026-08-16-m4b-e8b-b2-seed-migration-draft.sql:253` 若 B2 資料已 COMMIT、台帳寫入失敗，重試會在此被告知「要加人請另寫 migration」；真正修法是補登台帳，訊息會把人帶去建立錯誤的新 migration。— must-fix

- `docs/specs/2026-08-16-m4b-e8b-b2-seed-migration-draft.sql:431` 配對紅燈只指向「兩個 uuid 對調」，但同檔已承認漏改第三份硬編碼期望值也會產生同一紅燈；操作者可能去交換其實正確的帳號。— must-fix

- `docs/specs/2026-08-16-m4b-e8b-b2-seed-migration-draft.sql:486` [不確定] 若未來有外鍵參照映射列，DELETE 到達 FK 才被擋代表 `no_delete` 沒先攔住；目前卻只報「探針非預期錯誤」，與已修掉的 UPDATE 誤診同形。— must-fix

- `docs/specs/2026-08-16-m4b-e8b-b1b-migration-draft.sql:346` RLS 未開不等於「對所有角色敞開」，ACL 的 REVOKE 仍存在；錯誤訊息把防線失效誇成另一個並未發生的權限狀態。— nit

### 角度 3 · apply 當天的順序與人

- `docs/specs/2026-08-16-m4b-e8b-b1-spec.md:320` B1-b 與 B2 共用「表存在＋台帳」讀回，但 B2 開始前表本來就已存在；B2 中斷後無法靠這兩問判斷兩列究竟有沒有 COMMIT。— must-fix

- `docs/specs/2026-08-16-m4b-e8b-b1-spec.md:325` 「物件有、台帳無就補登」只適用 B1-b；套到 B2 可能替一支其實沒有 seed 成功的 migration 補登台帳，留下台帳綠、映射表空的最難救狀態。— must-fix

### 角度 4 · 斷言之間的相依

- `docs/specs/2026-08-16-m4b-e8b-b2-seed-migration-draft.sql:206` 同一個 DO 內，RLS 未開早已在 :128–132 RAISE，兩者之間沒有任何 RLS 變更；此處第二道 RLS 斷言在所有世界都到不了失敗分支。— nit

- `docs/specs/2026-08-16-m4b-e8b-b1a-migration-draft.sql:209` `is_active` 為 NOT NULL，列不存在已先在 :200–202 RAISE；後面的「該列仍在」斷言不可能獨立叫出來。— nit

VERDICT: FAIL

---

# §6 R4 逐條裁定(G5 當場開檔核實)

| # | 一句話 | 核實 | 裁定 |
|---|---|---|---|
| **R4-A1** | 撤了 `service_role INSERT`,而**表註解仍宣稱有 SELECT/INSERT** | ✅ 開檔核實(`b1b:149` 逐字) | **已折** — 註解改成「只有 SELECT、沒有任何寫入權」,並加一句「看到這行不要順手把寫權補回去」。🔴 **永久註解是【比 code 活得久】的那一半**,改權限沒改註解 = 留一張過期的地圖 |
| **R4-A2** | 我 R3 新增的 ACL 陣列**手寫七項、漏掉 PG17 的 `MAINTAIN`** | ✅ 屬實 | **已折(改做法)** — 改成從 `acldefault()` 推導,與 B1-b 同一套。🔴 **我前一天才在同一支檔讀過「枚舉的集合比世界窄」,然後自己手寫了一份清單** |
| **R4-A3** | B2 沒重驗 B1-b 承重的 `rolbypassrls` | ✅ 屬實 | **已折** — 加一道;失敗世界是「seed 成功而登入永遠讀不到映射」 |
| **R4-A4** | 我 R3 寫的退場檢查用 `tgenabled <> 'D'`,漏掉 `'R'` | ✅ 屬實(而**同檔既有的**前提斷言用的是 `IN ('O','A')` —— 對的那個寫法就在同一支檔裡) | **已折** — 改 `= 'O'`。📎 **用「不是壞的那個值」判會漏掉你沒想到的壞值** |
| **R4-A5** | 我 R3 把探針改成迴圈,而**迴圈的陣列是一份新的手工清單** | ✅ 屬實 | **已折(改做法)** — 改成 `FOR v_who IN SELECT staff_id FROM …` 從表自己撈 ⇒ 涵蓋率永遠等於表的列數,加人不必記得改 |
| **R4-A6** `nit` | 動作表改兩個帳號了,**底下那句硬規則還寫「三個 uuid」** | ✅ 屬實 | **已折** — 改兩個 + 補上 email 那半 |
| **R4-B1** | 我 R3 新增的「不得有寫入權」斷言**比既有那道深的先跑**,而訊息只講「REVOKE 直授」 | ✅ 屬實 | **已折** — 訊息改成列三種來源 + 附一條「先查是哪一種」的查詢 |
| **R4-B2** | 「表非空」的訊息會把「台帳沒登、正在重跑」的人**帶去建一支錯的 migration** | ✅ 屬實 | **已折** — 訊息分成 (a) 台帳沒登 ⇒ **補登、不要另寫** (b) 真的要加人 ⇒ 另寫一支 |
| **R4-B3** | 配對紅燈只指向「兩個 uuid 對調」,而**漏改第三份硬編碼期望值也會紅成同一句** | ✅ 屬實(本檔自己就寫著有三份硬編碼) | **已折** — 訊息列兩種成因 + 分辨法(拿實際值去對 email) |
| **R4-B4** `[不確定]` | DELETE 探針沒有明捕 FK,與已修的 UPDATE 誤診同形 | 🟡 **今天走不到**(沒有任何外鍵參照本表) | **已折** — 照樣加。**「今天走不到」不是「以後走不到」**,成本三行、漏寫的代價是一句誤導的診斷 |
| **R4-B5** `nit` | RLS 訊息把「沒開 RLS」誇成「整張表對所有角色敞開」 | ✅ 屬實(ACL 的兩道 REVOKE 仍在) | **已折** — 改成「失去的是第二層」,並寫明誇大會讓人去查錯的地方 |
| **R4-C1** | apply 後的「兩問」對 B2 **恆真**(表本來就存在) | ✅ 屬實 —— **這是我 R3 折 A4 時寫的東西** | **已折** — 改成一支一問的表:B1-a 問 `is_active`、B1-b 問 `to_regclass`、**B2 問 `count(*) = 2`** |
| **R4-C2** | 「物件有、台帳無 ⇒ 補登」套到 B2 會**替一支沒 seed 成功的 migration 補登** | ✅ 屬實 | **已折** — 加「① 不成立 ⇒ 那一支沒有成功,**不可以補登台帳**」 |
| **R4-D1** `nit` | B2 裡第二道 RLS 斷言**永遠到不了失敗分支** | ✅ 屬實(我 R3 在同一個 DO 更前面加了一道) | **已折(刪掉那行 code、留說明)** — 恆真的斷言比沒有斷言更糟 |
| **R4-D2** `nit` | b1a「那一列還在」斷言不可能獨立叫出來 | ✅ 屬實(`is_active` 是 NOT NULL ⇒ 列不在時前一道就紅了) | **已折(刪掉 + 移除未用變數)** — 同上一族 |

**⇒ R4:15 條全折(11 must-fix + 4 nit),駁回 0。**

---

# §7 R4 折完後的實跑(拋棄式 PG 17.10,第二座)

**三支全部重跑 + 靜態檢查三道 × 三支全過**(`b1a:265` / `b1b:801` / `b2-seed:610` 結束交易各恰一次且在最後一行)。

| 突變 | 期望 | 實得 |
|---|---|---|
| 對照組(不突變) | GREEN | ✅ |
| `auth.users` 改掉 `staff_2` 的 email | RED | ✅ |
| 白名單多一個 `'x9'` | RED | ✅ |
| `GRANT SELECT … TO anon` | RED | ✅ |
| 🆕 **`GRANT MAINTAIN … TO anon`**(R4-A2 那條的負測) | RED | ✅ `anon:MAINTAIN` —— **手寫七項的舊版在這一格會綠** |
| 加 permissive policy | RED | ✅ |
| `DISABLE ROW LEVEL SECURITY` | RED | ✅ |
| 🆕 **`ALTER ROLE service_role NOBYPASSRLS`**(R4-A3) | RED | ✅ |
| `no_delete` 只保護 `sean` | RED | ✅ `DELETE(staff_2) 沒有被擋下` |
| `no_delete` 整支掏空 | RED | ✅ `DELETE(sean) 沒有被擋下` |
| `no_rebind` 只看 `staff_id` | RED | ✅ `UPDATE(sean.auth_user_id) 是被外鍵擋下的` |
| b1a:對照組 / 一停一啟 / `test_01` 被刪 | GREEN / RED / RED | ✅✅✅ |

## 🔴🔴 而這一輪的實跑,抓到的是【我的測試工具】自己的洞

`ALTER ROLE … NOBYPASSRLS` 是**叢集層級**的,不是資料庫層級 ——
我把它當成「一個 case 的突變」下下去,**它洩漏到後面三個 case**。
那三個 case **照樣印 `[OK] 期望=RED 實得=RED`**,而它們紅的原因**根本不是我要測的那個東西**。

⇒ **修法不是「記得還原」,是把判準從【有沒有紅】換成【紅的是不是那一句】** ——
第二版 harness 每一格都要求錯誤訊息**含指定字串**(`DELETE(staff_2)` / `auth_user_id` …)。
📎 母題:**錯的那次和對的那次長得一樣**。這一次「長得一樣」的是我的**測試報表**,不是被測的 SQL。


---

# §8 第五輪 · codex 原文(逐字,未編輯)

> **換的角度**:①操作者視角(照著做,不是讀 code)②本機綠、正式庫不綠 ③規格宣稱 vs 檔案實作 ④下游繼承。
> **prompt 另外開了一條**:「若你認為某一輪的折入【折錯了】,明說並標 `[折錯]`」。
> **結果:`VERDICT: FAIL`,16 條,其中 **2 條 `[折錯]`**(codex 直接說我 R4 的修法本身是壞的)。

### 角度 1 · 操作者視角

- `docs/specs/2026-08-16-m4b-e8b-b1-spec.md:25`：§0.5 宣稱硬前置全清，下一行卻仍叫人跑已完成的 R3；不熟本線者可能跳過 R5 與尚未完成的正式庫前置。— must-fix
- `docs/specs/2026-08-16-m4b-e8b-b1b-migration-draft.sql:5`：檔頭只導向長規格，未導向自稱「apply 前置單一正本」的 preflight；操作者最可能漏掉台帳、物件重量及 apply 當天角色查詢。— must-fix
- `docs/specs/2026-08-16-m4b-e8b-b2-seed-migration-draft.sql:2`：最醒目的標題與規格連結仍寫「三個真人／三列」，下一段才改口兩個；操作者可能尋找或建立不存在的第三個帳號。— must-fix
- `[折錯] docs/specs/2026-08-16-m4b-e8b-b1b-migration-draft.sql:299`：R4 新增的「先查來源」只查表級直授，看不到欄級授權及 `SET ROLE` 路徑；紅燈仍會把操作者帶去錯的修法。— must-fix

### 角度 2 · 本機綠、正式庫不綠

- `[不確定] docs/specs/2026-08-16-m4b-e8b-b2-seed-migration-draft.sql:381`：本機以表 owner 執行，但 SQL 沒先驗正式 MCP 的 `current_user`／owner；若角色不同，TRUNCATE 探針會以 `42501` 誤紅並擋住 Sean。— must-fix
- `docs/specs/2026-08-16-m4b-e8b-b1b-migration-draft.sql:277`：檔案聲稱 B2 有角色／權限前提斷言可自我說明，實檔沒有；正式角色不同時只會在探針或 INSERT 原始錯誤處爆開。— must-fix
- `[不確定] docs/specs/2026-08-16-m4b-e8b-b1a-migration-draft.sql:223`：本機固定六列使啟用名單恰為三人；正式庫若已合法新增員工，完全正確的 migration 仍會誤紅。— must-fix
- `[折錯] docs/specs/2026-08-16-m4b-e8b-b2-seed-migration-draft.sql:148`：R4 改成自動推導權限種類，但仍只呼叫 `has_table_privilege`；正式庫若出現欄級授權，B2 會假綠。— must-fix

### 角度 3 · 規格宣稱 vs 檔案實作

- `docs/specs/2026-08-16-m4b-e8b-b1-spec.md:260`：硬規則要求 B1-b 開頭明確斷言新表不存在及 `public` schema 存在，實際 precheck 沒有這兩道。— must-fix
- `docs/specs/2026-08-16-m4b-e8b-b1-spec.md:64`：規格把 B1-a 定義成只停用 `test_01`，SQL 卻另改 `staff_2.label` 並整段覆蓋 staff 表註解；兩項資料變更沒有進入規格範圍。— must-fix
- `docs/specs/2026-08-16-m4b-e8b-b1-spec.md:130`：規格只要求禁 DELETE，SQL 額外建立禁 TRUNCATE、禁重綁兩套永久機制，且 B2 已把它們當必要前提；規格與實作契約分裂。— must-fix
- `docs/specs/2026-08-16-m4b-e8b-b1-spec.md:430`：B1-a 驗收只列停用及其他列的 `is_active`，沒有驗 `staff_2.label` 與表註解；SQL 多做的兩項沒有規格級成功條件。— must-fix

### 角度 4 · 下游繼承

- `docs/specs/2026-08-16-m4b-e8b-b1-spec.md:179`：【最貴】seed 被命名為「B2，不是 B1」，但母線的 B2 是「登入認人」；交接者可能在空表狀態開始登入 B2，或把 seed 完成誤當登入 B2 完成。— must-fix
- `docs/specs/2026-08-16-m4b-e8b-b2-seed-migration-draft.sql:162`：B2 只重驗 `service_role` 有 SELECT／BYPASSRLS，未重驗它仍無 INSERT、UPDATE、DELETE、TRUNCATE；寫權若重開，下游會把「migration 唯一寫入」當成假事實。— must-fix
- `docs/specs/2026-08-16-m4b-e8b-b1-spec.md:208`：跨庫 `staff.is_active` 被延後到 B5 才驗；登入 B2 若把「表裡有對應列」當成「此人仍可上工」，離職帳號仍能先通過登入認人。— must-fix
- `docs/specs/2026-08-16-m4b-e8b-b2-seed-migration-draft.sql:164`：BYPASSRLS 只在 seed 當下重驗，seed 後到登入 B2 之間若被撤銷，下游查詢會靜默回零列；目前沒有把這項前提交給下游重新驗。— must-fix

VERDICT: FAIL

---

# §9 R5 逐條裁定

| # | 一句話 | 核實 | 裁定 |
|---|---|---|---|
| **R5-1** | §0.5 說「硬前置全清」,下一句卻叫人去跑**已經做完的 R3** | ✅ | **已折** — 換成「還剩下的四件」表(R5 折完+R6 / `select distinct actor` / schema 一致性 / apply 本身),並寫明「硬前置全清」的射程是 B1-b 的設計依賴,不是「可以 apply 了」 |
| **R5-2** | b1b 檔頭只導向長規格,沒導向 preflight | ✅ | **已折** — 檔頭前兩行改成先導 `2026-08-17-b1-apply-preflight.md` 與本 triage §3/§7 |
| **R5-3** | b1c 標題仍寫「三個真人」 | ✅ | **已折** — 標題改「兩個」,並在檔頭第一句解釋檔名為何不改 |
| **R5-4** `[折錯]` | R4 的「先查是哪一種」只查表級 | ✅ **折錯屬實** | **已折** — 改成三條查詢(表級 / 欄級 / role membership),並寫「三條都空而仍紅 ⇒ 停下來回報,不要放寬」 |
| **R5-5** `[不確定]` | TRUNCATE 探針在非 owner 角色會誤紅成「非預期錯誤」 | ✅ 檔內註解早就寫了,**而它只寫在註解裡** | **已折** — 明捕 `insufficient_privilege`,訊息說清「探針測不到 ≠ 保護壞了」與該怎麼辦 |
| **R5-6** | b1b 聲稱「緩解已下在 B1-c 的前提斷言裡」,**實檔沒有** | ✅ 屬實 —— 我宣稱有而沒寫 | **已折** — 真的加上 `has_table_privilege(current_user, …, 'INSERT')` 那道,訊息印當下角色 |
| **R5-7** `[不確定]` | b1a 固定三人名單 ⇒ 正式庫合法多員工時**誤紅** | ✅ | **已折(換問題,不是放寬)** — 加 `b1a_before` 快照,改驗「本支只造成兩種差異」;原本那道降成 NOTICE。🔴 **降級這件事命中 R4 停止訊號,理由寫在檔內那一段,交給下一輪攻擊** |
| **R5-8** `[折錯]` | R4 把權限型別改成推導了,**問法仍只有 `has_table_privilege`** ⇒ 欄級授權假綠 | ✅ **折錯屬實** | **已折** — 補上欄級那一圈(`has_any_column_privilege` × 四種);**新增負測 `c_col` 已紅** |
| **R5-9** | 規格只定義 B1-a 停用 test_01,SQL 另外改了 `staff_2.label` 與表 COMMENT | ✅ | **已折** — b1-spec 新增 §9「規格 vs 檔案」對照表 + 補三格驗收 |
| **R5-10** | 規格只要求禁 DELETE,SQL 建了禁 TRUNCATE / 禁重綁**兩套永久機制**,而 B1-c 已把它們當前提 | ✅ | **已折** — §9 把兩道**升為契約**,並寫「不得以『規格沒要求』為由拆掉」 |
| **R5-11** | 規格要求 B1-b 開頭斷言新表不存在 / `public` schema 存在,實際 precheck 沒有 | 🟡 **部分**:裸 `CREATE TABLE` 撞名本來就會紅(檔頭硬規則 2 明寫「撞名要當場紅」) | **已折-寫成契約差異** — 納入 §9 的對照表;**不加那兩道斷言**,理由:`CREATE` 本身就是那道檢查,再加一道是**同一件事查兩次而診斷更遠** |
| **R5-12** | B1-a 驗收沒有 `staff_2.label` 與表註解的成功條件 | ✅ | **已折** — §9 補 a1/a2/a3 三格 |
| **R5-13** 【最貴】 | seed 被叫「B2」,而母線 B2 是**登入認人** | ✅ 屬實 | **已折** — 一律改稱 `B1-c`;**檔名不動**(已被多處指到),理由寫在紅框 |
| **R5-14** | B1-c 沒重驗 service_role **仍無寫入權** | ✅ | **已折** — 加一道;**新增負測 `c_write` 已紅** |
| **R5-15** | 跨庫 `staff.is_active` 延到 B5 才驗 ⇒ 登入認人可能把「表裡有列」當「還能上工」 | ✅ | **已折(寫成營運規定 + 缺口)** — B2 spec 新增 §6.5:離職要做兩件事(Auth 停用 + A 庫 is_active),**只做一件沒有任何東西會提醒你**,明寫成缺口 |
| **R5-16** | BYPASSRLS 只在 seed 當下驗,之後被撤 ⇒ 下游靜默回零列 | ✅ | **已折** — B1-c 加 `rolbypassrls` 前提;**新增負測 `c_nobypass` 已紅**。⚠️ 「seed 之後被撤」那一半**仍然沒有守**(migration 只跑一次),明寫 |

**⇒ R5:16 條全折(2 條 `[折錯]` 含在內),駁回 1 條的一半(R5-11 的「再加兩道斷言」不採,理由在表內)。**

---

# §10 收斂狀態(主視窗 2026-08-18 裁定「R5 折完就停」之後落的)

## 10.1 這 16 條裡,幾條是新的面?

| 分類 | 條數 | 哪些 |
|---|---|---|
| **新的面**(前四輪的框架看不到) | **11** | R5-1 / 2 / 5 / 6 / 7 / 9 / 10 / 11 / 12 / 13 / 15 |
| **前輪同一面的更細版** | **3** | R5-3(R3-A3 的同病在另一支檔)/ R5-14 / R5-16(都是 R3-D2「重驗 ACL」那一面的延伸) |
| **回歸:修上一輪的修法** | **2** | R5-4 / R5-8(兩條 `[折錯]`) |

🔴 **而【條數沒下降】(15 / 15 / 16)與【新面佔 11/16】這兩個訊號指向相反的方向,兩個都要講**:
- 支持繼續:每一輪換角度都還在挖到**前一輪看不到的東西**,角度 3(規格 vs 檔案)與角度 4(下游繼承)
  **是前四輪從來沒問過的問題**,一問就是 8 條。
- 支持停:**兩條 `[折錯]`** 說明審查者已經開始修「上一輪修出來的東西」;
  而**五輪同一個模型**(`gpt-5.6-sol`)—— `00-work-rules.md` §5 要求「第 3 輪起換角度**換模型**」,
  **我只換了角度,沒換模型。這一條我沒做到。**

## 10.2 哪些面已經穩定(連續兩輪沒再被打)

| 面 | 最後一次被打 | 現況 |
|---|---|---|
| SQL 本身的原子性 / 交易邊界 | R1-R2 | ✅ 三輪沒再被打 |
| 兩個資料庫有沒有搞混 | R1-R2 | ✅ 三輪沒再被打 |
| trigger 元資料 vs 行為(掏空函式) | R3 | ✅ 兩輪沒再被打(R5 只碰探針的**涵蓋**,沒碰這一面) |
| 白名單「是哪三個」 | R3-R4 | ✅ R5 沒碰 |

## 10.3 哪些面**每一輪都被打**(= 決策題的原料,不是下一輪的工作清單)

1. 🔴🔴 **權限面(anon / service_role / 欄級 / SET ROLE)** —— **R3、R4、R5 連三輪都被打,而且每一輪都是【我上一輪的修法留下的縫】**。
   ⇒ **這一面的形狀是:每補一道,就多一個「這道問法涵蓋不到的問法」。**
   **判別句**:表級 / 欄級 / 預設權限 / role membership 是**四種不同的問法**,而每一輪我都只補了其中一兩種。
   ⛔ ~~**決策題原料**:要不要改成「白名單式驗證」(斷言 `relacl` 逐字等於某字串)。代價:PG 版本改排版會誤紅。~~
   🔴🔴 **2026-08-18 主視窗當場裁掉這條決策題,而理由是【本 repo 已經解過,是我沒查到】。**
   **我自己開檔核過它給的三個位置**(不是轉述):
   - `docs/patterns/revoking-function-execute-in-supabase.md:283-285` —— `lateral aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a`
     (那一段是 A/B/C/D 四種查法的對照,**C 才是正確查法**:ACL 為 `NULL` 時要展開 `acldefault`)
   - `PROGRESS.md:1255` 與 `PROGRESS.md:1224` —— 兩行都含 `aclexplode`
     (量法 `grep -n aclexplode PROGRESS.md` ⇒ **5 行命中:468 / 482 / 1085 / 1224 / 1255**)
   **⇒ 正解既不是「字串比對」也不是「枚舉」,是【把 ACL 攤平成集合,跟一份 allowlist 做集合相等】**:
   多一個 grantee、多一個 privilege、多一個 grant-option 都會紅,而**排版變了不會紅**。
   ⚠️ **而它只蓋到表級 + 欄級** —— **預設權限(ADP)與 role membership 仍是分開的兩問**,
   主視窗明講「不要硬塞進同一個斷言,會做出一個誰都看不懂的東西」。
   📎 **我這一輪學到的**:我把「還沒解」寫成「這是取捨」,**而取捨聽起來比「我沒查」體面** ——
   判別句 = **在我把一件事升成決策題之前,我在 repo 裡搜過同一個問題嗎?**
2. 🔴 **「本機綠、正式庫不綠」** —— R5 角度 2 一問就 4 條,而**前四輪零命中**(因為前四輪沒問)。
   ⇒ 這一面**不是靠再審一輪關得掉的**,它要的是**正式庫的存取**(而那要 Sean)。
3. **規格 vs 檔案的契約分裂** —— R5 才第一次問,一問 4 條,已折。**下一輪應該會歸零**(已寫進 §9)。

## 10.4 我的建議(交給主視窗裁,不是我決定)

- **同意停 codex。** 理由不是「已經夠好」,是 **10.3 第 1 條那一面用【再審一輪】關不掉** ——
  它需要的是換一種驗證形狀,不是更多 finding。(**主視窗 2026-08-18 採用這個字面,取代它原本的「打轉」。**)
- ⛔ ~~下一輪該問「有沒有一個一次問完四種問法的寫法」~~
  🔴 **那一問已經有答案了(見 10.3 第 1 條的更正)** ⇒ **下一輪不該再問它,該做的是【把既有那個做法套進這三支檔】。**
  ⛔⛔ **2026-08-18 第六輪(GR)裁決:這個入口【關掉】,那一片【取消】。**
  GR 開檔量到:**b1b `:784` 已經在用同一款做法** —— 逐字
  `aclexplode(coalesce(c.relacl, acldefault('r', c.relowner)))`,與 pattern 檔 `:283-285` 同款;
  而現行架構**四軸各有專斷言**(表級推導完整集×有效權限 / 欄級 attacl sweep + 具名四種 /
  可達性 `v_reach` + apply 當天 `#8` 查詢 / grantee aclexplode allowlist)。
  🔴 **ADP 那一軸沒有可寫的獨立斷言**(平台 ADP 恆存在,斷言它為空恆紅)⇒ 正解就是「出生後 REVOKE + 驗有效態」,**已經做了**。
  🔴 **role membership 併進同一斷言會抹掉「有效 vs 可達」的區分** —— 而那個區分是 R3-D3 一整條 finding 的內容。
  ⇒ **再動 = 對五輪打硬的檔做零收益重構,而 R4/R5 各出一條 `[折錯]` 已證那是本線最高產的出錯動作。**
  ⚠️ 以下是我原本寫的暫緩理由,**保留不刪**(它當時成立,而現在是「取消」不是「暫緩」):
  ~~本輪不做這件事,理由:GR(換模型)那一輪馬上要審,而**在被審之前再改一次權限斷言
  = 送一份剛動過、沒被任何人看過的東西去被審**,那正是我今天已經踩過兩次的形狀(R4/R5 的 `[折錯]`)。~~
- 🔴 **而在那之前,B1 卡住的其實不是審查輪數,是【人】**:
  `select distinct actor` 沒跑(要 DB access)、schema 一致性沒查(要 DB access)、apply 要 Sean 在場。
  **再審十輪也不會讓那三件變成完成。**
