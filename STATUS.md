# STATUS.md

> 用途:PCM Phase 1 重做的 single source of truth。Claude.ai 與 Claude Code 每次新對話必先讀此檔對齊狀態。每完成一個 slice 後由 busboy-end 自動更新。
>
> 衝突仲裁:STATUS.md > docs/PHASE-1-NORTHSTAR.md > 其他 md > 對話歷史。

---

## 當前狀態

**Phase:** Phase 1(整個重做、新 repo `pcm-website-v2`)
**Milestone:** M-0(monorepo 骨架已建)
**當前 slice:** slice 5 完成、待 slice 6 monorepo 套件初次安裝
**Branch:** dev

## 最後更新

**時間:** 2026-04-30
**更新者:** Claude Code(slice 5 + busboy-fix)

## 最近 3 commit

| Hash | 訊息 | 時間 |
|---|---|---|
| 619e96d | chore(monorepo): 初始化 pnpm + Turborepo 骨架 [slice-5] | 2026-04-30 |
| d692553 | chore(submodule): 更新 design-reference 指針 d700ca4 → d5ea3aa | 2026-04-30 |
| a151ca5 | chore: 加 .gitignore 並移除誤入的 .DS_Store | 2026-04-30 |

## 下一步(第 1 條優先)

1. **Claude Code slice 6:框架初次安裝(待 Claude.ai 寫指令)** ← 當前
2. (待 slice 6 完成後 Claude.ai 規劃 slice 7)

## Sean 待決策

| # | 決策內容 | 阻塞什麼 |
|---|---|---|
| 1 | PRD-rewrite.md 內容(待 Claude.ai 寫完草稿後 Sean 看) | M-0 後所有 milestone |
| 2 | TapPay sandbox 是否沿用舊環境 / 需重申請 | 結帳流程 slice |
| 3 | Vercel / Railway 部署是否新建 / 沿用 | 部署 slice |

(其他項目:無)

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
- **busboy-end.js:** Claude Code 在 session 最後跑、自動更新本檔 4 個欄位(最後更新 / 最近 3 commit / 當前 / 下一步第 1 條)、commit、不 push(Sean 手動推當 review checkpoint)
- repo 參數:`pcm`(本 repo)/ `api`(舊 pcm-website)/ `tools`(pcm-tools)

第一次 busboy-end 跑之前、本檔欄位手動填(start template 用、由 Claude.ai 維護)。

---

## 變更紀錄

| 日期 | 變更 | 變更者 |
|---|---|---|
| 待 day-1 commit 後填 | 初始化 STATUS.md | Sean(手動) |
| 2026-04-30 | slice 5 完成 + busboy fix | Claude Code |

— END —
