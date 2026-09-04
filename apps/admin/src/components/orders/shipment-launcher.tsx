'use client';

// shipment-launcher.tsx — 「開建箱彈窗」這件事的**單一實作**(D-373-A 任務 1-2)。
//
// 🔴 **為什麼抽成共用**:出貨現在有兩個入口 —— ①訂單總覽勾單 ②訂單詳情頁出貨卡。
//    兩者的差別只有「要出哪幾張單」;開窗流程(取候選 → 生冪等鍵 → 開窗 → 成功後收尾)
//    一模一樣。複製第二份的代價不是多幾行,是**冪等鍵那條紀律會變成兩份**,
//    而其中一份日後被改成「送出時生鍵」**不會有任何症狀**
//    (連按兩次真的建出兩個箱子、兩次都回報成功;見 `shipment-actions.ts` 檔頭)。
//    ⇒ `crypto.randomUUID()` 全線只出現在本檔的 `openDialog()` 這一個地方。
//
// 🔴 **客人身分會經過 client,但只當「開不開得了窗」的旗標用。**
//    `fetchShipmentCandidates` 回來的 `customerUserId` 確實進了本檔的 state
//    (`null` = 查不到、或這批單跨了兩位客人 ⇒ 不給開窗),但它**到此為止**:
//    不傳進彈窗、不隨送出回到 server。真正決定「箱子掛誰」的是 `submitShipment`,
//    它從送出的品項自己反查(`listCustomerUserIdsByOrderItemIds`)。
//    ⚠️ 這個區分是重點:早期偵測放 client 沒問題,**權威來源放 client 就是把門開著**。
//    (第一版這段寫成「完全不經過 client」—— 字面與事實不符,codex R2 打回。)
//
// 🔴 **props 只收訂單 id**(同 2b-1 紅線):`AdminOrderSummary` / `AdminOrderDetail`
//    帶成交價與會員等級,整包進 client props = 序列化進 RSC payload。

import { useCallback, useMemo, useState, type ReactNode } from 'react';
import { useRouter, unstable_isUnrecognizedActionError } from 'next/navigation';
import { ShipmentDialog } from './shipment-dialog';
import { toMessage } from '../../lib/shipping/error-message';
import { fetchShipmentCandidates } from '../../lib/shipping/shipment-actions';
// 🔴 從 `shipment-limits`(**沒有** `server-only`)拿,不要從 `shipment-candidates` 拿 ——
//    後者帶 `server-only`,client 檔 import 它是**建置期錯誤**。
import { MAX_SHIPMENT_CANDIDATE_ORDERS } from '../../lib/shipping/shipment-limits';
import type { ShipmentCandidates } from '../../lib/shipping/shipment-candidates';

/**
 * 「一件都出不了」時要告訴員工的話 —— **用 server 已經算好的原因,不要用猜的**(#351②)。
 *
 * 🔴 舊版寫死一句「(未到貨、已取消,或已經裝進其他箱子了)」= 把三個可能性丟給員工自己猜,
 *    而這片存在的理由正是「說出原因」;原因就在 `items[].blockedReason` 手上,丟掉它很浪費。
 * 🔴 零品項的訂單**另外講**:對一張根本沒有品項的單說「未到貨或已取消」,三個理由全是編的。
 *    (這片自己的標準:不知道就說不知道,不編一個看起來合理的原因。)
 *
 * 🔴 **2026-09-03(線【帳號】走 L3 手動建單走查時撞到的):說了原因,而沒說【下一步】。**
 *    員工看到的是「這些訂單目前沒有任何一件出得了(1件的數量資料尚未就緒)」——
 *    ⇒ 它說了「不行」,而**沒說要做什麼才會行**;而那個答案就在同一個 repo 裡:
 *    `picking-doc.tsx:78` 逐字寫著「**出貨必先到貨、無直送**」= 這是拍板不是缺陷。
 *    ⇒ 🛑 **而畫面從來沒有把那條規則說出來** ⇒ 員工只知道自己卡住了,不知道卡在哪一關。
 * 🔴 **下一步跟著【原因】走,不是跟著訊息走** —— 三個擋下原因裡只有兩個有下一步:
 *    `unknown`(還沒下訂 ⇒ 去採購)· `all_boxed`(已在別箱 ⇒ 去出貨紀錄找)·
 *    `cancelled`(**沒有下一步** ⇒ 不編一句,同上一段的標準)。
 *    ⚠️ `not_arrived` **不在這裡** —— 它現在**開得了窗**(窗裡有「貨到了」),
 *    走不到本函式。改動時不要順手替它補一句,那句話沒有任何人看得到。
 * 🔵 **文案調性歸 Sean**(2026-09-03 已端給他定稿);這裡先用會動的版本,不空等。
 */
