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
