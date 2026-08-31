# 片 C · 伺服器產檔 —— slice plan(母 plan 的展開)

> 母 plan = `docs/plans/2026-08-31-statement-pdf-server-render-plan.md`
> 主視窗 `-2d [16689c]` 2026-08-31 12:5x「片 C, 開」+ 三格約束。
> 🔴 **本檔存在的理由:那三格約束裡的第 2 格,被我開工前的一發量測推翻了。**

## 0. 🔴 主視窗約束② 已不適用 —— 而理由是量到的

主視窗逐字:
```
2. 攔截 fonts.googleapis / gstatic 的做法要明寫「攔在哪一層」——
   攔在 puppeteer 的 request interception ⇒ 只對產 PDF 那條路生效
```
⇒ 那句話**預設了片 C 會【打我們自己的 URL】**(所以才會載到 root layout 那條 Google `<link>`)。
🔵 **而那不是唯一的做法, 也不是比較好的那個。**

### 兩條路
```
設計 A · headless Chrome 去 goto('https://…/account/orders/<id>/statement')
   要:把客人的 session cookie 轉發進去(否則它看到的是登入頁)
   會:載到 root layout ⇒ Google <link> ⇒ 所以才需要攔截
   代價:cookie 轉發是一個新的安全面 · 函式打自己(冷啟動疊冷啟動)· 多一次完整頁面渲染

設計 B · 在 route 裡自己 renderToStaticMarkup(<StatementDoc/>), 然後 page.setContent(html)
   授權:走**同一支** findOrderDetailForCustomer(displayId, user.id) —— 與那一頁逐字相同
   沒有 root layout ⇒ **那條 Google <link> 根本不存在** ⇒ 🔴 **攔截這一格自動消失**
   零 cookie 轉發 · 零自我 HTTP 呼叫
```

### 🛑 設計 B 有一個前提, 而它正是片 A 量到的那個坑
`setContent` 的 origin 是 `about:blank` ⇒ 片 A 實測 **`file://` 的字型 Chrome 會靜默不載**
(零錯誤零警告, 而它照樣印出漂亮的 PDF)。⇒ 所以要先證「字型進得去」。

**實測(2026-08-31 12:5x,`scratchpad/fontprobe/probe-c.mjs`,playwright + CDP,兩個世界)**
```
挑一支編譯產物裡涵蓋 U+8A02(訂)的 400 子集檔 ⇒ 99c899fe62b2196e-s… · 65,444 bytes
轉成 data:font/woff2;base64 內嵌進 @font-face, 然後 setContent

世界 A(有那條 @font-face)   ⇒ 實際用到 `Noto Sans TC Thin:1` · 網路 0 條 · PDF 3,879 bytes
世界 B(負對照:整條拿掉)     ⇒ 實際用到 `Songti TC:1`        · 網路 0 條 · PDF 3,011 bytes
⇒ ✅ 兩個世界用到的字型【不同】⇒ data URI 那支真的被用到了
⇒ ✅ 對外網路 **0 條**
```
🔴 **而這一發我第一版的判別式是錯的**:我拿 CSS 上宣告的家族名 `PCMProbeFont` 去比,
   **而 CDP 回的是字型【檔案內部】的家族名** ⇒ 那個判別式在兩個世界都印不出它
   ⇒ **它永遠答否**,而「否」看起來像一個乾淨的結論(第一發就是這樣印出「設計 B 不通」)。
   📌 **一個永遠答否的判別式,與一個真的失敗,在輸出上長得一樣。**

### ⇒ 選 B。而約束②改寫成:
```
❌ ~~攔在 puppeteer 的 request interception~~
✅ **那條路上根本沒有對外請求可以攔** —— 我們不載任何 URL, HTML 與字型都是自己組的。
🛑 而 commit body 仍然要講死同一件事的另一半:
   **客人瀏覽器那條路【完全沒有被動到】** —— root layout 的 Google <link> 還在、還在用。
   下一個人不會因為讀到「我們攔掉 Google」就以為全站不再用 Google Fonts。
```

