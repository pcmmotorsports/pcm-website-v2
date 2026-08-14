# 2026-08-14 · #452 片 2a-2 甲 · codex 對抗審查 R1(關卡2,審 diff)

> 模型 `gpt-5.6-sol` / `-s read-only` / 背景跑(C-7)/ 零留痕已驗(前後 `git status --porcelain` 相同)。
> **VERDICT: FAIL** —— 7 must-fix + 2 nit。逐條處置見下。

codex
我會用 `pcm-codex-inspector` 做唯讀對抗審查，並套用 PostgreSQL review 規則檢查 migration/RPC。先核對 repo 現況與指定 SSoT，再逐條追 migration、原始 RPC、trigger、探針及應用碼；全程不改檔、不 commit、不 push。
  → 讀取審查技能、memory 索引與 repo SSoT／Git 現況
  • 比對新 migration 與原 RPC、trigger、schema 約束
  • 核驗併發探針、DO block、應用碼與上線順序
  • 執行唯讀語法／測試檢查並整理 findings
2026-08-14T03:23:08.660502Z ERROR codex_models_manager::manager: failed to renew cache TTL: missing field `base_instructions` at line 94 column 5
exec
/bin/zsh -lc "wc -l /Users/sean_1/.agents/skills/pcm-codex-inspector/SKILL.md /Users/sean_1/.agents/skills/postgresql-code-review/SKILL.md && sed -n '1,240p' /Users/sean_1/.agents/skills/pcm-codex-inspector/SKILL.md && sed -n '1,260p' /Users/sean_1/.agents/skills/postgresql-code-review/SKILL.md" in /Users/sean_1/pcm-procure-void
 succeeded in 0ms:
     109 /Users/sean_1/.agents/skills/pcm-codex-inspector/SKILL.md
     212 /Users/sean_1/.agents/skills/postgresql-code-review/SKILL.md
     321 total
