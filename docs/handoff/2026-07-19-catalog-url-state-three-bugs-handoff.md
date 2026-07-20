# 交接 — 前台商品目錄 URL 狀態機三個 bug(2026-07-19)

> ⚠️ **本檔是插隊 bug 修復線的當次快照,不是 M-4a 主線交接。** M-4a 的開工入口仍是
> `docs/handoff/CURRENT.md` + `STATUS.md`「下一步」——本 session **未動** CURRENT.md
> (它屬 M-4a 主線,平行 session 在維護)。

## 交接資訊

- Updated: 2026-07-19,Asia/Taipei
- Agent: Claude Code 實作視窗(Sean 回報「取消品牌後商品不消失」→ 連帶挖出另外兩個 bug)
- Branch / HEAD: `dev` = `49afb07`;**本地 = `origin/dev` = `origin/main` 三者對齊**、未推 commit **0**
- 🔴 **三片皆已在 production**(`origin/main` = `49afb07`)。⚠️ **本視窗全程未執行 `git push` 到 main**
  —— 發現 `origin/main` 已含這三個 commit 時它就已經在那了;`git reflog show origin/main` 只記
  `update by push`、**不記執行者**,無法從 git 判定是 Sean 手推或平行 session 所致(與 STATUS
  記載的 07-19 push 事故同型)。本視窗只執行過一次 `git push origin dev`(Sean 明示),
  且該推送是把落後的 `dev` fast-forward 到 `main` 的位置,不影響 production。
- DB / migration: **零**。三片皆純前台 client 端,無 schema、無 RPC、無 env 變更。

## 修了什麼(三片,commit 由舊到新)

| commit | 症狀(客人視角) | 檔案 |
|---|---|---|
| `61f45b6` | 勾多個品牌後**取消其中一個,該品牌商品不消失** | url-state +18 / 新測試 136 / ProductsPage.test +4 / backlog +67 |
| `630b7a6` | **點第 2 頁沒作用**,分頁 UI 跳了但內容退回第 1 頁(目錄 512 頁形同翻不動) | url-state +64/-x / 測試 +95 / backlog +47 |
| `49afb07` | 帶 `?page=N` 的**深連結進站被吃掉頁碼**(內容第 1 頁、UI 停在舊頁碼) | url-state +41/-x / 測試 +30 / backlog +32 |

**三者根因不同,但全在 `apps/storefront/src/components/products-url-state.tsx` 的
`useCatalogFilterUrlSync` 這一個 effect 裡。** 後兩個已用基準版對照實測確認是**既有 bug**、
非前一片引入(`61f45b6` 對照分頁、`630b7a6` 對照深連結)。

### 根因一句話版

1. **品牌**:Next 16.2.6 以 `Object.fromEntries(new URLSearchParams(...))` 產 page segment
   cache key(`next/dist/esm/client/route-params.js` `getCacheKeyForDynamicParam`,已讀
   node_modules 實查),**重複 query key 只留最後值** → `?pbrand=a&pbrand=b` 與 `?pbrand=b`
   同 key → `router.replace` 判定同一 segment、重用舊 CacheNode、**零 RSC 請求**。
2. **分頁**:effect deps 含 `restoreSources`(ProductsPage 的 `useMemo(...,[categories,brands])`)
   → server 每回新 props 就換 identity → effect 重跑 → **無條件** `delete('page')` 洗掉頁碼。
3. **深連結**:篩選指紋無法區分「使用者改篩選」與「還原波」→ restore dispatch 讓指紋由空變
   非空 → 誤判為使用者操作 → 刪 page。**實測不自癒**(`useBrowseUrlSync` deps 此時全未變)。

### 修法(三者疊在同一 effect,順序有意義)

```
① state 剛追上 URL(還原波)→ early return          ← 深連結片
② 篩選指紋真變動才 delete('page')                    ← 分頁片
③ URL 比較正規化(排序後比 entries,忽略順序)
④ segment key 真碰撞才補一次 router.refresh()        ← 品牌片
```

🔴 **安全前提(勿破壞)**:`params` 是 `window.location.search` 的原樣拷貝,本 effect 只改寫
`pbrand/category/price/pmin/pmax` 五軸,外來鍵兩側恆等 → ①的比對才等價於「五軸已與 state 一致」。
**不得在①之前再新增任何 `params.set/delete`。**

## 驗證強度(全部本地 production build 實跑,非 dev)

- 品牌六步 `648/1103/455/523/68/12793` 全對;碰撞式新增(先 bonamici 再加 akrapovic)`1103` 正確
- 分頁 1/2/3 頁:網址、頁碼 UI、第一張商品卡皆正確變動,每步僅 1 次型錄查詢
- 深連結 `?pbrand=akrapovic&page=2` 進站:URL 保持完整、首卡 `akrapovic-sm-k10so1t`
  (**≠** 第 1 頁的 `akrapovic-s-d9so14-hifft`)= 真的停在第 2 頁
- **十向突變測試全數命中**(每條守門都驗過「破壞它會不會紅」,不是假綠)
- 三綠(typecheck / lint / build,皆 `--force` 繞 turbo 快取)+ 231 檔 **2539 測**全過

