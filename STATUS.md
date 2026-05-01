# STATUS.md

> 用途:PCM Phase 1 重做的 single source of truth。Claude.ai 與 Claude Code 每次新對話必先讀此檔對齊狀態。每完成一個 slice 後由 busboy-end 自動更新。
>
> 衝突仲裁:STATUS.md > docs/PHASE-1-NORTHSTAR.md > 其他 md > 對話歷史。

---

## 當前狀態

**Phase:** Phase 1(整個重做、新 repo `pcm-website-v2`)
**Milestone:** M-0 進度 5/9 — 跳號實作中、4 slice 待回頭補
- **已完成:** M-0-01a / M-0-01b / M-0-07 / M-0-08 / M-0-04 / M-0-03(共 5 slice、01a+01b 是 M-0-01 拆兩階)
- **待回頭補(依賴鏈順序):** M-0-05 → M-0-06 → M-0-02 → M-0-09

**當前 slice:** M-0-03 完成(ESLint 邊界守門 7 條 boundaries/dependencies + 8 task lint script + dependency-rules.md + 7 條 dry-run 全 CAUGHT、engineering:code-review audit 抓 8 / 處理 4 立即修 + backlog #22-#25 4 條、config-only slice 豁免 simplify)、1 commit 待 push、待 M-0-05 動工
**Branch:** dev(main 已同步至 9f609b0)

## 最後更新

**時間:** 2026-05-02
**更新者:** Claude Code(M-0-03 完成 + engineering:code-review audit 處置、busboy-end 收工)

## 最近 3 commit

| Hash | 訊息 | 時間 |
|---|---|---|
| 5bdbae7 | feat(M-0-03): ESLint 邊界守門 7 條 boundaries 規則 + 8 task lint script + dry-run 全 CAUGHT | 2026-05-02 |
| fb55285 | fix(M-0-04): skill audit 雙輪 follow-up 命名/JSDoc 修正 + backlog 8 條更新 | 2026-05-01 |
| 5c16124 | feat(M-0-04): ports 5 介面 + domain 6 context type stub | 2026-05-01 |

## 下一步(第 1 條優先)

1. **Sean 手動 push 後開新 Code session 跑 M-0-05**(medusa-schema-design.md Part 1:product / brand / category mapping + tier price、估 60 min)← 當前
2. 接著 M-0-06(medusa-schema-design.md Part 2:訂單狀態機 + Medusa vs Supabase 責任分割)
3. 接著 M-0-02(apps/admin + apps/sync-engine 空殼 + tsconfig)
4. 最後 M-0-09(C5 L2 busboy-end pre-flight、跨 repo pcm-tools、busboy-start 用 tools 參數)

> 上述 1-4 完成後 → M-0 收尾、進 M-1

5. (背景)Claude Design 補 3 頁 + 1 微調(M-2 / M-3 前完成)
6. (✅ 完成)4 件 setup:Supabase / Vercel / Railway / GCP — 細節見 `docs/architecture/2026-04-30-handoff-to-claude-ai.md` §10

## Sean 待決策

| # | 決策內容 | 阻塞什麼 |
|---|---|---|
| 1 | A3 Phase 1 階段 1 是否做發票自動化(綠界 / 藍新 / 國稅局)| M-3 訂單後段 |
| 2 | G2 測試覆蓋率目標 + E2E 範圍 | M-6 整合測試 |
| 3 | TapPay sandbox 是否沿用舊環境 / 需重申請 | M-3 結帳 |
| 4 | Vercel / Railway 部署是否新建 / 沿用 | M-6 部署 |

(其他項目:無、A1 / A2 / A4-A7 / B / C / D / E / F 已寫進 feedback 檔、進 writing-plans 自動納入)

---

## Phase 1 範圍速查

依 `docs/PHASE-1-NORTHSTAR.md` v2:

- **真權威:** Claude Design = `pcmmotorsports/pcm-website-design` repo(submodule 掛在 `design-reference/`)
- **方向:** design 直接搬進 `apps/storefront`、Medusa schema 對應 design 資料結構重建
- **執行單元:** slice(15-45 分鐘可中斷、單一 commit 體積小)
- **舊 repo:** `pcmmotorsports/pcm-website` 完全凍結、不動

## 技術棧速查

依 `docs/decisions/0001-rewrite-decision.md`:

- **Monorepo:** pnpm 9.15 + Turborepo
- **前台:** Next.js 16 + TypeScript + Tailwind v4
- **後台:** Medusa.js v2 + Prisma + Supabase PG(SG region)
- **共用:** packages/ui(@pcm/ui)+ packages/schemas
- **金流:** TapPay sandbox
- **部署:** Vercel(前台)+ Railway(後台)
- **Node:** v22 / pnpm 9.15
- **Git:** SSH only、新 repo `pcm-website-v2`

## 關鍵路徑速查

| 項目 | 路徑 |
|---|---|
| 主 repo | `/Users/sean_1/pcm-website-v2`(待 Sean clone) |
| design-reference submodule | `pcm-website-v2/design-reference/` |
| 舊 repo(凍結) | `/Users/sean_1/pcm-website` |
| 舊 design-reference clone | `/Users/sean_1/pcm-website/design-reference/` |
| Busboy 腳本 | `/Users/sean_1/pcm-tools/scripts/`(沿用) |
| Hermes Node | `/Users/sean_1/.hermes/node/bin/`(沿用) |

## 文件交叉引用

每次新對話依此順序對齊上下文:

1. **`STATUS.md`** ← 本檔(每次先讀)
2. `docs/PHASE-1-NORTHSTAR.md` v2 — Phase 1 真權威定義
3. `docs/lessons-learned.md` — 舊專案教訓彙整
4. `CLAUDE.md` — Claude Code 工作規則
5. `docs/PHASE-1-MILESTONES.md` — milestone 排程
6. `docs/decisions/` — 重大決策記錄
7. `docs/patterns/` — 通用 + PCM 專屬規矩
8. `docs/phase-1-backlog.md` — 未決事項
9. `docs/features/*.md` — PRD
10. `design-reference/` — 視覺真權威字面(submodule)
11. `PROGRESS.md` — 歷史紀錄

衝突仲裁順序:
- STATUS.md 與其他 md 衝突 → STATUS.md 為準
- 其他 md 與對話歷史衝突 → md 為準
- 視覺 / 結構 / 路由 / 元件命名衝突 → design-reference 為準
- 業務邏輯(訂單流程、權限、價格、Medusa schema)衝突 → docs/decisions/ 為準

## Busboy 機制(沿用第一輪)

- **busboy-start.js:** Sean 在 Terminal 跑、輸出貼新 Claude Code session 第一則訊息
- **busboy-end.js:** Claude Code 在 session 最後跑、自動更新本檔 6 個欄位(最後更新 / Phase Milestone slice Branch / 最近 3 commit / 下一步 / Sean 待決策 / 變更紀錄)、commit、不 push(Sean 手動推當 review checkpoint)
- repo 參數:`pcm`(本 repo)/ `tools`(pcm-tools)

第一次 busboy-end 跑之前、本檔欄位手動填(start template 用、由 Claude.ai 維護)。

busboy-end 跑完後 amend 進 slice 主 commit、不另開 commit。

---

## 變更紀錄

| 日期 | 變更 | 變更者 |
|---|---|---|
| 待 day-1 commit 後填 | 初始化 STATUS.md | Sean(手動) |
| 2026-04-30 | slice 5 完成 + busboy fix | Claude Code |
| 2026-04-30 | design-sync-finalize 完成 | Claude Code |
| 2026-04-30 | brainstorming + 後台+自動化 spec + Claude.ai feedback | Claude Code |
| 2026-04-30 | 4 件 setup 完成(Supabase / Vercel / Railway / GCP)+ handoff §10 進度紀錄 | Claude Code |
| 2026-05-01 | M-0-01a 完成(root TS 環境 + turbo typecheck pipeline)、busboy-end 收工 | Claude Code |
| 2026-05-01 | M-0-01b 補丁完整版完成(4 packages 空殼 + ui/schemas + pnpm catalog typescript)、backlog #6 字面 vs 事實事件、busboy-end 收工 | Claude Code |
| 2026-05-01 | M-0-07 完成(C3 ADR-0003 + C5 L1 規則層 + NORTHSTAR §1.1 補敘 + backlog #6.1 ✅ / #7 / #8 新增 + M-0 排程 patch)、busboy-end 收工 | Claude Code |
| 2026-05-01 | M-0-08 完成(C4 三權分立 — security-timeline.md Phase 1 安全時序統一表 30 條 + backlog #4/#7 加交叉引用)、busboy-end 收工 | Claude Code |
| 2026-05-01 | STATUS-fix 完成(字面校準 + backlog #3 解 + #9 新增 + M-0 §3.5.1 執行順序註記)、busboy-end 收工 | Claude Code |
| 2026-05-01 | M-0-04 完成(ports 5 介面 IProductRepository / ICustomerRepository / IOrderRepository / ISheetsAdapter / ITapPayAdapter + domain 6 context type stub shared/catalog/identity/order/sync/payment + @pcm/domain workspace dep + backlog #10/#11/#12/#13)、busboy-end 收工 | Claude Code |
| 2026-05-01 | M-0-04 audit amend 完成(MemberTier 移 shared / findByFitment → listByFitment / ports JSDoc TODO milestone-anchored M-1-03/M-4a-08/M-4a-10/M-4a-XX / FitmentSpec + CategoryPath @see anchor / backlog #11 擴 ITapPayAdapter 命名抽象化 + 加 #14 SheetRangeSpec 抽象化 + 加 #15 Sean skill audit 工作流)、busboy-end 收工 | Claude Code |
| 2026-05-01 | M-0-04 雙輪 skill audit follow-up 完成(第一輪 engineering:code-review 抓 5 / 第二輪 simplify 抓 12 / 處理 7 個命名+JSDoc:S1 listByBrand/S2 searchByKeyword/S4 SyncResult JSDoc/N5 ICustomerRepository import note/N6 OrderItem.quantity guard/N7 Product enumerate/N8 Cardholder PII expand;backlog 9 條更新:擴 #11/#14、新 #16-#21、更新 #15)、busboy-end 收工 | Claude Code |
| 2026-05-02 | M-0-03 完成(ESLint 邊界守門 7 條 boundaries/dependencies + 8 task lint script + 7 條 dry-run 全 CAUGHT + dependency-rules.md;字面 vs 事實偏離 4 條 commit body 揭示:eslint v10.3.0/v9 + --no-error-on-unmatched-pattern + .ts 副檔名 dry-run hack + ADR-0003 §3.4 backlog 條目錯置;engineering:code-review audit 抓 8、立即修 C1/C2/C3/S1、backlog 加 #22-#25 4 條、config-only slice 豁免 simplify)、busboy-end 收工 | Claude Code |

— END —
