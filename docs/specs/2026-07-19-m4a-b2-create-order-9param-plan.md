# B-2 片級 plan — `create_order` 8 參數 → 9 參數(`p_notification_email`)

> **狀態**:待 Sean 批准(鐵則 8:動 schema + 金流 RPC)。**尚未動工、尚未寫 migration 檔。**
> **真權威上位文件**:`docs/specs/2026-07-18-b0-order-notification-email-prd.md`(B-0 PRD v3 §4 B-2 列、§5 R1)。
> **本檔性質**:Claude Code 07-19 視窗撰寫,**不屬 Sean ownership 凍結清單**(該清單的 07-19 spec 是 `2026-07-19-m4a-email-e2a-2-plan.md`,已因方向轉折作廢)。
> **紀律**:本檔所有數字/hash 皆附「可執行取得方式」,不寫死自指狀態;未實測項一律標 ⚠️ 未驗。

---

## 1. 一句話

在**單一 migration、單一顯式交易**內,把建單 RPC 從 8 參數換成 9 參數(第 9 參 `p_notification_email text DEFAULT NULL`),函式體以**動工當下 `pg_get_functiondef` 取得的 prod 版本**為基底逐字沿用(`prosrc` 層僅 1 處 delta、檔面 3 處,分層見 §4.1),並重建 ACL + 完整屬性 + fail-closed 斷言。

> ⚠️ 本行原寫「以**已證明等同 prod 的基底**逐字沿用、只加**三處** delta」——**兩個字面皆已作廢**(權威鏈見 §2.1、delta 分層見 §4.1)。此處是 codex R2 未點名、由**全檔 grep 舊字面清單**自查補上的第三處,同款漏改在本條線已復發 5 次。

---

## 2. 動工前實證(本 session 實跑取得,非引用他檔字面)

全部經 Supabase MCP 對 **production**(`bmpnplmnldofgaohnaok`,PG 17.6.1.111)唯讀查詢,或以「單一 DO block + 結尾無條件 RAISE」交易模擬取得(自動回滾)。**每項附可重跑命令。**

