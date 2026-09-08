# ⟦b4-ZEROREMAININGSHOWSFORM⟧ 帳本未登記額 0 / null 仍顯示登記表單

> 🛑 **誠實標記:本 plan 是【實作之後】補寫的。**
> 骨架來自主視窗 A 的派工訊息(它指定了「先量有幾張單」「修法看起來只是 `< 0` 改 `<= 0`」
> 「而 `null` 那格要一起判」三件), 而**我先做完才落檔** ⇒ **這是偏離 SOP 的**, 寫在這裡不掩蓋。
> 📌 而它為什麼還是留著:**下一個人要的不是我有沒有照順序, 是這片【證到什麼、證不到什麼】。**

## §1 病

後台訂單詳情頁那張「登記退款(現金/匯款)」表單, 由純函式 `shouldShowManualRefundEntry`
(`apps/admin/src/components/orders/manual-refund-entry-gate.ts`)決定出不出現。

```
舊: !(input.refundUnregisteredAmount !== null && input.refundUnregisteredAmount < 0)
    ⇒ 只擋【負數】。而 `0 < 0` 是 false ⇒ **0 放行**;`null` 走 `!(false)` ⇒ **也放行**。
```
而 DB 那端(`20260905280000`):
```
:273-276  v_remaining IS NULL              -> RAISE(fail-closed;逐字「這是**看不到帳本**」)
:277      p_refund_amount > v_remaining    -> RAISE
```
⇒ 📌 **remaining 是 0 或 null 時, 那張表單沒有任何一個他填得出來的值會成功。**

## §2 那個值是什麼(我一度讀錯, 記在這裡)

`refundUnregisteredAmount` ← `getLedgerUnregisteredAmount`(`refund-read.ts:142`)
← RPC `pcm_order_refundable_remaining`。

- **SQL 本體**(`20260820100000:224`)= `o.total − 已退各項` ⇒ **讀起來像「還能退多少」**
- **而 `refund-ledger-view.ts:10-14` 有一條措辭鐵律**逐字寫著**不得**這樣叫它:
  那個值**只反映本系統帳本**, Sean 直接在 TapPay Portal 退的錢不在裡面 ⇒ **真實剩餘可退額 ≤ 此值**。
  ⇒ UI 一律寫「**帳本未登記額**」,「值班照著錯的名字按下去 = 同一筆錢退兩次」。

🎯 **兩個說法都對, 而它們在講不同的事** —— 一個講**算式**, 一個講**這個數涵蓋不到什麼**。
⇒ 數值語意:`remaining = o.total` 是**正常單**;**`remaining = 0` = 帳本已記走全額**
⇒ 📌 **不是「幾乎全部的單」**。⛔ ~~「是【已全退完】的單」~~ —— **2026-09-08 codex R1 駁回, 它是對的**:
那支函式第一段扣的是 `status IN ('processing','confirmed')`(`20260820100000:231-236`)
⇒ **`processing`(還在處理中、尚未確認成功)也一樣佔額**。反例:總額 1000 + 一筆 `processing` 的 1000
⇒ `remaining = 0`, 而那筆錢**還沒確定退出去**。
✅ 正確說法:**帳本已把全額【佔走】**(佔走 ≠ 退成功)。
🎯 **⇒ 「用別人家的詞彙做尺」的第二次** —— 我把一個保守的**佔額**讀成一個已完成的**事實**。

## §3 修法(一處)

```
新: input.refundUnregisteredAmount !== null &&
    input.refundUnregisteredAmount > 0 &&
```
🛑 **這是刻意的行為改變, 而方向寫下來**(否則與 bug 在 diff 上同形):
`null` 從【放行】改成【擋】—— 理由不是「感覺安全」, 是**跟 DB 對齊**。
📌 **兩道閘看同一件事就不會分岔**, 而分岔的代價是員工按下去才知道。

## §4 正式庫讀數 —— **只拿到一半, 兩半都寫**

