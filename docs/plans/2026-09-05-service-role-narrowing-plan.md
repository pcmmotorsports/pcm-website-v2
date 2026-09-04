# Plan · 把 email / cron 兩道 `service_role` 收窄成專用角色

> 線【身分】`-auth` · 2026-09-05 · 主視窗 `-94` 派(`⟦b9-SRVMIN⟧` 量完之後)
> 🛑 **本檔是 plan,不 apply。** 動 `GRANT` / 建角色 = **鐵則 12②(權限)** ⇒ 要 Sean 拍板 + codex 對抗審查。
> 🟢 **範本不是我發明的,是本 repo 已經在跑的那一個** —— `payment_confirmer`。

---

## 0. 一句話

> **付款那道已經收窄好了(專用角色、不能繞 RLS、零表權限、只能呼叫函式)。
> 寄信與排程那兩道還在用萬用鑰匙,而它們實際只需要 7 個物件與 1 張表。**

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

🔴 **推薦【乙】,而它有一個【我沒有驗證的前提】** —— PostgREST 會照 JWT 的 `role` claim 去 `SET ROLE`,
所以理論上可以簽一把 `role = pcm_email_writer` 的金鑰。
🛑 **但我【沒有】在這個專案上實測過它** ⇒ 📌 **這是【推論不是量測】。**
⇒ ✅ **所以乙的第一步不是動工,是【花 20 分鐘證明它成立】**:建一個零權限測試角色、簽一把 key、打一發、
看它回 42501(權限不足)還是 200。**回 200 ⇒ 乙成立;回別的 ⇒ 退甲。**
⚠️ 而 Supabase 近年推的 publishable/secret key 是否仍走同一條 JWT 路徑,**我也沒查** ⇒ 一起在那 20 分鐘裡驗。

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
① 建角色 + 給最小 GRANT              ← 此時舊鑰匙還在用, 零風險
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
① §3 乙那條路【我沒有實測】—— 那是推論。第一步就是去證它, 不是照它動工。
② 「這些權限夠不夠跑完一次真實流程」我答不出 —— 我數的是【碼用到什麼】,
   而那與【跑起來需要什麼】差一個「函式內部還碰了誰」(DEFINER 之下那是 owner 的事)。
③ SUPABASE_SERVICE_ROLE_KEY 還有幾個消費者, 沒數過(§4)。
④ 本案的收益是【外洩面積】, 而外洩面積沒有任何測試會紅
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
