# Codex Review Packet — #288-a production build E2E 守門(2026-07-20)

> 鐵則 12 觸發路徑:鐵則 8(跨 3+ 檔)連動。
> 🔴 **本 Packet 是「換路」產物**:codex CLI 對本片連續兩輪各跑 ~35 / ~57 分鐘、
> CPU 0%、輸出 0 byte(同一種失敗模式)→ 依 R4「相同錯法第 2 次不重試、換路」停止,
> 改走書面 Packet 由 Sean 轉貼 web Codex。後續:Sean 轉貼後 **web Codex 判 FAIL(4 must-fix + 5 consider + 4 nit)**,已全數處置(見文末 R2 後記)。
> 已完成的審查:code-reviewer R1(6 must-fix,全修)+ Fable(7 條,全修)+ 我自己的全樹字面掃描(3 條殘留,已修)。

---

```
Codex Review Packet

Mode:        唯讀審查,不要修改檔案、不要 commit、不要 push。

Repo:        /Users/sean_1/pcm-website-v2   branch: dev

Slice / 目標:
  #288-a = 「production build E2E 守門」的第一片。只做一件事:
  證明這條管線跑得起來、而且「CI 冷快取下,核心商品 RPC 無法提供非零商品時會真的轉紅」。
  不含任何篩選行為斷言(品牌 / 分頁 / 選車依序在 #288-c / d / e)。

  為什麼要做:2026-07-19 商品目錄連出三個 bug(品牌取消不消失 / 分頁失效 /
  ?page=N 深連結被還原波吃掉),三個**全部由 Sean 逛正式站發現**,自動化零攔截。
  根因兩層:
    1. 這三個 bug 只在 `next build && next start` 重現,`next dev` 看不到,
       而既有 playwright.config.ts 的 webServer 跑的是 next dev → 結構上擋不到。
    2. 🔴 更關鍵:既有 e2e **從來沒進過 CI**。Playwright 2026-05-27 引進(435baa4)後
       config **建立至今零修改**、停在 2 個 spec 檔,當初註解自寫的
       「CI gate 留後續 slice(T-2+)」**兩個月沒發生**。
       沒人跑的守門 = 等於沒做。

內容分級:    不適用(純測試基建,不涉內容 CRUD)
重大改動判定: 🔴 是。跨 6 個新增/修改檔 + 新增 CI workflow → 鐵則 8 觸發,
             Sean 2026-07-20 口頭批准開工;鐵則 12 由此連動 = 本 Packet。

目前狀態:
  branch: dev(未 push;HEAD = 799a733)
  git log --oneline -3:
    799a733 refactor(storefront): 移除手機選擇車款死碼 chip 並改抽屜 tab 文案 [#290]
    1b84a2a docs(docs): 前台目錄 URL 狀態機三 bug 合併交接檔 [#287][#288][#289]
    49afb07 fix(storefront): 修帶 ?page=N 深連結進站被還原波吃掉頁碼 [#289]

Changed files(本片範圍;其餘 dirty 檔非本片、請勿審):
  新增
    apps/storefront/scripts/e2e-prod-preflight.mjs   env 前置檢查(必須在 build 之前)
    apps/storefront/playwright.prod.config.ts        第二份 config,跑 build+start 而非 dev
    apps/storefront/e2e-prod/runner-smoke.spec.ts    唯一一條 smoke:/products 真有資料
    .github/workflows/e2e-prod.yml                   把它接進 CI(這是根因 2 的解)
  修改
    vitest.config.ts              +4 行 exclude `**/e2e-prod/**`
    apps/storefront/package.json  +1 script `test:e2e:prod`
    docs/specs/2026-07-20-catalog-prod-build-e2e-plan.md   plan v3.2(真權威)
    docs/phase-1-backlog.md       #288 拆片 + #290 開立並結案
    STATUS.md                     七欄同 commit 更新

  ⛔ 不屬本片、請勿審:.gitignore / docs/progress-roadmap.html / docs/handoff/ /
     docs/marketing/ / *.png

重點 diff:
  git diff --stat(已追蹤檔):
    STATUS.md                    |  6 ++++--
    apps/storefront/package.json |  3 ++-
    docs/phase-1-backlog.md      | 20 ++++++++++++++++++--
    vitest.config.ts             |  4 ++++

  vitest.config.ts(關鍵:為何需要第二條 exclude)
    +      // 🔴 #288-a:`**/e2e/**` **不匹配 `e2e-prod` 這個 segment**(glob 比對整段路徑名),
    +      // 故 production build E2E 的目錄必須另外排除,否則 vitest 會拿它自己的 runner
    +      // 去跑 @playwright/test 的 API = 假紅。
    +      '**/e2e-prod/**',
    ✅ 反證已跑:拿掉這行 → vitest 誤抓並炸
       「Playwright Test did not expect test() to be called here」。

  playwright.prod.config.ts(全新,60 行;三個硬性設計)
    webServer.command = 'node scripts/e2e-prod-preflight.mjs && pnpm build && pnpm exec next start --port 3200'
    reuseExistingServer: false   🔴 恆為 false、不做條件式。
        理由:command 是「preflight && build && start」整條;reuse 命中則 build 不跑,
        突變自驗(故意改壞產品碼確認轉紅)會連到舊的、已修好的 server → 該紅不紅。
    retries: 0 + trace: 'retain-on-failure'
        🔴 原本寫 'on-first-retry',配 retries:0 = 永不產生 trace,
        CI 的「失敗時上傳 trace」步驟會靜默上傳空目錄 = 步驟名與事實不符。
    timeout: 180_000(本機 next build 冷啟實測 19s / warm 11s → 約 9x 餘裕)
    ⚠️ 已文件化的已知限制:本機 warm `unstable_cache`(products.ts revalidate 900,
       且 `next build` 不清 .next/cache)可能蓋掉「DB 壞 → 紅」;CI 恆冷快取不受影響。

  scripts/e2e-prod-preflight.mjs(改寫)
    要求 NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_ANON_KEY **有非空值**。
    🔴 codex #288-a MF1 指出舊版自己重寫優先序解析、對 ENV_FILES 取聯集,
       與 Next 實際規則不同,會在三種情境誤判非空(高優先為空但低優先有值 /
       `KEY= # comment` / `KEY=$UNSET_VAR`)。已改為直接呼叫 **Next 自己用的
       `@next/env`(`loadEnvConfig`)**,取它算出的 `combinedEnv`(已套用
       process.env 優先序 + dotenv 解析 + `${VAR}` 展開)、不再自行解析檔案。
       三個邊界情境已用暫時 fixture 目錄實測驗證,皆正確判定為非空不成立。
    🔴 安全邊界:只判斷「Next 實際會看到的值是否非空」,
       絕不印出、絕不離開作用域;不寫入任何檔案;錯誤訊息走 stderr。

  e2e-prod/runner-smoke.spec.ts(全新,唯一一條測試)
    goto('/products') → expect(response.ok())
    ① `.pp-grid a[href^="/products/"]` 首張可見且 count() > 0
    ② `.pp-count` 解析出的數字 > 0
    🔴 檔內已明確記載:`/products` **一樣有 fallback**(lib/products.ts:387-390
       catch 後回 { products: [], total: 0, error: true },畫面顯示「載入失敗」、
       HTTP 仍是 200)。⇒ 防線**不是**「沒有 fallback」,而是上面兩條斷言在
       error 態必然不成立。檔內另留警語:後續片不得把它們換成 response.ok() 之類淺斷言。

  .github/workflows/e2e-prod.yml(全新)
    on: push [dev, main] + pull_request;concurrency 取消同 ref 舊跑。
    if: 只跳過 fork PR(拿不到 secrets);本倉庫的 push/PR **一律跑,缺 secrets 硬紅**。
    steps: checkout → pnpm 9.15.0 → node 22 → install --frozen-lockfile →
           playwright install chromium → `pnpm test:e2e:prod`(working-directory apps/storefront)
           → 失敗時上傳 apps/storefront/test-results/
    env 從 secrets 取 NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_ANON_KEY。

🔴 本片最重要的一段:它自己曾經是假綠(已修,附實證)
  code-reviewer R1 判 FAIL 6 must-fix,其中兩條**合起來**讓本片成為它要防的東西:
    MF-4 preflight 只檢查「鍵名存在」。GitHub secret 未設定時 `${{ secrets.X }}`
         內插成**空字串**,而 env var **仍會被建立** → Object.keys(process.env) 含該鍵 → 通過。
         實測:`NEXT_PUBLIC_SUPABASE_URL="" node preflight` → 舊版印「OK」、exit 0。
    MF-5 smoke 只驗首頁。首頁三個資料源全自帶 catch fallback
         (lib/products.ts:249-256 / :482-489 / :535-542 + app/page.tsx:85-88 garage)
         → **零資料庫仍 200 + 骨架可見** → 通過。
  ⇒ 兩條相乘:CI 在完全沒設定 secrets 的情況下會**全綠**。
  修法:preflight 改驗非空值;smoke 改打 /products 並斷言卡片數 >0、.pp-count >0。
  ✅ 反假綠實證(清 .next/cache/fetch-cache 冷跑):
     NEXT_PUBLIC_SUPABASE_URL 指向不存在主機 → **1 failed、exit 1**(舊版同情境為綠);
     還原 → 1 passed (34.7s)。

已跑驗證:
  pnpm typecheck   8/8 successful
  pnpm lint        10/10 successful
  pnpm test        231 檔 / 2540 passed | 1 todo (2541)
  production E2E   1 passed(含完整 build,37.1s;冷快取版本)
  pnpm build       ⚠️ 未單獨再跑 —— 上次 E2E 綠之後只動過 .md,未動 .ts/.tsx
                   (E2E 本身每次都會跑一次完整 next build)
  git diff --stat apps/storefront/src/  → 空(產品程式碼零改動)
  codex 零留痕     跑前/跑後 git status --porcelain 比對一致

相關規則摘錄(讓 Codex 無需 repo 即可對照):
  鐵則 8  重大改動前先提 plan 等批准。「重大」= 跨 3+ 檔 / 動 schema·API·共用元件 /
          動 next.config·vercel.json·Medusa config·Prisma schema / 影響部署或資料遷移。
  鐵則 11 commit 前強制三綠(動 .ts/.tsx 加 build),任一紅停下修紅,
          不繞道 / disable / skip / ignore。
  鐵則 12 重大改動或進度單元收尾 → commit 前產 Packet、提醒 Sean 貼 Codex、不 push。
  字面 vs 事實 commit 訊息對應實際內容、不假裝完成沒做的事、有偏離寫 commit body。
          寫進 code/文件的字面值只認 ①grep/Read 本 repo 命中 ②官方文件當場查證 ③標「未確認」。
  Server 端鐵則 敏感資訊只進 .env.local、絕不提交 git、絕不貼對話。
  Git 紀律 精準 git add,禁 git add . / -A;不自動 push。

想請 Codex 重點看:
  A. 🔴 精確字面(codex #288-a MF4 指正,原字面「DB 壞掉會紅」範圍過大、已更正):
     本片 smoke 只斷言卡片數 >0 與 `.pp-count` >0,精確攔住的是
     **「CI 冷快取下,核心商品 RPC 無法提供非零商品」**這一種情況。
     **攔不住**:①taxonomy/分類/品牌統計個別失敗但核心商品 RPC 本身成功
     ②錯接到另一個「也有商品」的 Supabase project ③本機殘留 warm cache 掩蓋失敗。
     還有沒有殘留的假綠?/products 這條路徑上,在此精確範圍**之外**,
     有沒有「核心商品資料損毀但測試仍過」的路?
     特別是:Supabase client 在 URL 合法但 key 錯誤時的行為、以及 unstable_cache
     在 CI 冷快取下是否真的每次都打 DB。
  B. preflight 的非空檢查能否被繞過?空白字元、字面字串 "undefined"、只有引號、
     行內註解(KEY=value # comment)。Fable 已回報「空白值 / 引號包空白 / 行內註解」
     可通過 preflight 但會在 smoke 轉紅 —— 請獨立確認或推翻,並明確回答
     **有沒有任何一種會反而變成綠**。
  C. CI workflow:if 條件、working-directory、pnpm --filter 名稱、artifact 路徑是否正確?
     有沒有任何路徑會把 secret 值印進 log?
  D. 安全:preflight 的任何分支(例外、讀檔失敗)有沒有可能洩漏 env 的**值**?
  E. 字面 vs 事實:檔內註解的行號、「引進至今零修改」、「冷啟 19 秒」是否與 git 及現實相符?
  F. 有沒有任何宣稱是**沒有機制保證**的?(這片已經在這點上犯錯兩次:
     先宣稱「只驗鍵名就夠」、再宣稱「/products 沒有 fallback」,兩次都是假宣稱。)
  G. CI 缺 secrets 時「硬紅、不 skip」是刻意設計。請評估這對 PR 流程是否會造成
     無法自解的卡死(例如外部貢獻者),以及是否需要 backlog 條目。

Claude Code 自評:
  可 commit(不 push)。理由:三綠過、產品程式碼零改動、rollback = 單一 commit revert、
  對 production 零影響(測試檔不進 build 產物、不改任何 runtime 行為)。
  🔴 但誠實揭示三件事:
    1. 本片**未取得 codex 意見**(CLI 兩輪皆掛,見檔頭)。
    2. 本片自己曾經是假綠,兩個獨立審查員各抓到一次假宣稱,我在修第一個假宣稱時
       又寫出第二個。這個病在本 session 內復發率高,請用最嚴格的標準看 F。
    3. CI 要真正生效,需 Sean 先在 GitHub 設兩個 Secrets;未設定前每次 push 都會紅。
```

---

## 4. Manifest 異動摘要(本 packet 期間)

本片**未動** `docs/design-storefront-manifest.yaml`(純測試基建,無 design 對應面)。
前一個 commit `799a733` 已新增兩條 `business_overrides`
(`mobileVehicleChipRemoved` / `vehicleTabLabelSelectVehicle`)並同步 `last_modified_commit`。

新加 open_drifts:無。

---

## Sean 動作

1. 把上面 code block 整包貼給 web Codex。
2. 把 Codex 回覆貼回 Claude Code。
3. 另外需要你做一次 GitHub 設定(見對話中的逐步說明),否則 CI 會一直紅。

---

## R2 後記(2026-07-20,web Codex R1 FAIL 後的處置與複驗)

web Codex 4 must-fix 全修 + 5 consider 中 3 條採納(permissions: contents: read / upload-artifact v4→v7〔官方 releases 當場查證 v7.0.1 最新、name/path/retention-days 不變〕/ trace 步驟改名並加 if-no-files-found: ignore)+ fork PR 邊界寫入 backlog #288 + 4 nit 清畢:

1. **MF1 preflight 重寫**:不再自行解析 env 檔取聯集,改直接呼叫 Next 自己用的 `@next/env`(`loadEnvConfig`,dev=false 走 production 優先序、含 dotenv 解析與 `$VAR` 展開)。安全邊界不變:只輸出鍵名、值不離開作用域。
2. **MF2 plan 矛盾清除**:統一為五片 a/b/c/d/e、鐵則 8「已 Sean 口頭批准 07-20」、`#288-a1` 字面全樹歸零。
3. **MF3 SSoT 同步**:STATUS「下一步」補雙軌(主軌 M-4a B-3 / E2E 支線 #288-b)、CURRENT 補 07-20 ownership 區塊、STATUS:61 B-2 過期字面(「未 apply」→ 已 apply 上 production)。
4. **MF4 精確字面**:「DB 壞掉會紅」全數改為「CI 冷快取下,核心商品 RPC 無法提供非零商品時會紅」,並明列三種攔不住的情況。

**複驗(修後全部重跑)**:preflight fixture 負向 6 案全紅(含舊版誤放行的 `KEY= # comment` 與 `KEY=$UNSET_VAR`,以及 Fable 報過的引號包空白)+ 決定性案例(process.env 空字串壓過 .env.local 有值 → 紅)+ 正向 2 案綠;三綠 typecheck 8/8、lint 10/10、root test 231 檔 2540 passed;production E2E 冷快取 **1 passed (30.9s)**。分工:web Codex 審(人工中繼)→ 修正由 sonnet(4 MF 初套)與 codex CLI(W1-W6 executor)執行 → Claude Code 主 session 逐條審 diff + 複驗。
