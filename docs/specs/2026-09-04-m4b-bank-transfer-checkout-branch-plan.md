# Plan v2 · 段 1-C:結帳分岔出「匯款」那條路(建單, 不扣款)

> 🔴 **v2 = 照 codex 關卡1(`gpt-5.6-sol`, `-s read-only`)11 must-fix + 1 nit 重寫。**
> ⛔ ~~v1 寫「在 prime 那一格【之前】分岔」~~ ⇒ **作廢, 而理由在 §1**。
>    舊字面留著加刪除線, 讓搜「prime 之前分岔」的人同一發撞到訂正。
> 🔴 **片型 = 高風險片**(鐵則 12①【錢】)⇒ 全 9 步、對抗審查不降級。
> 🔵 **L1**(付款方式是結構不是內容)。**授權**:Sean 2026-09-04「匯款這整條路 ⇒ 甲 要」。
> 🔵 **f0 2026-09-04 裁「甲」**:照 11 條重寫、再審一輪, **上限 2 輪**。

---

## 0. 為什麼要這一片 —— 一句話, 而它是量到的

```
🔬 charge-actions.ts:180-183  prime safeParse 失敗 ⇒ return '付款資訊缺失,請重新進行刷卡'
🔬 而它在 placeOrder(:318)【之前】、【零分支】;placeOrder 全顧客站只有這一個呼叫點
```
🎯 **⇒ 選了匯款的人沒有卡 ⇒ 沒有 prime ⇒ 在建單之前被擋, 而畫面叫他去刷卡。**
📌 **⇒ 缺的不是一個 radio, 是那條路的【分岔】。**

---

## 1. 🔴🔴 v1 錯在哪(codex 最利的那一條, 我核過, 它對)

```
⛔ v1:「在 prime(:180)之前 early return」
🔬 而共用的安全邊界【散在 prime 的兩側】:
     :187-190  cartSessionId(uuid fail-closed)      ← prime 之【後】
     :199-200  agreed 條款(唯一權威守門, 非縱深)     ← prime 之【後】
     :266-276  同意來源 IP/UA(#241 舉證)            ← prime 之【後】, 且在 try 內
🛑 ⇒ v1 的形狀會讓匯款【整批跳過】那三段。
```
### ✅ v2 的形狀 —— **共用段全部跑完, 只在最後一行決定要不要 charge**
```
① 登入 gate                    :129        共用
② checkout zod(含 paymentChannel :163)   共用    ← 段 1-B 已接
③ lines zod                    :174-177    共用
④ 🔴 prime                     :180-183    **唯一改成有條件的一格**(只有刷卡驗)
⑤ cartSessionId                :187-190    共用
⑥ agreed                       :199-200    共用
── try {
⑦ buildCardholder              :204-243    共用(見 §1a)
⑧ sibling 反查                              🔴 **本片唯一新增的一段**(見 §4)
⑨ IP/UA                        :266-276    共用
⑩ placeOrder                   :318        共用
⑪ findTotal read-back          :321-323    共用
⑫ payment_channel read-back    :348-356    共用(段 1-B 已上)
── 🔴 **分岔在這裡, 而它是最後一行**:
      bank_transfer ⇒ return { pendingTransfer: true, displayId }
      tappay        ⇒ 現況 3DS(:359+)/ 同步扣款, 一個字不動
── } catch :407 ⇒ MSG.generic(共用)
```
📌 **⇒ 改動總量 = 一格條件 + 一段新反查 + 一個 return。其餘零位移。**

### §1a 為什麼 buildCardholder 也留在共用段(而它是「卡片」的東西)
```
🔬 它失敗時回的三句逐字::561 '請重新選擇收件地址' / :563 '收件地址缺少手機號碼…' / :565 '會員資料缺少姓名…'
⇒ 🎯 **三句都是【出貨要的】, 不是刷卡要的** ⇒ 匯款單一樣需要地址完整
⇒ ✅ 留著 = 共用段真的共用(§8 的突變才證得成)+ 最小 diff
⚠️ 代價:匯款多一次 customers/addresses 讀。**已知、接受**, 不是漏看。
```

