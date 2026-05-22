# Codex Review Packet — M-1-13Z eslint-plugin-react-hooks install

> 產出時間:2026-05-23 / commit 前 / 不 push
> 對應規範:`docs/patterns/codex-review-packet.md` §4 + 鐵則 12(動 infra config + 跨檔 lint 行為改變)
> 階段 C code-reviewer 已先審:**PASS、0 must-fix**(3 consider 採納 2)

---

## 第二輪 review timing 說明(2026-05-23 補)

本 packet 第一輪 external review 發生在 commit 前(M-1-13Z 修完未 push)、屬「push 前 gate」位置;第二輪 external review 發生在 push 後(commit `0d9b0a4` 已進 origin/dev),屬事後審查、不阻塞 push、不削弱 code 本身正確性。本段補註對齊鐵則 11 字面 vs 事實守則。

---

```
Codex Review Packet

Mode:        唯讀審查,不要修改檔案。只回 findings / 風險 / 是否可繼續。
Repo:        /Users/sean_1/pcm-website-v2

Slice / 目標:
  M-1-13Z — 裝 eslint-plugin-react-hooks + 開兩條規則 + 修既有違規 + CLAUDE.md 字面校正。
  目的:讓 repo ESLint 真正守 React hooks 紀律(rules-of-hooks + exhaustive-deps),
  並把 CLAUDE.md 內描述「規則已 active」但實際未裝 plugin 的字面校正為實況。

內容分級: L1(infra config / 開發工具紀律,變更頻率極低)。

重大改動判定: 是。
  - 動 eslint.config.js(共用 config)+ pnpm-workspace.yaml(catalog)+ pnpm-lock.yaml
  - 跨檔改變全 storefront + packages/ui 的 .tsx lint 行為(rules-of-hooks + exhaustive-deps 從無到 error)
  - 命中鐵則 8(動 config / 共用元件)+ 鐵則 12(動 infra)→ 本 packet。

═══════════════════════════════════════════
本 slice 經 Sean 兩次重拍(關鍵脈絡,Codex 請留意)
═══════════════════════════════════════════

【重拍 1:版本路線】
  原 slice 指令假設裝 v5 stable(rules-of-hooks + exhaustive-deps)、避開 v6 beta(purity / set-state-in-effect)。
  Code 偵察 npm 實況發現:
    - dist-tags.latest = 7.1.1(v5 已退役、最後一版 5.2.0;v6 為 RC,非 beta)
    - peer 相容性:v5.2.0 peer = ^3..^9(無 ^10);v6.0.0-rc.2 peer = ^3..^9(無 ^10)
    - 本專案 catalog eslint = ^10.3.0、已裝 10.3.0
    - 唯一乾淨支援 eslint ^10 的是 v7.1.1(peer = ^3..^9 || ^10)
    - v7.1.1 仍保有 rules-of-hooks + exhaustive-deps 規則(從 npm pack 抽 .d.ts 確認、兩條 recommended:true)
  Sean 重拍 Q1=A / Q2=A(2026-05-23):裝 v7.1.1、但 eslint.config.js 只開 rules-of-hooks + exhaustive-deps
  兩條老規則,v7 新規則(purity / set-state-in-effect / no-deriving-state-in-effects / immutability 等)不開、
  留 backlog #168 follow-up slice 評估。

【重拍 2:違規處理】
  原 slice 預估裝完只 1 條違規(ProductsPage mount effect)、原禁止清單明文「不可動 ProductInfo.tsx」。
  實際 lint 抓 4 條(全 exhaustive-deps、rules-of-hooks 0 條):
    - ProductsPage.tsx mount effect(missing searchParams)— 預期內
    - ProductPage.tsx L145 麵包屑 useMemo(missing withVehicle)— 未預期、不在禁止清單
    - ProductInfo.tsx L54 sizeOptions useMemo(unnecessary product.id)— 未預期、在禁止清單
    - ProductInfo.tsx L61 colorOptions useMemo(unnecessary product.id)— 未預期、在禁止清單
  Code 停下回報「禁止清單禁 ProductInfo vs 三綠要 lint 綠」矛盾。
  Sean 重拍 Q=A(2026-05-23):解除 ProductInfo.tsx 禁令、4 條一起修。

目前狀態:
  git branch --show-current → dev
  git status --short --branch → ## dev...origin/dev(本 commit 精準 add 12 檔、含 next-env.d.ts、Sean Q1=A 拍納入)
  git log --oneline -3:
    34ed94e docs(roadmap): 刷新進度地圖至 M-1-13 完成 [M-1-13I]
    2af5f1b docs(backlog): #165-167 M-1-13I reviewer 3 條順帶建議
    1d82425 fix(storefront): 修車種狀態跨頁傳遞 3 bug + V1 manifest audit [M-1-13I]

Changed files(本 commit 精準 add 12 檔):
  1. pnpm-workspace.yaml — catalog 加 eslint-plugin-react-hooks: ^7.1.1
  2. package.json(root)— devDependencies 加 "eslint-plugin-react-hooks": "catalog:"
  3. pnpm-lock.yaml — install 自動產生(釘 react-hooks@7.1.1(eslint@10.3.0))
  4. eslint.config.js — 加 React-only block(files glob + 兩條規則 error)
  5. apps/storefront/src/components/ProductsPage.tsx — mount effect 補 disable + 改寫原「repo 未裝 plugin」不實註解
  6. apps/storefront/src/components/ProductPage.tsx — withVehicle 升 useCallback([vehicle]) + crumbs useMemo deps 補 withVehicle(外部 reviewer Q2、Sean 拍;取代原 disable 寫法)
  7. apps/storefront/src/components/ProductInfo.tsx — L54/L61 兩 useMemo 刪多餘 product.id dep
  8. CLAUDE.md — React 19 hooks 段字面校正(v7.1.1 實況 + v7 未開規則演進路徑)+ L322 順手
  9. docs/phase-1-backlog.md — 新增 #168(v7 新規則開啟評估、strict 格式)+ #169(next-env.d.ts gitignore 評估)+ #167 加 M-1-13Z 現況更新
  10. STATUS.md — 7 欄位同 commit 更新
  11. docs/reviews/2026-05-23-eslint-react-hooks-install-packet.md — 本 packet
  12. apps/storefront/next-env.d.ts — Next 16 build 自動生成檔(檔頭明寫 not be edited)、build 後本機 dirty、Sean Q1=A 拍納入跟上 build 後狀態(不手 edit);長遠 gitignore 評估開 backlog #169

重點 diff(git diff --stat,排除 next-env.d.ts):
  CLAUDE.md                  | 30 +++---
  ProductInfo.tsx            |  6 ++--
  ProductPage.tsx            |  3 ++
  ProductsPage.tsx           |  8 ++---
  docs/phase-1-backlog.md    | 21 ++++--
  eslint.config.js           | 22 ++++++
  package.json               |  1 +
  pnpm-lock.yaml             | 45 ++++++++
  pnpm-workspace.yaml        |  1 +
  9 files changed, 124 insertions(+), 13 deletions(-)

eslint.config.js 新 React-only block(核心 diff):
  {
    files: ['apps/storefront/**/*.tsx', 'packages/ui/**/*.tsx'],
    plugins: { 'react-hooks': reactHooks },
    rules: {
      'react-hooks/rules-of-hooks': 'error',
      'react-hooks/exhaustive-deps': 'error',
    },
  },

4 條違規修法清單(檔 / 行 / 規則 / 修法):
  1. ProductsPage.tsx mount effect(react-hooks/exhaustive-deps, missing searchParams)
     → 補 // eslint-disable-next-line react-hooks/exhaustive-deps + 改寫舊「repo 未裝 plugin」不實註解為冪等理由
     → 理由:mount-only effect 刻意 [] deps、跨頁進站讀 URL 一次、同頁靠 cascade state
  2. ProductPage.tsx L145 麵包屑 useMemo(react-hooks/exhaustive-deps, missing withVehicle)
     → 外部 reviewer Q2 + Sean 拍:withVehicle 升 useCallback([vehicle])、crumbs useMemo deps 補 withVehicle
     → 取代原規劃的 disable + 註解寫法;讓 lint rule 繼續守住未來閉包變更(不靠人工 disable)
  3. ProductInfo.tsx L54 sizeOptions useMemo(react-hooks/exhaustive-deps, unnecessary product.id)
     → deps [product.id, product.category] → [product.category]、不加 disable(屬語意正確化)
     → 理由:body 只用 product.category、product.id 為多餘 dep(grep 證實 body 內無 product.id)
  4. ProductInfo.tsx L61 colorOptions useMemo(react-hooks/exhaustive-deps, unnecessary product.id)
     → deps [product.id, product.color] → [product.color]、不加 disable(同上)

已跑驗證(三綠 + 安裝驗證):
  pnpm typecheck → ✅ 7/7 packages
  pnpm lint      → ✅ 10/10 packages(react-hooks 違規 0、exit 0)
  pnpm build     → ✅ storefront next build 通過(動 .tsx 故跑)
  node_modules/eslint-plugin-react-hooks/package.json → 7.1.1
  pnpm-lock.yaml → eslint-plugin-react-hooks@7.1.1(eslint@10.3.0)
  component test → ✅ 3 檔 22 tests 全過(vitest run ProductInfo/ProductPage/ProductsPage.test.tsx)
                   ※ 含 ProductPage useCallback 改動後重跑、行為無變(M1 修;外部 reviewer 要求跑實況)

═══════════════════════════════════════════
Manifest 異動摘要(本 packet 期間)
═══════════════════════════════════════════
新加 business_overrides:無(本 slice 純 lint 紀律、未碰任何 design 對齊或業務 override)
新加 open_drifts:無
last_modified_commit 同步狀態:
  - 動到 3 個 storefront 元件(ProductsPage / ProductPage / ProductInfo)、均 lint-only
    (ProductsPage 補 disable / ProductPage 升 useCallback / ProductInfo 刪多餘 dep)、無行為改動、無 design 對齊變動。
  - 判定不 bump last_modified_commit:沿用 M-1-13I commit 1d82425 慣例。
    ※ reviewer 校正:1d82425 該處在原 commit body 標為「已知缺口、下次 sync 統一更新」,
      非一條被祝福的「lint-only 免 bump」規則;manifest 檔頭(L4)亦無 lint-only 例外條款。
      本 slice 援引此先例做免 bump 可接受(改動確為 lint-only),但屬「已知缺口、下次 design sync 統一補」。
  - last_global_sync:637dafc / 2026-05-21(本 slice 未動 design submodule、不更新)

═══════════════════════════════════════════
相關規則摘錄(讓 Codex 無需 repo 存取即可對照)
═══════════════════════════════════════════
- 鐵則 8:重大改動(跨 3+ 檔 / 動 config / 共用元件)動手前先提 plan 等批准。
  → 本 slice 經 Sean 兩次重拍(版本 Q1=A/Q2=A + 違規處理 Q=A)= plan 批准流程已走過。
- 鐵則 11:三綠 checkpoint(typecheck + lint + build)+ 字面 vs 事實守則
  (commit 訊息對應實際內容、偏離須 commit body 註明)。
- 鐵則 12:動 infra → commit 前產 Codex Packet、不 push(本檔)。
- CLAUDE.md「React 19 hooks 嚴格」舊字面(本 slice 校正前):描述 react-hooks/purity +
  set-state-in-effect 為 active 規則,但 repo 當時未裝 plugin(memory project-eslint-no-react-hooks-plugin
  記載此「期望非實況」落差)。本 slice 把字面校正為 v7.1.1 實況(只開兩條)+ v7 未開規則演進路徑。
- backlog #167:react-hooks 字面誤導註解掃清(本 slice 部分觸發、剩 ProductInfo L7/L75 prose 註解留 follow-up)。
- backlog #168(本 slice 新增):v7 新規則開啟評估(purity / set-state-in-effect 等、預估 10-30 條違規、follow-up slice)。

想請 Codex 重點看:
  1. 版本決策:v7.1.1 + 只開兩條老規則,是否為「保留 Sean 原意(兩條安全規則)+ 相容 eslint 10」
     的合理解?有無更穩妥選項(如釘 7.1.0 而非 ^7.1.1)?
  2. eslint.config.js React-only block 的 files glob(storefront/**/*.tsx + ui/**/*.tsx)是否漏網
     (例:storefront 內 .ts 檔有無 hooks?packages/ui 是否真為唯一另一 React 來源)?
  3. 1 處 eslint-disable-next-line(ProductsPage.tsx mount effect、屬 mount-only 合法用法)是否妥當?
     ProductPage 原規劃 disable 已於 Sean 2026-05-23 Q2 拍板升 useCallback 改寫、無 disable;
     ProductInfo L54+L61 純刪多餘 dep 不是 disable。
  4. ProductInfo L54/L61 刪 product.id dep 是否真零行為風險(product 換但 category/color 同值時記憶體行為)?
  5. 字面 vs 事實:CLAUDE.md 新字面 / backlog #167 現況更新 / commit body 揭示,有無仍 stale 或自相矛盾處?
  6. next-env.d.ts 納入本 commit(Sean Q1=A)是否妥當?長遠 gitignore(已開 backlog #169)是否為對的方向?
  7. 是否有該補的 backlog 或文件。

═══════════════════════════════════════════
外部 reviewer findings 處置紀錄(本輪 stage D)
═══════════════════════════════════════════
外部 reviewer(階段 D)回 FAIL:3 must-fix + 1 consider + 1 nit。Sean 拍板處置:

- [M1 / must-fix] component test 標 N/A 不足 → 跑 storefront component test 拿實況、寫進 packet + commit body。
  (處置結果見上方「已跑驗證」段 component test 行。)
- [M2 / must-fix] backlog #168 未對齊 phase-1-backlog.md 檔頭 strict 13 必含元素 + 分流標籤 →
  #168 整段重寫為 strict 格式(狀態 / 分流 P1-before-launch / 優先級 / 問題 / 觸發 / 解法 / 不修會痛 / 估時 / 依賴 / 發現於 / 相關)。
- [M3 / must-fix] next-env.d.ts dirty file 處置不明 → Sean Q1=A 拍納入本 commit(跟上 build 後狀態、不手 edit)、
  長遠 gitignore 評估開 backlog #169。
- [Q / consider] ProductPage withVehicle 用 disable 埋 stale closure 風險 → Sean Q2 拍升 useCallback([vehicle])、
  crumbs deps 補 withVehicle、取代 disable;lint rule 持續守、未來 dep 變動自動擋。
- [N1 / nit] packet「3 處 disable」字面誇大 → 校正為「1 處」(僅 ProductsPage mount effect;ProductPage 升 useCallback 無 disable;ProductInfo 純刪 dep)。

兩次重拍紀錄:
  2026-05-22 Sean 原拍 Q1=C / Q2=A(v5 stable)
  → 2026-05-23 Code 偵察 raise v5 退役 + 不支援 ESLint 10、Sean 重拍 Q1=A / Q2=A(v7.1.1 + 只開兩條老規則)
  → 2026-05-23 Code raise「ProductInfo 禁令 vs 三綠」矛盾、Sean 重拍 Q=A(解禁、4 條一起修)
  → 2026-05-23 外部 reviewer FAIL、Sean 拍 next-env Q1=A + withVehicle Q2 升 useCallback。

Claude Code 自評: 可 commit(階段 C code-reviewer PASS、外部 reviewer findings 已全數處置、三綠重跑全綠)。
  本輪修完直接走 commit + busboy + roadmap、不 push、等 Sean 手動推。
```

---

## 給 Sean 的轉貼指引

把上方 code block 整包貼進 Codex session(chatgpt.com/codex),附這句:

> 請唯讀審查這包,不要改 code,只回 findings / 風險 / 是否可繼續。

收到 Codex findings 後貼回 Cowork / Claude Code,再決定:修正 / 補 backlog / commit。全程不 push。
