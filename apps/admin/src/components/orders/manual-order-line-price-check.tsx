'use client';

import { useEffect, useRef, useState } from 'react';
import { searchManualOrderCatalogAction } from '@/lib/orders/manual-order-catalog-actions';
import type { ManualOrderCatalogResult } from '@/lib/orders/manual-order-catalog-actions';
// 🔴 從 `-limit` 那支拿, **不要**從 `manual-order-catalog`(它是 server-only ⇒ build 會紅)。
import { MANUAL_ORDER_CATALOG_LIMIT } from '@/lib/orders/manual-order-catalog-limit';
import {
  MANUAL_ORDER_LINE_SKU_BASE,
  MANUAL_ORDER_LINE_TAX_BASIS_BASE,
  MANUAL_ORDER_LINE_TAX_BASIS_TAXED,
  MANUAL_ORDER_LINE_TAX_BASIS_UNTAXED,
  MANUAL_ORDER_LINE_UNIT_PRICE_BASE,
  untaxedFromTaxed,
  NON_NEG_INT_RE,
  manualOrderLineField,
} from '@/lib/orders/manual-order-form';

// manual-order-line-price-check.tsx — ⟦b4-PURCHTAX1⟧ **甲案**(Sean 2026-09-03 批)。
//
// ## 這一片在防什麼
// `manual-order-lines.tsx` 那句黃字逐字寫著:
//   「單價這一格請填**含稅**金額 —— 未稅 1,000 要填 1,050。
//     填成未稅就少收那 5% 的稅,**而系統看不出來、不會擋**。」
// 🎯 **⇒ 碼自己承認:一個手打的數字, 打錯了系統不會叫。** 本片讓它叫一聲。
//
// ## 🛑 它【不是】什麼
// · **不擋送出** —— 它問一句, 不做守門(真的要賣別的價錢是合法的)。
// · **不回寫任何欄位** —— Sean 2026-08-31 拍丙明文:「打料號查到的顯示在旁邊自己抄, 不回寫 input」。
// · 🔴 **對代購品項(型錄查無)結構上無效** —— 它沒有任何權威價可以比。
//   那一半仍然只剩上面那句安全標籤。**不要因為本片上線就把 ⟦b4-PURCHTAX1⟧ 劃掉。**
//
// ## 🔴🔴 為什麼是【獨立元件】而不是寫進 `manual-order-lines.tsx`
// 那支檔有一條**不變式**與三道原始碼層守門(`manual-order-lines.test.tsx:105-118`):
//   `useState<number[]>` 只裝列 id / 全檔恰好一個 `useState` / 零 `{...spread}`
//   —— 它們守的是「**送出的值不由 client state 產生或回寫**」(codex R1 #8 逼出來的)。
// 🛑 我第一版把比價 state 加進那支檔 ⇒ **兩道守門當場紅**。
// 🔴 **而我沒有去改那三道守門** —— 那是「動驗證本身」, 是立即停止訊號。
// ✅ 改成搬出來:本元件**不渲染任何帶 `name=` 的 input** ⇒ 那條不變式對那支檔仍然逐字成立,
//    不是被繞過。⚠️ **而「有沒有繞過」請審查者自己判, 不要只讀我這段話。**
//
// ## 🔴 為什麼用 `focusout` 而不是 `blur`
// `blur` **不冒泡** ⇒ 掛在 form 上收不到 input 的 blur。`focusout` 會冒泡。
// (本 repo 記過同一個坑:memory 關鍵字「focusout 非 blur」。)

/**
 * 一列的比價讀數。
 * 🔴 **五種各自是一個世界, 不得合併** —— 尤其 `unmatched`(查過了, 不在型錄)
 *    與「還沒查」(state 是 `null`)不是同一件事:合併之後畫面會把「還沒查」印成「查無」。
 */
export type LinePriceCheck =
  | { kind: 'match'; sku: string }
  | { kind: 'mismatch'; sku: string; typed: number; authority: number }
  | { kind: 'no_price'; sku: string }
  | { kind: 'unmatched'; sku: string }
  | { kind: 'check_failed'; sku: string; message: string }
  /**
   * 🔴 **查詢滿了而沒撈到逐字相等那筆** —— 這**不是**「不在型錄裡」。
   *    `searchManualOrderCatalog` 是 `ilike '%needle%'` + `limit 20`
   *    ⇒ 逐字相等那筆可能排在第 21 筆。**把它判成代購會把一個型錄品項講成無從檢查。**
   *    (codex 對抗審查 must-fix:方向剛好是危險的那一側。)
   */
  | { kind: 'inconclusive'; sku: string };

