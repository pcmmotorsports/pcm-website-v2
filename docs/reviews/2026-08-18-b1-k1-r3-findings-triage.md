# B1 關卡1 第三輪 + 第四輪 · codex findings 逐條裁定

> 🔴 **本檔含兩輪**:R3 在 §1-§4、**R4 在 §5-§7**(2026-08-18 同日稍晚)。檔名只寫 r3 是因為它先存在,**不改檔名以免既有指標斷掉**。

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
