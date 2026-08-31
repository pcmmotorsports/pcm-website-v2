import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * 板 `⟦b4-PROJDOC1⟧` 的機制:**「會員訂單列表投影含哪些欄」這個事實住在四個地方, 而四個都是
 * docstring ⇒ 不在測試的分母裡、不在 lint 的分母裡 ⇒ 只有【讀的人】抓得到。**
 * 2026-08-29 擴欄時實際發生過:改了三處、漏了第四處(是 codex R2 抓到的),
 * 而**每一次漏掉的都是「不是我正在看的那一個」**。
 *
 * 🛑 **本檔【不做】那一列寫的「收斂成單一來源、其餘三處指過去」** —— 理由是規則, 不是偷懶:
 *    `CLAUDE.md` 鐵則 6 逐字「**不得以壓縮/刪減註解作為降行手段** —— 那些註解裡住著 Sean 的拍板紀錄」,
 *    而那四段裡有拍板(2026-08-29 卡片商品列)、有鐵則 12 的白名單理由、有 `#217` 的繞過理由。
 *    📌 **⇒ 收斂 = 從三處刪字, 而刪註解與搬註解在 diff 上長得一樣、三綠全綠。**
 *    ⇒ **所以這裡做的是【讓漂移看得見】, 不是【讓副本消失】。**
 *
 * ✅ **機制:共同編輯閘。** 把「投影字串」與「四個落點各自那段文字」一起雜湊。
 *    改了投影卻沒有回去看那四段 ⇒ 雜湊對不上 ⇒ **紅, 而失敗訊息把四個落點列出來。**
 *    🔴 **它不要求你【改】那四段** —— 它要求你**去看過**, 然後把新的雜湊貼回來。
 *       (⇒ 一個只能靠「讀過」才滿足得了的閘;而那正是這一族缺的東西。)
 *
 * 🛑 **射程(照實)**:
 *    · 它擋不住「看了但沒看懂」—— 貼一個新雜湊比讀四段便宜, **這是它的天花板**。
 *    · ⛔ ~~它只涵蓋這 4 個落點~~ ⇒ 🔵 **對抗審查訂正:第一版涵蓋的是【錨點附近的固定窗口】,
 *      而落點④ 一行都沒被蓋到、落點③ 蓋 docstring 不蓋型別、①② 之間有 39 行黑洞,
 *      同時多蓋了約 109 行不相干的 import。**⇒ 那句話讓讀者放棄自己確認, 而它宣稱的保護有一格是零。
 *      ✅ **現在改成起訖錨, 而【實際框到哪幾行由程式自己印在失敗訊息裡】** —— 射程不用手寫的形容詞講。
 *    · **第 5 個落點出現時沒有東西會提醒人**(同 `TARGETS` 那族)。
 *    · 🔴 **投影字串那一半本來就有守門**(`SupabaseOrderAdapter.test.ts:216` 是 byte-equal 斷言)
 *      ⇒ **本閘對「投影字串被改」的邊際價值是 0**;它獨有的覆蓋是**那三段文字**。
 *    · 它比對的是**文字**, 答不出「這四段講的是不是同一件事」。
 */

const ROOT = path.resolve(__dirname, '../../../..');
const ADAPTER = path.join(ROOT, 'packages/adapters/src/supabase/SupabaseOrderAdapter.ts');
const MAPPER = path.join(ROOT, 'packages/adapters/src/supabase/mappers/order.ts');
const PORT = path.join(ROOT, 'packages/ports/src/IOrderRepository.ts');

/**
 * 三個落點, 各自用**起訖兩個錨**框出來 —— 不是「錨點 ±N 行」。
 *
 * 🔴🔴 **第一版用 `錨點前 40 行 + 後 6 行`, 而對抗審查證明那是【錯的窗口】**:
 *  · 落點④ 的錨 `listSummariesByCustomer` 在那支檔出現 **7 次**, `findIndex` 取第一個(`:63`)
 *    ⇒ 框到的是 `findById` 的 docstring ⇒ **真正的第四落點(`:70-84`)一行都沒被雜湊到**。
 *    🛑 **而我當時的突變②「只動第四個落點 ⇒ 紅」是【對的紅、錯的理由】** —— 那一發落在窗口內
 *    的別段文字上。📌 **⇒ 一個突變測試可以【給對顏色而理由是錯的】, 而顏色是我唯一看的東西。**
 *  · 落點③ 的型別本體(`:179-208`, **正是 2026-08-29 加的那三樣欄**)在窗外 ⇒ 插一行 `unit_price` 不會紅。
 *  · 落點①② 其實是**同一段** docstring(`:61-146`), 而兩個窗口之間留下 **39 行黑洞** ——
 *    黑洞裡住著「`unit_price` 仍然不取」與 Sean `#249` 的拍板逐字, 改掉它們**不會紅**。
 *  · 而窗口①的 46 行裡 **39 行是 import** ⇒ **改一行 import 就會叫人「去讀那四段」**
 *    ⇒ 📌 **那正是本 repo 自己說的「規律誤報會訓練人略過這道閘」。**
 *
 * ✅ **改成起訖錨**:雜湊的內容 = 那三段本身, 沒有 import、沒有隔壁函式、沒有黑洞。
 *    而**實際框到哪幾行由程式自己印出來**(見失敗訊息)—— 射程不用手寫的形容詞講。
 */
