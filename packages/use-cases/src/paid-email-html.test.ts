// paid-email-html.test.ts — 付款成功通知信 HTML 模板(A 版)
//
// 🔴 **本檔驗的是「餵資料 ⇒ 吐出正確的 HTML」,不是「信箱打開來長對」。**
//    後者要真的寄一封,而那是另一件事。⇒ 這裡每一格都只斷言字串,不斷言外觀。
//
// 🔴 而每一條硬限制都配一個【反向世界】—— 只驗「有」的那一側,
//    一個永遠印出那段的模板也會全過。

import { describe, it, expect } from 'vitest';
import type { PaidEmailContext } from '@pcm/ports';
import type { MoneyAmount } from '@pcm/domain';
import {
  renderPaidEmailHtml,
  paidEmailSubject,
  paidEmailHtmlBytes,
  GMAIL_CLIP_BYTES,
  PCM_EMAIL_LOGO_URL,
  paidEmailOrderUrl,
} from './paid-email-html';

const m = (n: number) => n as MoneyAmount;

/** 稿上那三項假資料,金額與稿一致(小計 31,120 / 運費 150 / 折扣 790 / 總計 30,480)。 */
function ctxWithDiscount(): PaidEmailContext {
  return {
    orderDisplayId: 'XMFPNH',
    linesTruncated: false,
    lines: [
      {
        title: 'Brembo 19RCS 直推式煞車總泵',
        variantSku: 'BRM-19RCS-CC',
        quantity: 1,
        lineTotal: m(18400),
      },
      { title: 'D.I.D 520ERV3 金色鏈條 120 節', variantSku: 'DID-520ERV3-120', quantity: 2, lineTotal: m(9600) },
      { title: 'Motul 300V 4T 全合成機油 5W40', variantSku: 'MOT-300V-5W40-1L', quantity: 4, lineTotal: m(3120) },
    ],
    subtotal: m(31120),
    shippingFee: m(150),
    discountTotal: m(790),
    total: m(30480),
  };
}

/** 反向世界:零折扣 + 零運費(免運)。金額仍滿足 DB 的 `total = subtotal + shipping - discount`。 */
function ctxNoDiscountFreeShipping(): PaidEmailContext {
  return {
    orderDisplayId: 'ABC123',
    linesTruncated: false,
    lines: [{ title: '單一品項', variantSku: 'SKU-1', quantity: 1, lineTotal: m(5000) }],
    subtotal: m(5000),
    shippingFee: m(0),
    discountTotal: m(0),
    total: m(5000),
  };
}

describe('付款信 HTML · 主旨', () => {
  it('固定模板 + 訂單編號,不夾客戶欄位(稿 :55)', () => {
    expect(paidEmailSubject(ctxWithDiscount())).toBe('PCM 訂單 XMFPNH 付款成功通知');
  });
});

describe('🔴 硬限制① 付款時間:拿不到就整格不印(Sean 2026-08-23 拍板)', () => {
  it('有 paidAtText ⇒ 印出「付款時間」與那個值', () => {
    const html = renderPaidEmailHtml(ctxWithDiscount(), { paidAtText: '2026-08-23 14:07' });
    expect(html).toContain('付款時間');
    expect(html).toContain('2026-08-23 14:07');
  });

  it('🔴 沒有 paidAtText ⇒ 那四個字【一次都不出現】—— 不是印空白', () => {
    const html = renderPaidEmailHtml(ctxWithDiscount(), {});
    expect(html).not.toContain('付款時間');
    // 🔵 而訂單編號那一格要吃滿寬,否則它會孤零零縮在左半邊。
    expect(html).toContain('width="100%" style="padding:14px 0;vertical-align:top;"');
  });

  it('🔵 對照:兩個世界的 HTML 必須不一樣(防「這個旗標根本沒接上」)', () => {
    const withT = renderPaidEmailHtml(ctxWithDiscount(), { paidAtText: '2026-08-23 14:07' });
    const without = renderPaidEmailHtml(ctxWithDiscount(), {});
    expect(withT).not.toBe(without);
  });
});

