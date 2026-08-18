# Plan 草案 · 登入紀錄寫進自家 DB(Sean 2026-08-18 `Q04=乙`)

> 🔴 **狀態(2026-08-18 14:3x G4 更新):三個岔路 Sean 都拍了,但【plan 本身仍未批】。** 零檔案被動過(仍無 migration)。
> 提案人 W6(上線前安全),2026-08-18 12:15:30 CST;G4 接手續寫。
>
> ✅ **Sean 2026-08-18 13:20 拍板(逐字「5 題依照建議」;主視窗 14:2x 轉,落檔 memory `project_0818-sean-five-rulings-afternoon`)**:
> ```
> ① 新表 vs 併 admin_audit_log  ⇒ 甲:【開一張新表】
> ② 要不要記 IP                  ⇒ 甲:【記】
> ③ 保留政策                     ⇒ 甲:【90 天】
> ```
> 🔴 **而「併進 `admin_audit_log`」不只是沒被選,它【做不到】—— 我自己開檔量的**:
> ```
> supabase/migrations/20260712210000_m4a_admin_audit_log.sql
>   :85  REVOKE ALL ... FROM PUBLIC, anon, authenticated, service_role;
>   :89  GRANT INSERT ON TABLE public.admin_audit_log TO service_role;   ← 只有 INSERT
>   :113-115  FOREACH ARRAY['SELECT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER']
>             ⇒ service_role 拿到其中任何一個就 RAISE(apply 期 fail-closed)
> ```
> ⇒ 那張表 **service_role 沒有 SELECT(寫進去讀不出來)、沒有 DELETE(90 天保留做不到)**,
> 而 `:113-115` 會在它拿到 DELETE 時**直接讓整支 migration 失敗**。
> ⇒ **併表要成立,得先拆掉稽核表的 append-only 保證** —— 那是拿一個已驗證的安全性質去換一個便利。
> 📌 **我原本的推薦是併表,理由是「新表會重蹈 E683」。理由沒錯、結論錯了** ——
> 正確的處理是**照 E683 的方式把新表做對**(見 §3.1),不是躲開新表。
> **動 schema ⇒ 鐵則 8 + 鐵則 12③ ⇒ 必須 Sean 批准 + codex 對抗審查才可施工。**
> 量法(可重跑):`git status --porcelain supabase/ | wc -l` ⇒ 落筆時 **0**;
> 正向對照(證明這把尺對這個目錄量得到東西):`ls supabase/migrations/*.sql | wc -l` ⇒ 非 0。

---

## 🔴 檔頭必讀:兩個限定,引用本檔任何結論都要一起帶走

**限定一:乙涵蓋不到平台層的 log。**
乙只收「**我們自己寫的**」事件(`sso.login`)。**Vercel 那一層的 4xx/5xx、firewall 判定、
邊緣回應** —— 乙**收不到**。
⇒ **乙與甲(升 Pro)不是替代品。** Sean 選乙不代表甲不用做,只代表**先做便宜且不可逆地留下東西的那個**。

**限定二:方案別(Hobby)是 `2026-07-25` 的值,我沒有重查。**
來源 memory `reference_pcm-platform-plans-vercel-hobby-supabase-pro`。
⇒ **若 Sean 這段期間升過級,本案的急迫度要重算**(Pro = 1 天保留,而不是 1 小時)。

---

## 1. 為什麼(Sean 已拍板,本節只記依據)

```
Vercel 官方 Runtime Logs · Limits（last_updated 2026-08-03；W6 2026-08-18 親讀）
  Hobby 1 hour of logs
Vercel 官方 Drains · Usage and pricing（last_updated 2026-07-22）逐字：
  「Drains are available to all users on the Pro and Enterprise plans. …
    If you are on the Hobby or Pro Trial plan, you'll need to upgrade to Pro」
```
⇒ **鑑識視窗 = 一小時**,而「把 log 送去別的地方存」在 Hobby 上**做不到**。
⇒ Sean `Q04=乙`:寫進自己的 DB。

