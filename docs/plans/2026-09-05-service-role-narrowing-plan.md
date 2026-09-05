# Plan · 把 email / cron 兩道 `service_role` 收窄成專用角色

> 線【身分】`-auth` · 2026-09-05 · 主視窗 `-94` 派(`⟦b9-SRVMIN⟧` 量完之後)
> 🛑 **本檔是 plan,不 apply。** 動 `GRANT` / 建角色 = **鐵則 12②(權限)** ⇒ 要 Sean 拍板 + codex 對抗審查。
> 🟢 **範本不是我發明的,是本 repo 已經在跑的那一個** —— `payment_confirmer`。

---

## 0. 一句話

> **付款那道已經收窄好了(專用角色、不能繞 RLS、零表權限、只能呼叫函式)。
> 寄信與排程那兩道還在用萬用鑰匙。**
> 🔴 **[2026-09-05 訂正]** ⛔ ~~而它們實際只需要 7 個物件與 1 張表~~ ——
> 那句仍然描述**它們用到什麼**, 而**不再描述本案做得到什麼**:§11b 實測
> 「要 policy 匹配就得 INHERIT, 而 INHERIT 會把表權限一起帶過去」
> ⇒ 📌 **本案收窄的是【BYPASSRLS】, 不是表權限。**

⚠️ **而收窄有一個天花板要先講**:`service_role` 的 `rolbypassrls = **t**`(2026-09-05 唯讀實測)
⇒ 📌 **只要它們還在用 `service_role`,收表級 `GRANT` 不會收掉「繞過 RLS」那一半。**
⇒ 🎯 **所以本案的價值【不是】少給幾個 GRANT,是【換掉那把鑰匙】** —— 這一句決定了下面的做法。

---

## 1. 現況(2026-09-05 唯讀實測,可重跑 `docs/probes/2026-09-05-service-role-min-scope.sh`)

| 持有 | 憑證(只寫名字) | 實際用到 | 憑證身分 |
|---|---|---|---|
| payment | `PAYMENT_CONFIRMER_DB_URL` | 35 支函式 · **0 張表** | `payment_confirmer`:`rolsuper=f` **`rolbypassrls=f`** `rolcreaterole=f` |
| email | `SUPABASE_SERVICE_ROLE_KEY` | 下面 §2 那 7 個物件 | `service_role`:**`rolbypassrls=t`** |
| cron | `SUPABASE_SERVICE_ROLE_KEY` | `sweeper_heartbeat` **1 張表** | 同上 |

🔵 **負對照(證明現況真的過寬,不是我猜的)**:挑 5 張**碼裡沒用到**的表 ⇒ `service_role` 的 `SELECT` 全 `t`,
`brands` 連 `DELETE` 都 `t`;`customers` 有 **`DELETE` + `TRUNCATE`**,而 email 那條路**只讀它**。

---

## 2. 最小該是什麼(逐個物件,從碼裡數出來的)

**email** —— 落點 `apps/storefront/src/lib/email/composition.ts`
🔬 **數法(剝掉註解再數,否則會把註解裡的例子算進來 —— 2026-09-05 踩過兩次)**:
```bash
python3 - <<'EOF'
import re,io,glob
for f in sorted(glob.glob('packages/adapters/src/email/*.ts')):
    if '.test.' in f: continue
    s=io.open(f,encoding='utf-8').read()
    s=re.sub(r'/\*.*?\*/','',s,flags=re.S)
    s='\n'.join(l for l in s.split('\n') if not l.lstrip().startswith('//'))
    t=sorted(set(re.findall(r"\.from\(\s*['\"`]([\w.]+)", s)))
    v=sorted({x for x in ('select','insert','update','upsert','delete') if re.search(r'\.'+x+r'\(', s)})
    if t or v: print(f.split('/')[-1], t, v)
