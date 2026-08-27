# Plan · 可存的自訂檢視(`#1` 看今天要處理什麼 · ⓒ 階)

> # 🛑🛑 **這份 spec 的核心設計(`§6-2`)是【收在半路】的 —— 六條 finding 一條都沒修。**
> **用它之前先讀 `§11`**(在檔尾)。兩條打在設計上:選甲的唯一理由有反例(`den`)、
> 那段推導碼照抄進 repo 會 tsc 紅且型別層零保護。
>
> 🔴 **為什麼這句要放在第一行, 而 `§11` 已經寫得很完整了**:
> 一份 spec 最常見的讀法是**搜一個關鍵字然後跳進去看那一段**, 不是從頭讀
> ⇒ **住在檔尾的警告, 活不過一次 `grep`。**
> ⚠️ 而 `§11` **原文留著、一個字都沒搬** —— 這裡是**加一個入口**, 不是把它移過來:
> **兩處都有 ⇒ 不論從哪裡進來都撞得到。**
>
> 📌 而這一格是被一件事逼出來的:這顆 commit(`1d2914c5`)**已經在 `dev` 上**了 ——
> 我當時把警語只放在 `§11`, 而它擋不住 grep 進來的人。


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

## 🔴 6-2 這一片的核心設計決定(**2026-08-27 第二版;第一版的地基被 codex 證偽**)

> 🛑 **先看這格,再看下面**:第一版的賣點是「**存整段網址 ⇒ 白名單一份都不用新增**」。
> **那個賣點沒有了** —— 它的前提「URL 上的東西全都是檢視狀態」**是假的**
> (`panel` / `customer` 兩個面板 key 就在 `ORDER_LIST_URL_KEYS` 裡;另有 `page` / `r` / `rt`)。
> 📌 **這不是一個取捨題被推翻, 是一個【事實】被推翻 —— 而事實不需要任何人拍板。**
> ⇒ 所以本節由線4 直接重寫(主視窗 2026-08-27 批;`Q-檢視-4/5/6/7` 不擋這一步)。
> ⚠️ **第一版原文不在本檔裡了** —— 我原本寫「保留在 `§7-1`」而那是假的:`§7-1` 記的是
>    **三個事實錯誤**, 不是原文。要看第一版原文:`git show 1d2914c5^:docs/specs/2026-08-25-saved-views-plan.md`。
>    ⚠️ 我上一版寫 `git show <本次 commit>^:…` —— **那是個佔位字面, 沒人回頭填就永遠解析不出**
>    ⇒ 已換成真的 sha(`1d2914c5` = 把 `§6-2` 改成第二版的那一顆)。
>    📌 **我在一份剛因為「指到不存在的東西」而被推翻的文件裡, 又寫了一個指到不存在內容的指標。**

### 6-2-1 兩條路,而它們的差別是【誰來守白名單】—— 而「白名單」有**兩種**

```
🔴 第一版把兩種白名單混成一個詞, 而整個賣點就是靠那個混淆撐起來的:

  值白名單(value)  「payment_status 只能是這五個之一嗎?」
                    落點:`apps/admin/src/lib/shared/list-params.ts:15` `pickEnum` / `:33` `pickEnumMulti`
                    ⇒ 逐值白名單 + 去重 + 空折 undefined

  鍵白名單(key)    「這一段 query 裡, 哪些 key 可以被存進檢視?」
                    ⇒ **repo 裡今天不存在這一份** —— 本片會是第一個需要它的地方
```
```
乙案 存欄位  把 `AdminOrderFilter` 每一軸拆成欄位(或一坨 jsonb)
             ⇒ 讀回來要**重新驗一次每一軸的合法值** ⇒ 那是**第二份【值】白名單**
                (第一份在 `packages/domain/src/order/types.ts:287` + `order-list-view.ts:405-432`)
             ⇒ 兩份值白名單一定會漂, 而漂了之後畫面照樣顯示得出東西 —— 只是篩的東西不一樣

甲案 存網址  把**白名單子集內**的 URL 參數存成一段 query string, 讀回來時丟回既有的
             `parseOrderListSearchParams()`(`apps/admin/src/lib/orders/order-list-view.ts:382`)
             ⚠️ **我第一版把它寫成 `parseOrderListView()` —— 那個函式【不存在】**(codex 抓到)
             ⇒ **值白名單一份都不用新增**(`pickEnum` 那族原樣生效)
             ⇒ 🔴 **而【鍵】白名單要新增一份 —— 這就是第一版丟掉的那個賣點。**
             ⇒ ✅ **本 plan 仍然推薦甲, 而理由縮成一句**:
                **它要新增的是「哪些 key 可存」一層, 而不是「每個值合不合法」一整份。**
                前者的漂移後果 = 少存/多存一軸(看得見);後者 = 篩錯而畫面正常(看不見)。
```
🔴🔴 **上面那句「一個會被發現、一個不會」是【假的】, 而它曾經是我選甲的唯一理由**(審查 R1 給了反例):
```
反例就在要存的那 9 個 key 裡:`den`(列表行距)
  `order-list-view.ts:439`  density: pickEnum(...) ?? ORDER_DENSITY_DEFAULT   ← 缺了就折回預設
  `order-list-view.ts:812`  等於預設時**根本不寫進 URL**
⇒ `den` 漂出鍵白名單 ⇒ 檢視以預設行距開:列在、篩對、零錯誤,
  **而連網址上都看不出少了它。**
⇒ 那句對比的兩側**其實同側** —— 鍵漂掉一樣可以靜靜地錯。
```
✅ **而甲仍然贏, 理由換成一個【量得到】的**:
```
乙 要維護**兩份【值】白名單**(既有那份 + 讀回來時重驗的那份)⇒ 兩份之間會漂, 而沒有東西在比對它們
甲 只多一份**【鍵】分類**, 而它的母體(`ORDER_LIST_URL_KEYS`)**只有一份** ⇒ 沒有第二份可以漂

🔴 而「加一個新 key 會不會被靜靜放行」這件事, **是可以用型別逼紅的**(見 `6-2-2`, 已實測):
   母體長一個 key ⇒ tsc 印 **TS2741「Property 'customer' is missing」** ⇒ **它點名是哪一個 key**
   而乙那側新增一軸時, **沒有任何編譯器會提醒你第二份也要改**。
```
📌 **⇒ 真正的差別不是「看不看得見」, 是【要維護幾份, 以及有沒有東西在替你比對它們】。**
⚠️ 而這個結論**與 `§7-2` 早就獨立寫過的那條同向**(乙要複製一整份值白名單)⇒ 不是靠新理由硬撐。

