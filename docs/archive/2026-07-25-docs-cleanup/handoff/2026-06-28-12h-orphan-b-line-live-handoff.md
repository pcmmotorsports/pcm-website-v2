# SESSION HANDOFF — 2026-06-28 12h 孤兒清理(B 線)0→live + dev 完全同步

> 一句話結果:**12h 孤兒清理(B 線)從 0 做到 live 在正式 DB + 上 origin/dev,全程 `TAPPAY_3DS_ENABLED` flag=false(沒收錢、dormant、零 runtime 影響),整輪收工。** B 線 4 支 commit 全 push、收束點 origin/dev=8654c20;**本 handoff 是 8654c20 之後的 docs commit(= 當前 HEAD,push 前 ahead=1),push 後 dev 完全同步(ahead=0)。**
> 環境:repo pcm-website-v2 · 正式 Supabase DB · branch dev · engineering mode。HEAD=本 handoff commit(父=8654c20、push 前 ahead=1;SHA 因 amend 會變,以 push 後 origin/dev 為準)。
> 接手先讀:STATUS.md「下一步」+ canonical plan(docs/specs/2026-06-24-m3-3ds-anomaly-refund-PRD + R1 canonical)§9 + 記憶 `project_m3-3ds-yi-r1-db-sim-pass`。

## 1. 做了什麼(按時序)
- **B1a — claim_expired_pending_attempts RPC + throttle 欄** — 12h 孤兒再認領 RPC + 節流欄落正式 DB。commit `8197fca`。
- **B1b — 孤兒再確認 use-case + port/adapter 接線** — reconfirmExpiredOrphans use-case + 接線。commit `4866817`。
- **步34-36 整合** — B 線 §14 整合(STATUS 七欄 + 整體 Codex Packet + F-INT1 defer #253)。commit `466efad`。
- **STATUS 收尾** — B1a db push live + 步32 驗證 gate ALL PASS + dev 上 origin。commit `8654c20`。
- 拍板/結論:本輪 B 線全程 flag=false dormant(B 線 RPC 無 caller + flag 關 = 零 runtime 影響);#253(B1 manual=false 升級)本輪 defer。

## 2. Commit 序列(push 狀態寫死)
| commit | 內容 | push |
|---|---|---|
| `8197fca` | B1a 12h 孤兒 claim_expired_pending_attempts RPC + throttle 欄 | ✅ origin/dev |
| `4866817` | B1b 12h 孤兒再確認 use-case + port/adapter 接線 | ✅ origin/dev |
| `466efad` | B 線 §14 步34-36 整合(STATUS 七欄 + 整體 Codex Packet + F-INT1 defer #253) | ✅ origin/dev |
| `8654c20` | STATUS 收尾(B1a db push live + 步32 驗證 gate ALL PASS + dev 上 origin) | ✅ origin/dev |

→ **B 線 4 支 commit 全 push**,收束點 origin/dev=8654c20。**本 handoff 是其後的 docs commit(當前 HEAD、push 前 ahead/behind=1/0),push 後 origin/dev=本 commit、ahead/behind=0/0。** R 線 + pivot A + B 線 + STATUS 全對齊。
品質:每片三綠 + DDL 模擬 / 完整 vitest 1497 + 雙審 PASS 0 must-fix + 整體複審 PASS-WITH-NITS。

## 3. DB / 部署 / 外部足跡(非 git,接手看不到 diff)
- **正式 DB(已 live)**:`claim_expired_pending_attempts` RPC + throttle 欄已在正式 Supabase。
- **步32 驗證 6/6 PASS**:ACL 唯 payment_confirmer / SECDEF·search_path='' / 簽名對齊 B1b / role-hygiene 0 / 入帳。
- **flag**:`TAPPAY_3DS_ENABLED` = **false**(B 線 RPC 無 caller + flag 關 = dormant)。
- **排程**:B 線 cron route `reconfirmExpiredOrphans` **尚未接排程**(canonical §9 後續片)。
- 🔴 prod 有 **1 筆真實 12h+ 孤兒**:B1 排程上線後會自動清。

## 4. graphify 地圖增量
**地圖未動** — 本 session 無 code commit(B 線 4 支 commit 為前序 session 產出、已在 origin/dev);僅寫 docs 類產物。觸發範圍(app/lib/components/scripts/supabase)本輪未碰。

## 5. 開放項(待辦)
**🔴 開站收錢前 gate(非現在、需拍板者親自把關)**
- #250 雙扣主動告警 / #241 同意 checkbox server 驗 / #252 rollback 中間態 / #253 B1 manual=false 升級(本輪 defer)。

**⏳ 接手可做**
- B 線 cron route:接 `reconfirmExpiredOrphans` 排程(canonical §9 後續片)。
- codex K2 補審:~7/25 月牆解除後跑;B 線 Packet 已備 `docs/reviews/2026-06-27-m3-3ds-b-line-codex-packet.md`。
- P4(抽付款 adapter、Apple Pay/LINE Pay 鋪路)= 鐵則 8 大改,等 Sean go 另開 plan。

**carry-over / 雜項**
- worktree `m3-3ds-yi-r1` 已 == dev,可清可留。
- `docs/progress-roadmap.html` 有未提交 WIP(Sean 的、本輪未動)— 要更新再說。

## 6. push 狀態與收尾自檢(接手第一眼)
- **B 線 4 支全 push**(收束點 8654c20);**本 handoff 是其後 1 支 docs commit,push 前 ahead=1、push 後 dev 完全同步(ahead=0)。** 下個 session 進入點:① 接 B 線 cron route 排程,或 ② 等 Sean go 開 P4 plan,或 ③ 7/25 後補 codex K2。
- ⚠️ **本 session 另有未 commit 產物(與 B 線無關、安全審查線)**:
  - `~/.claude/skills/pcm-security-audit/`(新全域 skill,在 repo 外、不入此 repo 版控)。
  - `?? docs/security/2026-06-28-website-run-1/REPORT.md`(website 安全輕掃報告,untracked、未 commit)。
  - 既有 `?? .claude/agents/adversarial-reviewer.md`、`?? .vscode/`、`M .gitignore` — session 起點即未提交,維持原狀。
  - → 這些**未 push、等 Sean 決定**是否納入版控。
- Secret 掃描:handoff 全文 0 連線字串 / key / token。

## 相關 plan / 記憶 / 文件
- canonical:`docs/specs/2026-06-24-m3-3ds-anomaly-refund-PRD.md` + R1 canonical plan §9 / §14。
- Packet:`docs/reviews/2026-06-27-m3-3ds-b-line-codex-packet.md`。
- 記憶:`project_m3-3ds-yi-r1-db-sim-pass`。
- 安全線(本 session 另開):`~/.claude/skills/pcm-security-audit/SKILL.md` + `docs/security/2026-06-28-website-run-1/REPORT.md`。
