# plan · ⟦tidy-NETPUBLICALL⟧ —— `net` 的資料庫授權對 anon 全開,而我們自己收不掉

> 線【權限/信件】窗 C · 2026-09-09 · **本檔只是 plan,等 Sean 批。窗 C 沒有 apply 任何東西、沒打任何 HTTP、沒 push。**
> 讀數來源 = `pcm_readonly` @ 正式庫 · `bash scripts/readonly-prod-sql.sh` · **2026-09-09 09:53–10:2x UTC** · 全部唯讀零寫入。
> **本稿是 R2 定稿**。R1 交 codex(`gpt-6-astra`, `-s read-only`)審出 4 must-fix ⇒ 補量改寫;R2 再審出 4 must-fix + 2 nit ⇒ 已逐條補量/收窄措辭。
> 🛑 **主視窗 2026-09-09 裁:不跑 R3**(卡點是 §5 那一格面板設定,不是稿子的措辭)。R2 報告原文隨稿附上,兩份一起看。差異對照在 §8。

---

## 0. 一句話 —— 這兩句**不可以合成一句**

- 🔴 **資料庫這一層,`anon` 對 `net` 的授權確實全開,而且鏈路上每一格權限我都量到了。**
- ❓ **而「外面拿公開 anon key 的人是不是真的摸得到」,我答不出來** —— 它卡在 Supabase 面板的一個設定上,DB 裡問不到、版控裡也沒有。

⇒ 📌 **在第二句答出來之前,§1 只證明「DB 授權寬鬆」,不證明「匿名攻擊者已經能發請求、已經讀到那 468 列」。**

---

## 1. 資料庫這一層:量到什麼(每一格都有讀數)

| # | 量什麼 | 讀數 | 對照 |
|---|---|---|---|
| 1 | `anon`/`authenticated` × `net._http_response`、`net.http_request_queue` × SELECT/INSERT/UPDATE/DELETE/TRUNCATE | **20/20 全 `t`** | — |
| 2 | 表級 `relacl` 逐字 | `{supabase_admin=arwdDxtm/supabase_admin,`**`=arwdDxtm/supabase_admin`**`}` ⇒ 第二筆 grantee 空 = **PUBLIC** | — |
| 3 | `net` schema USAGE | `anon` **`t`** · `authenticated` **`t`** | 🟢 `public` ⇒ t · ⚪ `cron` ⇒ **f** ⇒ 尺會動 |
| 4 | `net` 的 `nspacl` | PUBLIC `=U/supabase_admin` **和**具名 `anon=U`、`authenticated=U`、`service_role=U`,**兩條路都在** | — |
| 5 | `anon` 對 `net.http_post/http_get/http_delete` 的 EXECUTE | **三支全 `t`**(`proacl` NULL = 預設 = PUBLIC EXECUTE) | 見下方 ⚠️ |
| 6 | 那三支的 `prosecdef` | **全 `f`(SECURITY INVOKER)** ⇒ `anon` 呼叫時用 **`anon` 自己的身分**入列 | — |
| 7 | 承上,`anon` 入列需要的每一格 | 佇列表 INSERT **`t`**(第 1 列)· `http_request_queue_id_seq` 的 USAGE/UPDATE/SELECT **`t`/`t`/`t`** · helper `net.wake()`、`_encode_url_with_params_array`、`_urlencode_string`、`check_worker_is_up` 的 EXECUTE **4/4 `t`** | — |
| 8 | RLS | 兩表 `relrowsecurity=f` · policies **0** | — |
| 9 | `net._http_response` 現有列數 | **468**,`status_code` 全 200,`created` `03:54 → 09:52 UTC`(**5h58m**)· `headers` 468/468 非空 · `content` 468/468 非空 · 最長 content 1216 | — |
| 10 | 本庫的 `pg_net.ttl` | **`6 hours`**(`pg_settings.source = default`)⇒ **親測本庫,不是抄官方預設** | ⚪ 同查 `pg_db_role_setting` 含 `pg_net%` ⇒ **0 列** ⇒ 沒有 per-db/per-role 覆寫 |