### 6-2-2 那份鍵白名單長什麼樣 —— **第二版:用【分類表】,不用 filter 推導**

```
權威清單:`apps/admin/src/lib/orders/order-list-view.ts:701-712` `ORDER_LIST_URL_KEYS`(**11 個**)
要扣掉的:`apps/admin/src/lib/orders/order-return-to.ts:47` `ORDER_PANEL_PARAM    = 'panel'`
          `apps/admin/src/lib/orders/order-return-to.ts:60` `CUSTOMER_PANEL_PARAM = 'customer'`
⇒ 可存的 = 11 − 2 = **9**(而這個 9 **不可以寫進程式碼** —— 要寫的是那個分類本身)
```

🔴🔴 **我第一版寫的是 `filter` 推導, 而審查用一發 `tsc --strict` 打穿它, 兩件事:**
```
① 照抄進 repo **當場紅**:`SAVED_VIEW_PANEL_KEYS.includes(k)` ⇒ TS2345
   (`k` 的型別是 11 個 key 的 union, 而 includes 的參數只接 2 個)
② 加 `as readonly string[]` 讓它過之後 ⇒ **`.filter()` 不窄化元素型別**
   ⇒ `panel` 仍然是合法的 SavedKey ⇒ **推導版在型別層【零保護】**
🔴 而它還要 `export` 那個陣列(`:701` 現在**沒有** export), 而 `§6-3` 把那支檔列為「只讀」
   ⇒ **設計與交界清單互相矛盾。**
```

✅ **第二版:用【分類表】—— 而它就在同一支檔往下 20 行,repo 早就有這個形狀:**
```ts
// `order-list-view.ts:721-724` 既有:export type OrderListUrlValues = Record<(typeof ORDER_LIST_URL_KEYS)[number], …>
// 那支檔的註解逐字:「**少一格就 `tsc` 紅** —— 那是本片的整個重點」
type SavedViewKeyKind = 'filter' | 'panel';
const SAVED_VIEW_KEY_KIND: Record<keyof OrderListUrlValues, SavedViewKeyKind> = { … };
const SAVED_VIEW_KEYS = (Object.keys(SAVED_VIEW_KEY_KIND) as (keyof OrderListUrlValues)[])
  .filter((k) => SAVED_VIEW_KEY_KIND[k] === 'filter');
```
📏 **實測(2026-08-27,最小重現跑 `tsc --strict`,正負對照各一發)**:
```
漏一個 key 沒分類 ⇒ **TS2741「Property 'customer' is missing in type … 」** ⇒ **它點名是哪一個 key**
全部分類完       ⇒ rc=0 乾淨通過
🔴 而它**只吃已 export 的型別 `OrderListUrlValues`** ⇒ **不需要 export 那個陣列**
   ⇒ 上面那個「設計與交界清單矛盾」一併消失。
📌 對照第一版那個「長度斷言」的做法:它也會紅, 而錯誤訊息是
   `Type 'false' does not satisfy the constraint 'true'` —— **它不說是哪一個 key**,
   而修它最省事的路就是把新 key 塞進去讓它變綠 = **正是這一段要防的那件事**。
```

🔴🔴 **而我第一版在這一段【犯了它自己要防的那件事】——這一格要留著:**
```
我寫了一整段防「新 key 自動流進去 = 靜默做了一個沒有人做的決定」的字,
而我那個 11−2=9 **含 `den`** —— 而 `den` 是我**同一天自己標記的 `Q-檢視-11`**
(`§8-3` 逐字「判不下來」「取捨題不是事實題」, 至今未備成選項)。
⇒ **那不是未來風險, 我在寫那段話的當下就做了它。**
📌 **規則的第一個適用對象, 是寫它的那一段碼。**
⇒ 動作版:寫完一條「要防 X」的規則之後, **立刻回頭問「我這一片有沒有正在做 X」**。
⚠️ ⇒ 所以 `den` 屬於哪一類 **不由這張分類表默默決定** —— 它是 `Q-檢視-11`, **要人拍**。
   在拍板之前, 分類表裡那一格要寫成一個**會紅的 TODO**, 不是一個預設值。
```


### 6-2-3 🔴 過濾要做在【哪一側】—— 而「讀那一側」這個講法**不夠精確,而最自然的讀法是壞的**

```
寫入時過濾  ⇒ 存進去的乾淨。而它擋不住:①資料庫被人直接改 ②白名單日後【變小】時的舊資料
讀出時過濾  ⇒ **這一道才是承重的那道。** 舊資料、髒資料、手改的資料都在這裡被丟掉
⇒ 兩側都做, 而**寫那側是禮貌, 讀那側是守門**。
📌 若只做一側 ⇒ 做讀那側。**只做寫那側 = 一道對舊資料完全失明的守門。**
```

