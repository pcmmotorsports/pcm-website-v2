# Plan:把 `runHctSubmit` 接上入口(⟦ship-HCTAPI⟧ 步驟②)

> `docs/runbooks/2026-09-05-hct-readiness.md` 量到 `runHctSubmit` **零個非測試呼叫端**。
> 本 plan 只補那個呼叫端,**不動 client / flow / 兩支 RPC 任何一行**。
> 🔴 **鐵則 8(跨 3 檔)⇒ 等 Sean 批。** 🔴 **鐵則 12⑤ 對外不可回收 ⇒ 高風險片, codex 必審。**
> ⚠️ 下面引用 `hct-submit-flow.ts` 一律用**字面錨**不用行號 —— 我第一版寫了兩個行號, **兩個都錯**。

## 1. 入口:**出貨單頁一顆獨立的「送新竹」鈕**(推薦),不掛在「標記出貨」上

| | 獨立鈕 ✅ | 掛在標記出貨 ❌ |
|---|---|---|
| 送出失敗 | 只有這件失敗 | **連「標記出貨」都做不成** —— 外部 API 把一條本來會動的流程變成不會動 |
| 不可回收 | **人按一下 = 一次明確的授權** | 送出變成別的動作的副作用 |

📌 **決定性的一條**:該檔逐字寫著新竹那端「**同日重送是【更正】不是重試**」⇒ **這動作沒有 undo**
⇒ 它該長得像一個人做的決定。

## 2. 開關關著時:**灰掉 + 一句話,不是消失**

文案 `新竹未開通`(說明只寫 env 名,**不寫值**)。判斷只有一個來源:server action 回 `{ kind: 'disabled' }`。
🔴 **不得消失** —— 消失時「還沒開通」/「這張單不能送」/「我沒權限」**印同一個畫面**。
🛑 **前端不自己讀 env**:`hct-client.ts` 檔頭那道 eslint 閘逐字「Next.js 不 inline → client bundle 取 undefined → runtime throw」。

## 3. 時序(本片的核心)

```
1 讀那一列 ⇒ hct_status(current)、shipment_reference(epino)、收件人欄位
2 組 HctTransDataFields
3 await runHctSubmit({ deps, current, fields, epino })   ← 它【不寫 DB】(該檔逐字)
4 依 FlowResult 呼叫 admin_record_hct_submit(reference, status, requestId, raw)
    recorded ⇒ 照它給的 status ／ recovered ⇒ 'submitted' + 查回來的 id
    needs_human / refused / disabled ⇒ 不寫
5 revalidatePath('/orders')
```
🔴 **`unknown` 一定要寫進去** —— 那正是 `20260904140000` 加那個值的理由:「送出去了而不知道結果」
**不得重送**,要靠 `queryEdelno` 補問。**不寫 = 下一個人會重送。**

🛑 **已知的單向門(寫出來,不假裝沒有)**:第 3 步成功而第 4 步之前行程死掉
⇒ **新竹收到了而我們沒有紀錄** ⇒ 下次按鈕時 `current` 仍是 draft ⇒ **又送一次**。
✅ **緩解:第 3 步【之前】先寫一列 `unknown` 佔位**,成功後覆寫成 `submitted`。
⚠️ 而 `hct_request_id` 是 **write-once**(`20260904170000:81`)⇒ **佔位那列不得帶 request_id**,
否則後面覆寫不進去。⇒ 🔴 **這一格請 codex 特別看。**

## 4. 失敗顯示(五種各一句,不共用一句「失敗」)

| FlowResult | 畫面 | 可再按 |
|---|---|---|
| `recorded/submitted` · `recovered` | 綠字 + 新竹貨號 | 否 |
| `recorded/failed` | 紅字 + 新竹回的錯 | **是**(`decideSubmit` 對 failed 回 submit) |
| `recorded/unknown` | 🔴 橘字「送出去了而不知道結果 —— **不要重按**」 | 否 |
| `refused` · `needs_human` | 紅字 + **原樣顯示它給的 reason**(那些字寫給人看的) | 否 |
| `disabled` | 灰鈕 + `新竹未開通` | — |

## 5. 測試分母(不是「我新增幾支」)

新增:5 種 FlowResult 各一格 + **佔位/覆寫時序**一格 + 按鈕三態。
既有必須仍綠:`hct-client` `hct-submit-flow` `shipment-section` `shipment-actions` `shipment-mark-shipped-button` 五支測試。
🔴 **負對照**:擋掉 `gateOpen` ⇒ **按鈕仍在畫面上**(灰的)。🔴 **突變**:拿掉第 4 步 ⇒ **必須有測試紅**。

## 6. Rollback

1. **最快:Sean 拿掉 env 並 redeploy** ⇒ 回到成功的 no-op。⚠️ **刪 env 要 redeploy 才生效**,「我刪過了」不是停下來的證據。
2. 碼:`git revert` 這一顆(只有一顆鈕 + 一支 action + 掛載一行)。
3. 🛑 **DB 那一半回不去**(write-once / 只進不退)⇒ **已送出去的箱,revert 不會把它從新竹收回來。**

## 7. 影響面(鐵則 8)

```
新增  components/orders/shipment-hct-submit-button.tsx  (+ .test.tsx)
改    lib/shipping/shipment-actions.ts                  (+1 action)
改    components/orders/shipment-section.tsx            (掛那顆鈕)
```
⇒ **三檔(不含測試)⇒ 等批。** 估時 **45-60 分**(超出 15-45)⇒ 要的話**拆兩片**:
片一 = action + 測試(**不掛鈕**,零畫面改動)· 片二 = 鈕 + 掛載。

## 8. 這份 plan 答不出來的

🔴 **步驟①還沒回來** ⇒ `hct-trans-data.ts` 的預設值(重量 2 / 發票別 11 / 商品種類 001)
**沒有人跟新竹確認過** ⇒ 📌 **這一片做完,仍然不能對真的貨號送。**