| # | 事實(實測結果) | 重跑方式 |
|---|---|---|
| E1 | prod 只有**一個** `create_order` 簽章,8 參數:`p_lines jsonb, p_address_id uuid, p_shipping_method text, p_invoice jsonb, p_cart_session_id uuid, p_terms_version text, p_client_ip text, p_client_ua text`;`SECURITY DEFINER`、`VOLATILE`、owner=`postgres`、`SET search_path TO ''` | `select p.oid::regprocedure::text, pg_get_function_arguments(p.oid), p.prosecdef from pg_proc p join pg_namespace n on n.oid=p.pronamespace where p.proname='create_order' and n.nspname='public';` |
| E2 | prod ACL = `{postgres=X/postgres,authenticated=X/postgres}`。`has_function_privilege` 實測:authenticated=**true**;anon / service_role / payment_confirmer / authenticator / PUBLIC 皆 **false** | `select proacl::text from pg_proc where oid='public.create_order(jsonb,uuid,text,jsonb,uuid,text,text,text)'::regprocedure;` |
| E3 | 🟢 **prod 函式體與 repo `20260716200000` 檔案逐位元組相同**(PG `prosrc` 為逐字儲存):兩邊 md5 相同、11280 字元 / 12225 octets 相同 → **零漂移** | prod:`select md5(prosrc), length(prosrc), octet_length(prosrc) from pg_proc where oid='public.create_order(jsonb,uuid,text,jsonb,uuid,text,text,text)'::regprocedure;`<br>repo:`python3 -c "import hashlib;s=open('supabase/migrations/20260716200000_m4a_v3a_create_order_vehicle_type_guard.sql',encoding='utf-8').read();i=s.index('AS \$fn\$')+7;j=s.index('\$fn\$',i);b=s[i:j].encode();print(hashlib.md5(b).hexdigest(),len(s[i:j]),len(b))"` |
| E4 | 🔴 **8-param 與 9-param(第 9 參 `DEFAULT NULL`)共存 → 所有 8 引數呼叫直接失敗**,具名與位置**兩種形式皆然**:`ERROR 42725 ... is not unique`。已用**真實 8/9 參數型別簽章**複測(非結構等價物) | 交易模擬:建兩個同名 dummy(8 參 / 9 參含 DEFAULT)→ 以具名與位置各呼叫一次 → RAISE 回滾 |
| E5 | 🔴 **新建函式的預設 ACL 比 PRD 描述更寬**:`{=X/postgres,postgres=X/postgres,anon=X/postgres,authenticated=X/postgres,service_role=X/postgres}` —— 不只 PUBLIC,**anon / service_role 也被自動 GRANT**(Supabase `ALTER DEFAULT PRIVILEGES`)。實測新建函式 `has_function_privilege('anon',…)` = **true** | 同上交易模擬 |
| E6 | 🟢 **ACL 鏡像配方可精確還原 prod 現況**:對新建函式套 `REVOKE ALL … FROM PUBLIC, anon, service_role, payment_confirmer` + `GRANT EXECUTE … TO authenticated` 後,`proacl` 字面**精確等於** E2 的 prod 值(等值比對 = true);四角色矩陣 anon=f / service_role=f / PUBLIC=f / authenticated=t | 同上交易模擬 |
| E7 | `create_order` **無任何依賴物**(`pg_depend` 排除 internal 後回傳空集)→ `DROP FUNCTION` 不會被 RESTRICT 擋、**不需 CASCADE** | `select d.classid::regclass::text, count(*) from pg_depend d where d.refobjid='public.create_order(jsonb,uuid,text,jsonb,uuid,text,text,text)'::regprocedure and d.deptype<>'i' group by 1;` |
| E8 | 上述所有交易模擬**零留痕**:臨時函式殘留 0、`create_order` 仍為 1 個、其 `prosrc` md5 未變 | 見 E3 / E1 命令 |
| E9 | prod migration 水位最新 = `20260718120000`(B-1);`20260716180000/190000/200000` 皆已 apply | `select version from supabase_migrations.schema_migrations order by version desc limit 4;` |
| E10 | 🟢 **PostgREST schema cache 會自動重載**:`pgrst_ddl_watch`(`ddl_command_end`)與 `pgrst_drop_watch`(`sql_drop`)兩個 event trigger 皆存在且 `evtenabled='O'`;讀其 `prosrc` 確認 command_tag 白名單含 `CREATE FUNCTION` 與 `COMMENT`、dropped object 型別含 `function`,兩者皆執行 `NOTIFY pgrst, 'reload schema'` | `select evtname, evtevent, evtenabled from pg_event_trigger;` + `select prosrc from pg_proc where proname in ('pgrst_ddl_watch','pgrst_drop_watch');` |
| E12 | **巢狀 `BEGIN` 不是錯誤**:對 prod 送 `BEGIN; BEGIN; SELECT …; ROLLBACK;`,語句正常執行並回傳(PG 對已在交易中再下 `BEGIN` 發 WARNING、非 ERROR)→ 見 §3 要求④ 的雙假設論證 | `BEGIN; BEGIN; SELECT 'probe'; ROLLBACK;` |
| E11 | **完整 catalog snapshot**(codex R1 #2 要求;**DROP+CREATE 後全部消失、必須逐項重建;`md5(prosrc)` 一項都看不到**):<br>`prosecdef=true` / `provolatile=v` / `proparallel=u` / `proisstrict=false` / `proleakproof=false` / `proretset=false` / `procost=100` / `prorows=0` / `prosupport='-'` / `pronargs=8` / **`pronargdefaults=0`** / `rettype=jsonb` / `lanname=plpgsql` / `proconfig={"search_path=\"\""}`(**整個陣列**,非「含」)/ `owner=postgres` / `acl={postgres=X/postgres,authenticated=X/postgres}` / **`COMMENT` md5=`7aec7ae7dbf52af683586a360ccde641`、長度 584** / `seclabel_count=0` / `shseclabel_count=0` / `prosrc md5=a60944edb678064c468ba517391cc311` | `select p.prosecdef,p.provolatile,p.proparallel,p.proisstrict,p.proleakproof,p.proretset,p.procost,p.prorows,p.prosupport::text,p.pronargs,p.pronargdefaults,p.prorettype::regtype::text,l.lanname,p.proconfig::text,pg_get_userbyid(p.proowner),p.proacl::text,md5(obj_description(p.oid,'pg_proc')),length(obj_description(p.oid,'pg_proc')),(select count(*) from pg_seclabel s where s.objoid=p.oid),(select count(*) from pg_shseclabel s where s.objoid=p.oid),md5(p.prosrc) from pg_proc p join pg_language l on l.oid=p.prolang where p.oid='public.create_order(jsonb,uuid,text,jsonb,uuid,text,text,text)'::regprocedure;` |

### 2.1 E3 / E4 / E5 的意義(為什麼這三條改變做法)

- **E3 的正確用法(codex R1 #6 更正,原字面已作廢)**:
  ❌ **原本我寫**「E3 推翻了 PRD 的擔憂前提 → 可以用 repo 檔當基底」。**這是下位文件改寫上位真權威**,等於讓一次 md5 快照架空 PRD 的程序性防線;同樣話術日後可用來繞過任何一條 PRD 要求。**撤回。**
  ✅ **改為**:編輯基底 = **動工當下重取的 `pg_get_functiondef` 輸出**(PRD 原文要求,不放寬);repo `20260716200000` 只作**第二份對照證據**。兩者 byte-equal 時工作量幾乎不變,但權威鏈不被繞過。
  ⚠️ 且 E3 只證明「**取樣當下**沒有 body drift」,不保證動工當下仍然如此 → 動工前**重取一次**並重新比對 md5。
  🔴 **md5(prosrc) 能證明與不能證明什麼(誠實界定)**:它只證明**函式本體字串**相同,**不涵蓋**簽章、參數預設值、回傳型別、語言、`SECURITY DEFINER`、`proconfig`(`search_path`)、owner、volatility、`COMMENT`、seclabel。這些屬性在 `DROP` 後全數消失、必須由新 `CREATE` 顯式重建 → 見 E11 清單與 §4 段 7 斷言。
  🔴 **owner 是隱形地雷**:函式是 `SECURITY DEFINER`,執行身分 = **owner**。若 `db push` 的連線角色不是 `postgres`,新建函式的 owner 會變成該角色 → 執行權限語意默默改變(md5 完全看不出來)。故斷言必含 `pg_get_userbyid(proowner)='postgres'`。
- **E4 把「順序」從偏好變成硬約束**:共存窗口內結帳**必炸**(不是變慢、不是走舊版)→ 只能 `DROP` 先、`CREATE` 後,且**必須原子**,否則中間窗口任一形態都會失敗。
- **E5 把 ACL 重建從「補 PUBLIC」升級成「補 PUBLIC + anon + service_role」**:若只照 PG 原生預設思維寫 `REVOKE … FROM PUBLIC`,**anon(未登入者)會保有 EXECUTE**。E6 已證明既有配方(含 anon/service_role/payment_confirmer)可精確還原,照抄即可。

---

## 3. 四項硬性要求的落地方式

| 要求(交接檔 §4) | 落地 | 證據 |
|---|---|---|
| ① 同 migration `DROP` 舊 8-param + `CREATE` 9-param | 順序固定 **DROP → CREATE**,包在同一顯式交易內 | E4 |
| ② ACL 鏡像重建 + `has_function_privilege` fail-closed 斷言 | 沿用 `20260716200000:316-317` 字面(`REVOKE ALL … FROM PUBLIC, anon, service_role, payment_confirmer` + `GRANT … TO authenticated`),並在檔尾 DO block 斷言**六角色矩陣**(authenticated=true;anon / service_role / payment_confirmer / authenticator / PUBLIC 皆 false),任一不符 `RAISE` | E5 / E6 |
| ③ 函式體以 prod 當下最新版為基底、逐行 diff | 基底 = **動工當下重取的 `pg_get_functiondef` 輸出**(照 PRD 原文,**不以 repo 檔代替**);repo `20260716200000` 僅作第二份對照(E3 已證 byte-equal)。實作後重取並產 diff | E3 + §2.1 更正 |
| ④ 鎖保護另尋機制(`SET LOCAL` 在無交易時是 no-op) | **檔內自帶顯式 `BEGIN;` … `COMMIT;`**,`SET LOCAL lock_timeout='3s'` 置於 `BEGIN` 之後 → 既取得鎖保護,**又同時保證 ①的原子性** | repo 前例:`20260717020000_m4a_email_outbox.sql:289 BEGIN;` / `:294 SET LOCAL lock_timeout='3s'` / `:489 COMMIT;`,已 apply 上 prod;反例:`20260718120000:62` 明文「刻意無顯式 BEGIN/COMMIT」→ 其 `SET LOCAL` 在 db push 實測為 no-op(`WARNING 25P01`) |

🔴 **要求④ 的解法同時解掉要求① 的原子性缺口** —— 這是本 plan 相對交接檔的關鍵補強:交接檔說「同一 migration 內 DROP+CREATE」,但 B-1 的 `25P01` 實測證明 migration **預設不在顯式交易內**,所以「同一檔」不等於「同一交易」。加顯式 `BEGIN/COMMIT` 才真的原子。

### 3.1 顯式 `BEGIN/COMMIT` 的雙假設論證(誠實界定證據強度)

⚠️ **我沒有、也無法自己實跑 `supabase db push`**(該命令由 Sean 執行)→ 「CLI 到底有沒有自帶交易」對我是**未驗**。
「20260717020000 已上 prod」只證明 **CLI 容忍**檔內顯式 `BEGIN/COMMIT`,**不足以**證明 CLI 的交易模型。
故本設計刻意做成**兩種假設下都安全**:

| 假設 | `SET LOCAL` | `BEGIN` | 我們的 `COMMIT` | DROP+CREATE 原子? |
|---|---|---|---|---|
| **A. CLI 無自帶交易**(B-1 的 `WARNING 25P01` 支持此假設) | 在我們的 `BEGIN` 之後 → **生效** | 正常開啟交易 | 正常提交 | ✅ 原子 |
| **B. CLI 自帶交易** | 已在交易內 → **生效** | 只發 WARNING、**不報錯**(**E12 已實測**) | 提交至此為止的整批 | ✅ 原子 |

🔴 **上表不足以宣告「兩假設都安全」——codex R1 #3 擊破,以下為更正後的誠實版本:**

我原本的論證是「`COMMIT` 是**檔案**最後一句 → 其後無語句裸奔」。**這個前提是錯的**:`COMMIT` 是檔案最後一句,**但不是 CLI 最後一句** —— CLI 在套完檔案後還要寫 `supabase_migrations.schema_migrations` 歷史表。
→ 在假設 B(CLI 自帶交易)下,我的 `COMMIT` 會**提早提交 CLI 的外層交易**,使歷史表寫入落到**另一筆交易**。若該寫入失敗,就留下 **「schema 已改、歷史未記」的裂縫**。
→ 且 E12 只證明「巢狀 `BEGIN` 不報錯」,**沒有證明原子性**;`20260717020000` 成功 apply 也只是**一個成功案例**,不是交易模型的證明。

**降險措施(本 plan 採用,不需額外實驗)**:`DROP FUNCTION` 全部改用 **`IF EXISTS`**,且**同時涵蓋 8-param 與 9-param 兩個簽章** → 整支 migration 變成**可重跑**。如此即使發生「schema 已改、歷史未記」,下一次 `db push` 重跑本檔**不會炸**(舊簽章不存在時 `IF EXISTS` 略過、新簽章先 DROP 再 CREATE),裂縫可靠重跑收斂。
⚠️ 這降低了裂縫的**後果**,但**沒有消除**裂縫本身 → 殘餘風險見 §7 決策題 **Q3**,由 Sean 拍板,**我不自行宣告可接受**。

---

## 4. 要改什麼(精確清單)

**新增 1 檔**:`supabase/migrations/20260719120000_m4a_b2_create_order_notification_email.sql`

結構(依 repo 慣例):
```
段 0  檔頭註解:目的 / 鐵則觸發 / 上位文件 / 驗收清單 / rollback 步驟
段 1  BEGIN;
段 2  SET LOCAL lock_timeout = '3s';
段 2.5 🔴🔴 **apply-time 基線守門 DO block**(codex R2 新 BLOCKER-1;**必須在任何 DROP 之前**)
      問題:`DROP IF EXISTS` 讓 migration 願意輾過**任何**現況,包含「別人後來改過的較新版本」
            → 會把較新的 create_order **靜默覆寫回本檔內的舊基底**。這是我為了「可重跑」
            加 IF EXISTS 時引入的新風險(降險措施本身帶來的代價)。
      守門:斷言當下狀態**必為下列兩者之一**,否則 RAISE 中止整個交易:
        狀態 A(首次 apply):存在 8-param 且**完整指紋** == 基線指紋,且不存在 9-param
        狀態 B(裂縫後重跑):存在 9-param 且**完整指紋** == 預期產出指紋,且不存在 8-param
      其他任何狀態(指紋不符 / 兩者並存 / 兩者皆無)→ **一律 RAISE 停下**,交 Sean 判斷,
      **不得**用 IF EXISTS 強行覆寫未知版本。

      🔴 **「完整指紋」定義(codex R3 BLOCKER-1 更正 —— 原本只用 `md5(prosrc)` 不足)**:
        原設計只比對 body md5 → **body 相同但屬性被改過的未知版本仍會被覆寫**
        (plan 自己在 §2.1 就說過 md5(prosrc) 看不到 owner / ACL / SECURITY DEFINER /
         search_path / default / COMMENT)。自相矛盾,已修正。
        指紋 = 下列全部串接後取 md5:
          `prosrc` + `pg_get_function_arguments` + `pg_get_expr(proargdefaults,0)` +
          `prosecdef` + `proconfig::text` + `proacl::text` + `pg_get_userbyid(proowner)` +
          `prorettype` + `lanname` + `provolatile` + `proparallel` + `proisstrict` +
          `proleakproof` + `procost` + `prorows` + `obj_description(oid,'pg_proc')`
        (= E11 全欄位,任一被動過指紋就變)

      ⚠️ **殘餘:守門與 DROP 之間的競態窗口(codex R3 指出,誠實揭示、未消除)**
        讀 catalog 與執行 DROP 之間,理論上可有另一個 session 改動同一函式 → 守門不會重驗。
        · **緩解**:交易開頭取 `pg_advisory_xact_lock(<本 migration 專用 key>)`,
          令**同樣遵守此約定**的 migration 互斥。
        · **未消除的部分**:不遵守該約定的外部 DDL session 仍可能插入。
        · **本專案的實際暴露面**:所有 schema 變更均經 `supabase db push`、由 Sean **單人序列**執行,
          無第二個 DDL 行為者 → 此競態需要一個現行作業模式中**不存在**的並行 DDL session。
        🔴 這是**有界假設、不是已消除的風險**;若日後出現第二個 schema 變更管道(CI 自動 migration、
          其他人有 DB 權限),本假設即失效、須重新評估。**不自行宣告可接受**,列入 §13 交 Sean。

      ⚠️ 基線指紋非自指:於動工當下取得後寫入本 migration(先後順序見 §10 第 2 步)。

段 3  DROP FUNCTION IF EXISTS public.create_order(jsonb,uuid,text,jsonb,uuid,text,text,text);       ← 舊 8-param
      DROP FUNCTION IF EXISTS public.create_order(jsonb,uuid,text,jsonb,uuid,text,text,text,text);  ← 新 9-param
      🔴 IF EXISTS 只負責「可重跑」,**正確性由段 2.5 的守門保證**(單靠 IF EXISTS 不安全)
段 4  CREATE FUNCTION public.create_order(...9 參...) ...
      ← 基底 = 動工當下 pg_get_functiondef 輸出(§2.1 更正);顯式重建 E11 全屬性:
        RETURNS jsonb / LANGUAGE plpgsql / SECURITY DEFINER / SET search_path = '' /
        VOLATILE / PARALLEL UNSAFE / COST 100(即使與預設同值也顯式寫出,避免預設值日後改變)
段 5  REVOKE ALL ON FUNCTION public.create_order(9 參簽章) FROM PUBLIC, anon, service_role, payment_confirmer;
      GRANT EXECUTE ON FUNCTION public.create_order(9 參簽章) TO authenticated;
      ALTER FUNCTION public.create_order(9 參簽章) OWNER TO postgres;  ← 🔴 SECURITY DEFINER 執行身分
段 6  COMMENT ON FUNCTION（9-param 描述;內容 = 舊 COMMENT + 第 9 參說明）
段 6.5 NOTIFY pgrst, 'reload schema';   ← 🔴 codex R1 #1:不只依賴 event trigger,顯式再送一次
段 7  DO $$ … $$;  fail-closed 斷言(任一不符即 RAISE):
      ① create_order 簽章數 = 1 且為 9 參(型別逐一比對)
      ② 舊 8-param 簽章不存在
      ③ 六角色 ACL 矩陣:authenticated=true;anon / service_role / payment_confirmer / authenticator / PUBLIC 皆 false
      ④ proacl 字面精確等於 E2 的 prod 值
      ⑤ 🔴 E11 全屬性逐項精確相等(codex R1 #2;非「含」、非抽樣):
         prosecdef / provolatile / proparallel / proisstrict / proleakproof / proretset /
         procost / prorows / prosupport / rettype / lanname / owner /
         proconfig **整個陣列**相等 / seclabel_count=0 / shseclabel_count=0
      ⑥ COMMENT 已重建且為實質內容:**非 NULL + 長度 ≥ 400**
         🔴 **刻意不驗 md5**(較原字面收斂,理由明列):COMMENT 就寫在同一 migration 上方 3 個語句處,
         把它的 md5 寫死 = **自指字面**,改一個字就得同步改 md5 —— 正是本專案反覆踩過的坑。
         逐字內容改由 §6 路徑② 對照 snapshot 覆核。(code-reviewer R1 #3 要求「不接受沉默落差」→ 本行即為明示落差說明)
      ⑦ 🔴 第 9 參契約 —— **精確等值,禁用 substring**(codex R3 #2:`包含 'DEFAULT NULL'` 會被
         `DEFAULT NULLIF(...)` 之類騙過;`pronargdefaults=1` 只證明數量不證明內容):
         · `pronargs=9` 且 `pronargdefaults=1`
         · `proargnames` **整個陣列**等於預期 9 個名稱
         · 🔴 `pg_get_function_arguments(oid)` **精確等於**(非包含):
           `p_lines jsonb, p_address_id uuid, p_shipping_method text, p_invoice jsonb, p_cart_session_id uuid, p_terms_version text, p_client_ip text, p_client_ua text, p_notification_email text DEFAULT NULL::text`
         · 🔴 `pg_get_expr(proargdefaults, 0)` **精確等於** `NULL::text`
         ⚠️ **實測校正**:PG 把 `DEFAULT NULL` 正規化呈現為 **`NULL::text`**(不是裸 `NULL`)。
            若照直覺寫 `DEFAULT NULL` 當預期字串,斷言會**當場失敗**。
            取得方式:建臨時函式 `(p_b text DEFAULT NULL)` 後讀 `pg_get_function_arguments` 與
            `pg_get_expr(proargdefaults,0)`(本 plan 已於交易模擬中實跑取得,全程回滾)。
         · 前 8 參型別與名稱由上列精確等值一併涵蓋(防順序錯置)
段 8  COMMIT;
```

### 4.1 delta 清單 —— 🔴 **必須分層計數**(codex R1 #7 更正)

⚠️ **原字面「函式體 delta 三處」是錯的**:簽章與 `COMMENT` **都不在 `prosrc` 裡**(`prosrc` 只含 `$fn$…$fn$` 之間的本體)。混為一談會讓 §6 的 diff 驗收拿錯期望值。正確分層:

| 層 | delta 數 | 內容 |
|---|---|---|
| **`prosrc`(函式本體)** | **1 處** | 只有 `INSERT INTO public.orders` 的欄位清單 + `VALUES`(加 `notification_email` / `p_notification_email`) |
| **migration 檔面** | 3 處 | 上述 1 處 + 簽章加第 9 參 + `COMMENT` 改寫 |

→ §6 的 `prosrc` diff **期望值 = 1 處**,不是 3 處。

以下為檔面三處明細:

1. **簽章**:末尾加 `p_notification_email text DEFAULT NULL`(PRD §4 B-2:第 9 參 `DEFAULT NULL` 供過渡;**B-2 不得移除 DEFAULT**,移除是 B-6 的職責)
2. **`INSERT INTO public.orders`**:欄位清單加 `notification_email`、`VALUES` 對應加 `p_notification_email`
3. **`COMMENT ON FUNCTION`**:8-param → 9-param 描述

**不改**:vehicle 白名單重組 / vehicle type guard(year cast 分離)/ 法律同意 guard + `order_legal_consents` 原子寫入 / cart_session_id fail-closed / 重複 variant 防撞 / `price_store|price_by_tier|cost` 敏感鍵防護 / 溢位檢查 / 運費 CASE(5000→0 / 100)/ 產號 / return DTO。
→ **證明方式**:實作後對新舊 `prosrc` 做 diff,**期望值 = 上表的 1 處**(其餘 0);另對檔面做人工覆核確認三處。

### 4.2 明確**不動**的東西(避免範圍蔓延)

- **不碰 TS 任何檔**(見 §7 決策題 Q2)。B-2 apply 後 TS 仍送 8 個具名參數,第 9 參吃 `DEFAULT NULL` → 結帳行為不變。
- **不在 RPC 內寫 outbox / 寄信邏輯**(memory `project_m4a-email-trigger-no-money-rpc`:Sean 拍板寄信走 app 層、不碰金流 RPC、不用 orders trigger)。
- **不改 B-1 的 CHECK**、不動 `orders` 表結構。
- **不做 backfill**、**不動任何既有訂單**。
  ⚠️ 原字面寫死「30 筆」已移除(code-reviewer R2 Minor):該數字隨時會變,且 §6-B 第 10 項自己就規定零留痕要用 before/after snapshot、不得寫死 —— 同一份文件內不可雙標。

---

## 5. 預期影響面

| 面向 | 影響 | 判斷 |
|---|---|---|
| 結帳行為 | **不變**。**現行 TS 呼叫端**送 8 參 → 第 9 參吃 `DEFAULT NULL` → 該欄為 NULL(B-1 CHECK 允許 NULL)。<br>⚠️ **不得寫成「`notification_email` 恆 NULL」**(codex R1 #7):`authenticated` 角色可直呼 RPC 並自帶合法第 9 參 → 正確說法是「**經現行 app 路徑**建立的單為 NULL」 | 低風險 |
| apply 窗口 | 顯式交易內完成,外部連線看到的是「舊版」或「新版」,無中間態。<br>🔴 **鎖語意精確版**(codex R1 #4 更正):`DROP FUNCTION` 取的是**該函式 database object 的 `AccessExclusiveLock`**,**不是** `orders` 表的鎖;一般正在執行的函式呼叫**通常不持有相衝突的物件鎖**、會繼續跑既有定義。真正會擋的是**同函式的並行 DDL / catalog 操作**。<br>→ 故「近三週零訂單」**不能**直接推論「不會等鎖」,只能說降低了實務風險。<br>`lock_timeout='3s'` 是**每次搶鎖的 fail-fast 上限**,不是「一定足夠」 | 低風險(理由已更正) |
| 逾時處置(寫死、不臨場判斷) | 觸發 `55P03 lock_not_available` → **立即停、回報 Sean**;**不盲目 retry、不調大 timeout**。先查阻擋來源(`pg_locks` 對該函式 oid + `pg_stat_activity` 找並行 DDL),由 Sean 決定改時段或改路徑 | codex R1 #4 |
| PostgREST schema cache | DROP+CREATE 會讓 PostgREST 的函式快取過期。**已驗有自動重載**(E10):`pgrst_drop_watch` / `pgrst_ddl_watch` 各在 DROP 與 CREATE 時 `NOTIFY pgrst, 'reload schema'`。且 **NOTIFY 在 COMMIT 才送達** → 顯式交易正好讓快取在新函式可見**之後**才重載,順序天然正確。⚠️ 快取重載為非同步,理論上有極短窗口;但該窗口內舊 8-param 已不存在、9-param 唯一,8 個具名引數的呼叫仍可由 PG 正常解析(第 9 參吃 DEFAULT)→ 不構成中斷 | 低風險(已驗機制存在,窗口行為屬推論、標 ⚠️ 未實測) |
| prod 流量 | 🟢 **實測**(非引用 STATUS 字面):`orders` 共 30 筆,最早 `2026-06-17`、**最後一筆 `2026-06-27`**、**近 7 天 0 筆**、`notification_email` 非 NULL 者 0 筆 → `create_order` 已逾三週零呼叫,apply 窗口實質無流量。<br>3DS flag 名稱 = `TAPPAY_3DS_ENABLED`(`apps/storefront/src/lib/payment/three-ds-flag.test.ts:8`),其值在 Vercel env、我無權讀 → **flag 現值標未驗**,但流量實測已足以支撐低風險判斷 | 低風險(實測) |
| `shipping-rpc-drift.test.ts` | 已讀該測實作(`:23-32`):檔名升冪排序後**由後往前**找第一個匹配 `/v_subtotal\s*>=\s*(\d+)\s*THEN\s*0\s*ELSE\s*(\d+)\s*END/` 的檔 → 我的新檔時戳最大,**必然被選中**,斷言其值 == `FREE_SHIPPING_THRESHOLD`/`HOME_SHIPPING_FEE`。因函式體整段逐字複製、運費 CASE 原字面保留(5000/100)→ 應續綠。<br>⚠️ 附帶約束:`String.match` 取**首個**匹配 → 新檔的**檔頭註解與 rollback 段不得**出現另一組不同數值的運費 CASE 字面。<br>**仍須實跑確認,不以靜態分析代替** | 已分析,待實跑 |
| `database.types.ts` | 若不同步 → 型別層停留 8 鍵(非破壞性漂移) | 決策題 Q2 |
| `order.test.ts` / `SupabaseOrderAdapter.test.ts` | 兩處**硬編碼 8 鍵字面斷言**(`order.test.ts:38-47` sorted 陣列、`SupabaseOrderAdapter.test.ts:55-64` mock 呼叫斷言)。B-2 不動 TS → 這兩處**應維持綠**;B-3/B-4 動 TS 時**必同步**,否則綠燈是假的 | 已登記,見 §8 |
| 權限面 | ACL 由 E6 配方精確還原;斷言 fail-closed | 低風險 |

---

## 6. 驗收(三綠 + prod 交易模擬)

**A. 三綠**:`pnpm typecheck` / `pnpm lint`(本片純 `.sql`,build N/A)。
🔴 **一律讀輸出內容判定,不看 exit code、不接 `| tail`**(交接檔 §6-① 教訓)。

**B. prod 驗證 —— 🔴 分兩條路徑跑,不可用「外包一層 BEGIN…ROLLBACK 套整個 migration 檔」**

> **為什麼**(repo 既有明文教訓,E1a 片踩過):本檔 migration **自帶 `BEGIN;`/`COMMIT;`** → 外面再包一層交易模擬時,**檔內的 `COMMIT` 會先真的提交**,最後的 `ROLLBACK` 退不掉 → **prod 留痕**(= 未經批准的正式 schema 變更)。
> 出處:`docs/specs/2026-07-16-m4a-email-notify-plan.md:320,382`、`docs/handoff/2026-07-17-m4a-email-e1a-handoff.md:40`。
> ⚠️ 我的初版 §6-B 正是這個已作廢寫法,由關卡 1 對抗審查逼出、已更正。

**路徑①(apply 前,我跑)**:模擬腳本 = migration 檔內容**手動剔除 `BEGIN;` / `COMMIT;` 兩行**(**保留** `SET LOCAL lock_timeout`,因外層模擬交易會提供交易上下文),外層自包 `BEGIN; … ROLLBACK;`(或單一 DO block + 結尾無條件 `RAISE`)。
⚠️ **已知落差(誠實揭示)**:路徑① 驗的是「剔除交易控制後的檔案」,**不是檔案原文**;`BEGIN`/`COMMIT` 兩行本身的行為只能在 apply 當下由 CLI 實際輸出覆核(見 §3.1 雙假設表)。

**路徑②(apply 後,Sean `db push` 完我跑)**:對真實套用結果重跑同一組斷言(此時 DDL 已是既成事實,只有**資料面**需零留痕)。

兩條路徑共用的斷言矩陣:
1. DDL 套用成功;`create_order` 簽章數 = 1,且為 9 參
2. 舊 8-param 簽章**不存在**
3. 六角色 ACL 矩陣符合 E2/E6(authenticated=t,其餘 f)
4. **E11 全屬性逐項未退化 —— 精確等值,非「含」**(code-reviewer R2 指出原字面弱於 §4 段 7 ⑤):
   `prosecdef=true` / `proconfig` **整陣列** == `{"search_path=\"\""}` / **`owner=postgres`** / `rettype=jsonb` / `lanname=plpgsql` / `provolatile=v` / `proparallel=u` / `proisstrict=false` / `proleakproof=false` / `procost=100` / `prorows=0` / `proretset=false` / `prosupport='-'` / `pronargs=9` / `pronargdefaults=1`
   🔴 **COMMENT 逐字覆核**(這是「刻意不驗 md5」的**代償控制**,原字面只寫「非空」= 代償控制實際不存在):
   取 `obj_description(oid,'pg_proc')` 與 **migration 檔內 `COMMENT ON FUNCTION` 語句的字面**逐字比對。
   ⚠️ **不是**對照 snapshot —— snapshot 凍的是 **8-param 的舊 COMMENT**,與本片的 9-param 版本本就不同,拿它對照必然不符。
5. **函式體 diff**:對照**動工當下重取的** `pg_get_functiondef` 基底,`prosrc` 層 delta **期望 = 1 處**(§4.1 分層表;附 md5 前後值)
6. **真建單**(交接檔 §7 列為 B-1 未驗、併入本片):以合法 email 建一筆單 → 驗 `orders.notification_email` 值正確、`order_items` / `order_legal_consents` 皆如舊
7. **省略第 9 參建單**(模擬 B-3 前的過渡態)→ 應成功且該欄為 NULL
8. **不合規 email 建單**(合成域 / 超長 / NBSP)→ 行為需符合 Q1 拍板結果
9. **PostgREST 端 smoke**(路徑② 專屬;🔴 **codex R2 新 BLOCKER-2 重新設計,原版作廢**)
   ❌ **原版問題兩個**:①只送 8 參數 → **分不出**「快取已更新」與「快取仍是舊 8-param metadata」,因為兩種情況都會成功 ②若用合法 fixture 真建單,**HTTP 呼叫會自行提交**、沒有回滾機制 → 與零留痕直接衝突。
   ✅ **新設計 —— 用「保證在任何寫入之前失敗」的呼叫,取得可診斷且零寫入的證據**:
   - **9-a(證明新簽章可達)**:經 PostgREST 以 `authenticated` 送**9 參數**(含 `p_notification_email`),但故意讓 `p_cart_session_id = null`。
     函式第 0 步就 `RAISE '缺 cart_session_id'`(在 `nextval()` 與所有 INSERT **之前**)→
     **期望**:收到該 RAISE 訊息(證明 PostgREST 已解析到 **9 參簽章**且進入函式體 = 快取已重載);
     **不可接受**:`PGRST202` / `404`(快取沒重載)。**零寫入、零留痕。**
   - **9-b(證明舊呼叫形態相容)**:同樣手法送**8 參數** + `p_cart_session_id = null` →
     期望同樣收到該 RAISE(證明現行 TS 呼叫端在 B-3 之前不會斷)、且**不是** `42725`。**零寫入。**
   🔴 直接 SQL 呼叫**證明不了** PostgREST 的行為,故此步不可用 MCP 代替。
   ⚠️ 若 9-a 回 `PGRST202` → 依 §4 段 6.5 已送 `NOTIFY`,先等待/重送 reload 再驗;仍失敗 = 停下回報,不硬推。
10. **零留痕**(兩路徑期望值不同,不可混用;🔴 一律用 **before/after snapshot 比對**,不寫死「30 筆」——該數字隨時可能變):
   - 路徑①:回滾後 `create_order` **仍為 8 參**、`prosrc` md5 == 動工當下基底值、無臨時物、`orders` count == 跑測前 count
   - 路徑②:DDL 為既成事實(9 參),只驗**資料面** —— `orders` count 回到跑測前值、無測試殘留列

**🔴 真建單模擬的兩個已知技術限制**(先查清楚,避免驗收承諾落空):
- `create_order` 以 `(select auth.uid())` 取身分,NULL 直接 `RAISE '未登入'` → 模擬須先
  `SET LOCAL request.jwt.claims = '{"sub":"<既有 customer 的 user_id>","role":"authenticated"}'`(既有做法:`docs/specs/2026-06-04-m3-s2-orders-migration-plan.md:148`、`20260612150000:36`)。
- ⚠️ **不可**再加 `SET LOCAL ROLE authenticated`:memory `reference_pooled-mcp-set-role-secdef-terminates` 記載 pooled MCP 下「SET ROLE → 呼 SECURITY DEFINER」**必斷線**。改以 owner(`postgres`)身分直呼 + `has_function_privilege` 矩陣做權限等價論證。
- fixture 用**既有** customer / address / variant(僅 SELECT 取 id),寫入部分靠交易回滾;**不列印任何金額值**(只驗欄位存在與 NULL/非 NULL)。

**C. 順手補做**(交接檔 §7 未驗項,與本片天然相關,成本低):`orders` 表級 ACL 套檔前後逐項比對。

**D. 審查**:code-reviewer(一輪制)+ **鐵則 12 Codex Review Packet**(命中:動 schema / 金流 RPC / migration)→ commit 前產、提醒 Sean 貼 Codex、**不 push**。

---

## 7. 決策題 — ✅ **Sean 2026-07-19 已拍:Q1=A / Q2=A / Q3=A**

> Sean 以單字母 `a` 回覆三題,Claude 當場明示解讀為「三題皆 A」並告知可更正。拍板已落 memory `project_m4a-b2-create-order-9param-decisions`。
>
> **Q1=A** 不合規 email 裸傳、由 B-1 CHECK 擋 → RPC 內**不得**加 trim / 正規化 / 第二套驗證(理由改述為「**不新增第三份規則**」,採 codex R1 #5 用詞)。已知副作用:CHECK 擋下時整筆回滾,但 `nextval()` 不歸還 → **顯示編號跳號**(非幽靈訂單)。
> **Q2=A** `database.types.ts` 留 B-4 補;B-2 commit body 與 STATUS **須明寫**「刻意未同步」。
> **Q3=A** 檔內自帶 `BEGIN/COMMIT` + 兩簽章 `DROP ... IF EXISTS`(可重跑)。**不做**選項 C 的 disposable DB 實驗。
> 🔴 **殘餘風險狀態(誠實)**:§3.1 的「schema 已改、套用紀錄未寫」裂縫**未被消除、也未被證明不存在**;靠「可重跑」兜底收斂。日後若被問「B-2 的原子性驗過嗎」→ 誠實答案是**沒有**。

### Q5(R3 後新增,待 Sean 拍 —— 殘餘風險我不自行接受)

```
Q5:守門檢查與拆函式之間有個極短的競態窗口,要怎麼處理?
    背景:我加了「動手前先確認資料庫現況是預期版本」的守門。但「檢查完」到「真的拆掉」
          之間有極短間隔,理論上若剛好有另一個人/程式在這瞬間改了同一個函式,
          守門不會重驗,還是會覆寫掉他的改動。
    現況事實:這個專案所有 schema 變更都走 db push、由你一個人依序執行,沒有第二個改 DB 的
          管道,所以這個情境在目前作業模式下不存在。
A. 記錄成「有界假設」,照現況動工(推薦)
   好處:不增加成本;假設寫進 plan,日後若多了第二個改 DB 的管道(CI 自動 migration、
         其他人拿到 DB 權限),就知道要回來重新評估。
   代價:這是「靠作業模式擋住」而不是「技術上消滅」。
B. 加一道互斥鎖(advisory lock)再動工
   好處:讓所有遵守同一約定的 migration 互斥,多一層保險。
   代價:對「不遵守約定的外部程式」仍然無效,擋不住真正的外來者;而且目前沒有那種東西。
C. 你認為以後會有第二個改 DB 的管道 → 我重新設計守門
   好處:提前為未來的 CI 自動化鋪路。
   代價:B-2 順延,而且是為還不存在的情境付成本。

A: A|B|C
```

### Q4(R2 後新增,✅ Sean 已拍 = B,破例加開 R3;結果見 §14)

```
Q4:codex 複審(第二輪)判 FAIL,但問題都已修完。plan 層審查輪數上限 2 輪已用完,接下來怎麼走?
    背景:第一輪 6 個必修,第二輪變成 3 條確認過關、4 條「修得不夠完整」、2 個新問題。
          我已經把這 6 條全部修完了。設計主體兩輪都沒被推翻,被打的都是
          「驗收方式不夠嚴謹」和「有個地方會誤覆寫別人的改動」——都已補上守門。
          規則規定我不能自己開第三輪,所以交你決定。
A. 直接動工寫 migration,不再審 plan(推薦)
   好處:plan 層該收斂的已收斂;動手後還有兩道關(code-reviewer 審 diff + 鐵則 12 的
         Codex Packet 在 commit 前),實作錯誤會在那兩關被抓。
   代價:plan 本身沒有拿到一次乾淨的 PASS。
B. 破例再開第三輪 codex 複審,確認這輪修完的東西
   好處:拿到明確 PASS 才動工,心裡踏實。
   代價:違反自己訂的輪數上限;以往經驗第三輪多半只擠出 nit,成本不低。
C. 停下來,你先自己看過 plan 再決定
   好處:你親自把關方向。
   代價:plan 有 400 多行、技術密度高,看起來會很累。

A: A|B|C
```

以下保留原始選項全文供日後追溯:

```
Q1(行為題,影響客人):create_order 收到「不合規」的 notification_email 時該怎麼辦?
    背景:B-1 已在 DB 加了六條件 CHECK(擋合成域/超長/非可列印 ASCII/格式錯)。
          PRD 已把「app 層鏡像同一套規則」列為 B-3 硬性驗收條件,正常情況不會走到這裡。
          這題問的是「萬一 app 層漏了、髒值真的送到 DB」時的行為。
A. 裸傳,由 B-1 的 CHECK 擋 → 該筆結帳失敗(推薦)
   好處:規則只有一份(DB),不會兩套漂移;漏洞會大聲炸出來、不會靜默。
   代價:若 B-3 真的漏做,客人看到的是不友善的錯誤而非欄位提示。
B. RPC 內偵測到不合規就靜默存 NULL → 訂單照樣成立、但這筆沒有通知信箱
   好處:客人永遠結得了帳。
   代價:回到「通知孤兒」——正是這整條線要消滅的東西,且靜默無聲。
C. RPC 內自帶一套驗證,不合規就 RAISE 一個友善訊息
   好處:錯誤訊息好看。
   代價:同一套規則寫兩份(SQL 一份、app 一份),本 repo 最常復發的錯就是這種雙份漂移。

A: A|B|C
```

```
Q3(codex R1 #3/#7 逼出;殘餘風險我不自行接受,依規則交你拍):
    這份 migration 要用什麼方式套上 production?
    背景:我們發現 supabase 的 db push 到底有沒有「自己包一層交易」,是個沒人實測過的未知數。
          這會影響「拆舊函式 + 建新函式」是不是真的一次到位、不留中間狀態。
          補充事實:production 近三週 0 筆訂單,而且我會把 migration 寫成可以重跑的
          (萬一半途出事,下次再跑一次就會自動收斂)。
A. 檔案自帶交易(BEGIN/COMMIT)+ 可重跑(推薦)
   好處:原子性與鎖保護一次到位;repo 上個月已有同款寫法成功套上 production 的前例。
   殘餘:萬一 CLI 自己也開了交易,我們的 COMMIT 可能讓「套用紀錄」落到另一筆交易
         → 極小機率出現「函式改了但紀錄沒寫」。因為檔案可重跑,下次 push 會自己補上。
B. 不放交易,改用連線層的鎖逾時設定
   好處:完全不碰 CLI 的交易邊界,不會有「紀錄沒寫」的問題;鎖保護仍在。
   殘餘:拆舊與建新之間是否一次到位取決於 CLI 行為(未驗)。若不是,會有極短時間
         函式不存在 —— 但近三週 0 筆訂單,這個窗口實務上打不到人。
C. 先做實驗把 CLI 行為驗清楚,再決定 A 或 B(codex 的建議)
   好處:最嚴謹,把未知數變成已知,之後所有 migration 都受惠。
   代價:要另外架一個拋棄式資料庫跑同一版 CLI 做失敗注入測試,B-2 順延。

A: A|B|C
```

```
Q2(工程題):database.types.ts(從 DB 生成的型別檔)什麼時候補上第 9 個參數?
    背景:B-2 只動 DB、不動 TS,所以型別檔會暫時停在 8 鍵。這不會壞任何東西
          (只是型別檔比 DB 舊),但要決定何時補、由誰補。
A. 留到 B-4(那時 TS 才真的要送這個參數)一起補(推薦)
   好處:片界乾淨,B-2 維持「純 DB 片」;PRD 拆片本來就這樣分。
   代價:中間這段時間型別檔與 DB 不一致(已知、會寫進 commit body 與 STATUS)。
B. B-2 就用 supabase CLI 重新生成型別檔
   好處:型別檔隨時與 DB 一致。
   代價:需要你跑 CLI 指令(我被 .env 規則擋),且會把 B-2 從純 DB 片變成跨層片。
C. B-2 內手動加一個 optional 鍵到型別檔
   好處:不用跑 CLI 也能一致。
   代價:手改生成檔,下次重生會被覆蓋;該檔已有手動校正註解的前例但不宜再擴大。

A: A|B|C
```

---

## 8. 相關既有紀錄與連動面(SOP ② 偵察 pass 產出)

### 8.1 命中的既有拍板 / 教訓

| 來源 | 對本片的約束 |
|---|---|
| memory `project_m4a-email-trigger-no-money-rpc` | 🔴 寄信不碰金流 RPC、不用 orders trigger → 第 9 參**只能是單純資料承接**,RPC 內不得加 outbox 邏輯 |
| memory `reference_supabase-service-role-execute-default-grant` | REVOKE 清單**必含 service_role**;需 `has_function_privilege` fail-closed 矩陣。E5 已實測復現 |
| memory `reference_supabase-migration-set-local-is-noop` | `SET LOCAL` 在無顯式交易時是 no-op → 本片改用檔內自帶 `BEGIN/COMMIT` |
| memory `reference_supabase-rls-schema-test-txn-simulation` | 交易模擬手法 + 跑後零留痕複查;只查 count/欄名,不取金額入對話 |
| memory `reference_supabase-cli-reads-env-local-blocker` | `db push` 由 **Sean 執行**;需先暫移 `.env.local` |
| memory `project_supabase-migration-version-drift` | 正式 schema 走 `db push`,**禁用 MCP `apply_migration`** 寫正式 schema |
| memory `project_create-order-stock-gate-removed` | 缺貨閘已移除、保留 `delisted_at` RAISE → diff 時**不得**「順手加回」 |
| lessons `docs/lessons-learned.md` §12 | 本片主題(DROP FUNCTION / RPC 權限 / lock_timeout)**查無**直接命中條(agent 已對標題與內文二次 grep) |
| backlog `#213` | `product_snapshot` spec 敏感鍵防護由 RPC 主控 → diff 須逐字保留 |
| backlog `#214②` | 訂單 idempotency / cart nonce **仍開放、非本片範圍**,不混做 |
| backlog `#216` | 運費門檻雙處 hardcode 由 drift test 收斂 → 見 §5 |

### 8.2 連動面(graphify + 全樹 grep)

呼叫鏈(graphify 實查):`CheckoutView` → `useChargePayment` → `chargePaymentAction`(`apps/storefront/src/app/checkout/charge-actions.ts:91`)→ `placeOrder` use-case → `SupabaseOrderAdapter`(`packages/adapters/src/supabase/SupabaseOrderAdapter.ts:135`)→ `mapPlaceOrderToCreateOrderArgs`(`packages/adapters/src/supabase/mappers/order.ts:72`)→ RPC。

**「8 參數」舊字面清單(B-3/B-4 動 TS 時須逐條銷)** —— 本片 §4.2 明確不動,登記在此避免日後漏改:

| # | 位置 | 字面 |
|---|---|---|
| 1 | `packages/adapters/src/supabase/mappers/order.ts:55-65` | `CreateOrderRpcArgs` 型別 8 鍵 |
| 2 | `packages/adapters/src/supabase/mappers/order.ts:119-130` | 組參數物件 8 鍵 |
| 3 | `packages/adapters/src/supabase/SupabaseOrderAdapter.ts:135-138` | `.rpc('create_order', …)`(全樹唯一呼叫點) |
| 4 | `packages/adapters/src/supabase/database.types.ts:1537-1553` | 生成型別 `create_order.Args` |
| 5 | `packages/domain/src/order/types.ts:499-532` | `PlaceOrderInput` 註解對齊 8-param |
| 6 | 🔴 `packages/adapters/src/supabase/mappers/order.test.ts:38-47` | **硬編碼 8 鍵 sorted 陣列斷言**(不同步 = 假綠) |
| 7 | 🔴 `packages/adapters/src/supabase/SupabaseOrderAdapter.test.ts:55-64` | mock 呼叫 8 鍵字面(同上) |
| 8 | `packages/schemas/src/index.ts:130,169-170` | 註解「對齊 create_order RPC 契約」 |
| 9 | `docs/specs/2026-07-18-…-prd.md:25`(F3) | 「`create_order` = 8 參數」 |
| 10 | `STATUS.md` / `PROGRESS.md` / `docs/phase-1-backlog.md:6109` / `docs/design-storefront-manifest.yaml:1013,1032-1033` | 8-param 描述字面 |
| 11 | 🔴 `packages/domain/src/order/shipping-rpc-drift.test.ts:9-11` | 註解稱「create_order 走 **CREATE OR REPLACE**、後者勝」+「改運費須同步新 **CREATE OR REPLACE** migration」→ **B-2 起改參數數量的片走 DROP+CREATE**,該字面已與事實脫節。**本片已修**(行為不受影響、僅註解)。<br>由 code-reviewer R1 nit#5 抓到:此處是本片**自己造成**的字面過期,原清單十項未收錄 → 「改合約字面要 grep 全樹」連**測試檔註解**都算 |

⚠️ **命名混淆警示**:`packages/domain/src/order/order.ts:223` 的 `createOrder()` 是 **domain entity factory**,與本 RPC 無關,**勿誤改**(`place-order.ts:18` 有明文註解說明此命名區隔)。

---

## 9. Rollback

- **交易內失敗**:`BEGIN/COMMIT` 保證整批回滾,prod 維持舊 8-param,無中間態。
- **apply 後需回退**(🔴 codex R2 #6 更正,原字面作廢):另開 rollback migration ——
  `DROP FUNCTION IF EXISTS public.create_order(9 參簽章);` + 貼回 **apply 前凍結保存的函式定義**(見下)+ 同一組 `REVOKE`/`GRANT`/`OWNER` + 同一組斷言。
  ⚠️ **不得**「重新把舊 migration `20260716200000` 當權威貼回」——那是同一條權威鏈錯誤的復發(§2.1 已撤回該論證)。
  🔴 **前置義務 —— 凍結「完整可重建狀態」,不只函式定義**(codex R3 #3 更正:`pg_get_functiondef`
  **不含** COMMENT / ACL / owner / security label,只凍它會 rollback 不回去):
  apply 前必須把下列**全部**存成檔案凍結(建議 `docs/reviews/2026-07-19-b2-preapply-snapshot.md`):
  1. `pg_get_functiondef` 全文(8-param)+ 其 md5
  2. **COMMENT 全文**(非只 md5 —— rollback 要能貼回原字)+ 其 md5 與長度
  3. `proacl::text` 字面
  4. `pg_get_userbyid(proowner)`
  5. E11 完整 catalog snapshot(全欄位)
  6. `pg_get_function_arguments` 與 `pg_get_expr(proargdefaults,0)`
  7. `seclabel` / `shseclabel` count
  **rollback 只認這份凍結副本**;**沒有這份凍結副本就沒有合格的 rollback 路徑**,不得動工。

  🔴 **rollback 專屬斷言**(codex R3:原文「同一組斷言」未定義 rollback 後該驗什麼):
  rollback migration 執行後須斷言「已精確還原成 8-param 基線」——
  · 存在 8-param 且**完整指紋**(§4 段 2.5 定義)== 凍結副本的基線指紋
  · 不存在 9-param
  · `proacl` 字面 == 凍結副本第 3 項
  · COMMENT md5 == 凍結副本第 2 項
  任一不符即 `RAISE`(rollback 失敗要吵,不可靜默停在半途狀態)。

  🔴 **rollback 片動工前必須先補的兩個缺口**(code-reviewer R2 Minor;**本片不修** —— snapshot 檔自訂「產出後不得再編輯」,現在動它反而破壞凍結語意):
  1. **指紋公式未涵蓋 `proretset`**:公式含 `prorettype` 但不含 `proretset` → 若 rollback 誤建成 `RETURNS SETOF jsonb`,**指紋抓不到**。rollback 片須在其自身斷言中補這一項。
  2. **snapshot §4 凍的是 `prosrc` 本體、非 `pg_get_functiondef` 全文**(§9 前置義務第 1 項的字面要求)。實質可重建(回傳型別/語言/secdef/proconfig/volatile/parallel/cost/rows/args 皆已凍於 §2),但 rollback 片須自行以這些欄位組回 `CREATE` 語句,不能假設有現成全文可貼。
- **不需回退資料**(🔴 codex R2 #7 更正):本片**零 backfill、不改任何既有欄位值**;rollback 亦不動 `notification_email` 既有值。
  ⚠️ 原字面「`notification_email` 恆 NULL」**作廢**(與 §5 自相矛盾):`authenticated` 可直呼 RPC 自帶合法第 9 參,故該欄非恆 NULL。
- ⚠️ **不得**用 `DROP COLUMN` 當 rollback(PRD §5:永久刪 PII)。

---

## 10. 執行順序(批准後)

1. 關卡 1:`codex-adversary` 審本 plan(鐵則 8 重大改動;輪數上限 2)
2. 🔴 **先凍結後產檔(順序不可顛倒;codex R3 B②)**:
   ①先取 prod 完整 snapshot(§9 前置義務七項)並存檔凍結 → ②算基線指紋 →
   ③才產 migration 檔(把基線指紋寫進段 2.5 守門)→ ④產函式體 diff(硬交付物)。
   ⚠️ 顛倒順序會變成「先寫死一個還沒取得的指紋」= 雞生蛋。
3. 三綠(讀輸出內容判定)
4. prod 交易模擬 §6-B 九項 + 零留痕複查
5. code-reviewer(一輪制)
6. 鐵則 12 Codex Review Packet → **commit 前**產、提醒 Sean 貼 Codex
7. commit(精準 add、STATUS 7 欄同 commit)+ 收尾對帳 + busboy-end
8. **不 push、不 db push** —— 等 Sean

⚠️ **B-2 apply 後不等於「必填生效」**:第 9 參仍是 `DEFAULT NULL`,直呼 RPC 可省略。必填收緊 = B-6(PRD §4)。**在 §6 八項上線 gate 全數達成前,禁用「通知功能上線」「孤兒已消滅」字面。**

---

## 11. 關卡 1 — Codex 對抗審查 R1 銷案表

**判定:FAIL**(6 must-fix + 1 OK)。以下逐條銷案。
🔴 **流程自省(codex 附帶指出、成立)**:R1 審查期間我持續編輯本檔(226→254→267 行、兩次換 SHA)→ **審查對象未凍結**,任何判定都沒有明確對象。**已改正**:本版起凍結,R2 送審前不再編輯。
⚠️ 凍結雜湊**刻意不寫進本檔**(寫進去會改變本檔內容、當場自我失效)→ 取得方式:`shasum -a 256 docs/specs/2026-07-19-m4a-b2-create-order-9param-plan.md`,送 R2 時附當下值。

| # | codex 判定 | 我的處置 | 落點 |
|---|---|---|---|
| 1 | must-fix:PostgREST cache 只靠 event trigger、未經 PostgREST 實測 | **全收**。migration 加顯式 `NOTIFY pgrst, 'reload schema'`;驗收新增「經 PostgREST 以 authenticated 送 8 參 smoke,確認非 `PGRST202/404/42725`」 | §4 段 6.5、§6-B-9 |
| 2 | must-fix:catalog 屬性查得不全;宣稱 `seclabel=0` 但所附 SQL 沒查 seclabel | **全收(這條是真的字面 vs 事實)**。已重跑完整 snapshot(含 `prosupport`/`proretset`/`prorows`/`pg_seclabel`/`pg_shseclabel`/COMMENT md5);斷言改為**全屬性精確相等**、`proconfig` 整陣列比對、COMMENT 驗 md5。<br>⚠️ **後續收斂**:COMMENT 的 md5 斷言**已於 code-reviewer R1 後改為「非 NULL + 長度 ≥ 400」+ 逐字覆核**(理由=md5 為自指字面)→ 現行字面以 §4 段 7 ⑥ 與 §6-B 第 4 項為準,本列僅為歷史紀錄 | E11、§4 段 7 ⑤⑥ |
| 3 | must-fix:「兩假設都安全」不成立 —— 檔內 COMMIT 非 CLI 最後一句,歷史表寫入可能落單 | **全收,論證撤回**。改寫 §3.1 誠實版;加「兩簽章皆 `DROP ... IF EXISTS`」使 migration 可重跑、裂縫可收斂;**殘餘風險不自行接受** → 升為決策題 | §3.1、§4 段 3、§7 Q3 |
| 4 | must-fix:鎖語意描述不精確;3s 非「一定足夠」 | **全收**。改為「`AccessExclusiveLock` 在函式 object、非 orders 表」「執行中的呼叫通常不擋」「零訂單≠不會等鎖」;新增**寫死的逾時處置**(停、不 retry、不調大 timeout、查 blocker 交 Sean) | §5 兩列 |
| 5 | OK:Q1 推薦 A | **採納**,並吸收其補充:CHECK 失敗時整筆回滾、order/consent/items 皆不落表,但 `nextval()` 不歸還 → 可能**單號缺號**(非幽靈訂單)。Q1 說明改為「不新增第三份規則」 | §7 Q1(待 Sean 拍) |
| 6 | must-fix:用 md5 快照架空 PRD「禁從舊 migration 複製」= 下位文件改寫上位真權威 | **全收,原字面作廢**。編輯基底改回**動工當下 `pg_get_functiondef` 輸出**;repo 檔僅作第二份對照 | §2.1、§3 要求③ |
| 7 | must-fix:多處字面錯 | **全收**:①`prosrc diff = 三處` **是錯的** → 分層為 `prosrc` 1 處 / 檔面 3 處 ②`notification_email 恆 NULL` **不成立**(authenticated 可直傳)→ 改「經現行 app 路徑建立的單為 NULL」③`orders 仍 30 筆` → 改 before/after snapshot ④SECURITY LABEL 結論補上對應查詢 | §4.1、§5、§6-B-10、E11 |

**未於本輪處置、已升為決策題**:codex #3 建議的「disposable DB + 同版 CLI failure-injection 實驗」= §7 **Q3 選項 C**,Sean 已拍 **A(不做)**。

---

## 12. 關卡 1 — Codex R2 複審銷案表

**判定:FAIL**。結構:**3 CLOSED / 4 PARTIAL / 2 新 BLOCKER**。受審凍結版 SHA-256 `d7d22a93acc7…`(356 行)。

| R1# | R2 判定 | 內容 | 本輪處置 |
|---|---|---|---|
| 1 | **PARTIAL** | 只送 8 參的 smoke 分不出「快取已更新」與「快取仍舊」;真建單會自行提交、與零留痕衝突 | **全收,原設計作廢** → 改為「9 參 + `p_cart_session_id=null`」在任何寫入前 RAISE,取得可診斷且零寫入的證據;另加 8 參相容性測(§6-B-9a/9b) |
| 2 | **PARTIAL** | `pronargdefaults=1` 只證明數量、不證明 default **內容**;未驗 `proargnames` | **全收** → 斷言 ⑦ 擴為:`proargnames` 整陣列 + `pg_get_function_arguments` 含 `p_notification_email text DEFAULT NULL` + 前 8 參逐一比對(§4 段 7 ⑦) |
| 3 | ✅ **CLOSED** | 可重跑兜底成立(首次 / 裂縫後重跑兩情境皆能收斂;非 `OR REPLACE` 不會撞 duplicate) | — |
| 4 | ✅ **CLOSED** | 鎖語意與逾時處置已正確限定 | — |
| 5 | ✅ **CLOSED** | Q1=A 已落地,含 `nextval()` 跳號揭示 | — |
| 6 | **PARTIAL** | §9 rollback **又**把舊 migration 當權威 = 權威鏈錯誤復發 | **全收** → rollback 改認「apply 前凍結保存的定義副本」;並新增前置義務:**沒有凍結副本就沒有合格 rollback 路徑**(§9) |
| 7 | **PARTIAL** | §9 仍寫「`notification_email` 恆 NULL」,與 §5 自相矛盾 | **全收** → §9 改為「零 backfill、不改既有欄位值」 |

**新 BLOCKER(R1 未抓到)**

| # | 內容 | 處置 |
|---|---|---|
| B-1 | 🔴 `DROP IF EXISTS` 缺 apply-time 基線守門 → 會把「別人後來改過的較新版本」**靜默覆寫回本檔的舊基底**。**這是我為了可重跑而加 IF EXISTS 時引入的新風險** | **全收** → 新增 §4 **段 2.5 守門 DO block**:當下狀態必為「狀態 A 首次 apply(8-param 且 md5 == 基線)」或「狀態 B 裂縫後重跑(9-param 且 md5 == 預期產出)」二者之一,其他一律 RAISE 中止 |
| B-2 | PostgREST 驗收不可診斷且可能留正式資料 | 同 R1#1,見上 |

**🔴 我自查補上、codex R2 未點名的第三處**:§1「一句話」(第 12 行)同時含**兩個**已作廢字面(「已證明等同 prod 的基底」+「函式體三處 delta」)。
codex 只點名 §9 的兩處;我依規則**grep 全檔建立舊字面清單**才抓到這處。→ 「只改被點名那一處」在本條線**已復發 5 次**,grep 全檔是唯一可靠解法,不能靠審查員點名。

---

## 13. 🔴 輪數上限已用完 —— 交 Sean 決定

PCM 規則:**plan 層審查上限 2 輪**(R1 + R2 已用完),「仍不收斂 = 方向問題、整理決策題給 Sean,不再加輪」。

**我的誠實評估:這不是方向問題,是收斂中。**
- 設計主體(DROP→CREATE 順序、顯式交易、ACL 鏡像、完整屬性重建、md5 驗證)**兩輪都沒有被推翻**。
- R1 6 must-fix → R2 3 CLOSED / 4 PARTIAL(皆為既有條目**補完**,非新方向)/ 2 新 BLOCKER(皆屬**驗收設計**與**守門**,非設計主體)。
- 本輪處置**全部是具體可執行的修正**,沒有任何一條需要重新選路。

**但規則就是規則,R3 我不自行開。** 決策題見 §7 Q4。
→ **Sean 2026-07-19 拍 Q4=B:明示破例加開 R3。** 結果見 §14。

---

## 14. 關卡 1 — Codex R3 確認輪(Sean 破例加開)

**判定:FAIL,剩 3 條,codex 明列「三條都必須在動工前解決」。** 受審凍結版 `452f319b…`(447 行)。

**R2 九項的收斂結果:6 CLOSED / 2 STILL-OPEN / 1 CLOSED 但衍生新問題**

| 項 | R3 判定 | 說明 |
|---|---|---|
| R1#1 / BLOCKER-2 | ✅ CLOSED | smoke 重設計獲確認 |
| R1#3 / #4 / #5 / #7 | ✅ CLOSED | — |
| R1#6 | ✅ CLOSED 但衍生 | rollback 權威已改對,但**凍結內容不完整**(見下) |
| R1#2 | ❌ STILL-OPEN | `包含 'DEFAULT NULL'` 會被 `DEFAULT NULLIF(...)` 騙過 |
| BLOCKER-1 | ❌ STILL-OPEN | 守門只用 `md5(prosrc)`,與 plan §2.1 自己的敘述矛盾 |

**codex 實際讀函式體驗證(重要,支持 smoke 設計成立)**:
`20260716200000` 的 cart-session NULL guard 在 `BEGIN` 後**第一個敘述**(`:75-79`);其前只有宣告與
`v_uid := auth.uid()` 唯讀初始化(`:49-74`);`nextval()` 在 `:271`、第一個 INSERT 在 `:275`
→ **guard 前零寫入、零 sequence 消耗**,§6-B-9a/9b 的「零留痕」前提成立。
另確認 `@supabase/postgrest-js` 的 POST RPC 以 JSON body 傳參,`JSON.stringify` **保留 `null`**
(不像 `undefined` 會被省略)→ 若伺服器誤把 NULL 當未提供,結果會是**明確失敗/無法判定**,
**不會假 PASS、不會留資料**(失敗模式安全)。

**本輪三條處置**

| # | 內容 | 處置 |
|---|---|---|
| 1 | 段 2.5 指紋不完整 + 守門與 DROP 間競態窗口 | **指紋改為 E11 全欄位串接 md5**(body 相同但屬性被改也會被擋);競態加 `pg_advisory_xact_lock` 緩解,**殘餘未消除、誠實揭示並列入決策題**(§7 Q5) |
| 2 | `DEFAULT NULL` substring 檢查太弱 | 改**精確等值**:`pg_get_function_arguments` 全字串等值 + `pg_get_expr(proargdefaults,0)` == `NULL::text`。<br>🔴 **實測校正**:PG 正規化為 `NULL::text` 而非裸 `NULL` —— 照直覺寫 `DEFAULT NULL` 當預期值,斷言會**當場失敗**。此值由交易模擬實跑取得(全程回滾) |
| 3 | rollback 凍結副本不完整、無 rollback 專屬斷言 | 凍結內容擴為**七項**(含 COMMENT 全文 / ACL / owner / 完整 catalog);新增 **rollback 後專屬斷言**(還原後指紋、ACL、COMMENT md5 逐一比對,不符即 RAISE) |

**🔴 三輪累計:codex 共提 6 + 9 + 3 = 18 條,全數處置;另有 1 條由我自行 grep 全檔補上(codex 三輪皆未點名)。**