function noneShippableMessage(items: ShipmentCandidates['items']): string {
  if (items.length === 0) return '這些訂單裡沒有任何品項。';
  // 🔴🔴 **每個原因帶自己的下一步**(2026-09-04;L3 走查卡點乙1)——
  //    ⛔ ~~原本四個原因共用一句「出不了」~~ ⇒ 員工看到「出不了」而**不知道要做什麼**。
  //    🔬 走查逐字(`-account` 09-03)+ `-db` 09-04 在 admin-probe 上**真的按了那顆鈕**:
  //       「這些訂單目前沒有任何一件出得了(2件的數量資料尚未就緒)。」—— 就這一句。
  //    而答案就在 `picking-doc.tsx:78`「出貨必先到貨、無直送」—— 那是拍板, 而畫面沒說出來。
  //
  // 🔴🔴 **這一段是【兩份獨立實作】合起來的, 而兩邊各有一半是對的。**
  //    `62775f03`(線【帳號】09-03 23:28)與 `d4b46f0c`(線 `-db` 09-04 02:5x)**同一夜各做了一次**
  //    ⇒ 收割時撞成 conflict。逐格記哪一格採了誰、為什麼 ——
  //    🛑 **不是「誰的比較好」, 是每一格各有一個【碼自己講得出來】的理由。**
  //
  //  ① 結構(`new Set` 去重 + 具名物件)⇒ **採 `62775f03`**
  //     去重擋的是「兩個 bucket 日後給同一句下一步 ⇒ 印兩次」;
  //     而 `{n, word, next}` 比位置解構好讀。~~`-db` 原本用 flatMap + `[, , next]`~~。
  //  ② `unknown` 的**語氣** ⇒ **採 `d4b46f0c`(不斷言)**
  //     ⛔ ~~「這幾項還沒跟供應商下訂」~~ 是**斷言**, 而 `order-focal-row.tsx:140` 的註解
  //     逐字承認:「摘要列真的不存在」與「投影壞掉讀不到」**在畫面上長得一樣**
  //     (`lib/orders/order-status-axes.ts:244-246`)⇒ 🔴 **那句話在第二種情況下是錯的**,
  //     而**一句自信的錯誤指示比一句誠實的猜測貴** —— 員工會去找一張不存在的採購單。
  //  ③ `unknown` 的**落點** ⇒ **採 `62775f03` 的方向, 而把地址寫準**
  //     ⛔ ~~「請先到【採購】下訂」~~ —— 🔴 **側欄沒有叫「採購」的項目**(2026-09-04 在
  //     admin-probe 上看側欄:總覽/訂單/退款異常/客戶/商品/優惠券/員工管理/供應商/
  //     寄不出去的信/設定 —— 十項, 沒有採購)。
  //     ⚠️ **而「採購」這兩個字確實存在, 我一度差點報成假缺陷** —— 它是
  //     `item-procurement-section.tsx:145` 的 `<h3>「採購(向供應商訂貨)」`,
  //     **住在訂單頁的商品卡裡面**, 不是一個可以「去」的地方。
  //     ⇒ 📌 **⇒ 所以寫成「打開那張單 → 商品清單裡的那一區」, 而不是一個像分頁的【採購】。**
  //     🔵 而 `-db` 原句「請打開那張單看商品清單」位置對而**沒說到那裡要做什麼** ⇒ 補上。
  //     🔴🔴 **而 2026-09-04 走查【訂貨→到貨】時發現這句話還是不夠**:那一區住在
  //     **商品項卡片(`<details>`)裡面, 而卡片預設是收合的**(`order-detail-items-table.tsx`
  //     的 `defaultOpen={stuck.kind === 'stuck' || hasProcurementRows}` —— 一張新單兩者皆否)。
  //     ⇒ 🎯 **⇒ 員工照這句話打開那張單, 在商品清單上【看不到】「採購」兩個字。**
  //     ⚠️ 而「全部展開」那顆鈕**救不了他** —— 它展開的是【四個分頁】不是品項卡
  //     (`order-detail-tabs.tsx:301` 的另一半字面是「收回分頁」;09-04 實測按下去
  //      四個 tabpanel 全開而畫面上仍然沒有「採購」二字)。
  //     ⇒ ✅ **⇒ 所以句子裡要有「點開那一項」這個動作**, 不能只給位置。
  //  ④ `not_arrived` 的下一步 ⇒ **採 `d4b46f0c`(給一句)**, 而 `62775f03` 是空字串。
  //     🔬 而這一格**今天沒有人看得到**(見下段)⇒ 兩種寫法今天零影響;
  //     選給一句的理由是:閘哪天再動一次, 空字串會變成「有原因而沒有出路」。
  //
  // 🔴 **`cancelled` 刻意沒有下一步** —— 它是終態, 編一個出來就是把員工指去做白工。
  //    ⇒ 🛑 全部都是 `cancelled` 時整句下一步**不出現**。那是對的, 不是漏了。
  //
  // 🔴🔴 **而 `not_arrived` 這一格【今天到不了】**:本函式今天**只有一個呼叫端**(同檔),
  //    而它的閘逐字是 `if (!anyShippable && !anyAwaiting)`,
  //    其中 `anyAwaiting` = 有任何一件 `not_arrived`
  //    ⇒ 🎯 **⇒ 只要有一件未到貨, 窗就開了, 根本走不到這裡。**
  //    ⇒ ⇒ 📌 **⇒ 所以那一列的 `'件未到貨'` 從 2026-08-11 放寬閘之後就是死的, 不是誰新加的。**
  //    ⚠️ **留著不刪**:本函式是純函式, 不該假設呼叫端的閘長什麼樣。
  //    🛑 **⇒ 而下一個人要知道的是:改那一句【不會有人看到】。**
  //       真正會被看到的是 `all_boxed` / `cancelled` / `unknown` 三格
  //       (2026-09-04 在 admin-probe 上實際按到的那一發是 `unknown`)。
  //
  // 🔴 **順序與上面的原因清單一致** —— 兩串分開讀時要對得起來;打亂會讓員工自己去配對。
  const buckets = [
    ['not_arrived', '件未到貨', '還在等的那幾件,貨到了先在訂單頁按「貨到了」登記到貨。'],
    ['all_boxed', '件已裝進其他箱子', '已經裝進別的箱子的那幾件,請到那張訂單的出貨紀錄找那一箱。'],
    ['cancelled', '件已取消', ''],
    [
      'unknown',
      '件的數量資料尚未就緒',
      '數量算不出來的那幾件,最常見的原因是還沒跟供應商下訂 —— ' +
        '請打開那張單,在商品清單裡「點開那一項」,裡面有「採購(向供應商訂貨)」可以下訂;' +
        '登錄到貨之後這裡才會出現可出貨的數量。',
    ],
  ] as const;
  const hit = buckets
    .map(([reason, word, next]) => ({
      n: items.filter((i) => i.blockedReason === reason).length,
      word,
      next,
    }))
    .filter(({ n }) => n > 0);
  const parts = hit.map(({ n, word }) => `${n}${word}`);
  // 🔴 去重:兩個 bucket 日後給同一句下一步時,不要把它印兩次。
  const steps = [...new Set(hit.map(({ next }) => next).filter((t) => t !== ''))];
  // 理由全空只可能是契約破了(remaining 0 卻沒帶原因)⇒ 不編一個出來。
  const why =
    parts.length === 0
      ? '這些訂單目前沒有任何一件出得了。'
      : `這些訂單目前沒有任何一件出得了(${parts.join('、')})。`;
  return steps.length === 0 ? why : `${why}接下來:${steps.join('')}`;
}