⚠️ **第 5 列那把尺有陷阱,我用負對照抓到了**:`has_function_privilege('anon','cron.schedule(...)','EXECUTE')` 也回 **`t`**,而 `anon` 對 `cron` 的 schema USAGE 是 `f`。
⇒ 📌 **`has_function_privilege` 只回報角色對該函式的有效權限,不會一起檢查 schema 閘。** 所以「函式位 t」單獨不算數,要 schema USAGE 一起 t 才算 —— `net` 兩個都 t,而第 6、7 列把「函式內部跑不跑得動」的每一格也補上了。
🛑 反過來也一樣:**`USAGE=f` 不能排除**透過其他已解析物件間接存取(那一格見 §3)。

### 第 9、10 列合起來怎麼讀
`pg_net.ttl` 實測 **6 hours**,而讀數跨度 **5h58m** ⇒ ✅ 兩者吻合。
⇒ **`anon` 讀得到的是「滾動的最近 6 小時」的對外 HTTP 回應 header 與 body**,不是全部歷史。
🛑 **裡面有沒有金鑰或個資 —— 我沒查。** 我刻意只印計數與長度,一格內容都沒印。

### 🔴 原文漏掉、我補到的最狠一格:佇列裡有我們自己的 cron secret
`supabase/migrations/20260723120000_m3_s2_settle_sweep_pgcron.sql:113-117` 逐字:
```sql
SELECT net.http_get(
  url := rtrim(v_base, '/') || p_path,
  headers := jsonb_build_object('Authorization', 'Bearer ' || v_token),
```
`v_token` 來自 `vault.decrypted_secrets` 的 `cron_secret`。
⇒ 📌 **那個 Bearer token 會以明文 jsonb 出現在 `net.http_request_queue.headers`**,而 `anon` 對該表 SELECT = `t`。
⏱ 佇列排空得快(量測當下 **0 列**),但 10 支 cron 有 2 支 `*/2`、1 支 `*/5`、3 支 `*/10` ⇒ **一直有新列進來**。
🛑 **這是程式路徑證據,不是「已證實正式庫佇列外洩過」。** 我沒有、也不該去撈那張表的內容。

---

## 2. 🛑 修法那一半:**由我們的身分跑的 REVOKE 不會生效**

| 量什麼 | 讀數 |
|---|---|
| `net` schema 與底下 6 個物件的 owner | 全部 `supabase_admin` |
| `postgres` `rolsuper` | **`f`** |
| `pg_has_role('postgres','supabase_admin','MEMBER')` | **`f`** |
| `postgres` 對兩表 `SELECT WITH GRANT OPTION` / `TRUNCATE WITH GRANT OPTION` | **`f` / `f`** |
| 🟢 正對照 `public.orders`(我們自己擁有的) | **`t` / `t`** ⇒ 尺分得出【我們的】與【平台的】 |
| `net` 的 `nspacl` 裡 postgres 那筆 | `postgres=U/supabase_admin` —— **沒星號**(⚪ 對比 `cron` 是 `postgres=U*` **有**星號) |

⇒ 📌 **一支由 `postgres` 身分跑的 `REVOKE ... FROM PUBLIC`,會印 `WARNING: no privileges could be revoked`、`rc=0`、交易照樣 COMMIT,而 ACL 一格都沒動。**
🛑 `ON_ERROR_STOP` 擋不住 —— 它只管 `ERROR`,不管 `WARNING`。

🔵 **這個結論的射程要講清楚**(codex R2 收窄):它成立於「**`postgres` 直接 REVOKE 這兩張表**」。
它**不等於**「所有 DB 修法都不可能」—— 若庫裡存在一支以 owner/superuser 身分執行撤權的 `SECURITY DEFINER` 管理函式,那是**執行身分換了**,不是 postgres 突然收得掉。
**我沒有量到這種入口存在**,所以既不宣稱有解,也不把它判死。

### 🔴 「請 Sean 去 Dashboard SQL Editor 以平台身分跑」—— **這條路不成立**
Hosted Supabase 的 SQL Editor **用的也是 `postgres`**,不會因為是老闆本人貼就變成 `supabase_admin`。⇒ R1 稿裡的方案乙已刪。