/** 純函式:把「查到什麼」變成「要印哪一種讀數」。**抽出來是為了它自己可以被單獨測。** */
/**
 * @param taxBasis 這一列的稅基。**必須傳** —— 見下面 `effective` 那段。
 */
export function resolveLinePriceCheck(
  sku: string,
  typed: number,
  result: ManualOrderCatalogResult,
  taxBasis: string,
): LinePriceCheck {
  if (!result.ok) return { kind: 'check_failed', sku, message: result.message };
  // 🔴 `ilike '%needle%'` 是**模糊**比對 ⇒ 只有【相等】那一筆才算權威。
  //    拿第一筆當權威 ⇒ `SKU-A` 會被 `SKU-A-LONG` 的價格判成錯。
  // 🔴🔴 **大小寫不敏感**(codex must-fix):查詢用的 `ilike` 本來就不分大小寫
  //    ⇒ 員工打 `sku-a` 查得到 `SKU-A`, 而用 `===` 比會把它判成代購 —— **方向是危險的那一側**。
  const needle = sku.toLowerCase();
  const exact = result.hits.find((h) => h.sku.toLowerCase() === needle);
  if (exact === undefined) {
    // 🔴 **查詢滿了 ⇒ 不敢說「不在型錄裡」**(那筆可能排在 limit 之外)。
    return result.hits.length >= MANUAL_ORDER_CATALOG_LIMIT
      ? { kind: 'inconclusive', sku }
      : { kind: 'unmatched', sku };
  }
  // 🔴🔴 **權威是【經銷未稅價】, 不是 `unitPrice`(型錄含稅價)** —— ⟦b4-PRICECOPYTAX⟧, 2026-09-06。
  //  ⛔ ~~`const authority = exact.unitPrice;`~~ **作廢**。
  //  🔬 **為什麼要換**(當場量的, 不是照 plan 轉述):
  //    ① 畫面那句橘字**已經是**「單價這一格請填**未稅**」——
  //       `manual-order-lines.tsx` 的字面, 而它**已經在 `origin/main` 上**(員工現在看到的就是這句)。
  //    ② 正式庫的建單 RPC **已經是第 6 代、真的在算稅**(唯讀查 `admin_create_manual_order` 的 `prosrc`):
  //       `v_price_tax_mode constant text := 'exclusive'` ·
  //       `v_tax := round(((v_subtotal + p_shipping_fee - 0)::numeric) * 0.05)` ·
  //       `v_total := v_subtotal + p_shipping_fee + v_tax`, 而 `tax_total` 那一行的註解逐字
  //       「**第 6 代:這裡不再是 0**」。
  //  ⇒ 📌 **配對已經完成**(板列 ⟦b4-PRICECOPYTAX⟧ 要求「文案與算稅同一次上線」),
  //     而**留在舊方向的只剩這一支**:它拿含稅價當權威, 於是員工照橘字填未稅 ⇒ **每一列都被它罵**。
  //  🛑 **所以這一片不是「提早上文案」** —— 它是把最後一個沒跟上的面接回去。
  const authority = exact.dealerPriceUntaxed;
  if (authority === null) return { kind: 'no_price', sku };
  // 🔴🔴 **拿去比的必須是【真的會送出去的那個數】, 不是他打在格子裡的那個**
  //    (⟦b4-PURCHTAX1⟧ codex must-fix, 2026-09-06)。
  //    病:他填 4,200 並選【含稅】, 而經銷未稅權威價剛好也是 4,200
  //    ⇒ 舊碼比 `4200 === 4200` ⇒ 印「**單價與經銷未稅價對得上**」
  //    ⇒ 而 server 會把它換算成 **4,000** 才送出 ⇒ 📌 **一個錯的價格拿到了一句背書。**
  //    🛑 那正是這整列板子在講的形狀:**錯的錢配一個全綠的守門。**
  //    ⇒ 稅基是含稅 ⇒ 先換算再比;換不出整數 ⇒ **不比**(那一列本來就會被擋下來,
  //      在這裡再講一句只會與那句擋下來的話互相干擾)。
  const effective =
    taxBasis === MANUAL_ORDER_LINE_TAX_BASIS_TAXED ? untaxedFromTaxed(typed) : typed;
  if (effective === null) return { kind: 'inconclusive', sku };
  return authority === effective
    ? { kind: 'match', sku }
    : { kind: 'mismatch', sku, typed: effective, authority };
}

