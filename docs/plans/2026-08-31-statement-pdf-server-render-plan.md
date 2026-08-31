# 明細單伺服器產 PDF —— slice plan
> 觸發:Sean 2026-08-31 逐字「因為我們email 還是要寄送PDF給客人? 那不是一樣的東西嗎?」+「那就做吧」
> ⇒ 這正是 `docs/plans/2026-08-29-pdf-render-selection.md` 明寫的**唯一會推翻「先做甲」的前提**。

## 0. 現況(當場量,ref = 工作樹 = `origin/dev 4f71e36c` + 本線未推 32,2026-08-31 10:0x)
```
✅ 版面已存在且共用   apps/storefront/.../statement/page.tsx → <StatementDoc>,吃 @/styles/print-a4.css
✅ 那顆鈕已上線       OrderDetailView.tsx:204/207/209(開新分頁,無條件)
✅ 寄信支援附件       packages/adapters/src/email/ResendEmailSenderAdapter.ts:209-215(attachments)
🔴 沒有產檔能力       git grep puppeteer|@sparticuz ⇒ 0(playwright 只在 devDependencies 供 e2e)
🔴🔴 沒有任何字型檔    git ls-files | grep -ci '\.(ttf|otf|woff2?)$' ⇒ 0;@font-face 宣告 ⇒ 0
~~⇒ 今天的中文靠【看的人那台機器剛好有字型】。伺服器容器沒有 ⇒ 預設就是豆腐字。~~
```

### 🔴 2026-08-31 11:3x 就地訂正(只加不刪;舊字面加刪除線留著,讓搜到舊句的人同一發撞到這裡)
```
✅ 上面那個 0 是【真的】—— repo 裡確實零字型檔、確實零本地 @font-face。
🔴 而它下面那句結論是【假的】。開檔量到:
   apps/storefront/src/app/layout.tsx:159-164  全站 <head> 掛著
     <link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=…
           &family=Noto+Sans+TC:wght@400;500;600;700&…&display=swap" />
   實抓那支 CSS ⇒ HTTP 200 · 241,420 bytes · 210 個 @font-face · 105 支 woff2 URL
     指令逐字 curl -s -A '<Chrome UA>' \
       'https://fonts.googleapis.com/css2?family=Noto+Sans+TC:wght@400;700&display=swap'
     ⇒ 🔴 不吃 ref(打的是 Google 不是本 repo);量於 2026-08-31 11:1x
   find apps/storefront/src/app/account -name 'layout.tsx' ⇒ 零輸出
     ⇒ 🔴 不吃 ref(讀工作樹)⇒ 明細單頁吃的就是 root layout
⇒ 📌 客人今天【有】Noto Sans TC,是 Google CDN 給的。「客人沒有字型」這個缺口不存在。
```
🔴 **那不是量錯,是量對了一個比宣稱窄的東西,然後被讀成全部** ——
`git ls-files` 的分母是【版本控制的檔案】,不是【執行時會載到的資源】;
兩者的差就是所有從 CDN / node_modules / build 產生器來的東西。
📌 判別句(`-d2` 給的,主視窗轉):**先問這把尺的分母涵蓋幾條路,再看它印幾。**
📎 兩個實例已落 `docs/patterns/traps-inbox/A-20260831-環境替我供應了那個東西-而我記在自己的接線上.md`。