const SITES = [
  {
    label: '① adapter:投影 docstring + ORDER_LIST_SELECT 常數本身',
    file: ADAPTER,
    from: 'orders 摘要投影白名單',
    to: 'export const ORDER_LIST_SELECT',
    toOffset: 2, // 常數的值在下一行
    must: 'unit_price',
  },
  {
    label: '③ mappers/order.ts:SupabaseOrderListRow 的 docstring + 型別本體',
    file: MAPPER,
    from: '摘要讀 row 型別',
    to: 'export type SupabaseOrderListRow',
    toOffset: 32, // 型別本體(含 order_items 那段)
    must: 'product_snapshot',
  },
  {
    label: '④ ports:listSummariesByCustomer 的介面契約',
    file: PORT,
    // 🔴 `to` 一定要帶參數 —— 光是 `listSummariesByCustomer` 在該檔命中 7 次
    from: '列出某會員訂單「摘要」',
    to: 'listSummariesByCustomer(customerId',
    toOffset: 1,
    must: 'OrderListItem',
  },
] as const;

type Site = (typeof SITES)[number];

/** 回 `{ text, first, last }` —— 行號一起回來, 好讓失敗訊息把【真正框到哪裡】印出去。 */
function block(s: Site): { text: string; first: number; last: number } {
  const lines = readFileSync(s.file, 'utf8').split('\n');
  const a = lines.findIndex((l) => l.includes(s.from));
  if (a < 0) throw new Error(`${path.basename(s.file)} 找不到起錨「${s.from}」—— 這把尺沒有接上`);
  const rel = lines.slice(a).findIndex((l) => l.includes(s.to));
  if (rel < 0) throw new Error(`${path.basename(s.file)} 找不到訖錨「${s.to}」—— 這把尺沒有接上`);
  const b = Math.min(a + rel + s.toOffset, lines.length);
  return { text: lines.slice(a, b).join('\n'), first: a + 1, last: b };
}

const sha = (t: string) => createHash('sha256').update(t, 'utf8').digest('hex').slice(0, 12);

/** 🔴 改了那三段之後, 把跑出來的新值貼回這裡 —— 而**貼之前請把它印出來的那幾行讀過**。 */
const PINNED = '643f185cc39c';
// 🔵 **2026-08-31 `-08` 釘它時, 三段【真的讀過了】, 而【讀了哪幾行】留在這裡**
//    (對抗審查點的:「讀過了」不可驗我不打你, 可打的是**沒留讀了哪幾行** ——
//     下一個貼新雜湊的人會分不出這次的變動落在窗內還是窗外):
//      SupabaseOrderAdapter.ts:62-148 · mappers/order.ts:163-210 · IOrderRepository.ts:71-84
//    讀完確認今天一致:`unit_price` **仍然不取**;`line_total` / `product_snapshot` /
//    variant images 自 2026-08-29 Sean 拍板起進了投影;`cancelled_reason` **投影出來只給伺服器用**
//    (原文不進瀏覽器, 守門在 `mappers/order.test.ts`);鐵則 12 的白名單三段都在。
// 🔴 而落點③ 自己逐字寫著「**留原句在這裡是刻意的**」
//    ⇒ 📌 那句話就是「不要收斂成單一來源」的現場證據, 而它是被收斂的那一方自己寫的。

describe('會員訂單列表投影:落點共同編輯閘(⟦b4-PROJDOC1⟧)', () => {
  it('🔵 前提:每個落點都框到【它自己那一段】(不是恆真的「有抓到東西」)', () => {
    // 🔴 第一版這一格是 `length > 200` ⇒ 落點④ 框到 2005 字元【完全錯的內容】照樣過。
    //    ⇒ 📌 「錨存在」與「框到的是那一段」是兩個宣稱。改成各要一個**該落點獨有**的字面。
    for (const s of SITES) {
      const b = block(s);
      expect(b.text, `${s.label} 框到的是空的`).not.toBe('');
      expect(
        b.text.includes(s.must),
        `${s.label} 框到 ${path.relative(ROOT, s.file)}:${b.first}-${b.last}, ` +
          `而裡面沒有它獨有的字面「${s.must}」⇒ 窗口框錯地方了。`,
      ).toBe(true);
    }
  });

  it('🔴 那三段變了 ⇒ 這一格要紅, 而你要【回去讀它印出來的那幾行】再貼新值', () => {
    const blocks = SITES.map((s) => ({ s, b: block(s) }));
    const combined = blocks.map(({ b }) => b.text).join('\n===\n');
    expect(
      sha(combined),
      '「會員訂單列表投影含哪些欄」這個事實住在下面這幾段, 而它們之中有東西變了:\n' +
        blocks
          .map(({ s, b }) => `  ${s.label}\n      ${path.relative(ROOT, s.file)}:${b.first}-${b.last}`)
          .join('\n') +
        '\n⇒ 🔴 **請把上面那幾行讀過**, 確認它們講的還是同一件事, 再把新雜湊貼回 PINNED。\n' +
        '⇒ 2026-08-29 實際發生過:改了三處、漏了第四處, 而漏掉的是「不是我正在看的那一個」。\n' +
        '🛑 而本閘擋不住「看了但沒看懂」—— 貼一個新雜湊比讀那幾行便宜。**那是它的天花板。**',
    ).toBe(PINNED);
  });
});
