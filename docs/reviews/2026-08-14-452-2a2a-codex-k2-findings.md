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
