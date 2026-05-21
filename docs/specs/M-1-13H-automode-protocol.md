# M-1-13H Automode Master Protocol

> **作者:** Cowork(對齊 Sean 2026-05-21 拍板 Q1=A automode + Q2=try-and-skip browser MCP)
> **日期:** 2026-05-21
> **目的:** Code 自治連跑 M-1-13H slice-2 ~ slice-6、sub-agent 自驗 + 自修 ≤2 輪、Codex Review Packet 在 slice-5/6 間打斷、slice-6 收尾後 Sean 肉眼驗 + push
> **適用 Code session:** 本檔 commit 後、Sean 開新 Code session 貼啟動指令、Code 自治
>
> **真權威字面源:**
> - `docs/specs/M-1-13H-product-page-overhaul-plan.md`(PRD 7 題拍板 + 6 slice 字面骨架、543 行)
> - `design-reference/` submodule @ `637dafc`
> - 既有 storefront(M-1-13a ~ 13f-2 + 13H slice-1 累積、最新 commit `a8f5a01`)
> - `docs/lessons-learned.md` §12-37(Cowork 引偵察報告字面前必交叉檢查雙端)
>
> **衝突仲裁:** STATUS > NORTHSTAR > CLAUDE.md > 本檔 > PRD > 其他 md > 對話歷史

---

## 0. 啟動條件(Code session 開跑前 5 綠)

```bash
cd /Users/sean_1/pcm-website-v2
git branch --show-current      # 預期: dev
git status                      # 預期: clean
git log --oneline -3            # 預期最上面: 含 a8f5a01 (slice-1) 或本檔 chore commit
git submodule status design-reference  # 預期: 637dafc...
```

