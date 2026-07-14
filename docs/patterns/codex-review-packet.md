# Codex Review Packet 流程

> 本流程是明確唯讀的審查模式，不限制 Codex 在其他任務擔任完整執行者。執行者與審查者都可由 Codex 或 Claude 擔任，但同一成果的獨立審查應由另一個 session／模型完成。

> **Status:** 🟢 落地 / 2026-05-19 / Slice 0
> **層級:** docs/patterns/、衝突仲裁在 ADR 之下、CLAUDE.md / AGENTS.md 鐵則 12 之細節檔
> **本檔角色:** 固化「重大改動 / 進度結束 → Codex 唯讀第二視角審查」的人機協作流程
>
> 配合閱讀:
> - `CLAUDE.md` 鐵則 12(Claude Code 端:產 packet)
> - `AGENTS.md` 鐵則 12(Codex 端:收 packet 唯讀審查)
> - `CLAUDE.md` 鐵則 8(重大改動動手前先提 plan;與本流程互補)
> - `docs/patterns/slice-checkpoint.md`(三綠 checkpoint;packet 須附三綠結果)

---

## §1 角色與為什麼

重大改動原本只有「鐵則 8:動手前提 plan」一道關。本流程再加一道「commit 前的第二視角」:
由 Codex 對已實作、已過三綠的成果做唯讀審查,挑出 plan 階段看不到的實作層問題
(權限漏洞、migration 破壞性、文件 stale 等)。

| 角色 | 做什麼 |
|---|---|
| **Claude Code** | 實作 + 跑三綠 + 整理 Codex Review Packet,提醒 Sean 轉貼;收到 findings 後決定修正 / 補 backlog / commit |
| **Sean** | 把 packet 貼給 Codex session、把 Codex 回覆貼回 Claude Code(人工中繼) |
| **Codex** | 唯讀審查 packet、只回 findings / 風險 / 是否可繼續;**不改 code、不 commit、不 push** |

一句話:**Claude Code 負責整理包裹、Sean 負責轉貼、Codex 負責唯讀挑問題。**

---

## §2 觸發時機(同 CLAUDE.md 鐵則 12)

遇下列任一情境,Claude Code 須停下、跑完三綠、於 **commit 前**產出 packet:

- 鐵則 8 定義的重大改動(跨 3+ 檔 / 動 schema / 共用元件 / config)
- 動 security / RLS / GRANT / migration / schema / API
- 動會員 tier / 經銷價 / pricing / order / payment
- 一個完整進度單元結束(slice 群 / milestone 收尾)
- commit 前 Claude Code 自評有風險
- Sean 說「Ready for review」

---

## §3 流程

1. **Claude Code** 完成實作 → 跑三綠 → 產出 §4 格式的 packet → 提醒 Sean。
2. **Sean** 把整包貼進 Codex session,附這句:
   > 請唯讀審查這包,不要改 code,只回 findings / 風險 / 是否可繼續。
3. **Codex** 唯讀審查、回 findings / 風險點 / 是否可繼續。
4. **Sean** 把 Codex 回覆貼回 Claude Code。
5. **Claude Code** 依 findings 決定:修正 / 補 backlog / 才 commit。
6. 全程**不 push**(Sean 手動推當最終 review checkpoint)。

與 busboy 的關係:packet 在 busboy-end(自動 commit)之前產出;重大改動的最終
commit 待 Codex findings 回覆後再走。

---

## §4 Packet 模板

Claude Code 依此格式吐出整包(外層包 markdown code block、Sean 一鍵複製):

```
Codex Review Packet

Mode:        唯讀審查,不要修改檔案。
Repo:        /Users/sean_1/pcm-website-v2
Slice / 目標: 這次做了什麼、為什麼。
內容分級:    L1 / L2 / L3
重大改動判定: 是否重大、原因。
目前狀態:    git branch --show-current
             git status --short --branch
             git log --oneline -5
Changed files: git diff --name-only(每檔一句話說明)
重點 diff:   git diff --stat + 相關 git diff(過長則貼最重要檔案與行號)
已跑驗證:    pnpm typecheck / pnpm lint / pnpm test 結果
             pnpm build 結果(僅當本次動 .ts/.tsx)
相關規則摘錄: 摘錄本次相關的 CLAUDE.md 鐵則 / STATUS / NORTHSTAR 條文,
             讓 Codex 無需 repo 存取即可對照。
想請 Codex 重點看:
  1. 安全 / 權限有無漏
  2. schema / migration 會否破壞現有行為
  3. 是否符合 CLAUDE.md / STATUS.md / NORTHSTAR
  4. 是否有該補的 backlog 或文件
Claude Code 自評: 可 commit / 需修正 / 需 Sean 拍板
```

**注意:** packet 須自帶「相關規則摘錄」與「重點 diff」,讓 Codex 無需 repo 存取
即可審查(Codex 只看貼進去的這一包)。

---

## Stage 3 v4 新加:Packet 含 Manifest 異動段(2026-05-22)

> 對齊 outputs/stage-3-self-audit.md F-14 + Stage 3 v4 工作流

### 規範

Codex Review Packet 在 §2 commit 序列段之後、加入 §4 Manifest 異動摘要段:

```markdown
## 4. Manifest 異動摘要(本 packet 期間)

### 新加 business_overrides
- [元件名].field:[白話描述]
  - design_value → storefront_value
  - decided_at + decision_source
  - reason

### 新加 open_drifts(未解決偏離)
- [元件名].field:[白話描述]
  - plan(handoff §N / docs/specs/X.md)
  - backlog 編號

### last_modified_commit 同步狀態
- 本 packet 期間元件動 N 個、各 `last_modified_commit` 依案 A「記可達祖先」寫法(#180 拍板:廢 amend 與 PENDING_HASH;詳 slice-checkpoint.md「last_modified_commit 寫法」段)
- last_global_sync 段是否動:Yes/No(若 design submodule 也升級、列字面)
```

### 為什麼需要

Codex 唯讀審查時、看 commit diff 可能看不到 manifest 設計意圖。Packet 內嵌「manifest 異動摘要」段、Codex 能評估:
- 業務 override 紀錄是否合理(對齊 PCM 業務邏輯)
- 未解決偏離是否被低估
- 同步狀態是否完整

### Sean 動作

不變(對齊既有 §3-§5 流程):貼 Packet 到 chatgpt.com/codex、收 findings、回 Cowork、Cowork 寫修案 slice。