EOF
```
⇒ 2026-09-05 讀數(7 個物件;`pcm_shipped_email_pending` 走常數 ⇒ 要另讀 `SupabaseShippedOrderScannerAdapter.ts:66`):
```
public.email_outbox              SELECT, INSERT, UPDATE      ← 唯一要寫的
public.orders                    SELECT
public.order_items               SELECT
public.customers                 SELECT
public.shipments                 SELECT
public.shipment_items            SELECT
public.pcm_shipped_email_pending SELECT   ← view(常數 SHIPPED_EMAIL_PENDING_VIEW,
                                             `SupabaseShippedOrderScannerAdapter.ts:66`)
```
🛑 **`DELETE` / `TRUNCATE` 一個都不需要** —— 而今天 `customers` 兩個都有。

**cron** —— 落點 `apps/storefront/src/lib/cron/composition.ts`
🔬 數法:`grep -nE '\.(select|insert|update|upsert|delete)\(' apps/storefront/src/lib/cron/composition.ts`
⇒ 2026-09-05 讀數 **2 行**(`:97 .select` · `:110 .upsert`),`.from()` 只有 `HEARTBEAT_TABLE`(`:85`)。
```
public.sweeper_heartbeat         SELECT, INSERT, UPDATE   ← `.upsert(onConflict:'job_name')` ⇒ 要 I+U
```
🟢 **它的射程本來就寫在碼裡**(`composition.ts:31-38` 逐字「只寫 `sweeper_heartbeat` 一張表;加第二張表 = 回來重看這一整段」)
⇒ 📌 **那一段就是「最小化被寫成一個會被撞到的東西」的樣子;email 那半沒有。**

---

## 3. 三個做法,而它們的差別在【能不能真的換掉鑰匙】

| | 做法 | 拿掉 BYPASSRLS? | 代價 | 前置 |
|---|---|---|---|---|
| **甲** | 照 `payment_confirmer`:建專用 PG 角色 + 專用 DB URL,兩道改走 **直連 pg** | ✅ 會 | 要把 7 支 adapter 從 PostgREST 改寫成 SQL | 無 |
| **乙** | 維持 PostgREST,但簽一把 **`role` claim = 專用角色** 的 JWT | ✅ 會(若成立) | 幾乎不動碼,只換 key | ⚠️ **未驗證** |
| **丙** | 只收 `service_role` 的表級 `GRANT`,不換角色 | ❌ **不會** | 最小 | 撞 `⟦b9-RLSHARDEN⟧` |

### 🟢🟢 **[2026-09-05 · 那個前提【驗掉了】—— 而只驗掉一半]**

⛔ ~~推薦【乙】,而它有一個我沒有驗證的前提~~ ⇒ ✅ **本機拋棄式 PG + PostgREST 實測(不碰正式庫)。**

**做法**:PG 17.10 拋棄式叢集 → 一張表 `api.secret_stuff` → 三個角色
(`web_anon` 零權限 / `narrow_reader` 有 `SELECT` / `zero_perm` 零權限)→ 起 PostgREST、自簽 HS256 JWT。

```
這一發                              http   回什麼
① 無 token(= web_anon, 零權限)      401    42501 permission denied
② JWT role=narrow_reader(有 SELECT)  200    [{"id":1,"note":"客人資料"}, …]   ← 🎯 真的拿到資料
③ JWT role=zero_perm(零權限)         403    42501 permission denied
```
🎯 **⇒ PostgREST 確實照 `role` claim 去 `SET ROLE`,而那個角色的權限【真的生效】。乙成立。**
🔴 **③ 才是關鍵那一格** —— 只有 ② 的話,「claim 生效」與「claim 被忽略而它用了某個寬鬆身分」
**會印同一個 200**。③ 印 403 ⇒ 證明它**真的切過去了**。
🔵 地面真相對照(同一發 `has_table_privilege`):`narrow_reader` = `t` · `zero_perm` = `f`,與 ②③ 一致。
🧹 收攤已驗:`pg_ctl stop rc=0` · 無殘留程序 · 目錄已刪並驗。

**官方文件那一半**(`https://supabase.com/docs/guides/getting-started/api-keys`,經 Supabase docs 搜尋當場讀):
> `role` **must be set to an existing Postgres role in your database**, such as `anon`, `authenticated`, or `service_role`.

🎯 **「an existing Postgres role in your database」是【開放式】的**,`such as` 後面那三個是舉例不是窮舉
⇒ **自訂角色與官方措辭相容**,而我本機也證明了機制成立。

