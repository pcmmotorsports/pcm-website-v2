# quick-reference.md — PCM Phase 1 速查

> WO-6(2026-05-19)自 STATUS.md 附屬區抽出。
> STATUS.md 只保留「當前狀態」、不變的速查資訊集中於此。
> 衝突仲裁:`STATUS.md` > `docs/PHASE-1-NORTHSTAR.md` > 本檔。

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

— END —