---

## 2. 要改什麼(檔案清單;v1 漏了第 4 支, codex 抓到)

| # | 檔 | 改什麼 |
|---|---|---|
| 1 | `app/checkout/charge-actions.ts` | ④ 改條件式;⑧ 新增 sibling 反查;結尾分岔;型別加變體 |
| 2 | `hooks/useChargePayment.tsx` | 收 `pendingTransfer`(排在 `ok` **之前**);`status` union 加一格 |
| 3 | `components/CheckoutView.tsx` | `:194` 寫死的 `'tappay' as const` ⇒ 讀真的選擇;`:202` 卡片驗證與 getPrime 改成只在刷卡跑 |
| 4 | 🔴 `components/CheckoutTerminalScreen.tsx` | `:29-40` `FULL_PAGE_BY_STATUS` 是 `satisfies Record<ChargeState['status'], boolean>` ⇒ **加 status 不補這裡 tsc 直接紅** ⇒ 必須列進清單 |
| 5 | `components/CheckoutStep2.tsx` | 解除 ATM 選項隱藏(照稿搬, 見 §6) |
| 6 | `lib/checkout/validate-checkout-payment.ts` | 匯款時不驗卡欄 |

🔵 `packages/` 一支都不動(段 1-B 已把 `paymentChannel` 一路接到 RPC)。

### 🔴 而 codex 這一條指出「client 先擋死」—— 它是對的
```
🔬 CheckoutView:194  validateNonCardFields({… paymentChannel: 'tappay' as const })
🔬 CheckoutView:202  validateTapPayFields(…) **無條件求值**
🔬 CheckoutView:208  !validation.valid || !cardResult.valid ⇒ return, 且註解逐字寫
                     「getPrime / chargePaymentAction 一律 0 次」
⇒ 🛑 **只改 server 那半 ⇒ 匯款根本到不了 server** ⇒ 兩半必須同一片交(鐵則 3)。
```

---

## 3. 匯款那條回傳什麼形狀

```
🛑 不能回扣款結果(沒有扣款) 🛑 不能沿用 { ok:true }(client 會送他去完成頁)
🛑 不能進 payment:'unknown' 死路
```
✅ **與 `redirect` 平行的頂層變體**:`| { pendingTransfer: true; displayId: string }`

🔵 **不放進 `payment` union 的理由**:那個 union 每一格都是**扣款結果**, 而這一格沒有扣款發生;
   放進去等於讓 `satisfies never` 那道窮舉守門**替一個不是扣款結果的東西背書**。
🔵 **client 判斷順序**:`redirect` → **`pendingTransfer`** → `ok` → `switch(payment)`。
🔵 **nit(codex 說我理由錯結論對, 我核過, 他對)**:`pendingTransfer` 沒有 `ok` 欄 ⇒ `'ok' in res`
   本來就吃不到它。⇒ 🎯 **真風險不是被吃掉, 是【漏寫 handler】一路掉進 validation fallback**
   ⇒ ✅ 所以守門不是「排在 ok 前面」, 是 **hook 的 status union 加一格 ⇒ TerminalScreen 那張表 tsc 會紅**。

### 🔴 而清不清購物車(v1 沒決定, codex 抓到)⇒ **清, 而且 regenerate cart session**
```
✅ 理由:與 paid 那條逐字同款(hook 既有 clear + regenerateCartSession)
🎯 而它同時是【匯款重複下單】最有效的一道 —— 車空了就送不出第二張
🛑 而代價要明寫:客人回不到結帳頁看帳號 ⇒ **必須從訂單頁看得到** ⇒ 那是段 3 的驗收條件, 見 §5
⚠️ 而它**會改變 f0 那一發量測的答案**(見 §4b)—— 我不自己吞掉這句, 端給 f0。
```

