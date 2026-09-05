# Plan · ⟦b4-BANKCHARGESCARD⟧ 片 1(**server 半**)—— 選了匯款就建單、不扣款

> 主視窗 `-f8` 2026-09-05 深夜派並**裁定切法**(關卡 1 兩輪都 FAIL 之後)。
> 🔴 **本片只做 server 那一半。** client 半(結帳頁選匯款、hook 對新終態的處理、持久化終態)
> = **front 片 2**,由另一條線做。⇒ **兩窗不交錯改同一批檔。**
>
> 審查史:R3(opus)F3–F6 · 關卡 1 R1(codex)7 must-fix · 關卡 1 R2(codex)7 must-fix。
> 🛑 **R2 的總評逐字:「有些 R1 修正【只改了說法】,做法仍未閉環。」** —— 那句是對的,本檔照它重寫。

---

## §0 一句話

`chargePaymentAction` 今天把「建單」與「扣款」綁成一顆。**匯款要的是「建單,不扣款」。**
今天走到那條路的結局是 `charge-actions.ts:396-420` 的 fail-closed ⇒ `return { formError: MSG.generic }`
—— **單已經建好了,而客人看到「失敗」。**

## §1 🔴 本片做完之後,匯款客人**仍然需要一張卡**

這一句寫在最前面,因為它是最容易被讀錯的一格。
`getPrime` 在 **client** 側先跑;沒有有效卡片 ⇒ `chargePaymentAction` **根本不會被呼叫**
(`CheckoutView.tsx:264-279`)。⇒ 🛑 **本片改的是 action 進去之後的事,擋在門外那一段不歸本片。**
⇒ **拿掉卡片需求 = front 片 2。**
📌 **⇒ 因此本片上線【不代表】那顆 flag 可以翻** —— 兩片都到位才行。

⚠️ 而「本片對客人價值零」這個字面也不要寫得太滿:片 2 在分支上,
**flag 一開它就是所有匯款客人的上線安全前置**;正確說法是**今天對客人不可見**。

## §2 改什麼(server 半,範圍鎖死)

| 檔 | 改什麼 |
|---|---|
| `apps/storefront/src/app/checkout/charge-actions.ts` | 那道 fail-closed 的**出口**:從 `{ formError: MSG.generic }` 改成一個明確的終態 |
| `apps/storefront/src/app/checkout/charge-actions.test.ts` | 殺手在 `:1438`;沿用既有 fixture 只改斷言 |

🛑 **不改**(全部移交 front 片 2,座標附在 §6):`CheckoutView.tsx` · `useChargePayment.tsx` ·
`useReconcilePayment.tsx` · `CheckoutSuccess.tsx` · `CheckoutTerminalScreen.tsx`。
🛑 **也不改**:`begin_charge_attempt`(Sean 已拍「只取消同一次購物那一張」⇒ 碼不動)· 任何 migration。

## §3 契約(逐條可驗)

1. 送出與回讀**皆為 `bank_transfer`** ⇒ `placeOrder` 建單成功、**`confirmPayment` 呼叫 0 次**。
2. 🔴🔴 **回傳的判別式【不可以】掛在 `ok` 上。**
   `useChargePayment.tsx:269-277` **先命中 `ok`** ⇒ 清車、換 session、畫面顯示 `paid`
   ⇒ 🛑 **客人會看到「付款成功」而他一毛錢都沒付。**
   ✅ **形狀**:回 `{ ok: false, payment: 'awaiting_remittance', displayId }` ——
   `ok` **不為 true**(所以現行 hook 不會把它當成功),而 `payment` 是一個**新的、與 ok 不同軸**的欄位。
   ⚠️ **而 `ok:false` 今天會被 hook 當成失敗** ⇒ 📌 **那正是 front 片 2 要接的東西**;
   在片 2 落地之前,客人看到的仍是一個錯誤畫面 —— **本檔明寫這個中間狀態,不假裝它已經好了。**
3. **「匯款零 `confirmPayment`」要有一道會紅的守門** —— 見 §4。
4. 失敗路徑不動:建單失敗仍走既有錯誤處理。

## §4 測試(每一發寫出它在哪個世界會紅)

· **殺手 = `charge-actions.test.ts:1438`**(送出與回讀皆 `bank_transfer` ⇒ 建單、TapPay 入口 0 次)。
  ⛔ ~~原 plan 說突變「`ok:false→true` ⇒ hook 那格紅」~~ 🛑 **指錯檔**:
  `useChargePayment.test.tsx:40-42` 把 action **整支 mock** ⇒ 改 `charge-actions.ts` **不可能**讓 hook 紅
  ⇒ 📌 **那是一發永遠不會紅的突變**,而它原本被寫成主要證據。
· **fixture 沿用既有的、只改斷言**:`charge-actions.test.ts:1447` 的 read-back 已回 `bank_transfer`、
  flag 已在 `:69-70` mock。
· 🔴 **兩句並排寫**:**flag 關著的生產世界這幾發全部不可達**;
  **而測試世界 flag 是 mock ⇒ 它們真的紅得起來。**
  ⇒ 🛑 **不可把「全紅」讀成「線上守住了」。**