🔴 **而乙不是新設計** —— `apps/admin/src/lib/sso/security-log.ts:3-5` 檔頭逐字自陳:
> 「這**不是** admin_audit_log 正式接線。全 admin_audit_log DB 接線=**S3b**
> (Sean Q2=A 已延後登入稽核/身分整合);本檔只寫結構化 server log…**best-effort:不擋登入**。」

⇒ **乙 = 把 S3b 那條線走完**,不是開一條新線。

## 2. 現況(每條附量法)

```
唯一的登入軌跡：apps/admin/src/lib/sso/security-log.ts
  有   evt / outcome / request_id / source_app / reason / amr
  沒有 🔴 來源 IP、🔴 User-Agent、🔴 是哪個人（source_app 恆為 'quote' 字面，:26）
呼叫點：app/api/sso/callback/route.ts:11 import { logSsoLogin }
落點：console.info / console.warn ⇒ Vercel runtime log ⇒ 1 小時後消失
```
⚠️ **Vercel 自己的 log row 另有 `Request User Agent` 與 `Region`**(官方 Log details 表)
—— **但那張表沒有 IP 欄**,而且同樣受 1 小時保留限制。

## 3. 要做什麼(草案,未定案)

**骨架(刻意留最小)**:
```
新表 admin_sso_login_events（或併進既有 admin_audit_log —— 🔴 這是第一個要 Sean/主視窗裁的岔路）
  occurred_at   timestamptz not null default now()
  outcome       text not null            -- 'success' | 'fail'
  reason        text                     -- 失敗類別，成功為 null
  amr           text                     -- 'pwd+totp' 之類，非敏感
  request_id    text                     -- 對得回 Vercel log（在它還在的那一小時內）
  source_app    text not null            -- 目前恆 'quote'
寫入端：security-log.ts 現有那支函式旁邊加一條 DB 寫入（best-effort，不擋登入）
```
~~🔴 **本草案【刻意不決定】的三件**~~ ✅ **三件 Sean 都拍了(見檔頭)**:新表 / 記 IP / 90 天。
（原文留痕:① 新表 vs 併進 `admin_audit_log` ② 要不要記 IP ③ 保留多久 / 誰清。）

### 3.1 🔴 新表要怎麼做才不會重蹈 `E683`(這是拍「新表」之後真正的工作)

**形狀直接抄 `admin_audit_log` 那一份,不要自己發明**(`20260712210000_m4a_admin_audit_log.sql`):
```
1. REVOKE ALL ON TABLE <新表> FROM PUBLIC, anon, authenticated, service_role;   ← 🔴 出生自帶的 Dxtm 在這裡收掉
2. 只 GRANT 真的要用的：INSERT（寫登入事件）+ SELECT（出事那天要查得到）TO service_role
3. ENABLE ROW LEVEL SECURITY + zero-policy（縱深：誤 grant 時的第二道）
4. apply 期 fail-closed 斷言：client 三角色零權限 / service_role 恰 2 筆 / relacl allowlist / RLS 已開 / policy 數 = 0
   🔴 斷言要用【欄級版】(information_schema.column_privileges)——
      `has_table_privilege` 看不到欄級授權(E 窗 2026-08-17 實測少報 2 vs 實際 3)
```
📄 兩道 REVOKE 的完整說明:`docs/patterns/revoking-function-execute-in-supabase.md`(**檔名比範圍窄,表也在裡面**)。
🔴 **apply 之後要用 `scripts/check-anon-grants-prod.sh` 對正式庫複驗一次** —— migration 內的斷言證明的是
「apply 當下」,那支腳本證明的是「現在」。兩者不同,而 E683 的病灶正是「出生自帶」。

### 3.2 🔴 90 天保留怎麼做,而**不**把 DELETE 交給 service_role