## 1. 🔴 而設計 B 讓片 B 的角色再變一次 —— 這一格要講清楚
```
片 B 的產物 = next/font 放進 .next/static/media/ 的 105 支 woff2 + 那支 CSS chunk
設計 B 用的是【同一批檔】, 只是改成從磁碟讀 + 內嵌成 data URI
⇒ ✅ 片 B 沒有白做:它把字型檔弄進了部署裡, 而片 C 從那裡拿
⇒ 🛑 但片 B 的【CSS 那一半】(--font-statement / --pd-body 覆寫)**片 C 用不到**
      —— 因為片 C 自己組 CSS, 不吃 statement.css 的那條變數
   ⇒ 那一半仍然有它自己的價值(客人端 Google 掛掉時的網), 而**不是片 C 的前置**。
📌 ⇒ 母 plan 說「順序不可換」那句, 對 B→C 這一段【只在「字型檔要先進部署」這個意義上成立】。
```

## 2. 分片(片 C 太大,拆三顆;每顆可單獨 revert)
```
C1 · 相依與可行性 ✅ **已做**(主視窗 `-2d [16689c]` 2026-08-31 13:3x 批;數字見 §2b)
   加 puppeteer-core + @sparticuz/chromium 到 apps/storefront 的 dependencies
   + 根 `engines.node` 由 `>=22.0.0` 改成 `^22.17.0 || >=24.0.0`
     ⛔ ~~收緊成 `>=22.17.0`~~ —— 🔴 **那一版是錯的**(codex R1 抓):`>=22.17.0` **放行 Node 23**,
        而 `@sparticuz/chromium@149` 的 `^22.17.0 || >=24` **排除 23**
        ⇒ 在 `engine-strict=true` 之下, Node 23 仍然會裝失敗, 而根 engines 說它合法。
        ✅ 改成與相依**逐字相同**的範圍。
     ⛔ ~~那不是範圍擴張, 是本片造成的~~ —— 🔴 **那是假二分**(codex R1):
        它由 C1 造成 **而且**它改變了整個 monorepo 的安裝契約。兩件事同時成立。
     🛑 而它**不會讓 22.0–22.16 裝得起來** —— 它只是讓拒絕**更早、更誠實**地發生
        (從「裝到一半炸在某個子套件」變成「一開始就說 node 不合」)。
   🛑 這一顆是本片唯一動 package.json 的 —— 鐵則 8 + 12④

C2 · HTML 組裝器(純函式, 零相依, 可單測)
   輸入 MemberOrderDetail ⇒ 輸出一份自足的 HTML 字串
   (StatementDoc 的 markup + print-a4.css + statement.css + 需要的字型子集內嵌成 data URI)
   ✅ 它不碰 puppeteer ⇒ **可以在 C1 被否決的情況下先做完**, 而且測得起來
   ✅ 「內嵌哪幾支子集」已量完並拍了 —— **逐字挑**(數字見下面 §2a)

C3 · route + 失敗行為
   `/account/orders/<displayId>/statement.pdf`(🔴 URL 帶 .pdf —— 那顆鈕的註解已寫死這個字面)
   授權走同一支 findOrderDetailForCustomer, 查無 ⇒ 404, 不洩存在性
   🛑 母 plan §6 那條照抄:**產檔失敗不得讓任何既有流程死** —— 這一顆只影響這條 route
```

### 2b. C1 的體積 —— 三個數,而第三個是【零】

**上限(當場開官方文件,`https://vercel.com/docs/functions/limitations`,頁面自標 `last_updated: 2026-08-24`)**
```
逐字引:「For Vercel Functions, the maximum uncompressed size is **250 MB**」
        「Large functions let you deploy uncompressed bundles up to **5 GB**」
        「**For existing projects, opt in by setting the `VERCEL_SUPPORT_LARGE_FUNCTIONS`
          environment variable.**」
🔴 我們是既有專案 ⇒ **上限 250 MB, 不是 5 GB**, 除非那顆 env 被設過。
🛑 那顆 env 在不在【查不到】—— 它是 Vercel 專案設定, 不在 repo。
   缺的那一道:去 Vercel 專案 Environment Variables 看它在不在、值是什麼。
📌 ⇒ 我一度把「5 GB」當成通用上限並據此寫下「體積不是風險」——
   **那個數字不是錯的, 是【對別人成立的】**(它講的是新專案的預設), 而它讀起來完全像通用上限。
```

