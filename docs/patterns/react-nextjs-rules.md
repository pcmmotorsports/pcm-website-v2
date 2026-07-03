# React / Next.js 規則

> 2026-07-03 自 CLAUDE.md 本體原文搬出(瘦身、內容零改動)。觸發:動 hooks / eslint 設定 / useEffect 相關 code 時讀本檔。

- **React 19 hooks**:只開兩條 v5 規則(eslint-plugin-react-hooks v7.1.1、M-1-13Z 拍板)— `rules-of-hooks`(error、防條件/loop/nested 內呼叫)+ `exhaustive-deps`(error、防 deps 漏列多列、stale closure 防線)。套用 `apps/storefront/**/*.tsx` + `packages/ui/**/*.tsx`。
  - mount-only useEffect 合法寫法:`}, []);` 上一行 `// eslint-disable-next-line react-hooks/exhaustive-deps` + 內聯註解述意圖;deps 多餘則直接刪(語意正確化、不加 disable)。
  - v7 React Compiler 相關新規則(purity/set-state-in-effect/immutability 等)**未開**、留 follow-up、**見 backlog #168**(別在本檔列舉)。
- **build pass ≠ runtime pass**:`ignoreBuildErrors` 只影響 TypeScript、不影響 ESLint;Vercel build 不跑 ESLint、ESLint 守門靠 CI gate(GitHub Actions)。