保留政策需要有人刪列,而**把 `DELETE` GRANT 給 `service_role` = 這張表從此不是 append-only**
(誰拿到那把 key 就能把自己的登入紀錄刪掉 —— 那正是這張表要防的人)。
**改用 owner-defined `SECURITY DEFINER` 清理函式**:
```
函式 owner = postgres，search_path=''，內文只刪 occurred_at < now() - interval '90 days'
GRANT EXECUTE TO service_role（只給執行權，不給 DELETE 權）
排程：pg_cron（現有三個 job 的同一條路：pcm-settle-sweep / pcm-anomaly-alert / pcm-expire-unpaid-orders）
🔴 驗法要有斷言：跑完之後「逾期列 count = 0」，而且要餵一列【91 天前】的假資料進去看它真的被刪
   （只跑一次看沒報錯 = 在兩個世界印同一個東西）
```
⚠️ **IP 是 PII** ⇒ 90 天到期即刪、**log/告警/錯誤訊息一律不得帶 IP 原值**(鏡像 PRD §7 對 email 的規則)。

## 4. 這個草案**不解決**什麼(照 §⑬ 的紀律,落地時就寫)

```
· 平台層 log（見檔頭限定一）
· 「沒有人在看」—— 有了表不等於有人會查；通知/告警是另一題，未立案
· #436 稽核可冒名 —— 那是身分面，前置是 E8-B，本案不碰
```

## 5. 怎麼驗它已補齊(兩個世界印不同的東西)

```
登入一次（成功）＋故意失敗一次，然後【等超過一小時】再查：
  未補齊 ⇒ Vercel log 已無該筆，DB 也沒有 ⇒ 查不到那次登入
  已補齊 ⇒ DB 仍有兩列，outcome 分別是 success / fail
🔴 判別器是【超過一小時之後還查不查得到】——
   一小時內兩個世界都查得到（Vercel log 還在），拿它當判準等於沒判。
```

## 6. 誠實缺口

- **仍然沒有寫任何 SQL,也沒有碰 `supabase/`。**
- 🔴 **三個岔路已拍 ≠ 這份 plan 已批。** 它動 schema ⇒ **鐵則 8 + 12③** ⇒ 還要 Sean 批這份 plan、
  且 commit 前要跑對抗審查。**「Sean 答了那三題」不等於「可以開始寫 migration」。**
- ~~**§3 的欄位是提議,不是定案** —— 三個岔路未拍板前不該寫 migration。~~ 岔路已拍;欄位仍是提議。
- ⚠️ **未量**:正式庫現在有沒有 `pg_cron` 可用的排程窗口(§3.2 假設走既有那條路,我沒查那三個 job 的健康狀態)。
- **限定二(方案別未重查)若被推翻,整份的急迫度要重算。**

---
**W6(上線前安全)。等批。**

---

# 7. 🔴 可送批的 plan 本體(2026-08-18 G4 續寫;三個岔路已拍之後的東西)

> **狀態**:**未批、零 SQL 落地**。動 schema + GRANT ⇒ **鐵則 8 + 12③** ⇒ Sean 批 + 對抗審查才可施工。
> **量測環境**:主樹 `dev`,2026-08-18 15:0x CST。

## 7.1 表(欄位定案版)

```sql
CREATE TABLE public.admin_sso_login_events (
  id           uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  occurred_at  timestamptz NOT NULL DEFAULT now(),   -- DB 權威時間，server 不回填（防竄改；鏡像 admin_audit_log:53）
  outcome      text        NOT NULL,                 -- 'success' | 'fail'
  reason       text,                                 -- 失敗類別；成功為 NULL
  amr          text,                                 -- 'pwd' / 'pwd+totp'…非敏感
  request_id   text,                                 -- 對得回 Vercel log（在它還在的那一小時內）
  source_app   text        NOT NULL DEFAULT 'quote',
  ip           inet,                                 -- 🔴 PII（Sean 2026-08-18 拍「記」）；解析不出 ⇒ NULL
  user_agent   text,
  CONSTRAINT admin_sso_login_events_outcome_check CHECK (outcome IN ('success','fail')),
  CONSTRAINT admin_sso_login_events_source_app_check CHECK (source_app IN ('admin','quote'))
);
```
🔴 **`ip` 用 `inet` 不用 `text`**:型別本身就是驗證,而**解析不出來時寫 NULL、不寫原字串** ——
`x-forwarded-for` 是**客戶端可控**的標頭,原封存進去等於把一個未驗證字串留在稽核表裡。
⚠️ **代價寫在這裡**:proxy 後面拿到的可能是一串 IP,**取哪一個是 app 層的決定**,而那個決定會影響鑑識結論
⇒ 實作時要在 code 註解寫明取法,不要讓下一個人以為那是「客人的 IP」這麼單純。