**相依本身(npm registry 的 `unpackedSize`,當場抓;安裝後再用 `du -sk` 複量磁碟)**
```
@sparticuz/chromium 149.0.0  registry 69,678,316 bytes · 裝完磁碟 68,080 KB(66.5 MB)
🔵 codex 查過:這兩支**都沒有 install/postinstall**, `puppeteer-core` 也不會另抓瀏覽器
   ⚠️ 但 cache miss 時仍要下載約 70 MB ⇒ **CI / Vercel 的 install 時間不是零副作用**(未量)
puppeteer-core       25.9.0  registry  5,856,406 bytes · 裝完磁碟  8,080 KB( 7.9 MB)
engines: chromium `^22.17.0 || >=24`(⇒ Node 24 明文支援)· puppeteer-core `>=22.12.0`
```

**函式包的代理值(🛑 這【不是】Vercel 實際打包的大小,是同一個東西的本機影子)**
```
量法:`TURBO_FORCE=1 pnpm build` 之後, 把 `.next` 底下所有 `*.nft.json`(Next 的檔案追蹤清單)
      攤平去重、逐檔 statSync 加總。算進去的層 = 那 49 支清單指到的全部檔案
      (含 `.next/server` 與被追蹤的 node_modules);**沒有**算 `.next/static`
      (那是 CDN 靜態資產, 不進函式) —— 而 🔴 **C3 要把字型檔弄進函式包時它就會進來**。
storefront  49 支清單 · 去重 1,311 檔 · 37,576,249 bytes (35.8 MB)
🟢 對照 admin(沒動過)25 支 · 1,222 檔 · 36,700,499 bytes (35.0 MB)
   ⛔ ~~兩個 app 同一量級 ⇒ 這把尺不可疑~~ —— 🔴 **那是過度推論**(codex R1 抓):
   **兩邊可能【共同】漏掉同一批東西**(Vercel 的 wrapper、runtime layer、平台自己 include 的檔)
   ⇒ 同量級只證「這把尺對兩個 app 一致」, **證不了它涵蓋 Vercel 真正打包的東西**。
🛑 **這把尺的射程,逐字**:它量的是【本機 Next 追蹤閉包的去重總和】。
   它**不是**單一支 Vercel `.func` 的大小、**不是**部署總量、**不含** runtime layer。
   ⇒ 而 250 MB 那個上限是**針對單一函式**的 ⇒ **兩個數不是同一個東西, 不可以直接相減或比大小**。
   ⇒ 真正要答那一題, C3 必須量目標 `.func`(`vercel build` 的 Build Output)或用 Vercel 的分析。

🔴🔴 **裝完之後 storefront 的這個數【一個 byte 都沒變】** —— 仍是 37,576,249。
   成因:**現在還沒有任何一支檔 import 它們** ⇒ Next 的追蹤不會把它們算進去。
   證據(同一發, 分母 10,043 個追蹤項目):
     🟢 正對照 `@supabase` ⇒ 11 · `react` ⇒ 200   (非 0 ⇒ 這把尺找得到套件名)
     🔴 待測  `sparticuz` ⇒ 0 · `puppeteer` ⇒ 0
     ⚪ 負對照 `zzq9137`  ⇒ 0
   📌 **⇒ 成立的只有這一句:【本機 NFT 追蹤閉包的增量為零】。**
   ⛔ ~~C1 這一顆對函式包的貢獻是零~~ —— 🔴 codex R1:那句超出這把尺答得出的範圍。
   🛑 **⇒ 而「裝了也沒變大」不是好消息, 是【還沒問到那個問題】** —— 沒有人 import 它。
   ⚠️ ~~屆時粗估 35.8 + 74 ≈ 110 MB ≈ 250 MB 的 44%~~ ⇒ 🔴 **那個加法不成立**:
      35.8 是本機閉包、250 是單一 `.func` 的上限、74 是套件磁碟大小 —— **三個不同的東西**。
      ⇒ C3 要量的是**同一種東西**:目標 `.func` 的實際大小 vs 250 MB。
```