### 🔴🔴 **而【另一半】沒驗掉,它會改變乙的壽命**

官方逐字:新的 `sb_publishable_...` / `sb_secret_...` **「no longer are based on the JWT signing key」**,
而它們被推出的理由之一逐字是:
> Tight coupling between the JWT secret (**which itself can be compromised, if you mint your own JWTs**),
> the `anon` / `service_role` / `authenticated` Postgres roles.

⇒ 🛑 **乙這條路【就是「mint your own JWTs」】,而那正是官方在勸退的那件事。**
⇒ ⚠️ **`sb_secret_...` 能不能對應到一個【自訂 Postgres 角色】—— 我查的那幾頁【沒有寫】⇒【未確認】。**
　**缺哪一道檢查**:要嘛在 Dashboard `Settings > API Keys` 開一把 secret key 看它有沒有「選角色」那一格,
　要嘛找到官方寫明它綁哪個角色的那一頁。**兩件我都沒做。**
🔵 而官方對 `sb_secret_...` 只寫到:它**取代 `service_role` key**、在瀏覽器用會回 401、
**可以「run a separate key per service」** —— 📌 **「每個服務一把 key」與「每把 key 一個自訂角色」不是同一件事**,
而前者被寫下來、後者沒有。

### ⇒ 所以推薦要改成兩層

```
乙-now  用【legacy JWT secret】自簽 role claim ⇒ ✅ 今天可行(上面實測)
        ⚠️ 而它騎在 Supabase 正在勸退的機制上 ⇒ 那是【技術債, 要寫進 commit body】
乙-next 若 sb_secret_ 能綁自訂角色 ⇒ 改用它, 不必自簽
        ⇒ 🛑 而那一格【未確認】, 動工前先去 Dashboard 看一眼(那是 Sean 的操作, 一分鐘)
```
🎯 **⇒ 端 Sean 的那一題不變(甲/乙),而【要多帶一句】:選乙的話,
我們會先用一個官方正在勸退的機制,換到一把不能繞過 RLS 的鑰匙。**
📌 **那個交換划不划算是他的判斷,不是我的** —— 我的責任是把兩邊都寫出來。

🔵 **丙不推** —— 它讓下一個人以為「收窄做完了」,而**最危險的那一半(繞過 RLS)原封不動**。
📌 **一個做了一半而看起來像做完的安全改動,比沒做危險。**

---

## 4. 要動哪些 env(**只寫名字,絕不寫值**)

```
新增   PCM_EMAIL_DB_URL   或 PCM_EMAIL_SUPABASE_KEY     (依甲/乙)
新增   PCM_CRON_DB_URL    或 PCM_CRON_SUPABASE_KEY      (依甲/乙)
不動   SUPABASE_SERVICE_ROLE_KEY   ← 🛑 這一顆【最後才拔】, 見 §5
不動   PAYMENT_CONFIRMER_DB_URL    ← 已經是收窄過的那一道
不動   NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_ANON_KEY
```
🔴 **`SUPABASE_SERVICE_ROLE_KEY` 還有沒有【別的消費者】,我沒有數過** ——
⇒ 📌 **拔它之前要先數,而那是一發 grep 加一次線上驗證,不是讀這份 plan 就能答的。**

---

## 5. 上線順序(而順序本身是安全設計)

```
① 建角色 + 給【成員資格】            ← 此時舊鑰匙還在用, 零風險
   ⛔ ~~給最小 GRANT~~ —— **§11b 實測推翻:成員資格會把表權限一起帶過去, 拿不到最小。**
② 兩道各自【加】新憑證, 但碼還走舊的  ← 只是把鑰匙放進去
③ 切 cron 一道過去, 觀察 48h         ← 🔵 先切 cron:它只碰 1 張表, 爆炸半徑最小
④ 切 email 過去, 觀察 48h            ← 它碰 7 個物件, 而其中有 PII(recipient_email)
⑤ 確認沒有別的消費者之後, 才收 service_role
```
🛑 **③ 排在 ④ 前面是刻意的** —— 兩道一起切的話,出事時**分不出是哪一道的權限給少了**。