### 平台會不會把權限發回來(**R2 修正:我上一稿讀錯了**)
- 事件觸發器 `issue_pg_net_access` 的 `evttags` 逐字 = **`{"CREATE EXTENSION"}`**,而外層還要求該次事件涉及 `pg_net` ⇒ **不是每次 `CREATE EXTENSION` 都重授。**
- 它呼叫的 `extensions.grant_pg_net_access()`(唯讀讀出原始碼)裡,**不受版本條件限制的那一段**:
  `GRANT USAGE ON SCHEMA net TO supabase_functions_admin, postgres, anon, authenticated, service_role;`
  ⇒ 🔴 **schema USAGE 確實會在那個事件下被發回來。**
- 🛑 **而我上一稿說「0.20.0 跳過了平台的硬化」——【那是錯的,已刪】。** 那個版本分支(`extversion IN ('0.2'…'0.11.0')`)裡是 `REVOKE ALL … FROM PUBLIC` **緊接著 `GRANT EXECUTE … TO anon, authenticated, service_role`** ⇒ 📌 **它根本不是「擋 anon」的分支**,跳過它推不出「本庫異常」。
- ✅ 剩下站得住的只有讀數本身:**本庫今天 `proacl` 是 NULL(= PUBLIC EXECUTE),而 `anon` 的 schema USAGE 是 t。** 這個組合是不是 pg_net 0.20.0 的正常樣貌 —— **我沒查。**

---

## 3. 間接入口:所列搜尋**未發現**anon 摸得到的入口(措辭刻意收窄)

| 掃什麼 | 讀數 |
|---|---|
| 全庫 `pg_proc.prosrc` 含 `net.`／`_http_response`／`http_request_queue` 的非 net 函式 | **3 支**:`extensions.grant_pg_net_access`、`pcm_cron.invoke_cron_route`、`public.pcm_net_exposure_probe` |
| ↳ `pcm_cron.invoke_cron_route`(我們的 SECURITY DEFINER wrapper) | `anon` EXECUTE **`f`** · `anon` 對 `pcm_cron` 的 schema USAGE **`f`**(`authenticated`/`service_role` 也都 `f`) |
| ↳ `public.pcm_net_exposure_probe`(我們的探針,SECURITY DEFINER,在 anon 有 USAGE 的 `public`) | `anon` EXECUTE **`f`**(`proacl` = `{postgres=X/postgres}`) |
| `anon` 寫得動的表上的 SECURITY DEFINER trigger 函式 | **0 筆** |
| view / matview 定義含 `net.` 且 `anon` 讀得到 | **0 筆** |
| repo 應用碼直接打 `net`(`from('net…`、`/rest/v1/net`、`Accept-Profile`/`Content-Profile`) | **0 命中**(`apps/` + `packages/` 全掃) |

🛑 **這一節說的是「所列搜尋未發現入口」,不是「沒有入口」。** 已知看不到的:
- 動態 SQL 組出來的呼叫(掃 `prosrc` 與相依性目錄都看不到)
- 遞迴的相依路徑(A 呼叫 B、B 再碰到 net)—— 我只掃了直接引用
- repo 之外的 PostgREST 呼叫者

---

## 4. 🔴 我們自己那支每日探針 —— **它答的是別的題,不能拿來取代面板那一格**

主視窗問「它是不是已經在答『外面碰不碰得到』」。查完了,**不是**。

**① 它量什麼**:`net` 兩表的**表級 `relacl` + 欄級 `attacl`**(anon/authenticated/PUBLIC)、`has_table_privilege` 有效權限、`postgres` 的 superuser 旗標。
🛑 migration 檔頭逐字:「它【不看】那 12 格 HTTP 曝露面 —— **那是片 2(`⟦0e-PROBENOSCHED⟧`), 未做**。」
⇒ 📌 **它量的是我 §1 已經量過的同一層(DB 授權),不是 §5 那一題(外面叫不叫得到)。**