```
✅ public.orders 全表 ⇒ 4 張單 · 有非卡軌(bank_transfer/cash)⇒ 1 張
   ⇒ 📌 這個缺陷今天最多影響【1 張單】
🛑 那 1 張的 remaining 是多少 ⇒ 量不到
   ERROR: permission denied for function pcm_order_refundable_remaining
   (唯讀角色叫不動 SECURITY DEFINER)
⇒ ⚠️ 我【不知道】今天有沒有單真的踩到 —— 只知道**分母是 1**。那是上界, 不是發生數。
```
🔵 而 `4` 與 `1` 同一發拿到 ⇒ **那把尺是活的**(不是連線失敗印的空);失敗的是第三格之後, 而失敗訊息指名了函式。

## §5 守門 —— **而本片最重要的讀數是一個【全綠】**

🔴🔴 我把那道閘改掉之後, `refund-wiring.test.tsx` 既有 **65 格一格都沒紅**。
⛔ ~~成因:那 65 格餵的永遠是正數 ⇒ 那一整維是常數~~ —— **codex R1 駁回, 我的機制解釋是錯的**。
🔬 當場數分佈(`grep -o … | sort | uniq -c`, 不是印象):`877`×6 · `1000`×4 ·
**`null`×1 —— 而那是 `:207` `beforeEach` 的【預設值】** · `0`×1(我加的)· `-1000`×1(`:475`)
⇒ 📌 **那一維不是常數, `null` 甚至是預設。**
✅ **真正的成因**:**在問那張表單的格子【才覆寫】, 而它們一律覆寫成正數**;
其餘用預設 `null` 的格在測別的東西(帳本區塊、狀態列)⇒ 改了它們也不會紅。
🎯 **⇒ 一個正確的觀察(改了沒紅)配上一個錯的機制解釋** —— 而**結論對的時候沒有人查理由**。

補兩層:
```
純函式層  manual-refund-entry-gate.test.ts(新檔, 7 格)
          四個 bucket:正數✅顯示 / 0⛔ / null⛔ / 負⛔
          + 三個既有條件的防回歸(帳本閘紅 / 收款讀不到 / 純刷卡單)
接線層    refund-wiring.test.tsx +1 格 —— 整頁渲染, remaining=0 ⇒ 表單不出現
          (問的是【那個值真的接到那道閘上】, 純函式層問不到)
```

## §6 突變(兩層三發, 每發只退一處)

```
M0(不突變, 兩支)      rc=0 · Test Files 2 · Tests 73 passed
L1a 純函式 `> 0` 退回 `>= 0`      餵1 → 1 紅 /7    rc=1 ✅ 被殺死
L1b 純函式 拿掉 `!== null`        餵1 → 0 紅 /7    rc=0 🛑 **存活**
L2  接線   route 查詢寫死 1000    餵1 → 5 紅 /66   rc=1 ✅ 被殺死
收尾 還原後回到 M0(73 passed), 每發比 sha256 對上
```

### §6-1 🔴 L1b 那發存活, 而追下去的結論是【守它的不是測試】

`null > 0` 在 JS 是 `false` ⇒ 下一行自己就把 null 擋掉了 ⇒ 看起來那行是**冗餘的**。
🛑 **而同一發跑 `typecheck` ⇒ 紅**:`TS18047: 'input.refundUnregisteredAmount' is possibly 'null'`。
🎯 ⇒ **突變存活不等於沒有東西在守它 —— 要問的是「守它的是【哪一把尺】」。**
⇒ 那行留著:價值是**型別上的必要 + 意圖顯式**, 不是行為上多擋了什麼。(結論寫進碼註解。)

### §6-2 🔴 而同一發還撞出一個【我自己的真錯誤】

新測試檔第一版的 `import type { PaymentListData }` 我**猜了路徑**(`../../lib/payment/payment-read`)
⇒ **vitest 7 格全綠**(它不做型別解析)⇒ 只有 `typecheck` 紅(`TS2307 Cannot find module`)。
📌 **一個壞掉的 type-only import, 在測試那把尺上是看不見的。**
✅ 修法 = **抄受測檔第 1 行**(`from './payment-list'`), 不猜。

## §7 這一片的天花板