## 7.2 權限(**這一段是本片的重點,不是附屬**)

```sql
REVOKE ALL ON TABLE public.admin_sso_login_events FROM PUBLIC, anon, authenticated, service_role;
GRANT INSERT, SELECT ON TABLE public.admin_sso_login_events TO service_role;
ALTER TABLE public.admin_sso_login_events ENABLE ROW LEVEL SECURITY;   -- zero-policy（縱深）
```
- **為什麼要 `SELECT`**(與 `admin_audit_log` 的差別,要申報):那張表是純 append-only、`service_role` **只有 INSERT**
  (`20260712210000_m4a_admin_audit_log.sql:89`,且 `:113-115` 拿到 SELECT 就 RAISE);
  **而本表存在的理由是「出事那天查得到」** ⇒ 沒有 `SELECT` 這張表等於白建。
- **為什麼仍然沒有 `DELETE`**:見 §7.3 —— **保留政策不靠 `service_role` 刪**。
- 🔴 **為什麼 `REVOKE` 那一行不是形式**:網站庫的預設授權**現在仍是壞的**
  (`grantor=postgres` 那半仍有 `anon=Dxtm`,含 TRUNCATE;2026-08-18 Sean 實跑、主視窗轉錄 `MAIN-028/029`)
  ⇒ **在 `E683` 那支 migration apply 之前建的每一張新表,出生就自帶 `anon` 的 TRUNCATE**,
  而 **`TRUNCATE` 不受 RLS 管** ⇒ **這一行是唯一擋得住它的東西。**

## 7.3 90 天保留:**清理權不給 `service_role`**

```sql
CREATE OR REPLACE FUNCTION public.purge_admin_sso_login_events()
RETURNS integer LANGUAGE sql SECURITY DEFINER SET search_path = '' AS $$
  WITH d AS (DELETE FROM public.admin_sso_login_events
              WHERE occurred_at < now() - interval '90 days' RETURNING 1)
  SELECT count(*)::integer FROM d;
$$;
REVOKE ALL ON FUNCTION public.purge_admin_sso_login_events() FROM PUBLIC;   -- 🔴 見下
GRANT EXECUTE ON FUNCTION public.purge_admin_sso_login_events() TO service_role;
```
🔴 **那道 `REVOKE ... FROM PUBLIC` 是必要的,而它的依據是今天量到的**:
```
新建函式的 pg_proc.proacl 是 NULL，而 NULL【不是零權限】——
acldefault('f', owner) ⇒ {=X/postgres,postgres=X/postgres}   ← 開頭那個 =X 就是 PUBLIC 的 EXECUTE
行為面同一發：proacl=NULL 的函式 has_function_privilege('anon',…,'EXECUTE') ⇒ true
（G4 2026-08-18 於拋棄式 PG 17.10 實測；正式庫 17.6 ⇒ 這一發證的是機制不是現值）
```
⇒ **不寫那一行,`anon` 就能執行這支刪除函式。** 正典:`docs/patterns/revoking-function-execute-in-supabase.md:264`。
**排程**:pg_cron 每日一次(鏡像既有三個 job 的路,`20260723120000_m3_s2_settle_sweep_pgcron.sql:128-131`)。
⚠️ **未量**:正式庫 pg_cron 的可用性與現有三個 job 的健康狀態,我沒查。

