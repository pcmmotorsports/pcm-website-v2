// @vitest-environment node
//
// ⟦b4-TAXSURFACES⟧ 第 7 步 · 客人那張紙(列印/PDF)的**稅額列與小計標籤**。
//
// 🔴🔴 **本檔守的是「兩個世界印不同的東西」** ——
//    今天每一張單的稅都是 0(價格含稅)⇒ **只驗有稅那一格的話, 今天的世界從來沒被測過**,
//    而它才是每天在跑的那一個。⇒ 兩個世界各一格, 兩格都在。
//
// 🛑 **本檔【不】量版面**(那是 `statement-cascade-browser.test.tsx` 的事, 它跑真 chromium)——
//    這裡只量**字面與有無**。⇒ 一個「稅額印在錯的位置」的實作, **本檔抓不到**。照實寫。
import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { toMoneyAmount, type MemberOrderDetail } from '@pcm/domain';
import { StatementDoc } from './statement-doc';

// 🔵 訂單樣本照抄 `statement-doc-client-boundary.test.tsx:20-58`, 不自己發明一份 ——
//    兩份 fixture 分岔時, 分岔本身不會有東西叫。
const twd = (n: number) => ({ amount: toMoneyAmount(n), currency: 'TWD' as const });
const ORDER = {
  id: 'o1',
  displayId: 'PCM-2099-0007',
  createdAt: '2099-04-15T10:00:00Z',
  paymentStatus: 'paid',
  fulfillmentStatus: 'shipped',
  paymentMethod: 'tappay',
  paymentChannel: 'tappay' as const,
  paidAt: '2099-04-18T03:00:00Z',
  shippedAt: null,
  allItemsShipped: false,
  subtotal: twd(18000),
  shippingFee: twd(100),
  discountTotal: twd(0),
  taxTotal: twd(0),
  total: twd(18100),
  balanceDue: null,   // ⟦b4-PARTIALPAIDNOWHERE⟧ null = 算不出來(不是 0)
  shippingMethod: 'home',
  shippingAddress: { name: '王小明', phone: '0912345678', line: '新北市新莊區化成路 736 巷 18 號' },
  cancelledAt: null,
  cancelKind: 'none',
  items: [0, 1, 2].map((i) => ({
    id: `oi${i}`,
    variantSku: `SKU-100${i}`,
    brand: 'CNC RACING',
    title: `下鏈條蓋 ${i}`,
    spec: { color: 'black' },
    imageUrl: null,
    vehicle: null,
    quantity: 1,
    unitPrice: twd(6000),
    lineTotal: twd(6000),
    shipped: false,
  })),
  itemCount: 3,
  itemsTruncated: false,
} as MemberOrderDetail;

const html = (o: MemberOrderDetail) => renderToStaticMarkup(<StatementDoc order={o} />);

/**
 * 🔴🔴 **有稅的樣本一定要【平衡】**(codex R3 must-fix 2)。
 *
 * ⛔ 我第一版直接 `{ ...ORDER, taxTotal: twd(905) }` 而**沿用原本的 `total` 18,100**
 *    ⇒ `subtotal + 運費 − 折扣 + 稅` 對不上 `total`
 *    ⇒ 🔴 **那種單違反 DB 的金額等式、正式庫根本寫不進去**
 *    ⇒ 📌 **我在測一個不存在的世界, 而它照樣全綠。**
 *
 * ⇒ ✅ 這支建構器**自己算 `total`**, 讓「忘了改 total」在結構上不可能發生。
 * 🛑 而它**不是**把期望值抄一遍:等式是**規格**(`⟦b4-INVOICE5PCT⟧` 的稅基定義), 不是碼算出來的。
 */
const taxed = (tax: number, discount = 0): MemberOrderDetail => ({
  ...ORDER,
  discountTotal: twd(discount),
  taxTotal: twd(tax),
  total: twd(18000 + 100 - discount + tax),
  balanceDue: null,   // ⟦b4-PARTIALPAIDNOWHERE⟧ null = 算不出來(不是 0)
});

