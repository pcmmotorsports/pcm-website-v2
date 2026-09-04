# Plan:ACL 漂移的【執行期】偵測 —— 路⑤(dashboard / SQL Editor 手動改權限)

> 板列 `⟦b9-ACLDRIFT5⟧`(`docs/launch-todo.md:495`,錨是 2026-09-05 線 `-db` 補的 —— **在那之前它是無錨列,不在任何盤點的分母裡**)。
> 相關:`⟦b9-RLSHARDEN⟧`(`docs/launch-todo.md:499`)。
> 🔴 **本檔零 apply、零新 migration** —— 它只規劃。要不要做、什麼時候做,見檔尾那一題。

## 1. 它要補的是哪一個洞

`scripts/acl-snapshot.sh` 今天守得住的是**進到 repo 的那條路**:有人改了權限、commit 了、CI 或人跑一次快照 ⇒ 差異看得到。
🛑 **而它守不到「有人在 Supabase dashboard / SQL Editor 直接下 `GRANT`」** —— 那條路**不經過 repo**,所以:
- 快照要**有人主動跑**才會發現(`scripts/acl-snapshot.sh:265` 起是比對段,沒有任何排程在叫它)
- 而**沒有人每天跑它** ⇒ 📌 **一道正確的閘,掛在一個不會自己響的鈴上。**

⚠️ **而這一段自己也有射程**:我證得到「repo 裡沒有排程呼叫它」(全樹 `cron.schedule` 六條逐條列在 §3,沒有一條打它);
　 **我證不到「沒有人手動跑」** —— 那不在任何載體上。

## 2. 做法(一句話)

**把七族快照改寫成一支 SQL 函式,pg_cron 每天算一次 hash,存進一張小表;與 repo 那份的 hash 不同 ⇒ 進 `pcm-anomaly-alert` 那封信一列。**

### 2a. 為什麼是 hash 不是全表
`supabase/acl-snapshot.tsv` 今天 **1283 列**(`supabase/acl-snapshot.tsv`,當場 `wc -l`)。
把 1283 列存進 DB 再逐列比,值不會比一個 hash 多告訴你什麼 —— **信裡那一列要回答的是「今天有沒有人動過」,不是「動了哪一格」**。
✅ 「動了哪一格」由**人收到信之後跑 `bash scripts/acl-snapshot.sh`** 得到 —— 那支已經會逐族印差異(`scripts/acl-snapshot.sh` 的「逐族格數」段)。
📌 ⇒ **偵測與診斷分開**:偵測要便宜且每天跑,診斷要詳細且只在有事時跑。

### 2b. 表結構(建議)
```
public.pcm_acl_snapshot_digest
  taken_at    timestamptz  PK DEFAULT now()
  digest      text         NOT NULL   -- md5 of the seven-family text
  row_count   int          NOT NULL   -- 🔴 與 digest 一起存:digest 一樣而列數不同是不可能的,
                                      --    它是一個「這支 SQL 有沒有整段沒跑」的免費對照
  families    jsonb        NOT NULL   -- 每族各自的 md5 與列數 ⇒ 信裡可以說「是 FN 族變了」
```
🔴 **`families` 那一欄的理由**:只有總 hash 的話,信只能說「有東西變了」,而收信人第一個問題一定是「哪一族」。
　 存七個小 hash 幾乎不花錢,而它把那封信從「你去查」變成「你去查 `FN` 族」。

### 2c. 誰能讀寫那張表(REVOKE 形狀)
照 `supabase/migrations/20260905100000_m4b_definer_searchpath_lock_m1a.sql` 那張回滾表的形狀:
```
REVOKE ALL ON TABLE public.pcm_acl_snapshot_digest FROM PUBLIC;
REVOKE ALL ON TABLE public.pcm_acl_snapshot_digest FROM anon, authenticated;
REVOKE ALL ON TABLE public.pcm_acl_snapshot_digest FROM service_role, payment_confirmer;
ALTER TABLE public.pcm_acl_snapshot_digest ENABLE ROW LEVEL SECURITY;
-- RLS-GATE-EXEMPT: pcm_acl_snapshot_digest -- 只給 postgres 與那支 cron 用;四個應用角色四道 REVOKE 全收。
```
🔴 **四道 REVOKE 不是三道** —— 具名 `service_role` 收不到的話,`TRUNCATE` 留著,**而 RLS 不管 `TRUNCATE`**
　 (codex 2026-09-05 在 M1a 抓到的同一條;`supabase/migrations/20260905100000_m4b_definer_searchpath_lock_m1a.sql` 那段註解)。
🛑 **而告警要讀得到它** —— 讀取端若是 `service_role`,那就**只給它 `SELECT`**,不要給整包。