## 7.4 apply 期 fail-closed 斷言(形狀抄 `admin_audit_log:99-125`,**加兩格**)

```
a. client 三角色 7 權限全零                                   ← 抄既有
b. service_role 恰有 INSERT + SELECT，其餘 5 權限全零          ← 本表特有（含「不得有 DELETE」）
c. relacl allowlist：owner / service_role 以外的 grantee 零筆
d. 🔴 欄級：attacl 必須全空
   （has_table_privilege 看不到欄級 —— E 窗 2026-08-17 實測少報 2 vs 實際 3）
e. RLS 已 ENABLE 且 policy 數 = 0
f. 🔴 purge 函式：PUBLIC 不得有 EXECUTE
   量法 has_function_privilege('anon','public.purge_admin_sso_login_events()','EXECUTE') ⇒ 必須 false
```

## 7.5 驗收(**每一格都要配一發突變,看到紅才算**)

| # | 斷言 | 突變(必須紅) |
|---|---|---|
| 1 | 登入成功 ⇒ 表裡多一列 `outcome='success'`、`ip` 是那台機器的位址 | 把寫入那段拿掉 |
| 2 | 登入失敗 ⇒ 多一列 `outcome='fail'` 且 `reason` 非空 | 讓失敗路徑不寫 |
| 3 | 🔴 **DB 掛掉時登入仍然成功**(best-effort 不擋登入) | 把 try/catch 拿掉 ⇒ 這格必紅 |
| 4 | 清理函式:餵一列 **91 天前**的假資料 ⇒ 跑完 count=0;另餵一列 **89 天前** ⇒ 仍在 | 把 interval 改成 `100 days` |
| 5 | `anon` / `authenticated` 對本表 7 權限全零 | 在 migration 裡補一行 `GRANT SELECT … TO anon` ⇒ 斷言必須 RAISE |
| 6 | `PUBLIC` 不得執行 purge 函式 | 拿掉 `REVOKE … FROM PUBLIC` ⇒ 斷言必須 RAISE |
| 7 | log/告警/回應 **不得出現 IP 或 UA 原值** | 在 console log 裡塞 `ip` ⇒ 那格必紅 |

🔴 **#4 與 #6 是這片真正的守門** —— 其餘幾格在 `admin_audit_log` 那支已有同型前例。
🔴 **斷言要先表演【該紅的那一發】**:apply **之前**跑同一段斷言,`a`/`f` 兩格**必須 RAISE**(現況就是壞的)
—— 沒表演過兩個世界的斷言不算守門。

## 7.6 rollback

```
DROP TABLE public.admin_sso_login_events;   ← 連帶 PK / 2 CHECK / grant 一併消失
DROP FUNCTION public.purge_admin_sso_login_events();
🔴 而【資料會一起消失】⇒ 這是 PII，rollback 前先問「那些列還需不需要」
⚠️ 寫入端（security-log.ts）的 revert 要與 DROP 同一次部署，否則它會對著不存在的表寫、每次登入吃一個 catch
```

## 7.7 這一片**不做**什麼

```
· 不做告警／不做「有沒有人在看」——有了表不等於有人會查（那是另一題，未立案）
· 不碰 #436（稽核可冒名）——那是身分面，前置是 E8-B
· 不收平台層 log（4xx/5xx、firewall）——乙涵蓋不到，見檔頭限定一
· 不動 admin_audit_log 一個字
```

## 7.8 🔴 施工順序(有一個硬前置)

```
E683 那支 migration（20260817060000_…）apply 到網站庫
   ⇒ 之後建的新表才不會出生自帶 anon=Dxtm
   ⇒ 本片的 REVOKE 仍然要寫（縱深），但先後順序會決定「中間那段時間有沒有裸露的表」
🔴 而 E683 那支【已批、code 已落地、未 apply】（APPLIED.tsv 查無 20260817060000，分母 179 列）
   ⇒ 它卡在 apply 不卡在 plan
```
