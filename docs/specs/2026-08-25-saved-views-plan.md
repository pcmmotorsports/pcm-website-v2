# Plan · 可存的自訂檢視(`#1` 看今天要處理什麼 · ⓒ 階)

> 🔴 **本檔的 `#1`-`#33` 是「員工的一天」項次(正本 `docs/specs/2026-07-25-admin-backend-rebuild-spec.md` §1 + §1.1),不是 `docs/phase-1-backlog.md` 的 `#N` —— **兩套全部同號、意義無關**。完整警語在正本檔頭。**不寫行號:那份檔會長。**

> **狀態:等批。一行碼都還沒寫。**
> 命中 **鐵則 8**(新表 + CRUD + UI,跨 3+ 檔)、**鐵則 12③**(schema)⇒ 高風險片、對抗審查不降級。
> 產出者:施工窗 pcm-website-v2-1d(線 4),2026-08-25。
> 內容分級:**不是 L3**(員工自己維護的資料,不是對客文案;沿用 `2026-08-14-e10-1-today-view-recon.md:81` 的判定)。

---

## 0. 🔴 開場先更正一個號碼 —— 而它會改變這片能不能做

`docs/specs/2026-08-14-e10-1-today-view-recon.md:55-56` 與
`docs/specs/2026-08-15-1-today-view-plan.md:162,180` 都把本片的**硬前置**寫成 **`#26`**。

**那是錯號,而它讀起來像好消息:**

```
docs/phase-1-backlog.md:840 逐字   ### #26. ✅ partiallyRefunded transition 評估
⇒ 照號去查的人 → 查到 → 看到 ✅ → 結論「那件做完了」→ 直接開工
```

這件事 backlog 自己已經登記成 `#638`(`docs/phase-1-backlog.md:21226`),
而 `#638` 只修了 **`apps/admin/src/app/settings/audit/page.tsx`** 那一處(`:44-47` 留痕)。
**本片依據的那兩份 spec 沒有被修到。**

**正確的指涉**(`docs/phase-1-backlog.md:21245-21247` 逐字,`#638` 條目自己列的):
**`E8-B` —— 真登入線的既有代號(不是 `#NNN` 號)**,今晚 = **線 3**。
`#215` / `#436` / `#534` / `#536` 是它散落的實作面。

📌 量法(2026-08-25 當場跑):
```
grep -rn '`#26`' docs/ apps/ supabase/ --include="*.md" --include="*.ts" --include="*.tsx" --include="*.sql" | grep -v node_modules | wc -l  ⇒ 42
正對照(同一條指令換字)同上改 '`#638`'  ⇒ 10 ⇒ 尺會動
```
⚠️ **那 42 行【不是】42 個錯號** —— `#26` 在本 repo 是**一號兩用**:
既是 backlog 號(partiallyRefunded,✅ 已收),又被當成「員工帳號 / 真登入」那條線的**代號**
(`docs/specs/2026-08-14-e26-staff-accounts-recon.md` 整份標題就是 `#26 員工帳號與權限`)。
⇒ **我沒有逐行分類那 42 行**,只逐行開檔核了與本片相關的 4 行(上面列的那兩份 spec)。
⇒ 這比 `#638` 記的範圍大(它只記了 migration 那一處),**已回報主視窗,不在本片處置。**

---

## 1. 那個硬前置,今天到哪了(**我自己開檔量的,不是轉述**)

| 半邊 | 狀態 | 證據 |
|---|---|---|
| 票是 `v:2` ⇒ 身分從**簽章驗證過的票**來 | ✅ 已上線 | `apps/admin/src/lib/session/actor.ts:78-81`(`case 'user': return await resolveStaff(session.sub.staff_id)`) |
| 旗標開 + 票沒身分 ⇒ **不回退** | ✅ 已上線 | 同檔 `:95` 逐字 `if (requireRealIdentity()) return null;` |
| 旗標關 ⇒ 讀自選 cookie | ⚠️ **走不到了**,見下 | 同檔 `:98` `return await resolveStaff(store.get(ACTOR_COOKIE)?.value);` |

## 🔴🔴 §1-a 更正(2026-08-25 當晚,本 plan commit 之後)

**本節原本的結論是「今天還不成立」,而那是錯的。已翻面。**

原本的依據是 `actor.ts:17-18` 那句逐字:
> 「**它完全失效的那一天** = `ADMIN_REQUIRE_REAL_IDENTITY` 打開且上游穩定送 `sub` … **那天不是今天。**」

🔴 **而那句話裡的「今天」,在我讀到它的時候已經不是今天了。**
Sean **2026-08-25 傍晚** 自己補上環境變數並重新部署,逐字:
⚠️ **2026-08-26 更正**:~~`17:24`~~ 是 **memory 建檔時刻**(`stat %SB` ⇒ 2026-08-25 17:24:26),**不是事件時刻** —— 真正部署在他那句話前幾分鐘,**沒有人量過**;memory 正文 `grep '17:24'` ⇒ 0。⇒ 正確寫法:「2026-08-25 傍晚(memory 落檔 17:24:26)」。

```
「ADMIN_REQUIRE_REAL_IDENTITY 沒有這一條,我剛剛加上去了 並且重新部署了」
主視窗追問值 ⇒ 他答「1」
```
落檔:memory `project_0825-real-identity-gate-is-live`(檔案時間 17:24;本 plan 寫於當晚 23:xx)。

### ⇒ 翻面後的結論
```
旗標 = 1 ⇒ actor.ts:95 `if (requireRealIdentity()) return null;` 攔下
      ⇒ 第 3 層(自選 cookie)**走不到**
      ⇒ 身分只能來自簽章驗證過的票 ⇒ 【可信】
連帶(同一支 memory 記的):旗標開著而 Sean 登出再登入仍然通
      ⇒ sso/callback:95 的 `!result.sub` 那道閘沒擋他
      ⇒ **上游有在送 sub,這是量到的不是推的**
⇒ ⓒ-每人一份 的硬前置【成立了】。
```

### 🔴 這件事本身的形狀,比結論值錢
```
① 一個檔用「今天」描述世界,而【它不會知道今天過去了】。
   那句話寫的時候是對的, 我讀的時候是錯的, 而兩個時刻的字面一模一樣。
② 答案在 memory 裡躺了六小時, 而我沒有 grep memory 就下了結論。
   ⇒ 與本 plan §0 抓到的 `#26` 是同一族:**答案存在,而沒有路通到它。**
   ⇒ 差別是 §0 那次我是發現者, 這次我是受害者。
③ 我原本寫「這一格要問線 3 或 Sean」—— 而正確動作是【先 grep memory】。
   問人之前先查已經答過的, 否則會請 Sean 重做一件他已經完成的事。
