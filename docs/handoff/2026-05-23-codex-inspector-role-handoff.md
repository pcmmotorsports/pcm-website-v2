# 2026-05-23 Codex 檢查者角色 handoff

> 給新 Codex 視窗的交接。Sean 要開新視窗時,先讀這份,再讀 `AGENTS.md` / `STATUS.md`。

---

## 1. 新視窗啟動提示

短版可以直接貼給新 Codex:

```md
請進入 PCM「檢查者」角色。
先讀:
1. AGENTS.md
2. STATUS.md
3. docs/patterns/codex-inspector-role.md
4. 最新 docs/reviews/*.md 或我貼的 Codex Review Packet

規則:
- 唯讀審查,除非我明確要求寫 handoff / 記憶,否則不要改檔。
- 回 findings / 風險 / 是否可繼續。
- 若 packet 字面與 repo 事實不一致,優先指出。
- findings 要附 file:line + 修法建議。
```

完整 fresh-context 版可以貼這段,再接 Packet 全文:

```md
你是獨立的 fresh-context code reviewer、沒看過這個專案的任何內部對話。
我手上有一份「Codex Review Packet」、是一個我們剛做完、還沒 push 的工作單位(slice)的審查摘要。

【你的角色】
- 對齊 Anthropic Claude 工程實務的 milestone 級外部第二意見
- 唯讀:不要寫 code、不要假裝執行命令、只審 Packet 字面

【你審什麼】
1. milestone 級風險:這個變更會不會在後續 1-2 個 milestone 內引發 regression?
2. 跨 slice 一致性:Packet 內描述的變更跟既有架構慣例對齊嗎?有沒有「字面 vs 事實」偏離未揭示?
3. 業務邏輯第二意見:涉及訂單流程、權限、價格、Supabase schema、會員 tier、儲值金的部分(若 Packet 有提),用業務直覺再想一次
4. security:涉及 RLS、service_role key、密鑰、cookie、auth 的部分(若 Packet 有提),用 OWASP 視角再想一次
5. commit 訊息:body 的「字面 vs 事實揭示」段是否完整?有沒有 Packet 字面內看得到的偏離未列?
6. 依賴 / config 變更:plugin 版本、peer dependency、規則開啟範圍是否合理?

【你不審什麼】
- slice 級鐵則違反(階段 C code-reviewer 已抓、本次不重複)
- 視覺 / a11y(屬另一階段)
- 字面拼字 / 措辭(屬 nit、若想提作 nit 級 OK)

【特別注意「字面 vs 事實守則」】
這個專案有條鐵則:「commit / 拍板 / 指令字面跟實際做的事偏離、必寫 commit body『字面 vs 事實註記』」。
請特別檢查 Packet 內的 commit body 揭示段是否覆蓋所有 Packet 內看得到的偏離點(版本字面變更、scope 預估失準、禁令解除、行號錯位等)。

【輸出格式】
1. 結論:PASS / PASS-with-comments / FAIL(各代表「可直接 push」/「push 前看看建議但不擋」/「不可 push、需修」)
2. findings 列點(若有)、每點標等級:
   - must-fix(必修才可 push)
   - consider(建議改善、不擋 push)
   - nit(措辭 / 格式微調)
3. 對「commit 時序」(現在這個 slice 是先本地 commit 後審查、還是先審查後 commit)的觀察(若 Packet 有提到)
4. 如果你發現 Packet 字面本身有自相矛盾、列出來

簡潔具體、繁體中文。
```

---

## 2. 目前 repo 狀態記憶

截至本 handoff 產出前,本機狀態不是 clean。不要在新視窗假設工作樹乾淨。

`git status --short --branch` 看到:

```text
## dev...origin/dev
 M CLAUDE.md
 M apps/storefront/next-env.d.ts
 M apps/storefront/src/components/ProductInfo.tsx
 M apps/storefront/src/components/ProductPage.tsx
 M apps/storefront/src/components/ProductsPage.tsx
 M docs/phase-1-backlog.md
 M eslint.config.js
 M package.json
 M pnpm-lock.yaml
 M pnpm-workspace.yaml
?? docs/reviews/2026-05-23-eslint-react-hooks-install-packet.md
```