🔴🔴 **而「讀那一側」要指名是哪一個函式 —— 我上一版沒指名, 而最自然的讀法會失效**(審查 R1 額外抓到):
```
`§6-2` 那句「丟回 `parseOrderListSearchParams()` 重新 parse」會讓人把過濾做進那支函式。
🔴 而 `panel` **不由它讀** —— 我當場開檔驗過:
   `apps/admin/src/lib/orders/order-list-view.ts:531` `export function readOpenPanelOrderId(raw)`
   是**另一支獨立的 export**, 而 `apps/admin/src/app/@panel/orders/page.tsx:7` 直接 import 它、
   餵**原始的 searchParams**。
⇒ **把過濾做進 `parseOrderListSearchParams` ⇒ 面板照樣開。**
✅ **邊界要釘在這裡**:過濾發生在「**存起來的 query → 產生那條 href**」那一步(存檢視這一片自己的碼),
   **不是**在任何既有的 parser 裡。理由:panel 走的是平行路由 slot, 它吃的是網址本身,
   而網址是我們產的 ⇒ **唯一擋得住它的地方, 是我們產網址的那一刻。**
```
⚠️ **丟掉要留痕**:讀到一個不在白名單裡的 key ⇒ **不是靜靜丟**, 至少要有一格測試證明它被丟了
   (否則「檢視存了面板」與「檢視沒存面板」在畫面上長得一樣 —— 又是本 repo 的那個母題)。


### 6-2-4 這次重寫**沒有改變**的東西(逐條寫, 免得下一個人以為全變了)

```
· 仍然存 query string 形狀、仍然丟回 `parseOrderListSearchParams()` ⇒ **值白名單零新增**
· `§6-4` 那張表的【欄位】**不變** —— `query text` 存的還是一段 query string,
  只是那段 query **已經被鍵白名單過濾過**。⇒ 這是一句註解的差別, 不是一欄的差別。
  🔴 **⇒ `Q-檢視-4/5/6/7` 可以【現在就端】, 不必等這份重寫。**(見 `§10-1`)
· 🔴 ~~日期那格(`6-2a`)不受影響 —— 它是值的語意問題, 不是鍵的分類問題~~ **這句是錯的**:
  `§7-3` 是我自己寫的:「要真的重算, 讀回來時**必須先丟掉 query 裡的 `date_from`/`date_to`**」
  ⇒ **那就是一個鍵分類動作。同一份檔自打。**
  ⇒ 正確的說法:日期那格**也在鍵分類的射程內**, 而 `Q-檢視-2` 的 custom 若答「保留絕對日期」
    ⇒ **表會多兩欄** ⇒ 所以 `§10-1` 該寫的是「**那四題與欄位無關, 可以現在端**」,
    **不是「那張表的欄位不會變」**。
```

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
  apps/admin/src/lib/orders/order-list-view.ts `parseOrderListSearchParams`(`:382`)重 parse —— 🔴 只讀
  ⚠️ ~~`parseOrderListView`~~ **那個函式不存在**;`§7-1` 早就宣稱這一格「已直接訂正」並貼了 `grep ⇒ 0` 當證據,
     **而 code 側是 0、plan 側不是** —— 這一行到 2026-08-27 才真的改掉。
     📌 **「已訂正」那句話, 訂正的是我腦裡那一份, 不是檔案裡那一份。**

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

📌 **報交界的規格已搬進正本** ⇒ `docs/runbooks/multi-window-command-workflow.md` 的 **§C-3**
   (四格:哪一支檔 / 加法還是改法 / 有沒有動既有簽名 / 做完會不會再回來;含來源實例)。
   🔴 **本檔不留全文** —— 常載 `~/.claude/rules/00-work-rules.md` §4:同一教訓不寫兩處全文。
   搬家的理由:**plan 會被歸檔,而慣例不會有人回歸檔的 plan 裡找。**
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
> ⇒ **等 `Q-檢視-4/5/6/7` 回來再定稿**(它們決定要不要 `created_by` / `updated_by` / 版本號)。
> ✅ **2026-08-27 更新:「核心設計未定」已經不再是這張表不能定稿的理由之一**(`§6-2` 已重寫)
>    ⇒ 而那次重寫**沒有動到本表任何一欄**(逐條見 `§10-1`)。
> 🔴 **⚠️ 我上一版在這裡寫「剩下的理由【只有】那四題」—— 那是假的**(審查抓到)。還有:
>    · `Q-檢視-10`(`sort_order` 誰能動)**直接針對本表的一欄**
>    · `§7-5` 三條全是表形狀:NULLS DISTINCT 唯一索引 / `is_shared` 與 nullable `staff_id` 缺 CHECK
>      / 缺 `updated_at` trigger
>    📌 **「只有」是一個反例就推翻的字, 而我今天在這份檔裡寫了它兩次**(另一次在 `§6-2` 的天花板段)。
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
  ⇒ ~~**未確認**。實作前要用第二種數法交叉(例如掃 `raw[` 的取用點)。~~
  ✅ **2026-08-27 已填掉, 不必再做**:`§8-2` 的尺B 做完了, 而 `§7-1` ③ 早就訂正過
     —— **那個 9 是錯的, 真值是 `ORDER_LIST_URL_KEYS` 的 11。**
  🔴 **而這裡的舊「9」與 `§6-2-2` 新的「11−2=9」【同數不同義】** ——
     舊的是「我 grep 到 9 個 `_PARAM` 宣告」(錯的分母);新的是「11 個 key 扣掉 2 個 panel」(對的分母)。
     📌 **兩個 9 長得一樣, 而它們一個是 bug 一個是結論** ⇒ 引用前先看它是哪一個。
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

> ✅ **2026-08-27 已重做** —— 見 `§6-2` 第二版(主視窗批;`Q-檢視-4/5/6/7` 不擋這一步)。
> 🔴 **而重做之後這一節不刪** —— 它記著「賣點是怎麼沒有的」, 而 `§6-2` 只記著現在是什麼。
> ⚠️ 下面這段仍然是**這次重寫的規格來源**, 逐條對得回 `§6-2-2` / `§6-2-3`。

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