### 2a. 逐字挑 vs 全部內嵌 —— 實測(2026-08-31,codex R1 要求補耗時才准拍)
```
                     face 數   字型 bytes    產出字串         耗時(連跑三發)
逐字挑(真資料)          20    1,281,576       880,064 字元    7.7 / 2.8 / 0.5 ms
全部內嵌                210    8,386,424    11,191,416 字元   49.0 / 31.9 / 35.0 ms
⇒ 挑選少 12 倍字串、快約一個量級。組出來的整份 HTML 實測 1,869,846 字元。
🛑 耗時那兩欄量的是【機械成本】(讀檔 + base64 + 串接), 不是 buildStatementHtml 全流程;
   挑選那一步(純數值比較)我**沒有單獨量**。而三發離散度不小(0.5–7.7)⇒ 那是檔案快取,
   不是演算法變快 ⇒ **不要拿單一發去做容量規劃。**
🛑 三個數全部量在【本機 macOS】。serverless 的峰值記憶體與延遲**零證據** ⇒ 那是 C1/C3。
```

## 3. 驗收(主視窗約束① —— 而它要自動化)
```
🔴 主視窗逐字:「正式的那一發要【自動化】—— 你現在那發是手動的,
   手動的不會在下一個人改壞時說話」
⇒ C2 的守門(不需要 server, 不需要 puppeteer):
   組出來的 HTML 丟進 playwright setContent ⇒ CDP 問「你用了誰」
   兩個世界:有內嵌字型 / 抽掉內嵌字型 ⇒ 用到的字型必須不同
   而且斷言 **對外網路請求 = 0**(那是本設計的核心承諾, 不是附帶)
⇒ 這把尺在 C1 沒過的世界裡照樣跑得動 ⇒ 它不綁在相依上
```

## 4. 🛑 這份 plan 答不出什麼
```
· 部署體積與冷啟動:**一格都沒量**。要真部署一次才有數字, 而我不 deploy。
· @sparticuz/chromium 在 Vercel Node 24 runtime 上的相容性:**未查**(它與 Next 版本綁法會變)
· ~~內嵌全部子集 vs 逐字挑:兩種的耗時都沒量~~ ⇒ ✅ **已量並拍(逐字挑),數字在 §2a**
· 客人按下那顆鈕之後等幾秒:未知(冷啟動 + 渲染 + 產檔)
```

## 4a. 🔴 這一片的最佳時機是【現在】,而理由不是「它安全」

主視窗轉 **Sean 2026-08-31 12:2x 逐字:「目前都只有測試, 還沒正式上線對外使用」**。
```
⇒ 「Sean 推了一次而部署掛了」那個窗口, **今天的代價接近零**(沒有客人在看)。
🛑 而那不是放鬆的理由, 是【現在正是試它的時候】—— 同一件事上線後做, 代價完全不同。
⚠️ 而「挑他在場」那一格**仍然成立**, 只是理由換了:
   ~~因為顧客站會壞~~ ⇒ **因為部署掛了要有人當場決定 revert**。理由變了, 動作沒變。
```

### rollback
```
起不來 ⇒ revert C1 那一顆(它只動 package.json ×2 + pnpm-lock)
🔴 而 **revert ≠ 復原**:lockfile 回捲之後要重跑 install 才算數;
   部署那一側是 Vercel 自己 install ⇒ 推回去它會自己重來 ⇒ 那一半是自動的。
🛑 真正回不去的只有「已經推上去的那段時間」—— 見上面那一格。
```

## 5. 卡在誰
```
✅ C1 已批已做(主視窗 13:3x)—— 相依進了 package.json,
   而**本機 NFT 追蹤閉包的增量為零**(§2b)
   ⛔ ~~函式包一個 byte 都沒變~~ —— 🔴 codex R2 在這裡**第二次**抓到同一個過寬:
      我在 §2b 把字面收窄了, **而收尾這一行沒跟著改**。
      📌 一份文件裡同一個宣稱寫了兩次, 修一次不會讓另一次變對 —— 而收尾那一句是最多人只讀那一句的。
✅ C2 已做並 commit(`b79e531b`)
⏸ C3 下一顆。三格前置:
   · `next.config` 的 `outputFileTracingIncludes` 把字型檔弄進函式包 ⇒ 🔴 鐵則 12④ codex 不能省
   · 🔴 **量【目標 `.func` 本身】,不可以拿 NFT 總和代替** ——
     那兩個不是同一種東西(§2b 的射程聲明);`vercel build` 的 Build Output 才答得出 250 MB 那一題
   · Vercel 專案設定兩格(Node.js Version / `VERCEL_SUPPORT_LARGE_FUNCTIONS`)由主視窗端給 Sean
```

這件還開著。