## §5 回滾(🔴 R2 抓到我原本寫反了)

⛔ ~~「改的是應用層、**零 migration 零資料寫入** ⇒ revert 那顆 commit 即可」~~
🛑 **「零資料寫入」是【錯的】**:`charge-actions.ts:316-355` 的 `placeOrder`
**永久寫入 order / order_items / legal consent**;revert **不會**移除它們。
📌 而我自己下一句就寫著「回滾不會弄丟已經建好的單」—— **兩句在同一節裡互相打臉,而我寫的時候沒看見。**

✅ **正確的說法**:**回滾的單位是【碼】不是【資料】。** 已經建出來的單**留在庫裡**,
而它們是**合法的未付款匯款單**(不是垃圾)—— 回滾之後那些客人仍然在等匯款,
只是**下一個進來的人回到今天的行為**(建單 + 通用錯誤訊息)。

🔴 **順序寫死(R2 must-fix)**:
```
① 先關 BANK_TRANSFER_CHECKOUT_ENABLED
② 等那次部署【生效】
③ 才 revert 這顆 commit
```
🛑 **flag 開著就直接 revert** ⇒ 匯款選項**仍看得見**,而流程退回「要卡 + 建單後給通用錯誤」。

⚠️ **而「確認無在途」今天【沒有可執行判準】**(明寫,不假裝有):
⛔ ~~看 `20260905060000` 的 stuck_bank_orders_health~~ —— 它 `received > 0` 才收
(`:93-162`)⇒ **新建、未收款的正常匯款單根本不進那支 RPC**。
⛔ ~~比最新一張 storefront `bank_transfer` 單的 `created_at`~~ —— 擋不住**關 flag 前已進站、
關閉後才 commit** 的那個請求。

## §6 移交 front 片 2 的(R2 那 7 條裡屬 client 的,附座標)

| 事 | 座標 | 一句 |
|---|---|---|
| 選匯款要走得到 action | `CheckoutView.tsx:256-286` | 只跳過 **prime 的 parse**,**不得**越過 cart/session/同意/cardholder/preflight;連 `resumeChargeMessage()` 一起跳 ⇒ 新錯誤被 stale 機制蓋掉,客人什麼都看不到 |
| preflight 不可繞 | `charge-actions.ts:216-220,276-301` | 匯款 + 既有 active/paid 刷卡 sibling 若繞過 preflight ⇒ **又建一張單** |
| 新終態的 hook 處理 | `useChargePayment.tsx:242-255,269-277` | 別把 `ok:false` 當一般失敗;而**逾時**那條會寫一個**假的付款 in-flight** |
| reconcile 丟單號 | `useReconcilePayment.tsx:144-155` | 已拿到 `pendingTransfer + displayId` **卻丟掉單號**、維持 unknown ⇒ 客人回不到明細 |
| 持久化終態 | `CheckoutSuccess.tsx:109-118` · `OrdersTab.tsx:188-192` | 改 CTA href **不等於持久化**(沒點就 reload 仍然全消失);導明細要 `encodeURIComponent(displayId)` |
| 窮舉狀態表 | `CheckoutTerminalScreen.tsx:27-38,72-117` + `:119-145` 的測試 | 新終態不同步 ⇒ typecheck 直接紅 |

🔵 **R2 核過而通過的(對片 2 有利)**:`/account/orders/[displayId]` 路由**存在**、未登入會帶 `next`
登入後返回;未取消的 `bank_transfer + unpaid` 單在 `OrderDetailView.tsx:611-633` **確實印得出帳號與金額**。

## §7 這份 plan 答不出什麼

· **已有未匯款單時不擋第二張** —— Sean 2026-09-05 拍板(**兩次同答**;⚠️ 兩份選項表字母相反,
  所以這裡寫**行為**不寫字母)。多張未匯款單是**被授權的形狀**;
  「一筆錢對得上哪一張」的對帳那一半是另一列。
· **刷卡時取消哪些匯款單** —— Sean 2026-09-05 拍「**只取消同一次購物留下的那一張**(現在就是這樣)」
  ⇒ 碼不動;F1/F2 的射程議題**關掉**(分母仍是一台車)。
· 本片**不寄任何信**(未付款單進不了 `order_created`)。
  🛑 **而「不寄信」與「客人不知道」是兩件事** —— 後者是 front 片 2 的持久化終態要解的。

## §8 前置事實(唯讀實查,2026-09-05 深夜)

`20260904040000` 與 `20260904050000` **兩支都已在正式庫生效**
(`begin_charge_attempt` body 含 `superseded_by_card` / `cart_session_id` / `bank_transfer` 皆 t;
`find_active_sibling_own` 含 `bank_transfer` t;負對照現造函式名 0 支、現造字面 f)。
🔬 **座標訂正**:`preflight-release-sibling.ts` 在 **`packages/use-cases/src/`**;
R3 那份報告寫成 `apps/storefront/src/lib/checkout/` —— **行號 69 對、目錄錯**
(`scripts/where-is.sh` 工作樹與 dev 皆查無)。
📌 **一個對了一半的座標比全錯的難發現** —— 行號對得上會讓人以為整條路徑都查證過。
