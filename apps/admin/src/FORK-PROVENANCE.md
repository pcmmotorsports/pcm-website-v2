# apps/admin — Fork 來源紀錄(M-4a M0-S1)

> 對應 PRD `docs/specs/2026-07-12-m4a-admin-phase1-prd.md` §3.3「一次性 fork:記錄來源 commit、
> 砍掉不用頁面與其 auth、留 sidebar/topbar/theme」。**一次性 fork,不追上游 merge。**

## 來源

- Repo:`Kiranism/next-shadcn-dashboard-starter`(MIT)
- Fork commit:`0edc5cf631ac7a8280112fd2bcb80312597bafdf`
- Commit 日期/訊息:`2026-07-11 — Merge pull request #177 from Kiranism/baseui`
- Fork 日期:2026-07-12

## 上游棧(fork 當下)

Next `16.2.6` / React `19.2.4` / Tailwind v4 `^4.2.2` / shadcn(base-nova、`@base-ui/react`)/
oxlint+oxfmt。**與 PCM monorepo 目標棧幾乎一致**(Next 16.2.6 / React 19.2.x / Tailwind v4),
故 PRD 原擔心的「Next 15→16 相容 spike」實際落差極小;此為本 M0-S1 整合 spike 的主要結論。
(admin 自身 `package.json` pin React/react-dom `19.2.6`、對齊 monorepo storefront,非上游的 19.2.4。)

## 帶進來的(留)

- shadcn/base-ui primitive 子集(`src/components/ui/`):`sidebar` `button` `spinner` `input`
  `separator` `sheet` `skeleton` `tooltip` `breadcrumb`(sidebar 殼的最小 import 閉包)。
- `src/components/icons.tsx`(Tabler 圖示 barrel)、`src/lib/utils.ts`(cn)、
  `src/hooks/use-mobile.tsx`、`src/components/theme-provider.tsx`(next-themes 薄包裝)。

## 砍掉的(不用)

- **auth**:整包 Clerk(`@clerk/nextjs`、`proxy.ts`、`src/app/auth/**`、`src/features/auth/**`、
  providers 的 `ClerkProvider`)。第一期不做登入;SSO 收端待提案批准後另 slice 加。
- **監控**:`@sentry/nextjs` 及 `next.config` 的 `withSentryConfig`。
- **示範功能頁**:`dashboard/{overview,product,users,kanban,forms,chat,react-query,profile,
  billing,workspaces,...}` 與對應 `src/features/*`。
- **重依賴**:`kbar`(Cmd+K)、`nuqs`、`nextjs-toploader`、`@dnd-kit/*`、`@tanstack/*`、
  `recharts`、`react-dropzone`、`zustand` 等(隨 auth/功能頁一起移除)。
- **多主題切換**:原 `[data-theme='x']` 9 主題 OKLCH 系統攤平為單一 `:root`/`.dark`
  (色板取自上游 `vercel` 中性灰階主題),light 預設(Sean 07-12 拍:後台明亮乾淨、以好用為先)。
- **lint/format**:上游 oxlint/oxfmt 改用 monorepo 既有 ESLint flat config(boundaries)。

## 目前狀態

純殼:sidebar(靜態占位導覽 總覽/訂單/客戶,尚未導頁)+ header(標題 + light/dark 切換)+
單一占位頁。不接資料、不做登入。驗收 = `pnpm --filter @pcm/admin dev` 可跑、殼可見可操作。