/** 讀數 → 給員工看的那句話。**五種都會產生一句話** —— 見下方 `match` 那段的理由。 */
export function linePriceCheckMessage(c: LinePriceCheck): string {
  switch (c.kind) {
    case 'match':
      // 🔴 **對得上也要出聲。** 只在錯的時候出聲的話,「沒出聲」同時代表
      //    對得上 / 還沒查 / 查不動 ⇒ 那句沉默在三個世界印同一個東西。
      return `料號 ${c.sku}:單價與經銷未稅價對得上。`;
    case 'mismatch': {
      // 🔴 **講出我們懷疑的是哪一種錯, 不要只說「不一樣」** ——
      //    只說不一樣, 員工的下一個動作是「那我改成一樣」, 而那不一定對
      //    (真的要賣別的價錢是合法的, 這一道不是守門)。
      // 🔴 **拿掉 ±1 容差**(codex must-fix):稅率 5% 而兩端都是整數 ⇒ 關係是精確的。
      //    容差 1 會讓 `1000` 對 `1049 / 1050 / 1051` **三個都命中**, 而文案還會斷言
      //    「含稅要填 <權威價>」⇒ **一個猜測被講成指示**。
      //    🔴 並要求 `typed > 0` —— 否則 `0 → 1` 也會被說成「像未稅」。
      // 🔴 **方向反過來了**(⟦b4-PRICECOPYTAX⟧ 2026-09-06):權威是未稅價
      //    ⇒ 現在要懷疑的是「員工填成了**含稅**」, 而不是「填成了未稅」。
      //    ⛔ ~~`Math.round(c.typed * 1.05) === c.authority`(= 填的那個 ×1.05 等於權威)~~
      //    ✅ `Math.round(c.authority * 1.05) === c.typed`(= 權威 ×1.05 等於填的那個)
      //    🛑 **兩式不是對稱的** —— 舊式問「你填的是不是權威的未稅版」, 新式問
      //      「你填的是不是權威的含稅版」。照抄舊式只把變數名換掉會**繼續問錯的問題**。
      // 🔵 `±1 容差`仍然不加(理由同下方原註解:稅率 5% 而兩端都是整數 ⇒ 關係是精確的)。
      const looksTaxed = c.authority > 0 && Math.round(c.authority * 1.05) === c.typed;
      return (
        `料號 ${c.sku}:你填 ${c.typed.toLocaleString()},而經銷未稅價是 ` +
        `${c.authority.toLocaleString()}。` +
        (looksTaxed
          ? `這看起來像填成了含稅價 —— 未稅要填 ${c.authority.toLocaleString()},稅由系統自己算。`
          : '') +
        '確定要用你填的那個就直接送出。'
      );
    }
    case 'no_price':
      return `料號 ${c.sku}:型錄裡有這個商品,但它沒有定價 ⇒ 這一格沒有東西可以幫你對。`;
    case 'unmatched':
      // 🛑 **不得說成「沒問題」** —— 它沒有被檢查過, 只是無從檢查。
      return `料號 ${c.sku} 不在型錄裡(代購)⇒ 沒有權威價可以比,這一格幫不上忙。`;
    case 'inconclusive':
      return (
        `料號 ${c.sku}:符合的商品太多(超過 ${MANUAL_ORDER_CATALOG_LIMIT} 筆), ` +
        '沒能確定哪一筆是它 ⇒ 這一格這次幫不上忙。打完整的料號再試一次。'
      );
    case 'check_failed':
      // 🔴 原因原樣帶上來(action 刻意把 denied 與 error 分開, 員工的下一步不同)。
      //    **不得印成「查無」** —— 那會把一個型錄品項講成代購品項, 方向剛好相反。
      return `料號 ${c.sku}:${c.message}`;
  }
}

