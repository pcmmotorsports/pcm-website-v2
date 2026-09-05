# 出貨文件 PDF · **今天版差異 + 第一片範圍**(2026-09-05 · **第三版**)

> **狀態**:草案。**一行碼都還沒改, 未 commit, 未 push。**
> **正本 plan**:`~/pcm-mailbox/線-出貨-plan-412-伺服器產PDF-20260830.md`(1176 行)
> **位置裁決**:`~/pcm-mailbox/plan-416-SHIPPDF1-位置裁決與實作計畫-20260902.md`
> **本檔不取代正本** —— 它只答:**那份 plan 今天哪些前提變了, 而第一片該做什麼。**
>
> ## 🔴 版本史(留著, 因為錯的形狀比結論有用)
> **v1** codex 判 FAIL 9 條。最重:重新採用了 §13 明文排除的「admin 自己加依賴」。
> **v2** codex 判 FAIL **14 條 must-fix + 1 nit**;而其中**兩條我自己先抓到**(見下)。
> **v3 = 本檔。** 14 條逐條折進來, 每條我都自己開檔複驗過, 不是照抄。

---

## 〇、🔴 v2 錯在哪 —— 三個形狀, 每個都不只是這一次

### ⓐ 我說「沒有東西會叫」, 而**有**
v2 逐字:「而【驗它們的東西已經漂了】…有人在其中一邊修一個 bug ⇒ 另一邊安靜地留著它。」
**假的。**`apps/storefront/src/components/print/admin-copy-drift.test.ts` 早就把兩支
`strip-pictographs.ts` 釘成 **sha256 逐位元組相同**, 還帶分母格(`清單長度 = 3`)與負對照。
⇒ 只改一邊 **會紅**。
🔴 而我**跑過**那個 grep —— 那支測試是**命中的第 1、2 行**, 我讀成「那只是提到它」滑過去了。
📌 **形狀**:把命中往下排會漏掉它, **而把命中讀成雜訊也會漏掉它 —— 排序修不了第二種。**
🎯 **判別句**:寫「沒有東西會叫 / 會安靜地漂 / 沒人守這個」之前, 問
   **「我 grep 過【有沒有東西在叫】了嗎?」** 命中裡的 `*.test.ts` **一律開檔**。

### ⓑ 我在問「文件寫得對不對」, 而該問「現在是什麼」
v2 我花了一整段反駁 codex 的「Pro 已升」, 用的全是**檔案對檔案**。
🔴 **而這一題有一個活的量具, 我從來沒打過它。**
```
當場量(Vercel MCP list_teams, 唯讀):
  team pcm-motorsports · team_uMPmFCKRDUhoixK6p3JC0Tis · "plan": "pro"
```
📌 **形狀**:**我在比對文件, 還是在讀現況?後者要去打量具, 不是去翻檔案堆。**