---
---

# 📏 §8 訂單列表網址上的 key 逐個分類 —— **這是可量的,不是可拍的**
(對象:`apps/admin/src/lib/orders/order-list-view.ts` + `apps/admin/src/lib/orders/order-return-to.ts`)

> 2026-08-27 線4 量。**這一節不需要 Sean**,它是明天折 plan 的地基。
> 量法與三把尺的補洞關係見 `§8-2`;權威清單本體 `order-list-view.ts:701-713`。
> 起因:`§7-1`③ —— 我原本以為「URL 上的東西全都是檢視狀態」,而那是假的。
> ⇒ 那就把**每一個 key 逐個分類**,別再用一個總數當地基。

## 8-1 分類表

| key(字面) | 常數 | 落點 | 類別 | 存不存進檢視 |
|---|---|---|---|---|
| `payment_status` | `PAYMENT_STATUS_PARAM` | `order-list-view.ts` | 篩選 | ✅ 存 |
| `goods_axis` | `GOODS_AXIS_PARAM` | 同上 | 篩選 | ✅ 存 |
| `order_source` | `ORDER_SOURCE_PARAM` | 同上 | 篩選 | ✅ 存 |
| `payment_channel` | `PAYMENT_CHANNEL_PARAM` | 同上 | 篩選 | ✅ 存 |
| `show_unpaid_card` | `SHOW_UNPAID_CARD_PARAM` | 同上 | 篩選 | ✅ 存 |
| `pending` | `PENDING_ONLY_PARAM` | 同上 | 篩選 | ✅ 存 |
| `date_from` | `DATE_FROM_PARAM` | 同上 | 篩選(日期) | ⚠️ 見 `§7-3` |
| `date_to` | `DATE_TO_PARAM` | 同上 | 篩選(日期) | ⚠️ 見 `§7-3` |
| `den` | `ORDER_DENSITY_PARAM` | 同上 | **顯示密度** | ❓ 見 `§8-3` |
| `panel` | `ORDER_PANEL_PARAM` | `order-return-to.ts:47` | **面板開在哪一筆** | ❌ **不存** |
| `customer` | `CUSTOMER_PANEL_PARAM` | `order-return-to.ts:60` | **面板開在哪一位** | ❌ **不存** |
| `page` | (無常數,`raw.page`) | `order-list-view.ts:435` | 分頁位置 | ❌ **不存** |
| `r` | `CANCEL_RESULT_PARAM` / `MANUAL_ORDER_RESULT_PARAM` | `order-return-to.ts` | **一次性結果** | ❌ **不存** |
| `rt` | `CANCEL_REQUEST_TOKEN_PARAM` | 同上 | **一次性 token** | ❌ **不存** |
| `mrid` | `MANUAL_ORDER_REQUEST_ID_PARAM` | 同上 | **一次性 request id** | ❌ **不存** |
| `correct` | **無常數,三處字面** | `order-return-to.ts:37-39` 註解點名 | **一次性模式旗標** | ❌ **不存** |
| `return_to` | `ORDER_RETURN_TO_FIELD` | `order-return-to.ts:70` | 導航目的地 | ❌ **不存** |

⇒ **要存的是 9 個(含日期兩個,而日期另有 `§7-3` 的重算問題)。**
⇒ 🔴 **`ORDER_LIST_URL_KEYS` 那 11 個【不能直接當白名單用】** —— 它裡面有兩個面板 key。

## 8-2 量法(三把尺,而它們互相補洞)

```
尺A 宣告面   grep -hn "^export const .*_PARAM = '" apps/admin/src/lib/orders/*.ts   ⇒ 15 個常數
             ⚠️ 看不見沒有常數的 `page` 與 `correct`
尺B 取用面   grep -oE "raw\.[a-zA-Z_]+|raw\[[A-Za-z_]+\]" …/order-list-view.ts     ⇒ 12 種
             ⚠️ 只涵蓋 parse 那一支, 看不見別的檔在 URL 上放的東西
尺C 組裝面   `ORDER_LIST_URL_KEYS`(order-list-view.ts:701-713)                       ⇒ 11 個
             ⚠️ 它是「連結建構要帶哪些」, 不是「網址上有哪些」—— **兩者不同**
⇒ **三把尺都不完整, 而表上那 17 列是三把合起來 + 逐個開檔核出來的。**
```

### 🔴 8-2a 我在量這張表的時候,又踩了同一個病(**第五次**)