任一不綠 → 停下回報、不自治修復。
STATUS L16 寫 amend 前 hash vs HEAD 1 步 drift = CLAUDE.md「1 步 amend drift 慣例」、允許(backlog #142)。

---

## 1. 真權威字面源

| 來源 | 路徑 | 用途 |
|---|---|---|
| PRD | `docs/specs/M-1-13H-product-page-overhaul-plan.md` | 7 題拍板鎖、5 slice 範圍字面骨架、字面 vs 事實揭示、風險點、鐵則對應 |
| design submodule | `design-reference/components/explorations/VariantCFull.jsx` 259 行 | 視覺真權威字面 |
| design submodule | `design-reference/design-handoff/PRODUCT-PAGE-HANDOFF.md` 429 行 | 改版逐項交接 |
| design submodule | `design-reference/styles/explorations.css` 1355 行 | `.vc-*` L335-893 + `.vcf-*` L1060-1355 共 101 條規則 |
| design submodule | `design-reference/components/ProductCard.jsx` 6397 bytes | Related grid 引用元件(已搬 storefront) |
| 既有 storefront slice-1 後 | `apps/storefront/src/components/ProductPage.tsx` / `ProductGallery.tsx` / `ProductInfo.tsx` / `ProductServices.tsx` / `ProductTabs.tsx` | 對齊現狀基線 |
| 既有 CSS | `apps/storefront/src/styles/product-page.css` 738 行 | crumbs / hero / thumb 已 slice-1 重寫、L670-704 mobile bar **不動** |

---

## 2. 5 sub-slice 順序 + PRD 引

| sub-slice | PRD 章節 | 估時 | 動的子元件 + 範圍 |
|---|---|---|---|
| **slice-2** | PRD §4 slice-2 | 25-35 分 | ProductInfo 上半:SKU line / title 28 / 副標 / 移除 fits banner |
| **slice-3** | PRD §4 slice-3 | 35-45 分 | ProductInfo 下半 + ProductServices:價格 22 黑 / swatches 圓 24 / pill CTA 48 / services 移圖示 / 免運 5,000 對齊 |
| **slice-4** | PRD §4 slice-4 | 35-45 分 | 新增 ProductHighlights.tsx + ProductSpotlight.tsx + MockProduct hasSpotlight 欄位 + mock data 3 件 hardcoded |
| **slice-5** | PRD §4 slice-5 | 30-45 分 | ProductTabs:底線 → pill 群組 + 4 panel 內容微調 |
| **[Codex Review Packet 介入點]** | — | Sean wait | Code 停、Sean 貼 Codex、Codex findings → Sean 拍 |
| **slice-6** | PRD §4 slice-6 + Codex findings fix | 35-50 分 | Related grid 用既有 ProductCard + STATUS Phase 2 LOG + 13g 殘餘評估 + Codex findings fix |

**Codex Review Packet 觸發點:** slice-5 commit 後、slice-6 跑前。

---

## 3. 每 slice 自治流程(7 步驟、Code 依序跑)

```
Step 1  Read PRD docs/specs/M-1-13H-product-page-overhaul-plan.md 對應 §4 slice-N 章節
Step 2  按 PRD 列的 grep 真權威源點跑 grep(VariantCFull / explorations.css / HANDOFF / 既有 storefront)
Step 3  Read 對應真權威字面區段(grep 命中行 ±10 行)
Step 4  落地實作:Edit / Write storefront .tsx + .css(對齊 PRD slice-N 範圍、不擴張)
        - class prefix .vc- / .vcf- → .pd-(storefront 命名空間慣例)
        - 字面從 design-reference 直接搬、不翻譯
Step 5  Sub-agent 自驗(§4 清單)
Step 6  自修(若 §5 規則允許)
Step 7  自驗綠 → STATUS L6 更新 + 精準 git add + commit + busboy-end amend + 不 push → 下一 slice
        自驗仍紅(§5 自修上限到)→ 停下 raise Sean
```

---

## 4. Sub-agent 自驗清單(每 slice 必跑)

每 slice commit 前必跑(全綠才允許 commit):

| # | 自驗項 | 工具 | 通過條件 |
|---|---|---|---|
| 1 | typecheck | `pnpm typecheck` | 全綠 |
| 2 | lint | `pnpm lint` | 全綠(允許 eslint-disable-line + 註解 + backlog 追蹤、對應 React 19 hooks 嚴格) |
| 3 | build | `pnpm build`(動 .ts/.tsx 必跑) | 全綠 |
| 4 | sub-agent code-reviewer(Task tool 自 spawn) | Task tool subagent_type='code-reviewer' 或 'general-purpose' | 看 diff、找 regression / 安全 / N+1 / 邏輯漏洞;回 PASS / FAIL + findings |
| 5 | skill audit(engineering:code-review) | Skill skill='engineering:code-review' | 對齊 docs/working-style.md skill audit 流程、PASS / 補丁 amend |
| 6 | smoke test 補/更新 | Edit `*.test.tsx` | 對應動到的子元件、smoke test 跑綠 |
| 7 | browser MCP try-and-skip(視覺驗) | spawn Playwright / Chrome MCP if available | 若有:dev server `pnpm dev` + 開 http://localhost:3000/products/{mock-slug} + screenshot;若無工具:**跳過**(Sean 最後手動肉眼驗)、不算自驗失敗 |

**Sub-agent 自驗執行細節:**

- 第 4 項 Task tool spawn sub-agent 提示詞範本:
  ```
  Review the diff for M-1-13H slice-N (PRD: docs/specs/M-1-13H-product-page-overhaul-plan.md §4 slice-N).
  Files changed: [列出本 slice 動的檔案]
  Look for:
    1. Regression vs slice-(N-1) commit
    2. 字面 vs 事實偏離 PRD 規範
    3. 違反 PCM 鐵則(1-12、見 CLAUDE.md)
    4. 視覺層偏離 design-reference 真權威字面
    5. Security / N+1 / 邊界 case 漏洞
    6. 跨 slice 範圍擴張(本 slice 應只動 PRD §4 slice-N 列的檔)
  Report PASS / FAIL + 具體 findings(行號 + 修正建議)。
  ```

- 第 5 項 skill audit 範圍:engineering:code-review skill(已預載)、依 skill SOP 跑。

---

## 5. 自修規則(最多 2 輪、超過 raise)

| 輪 | 動作 |
|---|---|
| **第 1 輪** | Sub-agent 反饋 FAIL → Code 讀 findings → 修對應字面 → 重跑 §4 自驗清單 |
| **第 2 輪** | 第 1 輪仍 FAIL → Code 再修一次 → 重跑 §4 自驗 |
| **第 3 輪(不允)** | 第 2 輪仍 FAIL → **停下 raise Sean**、不再自修 |

Raise 時 Code 提供:
- 對應 slice / 對應 sub-agent finding 字面
- 第 1 / 第 2 輪修了什麼(diff 摘要)
- 為什麼仍 FAIL 的初步推測
- multi-select 處置選項(A 跳過該 finding 接受降級 / B Sean 拍板字面修法 / C revert 本 slice 重來)

---

## 6. Raise 條件(自治中斷觸發)

Code 任一情境必須停下 raise:

| # | 條件 | 範例 |
|---|---|---|
| 1 | 自修 2 輪仍 FAIL | sub-agent 反覆 raise 同 finding、Code 修不掉 |
| 2 | PRD 字面內部矛盾 | PRD §4 slice-4 「MockProduct 加 hasSpotlight 欄位」、grep MockProduct schema 發現 type 定義在 packages/schemas、未授權 Code 動跨 package、需 Sean 拍 |
| 3 | 設計未覆蓋實況 | PRD slice-4「業務指定 3 件 hardcoded hasSpotlight: true」、PRD 未指定哪 3 件、Code raise multi-select 給 Sean 選 |
| 4 | 範圍超出 PRD slice 邊界 | 本 slice 動到 PRD 未列的檔案、停下 raise |
| 5 | context window 警戒 | Code session token 撞 80% 上限、跑下個 slice 風險高、raise Sean 建議切新 session |
| 6 | 鐵則衝突無 PRD 預先拍板 | 例:slice-X 發現 ProductPage 行數爆 400 行(鐵則 6 硬拆)、PRD 未指示如何拆、raise |
| 7 | 三綠 build 紅 | typecheck / lint / build 任一紅、自修 2 輪仍紅、raise |

---

## 7. Codex Review Packet 介入點(slice-5 commit 後、slice-6 跑前)

**觸發:** slice-5 commit 完成、Code 停下、產 Codex Review Packet。

**Packet 內容(Code 自動產出、寫到 `docs/reviews/M-1-13H-codex-review-packet-{date}.md`):**

```markdown
# M-1-13H Codex Review Packet

> 對齊 PCM 鐵則 12:進度單元結束(M-1-13H slice-2~5 完成)、動共用元件 + 動 schema(MockProduct hasSpotlight)、必產 Codex Review Packet 給 Sean 貼 Codex 唯讀審查、findings 回來再 commit slice-6。

## 1. 範圍
slice-2 ~ slice-5 共 4 commit(slice-1 已 push、本 Packet 不含)

## 2. Commit 序列
| # | hash | subject | 重點 |
|---|---|---|---|
| 1 | {slice-2 hash} | feat(storefront): Info 上半 ... | ... |
| 2 | {slice-3 hash} | feat(storefront): buy block + services ... | ... |
| 3 | {slice-4 hash} | feat(storefront): Highlights + Spotlight ... | ... |
| 4 | {slice-5 hash} | refactor(storefront): Tabs pill ... | ... |

## 3. 字面 vs 事實揭示
[本 Packet Code 從各 slice commit body 摘錄]

## 4. 風險殘餘
[未解決議題、PRD 預期 Code raise 但未發生的、Code 推測的潛在問題]

## 5. Rollback 方式
git revert {slice-5 hash} {slice-4 hash} {slice-3 hash} {slice-2 hash}(按反序、保留 slice-1 a8f5a01)

## 6. 相關規則摘錄(Codex 無 repo 存取、自帶上下文)
- NORTHSTAR §2.4「.jsx + .css 字面 > HANDOFF docs」
- lessons §12-37「Cowork 引偵察報告字面前必交叉檢查雙端」
- 鐵則 8 重大改動 + 鐵則 11 字面 vs 事實 + 鐵則 12 Codex Review

## 7. 預計 slice-6 範圍
[Related + 收尾 + Codex findings fix]
```

**Code 停下 raise Sean:**
```
Codex Review Packet 已產 → docs/reviews/M-1-13H-codex-review-packet-{date}.md
請貼給 Codex 唯讀審查、findings 回來後我跑 slice-6(含 fix)。
本 session 暫停、等 Sean Codex review 結果。
```

**Sean 介入:**
1. 讀 Packet
2. 貼 Codex 唯讀審查
3. Codex findings 回 Sean
4. Sean 拍板 findings 處置(忽略 / 併 slice-6 fix / 開 fix slice)
5. Sean 回 Cowork、Cowork 寫 slice-6 指令(含 Codex findings fix)給 Code

---

## 8. 收尾流程(slice-6 commit 後)

Code slice-6 commit 完成、給 Sean 結束 report:

```markdown
# M-1-13H Automode 完成 report

## 1. Commit 序列(5 commit、本 session 累積、未 push)
| # | hash | subject |
|---|---|---|
| 1 | {slice-2 hash} | feat(storefront): Info 上半 ... |
| 2 | {slice-3 hash} | feat(storefront): buy block + services + 免運 5,000 ... |
| 3 | {slice-4 hash} | feat(storefront): Highlights + Spotlight + hasSpotlight 欄位 ... |
| 4 | {slice-5 hash} | refactor(storefront): Tabs pill + 內容微調 ... |
| 5 | {slice-6 hash} | feat(storefront): Related + 收尾 + Phase 2 LOG ... |

## 2. Sub-agent 自驗結果
[每 slice 自驗綠的清單]

## 3. Screenshots(若 browser MCP 有跑)
[或註明「browser MCP 不可用、跳過視覺截圖、待 Sean 肉眼驗」]

## 4. STATUS L6 字面預覽
[最終 STATUS L6 內容]

## 5. Codex Review findings 處置(若有)
[併入 slice-6 的 fix 摘要、或開 fix backlog 紀錄]

## 6. 待 Sean 動作
- 肉眼驗 + 功能檢查(本機跑 dev server、瀏覽器跑流程):
  - 商品頁完整流程:crumbs / vehiclePill / Gallery 1:1 / SKU line / 標題 / 副標 / 價格 22 黑 / swatches 圓 24 / pill CTA / services / Highlights / Spotlight / pill Tabs / Related grid / Mobile sticky bar 紅色
  - 業務流程:加入購物車 → toast → cart 顯示 / tier 條件渲染 / hero swipe / Lightbox ESC/Arrow
- push origin dev(累積 5 commit + 之前 slice-1)
- 在 Claude Design 端動 explorations 刪除(對應 Q6)、push pcm-website-design、本地 submodule update
```

---

## 9. 禁止清單(自治期間)

### 9.1 基線(每 slice 含)

- 不可修改本 slice scope 外檔案(範圍對齊 PRD §4 slice-N)
- 不可變更 env / deployment 設定
- 不可修改 schema / infra(除 PRD slice-4 明示 MockProduct hasSpotlight)
- 不可使用 git add . 或 git add -A、必須精準 add 檔
- 不可自動 push(Sean 手動推當 review checkpoint)
- 不可 disable / skip / ignore typecheck / lint / build(對齊鐵則 11)

### 9.2 Automode 延伸

- 不可改 PRD `docs/specs/M-1-13H-product-page-overhaul-plan.md` 字面(Cowork 已寫)
- 不可改本 master protocol `docs/specs/M-1-13H-automode-protocol.md` 字面(Cowork 已寫)
- 不可改 lessons `docs/lessons-learned.md` §12-37 字面(Cowork 已寫)
- 不可動 design-reference submodule(對應 Q6:Sean 在 Claude Design 端動)
- 不可動 `apps/storefront/src/styles/product-page.css` L670-704 mobile sticky bar 段(對應 Q3 業務拍板紅色保留)
- 不可動 `apps/storefront/src/components/ProductCard.tsx` / `apps/storefront/src/styles/product-card.css`(對應 Q4 既有 ProductCard 保留)
- 不可超出 PRD slice 邊界(本 slice 範圍只在 PRD §4 slice-N 列的檔)
- Codex Review Packet 未產出前不可進 slice-6
- Sub-agent 自驗未全綠不可 commit
- 自修第 3 輪不可繼續、必須 raise
- 跨 package import slice(若有)必須對齊 lessons §12 + backlog #12 + .npmrc shamefully-hoist=false 規範

### 9.3 Sub-agent 範圍

- Sub-agent(Task tool 自 spawn)只負責:code review、字面 audit、grep / find、補 smoke test、跑 dev server fetch HTML、browser MCP screenshot(若有)
- Sub-agent **不**可:git commit / push / 改 schema / 改 env
- Sub-agent **不**可:替代主 Code session 跑實作(Code 主帥跑實作、sub-agent 只審 / 補)
- Sub-agent 報告由主 Code session 收集 + 判斷 PASS / FAIL

— 禁止清單結束 —

---

## 10. Sean 介入點總表

| # | 時機 | Sean 動作 |
|---|---|---|
| 1 | 本檔 commit 後 | 開新 Code session、貼啟動指令(Cowork 對話內給) |
| 2 | Code 跑期間若 raise(§6 條件) | 拍板處置選項 |
| 3 | slice-5 commit 後 Codex Review Packet 產出 | 讀 Packet → 貼 Codex → findings → 拍板處置 |
| 4 | slice-6 commit 後 Code 結束 report | 讀 report → 肉眼驗 + 功能檢查 → push origin dev |
| 5 | M-1-13H milestone 完成後 | 在 Claude Design 端動 explorations 刪除(對應 Q6) |

---

— END —