這些多半是 Sean / Claude Code 當前 slice 變更。Codex 檢查者不可自行還原。

---

## 3. 我已知的工作流定位

PCM Stage 3 後的角色分工:

- Sean:拍板 / push / 操作 dashboard / 肉眼驗。
- Cowork:規劃 / 寫 slice 指令 / 寫 handoff / multi-select 決策題。
- Claude Code:實作 / 跑測試 / commit / Task spawn code-reviewer。
- Codex 檢查者:外部唯讀審查,階段 D,只回 findings。
- Claude Design:視覺設計源。

Codex 檢查者不是 implementer。只有 Sean 明確要求「寫記憶 / handoff / 角色定義」時才新增文件。

---

## 4. 最近審查紀錄摘要

### M-1-13e-b CartContext

曾回報:
- `CartItem.id:number` 是 mock artifact,應改 `productId:string`。
- `addItem` 用 variant key,但 remove/update 只用 id。
- 缺 CartContext / add-to-cart 行為測試。
- qty guard 不足。

後續目前看到 CartContext 已改為:
- `CartLineKey = { productId:string, color?, size? }`
- add/remove/update 統一 `sameLine`
- qty clamp 到 1..99

### M-1-13H ProductPage 改版

曾回報:
- ProductTabs 設 roving `tabIndex` 但沒 keyboard handler。
- `.pd-price-tag-dealer` 無 CSS。
- L3 hardcoded 內容需 Phase 2 LOG。

新視窗若再審商品頁,要先確認這些是否已由後續 slice 修完。

### Stage 3 onboarding

曾回報:
- `docs/patterns/cowork-review-chain.md` active doc 還寫「五件套」,應改「六件套」。
- `scripts/design-mirror.mjs --target` 不認 CSS / related files。
- `scripts/design-mirror.mjs --validate` 未驗多數 path-like 欄位。
- packet 內容與實際 HEAD/ahead 不一致。

新視窗若接到 Stage 3 修正包,重點看以上 must-fix 是否處理。

---

## 5. 檢查者輸出格式

偏好格式:

```md
**結論:** PASS / PASS-with-comments / FAIL

**Findings**

must-fix
`path:line`
問題。影響。修法。

consider
`path:line`
問題。影響。修法。

nit
`path:line`
措辭 / 格式微調。

**commit 時序觀察**
先 commit 後審 / 先審後 commit / packet 未說明。

**Packet 自相矛盾**
若無,寫「未見明顯自相矛盾」。
```

若 Sean 說「給我文字檔我複製回去」,避免使用 inline code-comment directive,改純文字。

---

## 6. Skill / tool 安裝判斷

目前已具備足夠技能:

- `doc-coauthoring`
- `skill-creator`
- `vercel-react-best-practices`
- `postgresql-code-review`
- `supabase-postgres-best-practices`
- `accessibility-review`
- `memory-leak-audit`
- `webapp-testing`

本輪已準備 `pcm-codex-inspector` skill 草稿,可安裝到:

```text
/Users/sean_1/.agents/skills/pcm-codex-inspector/SKILL.md
```

若未安裝,仍可依 `docs/patterns/codex-inspector-role.md` 手動啟動角色。

---

## 7. 下一位檢查者注意

- 先確認 packet scope 是否真的等於 `origin/dev..HEAD`。
- 若 packet 說「無需 repo 存取」,但本機有 repo,仍可唯讀交叉檢查。
- 不要被 packet 的自評帶著走;以實際 diff / 文件行號為準。
- 碰到 OpenAI / Claude / Supabase / Next 最新 API 時,需要查官方文件或對應 skill;不要憑舊記憶。
- 若使用者只是要 review,不要順手修。

— END —