**② 它跑過幾次、結果是什麼**:
```
cron.job WHERE jobname='pcm-net-exposure'
  jobid 10 · schedule '0 0 * * *' · active t · username postgres
  command: SELECT public.pcm_net_exposure_record();

cron.job_run_details WHERE jobid=10  ⇒ 逐字,只有一列:
  runid 56694 · status succeeded
  start 2026-09-09 00:00:00.214491+00 → end 00:00:00.337957+00 · return_message '1 row'
```
⚪ **負對照(確認這張表不是全空)**:同表其餘 9 支 job 的 runs 分別是 33189/46/746/6023/13677/2736/4/588/588,最新到 `2026-09-09 10:12` ⇒ **`cron.job_run_details` 讀得到,那個「1」是真的 1,不是查無。**
⇒ 📌 **它只跑過 1 次**(2026-09-09 00:00 UTC,migration 是 09-08 貼的)。

🔴 **而它看到什麼,我讀不到**:
```
has_table_privilege('pcm_readonly','public.pcm_net_exposure_snapshot','SELECT') ⇒ f
SELECT count(*) FROM public.pcm_net_exposure_snapshot ⇒ ERROR: permission denied for table
pcm_net_exposure_probe() / pcm_net_exposure_record() 的 proacl ⇒ {postgres=X/postgres}
  · pcm_readonly EXECUTE ⇒ f / f
```
📌 **migration 的 COMMENT 逐字寫「施工窗的唯讀角色(pcm_readonly)是否讀得到【未確認】」—— 今天確認了:讀不到。**
⇒ 我證得到「它跑成功了」,證不到「它看到什麼」。**只有 Sean 的 SQL Editor(或 owner)讀得到那張表。**

**③ 它的尺活不活 —— 半活,而且它自己承認**:
- ✅ **表級有正對照**:`calib_rel` 用同一把尺(`aclexplode` 走 `relacl`)去看 `public`,那裡本來就該有 anon 授權;回 0 ⇒ `calibrated=false` ⇒ 上面的數字不可讀。**這一格是活的。**
- 🔴 **欄級沒有校準**,migration 逐字:「`attacl` 在正常庫幾乎全 NULL, 造不出自然的正對照 ⇒ **它壞掉會安靜地印 0, 而 calibrated 不會叫。已知缺口, 不是掃過了。**」
- 🔴 **它只記錄、不告警**,migration 逐字:「本片只【記錄】, 不告警 —— 它把讀數寫進一張表, 而【沒有任何東西會因為那個數字叫】。」而且**基線不是 0**(COMMENT 逐字:`exposure_count` 基線 = **7**)⇒ 拿 `>0` 當閘會天天叫。
- 🔴 **而它只有一個讀數,沒有 delta 可比** —— 要比 delta 的是片 2,未做。⇒ 📌 **「從來沒紅過」這個形狀在這裡連判斷的機會都還沒有。**

⇒ ✅ **結論:探針不能省掉 §5 那一題。Sean 還是要翻面板。**

---

## 5. 🔴 要 Sean 答的一題(整件事卡在這一格)

```
Q:Supabase 面板 → Settings → API → Exposed schemas 那一欄,裡面有沒有 `net`?
   (請先把整欄【原本的完整內容與順序】抄下來 —— 順序會影響沒帶 Profile header 的請求走哪個
    schema,而那份抄本就是我們的還原路)
A: 甲 有 net —— 請拿掉,並把原本的清單與順序抄給我
   乙 沒有 net —— DB 那層維持原狀(由我們的身分收不掉),
      我把「這層是靠面板那個設定擋著、DB 那層我們動不了」寫進文件
```

🛑 **我不打一發 HTTP 去驗**(主視窗 2026-09-08 已裁:對正式站發請求 = 對外動作;且若打得通,就是用踩它的方式證明它可以被踩)。
🛑 **這格 DB 裡答不出來**:`pg_db_role_setting` 全表 12 列,含 `pgrst` 的 **0** 列 ⇒ Supabase 把該設定交給 PostgREST 自己,不放 DB。版控裡也沒有(`supabase/config.toml` 查無 `schemas`)。
⇒ ✅ **這是【量不到】,不是【沒事】。**