## 1. 分片(可中斷,每片獨立有價值;順序不可換)
```
片 A · 字型探針(丟棄式,不進 repo)
   在本機用容器/無字型環境產一張 PDF,看中文變不變豆腐 ⇒ 決定字型方案
   ✅ 出口:一份「哪個字型檔 + 多大 + 授權可不可商用」的量測
   🛑 這一片【不改任何產品碼】

片 B · 把字型變成我們自己的(@font-face + 字型檔)
   ~~✅ 它獨立有價值:今天客人用 Linux 或裝了怪字型,一樣會落到 sans-serif~~
   ~~⇒ 這一片修的是【一個現在就存在而沒有人量過的缺口】~~
   🔴 2026-08-31 11:3x 改寫理由(舊句留著加刪除線;主視窗 -2d [16689c] 拍「甲」):
   ✅ 真正的缺口 =【伺服器產 PDF 那一刻不可以依賴外部 CDN】
      —— 它失敗時是【靜默】的:網路一慢就豆腐,零錯誤零警告,而 PDF 照樣產出來
      (那正是片 A 量到的形狀,見 §0 訂正節與 traps-inbox 那則)
   ✅ 半徑收斂成【只給明細單那一頁自 host】:走 next/font/google,
      不動 layout.tsx、不新增檔案進 repo、不新增 npm 相依、可單獨 revert
   🛑 不做全站自 host —— 那要推翻 layout.tsx:16 註解裡那條既有拍板
      (「走 <link> 預連 + stylesheet(對齊 design 字面、避免 next/font 隱式包裝偏離 design)」)
      ⇒ 那是鐵則 1 的拍板,要 Sean,不是我們

   🔴🔴 片 B 落地後【它自己還不生效】—— codex R1 must-fix 逼出來的一格,寫在這裡免得被讀成做完了
      next/font 產的 @font-face 家族名就是 "Noto Sans TC",與 root layout 那條 Google CDN
      <link> 宣告的家族【同名】⇒ 兩套 face 在同一個層疊裡。
      實測(2026-08-31,playwright + CDP,同一頁兩個世界,連跑兩發同值):
        正常世界      ⇒ 字型請求 自家 0 / Google 17   ⇒ 🔴 今天 Google 那份贏
        擋掉 Google   ⇒ 字型請求 自家 15 / Google 0   ⇒ ✅ 我們這份接得住
      ⇒ 片 B = 【擋掉外部之後接得住的那張網】+ 【Google 掛掉時客人也不會沒字】
      ⇒ 🛑 讓它真正生效的動作在片 C:伺服器渲染時**攔掉 fonts.googleapis.com / fonts.gstatic.com**
      ⇒ 🛑 而那道守門【現在沒有人在跑】—— 片 C 必須帶一格自動化的兩世界比對
           (CDP CSS.getPlatformFontsForNode + 攔網路),否則這件事只有 2026-08-31 手動量過一次。

片 C · 伺服器產檔 route(`/account/orders/<id>/statement.pdf`)
   復用同一頁 HTML,只換一個地方渲染 ⇒ 版面不重畫

片 D · 接進寄信(附件)
   🛑 鐵則 12⑤ 對外不可回收 ⇒ 這一片單獨過對抗審查,且不與 C 同 commit
```

### 🔴 片 B 引入的一條【建置期外部相依】—— codex R1 must-fix 要求揭露
```
`next/font/google` 會在 **build 時**去 Google 抓 CSS 與字型檔(105 支 woff2 / 約 4.0 MB),
自 host 進 `.next/static/media/`。⇒ **build 這一步從此需要連得到 Google。**

✅ 已查(開檔讀的,不是推的):`.github/workflows/ci.yml:142` 只 build admin
   (`TURBO_FORCE=1 pnpm --filter @pcm/admin build`),**沒有 build storefront**
   ⇒ 這條相依**現在的 CI 根本碰不到**。這一格是查證過的。
🛑 而下面這兩句**不是查證,是預期**(codex R2:「有外網 ≠ 那個相依可靠」,他說得對):
   · runner 是 `ubuntu-latest`(`ci.yml:14`)⇒ **預期**連得到 Google,**未實測**
   · Vercel build **預期**有外網,**未實測**
   ⇒ 兩者都沒有量過「Google 暫時不可達時 Next 是重試、降級、還是直接讓 build 失敗」。
   ⇒ 🔴 而這條相依的可用性**不由我們控制** —— 它是一個外部服務,而 build 是我們的關鍵路徑。
🛑 【未量】離線 / 網路隔離的 build 會怎樣 —— codex 說「Next 重試後直接讓 build 失敗」,
   我**沒有實跑驗證那句**。缺的那一道逐字:
   【在一個連不到 fonts.googleapis.com 的環境跑 `pnpm --filter @pcm/storefront build`,看 rc】。
   ⇒ 影響的人:沒有網路的開發者、以及任何未來把 build 放進隔離環境的動作。
🔵 若那一格真的會爆而我們不接受:退路 = 改 `next/font/local` + 把 woff2 收進 repo
   (片 A 量過:fontsource 靜態 400+700 = 212 支 / 6.26 MB;可變字型那份 = 105 支 / 4.0 MB)。
   **那條路我沒走,因為主視窗 2026-08-31 拍「走 npm/建置期、不進 repo」。**
```