describe('🔴 硬限制② LOGO 外連,絕不 base64(Gmail 102KB 會剪信)', () => {
  it('給 logoUrl ⇒ 用 <img src> 外連', () => {
    const html = renderPaidEmailHtml(ctxWithDiscount(), { logoUrl: 'https://x.test/logo.png' });
    expect(html).toContain('<img src="https://x.test/logo.png"');
  });

  it('🔴 產物裡【零個】 data: URI —— 三個世界都掃(預設 / 指定 / 明確不印)', () => {
    for (const chrome of [{}, { logoUrl: 'https://x.test/logo.png' }, { logoUrl: '' }]) {
      expect(renderPaidEmailHtml(ctxWithDiscount(), chrome)).not.toContain('data:image');
    }
  });

  // ══ 🔴 期望值【翻面】(2026-09-01,LOGO 網址通了之後)═══════════════════════
  //   ⛔ ~~舊期望:沒給 logoUrl ⇒ 不吐 `<img>`~~ **作廢** —— 現在 `logoUrl` 有預設值。
  //   🔴 而這一格是**這支測試自己抓到**的:我改了預設,它當場紅,
  //      訊息說「不吐一個 src 是空的 <img>」⇒ **而真相是「現在會吐一個 src 正確的」。**
  //      📌 一個過期的期望值,它紅的時候說的是**舊世界的話** ——
  //         而看的人會照那句話去找一個不存在的缺陷。(同一片裡第三次了。)
  it('不給 logoUrl ⇒ 用預設那個網址(LOGO 是站台常數,不是每封信不同)', () => {
    const html = renderPaidEmailHtml(ctxWithDiscount(), {});
    expect(html).toContain(`<img src="${PCM_EMAIL_LOGO_URL}"`);
  });

  it('🔴 要【明確不印 LOGO】⇒ 傳空字串(不是 undefined —— 那會拿到預設)', () => {
    const html = renderPaidEmailHtml(ctxWithDiscount(), { logoUrl: '' });
    expect(html).not.toContain('<img');
  });

  it('🔵 而 undefined 與空字串【必須給出不同結果】—— 否則那個區分只是註解', () => {
    const a = renderPaidEmailHtml(ctxWithDiscount(), { logoUrl: undefined });
    const b = renderPaidEmailHtml(ctxWithDiscount(), { logoUrl: '' });
    expect(a).not.toBe(b);
    expect(a).toContain('<img');
    expect(b).not.toContain('<img');
  });

  it('🔴 預設那個網址是 https 且不是 shop.(Sean 拍板用 www —— shop 之後會移轉)', () => {
    expect(PCM_EMAIL_LOGO_URL).toMatch(/^https:\/\/www\.pcmmotorsports\.com\//);
    expect(PCM_EMAIL_LOGO_URL).not.toContain('shop.');
  });
});

describe('🔴 硬限制③ table + inline style,不退回 div + style', () => {
  it('骨架是 table,且 <style> 裡只有 @media', () => {
    const html = renderPaidEmailHtml(ctxWithDiscount(), {});
    const styleBlock = html.slice(html.indexOf('<style>'), html.indexOf('</style>'));
    // <style> 內的每一條規則都必須包在 @media 裡 ⇒ 被 Gmail 砍掉也不影響可讀性
    expect(styleBlock.replace(/@media[^{]*\{[\s\S]*?\}\s*\}/g, '').trim()).toBe('<style>');
    expect(html).toContain('role="presentation"');
    expect(html).toContain('prefers-color-scheme:dark');
  });
});

describe('🔴 稿上那句「PDF 已附在這封信裡」是事實宣稱,預設不印', () => {
  it('預設 ⇒ 不印(沒附 PDF 卻說有 = 在信裡對客人說假話)', () => {
    expect(renderPaidEmailHtml(ctxWithDiscount(), {})).not.toContain('PDF 已附在這封信裡');
  });
  it('明確說有附 ⇒ 才印', () => {
    const html = renderPaidEmailHtml(ctxWithDiscount(), { hasPdfAttachment: true });
    expect(html).toContain('訂單明細 PDF 已附在這封信裡');
  });
});

describe('🔴 CTA 網址 · paidEmailOrderUrl —— 而它與 LOGO 的取捨【方向相反】', () => {
  it('有基底 ⇒ 組出訂單頁網址', () => {
    expect(paidEmailOrderUrl('https://shop.pcmmotorsports.com', 'XMFPNH')).toBe(
      'https://shop.pcmmotorsports.com/account/orders/XMFPNH',
    );
  });

  it('🔴 基底沒設(env 未設 ⇒ resolveSiteUrl 回 undefined)⇒ 回 undefined ⇒ 那顆鈕不印', () => {
    expect(paidEmailOrderUrl(undefined, 'XMFPNH')).toBeUndefined();
  });

  it('🔴 基底不是絕對 http(s) ⇒ 也回 undefined —— 不是組一個半截網址', () => {
    // 📌 一個半截網址會變成【點得下去而到不了】的鈕,而那比沒有鈕糟。
    for (const bad of ['', '   ', 'pcmmotorsports.com', '/account', 'ftp://x.test']) {
      expect(paidEmailOrderUrl(bad, 'XMFPNH')).toBeUndefined();
    }
  });

  it('尾斜線不會變成雙斜線', () => {
    expect(paidEmailOrderUrl('https://x.test///', 'AB1')).toBe('https://x.test/account/orders/AB1');
  });

  it('🔴 單號進網址要 encode(今天的產號是 [A-Z0-9],而那是產號規則不是欄位約束)', () => {
    expect(paidEmailOrderUrl('https://x.test', 'A B/C?')).toBe(
      'https://x.test/account/orders/A%20B%2FC%3F',
    );
  });

  it('🔵 端到端:env 沒設 ⇒ 整封信裡沒有那顆鈕;有設 ⇒ 有,而兩份不一樣', () => {
    const off = renderPaidEmailHtml(ctxWithDiscount(), {
      orderUrl: paidEmailOrderUrl(undefined, 'XMFPNH'),
    });
    const on = renderPaidEmailHtml(ctxWithDiscount(), {
      orderUrl: paidEmailOrderUrl('https://shop.pcmmotorsports.com', 'XMFPNH'),
    });
    expect(off).not.toContain('到會員中心查看訂單');
    expect(on).toContain('href="https://shop.pcmmotorsports.com/account/orders/XMFPNH"');
    expect(off).not.toBe(on);
  });
});

describe('🔴 一顆連到空網址的按鈕比沒有按鈕糟', () => {
  it('沒給 orderUrl ⇒ 整顆鈕不印', () => {
    expect(renderPaidEmailHtml(ctxWithDiscount(), {})).not.toContain('到會員中心查看訂單');
  });
  it('給了 ⇒ 印,而 href 就是傳進來的那個', () => {
    const html = renderPaidEmailHtml(ctxWithDiscount(), { orderUrl: 'https://p.test/o/XMFPNH' });
    expect(html).toContain('href="https://p.test/o/XMFPNH"');
  });
});

describe('金額四列(對齊稿的小計/運費/折扣/訂單金額)', () => {
  it('有折扣 ⇒ 四列齊,折扣帶負號(負號是模板加的,資料是正值)', () => {
    const html = renderPaidEmailHtml(ctxWithDiscount(), {});
    expect(html).toContain('31,120');
    expect(html).toContain('>150<');
    expect(html).toContain('−790');
    expect(html).toContain('30,480');
  });

  it('🔴 零折扣 ⇒ 折扣那一列【整列不印】(印「−0」會讓客人以為有一筆沒看到的折抵)', () => {
    const html = renderPaidEmailHtml(ctxNoDiscountFreeShipping(), {});
    expect(html).not.toContain('折扣');
    expect(html).not.toContain('−0');
  });

  it('🔴 而零運費【照印】—— 與折扣不同族:免運是客人想確認的一件事', () => {
    const html = renderPaidEmailHtml(ctxNoDiscountFreeShipping(), {});
    expect(html).toContain('運費');
    expect(html).toContain('>0<');
  });

  it('🔵 對照:兩個世界的 HTML 必須不一樣', () => {
    expect(renderPaidEmailHtml(ctxWithDiscount(), {})).not.toBe(
      renderPaidEmailHtml(ctxNoDiscountFreeShipping(), {}),
    );
  });
});

describe('品項表', () => {
  it('三項 ⇒ 三個品名、三個料號、三個小計都在', () => {
    const html = renderPaidEmailHtml(ctxWithDiscount(), {});
    expect(html).toContain('Brembo 19RCS 直推式煞車總泵');
    expect(html).toContain('BRM-19RCS-CC');
    expect(html).toContain('MOT-300V-5W40-1L');
    expect(html).toContain('18,400');
  });

  it('🔴 品名是 null ⇒ 印看得出來的字,不是空白(空白那列與「只有兩項」長得一樣)', () => {
    const c = ctxWithDiscount();
    c.lines[0]!.title = null;
    c.lines[0]!.variantSku = null;
    const html = renderPaidEmailHtml(c, {});
    expect(html).toContain('(品名未記錄)');
  });

  it('🔴 品名含 HTML ⇒ 逃逸(品名是供應商匯入 / 員工手打的外部資料)', () => {
    const c = ctxWithDiscount();
    c.lines[0]!.title = '<script>alert(1)</script>&"x"';
    const html = renderPaidEmailHtml(c, {});
    expect(html).not.toContain('<script>');
    expect(html).toContain('&lt;script&gt;');
    expect(html).toContain('&amp;');
  });
});

describe('🔴 Gmail 102KB:本檔只量,不擋', () => {
  it('稿那三項的信 ⇒ 遠低於門檻', () => {
    const bytes = paidEmailHtmlBytes(
      renderPaidEmailHtml(ctxWithDiscount(), {
        paidAtText: '2026-08-23 14:07',
        logoUrl: 'https://x.test/logo.png',
        orderUrl: 'https://p.test/o/XMFPNH',
        hasPdfAttachment: true,
      }),
    );
    expect(bytes).toBeLessThan(GMAIL_CLIP_BYTES);
    expect(bytes).toBeGreaterThan(3000); // 🔵 下界:防「吐出一個空字串也會過」
  });

  it('🔴 而它【會】超過 —— 品項夠多的時候。門檻不是理論值', () => {
    const c = ctxWithDiscount();
    c.lines = Array.from({ length: 400 }, (_, i) => ({
      title: `品項 ${i} 這是一個比較長的品名用來逼近真實情況`,
      variantSku: `SKU-${i}-LONG-CODE`,
      quantity: 1,
      lineTotal: m(100),
    }));
    expect(paidEmailHtmlBytes(renderPaidEmailHtml(c, {}))).toBeGreaterThan(GMAIL_CLIP_BYTES);
  });
});

// ══ 🔴 標籤平衡 —— 而它補的是【現有這些測試結構上驗不到】的那一族 ═══════════
//   上面每一格驗的都是「某個字串在不在」⇒ **少一個 `</table>` 它們一個都不會紅**,
//   而那在信箱裡是整段版面塌掉(email client 的容錯比瀏覽器差很多)。
//   🛑 而本 repo **零 snapshot 用法**(實掃 `toMatchSnapshot|toMatchInlineSnapshot` ⇒ 0 處,
//      🔵 負對照 現造 API 名 ⇒ 0)⇒ 我不引入新慣例,改驗一個**性質**而不是一份固定值。
//      📌 差別:snapshot 在任何改動都會紅(含刻意的);性質只在【真的壞掉】時紅。
function tagCounts(html: string, tag: string): { open: number; close: number } {
  return {
    open: (html.match(new RegExp(`<${tag}[ >]`, 'g')) ?? []).length,
    close: (html.match(new RegExp(`</${tag}>`, 'g')) ?? []).length,
  };
}

describe('🔴 產物是【結構完整的】—— 而上面每一格都驗不到這件事', () => {
  const TAGS = ['table', 'tr', 'td', 'div', 'a', 'span'] as const;

  it.each(TAGS)('%s 的開闔數相等（三個世界都要平衡）', (tag) => {
    for (const [ctx, chrome] of [
      [ctxWithDiscount(), {}],
      [ctxNoDiscountFreeShipping(), {}],
      [
        ctxWithDiscount(),
        {
          paidAtText: '2026-08-23 14:07',
          orderUrl: 'https://x.test/o/X',
          hasPdfAttachment: true,
        },
      ],
    ] as const) {
      const { open, close } = tagCounts(renderPaidEmailHtml(ctx, chrome), tag);
      expect(open, `<${tag}> 開 ${open} 闔 ${close}`).toBe(close);
    }
  });

  // 🔵🔵 **這把尺自己的判別力** —— 沒有這一格,一個永遠回 `{open:0, close:0}` 的
  //    `tagCounts` 也會讓上面全過(0 === 0)。
  it('🔵 對照:這把尺在【真的不平衡】時會叫,在【平衡】時不叫', () => {
    expect(tagCounts('<table><tr></tr>', 'table')).toEqual({ open: 1, close: 0 });
    expect(tagCounts('<table></table>', 'table')).toEqual({ open: 1, close: 1 });
    // 🔴 而它【數得到東西】—— 防「正規式壞了 ⇒ 兩邊都 0 ⇒ 恆等」
    const real = tagCounts(renderPaidEmailHtml(ctxWithDiscount(), {}), 'table');
    expect(real.open).toBeGreaterThan(5);
  });

  it('🔴 每個 <a> 都有 href,而且是絕對 http(s) —— 信裡的相對連結一定是死的', () => {
    const html = renderPaidEmailHtml(ctxWithDiscount(), { orderUrl: 'https://x.test/o/X' });
    const hrefs = [...html.matchAll(/<a\s[^>]*href="([^"]*)"/g)].map((mm) => mm[1]!);
    expect(hrefs.length).toBeGreaterThan(0); // 🔵 防「一個都沒抓到 ⇒ 下面的迴圈空轉」
    for (const h of hrefs) expect(h).toMatch(/^https?:\/\//);
  });

  it('🔴 <style> 只有一個,而 <body> 裡零個 —— 信箱只認 <head> 裡那一個', () => {
    const html = renderPaidEmailHtml(ctxWithDiscount(), {});
    expect((html.match(/<style>/g) ?? []).length).toBe(1);
    expect(html.slice(html.indexOf('<body')).includes('<style')).toBe(false);
  });
});

describe('🛑 本模板【不】檢查 linesTruncated —— 那是呼叫端的 fail-closed 責任', () => {
  it('linesTruncated=true 照樣吐得出來(而呼叫端必須不寄)', () => {
    const c = ctxWithDiscount();
    c.linesTruncated = true;
    // 📌 這一格記錄的是【責任在哪】,不是「這樣做是對的」。
    //    型別檔 :63-64 逐字要求呼叫端 fail-closed;若改成這裡丟例外,
    //    那道保護會變成「模板有沒有被呼叫到」的副作用,而那不可靠。
    expect(() => renderPaidEmailHtml(c, {})).not.toThrow();
  });
});
