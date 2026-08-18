# B1 關卡1 第三輪(換角度)· codex findings 逐條裁定

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
| **D3** | `[不確定]` 只驗 `has_table_privilege`,沒驗 `SET ROLE` 路徑 | 🟡 **無法在本機核實**(需要連正式庫查 `pg_auth_members`) | **未折,附待驗查詢** — 我的理由是「Supabase 的切換者是 `authenticator`,`anon` 不是 service_role 的成員」,**而那句是我從架構推的不是查到的** ⇒ 查詢已寫進 `b1b` 該段旁邊,apply 當天貼上去跑;結果出現 `anon`/`authenticated` 當 member ⇒ 停下來回報 |

---

## §3 折完之後還沒做的事(不要讀成「B1 可以 apply 了」)

1. 🔴 **依輪次紀律要跑 R4**:R3 判 FAIL、我折了 14 條 ⇒ **修完要再跑一輪確認**(記憶逐字:R1 FAIL 才 R2;這裡是 R3 FAIL ⇒ R4)。
   ⚠️ **而 R4 要再換一次角度或模型** —— 同模型同角度會在同一框架內找更細的東西。
2. ⛔ ~~**本輪所有折入都是【檔案改動】,沒有一條被實跑過**~~
   🔴 **2026-08-18 當場推翻我自己這句:折完之後全部在拋棄式 PG 17.10 上跑過了,見 §4。**
   **而那一跑抓到我兩個【自己改出來的】錯**(§4 那兩條)—— 所以這一句留著劃掉,不刪:
   **「我折得對不對」與「我折進去的東西跑不跑得起來」是兩件事,而我原本打算只交前者。**
3. `B1-a` 執行前仍要跑 `select distinct actor from public.admin_audit_log;`(`b1-spec.md` §0.5 標的那件,**仍未跑**)。
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