export function ManualOrderLinePriceCheck({
  index,
  searchAction,
}: {
  index: number;
  /** 只為了測試可注入(形狀抄 `ManualOrderCatalogLookup` 的 `searchAction`)。 */
  searchAction?: (keyword: string) => Promise<ManualOrderCatalogResult>;
}) {
  const [check, setCheck] = useState<LinePriceCheck | null>(null);
  const anchor = useRef<HTMLParagraphElement | null>(null);
  /**
   * 🔴 **最後一次發問的序號**(codex must-fix)。
   * 沒有它:先送出的舊查詢**晚回來**時會蓋掉新結果;而清空欄位之後,
   * 一個還在飛的舊查詢回來會**讓已經消失的警告重新冒出來**。
   * 🎯 ⇒ **每一次改變意圖都遞增它, 只有序號還是自己的那一發才准寫 state。**
   */
  const seq = useRef(0);

  useEffect(() => {
    const form = anchor.current?.closest('form') ?? null;
    if (form === null) return;
    const skuName = manualOrderLineField(MANUAL_ORDER_LINE_SKU_BASE, index);
    const priceName = manualOrderLineField(MANUAL_ORDER_LINE_UNIT_PRICE_BASE, index);
    const basisName = manualOrderLineField(MANUAL_ORDER_LINE_TAX_BASIS_BASE, index);

    const onFocusOut = (event: Event) => {
      const target = event.target as HTMLInputElement | null;
      const name = target?.name ?? '';
      // 🔴 稅基那一格**也算一次新意圖** —— 少了它, 員工把「未稅」改成「含稅」之後
      //    畫面上那句話還停在舊稅基算出來的結論, 而**它看起來完全正常**。
      if (name !== skuName && name !== priceName && name !== basisName) return;

      // 🔴 每一次失焦都是一個新意圖 ⇒ 先遞增序號, **舊的那一發從這一刻起就作廢**。
      //    (codex must-fix:沒有它, 舊查詢晚回來會蓋掉新結果;
      //     而清空欄位之後, 一個還在飛的舊查詢會讓已經消失的警告重新冒出來。)
      const mine = (seq.current += 1);
      const settle = (next: LinePriceCheck | null) => {
        if (seq.current === mine) setCheck(next);
      };

      const read = (n: string) =>
        (form.elements.namedItem(n) as HTMLInputElement | null)?.value ?? '';
      const sku = read(skuName).trim();
      const priceRaw = read(priceName).trim();
      // 🔴 兩格都有值才問 —— 少一格就問, 會在員工還在打字時噴一句話。
      if (sku === '' || priceRaw === '') {
        settle(null);
        return;
      }
      // 🔴 **用送出解析器那把尺**(`NON_NEG_INT_RE`, 從 `manual-order-form` import)——
      //    `Number()` 會收下 `1e3` / `1000.0` / `+1000`, 而送出時那些一律被拒
      //    ⇒ 我會對一個**根本送不出去**的值說「對得上」。(codex nit)
      if (!NON_NEG_INT_RE.test(priceRaw)) {
        settle(null);
        return;
      }
      const typed = Number(priceRaw);
      // 🔴 稅基跟著同一列走。讀不到那一格(舊頁面 / 元件被單獨渲染)⇒ 當未稅,
      //    而那與加這一格之前的行為逐字相同 ⇒ **不是新的放寬**。
      const basis =
        (form.elements.namedItem(basisName) as HTMLSelectElement | null)?.value ??
        MANUAL_ORDER_LINE_TAX_BASIS_UNTAXED;
      void (async () => {
        try {
          const result = await (searchAction ?? searchManualOrderCatalogAction)(sku);
          settle(resolveLinePriceCheck(sku, typed, result, basis));
        } catch {
          settle({ kind: 'check_failed', sku, message: '查商品時出錯了,這一格沒能幫你對。' });
        }
      })();
    };

    form.addEventListener('focusout', onFocusOut);
    return () => form.removeEventListener('focusout', onFocusOut);
  }, [index, searchAction]);

  return (
    <p
      ref={anchor}
      className={
        check === null
          ? 'hidden'
          : check.kind === 'mismatch'
            ? 'col-span-12 text-sm font-medium text-amber-700 dark:text-amber-500'
            : 'text-muted-foreground col-span-12 text-sm'
      }
      /* 🔴 **沒有讀數時不掛任何 role** —— 掛著空的 `role='status'` 會讓
         每一列都多一個地標:`getByRole('status')` 當場變成 "Found multiple elements"
         (本檔第一版就是這樣弄紅了兩格**與本片無關**的既有測試)。
         🎯 ⇒ **一個無害的空元素, 在無障礙樹上不是無害的。** */
      role={check === null ? undefined : check.kind === 'mismatch' ? 'alert' : 'status'}
      data-testid={`manual-order-line-price-check-${index}`}
    >
      {check === null ? '' : linePriceCheckMessage(check)}
    </p>
  );
}
