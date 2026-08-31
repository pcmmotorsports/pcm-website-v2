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
C1 · 相依與可行性(🔴 需要批准才動)
   加 puppeteer-core + @sparticuz/chromium 到 apps/storefront 的 dependencies
   ✅ 出口:一發 `pnpm build` 過 + 部署體積前後對照(數字, 不是形容詞)
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

## 5. 卡在誰
```
🔴 C1 需要批准 —— 它動 package.json 與部署體積(鐵則 8「動相依 + 部署」)
✅ C2 不需要批准(純函式、零新相依、可單測)⇒ **我先做 C2**
⏸ C3 等 C1
```

這件還開著。
