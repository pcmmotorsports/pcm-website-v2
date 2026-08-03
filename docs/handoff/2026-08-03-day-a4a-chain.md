# 施工視窗① 收工交接:A4a→A4b 鏈(worktree `a4a-chain`)

> 2026-08-03 日間。基底 = dev `36cb453`;本 worktree 兩筆 commit:`cf24a64`(A4a)+ `7b26375`(A4b)。
> 主樹、STATUS.md、docs/handoff/CURRENT.md **一個 byte 都沒動**(紅線);busboy 未跑(worktree 手動交接)。
> **未 push、未 apply、未 db push** —— 併回與推送由主視窗/Sean 決定。

## TL;DR(白話)

A4a 是「讓後台三個數字(訂購/到貨/取消)自動算對」的資料庫機關,A4b 是它的雙連線競態證明。兩片全部完成:員工以後對訂單做採購、登記到貨、取消,摘要表會在同一交易內自動重算,沒有「忘記呼叫」這種事;搭配的安全網(超量取消/超量到貨/手改數字)全部通電。回滾程序寫好而且**真的演練過壞資料的那天怎麼辦**。審查跑了七輪(關卡1 三輪 35 條 + 關卡2 四輪 26 條),每一條都折掉或親驗駁回,最後一輪 PASS。

## 產物(全部在 `cf24a64` + `7b26375`)

| 檔 | 說明 |
|---|---|
| `supabase/migrations/20260803140000_m4b_e10_a4a_quantity_summary_recompute.sql` | 四 trigger + 五函式 + backfill + 檔內 DO;**未 apply** |
| `scripts/a4a-verify.sh` | 65/0(CELL 40 執行推導、MUT 10 執行計數、SKIP 0) |
| `scripts/a4a-rollback-rehearsal.sh` + `docs/runbooks/a4a-summary-rollback.md` | DoD 硬前置:六步 runbook(三形狀災難分流)+ 演練 19/0 |
| `scripts/a4b-concurrency-probe.sh` | 33/0(SA1-SA4 + SA2b/SA3b 消融;終態判別) |
| 兄弟修訂 ×5 | a2b1-verify(12 處,69/0)/ a2b2(S3 隔離 + **S5 翻紅**,37/0)/ a7 探針(25+32 重寫,36/36)/ a7t 探針(fixture,12/12)/ s1b(自建 fixture + 顯式清理,48/0) |
| `docs/specs/2026-08-03-e10-a4a-summary-recompute-plan.md`(v4)+ `docs/reviews/2026-08-03-e10-a4a-k1-codex.md` | plan 與七輪審查逐字紀錄 |

## 驗了什麼(實測,非推論)

- **家族終輪 from-zero 全綠零污染**:provision(A4a 檔內 DO 過)→ a4a 65/0(首)→ 演練 19/0 → a4b 33/0 → a2b1 69/0 → a2b2 37/0 → a7 36/36 → a7t 12/12 → s1b 48/0 → a6 157/0 → a2b1 69/0 → a4a 65/0(尾=首)→ a1-verify all 61/0。
- **消融鏈**:guard 鎖(a2b2 S3)、helper 鎖(SA2/SA2b)、sync 鎖(SA3b)三把鎖各自被「拿掉→壞給你看→還原→又正確」證明承重;oracle 三式自身被 H4/H4b 消融證明抓得到。
- **S5 翻紅兌現**(既定事項②):取消側寫入自 A4a 起被 parent NKU 序列化,契約債⑥超量窗口物理關閉。
- 三綠:typecheck 8/8 + lint 10/10(零 .ts/.tsx)。

## 審查鏈(輪次紀律:第 3 輪起換角度換模型)

關卡1:codex R1(19)→ R2(9)→ Fable R3(7)= 35 條全折、駁回 0 → **Sean 拍 Q1-Q5=A**。
關卡2:code-reviewer Fable R1 FAIL(1C+1I+6m)→ R2 PASS(8/8 真修);codex R1 NO-GO(9+1)→ R2 NO-GO(3+1)→ Fable R3 **PASS**(4 nit 全清)。
(opus code-reviewer 首發撞額度牆 5pm 重置,改派 Fable —— 高風險片在分級授權內。)

## 🔴 apply-DoD(等 Sean;正式站零改動)

1. `supabase db push --dry-run` 確認清單**恰一支** `20260803140000` → `db push`。
2. read-back:四 trigger 在位(tgtype 23/29、zc DEFERRABLE II、兩 ac NOT DEFERRABLE、enabled=O)+ 名稱序(guard_ac < zc)+ 五函式 proconfig/ACL + backfill NOTICE 應為 0/0(三表 0 列)+ 行為探針 NOTICE(正式站有真品項 ⇒ 會真跑:插撤各一筆採購/到貨、P4A01 擋直寫、零可見殘留)。
3. `database.types.ts` 重 gen 預期零 diff(trigger 不改表形狀)。

## 記債與殘餘(不擋收工、誠實列出)

- **三支既有 harness 排除出家族序跑**(皆與 A4a 無關):a7-verify(reapply 被 A7b FK 擋、07-31 起壞、錯誤被吞)/ a7t-verify(reapply 被自家「集合恰等」斷言擋 —— 該斷言把 trigger 集凍死,A7 線要重設計)/ a7bt×3(指向已 git rm 的 migration,歸 A7c 線)。排除期間 A7/A7-t 守門突變級覆蓋歸零,唯一發現者 = standalone probe + provision DO(已明寫兩處)。
- 已知死結環①②③(fail-closed 40P01)、INT_MAX 病理邊界 22003、名稱序一次性斷言債、A5a 回寫 runbook 停寫步驟 —— 全在 migration 檔頭契約債節與 plan §11。
- **MEMORY.md 逼近讀取上限(21.7KB/24.4KB)**:index 規則載明撤條目需 Sean 拍板 —— 待 Sean 一批決策。
- harness 環境:`/tmp/a4a-work` postmaster 收工時已停;⚠️ **a1-verify all 模式殿後會留自己的 postmaster(/tmp/a1v)佔 54329** —— 本 session 踩三次,重啟腳本前先 `pg_ctl -D /tmp/a1v/pgdata stop`。

## 主視窗接手清單

1. 驗併:`git log dev..a4a-chain`(兩筆)、按慣例 `--no-ff` 併回 dev;STATUS 七欄與 CURRENT 由主視窗更新(本視窗紅線未動)。
2. Sean:db push(上方 apply-DoD)→ 鏈下一片 **A5a**(`admin_upsert_item_procurement` owner RPC)已解鎖 —— 摘要重算與守門皆就位,A5a 不重複實作(master plan :379)。
3. 拍板已落檔:Q1-Q5=A = plan §9 + memory `project_m4b-a4a-recompute-decisions`(含本日新增技術實錘)。
