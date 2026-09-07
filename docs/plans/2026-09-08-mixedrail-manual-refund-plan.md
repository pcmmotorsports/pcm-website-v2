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

---

## §7 【2026-09-08 補查】§6 的 3 與 4 —— 主視窗 A 指定「先查再寫」

> 🔴 **而 3 的答案【改設計】,不是收尾細節** —— 它讓那七步變成八步。

### §7-1 ④ 第 8 參有沒有別的呼叫端 ⇒ **沒有**
```
/usr/bin/grep -rl "p_confirm_card_not_refunded" apps/admin/src apps/storefront/src packages ⇒ 4 支
🛑 而那四支【一支呼叫端都不是】,逐支開檔核過:
  refund-wiring.test.tsx:1510            測試的【註解】
  manual-refund-entry-gate.ts:242 / :244 收窄閘的【註解】(座標引用)
  manual-refund-repository.ts:28         我 2026-09-08 寫的【訂正註解】
  refund-remaining-single-source.test.ts:235  測試的【註解】
🟢 正對照 同尺打 p_refund_amount ⇒ 6 支 · ⚪ 負對照 現造 ⇒ 0(尺會動)
```
✅ **而真受詞是「誰 `rpc('admin_record_manual_refund')`」⇒ 恰 1 個**:`manual-refund-repository.ts:192`。
🔵 **與 `manual-refund-entry-gate.ts:133` 那句既有量測一致**(逐字「**恰 1 個呼叫點**」)⇒ 兩個來源同向。
📌 **⇒ 而這一發自己就是「註解被 grep 當成碼」的又一例:命中 4 支,而【碼裡零支】。**

### §7-2 ③ 失敗回填 ⇒ 🔴 **答案是「要」,而且它讓七步變八步**

🔬 **失敗回填是【逐欄手寫】的**,`manual-refund-entry-section.tsx:70-79` 逐字:
```tsx
useEffect(() => {
  if (state.status !== 'failed') return;
  if (state.code === 'denied') return;
  if (state.input.rail === 'bank_transfer' || state.input.rail === 'cash') setRail(state.input.rail);
  setAmount(state.input.amount);
  setReason(state.input.reason);
  if (state.input.occurredAt !== '') setOccurredAt(state.input.occurredAt);
}, [state]);
```
而 `ManualRefundFormInput`(`manual-refund-action-state.ts:68-73`)**只有四個欄位**:
`rail` / `amount` / `reason` / `occurredAt`。

🛑 **⇒ 所以新欄位【不主動加就會安靜地掉】** ——
📌 **它不是「忘了寫某一行」會紅的那種,是【那一行不存在而畫面看起來完全正常】。**

🔴🔴 **而這一格對【這個特定欄位】特別重要,理由不是對稱的**:
```
其他欄位掉了 ⇒ 員工看到空白 ⇒ 他知道要重打
🛑 而勾選框掉了 ⇒ 它回到【沒勾】那一態 —— 而那是【看起來正常】的預設值
⇒ 員工看到錯誤訊息「請先確認卡上沒退」, 勾了, 送出, 又失敗(因為別的原因),
   而這次那個勾【已經被清掉了】⇒ 他會以為自己勾了
🎯 ⇒ 一個【回到安全預設】的回填缺口, 比一個【回到空白】的更難發現
```

✅ **⇒ 七步改成八步(新增的那一步排在 ③ 之後)**:
```
③  ManualRefundActionState / action 那一層帶過去
③b 🔴 **`ManualRefundFormInput` 加那一欄, 而【失敗回填那個 effect 也要加一行】**
    —— 兩處都要:type 加了而 effect 沒加, typecheck【不會紅】(它只是少 set 一個 state)
④  repository 傳第 8 參
```

### §7-3 ⇒ 驗收要跟著多一格
```
🔴 送出失敗一次(任何原因)⇒ 那個勾選【要還在】
   而它的兩個世界:勾了送失敗 ⇒ 回來仍是勾的 · 沒勾送失敗 ⇒ 回來仍是沒勾的
🛑 而只驗前者的話, 一個【永遠回填成 true】的實作會過 —— 那又是把那道確認關掉
```
⚠️ **而 `denied` 那一態刻意跳過回填**(`:72`,`input` 是空殼)⇒ **新欄位也要跟著跳過**,
否則會在 `denied` 時把一個空值寫進去。**這一格照抄既有行為,不要「順手改好」。**