---

## 4. 🔴🔴 跨付款方式雙重付款(codex 這一條有錢, 而我量到了修法)

```
🎯 形狀:同一台購物車有一筆進行中的 3DS 刷卡 ⇒ 客人回上一步改選匯款 ⇒ 建第二張單
        ⇒ 而稍後那筆刷卡可能成功 ⇒ **一張刷卡付掉、一張等匯款, 而客人可能也匯了。**
```
### ✅ 修法 = ⑧ 那一段, 而它**重用既有的唯讀反查**, 零新 DB 物件
```
🔬 find_active_sibling_own(20260820020000_…_cancel_guard_sibling_dedup.sql:336-337)逐字:
     AND (o.payment_status = 'paid' OR a.id IS NOT NULL)
     -- a = payment_charge_attempts, status IN ('pending','charged')
⇒ ✅ **刷卡在途 ⇒ 有 pending attempt ⇒ 回 'active'** ⇒ 匯款這條看得到它 ⇒ 不建單
```
**匯款路徑的裁決(唯讀, 不 release、不 settle)**:
```
none    ⇒ 建匯款單(往下走)
paid    ⇒ return { ok:true, displayId }        (既有單已付, 顯它;與刷卡那條同款)
active  ⇒ return { ok:false, payment:'processing', message: MSG.settlementRequired }
throw   ⇒ 同上 fail-closed(不建單, 避免孤兒)
```
🛑 **而匯款【不呼叫 preflightReleaseSibling】** —— 那支會 release 兄弟單好讓新的一發去刷;
   匯款不刷卡, release 只會把一張還可能成交的卡片單放掉。⇒ ✅ 只叫 `siblingLookup.lookup()`。

### §4b 🔴 而同一發量測告訴我:**它擋不到 bank→bank**(這是好消息也是壞消息)
```
🔬 同一行條件:匯款單 = unpaid ∧ 無 charge attempt ⇒ **兩個條件都不滿足 ⇒ 回 'none'**
⇒ 🎯 **⇒ 「已經有一張未付款匯款單」這件事, 現有的反查【看不見】**
⇒ ⇒ ✅ 這正好證明 f0 拍的甲/乙分野是對的:乙(真的擋住)確實需要動 DB, 不是隨手可得
⇒ ⇒ 🔵 而 §3 決定「清車 + 換 cart session」之後, 甲(client 鎖)+ 空車 = 今天夠用
```
### §4c 而**同一個盲區還咬第三個地方**(codex 第 6 條, 我核過)
```
🔬 reconcile-actions.ts:81-84  sibling.kind === 'none' ⇒ return { status:'pending' }
⇒ 🛑 匯款單建好而【回應掉了】(關頁/斷網)⇒ 客人重進結帳頁 ⇒ 復原流程回 pending
   ⇒ 他看不到那張已經建好的匯款單。
📌 **⇒ 而這三件(跨管道 / bank→bank / 回應掉了)是【同一個盲區】的三個受詞**:
   `find_active_sibling_own` 用「有沒有 charge attempt」當「有沒有進行中的單」的代理,
   而匯款單結構上沒有 attempt。
```
🔵 **本片不修這個盲區**(修它 = 動那支 SECURITY DEFINER 函式 = 另一片、鐵則 12③)。
✅ **本片做的是**:①把它寫成板上一列 ②§5 的 release gate 讓客人有第二條路看到那張單(訂單頁)。

---

## 5. 🔴 交付閘:**本片不得單獨上 main**(codex 第 7 條)