---

## 6. Rollback

```
碼   : revert 那一顆(兩道各自獨立一顆 ⇒ 可以只退一道)
env  : 把該道切回 SUPABASE_SERVICE_ROLE_KEY, redeploy
DB   : DROP ROLE 之前要先 REASSIGN/DROP OWNED —— 而【新角色不擁有任何物件】(它只被 GRANT)
       ⇒ 直接 DROP ROLE 即可
```
🔴 **而 rollback 有一個【不對稱】要寫下來**:①②③④ 每一步都退得回去,
**而 ⑤(收掉 `service_role`)退回去要重新發鑰匙** ⇒ 📌 **⑤ 是單向門,前四步不是。**
⚠️ **`REVOKE` 錯了不會有測試紅** —— 症狀是**線上某條路開始 42501**,而那要人去看 log。
⇒ ✅ 所以 ③④ 那兩個「觀察 48h」不是客套,是**唯一會告訴我們做錯了的東西**。

---

## 7. 與 `⟦b9-RLSHARDEN⟧` 的先後

```
本案(SRVMIN)  = 把 email / cron 換成【不需要 BYPASSRLS】的鑰匙
b9-RLSHARDEN   = 把 service_role 自己的 BYPASSRLS 拿掉
```
🎯 **本案排前面,而那不是偏好,是依賴**:只要還有東西在用 `service_role`,
RLSHARDEN 那一刀下去就會**打到那些東西**。⇒ 📌 **本案是它的前置,做完會讓它的爆炸半徑變小。**
🛑 **而本案【不會】讓 RLSHARDEN 變成不必要** —— `service_role` 的 BYPASSRLS 照樣還在。

---

## 8. 誰審(鐵則 12②)

```
片型   高風險(權限)⇒ 全 9 步, 對抗審查不降級
關卡1  plan 層:codex-adversary 審【本檔】—— 而 §3 乙那個「未驗證的前提」要它專門打
關卡2  diff 層:codex 審 migration + composition 改動
第三輪 若前兩輪仍在抓到真 finding ⇒ 換 Fable 換角度(依 00-work-rules §5)
Sean   拍板才動(§3 甲/乙/丙 是一題;§5 的順序是另一題)
```

---

## 9. 這份 plan 證不到什麼

```
⛔ ~~① §3 乙那條路【我沒有實測】—— 那是推論~~ ✅ **[2026-09-05 驗掉了]** 本機拋棄式 PG + PostgREST 三發
   (401 / 200 帶資料 / 403), 而 ③ 那一格證明 claim 是【真的切過去】不是被忽略。
   🔴 **而【另一半】仍然未確認**:`sb_secret_...` 能不能綁自訂角色 —— 官方那幾頁沒寫,
      缺的檢查是「去 Dashboard `Settings > API Keys` 看有沒有選角色那一格」(Sean 一分鐘)。
   ⚠️ 而已驗的那一半騎在【官方正在勸退的 legacy JWT secret】上 ⇒ 那是技術債, 已寫進 §3。
② 「這些權限夠不夠跑完一次真實流程」我答不出 —— 我數的是【碼用到什麼】,
   而那與【跑起來需要什麼】差一個「函式內部還碰了誰」(DEFINER 之下那是 owner 的事)。
③ SUPABASE_SERVICE_ROLE_KEY 還有幾個消費者, 沒數過(§4)。
④ 本案的收益 = **拿掉 BYPASSRLS;表權限【不變】**(⛔ ~~外洩面積變小~~ —— §11b 推翻)
   而它沒有任何測試會紅
   ⇒ 📌 做完之後【不會有東西變綠】, 唯一的證據是那支 probe 重跑一遍讀數變窄。
```

---

## 10. 可重跑的驗收(做完之後拿它當證據)