---

## §8 codex 對抗審查 R1(鐵則 12① 錢, commit 前, 不 push)

**指令形狀** `codex exec -s read-only --disable apps -m gpt-6-astra "$(cat <prompt>)" < /dev/null`
**log** `scratchpad/codex-mixed.log`(7,647 行)· **model 回聲** `gpt-6-astra` ·
🟢 `grep -c 'mcp: codex_apps'` ⇒ **0** —— 而那只能讀成「**本發**沒經連接器碰正式庫」。
🔬 特徵字回聲 `p_confirm_card_not_refunded` 37 · `MIXEDRAILMANUALREFUND` 38 ⇒ prompt 真的進去了。
⚠️ **而我那個「負對照」失效了**:我現造的 `p_zq7fh3k2m9x` 在 log 裡命中 **3** 次 ——
因為**我把它寫進 prompt 當說明**了 ⇒ 📌 **一個被寫進受測輸入的負對照, 就不再是負對照。**
(同型第二次:`grep` 判準也曾因我自己的註解而誤報。⇒ **負對照要現造【而且不出現在任何餵進去的東西裡】。**)

### §8-1 兩條 must-fix ⇒ 逐條開檔複核(不照單全收, 也不挑)

**MF1 `gate.ts:236` —— ✅ 屬實, 而【不在本片射程】**
> codex:卡收 500、現金收 1,000,卡款已退 500;入口放行,如實不勾被 `:194` 拒,勾則是不實確認。

複核:`20260905280000:189-192` 的 `v_has_card` 是 `EXISTS(order_payments WHERE rail='card')` ——
**它完全不看那筆卡款退了沒**。而 `:194` 的錯誤訊息自己寫著「已經退成功了就不要在這裡登記」
⇒ 📌 **勾下去就是講一句假話** ⇒ **那是一條死路, codex 是對的。**
🔵 而**本片沒有讓它變壞**:本片之前這種單被前端第五道閘擋在門外, 一樣登記不了。
🛑 修它要動 DB(鐵則 12③ + 那支已 apply 進正式庫)⇒ **今晚不修**, 開列 `⟦b4-CARDALREADYREFUNDED⟧`。
✅ **本片的動作 = 把宣稱改準**(`gate.ts` 那段註解已改)—— 那不是放過缺陷, 是 R6 誠實條款。

**MF2 `gate.ts:234` —— ✅ 缺陷屬實, 而 codex 的【受詞】偏了**
> codex:「**本片新放行的**混合單即使帳本未登記額為 0,仍顯示新登記表單」

🔬 **探針實測**(四格, 含兩格正對照;抄的是檔內逐字的條件式, 不是我手打的):
```
✅顯示   純現金單 remaining=0      ← 📌 本片【之前】就走這條
✅顯示   純現金單 remaining=1000
✅顯示   純現金單 remaining=null
⛔不顯示 純現金單 remaining=-1      ← 正對照(該擋, 擋了)
✅顯示   混合單   remaining=0      ← codex 指的那格
✅顯示   混合單   remaining=1000
⛔不顯示 純刷卡單 remaining=1000   ← 正對照(無現金軌, 擋了)
```
⇒ 📌 **`remaining=0 仍顯示表單` 是【既有缺陷】, 不是本片引入的。**
⚠️ **而本片確實擴大了它的暴露面**(純現金單 ⇒ 混合單)—— **這句要留著, 不可以拿「既有」當免責。**
⇒ 開列 `⟦b4-ZEROREMAININGSHOWSFORM⟧`。

### §8-2 四條 nit ⇒ **全部收下, 一次清完**(0906 拍板:純文字 finding 一律 nit, 不為它開輪)