export type ShipmentLauncher = {
  loading: boolean;
  error: string | null;
  openDialog: () => Promise<void>;
  /** 要渲染的彈窗(沒開窗時是 `null`)。**放在深底容器外面**——見 shipping-selection.tsx 那段。 */
  dialog: ReactNode;
};

/**
 * 開建箱彈窗的共用邏輯。
 *
 * @param orderIds 要出的訂單。**請傳穩定參考**(`useMemo` 或 state),
 *                 每次 render 都新建陣列會讓 `openDialog` 的參考跟著換。
 * @param onDone   建箱成功後的收尾(勾單列用來清空勾選;詳情頁用來刷新)。
 */
export function useShipmentLauncher(
  orderIds: readonly string[],
  onDone?: () => void,
  /**
   * 「尾款 X 元未收」——**在彈窗裡**印的那一句(Sean 2026-09-04 拍甲)。`null` = 不印。
   *
   * 🔴 **只是一個【已經排版好的字串】,不是訂單物件** —— 彈窗的紅線(`shipment-dialog.tsx:10-11`)
   *   逐字要求 props 不收 `AdminOrderDetail`。算它的地方在 `shipment-section.tsx`
   *   的 `shipmentBalanceWarning`(server component, 走同一支 `toPaymentSummary`)。
   *
   * 🔴🔴 **而【勾單】那個入口今天傳不出這個字 —— 而它比「批次沒有定義」嚴重, 那是我第一版寫輕了。**
   *   ⛔ ~~原句:「N 張單有 N 個尾款 ⇒ 在那裡沒有定義」~~
   *   🎯 **codex 2026-09-04 MF7 訂正**:`shipping-selection.tsx:148` 的呼叫端手上是 `s.orderIds`,
   *      而**勾【一張】單也走這條路** ⇒ 那一張單的尾款**完全定義得出來**, 而畫面上不會有警告。
   *   ⇒ 🔴 **所以這不只是「批次沒做」, 是【同一張未收尾款的訂單有一條沒有警告的繞道】** ——
   *      員工從訂單列表勾那一張、按「出貨」, 走到的是同一個彈窗而少了那句話。
   *   ⇒ 📌 **一個「從詳情頁進得到、從列表進不到」的警告, 在列表那條路上與「它不存在」印同一個東西。**
   *   🛑 **本片沒有修它**:列表那頁手上沒有 payments(它是 client component, 要多一趟取數),
   *      而「勾多張時要印什麼」是 Sean 的設計題(逐單列出?只印「其中 N 張尚有尾款」?)。
   *      ⇒ 已回報主視窗、板列 `⟦ship-BALANCEWARNBYPASS⟧`。**不要把這段刪掉當成做完了。**
   */
  balanceWarning?: string | null,
): ShipmentLauncher {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /**
   * 開著的彈窗。`key` 是**冪等鍵**,在**開窗時生成一次**、整段重試沿用。
   * 🔴 不要移到送出時生成 —— 那樣每次重試都是新鍵,冪等層完全失效**而且零症狀**。
   */
  const [open, setOpen] = useState<{ key: string; data: ShipmentCandidates } | null>(null);

  const openDialog = useCallback(async () => {
    setError(null);
    // 🔴 **一次勾太多張:在【送出之前】就擋,而這一道是【文案】不是安全控制。**
    //    真正的安全控制在 server(`loadShipmentCandidates`,同一個常數)——
    //    這裡擋不住被竄改的請求,也不該假裝擋得住。
    // 🔴 **那為什麼還要有這一道**:server 那道是 `throw`,而
    //    **Next 在 production 會遮蔽 server action 丟出的原始 Error message**
    //    ⇒ 下面 `catch` 裡的 `toMessage(e)` 拿到的是一則通用訊息,員工看不到「最多 50 張」
    //    = 他不知道自己該分批,只知道「壞了」。
    // ⚠️ 這不是「為不會發生的事寫文案」:勾選狀態住在 `ShippingSelectionProvider`
    //    且純 search-param 換頁會保留 ⇒ **員工翻幾頁就合法累積得到 51 張**
    //    (codex 2026-08-17 讀 Next 原始碼查到;**我沒有在真瀏覽器上驗過**,標未實測 ——
    //     而正因為沒定論,這句文案才更該有:它讓「踩不踩得到」這個問題不再重要)。
    // 🔴 **常數只准有一份**(`lib/shipping/shipment-limits.ts`,那支刻意沒有 `server-only`)。
    //    在這裡抄一個 50 進來,兩邊就會各自漂,而漂掉的症狀是**文案說 50、server 擋在別的數字**。
    if (orderIds.length > MAX_SHIPMENT_CANDIDATE_ORDERS) {
      setError(
        `一次最多勾 ${MAX_SHIPMENT_CANDIDATE_ORDERS} 張訂單(你勾了 ${orderIds.length} 張)。請取消一些勾選、分批建箱。`,
      );
      return;
    }
    setLoading(true);
    try {
      const data = await fetchShipmentCandidates(orderIds);
      // 🔴 2026-08-10 #351②:條件從 `items.length === 0` 改成「沒有任何一件出得了」。
      //    改片之後 `items` **含出不了的品項**(要留在清單裡標原因)⇒ `length === 0` 只剩
      //    「這張單一列品項都沒有」才成立,而那句文案講的是「都已取消或已裝箱」= 字面與事實脫節。
      //    更糟的是真的「全部出不了」時會落到:開了窗、兩顆鈕全灰、員工看到
      //    「這箱還沒有任何品項。至少要選一件才能建箱。」—— 講得像他忘了選,其實是沒得選。
      // 🔴 **2026-08-11 #352-b-2:條件放寬,閘本身留著。**
      //    #351② 立這道閘的理由逐字是「開了窗、兩顆鈕全灰、員工看到『這箱還沒有任何品項』
      //    —— 講得像他忘了選,其實是沒得選」。**入口 2 把那個前提推翻了**:
      //    未到貨的品項現在窗裡有「貨到了」可按 ⇒ 開窗**有事可做**。
      //    不放寬的話,#352-b 的主場景(單品項訂單、東西還沒到)整個進不去 ——
      //    那不是已知限制,是功能沒接到。
      //    ⚠️ **放寬的是條件、不是拆閘**:真的什麼都不能做的單(沒得出、也沒有在等的貨,
      //    例如全取消 / 全已裝箱)**照舊擋下**,訊息不變。
      const anyShippable = data.items.some((i) => i.remaining > 0);
      const anyAwaiting = data.items.some((i) => i.blockedReason === 'not_arrived');
      if (!anyShippable && !anyAwaiting) {
        setError(noneShippableMessage(data.items));
        return;
      }
      if (data.customerUserId === null) {
        setError('查不到這批訂單共同的客人 ⇒ 不能裝同一箱(同一箱只能裝同一位客人的東西)。');
        return;
      }
      setOpen({ key: crypto.randomUUID(), data });
    } catch (e) {
      // 🔴 **換版要單獨分流**:部署換版後,舊分頁編出來的 server action id 在新 deployment 上不存在
      //    ⇒ Next 丟 `UnrecognizedActionError`,而 `toMessage` 會把它的英文原文
      //    (`Server Action "…" was not found on the server.`)整句丟給員工 = 純噪音、零指示。
      //    本檔這條路**零副作用**(只是讀候選、還沒建任何箱)⇒ 文案就是「重新整理」,
      //    **不要**複製建箱彈窗那套冪等鍵論述(那套的前提是東西可能已經送出去了)。
      if (unstable_isUnrecognizedActionError(e)) {
        setError('這個頁面是舊版本,系統剛更新過。請重新整理頁面再試一次(這次沒有送出任何東西)。');
        return;
      }
      // 🔴 走共用的 `toMessage`,不要自己寫 `String(e)` —— Supabase 丟的 `PostgrestError`
      //    不是 `Error` 實例,`String(e)` 會印出 `[object Object]`(2026-08-09 正式站實測過的症狀)。
      setError(toMessage(e));
    } finally {
      setLoading(false);
    }
  }, [orderIds]);

  const dialog: ReactNode =
    open === null || open.data.customerUserId === null ? null : (
      <ShipmentDialog
        candidates={open.data.items}
        recipient={open.data.recipient ?? { name: null, phone: null, line: null }}
        idempotencyKey={open.key}
        balanceWarning={balanceWarning ?? null}
        onClose={(createdShipment) => {
          setOpen(null);
          // 🔴 半成品箱(建箱成功、掛品項失敗)走**失敗路徑** ⇒ 不會呼叫 `onDone`,
          //    頁面上的出貨卡還是舊的、空箱區不出現。而彈窗那句文案剛叫員工去那裡作廢它
          //    ⇒ 不刷的話他關掉視窗會看到一張沒有那個箱子的頁面(#351③ 的地點問題復發)。
          //    詳情頁刷的是自己的出貨卡;列表頁刷了也無害(那箱確實存在)。
          if (createdShipment) router.refresh();
        }}
        onRefreshCandidates={async () => {
          // 驗收 23a:登錄到貨後**就地**重取候選,不靠整頁刷新。
          // 🔴 **只換 `data`、`key` 原封不動** —— `key` 是這一箱的冪等鍵(見檔頭),
          //    換掉它等於「同一個彈窗變成另一箱」,重試就不再是同一次出貨。
          const data = await fetchShipmentCandidates(orderIds);
          setOpen((o) => (o === null ? o : { ...o, data }));
        }}
        onDone={() => {
          // 成功之後關窗;下一次開窗會生成**新的**冪等鍵(那是另一箱)。
          setOpen(null);
          onDone?.();
        }}
      />
    );

  return { loading, error, openDialog, dialog };
}