```
🛑 只上段 1 ⇒ 客人建得出匯款單, 而**畫面上沒有任何一個字告訴他匯去哪**
   🔬 grep -rn 'PCM_REMITTANCE' apps/ ⇒ 0 處(段 2 的常數還沒有消費者)
⇒ ✅ **交付單位 = 段 1 + 段 3 一起上 main**, 而 dev 可以分開收。
⇒ ✅ 而段 3 的驗收多一條(§4c 逼出來的):**訂單頁看得到匯款資訊**, 不是只有結帳完那一頁。
```
🔴 **而部署順序那一條照舊、且它排在最前面**:
```
段 1-A 的 migration 要【先貼進正式庫】, 顧客站那半才可以上 main
⇒ 否則 TS 送 11 個參數名 / DB 只有 10 參 ⇒ PGRST202 ⇒ 結帳整條斷。
```

---

## 6. 🔴🔴 鐵則 1:**稿上【沒有】那一格** —— v2 寫錯了權威, R2 之後自查抓到

```
⛔ ~~v2 原句:「design-reference/components/CheckoutPage.jsx:427-436 的 ATM 區塊照搬」~~ **作廢。**
🔬 結帳頁的真權威 = OD `pcm-home-redesign/checkout-page.html`
   來源逐字:docs/reviews/2026-08-06-checkout-batch5-recon.md:5
   「真權威 = OD pcm-home-redesign/pcm-checkout.css + checkout-page.html + checkout-page-handoff.md」
🔬 而 2026-08-29 Sean 拍板把版面權威從 design-reference 換成 pcm-home-redesign
   (`apps/storefront/src/components/account/tabs/OrdersTab.tsx:3-5` 記著那筆拍板)
🔬 而那支稿的付款方式區(:409-437):`.co-pay-list` 底下**只有一個** `.co-pay` =「信用卡付款」,
   radio 還是 `checked readonly`。掃「匯款/ATM/轉帳/分行/戶名」⇒ **0 命中**(分母 = top-level 58 支)
```
🎯 **⇒ 「照稿搬」這個動作今天做不了 —— 稿上沒有這個東西。**
🛑 **⇒ 而這不是我能拍的**:要嘛 Design 畫一格, 要嘛 Sean 授權自畫。決策題已端(見 mailbox)。
📌 **⇒ 我引到的那份剛好是【被取代的舊權威】, 而它是唯一有 ATM 的那一份。**

### 而 5 天那筆拍板不受影響(它講的是文案不是版型):
```
稿逐字   :「下單後 3 個工作天內未繳款,訂單自動取消」
Sean 拍板:「A: 甲 5 天(改稿上那句)」(2026-09-04 本人打字)
🔬 而碼那一半已經是 5 天:20260903080000 migration 逐字 interval '5 days'
```
✅ **括號裡那四個字就是授權** ⇒ 元件寫 5 天。
🔴 **而【改稿】不是本線做** ⇒ 落一列板給 Design 線。
🛑 **而兩者不等價**:工作天遇週末比 5 天長 ⇒ 稿留著那句是**會誤導的字面**, 不只是舊。

---

## 7. 影響面 / Rollback(v1 的 rollback 宣稱不成立, codex 第 10 條)

```
✅ 刷卡:分岔在最後一行 ⇒ 走原路。而「不動」用 §8 的突變證, 不用宣稱。
🔵 DB:本片零改動(段 1-A 已做完)。後台零改動(讀 payment_channel 的路早就在)。
⚠️ expire sweeper 會用 5 天掃匯款單(20260903080000)⇒ 那是要的。
```
### Rollback
```
⛔ ~~v1:「DB 零變更, revert 即可」~~ 🛑 **那句話只在【還沒有客人建過匯款單】時成立。**
✅ 訂正:
   ① 碼:revert 那顆 commit(零 DB 動作)
   ② 而已建的匯款單**仍在 DB 裡**、仍是 payment_channel='bank_transfer'
      ⇒ 顧客站變回選不了匯款, 那些單只能靠後台處理
   ⇒ 🔴 **⇒ rollback 的真成本不是碼, 是【已經匯了款的客人】** ⇒ 上線後 revert 先問 Sean
   ③ 段 1-A migration 不 rollback(forward-only;舊簽名還在 ⇒ 刷卡不受影響)
```

