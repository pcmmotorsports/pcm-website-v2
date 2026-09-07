# `⟦b4-MIXEDRAILMANUALREFUND⟧` —— 混合單也登記得了非卡退款(plan,不寫碼)

> 線【退款】`-refund` 2026-09-08 出;板列是本窗 2026-09-08 開的(來源 = codex `gpt-6-astra`
> 對 `#787` 開封那片的 R1 must-fix)。**本檔零改碼。**
> 🔴 **鐵則 8**(跨 4 檔)**+ 鐵則 12①**(錢:人工退款登記)⇒ **A 批 ⇒ codex 不降級 ⇒ 不 push。**

## §0 三步

```
① board-row-by-anchor ⇒ :1086 · 整列【2615 字元】⇒ 讀得完 ⇒ 🔵 不截斷, 整列讀
   📌 而「先問整列多長」這一步是今晚學的:⟦b9-REFUNDNUM1⟧ 我截前 3400 字, 讀到的是過期那半
② what-happened-to ⇒ 只有 1 顆 commit 提過它, 而那顆是本窗自己的(aea57bdef)
   ⇒ 🟢 **沒有別人裁過它** —— 與 ⟦0a-CARDCANCELNOREFUND⟧ 甲(被裁「不在今天」)不同
③ L3 判定:不是內容題(不是 CRUD 頻率)⇒ 非 L3
```

## §1 今天的狀態(而它是【一條被明確關起來的路】,不是一個 bug)

```
`admin_record_manual_refund` newest = live = 20260905280000(共 3 代)
  :102     p_confirm_card_not_refunded boolean DEFAULT false
  :189-192 v_has_card = 這張單有【任何一筆】 card 收款(鎖單之後才讀)
  :194     IF v_has_card AND p_confirm_card_not_refunded IS DISTINCT FROM true THEN RAISE
而唯一呼叫端 manual-refund-repository.ts:192 只傳【7 個參數】; 畫面上沒有那一格勾選框
```
✅ **2026-09-08 的處置(A 拍 A = 收窄閘)**:`shouldShowManualRefundEntry` 第五道 ——
**這張單有任何 `card` 收款 ⇒ 不渲染那張表單。**
🛑 **⇒ 所以本片不是「修一個 bug」,是【把一條被關起來的路打開】。**

## §2 要改什麼 —— 七步,而中間三段最容易掉

🔴 **板列已寫死七步(codex R2 抓到原本的四步【中間漏了三段】)**:
```
① UI 加「我確認卡上沒退」勾選框   manual-refund-entry-section.tsx(176 行)
② 🔴 解析那個勾選值              manual-refund-form.ts(159 行)   ← 沒這步, 勾了等於沒勾
③ 🔴 action 那一層帶過去          manual-refund-action-state.ts(108 行)
④ 🔴 repository 傳第 8 參         manual-refund-repository.ts(237 行)
⑤ 拿掉 manual-refund-entry-gate.ts 那第五道
⑥ 🔴 驗收【端到端】:勾了⇒送得出去 · 不勾⇒被擋(兩個世界都要)
⑦ 動 UI + 動呼叫端 + 動錢 ⇒ 要 plan + codex
```
📌 **而那三段漏掉的形狀值得再寫一次**:**①與④ 是【看得見的兩端】,而 ②③ 是【中間的傳遞】——
寫關閉條件的人容易只列兩端,而東西掉在中間。**

### 🔵 而有一個【走完全程的範本】可以照抄,不要自己發明
🔬 拿 `rail` 這個既有欄位當尺,量它在四支檔各出現幾次:
```
manual-refund-entry-section.tsx  MANUAL_REFUND_RAIL_FIELD ⇒ 2
manual-refund-form.ts            MANUAL_REFUND_RAIL_FIELD ⇒ 3
manual-refund-action-state.ts    MANUAL_REFUND_RAIL_FIELD ⇒ 1   ← 常數定義在這裡(`:16`)
manual-refund-repository.ts      MANUAL_REFUND_RAIL_FIELD ⇒ 0   ← 🔴 它換成 RPC 參數名
                                 :38 `rail: ManualRefundRail;` · :196 `p_rail: args.rail,`
⚪ 負對照 現造欄名 ⇒ 0(尺會動)
```
🎯 **⇒ 所以新欄位的形狀是**:常數定義在 `manual-refund-action-state.ts`、
UI 用它當 `name=`、`form.ts` 解析、而 `repository.ts` 那端**換成 `p_confirm_card_not_refunded`**。
🛑 **⇒ 而「repository 那端命中 0」不是漏接,是【那一層換了名字】** ——
📌 **任何用「同一個字面在四支檔都在」當驗收的人,會在最後一環誤判成漏接。**

## §3 🔴 驗收(而第 ⑥ 步那兩個世界是本片的中心)

```
🟢 勾了 ⇒ 送得出去
🔴 不勾 ⇒ 被擋
🛑 而少了「不勾要被擋」那一格 —— 一個【永遠傳 true】的實作會全綠
   ⇒ 📌 那等於把 Sean 拍的那道確認【關掉】, 而畫面上一切正常
```
✅ **而還要一格「接線」的**(今晚量到「行為測證的是一條路,不是接線」):
```
grep -c 'p_confirm_card_not_refunded:' manual-refund-repository.ts ⇒ 期望【1】
🟢 正對照 同尺打 p_refund_amount: ⇒ 1   ⚪ 負對照 現造 p_zq7fh3k2m9x: ⇒ 0
🔴 而【現值是 0】—— 那正是板列寫的「那個 0 變成非 0 = 本列可關的其中一格」
🛑 而判準要帶冒號:不帶的話, 我在註解裡寫過那個字 ⇒ 它會誤報 1(板列有那個訂正的留痕)
```

## §4 影響面

- **動已上線的登記路徑**(UI + form + action + repository)⇒ 鐵則 8。
- 🔴 **而拿掉第五道閘 = 讓混合單重新看得到那張表單** ⇒ **那是行為改變,不是重構。**
  ⇒ 收窄閘的那段註解(含四格座標)要**同一顆 commit 拿掉**,否則它會變成一句假話。
- ⚠️ **代價的量級會過期**:板列記著「正式庫 `order_payments` 今天 1 列 ⇒ 混合單今天不存在」
  ⇒ 📌 **本片落地時要【當場重量】那個數,不要引板列那個。**

## §5 rollback

- 全部 TS,**沒有 DB 變更**(那支 RPC 的第 8 參**早就在**,`20260905280000:102`)⇒ 回滾 = `git revert`。
- 🔴 **而回滾擋不住的**:回滾之後第五道閘回來 ⇒ 混合單又看不到表單 ⇒ **那是安全的退化**。
  🛑 **而【已經登記進去的那些列不會回滾】** —— 它們是對的(勾了才送得出去)⇒ 回滾的是機制不是帳。

## §6 本 plan 證不到什麼

1. **沒有碰正式庫** —— 今天有幾張混合單,我答不出來(板列那個「1 列」是 A 給的,不是我量的)。
2. **沒有讀完** `manual-refund-entry-section.tsx` 那 176 行的表單結構 ——
   我只量到欄位常數的分布,**沒有看勾選框要插在哪一段**。
3. **沒有查** `ManualRefundActionState` 的失敗回填路徑(表單送失敗時要把勾選狀態帶回去,
   否則員工要重勾)⇒ 那一格 §2 沒有列,而它會在實作時冒出來。
4. **沒有查** 那個 RPC 的第 8 參有沒有別的呼叫端(今天只有一個,而那是**今天**)。