## 2. 片型與鐵則
```
片型 = 🔴 高風險片(命中鐵則 12 ④平台設定/相依 與 ⑤對外寄信)
鐵則 8  = 命中(動相依 + 部署體積)⇒ 本檔就是那個 plan
鐵則 12 = 命中 ⇒ 每片 commit 前跑 codex 對抗審查,不 push
鐵則 1  = 版面沿用已對過稿的 StatementDoc ⇒ 不新畫,不需重新對稿
L1/L2/L3 = 不適用(這是能力不是內容);單據上的字面沿用既有
```

## 3. 影響面 / rollback
```
影響面  新增 2 個相依(chromium binary + puppeteer-core)· 部署體積 · 冷啟動
        · 新增字型檔(片 B)· 新增一條 route(片 C)· 動寄信(片 D)
rollback 片 B 之後每一片都可單獨 revert;片 A 不進 repo ⇒ 零 rollback 成本
🔴 而片 C/D 的 rollback 不是 revert 就好:片 D 一旦寄出去的信收不回
   ⇒ 片 D 上線前先寄給我們自己一封(不寄客人)
```

## 4. 🛑 這份 plan 答不出什麼
```
· 字型檔的【授權】我沒查 —— 商用可不可以,片 A 要答
· Vercel 的實際冷啟動與體積上限我【沒有量過】,只有選型檔的敘述
· 客人端 OS 分佈沒有數字 ⇒ 片 B 的收益大小是估的,不是量的
· 板 :208(PDF 選型)態仍 open,而 Sean 給的是【那一題的前提】不是那一題的答案
  ⇒ 本檔不替它結案
```

---
## 5. 板 `:208` / 選型檔那一題 —— **它被答了, 而答它的不是我**
選型檔 §五 逐字問的是:
```
Q: 客人的「訂單明細」,要哪一種?
A: 甲 給他一頁可以列印的畫面,他自己按「儲存成 PDF」
 | 乙 我要一個真的檔案,點一下就下載(要多裝東西、要處理伺服器沒有中文字型的問題)
```
✅ **Sean 2026-08-31 答 `Q-pdf3 = A`(信裡真的夾附件)⇒ 那正是【乙】。**
🔵 而選型檔自己寫著:「**選乙的唯一硬理由是『將來要把明細夾在 Email 裡寄出去』**」
⇒ 📌 **他給的理由與那份檔預先寫下的條件【逐字相同】** —— 不是我推的。
🛑 **而本檔不替 `:208` 結案**:那一列不是本線的,收它的動作由原線或主視窗做。

## 6. 🔴 爆炸半徑 —— **產檔失敗時,信照寄**
```
🔴 判準(明確回答, 不是原則):
   ① 產檔是【寄信流程之外】的一步 ⇒ 產檔失敗【不得】讓那封信不寄
   ② 失敗時的行為 = **照寄, 而附件那一格空著**;信裡那條【連結】永遠在
      ⇒ 客人仍然拿得到明細(點連結 → 那一頁 → 自己列印)
   ③ 失敗要留下痕跡(記一筆), 而【不是】拋給寄信那一層
📌 ⇒ 形狀與「503 ≠ 信沒寄」相同:一個新加的步驟不該讓既有的信寄不出去
```
⚠️ **而這一格有一個代價要一起講**:附件空了而信照寄 ⇒ **客人收到的信會與我們以為的不一樣**,
而**沒有任何東西會在那一刻說話** ⇒ **片 D 必須帶一個「附件缺席」的計數, 否則它是靜默降級。**

## 7. 內容分級與片型(補)
```
L 級  = 不適用(這是【能力】不是內容);單據上的字面沿用既有, 不新增可編輯內容
片型  = 🔴 高風險片(鐵則 12 ④平台設定/相依 + ⑤對外寄信)
鐵則 8 = 命中 ⇒ 本檔即是那個 plan;Sean 已口頭「那就做吧」, 而【逐片仍先給主視窗看】
```

## 8. 🛑 而選型檔自己的天花板要一起帶走(它 §六 明寫)
```
· 三個選項的成本【都是估的, 沒有實作過任何一個】
· 乙的部署體積與冷啟動【一格都沒量】—— 那要真的部署一次才有數字
· 🔴 沒有驗證過 print-a4.css 在顧客站 app 裡載不載得到
  ⇒ 而本檔 §0 量到它【載得到】(statement/page.tsx:12 有 import)⇒ 這一格已被推翻, 可放心
```
