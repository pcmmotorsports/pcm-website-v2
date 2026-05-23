---
name: codex-adversary
description: 用 Codex(不同模型)當對抗審查器、從 Claude Code main session 直接跑 codex CLI。兩關卡:關卡1 動手前審 plan(codex exec -s read-only)、關卡2 動手後審 diff(codex exec -s read-only PCM 自訂為主;codex review 可選通用)。Cowork 退出 loop 時補回 Cowork 階段 A/B/D 的對抗審查。Use this skill whenever the user mentions codex 審 / codex 對抗審查 / 動手前審 plan / 動手後審 diff / 跑 codex review / Cowork 退出要審查, or 自己規劃 slice(無 Cowork 指令)時主動跑關卡1、重大/security/migration slice commit 前主動跑關卡2.
---

# codex-adversary — Codex 雙關卡對抗審查

> **狀態:** 新建 / 2026-05-23(Sean 拍板 A:Codex 審 plan + diff 兩關、取代 Cowork A/B/D)
> **對應:** `docs/patterns/cowork-review-chain.md` §8 + 五方分工(Cowork 退出時)
> **背景:** Sean 把規劃從 Cowork 移回 Claude Code(嫌 Cowork 拖速度);為保留「不同模型對抗審查」這道防線,用本機 `codex` CLI(gpt-5.5、Sean 已登入)當審查器。

## 為什麼 Codex 不是 Claude code-reviewer

Codex 是**不同模型(OpenAI gpt-5.5)**,比 Claude 審 Claude 更對抗(無共同盲點)。`code-reviewer`(Claude subagent)留作 diff 的**快速 PCM 鐵則第一道**(免費先篩),Codex 再深審。寫 plan / 寫 code 的是 Claude Code(我),審的是 Codex —— 寫審分離保對抗性。

## ⚠️ 執行紀律(硬性、每次必遵守)

1. **只從 main session 跑、不在 subagent 跑。**
   - 已實測(2026-05-23):subagent 的 Bash 用 `dangerouslyDisableSandbox` 會被 auto-mode classifier 擋(安全政策層);main session 可。故 codex 一律 main session 直跑。
2. **每次 Bash 呼叫帶 `dangerouslyDisableSandbox: true`**(codex 需網路 egress、預設 sandbox 擋)。timeout 設 ≥ 180000ms(codex 一次跑 1-3 分鐘)。
3. **只用唯讀命令:**
   - `codex exec -s read-only ...`(關卡1 審 plan、關卡2 PCM 自訂審 diff)
   - `codex review --uncommitted` / `--base ...`(關卡2 可選通用審、設計為唯讀)
   - **絕不**用 `codex fix` / `codex apply` / `codex exec`(**不帶** `-s read-only`)/ `--dangerously-bypass-approvals-and-sandbox`(會改檔)。
   - **防線分層(誠實)**:settings.json deny 擋 `codex fix` / `apply` / `a`(明確會改檔的子命令);但 deny **無法**精準「只擋非唯讀 exec、放行唯讀 exec」(pattern 重疊)→ `codex exec` 的唯讀紀律靠**本 skill 強制每次帶 `-s read-only`** + 下方第 4 點 baseline 比對當實質防線,**非全靠 hard deny**。
4. **跑 codex 前後各取 `git status --porcelain` 比對一致**(確認 codex 沒新增 / 改任何檔)。⚠️ 審 staged 變更時 status 本就非空(會列已 staged 檔)→ 看的是「**有無新增變動**」、不是「空」。跑後比跑前多出東西 → 停下回報 Sean(Codex 異常動手)。
5. **成本意識:** 每次 ~28k+ token + 計費 → 照下方「觸發範圍」控量、非每 commit。

## 觸發範圍(客觀判定、自己決定、不問 Sean)