```
📌 更正來源:線 3(`pcm-website-v2-f5`)主動指出。**不是守門抓到的。**

---

## 2. 階梯(沿用 `2026-08-14-e10-1-today-view-recon.md:47-56`,**只更新今天變了的欄**)

| 階 | 做法 | 動幾檔 | 鐵則 | 今天做得動嗎 |
|---|---|---|---|---|
| **ⓐ 多加寫死 chip** | 往 `CHIPS` 常數加項 | 2-3 | 全不命中 ⇒ 輕量片 | ✅ **今天就能做,零依賴** |
| **ⓑ 教員工存瀏覽器書籤** | 零 code | 0 | 無 | ✅ 而換電腦就沒了、**存不到關鍵字** |
| **ⓒ 存進 DB** | 新表 + CRUD + UI | 新 migration + repo + action + UI + 測試 | **8 + 12③** ⇒ 高風險片 | ⚠️ 看綁不綁「人」 |

🔴 **ⓒ 現在要拆成兩種,而它們的前置條件【不同】**:

```
ⓒ-每人一份   每筆檢視綁 staff_id
             硬前置 = 真登入(E8-B / 線3)⇒ ✅ **2026-08-25 起成立**(見 §1-a 更正)
             🔴 身分來源用 `getSessionActor()`,**不要用 `ACTOR_COOKIE`**(線3 提醒)
ⓒ-全站共用   檢視沒有擁有者欄 ⇒ 不需要可信身分 ⇒ 今天做得動
             ⚠️ 「不需要」是設計推論,**未實作、未量**
```

⚠️ **而「全站共用」不是「每人一份的簡化版」,它是【另一個產品】**:
一個員工改了那張檢視,**每一個看那張檢視的人畫面一起變**(**未實作、未量**:這是
「沒有擁有者欄」這個設計的直接後果,不是量到的行為),而畫面上沒有東西告訴他這件事。
⇒ 若選它,**UI 上必須明講「這是大家共用的」**,否則它會安靜地變成一個互相踩腳的功能。

🔴 **三階共同的天花板(不因選哪一階而消失)**:
**任何「把目前畫面存起來」的功能都存不到關鍵字搜尋。**
理由:關鍵字走 cookie 不走 URL,而那是拍板
(`apps/admin/src/lib/orders/keyword-search-action.ts:18` 逐字「PRG 是紅線不是風格(Q-a=B)」)。
⇒ **這一片不假裝解決了那件事**(沿用 `2026-08-15-1-today-view-plan.md:164-166` 的邊界)。

---

## 3. 🔴 要 Sean 拍的 —— 兩題,每題一個字

```
Q1 這一片現在做哪一階
   甲 先做 ⓐ:再加幾顆寫死的 chip,零 schema、今天就能出            ← 推薦
   乙 直接做 ⓒ-全站共用:新表 + CRUD,而全公司共用一份檢視
   丙 做 ⓒ-每人一份(**2026-08-25 起前置成立,見 §1-a**)
   理由:ⓐ 解掉「員工天天要重篩同一組條件」那個痛的**大半**,而它不動 schema、
         不需要可信身分、也不擋住將來做 ⓒ(ⓐ 的 chip 將來可以變成「內建檢視」)。
         乙 現在做得動,而它交出去的是一個**會互相踩腳**的東西。
         🔴 **丙不再是「無限期等別條線」** —— 身分閘 08-25 已上線 ⇒ 它現在是
         「要新增一張表 + CRUD + UI」的工程量問題,不是前置條件問題。
         我仍推薦甲,理由**改了**:不是「丙做不動」,是**甲今天就能出、而丙要一整片**。

Q2 (Q1 選甲才要答)要加哪幾顆 chip
   🔴 **這一格我不自己決定** —— 它是「員工每天實際上在篩什麼」,不是技術題。
   現有三顆逐字(`order-filter-chips.tsx:108-114`):全部 / 待收款·待訂貨 / 未到貨
   OD 稿上有而我們還缺的:**退貨中**(`:93` 逐字記著要插回原位)
   甲 只補「退貨中」                              ← 推薦
   乙 補「退貨中」+ 你再點名 1-2 顆
   理由:「退貨中」是 OD 稿上就有、順序都定好的那一顆,補它是**把稿補齊**不是發明。
   🔴 **而它今天補不了**:`#500` / `#18` 已證實**退貨線整條不存在** ⇒ 沒有資料面可接
      (`2026-08-15-1-today-view-plan.md:167` 逐字)⇒ **未確認它現在是否仍然成立,要重量。**