```
bash docs/probes/2026-09-05-service-role-min-scope.sh
```
做完之後**那支 probe 的讀數該長這樣**(寫在動工之前,免得事後把觀察抄一遍當預期);
🔬 **今天的對照讀數**出自 `docs/probes/結果-service-role-min-20260905-0455.txt`,重跑那支 `.sh` 即可:
```
新角色 rolbypassrls   = f      ← 🎯 本案的全部意義在這一格
新角色 對 brands 的 SELECT = f  ← 🔵 負對照:今天 service_role 是 t
新角色 對 email_outbox     = SELECT/INSERT/UPDATE t · DELETE/TRUNCATE f
新角色 對 customers        = SELECT t · DELETE f · TRUNCATE f   ← 今天兩個都是 t
```
🛑 **而「讀數變窄」與「功能還活著」是兩個宣稱** ⇒ 觀察 48h 那一格顧的是後者。

---

## 11. 🔴🔴 **[2026-09-05 · 動手前的本機驗證推翻了 §2 的一半]**

主視窗裁 `9.甲`(現在做)之後,我先把「乙-now」端到端跑一遍。**成立的那半成立,而另一半塌了。**

### 11a. ✅ 端到端成立(拋棄式 PG + PostgREST,就緒判準用 log 的 `Schema cache loaded`)

```
① 無 token(web_anon)              401   🔵負對照
② 專用角色讀 orders                200   ✅
③ 專用角色寫 email_outbox          201   ✅
④ 非成員角色帶 JWT 讀 orders       401   🔵負對照
   pcm_email_writer bypassrls=false · service_role bypassrls=true
```
⇒ 🎯 **一個【是 `service_role` 成員、而自己沒有 BYPASSRLS】的角色,
做得到 email/cron 要做的事,且不會繞過 RLS。**

### 11b. 🛑 **而「最小 GRANT」那一半【做不到】—— 兩件事在 PostgreSQL 裡是綁死的**

```
表裡 1 列, policy 只寫 TO service_role。讀得到幾列 = policy 有沒有匹配:
  service_role 本人      ⇒ 1 列   🟢 正對照(這把尺會動)
  INHERIT 的成員         ⇒ 1 列   ✅ policy 匹配
  NOINHERIT 的成員       ⇒ 0 列   🔴 policy 【不】匹配
而 INHERIT 的成員同時【繼承 service_role 的全部表權限】——
實測:只給 service_role 的 DELETE, INHERIT 成員【真的刪得掉】(無錯誤);
NOINHERIT 成員 ⇒ `ERROR: permission denied`。
```
🎯 **⇒ 要 policy 匹配就得 `INHERIT`;而 `INHERIT` 就會把表權限一起帶過去。**
⇒ 📌 **§2 那張「7 個物件 + 1 張表」的最小清單,用成員資格【拿不到】** ——
新角色的表權限會與 `service_role` **完全相同**。

### 11c. ⇒ 所以這一案的真實價值要重寫

⛔ ~~收窄 = 少給幾個 GRANT + 拿掉 BYPASSRLS~~
✅ **收窄 = 【只】拿掉 BYPASSRLS。表權限一格都沒少。**
🔵 **而那仍然是主要的那一半** —— `BYPASSRLS` 是「無視所有 RLS」,
比多幾個表權限大一個量級;而 §1 的負對照也顯示今天 `service_role` 的表權限本來就很寬。
🛑 **但 plan 不能繼續宣稱「最小 GRANT」** —— 那句話現在是假的。

### 11d. 要裁的一題(我不自己選)

```
Q-收窄射程: 表權限那一半怎麼辦?
甲 = 接受「只拿掉 BYPASSRLS」, 表權限與 service_role 相同(推薦)
乙 = 不用成員資格, 改成把新角色加進【每一條 policy 的 TO 清單】
     ⇒ 今天 47 條 `%_select_service_role` + 第 0 步那 4 條, 而【每一條未來的 policy 都要記得加】
A: 甲|乙   ← 我推【甲】。理由:乙把一次性成本換成一條【永久的、沒有機制保護的規矩】,
              而那正是 ⟦b9-ZEROPOLICYSEAM⟧ 今天在發生的事;
              甲拿到的是那一案 90% 的價值, 而它的殘餘風險寫得出來。
```
⚠️ **而在這一題答之前,我【不寫】那支 migration** —— 寫了它就會宣稱一個我剛證明是假的東西。
