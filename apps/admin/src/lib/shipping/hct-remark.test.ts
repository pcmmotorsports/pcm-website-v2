import { describe, expect, it } from 'vitest';
import { buildHctRemark, HCT_REMARK_MAX_BYTES, HCT_REMARK_SKU_MAX_CODEPOINTS } from './hct-remark';

const utf8 = (s: string) => new TextEncoder().encode(s).length;
const P = (o: Partial<Parameters<typeof buildHctRemark>[0]> = {}) => ({
  orderDisplayIds: ['CH6D75'],
  firstItemName: '前叉油封',
  firstItemSku: 'SKU-1234',
  itemCount: 1,
  ...o,
});

describe('⟦ship-HCTREMARK⟧ 三種形狀(Sean 2026-09-10 逐字)', () => {
  it('🟢 單單單項', () => {
    expect(buildHctRemark(P())).toBe('[PCM] CH6D75 前叉油封 SKU-1234');
  });

  it('🟢 多品項 ⇒ 帶「等共 N 項」(主視窗採用甲:司機要的是【這箱是誰的】)', () => {
    expect(buildHctRemark(P({ itemCount: 3 }))).toBe('[PCM] CH6D75 前叉油封 SKU-1234 等共 3 項');
  });

  it('🟢 多張訂單 ⇒ 帶「等 N 單」', () => {
    expect(buildHctRemark(P({ orderDisplayIds: ['CH6D75', 'C8MYDB'] }))).toBe(
      '[PCM] CH6D75 等 2 單 前叉油封 SKU-1234',
    );
  });

  it('🛑 **一單多箱時兩箱的備註【就是會長一樣】** —— 而那不是 bug, 是本格式沒有箱號', () => {
    // 🔴 承重:這一格把一個【已經發生過的事實】釘住(XS6XVY 與 ZN2HDP 都對到 C8MYDB)。
    //    要它分得出箱子, 是「加一個欄位」的決定, 不是本片的判斷 ——
    //    而箱號印在標籤的另一格, 司機分得出來, 只是不靠這一行。
    const a = buildHctRemark(P({ orderDisplayIds: ['C8MYDB'] }));
    const b = buildHctRemark(P({ orderDisplayIds: ['C8MYDB'] }));
    expect(a).toBe(b);
  });
});

describe('⟦ship-HCTREMARK⟧ 砍的順序 —— 訂單編號永遠不砍', () => {
  it('🔴🔴 **codex R1 那個輸入:料號 90 字 + 3 項 ⇒ 「等共 3 項」【不准消失】**', () => {
    // 🔴 承重:舊設計把後綴放在骨架尾巴 ⇒ 長料號會把它整個擠掉
    //    ⇒ 紙上只剩 `[PCM] CH6D75 ` + 88 個 S ⇒ 司機不知道這箱有三樣東西。
    //    ⚠️ 而手動建單【不限制料號長度】⇒ 這個輸入真的進得來。
    const out = buildHctRemark(P({ firstItemSku: 'S'.repeat(90), itemCount: 3 }));
    expect(out, '骨架不可砍').toContain('CH6D75');
    expect(out, '項數與訂單編號同級').toContain('等共 3 項');
    expect(utf8(out)).toBeLessThanOrEqual(HCT_REMARK_MAX_BYTES);
    // 🔵 而料號【砍的是自己】—— 24 碼點上限, 它不吃別人的額度。
    expect(out).toContain('S'.repeat(HCT_REMARK_SKU_MAX_CODEPOINTS));
    expect(out).not.toContain('S'.repeat(HCT_REMARK_SKU_MAX_CODEPOINTS + 1));
  });

  it('🔴 超長商品名 ⇒ 砍商品名, 而骨架與料號都活著', () => {
    const out = buildHctRemark(P({ firstItemName: '前'.repeat(200), itemCount: 3 }));
    expect(utf8(out)).toBeLessThanOrEqual(HCT_REMARK_MAX_BYTES);
    expect(out).toContain('CH6D75');
    expect(out).toContain('等共 3 項');
    expect(out).toContain('SKU-1234');
  });

  it('🔴 查不到訂單 ⇒ **回空字串**, 不回一個只有 `[PCM]` 的殼', () => {
    // 🔴 承重:一張只印 `[PCM]` 的紙, 比空白更容易被讀成「系統壞了」。
    expect(buildHctRemark(P({ orderDisplayIds: [] }))).toBe('');
  });
});

