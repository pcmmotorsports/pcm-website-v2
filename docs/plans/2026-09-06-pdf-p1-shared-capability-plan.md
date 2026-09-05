# plan · ⟦f3-SHIPPDF1⟧ P-1 —— 把「HTML ⇒ .pdf bytes」搬到兩個 app 都用得到的位置

> 線【出貨】`-ship` 2026-09-06。**鐵則 8**(動 tsconfig / turbo / 跨 app 結構)⇒ **本檔零 diff, 等主視窗看過。**
> 主視窗 `-f8` 2026-09-06 指派, 並**把驗收條件寫死**(見 §5)。

## 0. 一句話

顧客站已經會產 PDF 了。後台要產同一種檔, 而那顆能力**綁在顧客站的 app 裡**。

---

## 1. 現況(當場量, 每格可單發重跑)

| 事實 | 證據 |
|---|---|
| 產 PDF 的能力在顧客站 | `apps/storefront/src/lib/print/statement-pdf.ts` **362 行**, 匯出 `htmlToPdf()` |
| 它的相依 | `apps/storefront/package.json` ⇒ `@sparticuz/chromium` **^149.0.0** · `puppeteer-core` **^25.9.0** |
| 字型也在那裡 | 同檔 `fontPkgDir()` / `findFontPkgInPnpmStore()`;`@fontsource/noto-sans-tc` |
| 後台零相依、零路由 | `grep -cE 'sparticuz\|puppeteer' apps/admin/package.json` ⇒ **0**;`find apps/admin/src/app -name route.ts -path '*pdf*'` ⇒ 空 |
| `packages/` 今天沒有 print 這一族 | `ls packages` ⇒ adapters / domain / ports / schemas / ui / use-cases |
| 那支檔今天 import 顧客站自己的東西 | `statement-pdf.ts:38` ⇒ `from '@/lib/print/statement-html'` |

## 2. 🔴🔴 這一片最大的風險 —— 而它**不是**編譯錯誤

顧客站這條路**已經踩過一次**, 而那個坑寫在
`apps/storefront/src/app/account/orders/[displayId]/statement.pdf/statement-pdf-tracing.test.ts` 檔頭, 逐字:
```
本機 ⇒ 檔就在磁碟上 ⇒ 讀得到 ⇒ 中文正常 ⇒ 完全正常
線上 ⇒ 檔沒被打包進函式 ⇒ 讀不到 ⇒ PDF 照樣產出來、HTTP 200, 而每個中文是方框
⇒ 而 typecheck / lint / build / 任何單元測試都不會紅 —— 它們不看打包清單。
```
🛑 **而搬家正好動到那件事的變因**:
· 字型是靠 `require.resolve('@fontsource/noto-sans-tc/package.json')` 找的 ⇒ **解析起點會跟著搬**
· Next 的檔案追蹤(`*.nft.json`)是**從 route 出發**走 import 圖 ⇒ **多一層 package 就是多一段路**
· 那支 tracing 守門**用相對路徑釘住位置**(`join(__dirname, '../../../../../lib/print/statement-pdf.ts')`, 全檔 **4 處** `join(__dirname`)⇒ **搬完它會找不到檔**
⇒ 📌 **所以這一片的驗收不能只有「編得過」** —— 那正是上次全綠而線上是豆腐字的那一組訊號。

## 3. 要改什麼

```
① 新增 packages/print(或 packages/pdf):只放【產 PDF】那一半
     htmlToPdf() + 字型解析(fontPkgDir / findFontPkgInPnpmStore)
   🛑 【不搬】版面那一半(buildStatementHtml / statement-html.ts)——
      那是顧客站的對帳單版面, 後台的出貨單是另一份版面。搬它等於把兩份版面綁在一起。
② 兩個 app 的 package.json 各自宣告對它的相依(workspace:*)
③ 相依(@sparticuz/chromium / puppeteer-core / @fontsource/*)移進那個 package
④ 顧客站 route.ts 與 statement-pdf.ts 改 import 新位置
⑤ tracing 守門那 4 處 __dirname 相對路徑跟著改, 並【加一格】斷言新 package 的字型有被追蹤到
```

## 4. 為什麼 / 影響面 / rollback

**為什麼**:後台要產同一種檔;而複製一份 = 兩份會分岔, 而**分岔的那一天沒有訊號**(同族:本 repo 記過「互補集的定義在兩邊各寫一份, 它們遲早不互補」)。

**影響面**
```
· 動 pnpm workspace 與 tsconfig paths ⇒ 兩個 app 的 build 都會重算
· 動【已經上線】的顧客站那條路 ⇒ 🔴 這一片的風險【在顧客站】, 不在後台
· 相依搬家 ⇒ 兩個 app 的函式包內容都會變 ⇒ P-3 的體積讀數要在這之後量
· 不動任何 DB、不寄任何信 ⇒ 鐵則 12①②③⑤ 不觸發;12④(平台設定)觸發 ⇒ commit 前跑 codex
```

**rollback**
```
· 把 import 改回舊路徑 + 移除新 package ⇒ 回到今天(相依仍在顧客站)
· 🔵 這一片【沒有不可逆的格子】:不寄信、不寫 DB、不動客人看得到的東西
  ⚠️ 而它有一個【看不見的失敗】:線上豆腐字 —— 那個要靠 §5 的驗收條件擋, 不是靠 rollback
```

## 5. 驗收條件(主視窗 `-f8` 寫死的兩條 + 我加的第三條)

```
① 顧客站 statement 那一族測試【零改動】仍全綠
   —— 「零改動」是承重的:改測試去配合搬家 = 把守門搬成我要的形狀
   ⚠️ 例外只有 tracing 守門那 4 處相對路徑(它釘的是【位置】, 而位置就是本片要改的東西)
      ⇒ 那 4 處要改, 而**改完要能在【搬回去】的世界裡紅** —— 否則它釘的是空氣
② 顧客站 route.ts 改指新位置後:typecheck / lint / build 全綠(0 cached)
③ 🔴 我加的:tracing 守門要**多一格**, 斷言字型檔在【新的解析起點】下仍被追蹤到
   兩個世界:搬完 ⇒ 綠;把新 package 的字型相依拿掉 ⇒ 紅
   📌 少了這一格, ①② 全綠而線上是豆腐字 —— 那正是上次發生過的事
```

## 6. 🛑 我沒做什麼

```
· 一行碼都沒寫, 零 diff(鐵則 8:等主視窗看過)
· 沒有量過搬完之後的函式包體積 —— 那是 P-3, 而它要【兩個 app 各自量】
· 沒有驗過顧客站今天產的 PDF 中文是對的 —— Sean 只回過「下載了一個檔」,
  而「下載了一個檔」與「那個檔裡中文是對的」是兩個宣稱
· 沒有決定 package 叫什麼名字(print / pdf)—— 那是動手時的細節, 不影響本檔的判斷
```