> **本片證的是【給定那個值, 表單該不該出現】, 沒證【那個值本身對不對】。**

那個值來自 `pcm_order_refundable_remaining`, 而它**只反映本系統帳本** ——
Sean 在 TapPay Portal 直接退的錢不在裡面。⇒ 一張「帳本說還能退 1000 而實際已退光」的單,
本片**照樣會顯示表單**, 而那是 `refund-ledger-view.ts` 那條措辭鐵律在管的事, 不是本片。

連帶沒做:①沒開真瀏覽器 ②**那 1 張單的 remaining 是多少, 我量不到**(權限)。

## §8 而第三件我【查了】—— 而結論是「不要照搬」

🔴 `refundUnregisteredAmount` 有**第二個消費者**:`refund-entry-gate.ts:108`(TapPay 卡片退款那道閘)
—— 而它那一行與我改掉的那一行**逐字一模一樣**:
```
!(input.refundUnregisteredAmount !== null && input.refundUnregisteredAmount < 0) &&
```
🛑 **而我沒有照搬修法過去, 理由是【意圖不同】** —— 那道閘同一行上面的註解逐字寫著:
> 負值 = 帳本登記已超過訂單總額(對帳異常)⇒ 區塊明寫「勿再發起」, 入口不能還亮著

⇒ 📌 **它擋的是【對帳異常】, 不是【DB 會拒的值】。**

🔬 **而這個判斷是量過的, 不是憑註解相信的**:
```
卡片那支 RPC(admin_initiate_order_refund, 最新代 20260812170000:480)
  grep -c 'pcm_order_refundable_remaining' <該檔> ⇒ 0
  🟢 正對照 同尺打 'admin_initiate_order_refund' ⇒ 26  (⇒ 那個 0 是真的 0)
全 repo 非測試檔的真呼叫點只有一處:refund-read.ts:144
refund-entry-gate.ts:28 檔內逐字:「pcm_order_refundable_remaining() 是**顯示用函式**,
                                   沒有任何 trigger 讀它。」
```
⇒ ✅ **卡片那條路根本不拿這個值當上限**(它的上限是 TapPay 的 Record 剩餘額)
⇒ **`remaining = 0` 對它零意義 ⇒ 它沒有本片的病 ⇒ 不改。**

🎯 **而這一格值得帶走的是**:**兩行逐字相同的碼, 可以有兩個不同的意圖** ——
而「看起來一樣所以一起修」正是**把一個正確的修法用在它沒涵蓋的那一項**。
📌 判別法不是讀那一行, 是問**它擋的那個世界是誰定義的**:
我這道的對面是 **DB 的 RAISE**;它那道的對面是 **同一頁上的一段紅字**。


---

## §9 codex 對抗審查 R1(鐵則 12① 錢, commit 前, 不 push)

**指令形狀** `codex exec -s read-only --disable apps -m gpt-6-astra "$(cat <prompt>)" < /dev/null`
**log** `scratchpad/codex-zero.log`(7,296 行)· **model 回聲** `gpt-6-astra` ·
🟢 `mcp: codex_apps` ⇒ **0**(只能讀成「**本發**沒經連接器碰正式庫」)· `status 4xx` ⇒ **0**
🔬 特徵字回聲 `ZEROREMAININGSHOWSFORM` 27 · `refundUnregisteredAmount` 74
✅ **本發的負對照【沒有寫進 prompt】** —— 上一片踩過(現造的字串被我寫進說明 ⇒ 它在 log 裡命中 3)。
codex 自報四支受審檔前後 SHA-256 全部一致且符合我給的雜湊。

### §9-1 唯一那條 must-fix ⇒ **成立, 而且【比它說的更糟】** ⇒ 開列, 不自己拍

> codex:`gate.ts:250` — 全額登記已提交但 RPC 回應遺失 → 失敗分支重取頁面
> (`manual-refund-actions.ts:139`), 餘額 0 使原表單、請求鍵及重試提示一起消失 — must-fix

