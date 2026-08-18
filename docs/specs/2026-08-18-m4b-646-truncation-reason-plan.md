# `#646` plan · 一個旗標兩個世界 —— 把「讀不到」與「觸及上限」分開

> **狀態:2026-08-18 18:4x 由 G2 寫,【尚未批准】。鐵則 8 命中 ⇒ 要 Sean 批才動手。**
> 🔴 本檔**不裁定**甲/乙,兩案並列 + 一個推薦。批的人要看的是 §4 的影響面與 §6 的風險。
> 條目正本 `docs/phase-1-backlog.md` 的 `#646`(那裡有病的原始描述與撞號史)。

## 1. 要改什麼

`procurementTruncated` 這一顆布林,現在同時代表兩個**真假相反**的世界:

```
missing（內嵌鍵整個沒回來 = 投影退版/讀不到）      → 可能是暫時的，重整【真的可能會好】
>= 上限（ORDER_ITEM_PROCUREMENT_EMBED_LIMIT）      → 固定上限，重整【永遠不會好】
```
消費端拿到 `true` 時**分不出自己在哪一個世界** ⇒ 文案只能寫成條件句
(`#643 B` 已把「請重新整理這張單」那句白工文案改掉,**但那只是不再說謊,還不精準**)。

`order` scope 的 `itemsTruncated` 則是**純上限**(沒有 missing 那一半)⇒ 那個世界的員工
照文案仍會白按一次重整。

## 2. 為什麼現在做(不修會痛在哪)

```
· 一張 200 品項的單（Sean 講過的業務上緣）每次都會叫員工按一次不會有用的重整
· 真的是 missing（暫時性）的那一次，員工重整好了也不知道自己「猜對了」
  ⇒ 下一次他會用同一個動作去對付固定限制，然後開始覺得這個警告在亂講
🔴 一個「有時候對」的指示，比一個一直錯的指示更難被發現是壞的。
```

## 3. 兩案(**本檔不裁定**)

```
甲  旗標拆成原因列舉    procurementTruncated: 'missing' | 'limit' | null
乙  第二個通道          procurements: null（＝讀不到）；truncated 從此只表示「觸及上限」
```
🔴 **乙在同一個資料夾裡已經落地過一次**,逐字理由在
`packages/adapters/src/supabase/mappers/order-cancellations.ts`(數法:
`/usr/bin/grep -n "items: null, itemsTruncated: false" packages/adapters/src/supabase/mappers/order-cancellations.ts`):
> 「改回 `null`(不是 `[]` + truncated)—— 空清單與『讀不到』在畫面上長得一樣,
>   型別給 null 才逼得動消費端先處理。`itemsTruncated` 從此只表示『觸及上限』。」

**差別不是形狀,是誰被強迫處理**:
```
甲  多一個字串值 ⇒ 消費端【可以繼續寫 if (truncated)】而編譯器不會攔它  ← 舊行為會靜默留著
乙  型別從 T[] 變成 T[] | null ⇒ 每一個 .length / .map 都是【編譯期錯誤】 ← 逼著逐處決定
```
**推薦乙**,理由就是上面那一行:本片要修的病是「消費端分不出來」,而乙讓「分不出來」變成
**編譯期一定要答的題**;甲只是把資訊放在那裡、不保證有人讀。

## 4. 影響面(逐檔,`/usr/bin/grep -rn` 於 `apps` + `packages`、排除 `*.test.*`)

```
產生端
  packages/adapters/src/supabase/mappers/order-procurement.ts   ← 旗標在這裡算出來
  packages/adapters/src/supabase/mappers/order.ts               ← 品項自己被截時的那一層
  packages/domain/src/order/types.ts                            ← 型別與 docstring
消費端（每一處都要逐處決定，不是機械替換）
  apps/admin/src/components/orders/item-procurement-section.tsx  畫面警告（order / item 兩個 scope）
  apps/admin/src/lib/orders/procurement-action-state.ts          伺服器端回聲（表單 hidden 欄）
  apps/admin/src/lib/orders/merge-detail-items.ts                合併時把「沒撈到」標成 truncated
  apps/admin/src/lib/orders/cancel-view.ts                       🔴 見 §6，最重的一處
  apps/admin/src/components/print/picking-doc.tsx                揀貨單 fail-closed（itemsTruncated 那半）
  apps/admin/src/components/print/shipping-doc.tsx               出貨單（同上）
  apps/admin/src/components/orders/cancel-review-section.tsx     「品項明細沒有列完」
```
⚠️ **本清單是 `grep` 出來的,而 `grep` 看不到「透過結構型別間接吃到這個欄位」的地方**
—— 真正的分母由 `tsc` 給:改完型別跑 `TURBO_FORCE=1 pnpm typecheck`,**紅的那些才是完整清單**。
(這句是本片的方法,也是本片為什麼推薦乙:乙讓 `tsc` 幫我們列分母。)

## 5. 驗收

```
① typecheck 全綠（而中途它會紅很多處 —— 那正是分母，不是災情）
② 每一個消費端都能回答「missing 時我印什麼 / limit 時我印什麼」，兩者字面不同
③ 守門：兩個世界各一格，且各配一次突變（把分辨那一行改回單一布林 ⇒ 對應那格要紅）
④ 文案不得出現「請重新整理」在 limit 那個世界（`#643 B` 立的守門要沿用、不得放寬）
⑤ 四綠 + vitest 全綠
```

## 6. 🔴 風險(這是本片最重要的一段)

```
cancel-view.ts 的 `procurementTruncated` 兼【兩個角色】，逐字在該檔的 docstring：
  ① 「缺摘要列能不能推 0/0」的前提之一（採購清單被截 ⇒ 推不出「零採購」）
  ② 型別判別欄：AdminOrderDetailItem 有它、AdminOrderLine 沒有
     ⇒ 把列表投影的品項餵進取消邏輯是【編譯期錯誤】。
     守門是 cancel-view.test.ts 裡一條 @ts-expect-error，由 **tsc** 守、不是 vitest
     ⇒ 動這個欄位時，突變自驗要跑 `tsc --noEmit` 才看得見。
```
⇒ **兩案都會碰到取消路徑的 fail-closed 閘**(`zeroInferable`)。
   甲保留欄位名 ⇒ 角色②自動留著;**乙拿掉/改形狀時要確認角色②沒有跟著消失**
   (乙的補法:改成 `procurements: readonly T[] | null` 之後,`AdminOrderLine` 仍然沒有這個欄位
    ⇒ 角色② 仍成立,而這一點**要在片內用那條 `@ts-expect-error` 實證,不能用推的**)。

**鐵則對照**
```
鐵則 8   命中（跨 packages/adapters + packages/domain + apps/admin，3+ 檔）⇒ 本檔就是要批的東西
鐵則 12  命中 ①（碰 order 取消路徑的 fail-closed 閘）⇒ commit 前跑 codex 關卡2，不降級
片型     高風險片（全 9 步）
```

**rollback**:單一 commit、可 `git revert`。無 migration、無資料寫入、無對外送出
⇒ **回退成本 = 一次 revert + 一次四綠**。(這也是為什麼建議一次做完、不要拆兩片:
中間態會讓一半消費端用新語意、一半用舊語意,而那個世界沒有人看得出來。)

## 7. 這份 plan **沒有**主張什麼

```
· 沒有量過 missing 在正式站實際發生的頻率 —— 未確認（本條只論結構）
· 沒有主張甲乙以外沒有第三案
· §4 的清單是 grep 出來的，不是 tsc 出來的 ⇒ 開工第一步就是讓 tsc 重列一次
```
