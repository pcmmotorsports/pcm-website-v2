# Plan · ⟦b4-BANKCHARGESCARD⟧ 片 1 —— 選了匯款就【建單、不扣款】

> 主視窗 `-f8` 2026-09-05 深夜派。**R3(opus 換模型)FAIL 的 F3/F4/F5/F6 已折進本 plan**;
> 落點 `~/pcm-mailbox/R3-opus-bankcharges-dbd1c036f-20260905.md`。
> 🔴 **本片不依賴那題還沒答的 Q(刷卡時取消哪些匯款單)** —— 主視窗裁「推薦甲 = 維持現況碼不動」
> ⇒ 那條路今天怎麼跑,本片就怎麼留;他若答乙,另開片。

---

## §0 一句話

`chargePaymentAction` 今天把「建單」與「扣款」綁成一顆。**匯款要的是「建單,不扣款」。**
今天走到那條路的結局是**一個通用錯誤訊息**(`charge-actions.ts:396-420` 的 fail-closed
逐字「一張匯款單, 絕不往下走進扣款」⇒ `return { formError: MSG.generic }`)——
**單已經建好了,而客人看到的是「失敗」。**

## §1 🔴 本片對客人的價值 = **零**(F6:字面 vs 事實)

⛔ ~~「片 1 自己就有價值:今天那條路的結局是通用錯誤 + 單已建好」~~
🛑 **那句話是假的,而它原本是拿來當「先做片 1」的理由句。**
🔬 量到的:`CheckoutView.tsx:105` 逐字 `useState<'tappay' | 'bank_transfer'>('tappay')`,
而那顆選項要 `bankTransferEnabled` 為真才畫得出來;`BANK_TRANSFER_CHECKOUT_ENABLED` 沒設
⇒ **顧客站送不出 `bank_transfer`** ⇒ 🎯 **今天零個客人走得到那條路**
(能建出匯款單的只有後台 `admin_create_manual_order`)。
✅ **⇒ 本片是【片 2 的地基】,不是一個可以獨立交付給客人的改善。**
⚠️ **而「價值零」這個字面也不要寫得太滿**(codex 關卡1 consider):片 2 已經在分支上,
**flag 一開,本片就是所有匯款客人的上線安全前置** ⇒ 📌 說「零價值」會讓排程的人把它往後排,
而正確的說法是:**它今天對客人不可見,而它是那顆 flag 可以被翻開的前提之一。**
📌 **這一節寫在最前面,因為它決定「要不要現在做」——** 而答案仍是要做:片 2 不能沒有它。

## §1b 🔴🔴 **一個比出口更前面的洞 —— 而我原本整份 plan 都沒看到它**(codex 關卡1 must-fix)

客人選了匯款、而**卡欄沒填有效卡片** ⇒ 前端 `getPrime` **先失敗**,`chargePaymentAction` **根本不會執行**
(`CheckoutView.tsx:264-279`);就算直呼 action、沒有 prime,它也**先回刷卡錯誤**(`charge-actions.ts:216-220`)。
🛑 **⇒ 只改「建單之後的出口」, 這個核心目標仍然只對【已經有卡片 prime 的人】成立。**
⇒ 📌 **而匯款客人本來就不該需要一張卡。**
✅ **本片的範圍因此要往前延**:選匯款時**跳過 prime 這一整段**,而不是只換結局。
⚠️ 這讓本片變大 —— 而**縮回去只改出口的話,做出來的東西對真正的匯款客人沒有用**。

## §2 改什麼(範圍鎖死)

| 檔 | 改什麼 |
|---|---|
| `apps/storefront/src/app/checkout/charge-actions.ts` | 那道 fail-closed 的**出口**:從 `{ formError: MSG.generic }` 改成一個明確的成功終態(帶單號 + `payment: 'awaiting_remittance'`) |
| `apps/storefront/src/hooks/useChargePayment.tsx` | 認得那個新終態:**不落到 `paid`**、**不寫 in-flight**(F4) |
| `apps/storefront/src/components/CheckoutTerminalScreen.tsx` | 🔴 **窮舉狀態表 + renderer**(codex 關卡1 must-fix):不同步 ⇒ **typecheck 直接紅** |
| `apps/storefront/src/components/CheckoutTerminalScreen.test.tsx` | 同上, `:119-145` 要更新 |
| 對應測試三支 | 見 §4 |

🛑 **不改**:`begin_charge_attempt`(那是那題還沒答的東西)· `CheckoutView` 的 flag 與選項
(那是片 2)· 任何 migration。

## §3 行為契約(逐條可驗)