| # | codex 說的 | 處置 | 突變層 |
|---|---|---|---|
| N1 | `actions.test.ts:242` 只驗回傳 `input`, 沒驗**交給 repository 的值**;把 `actions.ts:127` 寫死 `true` 抓不到 | ✅ 補一格「兩發一起比 `toEqual([true,false])`」 | **L3 新守到** |
| N2 | `refund-wiring.test.tsx:1537` 只驗初始未勾, 沒驗**失敗後 DOM**;把 effect 改成 `setConfirmCard(true)` 抓不到 | ✅ **新開** `manual-refund-entry-section.test.tsx`(3 格, 含 idle 正對照) | **L6 新守到** |
| N3 | `form.test.ts:269` 若被誤改成 `ok:false` 斷言仍綠 | ✅ 另釘一行 `expect(r.ok).toBe(true)` | L1 既有 |
| N4 | 「保護換了位置」不成立;DB 早已存在, 條件是「有卡**且未確認**才擋」 | ✅ **codex 對, 我把時序講反了** —— DB `:194` 是 09-05, 前端那道是 09-08 稍早 ⇒ **後加的不可能是先在的搬過去**。改寫成:前端那道是一張 **OK 繃**(擋「表單送得出去而訊息叫他勾一個不存在的格子」), 防退兩次的一直是 DB。 | — |

### §8-3 突變 —— **照層分, 六層各一發**(不是十發全打純函式層)

```
M0(不突變, 六支)          rc=0 · Test Files 6 passed · Tests 139 passed   ← 沒這格下面全不算數
L1 純函式  form.ts 解析寫死 true          餵1 → 2 紅 /22   rc=1  ✅ 被殺死
L2 空殼    action-state 預設 false→true   餵2 → 1 紅 /12   rc=1  ✅ 被殺死
L3 action  傳給 repository 寫死 true      餵1 → 1 紅 /18   rc=1  ✅ 被殺死  ← N1 補的那格咬到
L4 狀態    carryBack 回填寫死 false        餵2 → 1 紅 /83   rc=1  ✅ 被殺死
L5 接線    repository 第 8 參寫死 true     餵1 → 2 紅 /22   rc=1  ✅ 被殺死
L6 UI/DOM  effect 回填寫死 true            餵1 → 1 紅 /3    rc=1  ✅ 被殺死  ← N2 新檔咬到
收尾 六支還原後再跑 rc=0 · 139 passed(回到 M0)· 每發還原後比 sha256 對上
```
🔴 **第一發 L4 錨命中 0 次 ⇒ 當場作廢、不計入覆蓋**(我拿註解裡的字面當錨, 真字面在 IIFE 裡)
⇒ 改用真字面重跑才拿到那個 ✅。📌 **`apply_rc≠0` 與「突變存活」在 rc 上都不是 0, 而意思相反。**

### §8-4 收工的數(全部當場跑, 三綠三發都 `0 cached`)

```
typecheck  9/9 successful · 0 cached · error TS 命中 0
lint      11/11 successful · 0 cached
build      2/2 successful · 0 cached
測試   餵 9 條 → 跑 9 支 → Tests 156 passed → 紅 0 格
      逐條加總 156 = 全套一發 156 → 差 0 → 異常支數 0
```
🔵 九支是**掃識別字撈出來的**(`confirmCardNotRefunded` / `MANUAL_REFUND_CARD_CONFIRM_FIELD` /
`shouldShowManualRefundEntry` / `p_confirm_card_not_refunded` / `recordManualRefund`)**不是憑記憶列的**;
⚠️ 而 `packages/domain/.../manual-refund-caller-gate.test.ts` **那一掃撈不到**(它掃的是原始位元組)——
**是我手動補上去的**, 理由是本片動了 `repository.ts` 的 rpc payload, 而那正是它在守的東西。
📌 **⇒ 一個「掃識別字」的分母, 對【不用識別字工作的守門】天生失明。**

### §8-5 這一片的天花板(同一句已寫進 `gate.ts` 與板列)

> **本片證的是【前端會把那個值送到】, 沒證【RPC 拿到 `false` 之後整條路都對】—— 只讀了 `:194` 那一道。**

連帶三件**沒做**:①沒開真瀏覽器(`refund-wiring` 是 jsdom 的 DOM 查詢)②沒碰正式庫
——**今天有幾張這種混合單, 我答不出來** ③沒查那個第 8 參除了 `:194` 以外還有沒有別的消費者。