### ⓒ 我把一句拍板抄進檔裡, 然後在同一份檔裡豁免它
v2 第 84 行抄了正本 §13-② 的「這一片的前置是【丁先被驗過】」, 第 115 行寫「它不需要片 0 先過」。
⇒ **同一份檔自己打自己。**(codex must-fix #1;我複驗成立。)

---

## 一、變了的前提(逐格帶量法與正對照)

### ① 🟡 依賴:宣告那一半做掉了, 打包那一半一個檔都沒有
```
第一層 package.json 宣告
  @fontsource/noto-sans / -tc   storefront ^5.3.0   admin ^5.3.0   ✅ 兩邊都有
  @sparticuz/chromium / puppeteer-core              admin —        🔴 缺
🔴 第二層 實際打包(.nft.json)
  admin orders/page 裡的 fontsource 檔數 ⇒ 0
  🟢 正對照 該 route 總檔數 ⇒ 241(尺是活的)
```
⛔ 正本 `§12.7-c` ~~「三顆依賴仍要裝(`grep -c fontsource` ⇒ 0)」~~ ⇒ **宣告層今天是 2**。
🛑 而「宣告有」≠「打包進去了」。**⇒ 這一格要寫成兩句:宣告的前置做掉一半, 打包的一格沒動。**
⚠️ **而下面 ② 的射程限定同樣套在這個 `0` 上** —— 它也是從那份落後的 `.nft.json` 讀的。

### ② 🔴 體積:**v2 那兩個數字【作廢】, 不是修正**
```
🛑 為什麼作廢(codex must-fix, 我開檔複驗):
   apps/storefront/.next/BUILD_OK  head cdc172446aac…  at 2026-09-05T04:09:20Z
   apps/admin/.next/BUILD_OK       head cdc172446aac…  at 2026-09-05T04:09:23Z
   現在的 HEAD                      7846f3b17
   ⇒ 中間動過四支列印檔 ⇒ 拿【舊清單】去 stat【新工作樹】= 混合產物, 不是任何一版的快照。
作廢的那兩個數(留著只為了讓引用過它們的人撞到這一段):
   ⛔ ~~176,123,049 bytes~~   ⛔ ~~169,253,098 bytes~~
   ⛔ ~~「266 條是硬連結/clone(3.9%)」~~ —— 這一句把兩個不同的比例綁成一句:
        266/2036 = 13.1% 是【路徑】重複比
        3.9%              是【位元組】差比
        而多數是同實體檔的路徑/symlink 別名 ⇒ 不能統稱硬連結或 clone。
✅ 要重量的方法:先 build(同一顆 HEAD)⇒ 再讀 .nft.json ⇒ 數字旁邊寫上那顆 HEAD 與時點。
```
🔵 **上限**:250 MB 是**標準函式**門檻;**Fluid Compute 的 Large Functions 可到 5 GB**。
⛔ v2 ~~「上限 250 MB, 今天仍是這個數」~~ **把標準門檻寫成普遍上限** ⇒ 作廢。
🛑 **⇒ 走哪一條, 決定於下面 ③ 那兩格 —— 而那兩格未答。**

### ③ 🔵 Vercel 方案:**Pro(量到的)**;而**它不是那兩格的答案**
```
✅ 量到  list_teams ⇒ "plan": "pro"                                     (2026-09-05)
🛑 未答  ① Fluid Compute + Active CPU 這個專案有沒有開
🛑 未答  ② VERCEL_SUPPORT_LARGE_FUNCTIONS=1 有沒有設
量不到的證明(不是沒查):get_project(prj_4yNDP3XOt202tQIlYwF9auf5fLN7)只回
  nodeVersion 24.x · framework nextjs · domains —— 【沒有】Fluid / Large Functions 欄位。
```
⛔ v2 ~~「Hobby/Pro 今天仍然未答」~~ **錯**(見 §〇ⓑ)。
⛔ 同時作廢我對 codex 的那句反駁的**射程**:我搜「已升/升好/現在是 Pro」而**沒搜「升了」**,
   而 `reference_pcm-platform-plans-vercel-hobby-supabase-pro.md:81` 標題就是「Sean **升了** Vercel Pro」。
🔵 **而我的窄反駁本身仍成立**:那個標題**自己的括號裡**寫著「(逐字「可以升級」)」
   ⇒ **標題比它自己的證據寬。**⇒ 那不是「檔案記錯了」, 是「標題被讀寬了」。
📌 **⇒ Pro ≠ chromium 跑得完。真正的硬條件是 ①②, 而它們今天仍未答。**

### ④ 🔴 正本沒有 08-30 的快照 ⇒「自 08-30 以來變了什麼」本來就答不精確
正本一路改到 **09-04 21:17**, repo 裡沒有它的 08-30 版本。
⇒ 🛑 **本檔要讀成「今天的實測 vs 正本【現在】寫的」, 不是 vs 08-30 寫的。**

### ⑤ ✅ 已經做掉、不必再做的
```
printButton      shipping-doc.tsx 命中 3 處(正本 §12.7-c 標 ✅ b89228ca)
admin 的 cwd     /var/task/apps/admin(正本 §12.9-d, 2026-09-04 量到)
statement-pdf.ts 362 行, htmlToPdf 已抽成原語
```

### ⑥ 🔴 沒有變, 而它是這一條線真正的體積
正本 `§11.2`:「admin 仍沒有【自足 HTML 組裝器】」
```
grep -rl 'buildStatementPdfHtml|buildShippingDocHtml' apps/admin/src ⇒ 0
🟢 正對照 同一把尺在 storefront ⇒ 4
```

---

## 二、第一片 —— 🛑 **範圍寫在這裡, 而【要不要現在做】不是本檔能答的**

### 🔴🔴 擋在前面的那一句(正本 §13-②, 逐字)
> 「⇒ ⇒ 📌 **所以這一片的前置是「丁先被驗過」** —— 否則抽取與丁的失敗會混在一起, 分不出是誰弄的」

🔵 **而它拆得成兩半**(這是**我的判斷**, 標成判斷;正本沒有這樣拆):
```
本機那半 ✅ 今天證得到 —— 而正本自己給了證法, 比 v2 我寫的強得多:
   「同一張訂單餵進 buildStatementPdfHtml() ⇒ 回傳的 .html 字串【抽取前後逐位元組相同】」
   🔵 statement-pdf.test.ts 已經有現成 fixture 在比 HTML
   🛑 不要比 PDF 位元組 —— PDF 內含產生時間, 兩次跑本來就不同
部署那半 🛑 今天證不到 —— 「打一次真的 statement.pdf ⇒ 下載得到 + 中文是【字】」
   ⇒ 而丁至今正式站讀數 = 0 ⇒ **這一半真的要片 0。**
```
📌 **⇒ 決策題:第一片要不要在【部署那半沒證】的情況下上?那是拍板, 不是本檔。**
   (我的傾向:**不要**。正本那句是拍板不是建議, 而我 v2 已經自己豁免過它一次。)

### 🎯 片 1 範圍 = 把 `strip-pictographs.ts` 抽進 `packages/adapters/pdf`
**為什麼是它 —— v2 的理由死了兩條, 活下來的是這一條**:
```
✅ 仍成立  87 行 · import 0 個 · 純字串處理 ⇒ 最自足
✅ 仍成立  兩份逐位元組相同(sha256 3169118d5caa…)
⛔ 死了    ~~「已經在漂了」~~     —— drift 測試釘死了, 見 §〇ⓐ
⛔ 死了    ~~「只有一邊會叫」~~   —— 同上
🔵 活的那條(它比死掉的兩條強):
   drift 測試【自己的檔頭】寫了為什麼當初選複製不選共用, 逐字:
     「抽共用 = 把 @pcm/ui 接進後台 + 搬 1022 行 CSS + 搬 543 行元件 + 統一兩個不同的型別」
   🔴 **那個理由的射程是 CSS 與元件, 不是一支 87 行零 import 的純函式。**
   ⇒ 抽這一支不需要 @pcm/ui、不需要 CSS pipeline、不需要統一型別。
🛑 而這只證得到「它適合被抽」, **證不到「它該排第一」**(codex must-fix, 成立)。
   排序的依據是上面那句拍板, 不是這幾格。
```

**動作清單(v2 漏了四項, 全部補上)**
```
1. packages/adapters/package.json 加 "./pdf" subpath export
   🔴 今天【沒有這個子路徑】—— exports 只有 "." 與 "./server"
   ⇒ 沒有這一步就落實不了 plan-416 §1 裁的 `@pcm/adapters/pdf` 邊界
2. 新增 packages/adapters/src/pdf/strip-pictographs.ts(整支搬, 逐位元組)
3. 新增 packages/adapters/src/pdf/strip-pictographs.test.ts(admin 那 16 格搬過去)
4. 兩個 consumer 改 import:
     apps/admin/src/components/print/picking-doc.tsx / shipping-doc.tsx
     apps/storefront/src/components/print/statement-doc.tsx
5. 🔴 admin-copy-drift.test.ts:PAIRS 3 對 → 2 對、「清單長度 = 3」→ 2
   🛑 **這個動作長得跟該檔檔頭明文禁止的事一模一樣**(逐字「不是把下面的清單刪一行」)。
      差別:那句禁的是【讓兩份被允許不同】, 這一片是【其中一份不存在了】。
   ⇒ commit body 必須寫進這個差別, 否則下一個人讀 diff 只看得到「有人刪了一列守門」。
   ⇒ 並在該檔檔頭加一句「strip-pictographs 已抽進 packages/adapters/pdf(<hash>)」
      —— 讓下一個人知道少的那一對去哪了。
6. 補 storefront 的呼叫端測試(見下)
```

**驗收(v2 那格負對照是假的, 換掉)**
```
① 行為零改動的證法 = 正本 §13-② 本機那半:
   同一張訂單餵進 buildStatementPdfHtml() ⇒ HTML 抽取前後【逐位元組相同】
⛔ ~~負對照:改壞共用那支 ⇒ 兩邊測試都要紅~~  **作廢, 它證不到東西。**
   🔴 理由(vitest.config.ts:126-136 逐字):project `node` 的 include 是
      `{packages,apps,scripts}/**`, exclude 含 `apps/storefront/**` 與 `apps/admin/**`
   ⇒ 測試搬進 packages 之後**只在 node project 跑**, 與兩個 app 的 project 完全分開
   ⇒ ⇒ 「兩邊都紅」其實是**同一支共用測試跑了兩次**, 證不到任一 app 有 import 它。
   📌 那正是「兩半各自呼叫同一函式 ≠ 兩半綁在一起」。
✅ 換成:負對照落在【呼叫端】那一層
   admin      已有 print-docs-strip-wiring.test.ts 在斷言 shipping-doc/picking-doc 的字面
   storefront 🔴 沒有同款的 ⇒ 這一片要補一支
   ⇒ 突變:把共用那支改壞 ⇒ **呼叫端**的測試要紅(那才證得到接線)
③ 三綠(TURBO_FORCE=1, 要看到 0 cached)+ 兩邊各自的 vitest related
   🔴 連跑兩發比四個數:Test Files / Tests / 紅的格數 / 我餵幾條 vs 它跑幾支
估時 ⛔ ~~45 分鐘~~ —— 那個數沒把 1/4/5/6 算進去。**重估:90-120 分鐘**, 而它超過鐵則 4 的
     45 分鐘上限 ⇒ **要拆**。拆法未定, 不在本檔。
rollback 純碼、零 DB、零對外、零新依賴 ⇒ git revert
     ⚠️ 而「revert 了」與「線上退回去了」是兩件事 —— 要再部署一次
🛑 ~~「一個 byte 都不增」~~ **作廢** —— 沒有量測依據。新增套件入口與追蹤路徑都可能改 .nft,
   而正本 §13-③ 明列「抽取後體積尚未量」。抽完要**重 build、重算 .nft**。
```

### 片 0(不變, 不是我做得到的)
讓 `/account/orders/<id>/statement.pdf` **在正式站被打一次**, 讀四個數。
已寫成四格放進 `~/pcm-mailbox/端Sean-0905早上佇列.md` §C。

---

## 三、🛑 我沒做 / 沒量(v2 漏列的, codex 點名的全部補進來)

```
1  Vercel 雲端函式包的真體積 —— 只有部署後 Vercel 給的數算數
2  Vercel 打包時會不會對硬連結/symlink 去重
3  🔴 Fluid Compute + Active CPU 這個專案開了沒(get_project 不回這個欄位)
4  🔴 VERCEL_SUPPORT_LARGE_FUNCTIONS=1 設了沒
5  chromium 的 .br 資產鏈會不會完整進包
6  admin 最終的 import graph
7  🔴 .next 建置落後 HEAD(cdc172446 vs 7846f3b17)⇒ 本檔所有 .nft 讀數都要重量
8  🔴 抽取後必須重 build、重算 .nft ⇒ 現有體積與「零增加」不是同一版本的可比較數字
9  🔴 packages/adapters 今天沒有 ./pdf subpath export
10 🔴 兩個 consumer 的實際 import 路徑要怎麼改(re-export 還是直接 import)未定
11 🔴 舊 drift 測試怎麼改(見 §二 動作 5)
12 🔴 vitest project 分流(node / storefront / admin)—— 它決定負對照有沒有效
13 我沒有讀正本的 §1-§8 ⇒「哪些前提變了」的射程是 §0 · §9-§11 · §12.6-§13, 不是整份 1176 行
14 ⛔ ~~「du 與 df 差 30 倍」~~ 拿掉 —— 沒有命令、時點、分母, 無法複驗(codex nit, 成立)
```