1. 送出與回讀**皆為 `bank_transfer`** ⇒ 建單成功、**TapPay 入口 0 次**、回一個**成功**終態。
   🔴🔴 **而那個終態【不可以】用 `ok: true` 當判別式**(codex 關卡1 must-fix):
   `useChargePayment.tsx:269-277` **先命中 `ok`** ⇒ 清車、換 session、畫面顯示 `paid`
   ⇒ 🛑 **永遠走不到那個 payment switch** ⇒ 📌 **客人會看到「付款成功」, 而他一毛錢都還沒付。**
   ✅ 必須是一個**與 `ok` 不同軸**的獨立判別式(例:終態 kind),並補一發突變(改回 `ok:true` ⇒ 要紅)。
2. 🔴 **不寫 in-flight**(F4)—— `useChargePayment.tsx:253,265` 相鄰的終態都呼叫
   `setPaymentInflight(cartSessionId)`,**照抄會讓客人另開分頁被軟提醒「付款處理中」而實際零扣款在途**。
   ⇒ 契約明寫:這個終態**不呼叫** `setPaymentInflight`,並補一發突變(加回去 ⇒ 要紅)。
3. 🔴 **客人下一次怎麼回到這張單 —— 寫成驗收條件**(F3)。
   今天:終態零持久化 + 購物車被清 ⇒ reload 之後畫面回到「繼續購物」,
   **此刻沒有任何一封信**(`order_created` 的 payload `paid_at` 必填 ⇒ 未付款單進不了;
   `order_unpaid_cancelled` 只涵蓋後台按取消)⇒ 🛑 **單號只活在會員訂單列表,而沒有人告訴他去那裡。**
   ✅ 驗收:終態畫面**必須**同時給出【單號】與【一條回得去的路】(連結到訂單詳情)。
   🔴🔴 **而那條驗收【只保證當頁入口】, 守不住 reload 世界**(codex 關卡1 must-fix):
   客人**沒先點那個連結**就 reload / 關分頁 / 隔天回來 ⇒ **終態、單號、連結全部消失**, 只剩「繼續購物」。
   ⇒ 🛑 **不可以把「當頁有連結」寫成「回得去」。** 兩條路擇一,而**本片必須明說選了哪一條**:
   　(甲)接受它, 而在**§6 明寫成殘餘風險**:客人唯一的回路是自己去會員中心找訂單列表。
   　(乙)讓那個終態**可持久化**(例:導到 `/account/orders/<單號>` 而不是停在結帳頁的一個 state)。
   🔵 **本 plan 推(乙)** —— 甲等於把「他知不知道自己買成了」交給他自己記得,
   　而這一片存在的理由就是那件事。⚠️ 而(乙)會再多動一支檔, 範圍要再算一次。
   ⚠️ **另一個相關事實**(codex 關卡1 must-fix):現有 CTA `CheckoutSuccess.tsx:109-118` 只連到
   `/account?tab=orders`(**訂單列表, 不是那一張單**), 而**既有測試把那個 URL 鎖死** ⇒ 改它會紅,
   ⇒ 那也要算進範圍。
   ⚠️ 而 F12:`OrderDetailView.tsx` 的匯款區塊要 **三個 AND**
   (🔴 座標訂正:R3 寫 `:571-577`,而**真正含 `!cancelled` 那三條件的執行碼在 `:611`**;
   `:571-577` 只證得到「付款方式」與「unpaid」兩條件 —— codex 關卡1 nit)
   (`bank_transfer` ∧ 精確 `unpaid` ∧ `!cancelled`)才印出帳號 ⇒ **驗收要釘「連過去真的看得到帳號與金額」**,
   不是「連結存在」。
4. 失敗路徑不動:建單失敗仍走既有錯誤處理。

## §4 測試(每一發寫出「它在哪個世界會紅」)

· **殺手在 `charge-actions.test.ts:1438`**(F5)——
  ⛔ ~~原 plan 說突變「`ok:false→true` ⇒ hook 那格紅」~~
  🛑 **指錯檔**:hook 測試把 action **整支 mock** ⇒ 改 `charge-actions.ts` **不可能**讓 hook 紅
  ⇒ 📌 **那是一發永遠不會紅的突變**,而它原本被寫成主要證據。
· hook 側另需一格:**餵 `{ok:true, payment:'awaiting_remittance'}` ⇒ 不得落到 `paid`**。
· in-flight 那一發突變(§3-2)。
· **fixture 沿用既有的、只改斷言**(F10)—— `charge-actions.test.ts:1447` 的 read-back 已經回
  `bank_transfer`、flag 已在 `:69-70` mock。
· 🔴 **兩句並排寫**(F11):**flag 關著的生產世界,這五發全部不可達**;
  **而測試世界 flag 是 mock ⇒ 五發都真的紅得起來。**
  ⇒ 🛑 **不可把「五發全紅」讀成「線上守住了」。**

## §5 回滾