| 關卡 | 何時跑 |
|---|---|
| **關卡1(plan)** | 我自己規劃 slice 且屬重大改動(鐵則 8:跨 3+ 檔 / 動 schema·API·共用元件·config / 影響部署)。小 slice 跳。 |
| **關卡2(diff)** | 命中鐵則 12(security / RLS / migration / schema / pricing / order / 重大改動)+ milestone 收尾。純低風險型別 slice(如 M-1-14c)跳、走 code-reviewer 即可。 |

(Sean 若說「每個 slice 都跑」→ 全開。)

## 關卡1 — 動手前審 plan

我寫完 slice plan(handoff / plan 字面)後:

```bash
codex exec -s read-only "你是獨立對抗 plan reviewer(fresh context)。審下面這份實作 plan,對照 PRD 與 design 真權威,抓:
1. plan 字面 vs PRD vs design 真權威 drift
2. scope(鐵則 4 大小 15-45min / 鐵則 8 重大改動是否該先提)
3. 禁止清單可執行不矛盾
4. L3 內容分級漏判
5. 缺的決策點(會害動手後才爆、需上游先問人)
只輸出 PASS|FAIL + findings(列點 + 修法),不要修改任何檔案。

=== PLAN ===
$(cat <plan 檔路徑>)
=== 相關 PRD/design 字面 ===
<貼相關真權威字面>"
```

findings 回來 → 我自修 ≤2 輪 → **真正的決策岔路一次性上游批次問 Sean**(不零碎打斷)。

## 關卡2 — 動手後審 diff

`/slice-checkpoint` 三綠 + Claude `code-reviewer` PASS 後、commit 前。

⚠️ **語法限制(2026-05-23 實測):`codex review` 的 scope flag(`--uncommitted`/`--base`/`--commit`)不能搭自訂 PROMPT**(`error: --uncommitted cannot be used with [PROMPT]`)。故分兩種:

**(a) PCM 鐵則自訂審查(主、推薦)** — 用 `codex exec -s read-only`、讓 codex 自己跑 git diff:
```bash
codex exec -s read-only "你是獨立對抗 code reviewer。先跑 git diff --staged(及 git diff HEAD)看本 slice 變更,審:PCM 鐵則 1-12 違反 + 字面vs事實偏離 + design 真權威對齊 + server 端會員/價格鐵則(經銷價不外洩 / 金額禁浮點 / tier 驗證在 server)。只輸出 PASS|FAIL + findings(列點+位置+修法),不要修改任何檔案。"
```

**(b) Codex 內建通用審查(可選、抓一般 bug/品質/安全)** — scope flag 不配 prompt:
```bash
codex review --uncommitted          # slice 級:staged+unstaged+untracked
codex review --base origin/dev      # milestone 級:對 origin/dev 整批
```

findings 回來 → 我自修 ≤2 輪 → 仍 FAIL 第 3 輪 raise Sean。PASS → commit。

## 輸出處理

- Codex 輸出是**文字 / markdown(無 `--format json`)**→ 讀文字、抽 findings。
- 輸出可能長 → 必要時 `> /tmp/codex-out.txt` 再讀關鍵段,避免灌爆對話。

## 跟其他審查層的分工(對齊 cowork-review-chain.md §5)

- 關卡1(Codex plan)= 取代 Cowork 階段 A/B(動手前)
- `code-reviewer`(Claude)= diff 快速 PCM 鐵則篩(階段 C、免費)
- 關卡2(Codex diff)= 深度獨立審(階段 C+/D-lite、取代手動貼 packet)
- `/codex-review` skill(產 packet 給人手動貼 web Codex)= milestone 級完整審,**保留並存**
- Sean 肉眼驗 = 階段 E(視覺/操作)

## 不做的事

- 不在 subagent 跑 codex(classifier 擋)。
- 不用 codex 改檔(只審)。
- 不自動 push。
- Codex findings 是「第二意見」、不無腦照單全收;與 PCM 鐵則 / Sean 拍板衝突時以後者為準、衝突點 raise Sean。

— END —