### 2d. 信裡那一列接在哪
訊號在 use-case 算、route 決定寄不寄:
- `packages/use-cases/src/check-anomaly-alerts.ts:73` `CheckAnomalyAlertsResult`
- 既有同型欄位可照抄:`bypassRlsUnknown`(`:211`)· `emailOutboxUnknown`(`:242`)
- `shouldAlert` 的紀律逐字在 `:1556`:**「只有明確的 `true` 才進」,`Unknown` 不在這道閘裡**
- 🔴 而 `Unknown` 要**帶出去**(`:1668-1671` 那段寫得很清楚:不帶出去 ⇒ route 讀不到)
⇒ **新增兩格**:`aclDriftDetected: boolean`(真的不同 ⇒ 進 `shouldAlert`)+ `aclDriftUnknown: boolean`(讀不到 ⇒ **不**進 `shouldAlert`,走 log / 503 那條路)。

## 3. 六條既有 cron 對齊(逐條)

| jobname | schedule | 出處 |
|---|---|---|
| `pcm-anomaly-alert` | `0 1 * * *` | `supabase/migrations/20260723120000_m3_s2_settle_sweep_pgcron.sql` |
| `pcm-settle-sweep` | `*/2 * * * *` | 同上 |
| `pcm-capture-recheck` | `*/10 * * * *` | `supabase/migrations/20260820070000_m4b_capture_recheck_pgcron.sql` |
| `pcm-email-sweep` | `*/5 * * * *` | `supabase/migrations/20260819160000_m4a_e2b_email_sweep_pgcron.sql` |
| `pcm-expire-unpaid-orders` | `0 * * * *` | `supabase/migrations/20260809170000_m4b_lifecycle_l3b_expire_unpaid_orders_schedule.sql` |
| `pcm-order-ineligible-gate` | `*/2 * * * *` | `supabase/migrations/20260820060000_m4a_e2a2_order_ineligible_gate_pgcron.sql` |

**新的那一支排在哪**:`0 0 * * *`(每天 00:00),**比 `pcm-anomaly-alert` 的 `0 1 * * *` 早一小時**
⇒ 告警跑的時候,今天的 digest 已經在表上。
🔴 **而「早一小時」是一個假設不是保證** —— 那支 SQL 若跑超過一小時,告警會讀到**昨天的** digest。
　 ⇒ 所以信裡那一列要**帶 `taken_at`**,而 use-case 要把「digest 太舊」算成 `aclDriftUnknown`,不是「沒事」。
　 📌 **少了這一格,一支壞掉的 cron 會讓那封信每天說「權限沒變」。**

## 4. 誤報來源(這一節必讀,它決定這道閘活不活得下來)

🔴🔴 **貼板當天必紅** —— Sean 貼任何一支動 `GRANT` / 建物件 / 建 policy 的 migration,正式庫的 ACL 就會與 repo 那份不同。
今晚就是活生生的例子:貼 `20260904270000` 之後,快照差異是 **40 POL 新列 + 8 格 REL + 4 列新表**(2026-09-05 實測)。
⇒ **那不是漂移,那是我們自己做的。**

✅ **修法不是把閘調鬆,是把【更新基線】變成貼板流程的一步**:
`docs/runbooks/2026-09-05-paste-kit.md` 每一支的「貼完該看到」那節,加一句
「**貼完跑 `bash scripts/acl-snapshot.sh --write` 並把它 commit**」。
⚠️ 而 `--write` 的輸出自己就寫著「**你剛剛宣告了現在這個樣子是對的 —— 那是一個決定**」(`scripts/acl-snapshot.sh`)。
⇒ 那句話要留著:**基線更新是一個決定,不是一個步驟。**

**其他誤報來源(想到的都列出來,想不到的請 codex 補)**:
1. Supabase 平台自己升級 ⇒ 內建角色的權限變 ⇒ 我們沒動而 digest 變。**處置:先觀察,不要第一天就加白名單。**
2. `--write` 的人與貼板的人不同 ⇒ 基線晚一天更新 ⇒ 中間那天紅。
3. 🔴 **repo 那份 hash 怎麼給 DB 讀?** DB 讀不到 repo。⇒ **兩個選項**:
   (a) 把 repo 的 hash 當 env 餵給告警端(它在 `apps/storefront`,讀得到 repo build 時的值)
   (b) 每次 `--write` 時把 hash 也寫進 DB 一列當「已批准的基線」
   ⇒ **(b) 比較誠實但要一次寫入授權;(a) 零授權而綁部署**。這一格我沒有拍板,列給 codex 與 Sean。

## 5. Rollback

`DROP TABLE public.pcm_acl_snapshot_digest;` + `SELECT cron.unschedule('pcm-acl-digest');` + use-case 那兩格移除。
🔵 **它不改任何既有物件的權限** ⇒ 回滾不會留下半個狀態。
⚠️ 而 `cron.unschedule` 要用**名字**不要用 jobid(jobid 會變)。

## 6. 🛑 這份 plan 證不到什麼

- 我**沒有**在正式庫跑過任何一句(零 apply)。上面的表結構與排程都是**設計**,不是量到的。
- 「六條 cron」是**repo 字面**(`cron.schedule(` 的 grep);**正式庫實際有幾條我這一輪沒查** —— 板 `⟦b4-CRONWHOSCHEDULES⟧` 那條路才是實測。
- `families` 那一欄的成本我沒量:七個 md5 對 1283 列的表要跑多久,**要在拋棄式 PG 上量一次再定 schedule**。