## 🔴 殘餘與待辦(已全部落 backlog,不留在對話裡)

| 編號 | 內容 | 優先級 |
|---|---|---|
| **#287** | 品牌改單值 `?pbrands=a,b` 治本解 —— 現況碰撞情境仍需 **2 次**型錄查詢 | 🟠 中 |
| **#288** | production build E2E 守門(現有 playwright 只跑 `next dev`,擋不住框架層回歸)。**已收 #289 移交的必測案例**:`?page=3` 時選車(桌面 + mobile 各一次) | 🟠 中 |
| **#289** | ✅ **已完成**(本 session 第三片);條目保留歷史敘述與「會自癒」假設被推翻的更正 | — |

⚠️ **本 session 未實測、已明寫的項**:`?page=3` 時**選車**路徑。當時原因=判定 `/products` 桌面版
沒有車款選單(「選擇車款」是 mobile-only chip、桌面實測寬高為 0,須走 mobile drawer);
🔴 **2026-07-20 production build 實測更正:此原因不成立** —— 桌面車款選單 `.cft-bar` 可見可用
(1440×64、三個 combobox、點擊展開 54 個車款選項);當時量到寬高 0 的是**另一個元件**
`.cft-mobile-bar`(全尺寸皆 `display:none` 的死碼,見 backlog #290)→ **當時桌面即可實測**;
不硬湊,改為明寫未驗證並移交 #288。讀碼評估不致造成內容與頁碼不一致
(`usePageResetOnFilterChange` key 含整個 cascade、選車必 `setPage(1)`),最壞為多一次
帶舊 page 的往返 —— **此評估同樣來自讀碼、未經實測**。

## 🔴 下一個 session 要注意的坑

1. **改這個 effect 前先讀檔內註解**。四道判斷互相依賴(尤其①的安全前提),單獨看任一行都
   會覺得多餘。十條單元測試(`products-url-state.hooks.test.tsx` 案例①-⑩)是唯一守門,
   每條都標了「破壞什麼會讓它紅」。
2. **升級 Next 必須重跑六步實測**。品牌片的修法依賴 Next 內部快取實作細節;單元測試只驗得到
   「有沒有呼叫 router API」,驗不到「呼叫後畫面有沒有真的更新」。
3. **dev 與 production 的 router 快取行為不同** —— 這三個 bug 全部只在 `next build && next start`
   下才重現得出來,`next dev` 看不到。
4. **鐵則 6**:`products-url-state.tsx` 現 **435 行**(實測 `wc -l`)。此檔為 **hook 檔**(無 JSX),
   適用「>200 行評估拆分、不拆須於 commit body 寫理由」而非 400 行元件檔門檻。不拆理由已寫進
   `49afb07` 的 commit body。**下一片再長,優先把 parsers(`parseCategoryFromUrl` /
   `parseBrandFiltersFromUrl` 等)抽成獨立檔。**
5. `products-url-state.tsx:82` 有一句既有 dangling reference(「見 backlog #269」,但 #269 實際是
   「首頁殘餘死連結」)—— **非本 session 引入**,已記在 #287 條目末尾,修 #287 時順手清。

## 審查與過程紀錄(供制度追溯)

- **每片皆 code-reviewer R1 → 修 → R2**,共 6 輪。三片 R1 全 FAIL、R2 兩片 PASS 一片 FAIL 後修畢收案。
- 🔴 **審查抓到的絕大多數是「字面 vs 事實」而非邏輯錯誤**:①寫了未實測的「最終會由
  `useBrowseUrlSync` 自癒」(補實測後**被推翻**)②用了沒量過的行數 432(實測 435)
  ③把新行數誤套到歷史 commit 條目 ④測試檔 docblock 過時宣稱未同步(命中既有教訓
  `feedback_claimed-sync-but-only-patched-touched-lines`)。
- **codex 諮詢的價值分佈**:根因分析**正確**(且附可反駁預測、實測命中);同一份回覆的**修法
  建議實測無效**(`window.history.replaceState` + `refresh()` 沒修好)。已寫成 memory
  `feedback_falsifiable-prediction-beats-endorsement`。
- 本 session 新增 memory:`reference_nextjs-duplicate-query-key-segment-collision`(技術眉角)、
  `feedback_falsifiable-prediction-beats-endorsement`(工作法),MEMORY.md 索引已更新。

## Working tree ownership(凍結、勿混入 commit)

- `.gitignore`、`docs/progress-roadmap.html`(session 前既有 modified,本視窗**未碰**)
- untracked 凍結群同 `CURRENT.md` 所列(截圖、handoff/specs 草稿、`docs/superpowers/`)
- ⚠️ 本 session 期間平行 session 亦在動 `scripts/image-trim-*.ts` 與 STATUS;三次 commit 皆用
  **精準路徑 add**,每次 commit 後以 `git status --porcelain` 驗過未掃入他人檔案。

## 安全邊界

- 不讀不輸出 `.env*`、service role、TapPay/LINE secret、客戶個資實值(本 session 全程未觸及)。