**我開檔複核, 而 `:139` 那一行是關鍵**:失敗分支呼叫 `revalidateOrderViews(...)`
⇒ **頁面 server 資料當場重取**(不用等員工重新整理)⇒ `remaining` 已是 0 ⇒ 新閘讓
`ManualRefundEntrySection` **整個不渲染**。
🛑 **而失敗訊息住在那個元件的 `useActionState` state 裡** ⇒ 元件卸載 ⇒ **訊息跟著消失**
⇒ 📌 **他按下送出、畫面刷新、表單不見了、沒有任何一句話告訴他發生什麼事。**

🔴🔴 **這條真正的份量**:原病是「表單在而送不出去」⇒ **員工會抱怨**;
新病是「表單不見而沒有訊息」⇒ **他可能以為沒成功, 然後用別的方式再退一次錢給客人**。
🎯 ⇒ **我把一個【會抱怨的錯】換成了一個【安靜的錯】, 而安靜的那個會變成退兩次。**

🔵 **不是完全零資訊**:下方 `ManualRefundLedgerSection` 會列出那筆已登記的退款
⇒ 他**看得到結果**, 而**看不到「我剛剛那一次」的因果**。「他會不會往下看」是人的行為, 不是機制。

🛑 **修法要人裁(範圍擴張 ⇒ R3), 我不自己拍** ⇒ 開列 `⟦b4-SETTLEDFORMVANISHES⟧`, 兩個方向:
**(甲)** `remaining === 0` 時仍渲染那個元件, 由它顯示**唯讀說明**而非表單(要加 prop)⇒ 正確而是新 UI
**(乙)** 那道閘退回去 ⇒ **等於放棄本片**

### §9-2 五條 nit ⇒ **全部收下**, 而其中兩條是【我的字面錯了】

| # | codex 說的 | 處置 |
|---|---|---|
| N1 | `gate.test.ts:48` 正數只餵 1000 ⇒ 門檻改成「至少 1000」七格仍全過 | ✅ 補 `amount: 1` 邊界格 |
| N2 | `refund-wiring.test.tsx:1556` 缺「非卡收款 + `null`」接線格 | ✅ 補一格(純函式層餵 null 沒真渲染, 上一格餵 0 沒餵 null ⇒ 兩邊各缺一半) |
| **N3** | **我寫「既有測試餵的永遠是正數」與 `:207` 預設 `null`、`:475` 餵 `-1000` 不符** | 🔴 **codex 對。見下** |
| N4 | `gate.ts:290` 註解仍寫「仍然顯示表單」, 與現況矛盾 | ✅ 那是我上一片寫的天花板, 已加訃聞更新 |
| **N5** | **板列把 `remaining=0` 等同「已全退完」不成立 —— SQL 明確包含 `processing`** | 🔴 **codex 對。見 §2 的訃聞** |

### §9-3 🔴 N3 —— 我把【正確的觀察】配了【錯的機制】

我寫的:「改掉閘之後 65 格沒紅 ⇒ 因為那一維是常數」。
🔬 **當場數**(`grep -o … | sort | uniq -c`):`877`×6 · `1000`×4 ·
**`null`×1 —— 而那是 `beforeEach` 的預設** · `0`×1 · `-1000`×1 ⇒ **那一維不是常數。**
✅ **真機制**:**在問那張表單的格子才覆寫, 而它們一律覆寫成正數**;
其餘用預設 `null` 的格在測別的東西 ⇒ 改了也不會紅。
🎯 ⇒ **結論對的時候沒有人查理由** —— 而**抓到它的是換一個角度的審查者, 不是更多格子**。
(這一句我在**三處**寫過:純函式測試檔、wiring 註解、plan §5 ⇒ **三處都加了訃聞**。)

### §9-4 codex 明說它【沒有】做的

未跑 Vitest / typecheck / 瀏覽器 / DB;只做原始碼追查與記憶體探針;未修改任何檔案。
⚠️ 它自陳「上述重試回歸尚未以瀏覽器重現」—— **那條 must-fix 的完整證據鏈仍缺真瀏覽器那一節。**


---