---

## 8. 🔴 驗收條件(v1 的突變太弱, codex 第 9 條;這一節是重寫的)

### 8a 共用段「一行都沒動」怎麼證 —— **六發突變, 每一發兩條路都要紅**
```
⛔ ~~v1:拿掉 agreed 那一格 ⇒ 兩條都紅~~
🛑 **那只證明兩條測試都碰到 agreed 這個欄位**, 證不到另外五段, 也證不到匯款零扣款。
✅ v2:對【每一段】各一發突變(共 6 發), 每一發的驗收是 **card 紅 ∧ bank 紅**:
     ① 登入 gate  ② checkout zod  ③ lines zod  ④ cartSessionId  ⑤ agreed  ⑥ buildCardholder
   🟢 正對照:不突變 ⇒ 兩條都綠(否則紅是別的原因)
   🔴 而每一發**還原用 byte-exact 比對**(cmp), 不用「我改回去了」
```
### 8b 匯款那條「真的沒有扣款」怎麼證 —— **數呼叫次數, 不看畫面**
```
□ prime 相關:bank 路徑 TapPayPrimeInput.safeParse **0 次**
□ charge / confirm / begin_charge_attempt / settleCharge **各 0 次**
□ payment_charge_attempts 新增 **0 列**
🟢 正對照:同一組斷言餵刷卡路徑 ⇒ 每一項都 > 0(否則那些 spy 根本沒接上)
```
### 8c 其餘逐條(yes/no)
```
□ 1. 選匯款 ⇒ 建得出單, 而 payment_channel='bank_transfer'(走真的那條路, 不直呼函式)
□ 2. 選匯款 ⇒ 不被 prime 那一格擋
□ 3. 🔴 負對照:**選刷卡而沒有 prime ⇒ 仍要被擋**(否則我是把守門拆了不是加分岔)
□ 4. 選刷卡 ⇒ 既有測試零修改通過
□ 5. sibling='active' ⇒ 匯款不建單、回 processing;='paid' ⇒ 回既有單;lookup throw ⇒ 不建單
□ 6. client:選匯款 ⇒ validateTapPayFields / getPrime **0 次**;選刷卡 ⇒ 照舊
□ 7. pendingTransfer ⇒ 不進完成頁、清車 + regenerate cart session
□ 8. TerminalScreen 那張表補了新 status(拿掉那一行 ⇒ tsc 必須紅 = 守門突變)
□ 9. 三綠(TURBO_FORCE=1)+ 連跑兩發比四個數(檔數 / 測項 / 紅格 / 我餵幾條 vs 它跑幾支)
```

---

## 9. 要落的板列(本片產生的, 不是本片修的)

```
⟦b4-BANKORDERINVISIBLE⟧  find_active_sibling_own 用「有無 charge attempt」當「有無進行中的單」
                          的代理 ⇒ 匯款單結構上看不見 ⇒ 咬三處(§4b/§4c)。修它要動 SECURITY DEFINER。
⟦design-ATM3DAYS⟧        OD 稿 CheckoutPage.jsx:435 仍寫「3 個工作天」, Sean 拍板 5 天並說改稿。Design 線。
```

---

## 10. 我沒查的(明寫, 不假裝涵蓋)

```
🛑 客人匯款【之後】誰把單改成已付款(對帳, 後台那半)
🛑 後台 admin_create_manual_order 那條路
🛑 現金(cash)顧客站要不要開 —— DB 認, 而沒有人拍過
🛑 「選了匯款當下就看到帳號」那一頁長什麼樣 —— 段 3, 需要 Design
🛑 §3 清車之後 f0 那一發量測要量什麼 —— 前提被我改了, 端回去給他, 不自己改題目
```