```

⚠️ **Q2 甲那一格我剛剛自己打了自己一巴掌**:推薦補「退貨中」,而同一份 plan 記著它沒有資料面。
**留在這裡不刪** —— 因為 Sean 看到的應該是「這顆是稿上要的、而它現在接不上」,
不是我安靜地換一顆比較好做的給他。**這一格請主視窗連同這句話一起端過去。**

---

## 4. 假如 Q1 選甲(ⓐ),這片長這樣

**要改什麼**(鐵則 8 四件之一)
```
apps/admin/src/components/orders/order-filter-chips.tsx   往 CHIPS 加項 + 高亮比對
apps/admin/src/components/orders/order-filter-chips.test.tsx  每顆新 chip 一格正測 + 一格負測
(若新 chip 的條件需要新常數 ⇒ apps/admin/src/lib/orders/order-list-view.ts)
```
⚠️ `order-filter-chips.tsx` 是**線 1 的檔案面**;主視窗 2026-08-25 已裁**甲(可以動)**,兩個條件:
`git add` 逐檔列絕對路徑禁目錄級、動前先 `cp` 一份到 scratchpad。**照做。**

**為什麼**:員工每天要看同一組條件的單,而現在每次都要重點一次下拉。

**預期影響面**:只有 `/orders` 列表頁的 chip 列。零 schema、零 API、零金額路徑。
🔴 **既有的高亮邏輯有一顆定時彈,新 chip 會踩到**:`order-filter-chips.tsx:121-123` 逐字記著
「只寫 `filter.goodsAxes === undefined` 判『全部』…**漏了這裡的集合比對,`未到貨` 會在任何多值狀態下亮起來**」
⇒ **每加一顆 chip 都要同時加它的高亮比對**,不是只加一列常數。

**rollback**:單一 commit revert;無 schema、無資料遷移 ⇒ **revert 即完全復原**。

---

## 5. 這份 plan 自己不確定的

```
· 正式環境 ADMIN_REQUIRE_REAL_IDENTITY 是 0 還是 1 —— 沒查(.env* 不可讀)
· 上游是否穩定送 sub —— 沒查
· 「退貨線整條不存在」(#500 / #18)今天是否仍成立 —— 沒重量,引用的是 08-15 的字面
· 那 42 行 `#26` 裡有幾行是錯號、幾行是線代號 —— 沒逐行分類,只核了與本片相關的 4 行
· 員工實際上每天在篩什麼 —— 沒問過任何員工,Q2 全靠稿與現有 chip 推
```

📌 相關:[階梯原文](2026-08-14-e10-1-today-view-recon.md) · [邊界原文](2026-08-15-1-today-view-plan.md) ·
`docs/phase-1-backlog.md:21226` (`#638` 錯號登記) · `apps/admin/src/lib/session/actor.ts`

---
---

# 🔴 §6 拍板之後:Sean 選了丙 ⇒ 這一片長這樣(2026-08-27 線4 續寫,**等批**)

> **狀態:等 Sean 批。一行碼都還沒寫、schema 一個字都沒動。**
> 數法(2026-08-27 當場跑):`git status --porcelain | grep -c 'saved-views-plan'` ⇒ 1、
> `git status --porcelain | grep -cE 'supabase/migrations|apps/admin/src/(lib|components)/orders'` ⇒ 那幾支全是別條線的,
> **本片零命中**(逐支比對清單見 `§6-3` 交界風險那節)。
> 拍板出處(⚠️ **引用帶檔名 + 題號,不寫「Q15 丙」**):
> `~/pcm-mailbox/CHECKPOINT-主視窗-96-壓縮前-20260826.md` 的 **`Q15=丙`** 逐字
> 「**Q15 丙 等真登入再做每人一份**」(第二批 23 題決策表)。
> 🔴 **`Q15` 在本 repo 是【一號兩用】**:`STATUS.md:32`(Blocker 節)現行還有另一個 `Q15`=甲
> (customers 那條缺的 `FOR SELECT TO service_role` 政策;
>  數法 `grep -c 'Q15' STATUS.md` ⇒ 5、負對照 `grep -c 'Q9999' STATUS.md` ⇒ 0)—— **完全不同的事,而兩句都讀得通。**
> ⇒ 本節之後一律寫全稱,不寫裸題號。(主視窗 `-5b` 2026-08-27 指出。)

## 🔴 6-0 上一版推薦的是甲,而拍板是丙 —— 本節不回頭推銷甲

`§3 Q1` 那份推薦(甲:加寫死 chip、零 schema、今天就能出)**已被拍板推翻**。
⚠️ 它**仍然完整、仍然有說服力、而且就在同一份檔案的上面** ——
📌 **一份被推翻的推薦不會自己消失,它是最容易讓人不知不覺走回去的東西。**
⇒ 本節只把丙補成可執行的一片。`§4`(「假如 Q1 選甲」)**保留備查、不刪、不再更新**。
⇒ `§3 Q2`(要加哪幾顆 chip)是「Q1 選甲才要答」⇒ **拍丙之後不成題,不去碰它**
  (修一個已經不成題的題目 = 製造新的過期字面)。

## 6-1 片型與分級(動手前先標)

```
片型   高風險片  —— 命中鐵則 12③(新表 + migration)⇒ 對抗審查【不降級】,codex 必跑
鐵則 8 命中     —— 動 schema + 跨 3+ 檔 ⇒ 本節就是那份 plan, 等 Sean 批才動手
內容分級 不是 L3 —— 員工自己維護的資料, 不是對客文案
                  出處 `docs/specs/2026-08-14-e10-1-today-view-recon.md:83` 逐字
                  「ⓒ 的自訂檢視 = 員工自己維護的資料,**不是 L3 內容**(它不是對客文案)」
                  🔴 **本節上面 `§0` 那份 plan 寫的是 `:81`, 而 `:81` 講的是 ⓑ 書籤、不是分級。**
                     我第一版**照抄了那個行號沒有開檔核** —— 2026-08-27 重量才發現。
                     📌 **我從一份自己正在續寫的檔裡, 抄走了一個錯的行號** ——
                        它就在同一支檔案上面幾十行, 而我沒有點開它。
體積   ⚠️ 超過 15-45 分鐘 ⇒ **鐵則 4 要求拆**。拆法見 6-6。
```

## 🔴 6-2 這一片的核心設計決定:**存網址,不存欄位**

存一組篩選條件有兩條路,而它們的差別**不在工程量,在誰來守白名單**:

```
乙案 存欄位   把 AdminOrderFilter 的每一軸拆成資料表欄位(或一坨 jsonb)
              ⇒ 讀回來時要【重新驗一次】每一軸的合法值
              ⇒ 🔴 那是**第二份白名單**, 而兩份白名單一定會漂
                 (第一份的落點:`packages/domain/src/order/types.ts:287` `AdminOrderFilter`
                  + `apps/admin/src/lib/orders/order-list-view.ts:405-432` 那段 parse)
                 (漂了之後畫面照樣顯示得出東西 —— 只是篩的東西不一樣)

甲案 存網址   把那 9 個 URL 參數原樣存成一段 query string,讀回來時
              **丟回既有的 `parseOrderListSearchParams()`(`apps/admin/src/lib/orders/order-list-view.ts:382`)重新 parse**
              🔴 **我第一版把它寫成 `parseOrderListView()` —— 那個函式【不存在】**
                 (`grep -rn parseOrderListView apps/ packages/` ⇒ **0**;codex 關卡1 抓到)
                 📌 **一個不存在的函式名寫在 plan 的核心設計那一句上, 而它讀起來完全合理。**
              ⇒ 白名單守門**一份都不用新增**:`pickEnum` / `pickEnumMulti` 已經
                 逐值白名單 + 去重 + 空折 undefined(實作在 `apps/admin/src/lib/shared/list-params.ts:15`(`pickEnum`)與 `:33`(`pickEnumMulti`);
                 ⚠️ 我第一版引的 `order-filter-chips.tsx:126-127` **只是一段描述性註解, 不是實作** —— codex 關卡1 抓到)
              ⇒ 存進去的髒值(手改網址、日後改 enum)在**讀出來的那一刻**被丟掉,
                 而不是變成一個沒有人驗過的篩選條件
              ⇒ ✅ **本 plan 推薦甲**
```

🔴🔴 **「那 9 個參數」是錯的,而錯法值得寫下來(codex 關卡1 抓到)**

**repo 裡本來就有一份權威清單,而我沒找到它**:
```
apps/admin/src/lib/orders/order-list-view.ts:701  const ORDER_LIST_URL_KEYS = [ … ] as const
⇒ **11 個 key**, 不是 9:
   我數到的 9 個 filter 參數
   + ORDER_PANEL_PARAM      ← 訂單面板開在哪一筆
   + CUSTOMER_PANEL_PARAM   ← 客戶面板開在哪一筆
另有 `page` / `r` / `rt` 等消費者不在這份清單裡(見 `order-return-to.ts` 的 RESULT_ONLY_PARAMS)
```
**我的尺是 `grep "_PARAM = '"`** ⇒ 它數的是**宣告**,而**組裝好的那份權威清單長在別的地方**。

🔴 **而最難看的一格是:我自己在 `§6-9` 標了這個盲區** ——
   逐字「若有參數是用別的寫法宣告的,我的尺看不見它 ⇒ **未確認**」
   **⇒ 我標了未確認, 然後把那個未確認的數字當成整片設計的地基用了下去。**
   📌 **標「未確認」不等於處理了它。一個被標記的洞, 與一個被填起來的洞, 在下一句話裡長得一樣。**

⇒ **正確做法:不要自己數,直接用 `ORDER_LIST_URL_KEYS`**(它已經是單一權威)。
⚠️ 而那兩個 panel key 在裡面 ⇒ **「原樣存整段 query」會把「面板開在某一筆訂單上」也存進去**
   ⇒ 明天點開那個檢視, 會重開一個舊面板、顯示過期的內容(codex must-fix)。
   ⇒ **存哪些 key 要另立白名單, 而那份白名單必須從 `ORDER_LIST_URL_KEYS` 扣掉 panel 那兩個。**

### 🔴🔴 6-2a 而甲案有一個會靜默說謊的地方 —— **日期**

```
date_from / date_to 在網址上是【絕對的年月日】(`:468-469` 逐字 firstValue(raw[DATE_FROM_PARAM]))
而「今天 / 本週」那些按鈕是由 `matchOrderDatePreset()` 從那兩個絕對日**反推**出來的(`:479`)

⇒ 員工今天按「今天」再存成檢視 ⇒ 存進去的是 `date_from=2026-08-27&date_to=2026-08-27`
⇒ **明天點它, 看到的是 8/27 的單, 不是明天的單**
⇒ 🔴 而畫面上**沒有任何東西會紅**:日期格式正確、範圍合理、筆數是真的、
     篩選列還會把「自訂」那一格顯示成選中 —— 它看起來完全正常。
📌 這正是本 repo 記過的那個母題:**錯的那次和對的那次長得一樣。**
```

⇒ **這一格要 Sean 拍**(見 6-5 `Q-檢視-2`),而三條路都寫在那裡。
⚠️ **在他拍之前,這一片不能開工** —— 這不是實作細節,是「這個功能到底在做什麼」。

## 6-3 要改什麼(鐵則 8 第一件;**這份清單就是協調用的那份**)

```
新增
  supabase/migrations/2026MMDD_m4b_1_admin_saved_order_views.sql     新表 + RLS + GRANT
  apps/admin/src/lib/orders/saved-views.ts                           純函式:query string ↔ 檢視
  apps/admin/src/lib/orders/saved-views.test.ts
  apps/admin/src/lib/orders/saved-views-actions.ts                   server action:建/改名/刪
  apps/admin/src/lib/orders/saved-views-actions.test.ts
  apps/admin/src/components/orders/saved-view-chips.tsx              UI:存起來的那排 + 「存成檢視」
  apps/admin/src/components/orders/saved-view-chips.test.tsx

要讀(不一定要改)
  apps/admin/src/lib/session/actor.ts          `getSessionActor()` 取 staff  —— 🔴 只讀
  apps/admin/src/lib/orders/order-list-view.ts `parseOrderListView` 重 parse —— 🔴 只讀

🔴 交界(主視窗 `-5b` 2026-08-27 居中, 線1 `-21` 自己給了形狀 ⇒ **已解, 不是風險**)
  · `apps/admin/src/lib/orders/order-list-view.ts`   線1 動的形狀 = **純加法一處**:
      把 `taipeiParts` 由 `function` 改成 `export function` + 一段註解
      (`git diff --stat` ⇒ 1 file, 11 insertions(+), 1 deletion(-))
      🔴 **沒改任何既有函式簽名、沒碰 `buildOrderListHref` / 篩選那一族**, 下完就離開該檔
      ⇒ 與本片(篩選 / 檢視那一族)**零交集**
  · `packages/domain/src/order/types.ts`             線1 也在動(`AdminOrderFilter` 在這)
      ⚠️ **這一支我沒有拿到形狀** ⇒ 實作前要跟主視窗要一次, 不要自己推
  · `apps/admin/src/components/orders/order-filter-chips.tsx`  2026-08-27 量:**沒有人在動**
    (`git status --porcelain | grep -c 'order-filter-chips'` ⇒ 0,主視窗當場量)
  ⇒ 本片**設計上不需要改**上面前兩支(只 import 既有 export)。
    ⚠️ 而「不需要改」是**設計推論,不是量到的** —— 真的動手時若發現要改,
       **停下來找主視窗居中,不要自己去改**。

📌 **報交界的規格(線1 `-21` 2026-08-27 示範, 本 repo 之後照這個寫)**:
   協調**不是**問「我可不可以動這支檔」—— 那會讓兩邊都停下來等一個還沒發生的答案。
   協調是**給出「我動了什麼形狀」讓對方自己判會不會撞**,四件:
   ```
   ① 哪一支檔          ② 加法還是改法(`git diff --stat` 的實際數字)
   ③ 有沒有動既有簽名   ④ 做完會不會再回來
   ```
```

## 6-4 表長這樣(草案;**未寫、未跑、未驗**)

> 🔴 **2026-08-27 夜更新:這張表【不能定稿】** —— `Q-檢視-1=乙`(要共用)+ `Q-檢視-3=乙`
> (共用那份沒有主人)+ `Q-檢視-2=甲`(存相對日期)三個答案回來之後,下面這張表**至少缺三欄**:
> ```
> staff_id     要能是 NULL(共用那份沒有主人)⇒ 現在的 NOT NULL 不成立
>              ⚠️ 而 NULL 一進來, 那個 (staff_id, label) 的唯一索引可能【不再擋重複】
>                 —— Postgres 預設 `NULLS DISTINCT` ⇒ 多個 NULL 互不相等 ⇒ 兩張同名共用檢視並存。
>                 🔴 **這一條我沒有在本專案的 PG 上實測** ⇒ 標**未確認**;實作時走
>                 `docs/runbooks/throwaway-postgres-for-migration-verification.md`,
>                 餵兩筆同名 NULL-owner 進去看擋不擋 —— **擋與不擋兩個世界都要餵一發**。
> is_shared    或用 staff_id IS NULL 當旗標(兩種都行, 而**要挑一種並寫下為什麼**)
> date_preset  `Q-檢視-2=甲` 要存的那一欄(存 preset 的 key, 讀回來當天重算)
> ```
> ⇒ **等 `Q-檢視-4/5/6` 回來再定稿**(它們決定要不要 `created_by` / `updated_by` / 版本號)。
> 下面保留的是**回答之前**那一版,**不是最終形狀** —— 留著是為了看得出差在哪。

形狀抄自既有 `supabase/migrations/20260726120000_m4b_e8a1_staff_table.sql`
(`:62` ENABLE RLS / `:65` REVOKE ALL FROM PUBLIC, anon, authenticated, service_role / `:71-72` 只 GRANT 給 service_role 且 UPDATE 逐欄)。

```sql
CREATE TABLE public.admin_saved_order_views (
  id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  staff_id    text        NOT NULL REFERENCES public.staff(id) ON DELETE CASCADE,
  label       text        NOT NULL,
  query       text        NOT NULL,   -- 那段 query string(不含 `?`)
  sort_order  integer     NOT NULL DEFAULT 0,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT saved_view_label_nonempty CHECK (pg_catalog.btrim(label) <> ''),
  CONSTRAINT saved_view_label_len      CHECK (char_length(label) <= 40),
  CONSTRAINT saved_view_query_len      CHECK (char_length(query) <= 2048)
);
CREATE UNIQUE INDEX admin_saved_order_views_owner_label_idx
  ON public.admin_saved_order_views (staff_id, pg_catalog.btrim(label));
```

🔴 **權限(鐵則 12②;照 `docs/patterns/revoking-function-execute-in-supabase.md`)**
```
ALTER TABLE … ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE … FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT, INSERT, DELETE ON TABLE … TO service_role;
GRANT UPDATE (label, sort_order, updated_at) ON TABLE … TO service_role;   -- staff_id / query 不給改
⚠️ **新物件出生就自帶 anon 權限,而 repo 內零 `GRANT` 字面可掃、三綠不會紅**
   ⇒ 兩道 REVOKE 都要下,不是只下一道。(該 runbook 的原話)
🔴 **ownership 由【app 層的 where staff_id = 目前這個人】守,不是 RLS** ——
   後台走 service_role(它 BYPASSRLS)⇒ **RLS 在這條路上不生效**。
   ⇒ 那道 where 是唯一的一道 ⇒ 它要有自己的負測:
     「用 A 的 session 讀 B 的檢視 id ⇒ 讀不到 / 刪不掉」,而且要**先看它會紅**。
```

## ✅ 6-5 三題已回(2026-08-27 夜)—— **而其中一題不是 Sean 答的,那件事要寫清楚**

```
Q-檢視-1 = 乙  自己的 + 共用的都有        (Sean 拍板;⚠️ 我傾向甲, 他選了反面)
Q-檢視-3 = 乙  共用一份【沒有主人】的      (Sean 拍板;⚠️ 我傾向甲, 他又選了反面)
Q-檢視-2 = 甲  存相對日期、多存一欄        🔴 **主視窗 `-5b` 決定, 不是 Sean 拍板**
```

📌 **兩題他都選了我推薦的反面, 而兩題方向一致:他要【共用】。**
   ⇒ 那是一個立場, 不是隨手選。之後涉及「這東西要不要能共用」的設計, **預設偏共用側**。

### 🔴 6-5a `Q-檢視-2` 的作者是主視窗,不是 Sean —— 不得寫成他的拍板

Sean 對這一題逐字:「**我看不懂,你決定**」⇒ 主視窗 `pcm-website-v2-5b` 決定 = **甲**。
(來源:主視窗 2026-08-27 夜的訊息;全文另存 memory `project_0827-sean-second-batch-and-night-run` §二。
 ⚠️ **我沒有直接聽到 Sean 那句** —— 它經過一手轉述, 標明來源、不寫成我親見。
  依據 `~/.claude/rules/00-work-rules.md:98` 轉述契約①:值與授權句貼原文不重打,
  轉述判斷要標**來源屬性**(量到 / 讀來 / 推測)⇒ **本段屬「讀來」。**)
🔴 **落檔一律寫「主視窗決定」,絕不可寫成「Sean 拍板 `Q-檢視-2`=甲」。**
📌 判別句:**這個決定如果他從來沒看過, 還成立嗎?成立 ⇒ 它是我們的, 不要寫他的名字。**
⇒ **他授權的是「由我們決定」這件事本身, 不是我們選的那個答案。**

**理由寫下來是為了讓它可以被推翻**(主視窗給的三條 + 代價,照抄;
第 2 條引的是本檔 `§6-5c` 那一格我自己寫的字面):
```
1. Q-檢視-1=乙 已經定了「檢視可以共用」⇒ 一份共用檢視若存絕對日期,
   它對【每一個看到它的人】都會過期, 而過期那天沒有任何東西會紅。**共用放大了乙的傷害。**
2. 我自己標的那句是決定性的:「乙不用做任何事, 因為它就是【什麼都不處理】的結果」
   ⇒ 乙不是被選出來的設計, 是沒有人決定時會自己發生的東西。
   📌 **一個選項如果「不選它也會發生」, 那它就不是一個選項, 是預設值。**
3. 丙(不給存日期)會讓這功能失去最常用的情境(「今天的單」), 代價太大。
⚠️ 代價明寫:甲要多存一欄、讀回來要重算, 而**重算的邊界(時區、跨日)是新的錯誤面**。
(第 2 條的原句落點:本檔 `§6-5c` 的 `Q-檢視-2` 那一格;第 1 條的前提:本檔 `§6-2a`,
 而它引的是 `apps/admin/src/lib/orders/order-list-view.ts:468-469` 與同檔 `:479`。)
```
全文另存 memory `project_0827-sean-second-batch-and-night-run` §二。

## 🔴 6-5b 而 `Q-檢視-1=乙` + `Q-檢視-3=乙` 合起來,造出一個我原本不用面對的狀態

```
Q-檢視-1=乙  ⇒ 有一排【共用】的檢視
Q-檢視-3=乙  ⇒ 共用那份【沒有主人】
⇒ 存在一種【沒有主人、而大家都看得到】的檢視
```
🔴 **而「沒有主人」不是一個少了一欄的狀態, 它是一個【誰都可以動】的狀態。**
⇒ 下面三題**是 schema 題不是 UI 題**, 我**不自己決定**(資料歸屬題)。

```
Q-檢視-4  共用檢視【誰可以刪】?
   甲 任何員工都可以刪
   乙 只有建立它的人可以刪(⚠️ 那等於它還是有主人 —— 與 Q-檢視-3=乙 相牴觸)
   丙 只有 manager 可以刪(`staff.is_manager` 這一欄存在, 而它現在【零程式讀取】
      —— 建表 `20260726120000_m4b_e8a1_staff_table.sql:28-29` 逐字警告
      「本欄目前無任何程式讀取、不強制任何權限…看到此欄不代表權限已生效」)
   👉 丙會讓本片變成**第一個真的讀那一欄的地方** ⇒ 那是一個獨立的決定, 不該順便發生。

Q-檢視-5  共用檢視【誰可以改】(改名 / 改條件)? 〔與 `Q-檢視-4` 共用同一組角色前提〕
   甲 任何員工都可以改
   乙 不能改, 只能刪掉重建(**最小、而且沒有併發問題**)
   丙 只有 manager(同 `Q-檢視-4` 丙的前提:
      `supabase/migrations/20260726120000_m4b_e8a1_staff_table.sql:28-29` 逐字警告
      該欄「目前無任何程式讀取、不強制任何權限」)
   👉 乙看起來笨, 而它把 Q-檢視-6 整題消掉。

Q-檢視-6  兩個人同時改同一份共用檢視會怎樣?
   甲 後寫的贏, 不提示(**最小, 而且是「什麼都不做」的結果** ——
      📌 同 `Q-檢視-2` 的乙那個形狀:它會在沒有人決定時自己發生)
   乙 後寫的贏, 而畫面上告訴他「這張檢視剛剛被別人改過」
   丙 擋下來, 要他重讀再改
   👉 若 Q-檢視-5 選乙(不能改), **本題不成題。**
```
⚠️ **這三題今晚不會有答案**(Sean 已休息)⇒ 標**待拍板**, 由主視窗明早併批端。
🔴 **在它們回來之前, `§6-4` 那張表不能定稿** —— 它們決定表上有沒有 `created_by`、
   有沒有 `is_shared`、要不要 `updated_by` / 版本號。**不猜。**

## 6-5c(原始題目留檔,不刪 —— 選項字面的作者是提問的人)

```
Q-檢視-1  存起來的檢視要不要能給別人看到?
   甲 只有自己看得到(純每人一份)                              ← 我傾向
      依據:`apps/admin/src/lib/session/actor.ts:73-79`(fallback / bootstrap 兩種都回 null)
   乙 自己的 + 一排全公司共用的(要多做「誰能改共用的」那一格)
   👉 乙 = 一個人改、其他人畫面跟著變, 而畫面上不會有提示
      (§2 已寫:**未實作、未量**, 這是「沒有擁有者欄」的直接後果, 不是量到的行為)
   👉 甲交出去的東西比較小, 而且乙隨時可以加上去;反過來不行。

Q-檢視-2  🔴 存「今天」這種會動的日期, 明天點它應該看到什麼?
   甲 看到【明天】的單 —— 存的是「今天」這個【意思】, 不是那一天的日期     ← 我傾向
   乙 看到【存的那一天】的單 —— 存的是那個日期本身
   丙 這一版**乾脆不存日期**, 存檢視時把日期那一軸丟掉、點開後日期回預設
   👉 現在的網址上只有絕對日期(`date_from=2026-08-27`), 沒有「今天」這個意思
      落點:`apps/admin/src/lib/orders/order-list-view.ts:468-469`(讀那兩個絕對日)
            + 同檔 `:479` `matchOrderDatePreset` 從絕對日**反推**按鈕, 而反推不會知道那天是不是今天
      ⇒ **選甲要多存一欄**(存 preset 的 key, 讀回來當天重算), 不是免費的
   👉 而選乙**不用多做任何事** —— 因為它就是「什麼都不處理」的結果
      🔴 **這正是危險的地方**:乙會在沒有人決定的情況下自己發生,
         而明天點開看到昨天的單, 畫面上不會有任何東西紅。
   👉 丙最小、最誠實, 而員工每次都要重點一次日期。

Q-檢視-3  用共用密碼登入的人(沒有具名身分)看到什麼?
   甲 看不到「我的檢視」那一排, 也不能存 —— 畫面上寫一句為什麼        ← 我傾向
   乙 讓他們共用一份「沒有主人」的檢視
   👉 `apps/admin/src/lib/session/actor.ts:73-79` 逐字:共用密碼備援 (`fallback`)
      與首次建置 (`bootstrap`) **兩種都回 null**, 拿不到 staff_id ⇒ 甲是現況的自然結果
   👉 ⚠️ **今天實際上有沒有人用共用密碼登入, 沒有人量過**(§3 就標著這句, 仍未量)
      ⇒ 若答甲, 那句「沒有人量過」要跟著寫進交件, 不得寫成「沒有人這樣用」
```

## 6-6 拆片(鐵則 4:15-45 分鐘可中斷 + Sean 肉眼驗得了)

```
片1  schema  migration + 兩道 REVOKE + GRANT 逐欄 + 拋棄式 PG 上跑斷言
             (含負測:anon / authenticated 讀不到;先看它會紅)
             ⇒ 高風險片, codex 必跑。**不接 UI, Sean 這一片看不到畫面**
片2  讀       saved-views.ts(query string ↔ 檢視, 純函式)+ 列表讀出來顯示成一排 chip
             ⇒ Sean 肉眼驗:手動塞一筆進 DB, 那排 chip 出現、點下去篩對
片3  寫       「存成檢視」+ 改名 + 刪 + 那道 ownership where 的負測
             ⇒ Sean 肉眼驗:存一組、改名、刪掉
🔴 片1 單獨上線是安全的(新表沒有人讀)⇒ 三片可以分開 commit、分開推。
```

## 6-7 rollback

```
片2 / 片3   單一 commit revert ⇒ 完全復原(只動 app 層)
片1         🔴 **migration 不能靠 revert 復原** —— 它已經跑在正式庫上了
            ⇒ 要附一支 down migration(DROP TABLE ... CASCADE)
            ⇒ ⚠️ 而 DROP 會**連同員工存的檢視一起消失**, 那是不可逆的
              ⇒ 上線後才要 rollback ⇒ 先 dump 那張表再 DROP
```

## 6-8 🔴 這一片交不出來的東西(寫在前面,不要等交件才講)

```
· **關鍵字搜尋存不進去。** 關鍵字走 cookie 不走 URL, 而那是拍板紅線
  (`apps/admin/src/lib/orders/keyword-search-action.ts:18` 逐字「PRG 是紅線不是風格(Q-a=B)」)
  ⇒ 存一組「含關鍵字」的畫面, 存起來的那份**沒有關鍵字**, 而它看起來就是一張正常的檢視。
  ⇒ **UI 上要講**, 不能只寫在這份 plan 裡。
· 排序不存(列表目前沒有可切的排序軸 —— **未查, 未確認**)
· 頁碼不存(`page` 不在那 9 個參數裡, 而存一個「第 3 頁」也沒有意義)
```

## 6-9 這份續寫自己不確定的(**逐條, 不藏**)

```
· 那 9 個參數是不是**全部**篩選狀態 —— 我 grep 的是 `_PARAM = '` 這個字面。
  🔴 **若有參數是用別的寫法宣告的(樣板字串 / 行內字面), 我的尺看不見它**
  ⇒ **未確認**。實作前要用第二種數法交叉(例如掃 `raw[` 的取用點)。
  📌 這一條是 2026-08-27 我自己在 wallet.css 上踩過的同一個病:**尺比對象窄**。
  🔴 **而它有一個更大號的同族, 同日由線1 `-21` 自爆**。
     ⚠️ **我拿到的是轉述, 所以我自己開了那顆 commit** —— `git show 7489aada --format=%B --no-patch`
     的第 111 行**逐字**(引用塊, 未重打):
     ```
       admin  126 passed | 1 skipped (127) · 2636 passed | 2 skipped (2638) · 紅 0  —— 兩發完全相同
     ```
     📌 轉述給我的版本是「admin 126 passed · 2636 測項 · 紅 0」—— **它把 skipped 那兩格吃掉了**。
        兩個版本都支持同一個結論, 而**只有一個是那顆 commit 上真正寫著的字**。
     而**今天全套的分母是我自己量的**(2026-08-27,`npx vitest run apps/admin`):
     ```
       Test Files  281 passed | 1 skipped (282)
       Tests  5112 passed | 2 expected fail | 2 skipped | 1 todo (5117)
     ```
     ⇒ `127 / 282` 檔、`2638 / 5117` 測項 ⇒ **分母不到一半**, 而那半裡藏著 6 格 `TypeError`
       (`order.shippingAddress.name` 少一個 `?.`;**這一格是轉述, 我沒有自己複現**)。
     **那句「兩發完全相同」是真的, 三個數字都在, 而它看起來比大多數收工紀錄都嚴謹。**
     ⇒ **連跑兩發比總數防的是【漏跑】, 防不了【分母一開始就選窄】—— 窄的分母跑兩次還是窄的。**
  ⇒ 📌 **本片的判別句要問兩層, 不是一層**:
       ① **我的尺看得見對象的全部嗎?**(wallet.css 那次:`^\.` 看不見 `@media` 裡的縮排)
       ② **我量的那個對象, 是不是全部的對象?**(`7489aada` 那次:分母只有一半)
       兩者都印得出一個乾淨、附了數法、可重跑的結果。
· 員工實際上每天在篩什麼 —— **沒問過任何員工**(§5 就標著, 仍未問)
· `staff` 表現在有幾筆、正式站上有沒有人真的用共用密碼 —— **沒查**
· 片1 的斷言要在拋棄式 PG 上跑(`docs/runbooks/throwaway-postgres-for-migration-verification.md`)
  ⇒ 而該 runbook 自己寫著 **`apply 成功 ≠ 斷言通過`** 與本機效度限制, 照它不放寬
```

📌 相關:`docs/patterns/revoking-function-execute-in-supabase.md`(兩道 REVOKE / 新物件自帶 anon)·
`docs/runbooks/throwaway-postgres-for-migration-verification.md` ·
`supabase/migrations/20260726120000_m4b_e8a1_staff_table.sql`(表的形狀來源)

---
---

# 🔴🔴 §7 codex 關卡1 的結果:**30 條 must-fix,而這份 plan 的地基動了**

> 2026-08-27 線4 自己跑(`codex exec -s read-only`、stdin 導掉 `< /dev/null`、`codex-cli 0.144.1`)。
> 完整 log 在 session scratchpad,**不進 repo**(6,850 行)。
> ⚠️ **零留痕檢查**:跑前後 `git status --porcelain` **有差異,而差異不是 codex 造成的** ——
> 差的三支是**別的窗在這段時間 commit 掉的**(`fdc40cb7` / `93fd3682` / `f4b36ea2`),
> 另一支 `scripts/supplier-config.ts` 是別條線新弄髒的。
> **我的三支檔零變動**(`git status --porcelain | grep -cE 'saved-views-plan|945-submodule|WalletTab.test'`)。
> 📌 **八窗共用一棵樹時,「跑前後 status 相同」這個判準本身失效了** ——
>    它把「codex 動了東西」與「別人動了東西」混進同一個 diff。
>    ⇒ **要驗的是【我的檔有沒有變】,不是【整棵樹有沒有變】。** 這一格要回報主視窗修判準。

## 7-1 ✅ 已直接訂正的三個**事實錯誤**(不是判斷分歧,是我寫錯)

```
① `parseOrderListView()` **不存在** —— 真名 `parseOrderListSearchParams()`(order-list-view.ts:382)
   `grep -rn parseOrderListView apps/ packages/` ⇒ 0
   🔴 而它就寫在 §6-2「核心設計決定」那一句上。
② `pickEnum` / `pickEnumMulti` 實作在 `lib/shared/list-params.ts:15` / `:33`,
   我引的 `order-filter-chips.tsx:126-127` 只是一段**描述性註解**。
③ 🔴🔴 **「9 個 URL 參數」是錯的** —— repo 裡本來就有 `ORDER_LIST_URL_KEYS`(:701),**11 個**,
   多的兩個是 `ORDER_PANEL_PARAM` / `CUSTOMER_PANEL_PARAM`(面板開在哪一筆)。
   ⇒ 「原樣存整段 query」會把**面板狀態**一起存進去 ⇒ 點開檢視會重開一個舊面板、顯示過期內容。
```

### 🔴 7-1a ③ 那一格是**今天同一個病的第四次**,而這一次最難看

```
第 1 次 wallet.css   `^\.` 錨第 0 欄 ⇒ 看不見 @media 裡的縮排 ⇒ 把對的 35 改成錯的 34
第 2 次 --c-text-muted 的數法**把自己寫進被搜的目錄** ⇒ 印 1 而結論是 0
第 3 次 「唯一讀 design-reference 的測試」附的數法照抄去跑印 12 不是 1
第 4 次 這一格:我數**宣告**,而權威清單組裝在別的地方
```
🔴 **而第 4 次多了一層**:我在 `§6-9` **自己標了這個盲區**,逐字
「若有參數是用別的寫法宣告的,我的尺看不見它 ⇒ **未確認**」。
📌 **我標了未確認,然後把那個未確認的數字當成整片設計的地基用了下去。**
⇒ **標「未確認」不等於處理了它。一個被標記的洞,與一個被填起來的洞,在下一句話裡長得一樣。**
⇒ 判別句再加一條:**我標的那個「未確認」,有沒有東西擋著我在它被填之前繼續往下蓋?**

## 7-2 🔴 這一片的**核心設計要重做**,而不是打補丁

`§6-2`「存整段 query string ⇒ 白名單一份都不用新增」——
**它的前提是「URL 上的東西全都是檢視狀態」,而那個前提是假的**(面板、page、r、rt 都在 URL 上)。

⇒ **正確形狀**:存的不是整段 query,是「**`ORDER_LIST_URL_KEYS` 扣掉 panel 那兩個之後的子集**」
  (清單本體 `apps/admin/src/lib/orders/order-list-view.ts:701-713`;
   panel 兩個 key 的來源 `apps/admin/src/lib/orders/order-return-to.ts`)
⇒ 那就是**一份新的白名單** ⇒ 🔴 **`§6-2` 原本宣稱「不用新增第二份白名單」,那個賣點沒有了。**
⚠️ 而它仍然**比存欄位好**(值的合法性照舊走既有 `pickEnum`;新增的只有「哪些 key 可存」一層)
   ⇒ **設計方向不變,而理由要換、賣點要縮。** 這一段等 §7-4 的題回來再改寫。

## 7-3 🔴 日期那一格:`Q-檢視-2=甲` 的做法**沒有想像中那麼便宜**

```
① 「多存一欄 date_preset」**本身不會重算** —— 交給現有 parser 時**絕對日期優先**
   ⇒ 存 `date_from=2026-08-27` + `date_preset=d0`, 明天照樣得到 8/27
   ⇒ 要真的重算, 讀回來時必須【先丟掉 query 裡的 date_from/date_to】再由 preset 重生
② `date_preset=custom`(員工手選的任意區間)**沒有可重算公式**
   ⇒ plan 未定義「custom 時保留絕對日期」這條規則
③ preset key 日後改名或移除 ⇒ 不是退回過期絕對日期, 就是靜默套預設
   ⇒ **未知 key 要有一個看得見的錯誤**, 而 plan 沒寫
④ 時區:台北 23:59 存、跨午夜後開;或存的人與看的人時區不同
   ⇒ 未指定用**台北 business date** 還是 viewer 的日期
   ⚠️ 而 repo 已有 `taipeiDayStartIso` / `taipeiYmdFromInstantIso`(`@pcm/domain`)
     ⇒ **有現成答案而 plan 沒引用它** ⇒ 實作走那一族, 不自己算
```
⇒ `Q-檢視-2=甲` 的**決定仍然成立**(理由沒被推翻),而**它的成本欄要改寫** ——
   記在這裡,讓明早複核的人看得到差在哪。

## 7-4 🔴 codex 找到**四題我漏開的**,而它們都是 schema 題 ⇒ **當待拍板,我不自己決定**

(它們共同的前提在 `§6-5b`:`Q-檢視-1=乙` + `Q-檢視-3=乙` 造出「沒有主人而大家都看得到」的檢視;
 而 `staff` 那一欄的警語落點 `supabase/migrations/20260726120000_m4b_e8a1_staff_table.sql:28-29`。)

```
Q-檢視-7  **誰可以【建立】共用檢視?**(Q4/5/6 只決定了刪、改、併發)
          👉 共用密碼登入的人(沒有具名身分)按下「存成共用」會怎樣?
Q-檢視-8  私人「今日」與共用「今日」**同時存在**時, UI 怎麼分?
          👉 兩個唯一域各自合法 ⇒ 畫面會出現兩顆同名 chip
Q-檢視-9  **有沒有數量上限?**(每人幾張 / 全站幾張)
          👉 沒有上限 ⇒ chip 列可以被灌成數百筆
Q-檢視-10 **排序(sort_order)誰可以動?** 共用那份誰能拖?兩個人同時拖?
          👉 欄位落點見 `§6-4` 草案的 `sort_order`(而該表已標【不能定稿】)
```
⚠️ 而 codex 另外點出一格**不是題、是既有契約**,plan 必須承接:
```
🔴 `staff` 的離職契約是 `is_active=false`、**不物理刪除**
   (`supabase/migrations/20260726120000_m4b_e8a1_staff_table.sql:27` COMMENT 逐字
    「停用走 is_active=false、不物理刪除」)
   ⇒ **`ON DELETE CASCADE` 這輩子不會觸發** ⇒ 離職員工的私人檢視會永久殘留
   ⇒ 「停用員工的檢視要保留、轉移、還是隱藏」**沒有人問過** ⇒ 併入 Q-檢視-9 一起端
```

## 7-5 其餘 must-fix 的分堆(**逐條都真,而它們屬於實作片、不屬於這份 plan**)

```
schema 形狀(片1 動手前要折):
  · NULLS DISTINCT ⇒ 兩筆同名共用檢視並存 —— codex 說「不該留到實作時才探針」**它對**
    ⇒ 改法:唯一索引改成 `(COALESCE(staff_id,'∅'), btrim(label))` 或加 partial unique index
  · `is_shared` 與 nullable `staff_id` 並存而**沒有 CHECK** ⇒ 四種組合有兩種是壞資料
  · 沒有 touch `updated_at` trigger ⇒ 時間會永久說謊
    (staff 表自己有一支可抄:`20260726120000_m4b_e8a1_staff_table.sql:40-53`)
  · `database.types.ts` 沒有這張表 ⇒ typecheck 會紅 ⇒ **變更清單漏了型別生成那一步**
權限:
  · 直接 GRANT service_role DML ⇒ 任何持 service client 的新程式都繞得過 ownership
    ⇒ codex 提的更窄形狀:**撤表 DML、只開一支集中驗 owner/scope 的 RPC** —— 值得認真考慮
  · `getSessionActor()` 因 staff DB 失敗回 `null` ⇒ **與 fallback/bootstrap 分不開**
    ⇒ 具名員工被誤當共用使用者、**靜默藏掉他自己的私人檢視**
    📌 又是「三種原因印同一個結果」—— 與儲值金那片的 must-fix 同形狀
片界:
  · 片2 少了 `app/orders/page.tsx` 與一支真的讀表的 repository(純函式自己讀不到 DB)
  · 「片1 單獨上線安全」**不成立** —— 它已經把 DML 權交出去了, 不能靠「沒人讀」宣稱安全
  · 片2 先部署而 migration 沒 apply ⇒ 查不存在的表 ⇒ **缺一個 migration-applied 硬 checkpoint**
rollback:
  · down migration **不可以當成另一支正式 migration 附上**(下次依序 apply 會把表刪掉)
    ⇒ 它必須是**人工 runbook**, 不進前進序列
  · `DROP TABLE … CASCADE` 會連後來新增的相依物件一起刪, dump 資料救不回 schema
```

## 7-6 判定與下一步

```
🔴 這一輪 **FAIL**, 而它 FAIL 在【地基】不在【細節】:
   核心設計的前提(URL 上都是檢視狀態)是假的、核心函式名不存在、參數清單數錯。
   三格的落點:`§7-2` / `§7-1`① / `§7-1`③(權威清單 `order-list-view.ts:701-713`)。
⇒ 照 §5 輪次紀律:R1 FAIL ⇒ 折完跑 R2。
⇒ **而「折完」需要 Q-檢視-4~10 共七題的答案, 那些今晚拿不到**(Sean 已休息)。
⇒ **本片停在這裡, 不往下寫。** 硬折出一份「我自己替他答了七題」的 plan,
   交出去的是一個**看起來完整而沒有人拍過板**的東西。
📌 而這正是本片今天最該記住的一句:
   **一份 plan 的價值不在於它多完整, 在於它有沒有把【還沒有人決定的事】留成看得見的洞。**
```