/**
 * 訂單詳情頁出貨卡上的「出貨」入口(2026-08-09 Sean 實測後追加;
 * 🔴 2026-08-18 依 Sean 08-12 驗收指示【改名】—— 原字面是「建立包裹」)。
 *
 * 🔴 **改名不是全域取代,是逐處判**(2026-08-18):**動作**叫「出貨」,**實體**仍叫【包裹】——
 *   因為 Sean 要改的是這個動作的名字,不是把「包裹」這個東西消滅。
 *   ⚠️ 全部換成「出貨」會讓成功訊息變成「已出貨 SH-…」,而那讀起來像單號叫「出貨」。
 *
 * 🔴🔴 **落地到哪裡為止(2026-08-18 W7 逐處量,把原註解的【宣稱】換成【現況】)**:
 *   ✅ 改了:本鈕(`:218`)/ `shipment-section.tsx:54` 說明文字 / `shipment-actions.ts:159` 錯誤訊息
 *   ❌ **沒改、而且是刻意的**:`shipment-dialog.tsx:287` aria-label 與 `:290` 標題仍是「建立包裹」
 *      (理由見 `A-224-STOP` §3-③:改名要 7 處一致,只改一半會做出「按鈕說出貨、對話框說建立包裹」
 *       以外更糟的組合;而 storefront 文案審查那條線可能已對這些字面判過「維持」)
 *   ❌ **沒改**:成功訊息 `shipment-dialog.tsx:470` 是「**已建立包裹** SH-…」
 *
 *   🔴 **原註解在這裡寫的是「成功訊息寫『已出貨,包裹編號 SH-…』」—— 那句字面【不存在】。**
 *      量法(可重跑):`bash scripts/literal-sweep.sh '已出貨,包裹編號'`
 *      ⚠️ **命中會落在本註解自己身上**(改寫前 1 筆 = 原註解;改寫後 2 筆 = 本段這兩行)——
 *         **零命中的是 UI**,不是這個檔。要看 UI 得排除本檔:`… | grep -v shipment-launcher`。
 *      正向對照 `bash scripts/literal-sweep.sh '已建立包裹'` ⇒ **2 命中**(`shipment-dialog.tsx:470`
 *      與釘住它的 `shipment-dialog.test.tsx:374`)⇒ 那把尺會動,所以上面那個零算數。
 *      📌 **它把一條【還沒執行的政策】寫成了【已經執行的現況】** —— 下一個要收尾這次改名的人
 *      讀到它會以為那一半做完了,而不會去查。政策留著(它是對的),現況改成量到的。
 *
 * 🔴 這等於**單張訂單版的勾單流程**:預選 = 本單全部還能出的品項。
 *    C 版的主要動線仍是總覽勾單(可跨單併箱);這個入口是「我人已經在這張單上了」的捷徑。
 *
 * ⚠️ 建箱成功後要 `router.refresh()`:server action 只 `revalidatePath('/orders')`,
 *    revalidate 的是列表那一頁,**不含本詳情頁** ⇒ 不刷的話新箱子不會出現在下面的清單裡,
 *    員工會以為沒建成功而再按一次(第二次是不同的冪等鍵 = 真的第二箱)。
 */
export function OrderShipButton({
  orderId,
  balanceWarning = null,
}: {
  orderId: string;
  /** 「尾款 X 元未收」。由 server component 算好傳進來(見 `useShipmentLauncher` 那個參數的說明)。 */
  balanceWarning?: string | null;
}) {
  const router = useRouter();
  // 🔴 陣列要 memo:直接寫 `[orderId]` 每次 render 都是新參考 ⇒ `openDialog` 跟著重建。
  const orderIds = useMemo(() => [orderId], [orderId]);
  const { loading, error, openDialog, dialog } = useShipmentLauncher(
    orderIds,
    () => router.refresh(),
    balanceWarning,
  );

  return (
    <span className='flex flex-wrap items-center justify-end gap-2'>
      <button
        type='button'
        disabled={loading}
        onClick={() => void openDialog()}
        className='rounded-md border px-2 py-1 text-xs disabled:opacity-50'
      >
        {loading ? '載入中…' : '出貨'}
      </button>
      {error !== null && <span className='text-destructive w-full text-right text-xs'>{error}</span>}
      {dialog}
    </span>
  );
}