---
name: pcm-codex-inspector
description: Use whenever Sean asks Codex to be the PCM "檢查者", review a Codex Review Packet, inspect docs/reviews/*.md, or answer findings / risks / whether to continue for pcm-website-v2. This skill enforces read-only review posture, packet-vs-repo fact checking, PCM AGENTS.md rules, and must-fix / consider / nit output.
---

# PCM Codex Inspector

You are the external Codex reviewer for `/Users/sean_1/pcm-website-v2`.

## Trigger

Use this skill when the user says:

- "審查"
- "檢查者"
- "Codex Review Packet"
- "Ready for review"
- "唯讀審查"
- "fresh-context code reviewer"
- asks to review a file under `docs/reviews/`

## Posture

Default to independent fresh-context packet review.

Do not edit files, commit, push, stage, reset, or run destructive commands unless the user explicitly changes the task away from review. Reading files and running read-only commands such as `git status`, `git log`, `git diff`, `rg`, `sed`, `nl`, and syntax checks is allowed.

If the user explicitly says "只審 Packet 字面" or "不要假裝執行命令", do not claim to have run commands. In that mode, reason only from the packet text and say when a point cannot be verified from the packet.

## Required Workflow

1. Read the packet or review file fully.
2. Check current repo facts if the repo is available:
   - `git status --short --branch`
   - `git log --oneline -8`
   - relevant `git diff` / `nl -ba` for file:line evidence
3. Compare packet claims against reality:
   - branch / HEAD / ahead count
   - commit sequence
   - changed files / diff stat
   - validation claims
   - rollback or push instructions
4. Review against PCM rules:
   - `AGENTS.md` 鐵則 1-12
   - security / RLS / GRANT / migration / schema risks
   - pricing / dealer tier / order / cart / payment risks
   - manifest / business_overrides / open_drifts consistency

---

# R2(同模型 `gpt-5.6-sol`,2026-08-14)—— VERDICT: FAIL,12 must-fix + 2 nit

> 落檔補於 2026-08-14(`code-reviewer` nit 6:commit body 稱 R2/R3 有結論而本檔只有 R1 = 兩輪無檔可核)。

### R1 九條回核

1. **折法有問題**：資料雖 fail-closed，但正常競態被當成 `P0001` caller bug，UI 叫員工「不要重送」，與 DB「請重新送出」互相矛盾。
2. **折法有問題**：只剝 `--`；用 `/* AND voided_at IS NULL */` 註解守門仍全綠。
3. **折法有問題**：receipt 整段 `IF…RETURN…END IF` 放入 `/* */` 後，R1–R3 仍會命中字面。
4. **未折**：A5a 舊錨的 suppliers 查詢「恰一次」沒有搬齊。
5. **折法有問題**：receipt 主體錨有搬，但原本精確 ACL／不可轉授檢查被弱化。
6. **已折**：P2 已改為完整 `pg_get_indexdef` 逐字全等。
7. **折法有問題**：B5 期望值已改，但「舊列逐欄未變」未證；452b 也可在突變失敗／存活時 exit 0，且漏 G8。
8. **未折**：新機制解釋基本成立，但 plan／probe 仍留「void 不鎖 order_items」假話，新增的 `pg_locks` 輸出也未真正識別等待中的 row lock。
9. **已折**：10 碼已改為 11 碼。

### Findings

- `supabase/migrations/20260814100000_m4b_e10_452_2a2a_adjacent_writers_voided_split.sql:477`、`apps/admin/src/lib/orders/procurement-repository.ts:51`  
  可達競態進 `P0001`，應用卻分類為 caller bug；接受而不修不成立。`must-fix`

- `supabase/migrations/20260814100000_m4b_e10_452_2a2a_adjacent_writers_voided_split.sql:926`、`:1012`  
  `/* … */` 或字串可灌入錨點；大小寫／等價重寫會誤紅，但不會誤綠。`must-fix`

- `supabase/migrations/20260806200000_m4b_e10_a9h_m_a5a_preserve_optional_fields.sql:753`、`20260814100000_m4b_e10_452_2a2a_adjacent_writers_voided_split.sql:962`  
  舊版要求 `FROM public.suppliers s` 恰一次；新版只證至少有一處帶 `FOR SHARE`，多一個普通 SELECT 仍可通過。`must-fix`

- `supabase/migrations/20260814100000_m4b_e10_452_2a2a_adjacent_writers_voided_split.sql:1070`  
  額外 grantee 或 `service_role WITH GRANT OPTION` 都能通過；原版精確 ACL 錨沒有等價搬回。`must-fix`

- `scripts/452b-verify.sh:161`、`:197`、`:213`  
  `pipefail` 下 mutate 的 psql 錯誤仍落到 `return 0`；突變存活也只印紅字、不累積失敗，最後可 exit 0。`must-fix`

- `scripts/452b-verify.sh:156`、`:187`、`:203`  
  沒有 EXIT/INT/TERM trap；突變後中斷會留下突變函式。正常 `CREATE OR REPLACE` 不會遺失 ACL／COMMENT，但中途失敗不會自動還原。`must-fix`

- `docs/specs/2026-08-14-452-2a2-procurement-void-rpc-plan.md:707`、`scripts/452-verify.sh:22`  
  G8 明訂排入 2a-2 且不得再列缺口；452b 完全沒有雙連線併發首建格。`must-fix`

- `scripts/452-verify.sh:201`、`scripts/452b-verify.sh:101`  
  兩處都宣稱舊作廢列「逐欄未變」，實際只驗 `allocated_quantity` 與作廢狀態；其他欄被改壞不會紅。`must-fix`

- `docs/probes/452-2a2-void-lockprobe.sh:147`  
  row-lock 等待通常呈現 `transactionid ShareLock` 且 `relation` 為 NULL；列出的 granted relation locks 不是「正在等的鎖身份」。`must-fix`

- `docs/probes/452-2a2-void-lockprobe.sh:253`  
  判讀失敗只印訊息、不 `exit 1`；自動化仍會把失敗探針視為成功。`must-fix`

- `docs/specs/2026-08-14-452-2a2-procurement-void-rpc-plan.md:190`、`docs/probes/452-2a2-void-lockprobe.sh:191`  
  仍寫「void 全程／不鎖 order_items」，與 A4a 實際取得 parent NKU 相反。`must-fix`

- `supabase/migrations/20260814100000_m4b_e10_452_2a2a_adjacent_writers_voided_split.sql:873`、`:889`  
  `format(...%L)` 本身安全；問題是只憑短子字串決定跳過，且後置驗收不核對完整 COMMENT，殘缺／相反契約可通過。`must-fix`

- `supabase/migrations/20260814100000_m4b_e10_452_2a2a_adjacent_writers_voided_split.sql:41`、`:511`  
  「除兩處外逐字相同」不實：防衛枝的 RAISE 訊息也被改寫。`nit`

- `docs/specs/2026-08-14-452-2a2-procurement-void-rpc-plan.md:154`、`:690`  
  同一證據分別宣稱跑三次與跑兩次，repo 內也沒有本輪輸出可消除矛盾。`nit`

上線方向「app 完整生效 → migration A → migration B」成立；但 B 尚未寫，故其反向前置閘目前無法驗證，不能據此放行整批。

VERDICT: FAIL
### R1 九條回核

1. **折法有問題**：資料雖 fail-closed，但正常競態被當成 `P0001` caller bug，UI 叫員工「不要重送」，與 DB「請重新送出」互相矛盾。
2. **折法有問題**：只剝 `--`；用 `/* AND voided_at IS NULL */` 註解守門仍全綠。
3. **折法有問題**：receipt 整段 `IF…RETURN…END IF` 放入 `/* */` 後，R1–R3 仍會命中字面。
4. **未折**：A5a 舊錨的 suppliers 查詢「恰一次」沒有搬齊。
5. **折法有問題**：receipt 主體錨有搬，但原本精確 ACL／不可轉授檢查被弱化。
6. **已折**：P2 已改為完整 `pg_get_indexdef` 逐字全等。
7. **折法有問題**：B5 期望值已改，但「舊列逐欄未變」未證；452b 也可在突變失敗／存活時 exit 0，且漏 G8。
8. **未折**：新機制解釋基本成立，但 plan／probe 仍留「void 不鎖 order_items」假話，新增的 `pg_locks` 輸出也未真正識別等待中的 row lock。
9. **已折**：10 碼已改為 11 碼。

---

# R3(換模型 `gpt-5.6-terra` + 換角度「拿驗收表反推缺什麼格」,2026-08-14)—— VERDICT: FAIL,10 must-fix

- `packages/adapters/src/supabase/SupabaseOrderAdapter.ts:326; apps/admin/src/lib/orders/procurement-view.ts:91`  
  作廢→同供應商重下→員工編輯採購時，投影未帶 `voided_at`、`find()` 取舊列，舊資料會 hydrate 後覆寫新 active 列。**must-fix**

- `apps/admin/src/lib/orders/receipt-repository.ts:374`  
  到貨選擇器同時列出舊 voided 與新 active、沒有狀態可分；員工選舊列只會被拒絕，無法可靠選到可登錄的那筆。四份證據未碰 UI 讀路徑。**must-fix**

- `supabase/migrations/20260810120000_m4b_347_3a_admin_search_orders_date_range.sql:180`  
  員工以已作廢的供應商單號搜尋，仍命中訂單卻沒有「此單號僅屬作廢歷史」的驗收／呈現契約，容易把歷史採購當現役。**must-fix**

- `supabase/migrations/20260814100000_m4b_e10_452_2a2a_adjacent_writers_voided_split.sql:380`  
  A9h preserve 批次遇到 voided 舊列會走「不存在→新建」，四個 preserve 欄全取本次 NULL；沒有格子釘住這是刻意新單，或驗證批次結果/UI 不會當成舊列更新。**must-fix**

- 無載體 —— 缺「供應商停用 × 已作廢 × 重下同家」格  
  員工作廢後供應商被停用再重下，應明確回 `SUPPLIER_INACTIVE`、不得把舊列的 no-op 語意誤套到新建；現有 fixture 全取兩家啟用供應商。**must-fix**

- 無載體 —— 缺「部分取消／剛好用滿／多品項」聯合格  
  品項 3 件、取消 1 件、作廢舊採購後重下 2 件應成功，重下 3 件應拒；同單另一品項及摘要其他軸必須不變。現有 C 格只有無取消、單品項、額度很寬的形狀。**must-fix**

- 無載體 —— 缺乙片後的真實鏈驗收  
  到貨→撤到貨→作廢→同家重下→以新 request id 再到貨，須同時驗 V7、delete、甲的 active split 與兩次摘要；C5 是直接 UPDATE 出乙片本不允許的「已有到貨卻已作廢」狀態。**must-fix**

- `scripts/452b-verify.sh:102; supabase/migrations/20260814100000_m4b_e10_452_2a2a_adjacent_writers_voided_split.sql:1018`  
  C2 只驗 `ordered_quantity`，A13 只數 audit INSERT；新列的 `first_ordered_at/status_changed_at`、完整摘要軸、audit 是否指向新 id 且 before/after 正確，全壞仍可綠。**must-fix**

- 無載體 —— 缺實際部署交錯格  
  「新 app 先上」不是本機碼集放寬的證明；migration 生效時若仍有舊 admin instance 處理 `PROCUREMENT_VOIDED`，員工仍會看到未知碼異常。需釘 live revision／舊版負測後才 apply。**must-fix**

- `supabase/migrations/20260814100000_m4b_e10_452_2a2a_adjacent_writers_voided_split.sql:60`  
  甲刻意不驗 production 是否已有 `voided_at IS NOT NULL`；若曾有人工修資料或殘留資料，甲單獨上線即觸發上述讀模型混淆，四份本機證據都不會發現。**must-fix**

VERDICT: FAIL
- `packages/adapters/src/supabase/SupabaseOrderAdapter.ts:326; apps/admin/src/lib/orders/procurement-view.ts:91`  
  作廢→同供應商重下→員工編輯採購時，投影未帶 `voided_at`、`find()` 取舊列，舊資料會 hydrate 後覆寫新 active 列。**must-fix**

- `apps/admin/src/lib/orders/receipt-repository.ts:374`  
  到貨選擇器同時列出舊 voided 與新 active、沒有狀態可分；員工選舊列只會被拒絕，無法可靠選到可登錄的那筆。四份證據未碰 UI 讀路徑。**must-fix**

- `supabase/migrations/20260810120000_m4b_347_3a_admin_search_orders_date_range.sql:180`  
  員工以已作廢的供應商單號搜尋，仍命中訂單卻沒有「此單號僅屬作廢歷史」的驗收／呈現契約，容易把歷史採購當現役。**must-fix**