```
我第一版的尺B 是   grep -n "searchParams|raw\[" <檔> | grep -oE "raw\.[a-z_]+|raw\[[A-Z_]+\]"
⇒ 它先用 `grep -n` **過濾行**, 再從留下的行裡抽取用形狀
⇒ 而 `page: parsePage(raw.page)` 那一行**既沒有 `searchParams` 也沒有 `raw[`**
⇒ **它在第一道就被濾掉了, 第二道再怎麼準也抽不到它。**
⇒ 印出來是 11 種, 乾淨、整齊、與 `ORDER_LIST_URL_KEYS` 的 11 完美吻合
   —— 🔴 **兩個錯誤互相印證, 而那個吻合看起來正是「我量對了」的證據。**
📌 **一個兩段式的尺, 第一段的漏會讓第二段的準沒有意義。**
⇒ 尺B 改成不預先過濾行, 直接對全檔抽 ⇒ 12 種(多出 `raw.page`)。
```
📌 這是今天第 5 次同一族(前四次列在 `§7-1a`)。**而這一次的新形狀是:錯得剛好對上另一個錯的數字。**

## 8-3 ❓ 我判不下來的那一格:`den`(顯示密度,`order-list-view.ts:93` 宣告 / `:439` 取用)

```
它是【看的方式】不是【篩什麼】—— 存一個「寬鬆/緊湊」進檢視,語意上說得通也說不通。
甲 存 —— 「我這張檢視就是要用緊湊模式看」
乙 不存 —— 密度是個人偏好, 不該綁在一張(可能共用的)檢視上
🔴 而 `Q-檢視-1=乙`(檢視可以共用)讓這一格**變得重要**:
   存了 ⇒ 別人點你的共用檢視, 他的密度會被你改掉。
⇒ 這是**取捨題不是事實題** ⇒ 併進待拍板清單, 編號 `Q-檢視-11`。
```

## 8-4 這張表自己的天花板

```
· 它涵蓋的是【`/orders` 這一頁】。客戶列表那頁另有一套, 沒量。
· `correct` 這個 key **全樹沒有常數、三處都是字面**
  (`order-return-to.ts:37-39` 的註解自己點名了那三處)
  ⇒ **它日後改名時, 沒有任何一處會編譯紅** ⇒ 這張表也會跟著過期而零訊號。
· 🔴 **而最重要的天花板**:這張表是「今天」的。日後有人加一個新的 URL key,
  **本表不會知道**, 而存檢視的程式會靜默漏掉它(codex 關卡1 的 must-fix 之一)。
  ⇒ 折 plan 時要一併設計一道**「新 key 沒被分類就編譯紅」**的守門,
    否則這張表明天就開始腐爛。
```


---
---

# 📋 §9 `Q-檢視-4/5/6` 三題 × 每個答案對應的 schema —— **他回三個字就能開工**

> 2026-08-27 線4 備。主視窗 `-5b` 交辦形狀:把不需要 Sean 的都做完,只留那三個字。
> 三題的原文在 `§6-5b`;既有表草案在 `§6-4`(該表已標【不能定稿】)。
> 🔴 **三個選項一樣詳細,不挑一個先寫完** —— 那會變成「我推薦這個」的偽裝。
> 每一格的代價寫成**他看得懂的話**(不是「多一個 join」,是「員工刪掉別人的檢視時沒有任何紀錄」)。
> 交辦來源見本檔 `§6-5b`;`is_manager` 的實查見 `§9-0`
> (那一欄的宣告在 `supabase/migrations/20260726120000_m4b_e8a1_staff_table.sql:15`)。

## 9-0 🔴 先訂正一件我昨夜寫錯的:`staff.is_manager` **不是「零程式讀取」**

```
建表 `supabase/migrations/20260726120000_m4b_e8a1_staff_table.sql:28-29` COMMENT 逐字:
  「⚠️ 本欄目前無任何程式讀取、不強制任何權限;…看到此欄不代表權限已生效。」
而 2026-08-27 當場重量(`grep -rn is_manager apps packages supabase`, 排除 node_modules/.next):
  非測試檔命中 **24 行**, 逐個開檔看它們在做什麼:
    `staff-table.tsx:38`        `(row) => (row.is_manager ? '是' : '否')`   ← **顯示**
    `staff-edit-row.tsx:33`     `defaultChecked={staff.is_manager}`         ← **表單預設值**
    `staff-actions.ts:109/174`  `is_manager: parsed.input.isManager`        ← **寫入**
    `audit-field-label.ts:150`  `is_manager: '是不是管理者'`                ← **稽核標籤**
    `staff-repository.ts:22`    `STAFF_COLUMNS = 'id, label, is_manager, …'` ← **查詢欄位**
  🔴 **而做權限判斷的分支:0 個。**
    數法:同一批命中再過濾 `if (` / 三元 / `throw` / `redirect` ⇒ **只剩那一行顯示用的三元**
    負對照:同法查 `is_active` ⇒ `apps/admin/src/lib/staff.ts:144` `if (!row || !row.is_active) return null;`
            ⇒ **尺抓得到真的權限分支** ⇒ 上面那個 0 是真的
```
⇒ **那句 COMMENT 的前半(「無任何程式讀取」)今天是【假的】,後半(「不強制任何權限」)仍然為真。**
⇒ 🔴 **所以正確的說法不是「本片會是第一個讀那一欄的地方」,是:**
   **「本片會是第一個【拿它決定某人能不能做某件事】的地方。」**
   📌 而那才是真正該讓 Sean 知道的那半 —— **一個從來沒有承過重的欄位,第一次承重。**
   ⚠️ 那句 COMMENT 本身要不要訂正 = **動 migration 註解**, 不屬本片, 已列 `§9-4`。

---

## 9-1 `Q-檢視-4` 共用檢視**誰可以刪**

### 甲 任何員工都可以刪
```sql
-- schema 差異:無。§6-4 那張表原樣即可(共用列 staff_id IS NULL)
```
```
要多做的  0
他會看到  任何人都能刪掉任何一張共用檢視
🔴 代價   **員工刪掉別人建的共用檢視時, 沒有任何紀錄** —— 隔天沒有人知道那張檢視去哪了,
         也不知道是誰刪的。而它不會有錯誤訊息, 那張 chip 就是不見了。
```

### 乙 只有建立它的人可以刪(牽動 `§6-4` 那張表;離職契約見 `20260726120000_m4b_e8a1_staff_table.sql:27`)
```sql
ALTER TABLE public.admin_saved_order_views
  ADD COLUMN created_by text NOT NULL REFERENCES public.staff(id);
-- app 層刪除時 WHERE id = $1 AND created_by = <目前這個人>
```
```
要多做的  一欄 created_by + 刪除那條 SQL 多一個條件
他會看到  共用檢視上會出現「這是誰建的」;不是你建的, 刪除鈕點不下去
🔴 代價①  **它與 `Q-檢視-3=乙`(共用那份【沒有主人】)相牴觸** ——
         你選了「沒有主人」, 而這個選項等於把主人加回來(只是換個欄位名)
🔴 代價②  **建立者離職之後, 那張共用檢視【誰都刪不掉】**
         (`staff` 的離職契約是 `is_active=false` **不物理刪除**, 見 `§7-4`)
         ⇒ 它會永遠留在每個人的畫面上
```

### 丙 只有管理者可以刪(依據 `supabase/migrations/20260726120000_m4b_e8a1_staff_table.sql:15` 那一欄)
```sql
-- schema 差異:無(不加欄)
-- 而 app 層刪除前要讀 staff.is_manager 決定放不放行
```
```
要多做的  刪除那條路多讀一次 staff 表 + 一個判斷
他會看到  一般員工看不到共用檢視的刪除鈕;管理者看得到
🔴 代價    **這會是 `is_manager` 這一欄第一次被拿來決定「誰能做什麼」**(見 `§9-0`)——
         在今天之前它只被拿來【顯示】與【編輯】, 從來沒有擋過任何人。
         ⇒ 那一欄現在的值對不對, **沒有任何東西驗過** ——
           它出生時預設 `false`, 而誰被設成 `true` 是靠人手動勾的。
         ⇒ 選這個等於同時做兩件事:定刪除規則 + **讓一個沒承過重的欄位開始承重**。
```

---

## 9-2 `Q-檢視-5` 共用檢視**誰可以改**(改名 / 改條件)

### 甲 任何員工都可以改
```sql
GRANT UPDATE (label, query, sort_order, updated_at)
  ON TABLE public.admin_saved_order_views TO service_role;
-- ⚠️ §6-4 原草案只 GRANT (label, sort_order, updated_at) ⇒ 選甲要把 query 加進去
```
```
要多做的  GRANT 多一欄 + 一個編輯 UI
他會看到  誰都能改任何一張共用檢視的名字與條件
🔴 代價   **A 改完、B 也在改 ⇒ 後寫的贏, 而先寫的那個人不知道自己被蓋掉了**
         ⇒ 這一格會把 `Q-檢視-6` 變成必答題
```

### 乙 不能改,只能刪掉重建
```sql
-- schema 差異:無。而 GRANT 【不】給 label/query 的 UPDATE 權
GRANT SELECT, INSERT, DELETE ON TABLE public.admin_saved_order_views TO service_role;
GRANT UPDATE (sort_order, updated_at) ON TABLE … TO service_role;  -- 只留排序
```
```
要多做的  0(比甲少做)
他會看到  想改一張共用檢視 ⇒ 刪掉再存一張新的
🔴 代價   打錯一個字要重存一次;**而它把 `Q-檢視-6`(兩人同改)整題消掉** ——
         因為根本沒有「改」這個動作。
⚠️ 而它與 `Q-檢視-4` 有連動:**若 4 選丙(只有管理者能刪), 一般員工就【連改都改不了】**
```

### 丙 只有管理者可以改(同上,依據 `20260726120000_m4b_e8a1_staff_table.sql:15`)
```sql
-- schema 差異:同甲(GRANT 要含 query)
-- 而 app 層編輯前讀 staff.is_manager
```
```
要多做的  同甲, 再加一次 is_manager 判斷
他會看到  一般員工看得到共用檢視但改不動
🔴 代價   **同 `§9-1` 丙那一格** —— 讓 `is_manager` 第一次承重(見 `§9-0`)
```

---

## 9-3 `Q-檢視-6` **兩個人同時改**同一張共用檢視會怎樣

> ⚠️ **若 `Q-檢視-5` 選乙(不能改), 本題不成題** —— 沒有「改」就沒有「同時改」。

### 甲 後寫的贏,不提示
```sql
-- schema 差異:無
```
```
要多做的  0
他會看到  什麼都看不到 —— 這正是問題所在
🔴 代價   **A 花三分鐘調好一張檢視, B 在同一分鐘存了他的版本 ⇒ A 的改動消失,
         而 A 的畫面上不會有任何東西告訴他。** 他會以為自己存好了。
📌 而這個選項**不用做任何事就會發生** —— 它是「什麼都不處理」的結果。
   (同 `Q-檢視-2` 的乙那個形狀:**不選它也會發生 ⇒ 它不是選項, 是預設值。**)
```

### 乙 後寫的贏,而畫面告訴他
```sql
-- schema 差異:無(用既有的 updated_at 當版本)
-- app 層:讀出來時記住 updated_at, 存回去時 WHERE updated_at = <讀到的那個>
--         影響列數 = 0 ⇒ 表示別人改過 ⇒ 顯示「這張檢視剛剛被別人改過」
🔴 而 §6-4 草案【沒有】touch trigger ⇒ 選乙必須補一支
   (可抄 `20260726120000_m4b_e8a1_staff_table.sql:40-53` 那支)
```
```
要多做的  一支 trigger + 存檔那條路多一個條件與一個提示
他會看到  「這張檢視剛剛被別人改過, 請重新整理再改一次」
🔴 代價   偶爾要重做一次;而**它是三個裡唯一會讓人知道發生過衝突的**
```

### 丙 擋下來,要他重讀再改
```sql
-- schema 同乙(需要 touch trigger + updated_at 比對)
-- 差別在 app 層:不寫入, 直接擋
```
```
要多做的  同乙
他會看到  存不進去, 畫面要他重新整理
🔴 代價   同乙, 而更煩一點(乙至少存進去了, 丙要他從頭來)
⚠️ 而**它與乙的 schema 完全一樣** ⇒ 這一題選乙或丙, **migration 那一片不用改**,
   差別只在 app 層 ⇒ **可以晚一點再決定, 不擋 schema 開工。**
```

---

## 9-4 這張表沒有處理的

```
· 那句 COMMENT 的前半今天是假的(`§9-0`)⇒ **訂正它要動 migration 註解, 不屬本片**
  ⇒ 已記在這裡, 而**沒有人被指派** —— 它需要一個決定:改註解算不算動 migration
· `Q-檢視-7~11`(誰能建立共用 / 同名怎麼分 / 數量上限 / 排序誰能動 / `den` 存不存)
  **不在本表** —— 它們在 `§7-4` 與 `§8-3`, 而其中兩題會回頭影響這三題
  ⚠️ 特別是 `Q-檢視-7`(誰能建立):若答「只有管理者能建」, 那 `Q-檢視-4/5` 的丙就變得自然
· 三個選項的「要多做的」我**沒有估工時** —— 那要等 schema 定稿才估得準, 標**未確認**
· 🔴 而我**沒有推薦任何一格**, 那是刻意的:三題都是**資料歸屬與權限**, 不是技術選型

---
---

# 📋 §10 `§6-2` 重寫之後,**那四題可以現在就端** —— 而這推翻我兩小時前自己的建議

> 主視窗 2026-08-27 問的那一格逐字:「換成『白名單子集』之後,`§6-4` 那張表的【欄位】會不會變?
> 會變 ⇒ 現在問他就是替一張還會改的表做決定;不會變 ⇒ 那四題可以在重寫的同時就端他,省一輪。」

## 10-1 答案:**不會變。**

```
`§6-4` 那張表存 query 的那一欄是  `query text NOT NULL,  -- 那段 query string(不含 `?`)`
第二版改的是**存進去之前先過濾掉兩個 panel key** ⇒ 存的**還是一段 query string**
⇒ 型別不變、長度上限(2048)不變、CHECK 不變、索引不變
⇒ **差別是那一行註解要改寫成「那段【已被鍵白名單過濾過的】query string」。**
📌 **一句註解的差別, 不是一欄的差別。**
```
⇒ 🔴 **所以我兩小時前那句「現在問他就是替一張還會改的表做決定」是【錯的】。**
   那張表確實還會改 —— 而**改它的是 `Q-檢視-4/5/6/7` 自己**(`created_by` / `updated_by` /
   `staff_id` 可不可以是 NULL / 版本號),**不是這次的重寫**。
   📌 **「這張表還會改」是真的, 而我把改它的【原因】歸錯了對象** ——
      我用一個為真的句子, 推出一個錯的處置。

## 10-2 ⇒ 端他的時候,四題一起端(而不是 4/5/6 先、7 後)

```
本檔 §9 已把 `Q-檢視-4/5/6` 備成「回三個字」的形狀。
🔴 而 `Q-檢視-7`(誰可以【建立】共用檢視)**必須同一批端** —— 本檔自己寫著:
   「若答『只有管理者能建』, 那 `Q-檢視-4/5` 的丙就變得自然」
   ⇒ 分開問 ⇒ 他會為同一件事回兩次, 而第二次會覺得我們沒想清楚。
⚠️ 而 `Q-檢視-7` **還沒有被備成三選一的形狀**(§9 只涵蓋 4/5/6)⇒ 那是端出去之前要補的一格。
```

## 10-3 而這次重寫**沒有**動到的、仍然卡著的

```
· `Q-檢視-8/9/10/11`(同名怎麼分 / 數量上限 / 排序誰能動 / `den` 存不存)⇒ 仍未備成選項
· `§6-4` 那張表**仍然不能定稿** —— 而理由**只剩** `Q-檢視-4/5/6/7`, 不再包含「核心設計未定」
· `6-2a` 日期那格 ⇒ `Q-檢視-2=甲` 已拍, 而 `§7-3` 列的四個成本(custom 無公式 / 未知 preset key /
  時區 / 絕對日期優先)**仍然一條都沒解** ⇒ 它們是實作片的題, 不是拍板題
· 🔴 `6-2-2` 那個「加 key 要逼出一個決定」的甲乙兩案 ⇒ **我傾向甲, 而它屬實作片、不需要 Sean**
```

## 10-4 這次重寫自己的射程

```
· 它是**純 spec**:零 code 改動、零 migration、零 `.github/`
· 🔴 它**沒有被任何東西驗過** —— 沒有測試、沒有實作、沒有突變。
  它的正確性目前只靠:①`ORDER_LIST_URL_KEYS` 當場數 = 11 ②panel 兩個 key 的落點當場開檔確認
  ③`parseOrderListSearchParams` / `pickEnum` 的落點沿用 codex R1 已訂正過的那三個
  ⇒ **其餘都是設計論證, 而設計論證不會紅。**
· 而 `6-2-1` 那個「兩種白名單」的區分**是我這次新造的**, 沒有前例可對
  ⇒ 它若是錯的, 錯法會是:**「鍵白名單漂掉會被發現」這句話不成立** ——
    而要證偽它只要舉出一個「鍵漂掉而畫面正常」的例子。**我沒有試著舉。**
```

---

# ✅ §11 `§6-2` 第二版的 `code-reviewer` R1 = **FAIL** —— **六條 2026-08-27 已全修**

> 🔴 **本節原本的標題是「而下面這些一條都還沒修」** —— 那是 `1d2914c5`(存檔優先)當下的狀態。
> **已修的落點逐條**:①`§6-2-1` 選甲理由換掉 ②`§6-2-2` 改用分類表(附 tsc 實測)
> ③`§6-3` 假函式名 ④檔頭佔位字面換成真 sha ⑤`§6-4`「只有那四題」訂正
> ⑥`§6-9` 舊的 9 標退場 ⑦`§6-2-3` 邊界釘死 ⑧`§10-1`/`6-2-4` 日期自打訂正
> ⚠️ **而原文一條都沒刪** —— 下面每一條旁邊都留著「我當時寫的是什麼」。
> 📌 **理由:這一節的用途不是清單, 是【看得出我當時為什麼覺得那樣是對的】。**

> Sean 2026-08-27 令全窗存檔 ⇒ **這一版是【收在半路】的**,不是交付狀態。
> 🔴 **接手的人:先讀完本節再用 `§6-2`。** 它現在的字面有六條被證偽/自打的地方。

## 11-1 🔴 兩條打在【設計】上,不是措辭

```
① `6-2-1` 那句「鍵白名單漂掉會被發現、值白名單漂掉不會」——**唯一的選甲理由, 而反例就在被存的 9 個 key 裡**
   `order-list-view.ts:439` `density: pickEnum(...) ?? ORDER_DENSITY_DEFAULT`
   ⇒ `den` 漂出鍵白名單 ⇒ 檢視以預設行距開:列在、篩對、零錯誤, **只有行距不同**
   而 `:812-814` 讓 `den` 等於預設時**根本不出現在 href** ⇒ **連網址上都看不出少了它**
   ⇒ **那句對比的兩側其實同側** ⇒ 選甲的結論可能仍成立(乙要複製整份值白名單, `§7-2` 已獨立寫過),
     **而那句話必須換掉, 不能當唯一理由。**
② `6-2-2` 那段推導碼**照抄進 repo 會 tsc 紅**(審查實跑 `tsc --strict`):
   `SAVED_VIEW_PANEL_KEYS.includes(k)` ⇒ TS2345。而加 `as readonly string[]` 讓它過之後,
   `.filter()` **不窄化元素型別** ⇒ `panel` 仍是合法的 SavedKey ⇒ **推導版在型別層零保護。**
   🔴 而 `ORDER_LIST_URL_KEYS`(`order-list-view.ts:701`)**沒有 export** ⇒ 推導版要先改那支檔,
     而 `§6-3` 把它列為「只讀」、線1 承諾「下完就離開該檔」⇒ **設計與交界清單互相矛盾。**
🔴 ⇒ **更簡單的做法就在同一支檔往下 20 行**:`order-list-view.ts:721-724` 已有
   `Record<(typeof ORDER_LIST_URL_KEYS)[number], …>`, 註解逐字「少一格就 tsc 紅 —— 那是本片的整個重點」。
   ⇒ 一張 `Record<key, 'filter'|'panel'>` 分類表同時當白名單與守門, **不必 filter、不必長度斷言**,
     而審查實跑它紅得更有用:TS2741 **點名是哪個 key**(甲案只印 `'false' does not satisfy 'true'`)。
```

## 11-2 🔴 而 `6-2-2` 當場靜默拍掉了一個我自己標記過的待拍板題

```
11−2=9 **含 `den`**, 而 `§8-3` 是同一天我自己寫的:`den` 判不下來、「取捨題不是事實題」、
已編號 `Q-檢視-11`;`§10-3` 再確認它仍未備成選項。
⇒ **那個「自動流進去 = 靜默做了一個沒有人做的決定」不是未來風險, 今天就發生了** ——
  而踩的是**我自己幾小時前標記的那一題**。
📌 我寫了一段防它的字, 然後在同一段裡犯了它。
```

## 11-3 四條機械的(可一次改完,而現在都還在)

```
· `§6-3` 逐字還寫著假函式名 `parseOrderListView` —— 而 `§7-1` 宣稱它「已直接訂正」並貼了 grep ⇒ 0 當證據
  ⇒ **code 側是 0, plan 側不是。**
· `§6-2` 檔頭我寫 `git show <本次 commit>^:…` —— **這是個佔位字面, 沒人回頭填就永遠解析不出**
  ⇒ 今天可用的是 `git show HEAD:docs/specs/2026-08-25-saved-views-plan.md`
  📌 **在一段自陳「我又寫了一個指到不存在內容的指標」的話裡, 我又留了一個。**
· `§6-4` 我寫「不能定稿的理由**只有**那四題」⇒ 假:`Q-檢視-10` 直接針對本表的 `sort_order`,
  而 `§7-5` 三條(NULLS DISTINCT 唯一索引 / `is_shared` 與 nullable `staff_id` 缺 CHECK / 缺 `updated_at` trigger)全是表形狀
· `§6-9` 還在寫「那 9 個參數…未確認…實作前要用第二種數法交叉」⇒ `§8-2` 的尺B 已經做完了,
  而那個舊的 9 與 `6-2-2` 新的 `11−2=9` **同數不同義**, 讀者分不出來
```

## 11-4 而 `§10-1` 的**動作對、理由不成立**

```
我寫「日期那格不受影響 —— 它是值的語意問題, 不是鍵的分類問題」
而 `§7-3` 是我自己寫的:「要真的重算, 讀回來時必須**先丟掉 query 裡的 date_from/date_to**」
⇒ **那就是一個鍵分類動作。同檔自打。**
⇒ `§10-1` 該寫的是「**那四題與欄位無關, 可以現在端**」, **不能寫「那張表的欄位不會變」**
  (`Q-檢視-2` 的 custom 若答「保留絕對日期」⇒ 表就多兩欄)。
✅ **而「現在可以端那四題」這個結論本身仍然成立** —— 審查核過那段推理。
```

## 11-5 額外一條,審查沒被點名而它自己撞到的

```
🔴 `6-2-3` 說「過濾要做在讀那一側」而**沒有指出是哪一側, 而最自然的讀法是壞的**:
   `panel` **不由** `parseOrderListSearchParams` 讀 —— 它在平行路由 slot
   `apps/admin/src/app/@panel/orders/page.tsx:56` `readOpenPanelOrderId(raw)` 直接吃 raw searchParams
   ⇒ 照 `§6-2` 那句「丟回 parseOrderListSearchParams()」把過濾做進那支函式 ⇒ **面板照樣開。**
   ⇒ 過濾必須發生在「存的 query → href」那一步, `6-2-3` 要把這個邊界寫死。
```