## §10 ⟦b4-SETTLEDFORMVANISHES⟧ —— 主視窗 A 問「甲2 做不做得到」, 答案是**做得到**

A 問的形狀:**「不要在有話要說的時候消失」** —— 不新增 UI, 只改渲染條件。
而它擔心的點是對的:**失敗狀態住在 `useActionState` 裡, 元件卸載就沒了。**

### §10-1 做法:**閘拆兩層, 而拆的位置是「這一格會不會變」**

```
manualRefundEntryEligible(payments, refundUnregisteredFailed)   ← 結構條件, 【不會變】⇒ 留 server 擋
manualRefundLedgerSettled(refundUnregisteredAmount)             ← 金額,     【送出後會變】⇒ 下放給 client
元件內:  if (ledgerSettled && !failed) return null;
```
🎯 **判準 = 「這一格會不會在送出之後改變」** —— 會變的那格留在 server,
就會在**有話要說的那一刻**把元件卸載掉, 而訊息跟著走。

🔵 **而結構條件刻意【不】下放** —— 否則每一張訂單頁都會掛載那個 client 元件
(它有 `useRouter()` 與 `pageshow` listener)。**只有結構上該有入口的單才掛載。**
✅ **冪等重試也一起救回來**:表單留著 ⇒ `requestToken` 留著
⇒ DB 的 `UNIQUE (order_id, request_id)` 重送叫得到。

### §10-2 而 A 提的另一案(拿掉 `revalidateOrderViews`)⇒ **判不要**

那個 revalidate 的用途是讓**下面的已登記列表**更新。拿掉它 ⇒ 在「成功但顯示失敗」那個情境下,
**員工連那筆都看不到** ⇒ **比現在更糟**。

### §10-3 🔴 而做這片時一發突變【存活】, 它指出的洞比它本身大

```
拿掉 manualRefundEntryEligible 的 rail 條件(純刷卡單也拿到入口)⇒ 75 格全綠
🛑 成因:當時沒有一格在測那支新函式 —— 測試檔還在打舊的 shouldShowManualRefundEntry
   而【渲染點早就不叫它了】
🔬 當場 grep:shouldShowManualRefundEntry 非測試檔命中 0(🟢 正對照 新那支命中 3)
```
🎯 ⇒ 📌 **一支函式被繞過之後, 它的測試不會變紅 —— 它們會【繼續全綠】。**
⇒ 刪掉那支死函式;測試改成**直接打兩支新的**(不透過合成的 helper ——
**中間那層合成正是上次藏起洞的地方**)。**重跑那發突變:0 紅 ⇒ 2 紅。**

### §10-4 🔬 而 type 那把尺又抓到我一次(**同型第三次**)

加 `ledgerSettled` 這個**必填** prop 之後, 元件測試檔三格都沒傳
⇒ **vitest 78 格全綠**, 只有 `typecheck` 紅(`TS2741 Property 'ledgerSettled' is missing`)。
```
第一次  猜錯的 type-only import 路徑 ⇒ TS2307, vitest 7 格全綠
第二次  拿掉 `!== null` 那道         ⇒ TS18047, vitest 7 格全綠
第三次  必填 prop 沒傳               ⇒ TS2741,  vitest 78 格全綠
```
🎯 ⇒ **三次都是同一句:【測試那把尺看不見型別層的洞】。**
📌 而三次都不是我想到要去查 —— **前兩次是突變逼出來的, 第三次是三綠流程逼出來的。**

### §10-5 突變(三層四發, 每發只退一處)

```
M0(三支)                                        rc=0 · 81 passed
L1 元件  拿掉 `&& !failed`(有話要說也隱藏)      → 1 紅 /6   ✅ 被殺死  ← 這一片的本體
L2 元件  整條隱藏拿掉(結清也顯示 = 回到原病)    → 1 紅 /6   ✅ 被殺死
L3 接線  ledgerSettled 寫死 false(值沒接上)     → 2 紅 /67  ✅ 被殺死
L4 結構閘 rail 條件拿掉                          → 🛑 存活 ⇒ 補測試後 **2 紅** ✅
每發還原後比 sha256 對上
```
