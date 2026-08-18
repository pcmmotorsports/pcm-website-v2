# Plan 草案 · 登入紀錄寫進自家 DB(Sean 2026-08-18 `Q04=乙`)

> 🔴 **狀態:草案,尚未批准,零檔案被動過。** 提案人 W6(上線前安全),2026-08-18 12:15:30 CST。
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
🔴 **本草案【刻意不決定】的三件(要拍板,不是我可以自己選的)**:
```
① 新表 vs 併進 admin_audit_log —— 後者已有 actor 欄，但 #436 說那一欄不可信
② 要不要記 IP —— 記了鑑識力大增，但那是 PII，要 Sean 拍
③ 保留多久 / 誰清 —— 沒有保留政策的稽核表會長到沒人敢動
```

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

- **我沒有寫任何 SQL,也沒有碰 `supabase/`。** 本檔是草案。
- **§3 的欄位是提議,不是定案** —— 三個岔路未拍板前不該寫 migration。
- **限定二(方案別未重查)若被推翻,整份的急迫度要重算。**

---
**W6(上線前安全)。等批。**