---

## 6. 改什麼 · 影響 · rollback

### 路一(**只在 Sean 答甲時做**)· 面板拿掉 `net`
- **改什麼**:Exposed schemas 移除 `net`,**其餘項目與順序原樣保留**。
- **為什麼**:DB 那層由我們的身分收不掉(§2),**這是我們控制得了的那道閘**。
- **影響**:受影響的**不只前端** —— 後端、Edge Functions、外部整合、以及任何用 service-role key 走 PostgREST 的呼叫都算。我在 repo 掃過 **0 命中**(§3),但 **repo 之外的呼叫者我看不到**。
  ⚠️ 還有**順序**:若 `net` 原本排第一,移除後沒帶 `Accept-Profile` 的請求會改走下一個 schema ⇒ **所以要先抄原始清單與順序。**
- **rollback**:把 `net` 加回**原本的位置**(那份抄本就是 rollback 本身)。
- 🛑 **誰做**:Sean 本人(面板動作,窗 C 與主視窗都碰不到)。

### 路二(**建議,而做不做、誰去做由 Sean 決定**)· 開一張 Supabase support 單
- **改什麼**:請平台側收掉 `net` 兩表的 PUBLIC 授權,或說明本庫 `pg_net 0.20.0` 的 `proacl` 為 NULL(PUBLIC EXECUTE)加上 anon schema USAGE 是不是正常樣貌。
- **為什麼**:這是**目前已識別的、能真正動到 DB 那層的求助途徑**(措辭刻意不寫「唯一」—— §2 承認未排除管理入口)。
- **影響 / rollback**:對外溝通,不動系統。
- 🛑 **這是對外動作 ⇒ 建議開,但要不要開、由誰開,是 Sean 的決定。回答「沒有 net」不等於授權開單;開單授權也不等於正式庫修改授權。**

🛑 **兩條路都沒有窗 C 要寫的 migration。** 寫一支 `REVOKE` migration 交出去,只會得到一個「跑成功、rc=0、權限一格沒動」的空動作(§2)。

---

## 7. 🛑 我證不到什麼(不要讀成沒事)

1. **外面到底叫不叫得到** —— 卡在 §5,DB 裡問不出來。**這格沒答之前,§1 不證明「已經被打了」。**
2. **那 468 筆回應、以及佇列裡,實際有沒有金鑰或個資** —— 沒查,只印計數與長度。要查得先 Sean 點頭,因為那一發本身就是在撈敏感內容。
3. **收掉 PUBLIC 會不會弄壞 `pg_net` 自己** —— 沒查。那些 PUBLIC 授權可能是 pg_net 0.20.0 的正常設計。
4. **平台有沒有別的提權路徑** —— `pg_has_role(...,'MEMBER')` 是 `f`,但平台自己怎麼連線,那一格我看不到。§2 也未排除「以 owner 身分執行撤權的管理函式」存在。
5. **動態 SQL / 遞迴相依 / repo 之外的呼叫者** —— §3 的尺看不到。
6. **我們自己那支探針看到什麼** —— `pcm_readonly` 讀不到那張表(§4),只證得到它跑成功。
7. **量測本身是否每格都成功**:掃法要**兩種形狀**(`^ERROR:` 與 `^psql:.*ERROR`)。🛑 **誠實講:我前後跑了 10 發,其中 3 發撞到 `psql:…ERROR`** —— ① 寫錯 `net.http_delete` 的簽章 ② 把 `pg_event_trigger` 的欄名寫成 `tgname` ③ 讀探針快照表被 `permission denied`(①②已改對重跑,③是真實權限缺口、已寫進 §4)。**`rc=0` 不能拿來當「全對」的證據。**
8. 讀數是 2026-09-09 09:53–10:2x UTC 那幾發的。**平台側授權會被平台自己改,而改了不會通知任何人。**

---

## 8. R1 → R2 定稿改了什麼

**codex R1 的 4 個 must-fix**