describe('⟦ship-HCTREMARK⟧ 🔴 第二個坑:料號不准被當成【指令】(codex R2)', () => {
  it('🔴🔴 **料號含 `$&` ⇒ 逐字送出去, 不准被展開**', () => {
    // 🔴 承重:舊版用 out.replace(後綴, ' 料號' + 後綴) 把料號插進去
    //    ⇒ 替換字串裡的 `$&` 是「剛才匹配到的那一段」⇒ 它展開成後綴
    //    ⇒ [PCM] CH6D75 前叉油封 SKU- 等共 3 項 等共 3 項 —— 料號被吃掉一半, 項數印兩次。
    //    ⚠️ 而手動建單【允許】那種料號 ⇒ 那是一個真的會送出去的錯字。
    const out = buildHctRemark(P({ firstItemSku: 'SKU-$&', itemCount: 3 }));
    expect(out).toBe('[PCM] CH6D75 前叉油封 SKU-$& 等共 3 項');
  });

  it('🔴 `$$` / `` $` `` / `$\'` 同族 —— 一律逐字', () => {
    for (const sku of ['A$$B', 'A$`B', "A$'B", 'A$1B']) {
      const out = buildHctRemark(P({ firstItemSku: sku, itemCount: 2 }));
      expect(out, sku).toContain(sku);
      // 🔵 而項數只准出現一次。
      expect(out.split('等共').length - 1, sku).toBe(1);
    }
  });

  it('🔵 訂單編號與品名裡有同樣的字元也一樣逐字', () => {
    const out = buildHctRemark(P({ orderDisplayIds: ['A$&B'], firstItemName: 'X$&Y' }));
    expect(out).toBe('[PCM] A$&B X$&Y SKU-1234');
  });
});

describe('⟦ship-HCTREMARK⟧ 🔴 那個坑:代理對不准被切半', () => {
  it('🔴🔴 **商品名裡有 emoji 而剛好砍在它身上 ⇒ 不得產生孤兒 surrogate**', () => {
    // 🔴 承重:孤兒 surrogate 穿得過 xmlEscape ⇒ not-well-formed 信封 ⇒ 那一箱卡成 unknown。
    for (let n = 1; n <= 60; n += 1) {
      const out = buildHctRemark(P({ firstItemName: '🚚'.repeat(n) }));
      expect(utf8(out), `n=${String(n)}`).toBeLessThanOrEqual(HCT_REMARK_MAX_BYTES);
      // 🔵 判準:字串裡不得有落單的高位/低位代理。
      expect(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/u.test(out), `n=${String(n)}`).toBe(false);
    }
  });

  it('🔵 正對照:同樣的輸入用 `slice()` 砍【會】切出孤兒 —— 證明上面那格不是恆真', () => {
    // 📌 這一格演的是【我們沒有做的那個做法】, 它證明那個坑是真的。
    const bad = '🚚'.repeat(60).slice(0, 51);
    expect(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])/u.test(bad), 'slice 應該切出孤兒').toBe(true);
  });
});

describe('⟦ship-HCTREMARK⟧ 🔴 第三個坑:回報的與送出的要是同一串(codex R3)', () => {
  const FFFF = '\uFFFF';

  it('🔴🔴 **傳輸層會刪掉的字元, 組的時候就剝掉** —— 否則回報與事實分岔', () => {
    // 🔴 承重:hct-client 的 xmlEscape 在組 SOAP 時丟掉 C0 與 U+FFFE/FFFF
    //    ⇒ 舊版我們回報帶著它, 而實際送出去的沒有 ⇒ 料號在途中被改字。
    //    ⚠️ 而手動建單【沒有禁止】那個字元。
    const out = buildHctRemark(P({ firstItemSku: `SKU-A${FFFF}B`, itemCount: 3 }));
    expect(out).toBe('[PCM] CH6D75 前叉油封 SKU-AB 等共 3 項');
  });

  it('🔴 C0 控制字元同族 —— 而 \\t \\n \\r 是合法的, 不在字集裡', () => {
    expect(buildHctRemark(P({ firstItemName: `A\u0001B` }))).toContain('AB');
    expect(buildHctRemark(P({ firstItemName: 'A\tB' })), 'tab 不該被剝').toContain('A\tB');
  });

  it('🔵 先剝再砍 —— 剝完的長度才是真的長度', () => {
    const out = buildHctRemark(P({ firstItemSku: `${'S'.repeat(12)}${FFFF}${'S'.repeat(13)}` }));
    expect(out).toContain('S'.repeat(24));
    expect(out).not.toContain('S'.repeat(25));
  });
});

describe('⟦ship-HCTREMARK⟧ 🔴 第四個坑:少報的數字與正確的數字長一樣(codex R4)', () => {
  it('🔴🔴 **訂單清單被截斷 ⇒ 印「以上」, 不准印一個看起來確定的數字**', () => {
    // 🔴 承重:一個下界與一個確定值在紙上長一樣, 而司機無從分辨。
    const out = buildHctRemark(P({ orderDisplayIds: ['CH6D75'], ordersMaybeIncomplete: true }));
    expect(out).toContain('等 1 單以上');
  });

  it('🔵 沒被截斷 ⇒ 單張訂單就是單張, 不加任何後綴', () => {
    expect(buildHctRemark(P({ ordersMaybeIncomplete: false }))).toBe(
      '[PCM] CH6D75 前叉油封 SKU-1234',
    );
    // 🔵 而缺這一格(舊呼叫端)⇒ 當成沒截斷, 與上一行同結果。
    expect(buildHctRemark(P())).toBe('[PCM] CH6D75 前叉油封 SKU-1234');
  });

  it('🔵 多張訂單 + 被截斷 ⇒ 兩件事都講', () => {
    const out = buildHctRemark(
      P({ orderDisplayIds: ['CH6D75', 'C8MYDB'], ordersMaybeIncomplete: true }),
    );
    expect(out).toContain('等 2 單以上');
  });
});