改的是應用層、零 migration ⇒ 回滾 = revert 那顆 commit。
⚠️ **而「確認無在途」沒有可執行判準**(F9:匯款單零 attempt)。
⛔ ~~機械判準改成:看 `20260905060000` 的 stuck_bank_orders_health,或查最新一張 storefront
`bank_transfer` 單的 `created_at` 是否早於關 flag 那一刻。~~
🔴🔴 **那兩條【都不成立】**(codex 關卡1 must-fix,我開檔核過):
· `20260905060000_m4b_stuck_bank_orders_health.sql:93-162` —— 一張**新建、還沒收到錢**的正常匯款單
  `received = 0` ⇒ 🛑 **它根本不進那支 health RPC** ⇒ 那個「0 筆」對本片零判別力。
· 「只比最新一張單的時間」擋不住**關 flag 之前已經進站、關閉之後才 commit** 的那個請求。
✅ **⇒ 誠實的說法是:本片今天【沒有】一個可執行的「無在途」判準。**
　而回滾本身仍然安全 —— 理由不是「沒有在途」,是**改的是應用層、零 migration、零資料寫入**
　⇒ revert 之後那條路回到今天的樣子(建單 + 通用錯誤訊息)。
🛑 **那個差別要寫出來**:回滾不會弄丟已經建好的單, 而**已經看到終態的客人會少掉那一頁**。

## §6 這份 plan 答不出什麼

· **F7 / Q4 —— 🔴 已經拍過了, 而我端了第二次(記在這裡)**:
  🔬 codex 關卡1 抓到, 我開檔核過:`CheckoutView.tsx:275` 逐字 `Sean 2026-09-05 「Q4 = 乙 不擋」`,
  `~/pcm-mailbox/handoff-main-20260905.md:296` 逐字 `Q4=乙`。
  🛑 **而我今晚又端了一次**, 他今晚的答案(經主視窗轉)是「**甲 = 不擋**」。
  ⇒ 🎯 **行為相同(不擋), 而字母相反** —— 兩份選項表的甲乙排序不同。
  ⇒ 📌 **所以落檔一律寫【行為】不寫字母**:**「已有未匯款的單時, 不擋第二張」(Sean 2026-09-05)。**
  ⚠️ 而我端之前跑了 `before-asking-sean.sh` ⇒ **五段全零** —— 🔴 **那把尺沒撈到這兩處**
  (我的關鍵字是「已經有一張還沒匯款的訂單時要不要擋第二張」, 而落檔寫的是「Q4」)
  ⇒ 📌 **五段全零的意思是「這五段掃過的地方沒有」, 不是「沒有人答過」** —— 那句話今晚兌現了。
· **本片的射程因此明確**:**不含擋第二張**。而多張未匯款單是**被授權的形狀**,
  對帳那一半(一筆錢對得上哪一張)是另一列。
  今天 Q1/Q3 只擋**同一次 page-life**;清車後重加購再選匯款 ⇒ preflight 對 `bank_pending` 回 `proceed`
  ⇒ **第二張照建**(且 preflight 只在 3DS flag 開時才跑)。**本片不決定它。**
  🔬 **座標本窗自己開檔核過**:`packages/use-cases/src/preflight-release-sibling.ts:69-70` 逐字
  `if (sibling.kind === 'bank_pending')` ⇒ 註解逐字「**未付款的匯款單 ⇒ `proceed`(讓他刷卡)**」。
  ⚠️ **而 R3 那份報告把路徑寫成 `apps/storefront/src/lib/checkout/preflight-release-sibling.ts`
  —— 那支檔【不存在】**(`scripts/where-is.sh` 工作樹與 dev 皆查無);**行號 69 是對的、目錄是錯的**。
  ⇒ 📌 **一個對了一半的座標比全錯的難發現** —— 行號對得上會讓人以為整條路徑都查證過。
· **F8 殘餘**:`CartContext.tsx:400` 登出/換人 `setCartSessionId(null)`(🔴 `:399` 是 `setItems([])` —— codex 關卡1 nit) ⇒ 靠 session 認親這條路
  **在登出時照樣斷** ⇒ 「不換 session」是必要非充分,兩邊都付的洞仍開。
· 本片**不寄任何信**,而那是對的:未付款單進不了 `order_created`。
  🛑 **而「不寄信」與「客人不知道」是兩件事** —— 後者由 §3-3 的驗收條件擋,不是由信擋。

## §7 前置事實(唯讀實查,2026-09-05 深夜)

`20260904040000` 與 `20260904050000` **兩支都已在正式庫生效**
(`begin_charge_attempt` body 含 `superseded_by_card`/`cart_session_id`/`bank_transfer` 皆 t;
`find_active_sibling_own` 含 `bank_transfer` t;負對照現造函式名 0 支、現造字面 f)。
⇒ 本片**不改那條路**,而讀 plan 的人要知道它是活的。