| R1 must-fix | 怎麼修 |
|---|---|
| ① 把「DB 授權成立」寫成「外部攻擊已成立」 | §0 把兩句拆開寫死;§1 標題限定「資料庫這一層」;修正「今天每一發回應」⇒ 6 小時滾動窗 |
| ③ 方案甲影響評估不完整、R1 內部自相矛盾(一處說已 grep、一處說沒 grep) | **grep 補跑了**(§3,0 命中),矛盾消除;影響面補後端/Edge Functions/service-role;補「先抄原始清單與順序」 |
| ④ 嚴重度雙向失準 · `TRUNCATE` 混淆介面能力 · 漏掉佇列裡的 Authorization | §5 兩分支各自寫死;**刪掉「anon key 可以 TRUNCATE」**(PostgREST 表端點給的是 `DELETE`;而 `anon` 的 `DELETE` 也是 `t`,一樣清得掉,故改寫成「能清空佇列」);**新增 cron secret 那一段**(§1) |
| ⑤ 漏量:evttags / 觸發函式內容 / prosecdef / 間接入口 / 錯誤掃描格式 | 全部補量(§2、§3、§7 第 7 條) |
| 額外:Dashboard SQL Editor 用的是 `postgres` | **R1 的方案乙整個刪掉** |

**codex R2 的 4 must-fix + 2 nit**

| R2 意見 | 怎麼修 |
|---|---|
| B1 must-fix · `prosecdef=f` + INSERT 不足以證明鏈路完整(缺 sequence 的 `nextval` 權限、helper 函式 EXECUTE) | **補量了**:seq USAGE/UPDATE/SELECT 對 anon 全 `t`;`net.wake()` 等 4 支 helper 的 EXECUTE 對 anon 全 `t` ⇒ §1 第 7 列。**現在是量到的,不是推的。** |
| B2 must-fix · 版本分支讀對、安全結論讀錯 | **§2 那段整段重寫,錯誤宣稱已刪**,並寫明那個分支是 REVOKE 完立刻 GRANT 給 anon ⇒ 不是硬化分支 |
| B3 nit · 6 小時是抄的沒親測 | **補量了**:`pg_net.ttl = 6 hours`(`source=default`)+ `pg_db_role_setting` 無覆寫 ⇒ §1 第 10 列 |
| B4 nit · support 開單措辭各章不一致 | §6 路二統一成「**建議**,而做不做、誰去做由 Sean 決定」;§5 選項乙刪掉「並開一張」 |
| B5 must-fix · 「沒有間接入口」證過頭 | §3 標題與結語改成「**所列搜尋未發現入口**」,並列出三類已知看不到的路;另**補掃了 trigger 那條路(0 筆)與 `_http_response`/`http_request_queue` 字面(多找到探針 1 支,anon EXECUTE = f)** |
| B6 must-fix · 「support 是唯一能動 DB 的路」與 §2 矛盾 | 改成「**目前已識別的求助途徑**」,不寫「唯一」 |
| A① 部分修 · `plan:11`「鏈路完整」與 `plan:102` 仍推過頭 | §0 改寫成「**鏈路上每一格權限我都量到了**」(權限的宣稱),並在同一段寫死「不證明已經被打了」 |

🛑 **R2 結論是「不可交給老闆拍板」。主視窗 2026-09-09 裁不跑 R3**,理由:卡點是 §5 那一格面板設定,不是稿子的措辭。**R2 報告原文隨稿附上,請與本稿一起看。**

---

## 9. 窗 C 接下來做什麼
- **等 Sean 答 §5 那一題。** 在那之前**不動任何 schema / GRANT / migration**。
- 🛑 **處置原則(主視窗 2026-09-09 定)**:既然證到「我們沒有權限收那個 GRANT」⇒ **這不是我們的工作了。** 不寫會印 `WARNING` 的假 `REVOKE`,不找繞路。本列的產出就是這份 plan + Sean 的一個決定。
- 往下接 `⟦db-RLSHARDENZEROROWS⟧` 與 `⟦b9-RLSHARDEN⟧`(同族,一起看)。