describe('客人那張紙:稅額列與小計標籤', () => {
  it('🔵 稅 0(= 今天每一張單)⇒ 不印「稅額」', () => {
    expect(html(ORDER)).not.toContain('稅額');
  });

  it('🔴 稅 > 0 ⇒ 印出「稅額」那一列, 而值與【它那一列】綁在一起(codex R2 must-fix 3)', () => {
    // ⛔ 原本是整份 `toContain('905')` ⇒ 📌 **印成 `1,905` 也會綠, 撞到別處的 905 也會綠。**
    //    這是金額面, 不能只問「那幾個數字有沒有出現在文件裡」。
    // ✅ 改成從「稅額」那個 `<td class="k">` 往後抓**下一個 `<td class="v">` 的完整內容**。
    // 🔬 **值用【四位數】** —— 三位數的話, 「有沒有千分位」印同一個東西
    //    ⇒ 一個把 `amt()` 換掉的實作會溜過去。
    // 🔵 而紙上這一份**不印 `NT$`**(金額區的標題已經寫了「新臺幣」)——
    //    這是量到的, 不是猜的:第一版寫 `NT$ 905` 而它紅了, 實際回 `905`。
    //    📌 五個面的格式化**本來就不同**, 不要拿一份的字面去套另一份。
    const out = html(taxed(1905));
    const at = out.indexOf('<td class="k">稅額</td>');
    expect(at).toBeGreaterThan(-1);
    const m = /<td class="v">([^<]*)<\/td>/.exec(out.slice(at));
    expect(m?.[1]).toBe('1,905');
  });

  it('🔴 稅 > 0 ⇒ 金額區那個「小計」變成「小計(未稅)」', () => {
    expect(html(taxed(905))).toContain('小計(未稅)');
  });

  it('🔵 **鎖現況**:本片沒有動品項表欄頭那個「小計」(行小計)', () => {
    // 🔴🔴 **這一格鎖的是【今天的形狀】, 不是【那題的答案】**(codex R1 must-fix)。
    //    ⛔ 我第一版把它寫成「**不得**跟著變」—— 而那等於**替 Sean 選了乙**,
    //       同一片裡另一處卻寫著「這題待拍板」⇒ 📌 **兩句話互相矛盾, 而測試那句會贏。**
    //    ✅ 它今天的用途只有一個:擋住「把檔案裡每個『小計』都加後綴」那種**沒有人決定過**的改動。
    //    🛑 **Sean 若拍甲(欄頭也加), 這一格要跟著翻面** —— 而那時它會紅, 那正是要的:
    //       一個「照著新拍板改而沒有東西紅」的世界, 分不出「改對了」與「改到別的地方」。
    const out = html(taxed(905));
    expect(out).toContain('<th class="pd-num">小計</th>');
  });

  it('🔴 順序:小計 → 運費 → 折扣 → 稅額 → 訂單金額(codex R1 must-fix:原本零守門)', () => {
    // 🛑 少了這一格, **把稅額列搬到小計之前或總額之後, 其餘每一格都照樣綠** ——
    //    而客人在紙上讀到的順序是錯的。
    // 🔵 折扣要 > 0, 否則折扣那一列根本沒印 ⇒ `indexOf` 回 -1 ⇒ 這一格會拿 -1 當座標而假綠。
    //
    // 🔴🔴 **座標要縮到【金額區那一段】裡量, 不能量整份 HTML** —— 這是實測改的:
    //    「訂單金額」這四個字在**文件更前面也出現過**(位置 90442), 而金額區那個在 124273
    //    ⇒ `indexOf` 撞到前面那個 ⇒ 這一格會紅, 而**紅的理由與它要守的東西無關**。
    //    📌 **一個標籤在同一份文件裡出現兩次, 而我只想要其中一個** —— 尺沒壞, 是我沒說清楚要哪一個。
    const out = html(taxed(905, 150));
    const s0 = out.indexOf('<section class="pd-money">');
    expect(s0).toBeGreaterThan(-1); // 🟢 前提:那一段真的在(否則下面每一格都在量空字串)
    const money = out.slice(s0, out.indexOf('</section>', s0));
    const at = (t: string) => money.indexOf(t);
    expect(at('小計(未稅)')).toBeGreaterThan(-1);
    expect(at('運費')).toBeGreaterThan(at('小計(未稅)'));
    expect(at('折扣')).toBeGreaterThan(at('運費'));
    expect(at('稅額')).toBeGreaterThan(at('折扣'));
    expect(at('訂單金額')).toBeGreaterThan(at('稅額'));
  });

  // 🔴🔴 **codex R1 問「`> 0` 換成 `!== 0` 會不會全綠」—— 我去造那一格, 而【造不出來】。**
  //    🔬 實測:`twd(-1)` 在建構時就丟 `Error: MoneyAmount must be non-negative, got -1`
  //    ⇒ 📌 **負稅在這一層【結構上不存在】** —— `MoneyAmount` 是 branded type, 它自己擋掉了。
  //    ⇒ ✅ 所以那道守門住在**下一層**:`subtotal-label.test.ts` 用的是**裸 number**,
  //       而它有一格逐字驗「負數不算有稅」。**兩層各守各的, 不重複。**
  //    🛑 而這一段**不是免責聲明** —— 它答的是「為什麼這裡沒有那一格」, 且答案是量到的。

  it('🔵 負對照:稅 0 時金額區印的是原字面「小計」, 不是空的也不是未稅版', () => {
    const out = html(ORDER);
    // 🔴🔴 **綁 `<td class="k">` —— 不能只寫 `>小計<`**(R4 F3 nit, 它是對的):
    //    `>小計<` **被品項表的欄頭 `<th class="pd-num">小計</th>` 滿足**
    //    ⇒ 把金額區那個標籤整個清空, 這一格**照樣綠** ⇒ 📌 那是一個恆真的「負對照」。
    expect(out).toContain('<td class="k">小計</td>');
    expect(out).not.toContain('小計(未稅)');
  });
});
