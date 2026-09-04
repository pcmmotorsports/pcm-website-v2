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
  assertPdfClaimMatchesAttachments,
  PAID_EMAIL_PDF_ATTACHED_SENTENCE,
} from './paid-email-html';
import {
  orderAmountsBalance,
  ORDER_PAID_HTML_LEAD_SENTENCE,
  ORDER_PAID_NEXT_STEP_SENTENCE,
  ORDER_CONTACT_LEAD,
  PCM_COMPANY_ADDRESS,
  PCM_COMPANY_LINE,
  PCM_LINE_ID,
  PCM_LINE_URL,
} from './order-email-copy';

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
    taxTotal: m(0),   // 今天恆為 0
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
    taxTotal: m(0),   // 今天恆為 0
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

describe('🔴 排版那份的頁尾對外字面【要有鎖】—— 而它今天沒有', () => {
  // 🔴🔴 **這一族的存在理由**:我 2026-09-03 把「回覆這封信」那半句從共用常數拿掉
  //    (Sean 答那個信箱沒人收)⇒ **1,001 格全綠, 一格都沒紅。**
  //    ⇒ 📌 **一句寄給每一個客人、而且收不回來的話, 可以被安靜地改掉。**
  //    ⇒ 🎯 純文字那半有 exact-match 鎖(`sweep-email-outbox.test.ts` 的 `EXPECTED_..._BODY`),
  //      **而排版那半沒有** —— 兩份的保護不對稱, 而沒有東西指出這件事。
  // 🛑 **本格不做 exact-match 整封 HTML**(那會被每一次 style 微調弄紅、然後被人改成寬鬆的)——
  //    只釘**客人讀得到的那幾句**與**它們的字面來源**。
  it('🔴 頁尾三樣都在, 而且來自共用常數(不是這裡重打一份)', () => {
    const html = renderPaidEmailHtml(ctxWithDiscount(), {});
    for (const s of [ORDER_CONTACT_LEAD, PCM_LINE_ID, PCM_LINE_URL, PCM_COMPANY_LINE, PCM_COMPANY_ADDRESS]) {
      expect(html).toContain(s);
    }
  });

  it('🔴 而「回覆這封信」今天【不得出現】—— 那個信箱沒有人收(Sean 2026-09-03 答 A3)', () => {
    const html = renderPaidEmailHtml(ctxWithDiscount(), {});
    expect(html).not.toContain('回覆這封信');
    // 🔵 而它【會回來】:`info@` alias + Resend reply-to 上線之後(板列 ⟦b4-REPLYTO1⟧, 態 parked)
    //    ⇒ 那一天這一格要跟著改, 而**它會紅** —— 那正是我要的:加回來的人被迫看到這一段。
  });
});

describe('🔴 內網位址不進客人的信(codex 對抗審查 must-fix;而這道閘【原本零測試】)', () => {
  // 🔴🔴 **這一族的存在理由是一發【活下來的突變】**:我把 `if (isLoopbackOrPrivate)` 改成
  //    `if (false)` ⇒ **119 格全綠。** ⇒ 📌 **那道閘擋的是「真客人收到內網連結」, 而沒有任何東西在證它。**
  //    ⇒ 「尺會動」與「尺接在路徑上」是兩個宣稱 —— 而這一格連前者都還沒證過。
  //
  // ⚠️ **失敗路徑是真的**:`lib/site-url.ts:27` 在非 production 且缺 env 時回
  //    `'http://localhost:3000'`(**不是 `undefined`**)⇒ 有人在本機對真資料打那條 cron
  //    ⇒ 真客人收到一個連到他自己電腦的連結。
  it.each([
    ['http://localhost:3000', 'localhost'],
    ['http://127.0.0.1:3000', '回送位址'],
    ['http://127.0.0.2', '🔴 整個 127/8 都是回送 —— 前綴黑名單漏掉的那一種'],
    ['http://10.0.0.5', '🔴 內網 10/8'],
    ['http://192.168.1.20', '🔴 內網 192.168/16'],
    ['http://172.20.0.3', '🔴 內網 172.16-31 —— 邊界最容易寫錯的那一段'],
    ['http://169.254.1.1', '🔴 link-local'],
    ['http://user@127.0.0.1', '🔴 認證資訊在前 ⇒ 字串前綴比對看到的是 user@'],
    ['https://[::1]/', '🔴 IPv6 回送'],
    ['not-a-url', '解析不了 ⇒ fail-closed'],
  ])('%s ⇒ 不印連結(%s)', (url) => {
    expect(paidEmailOrderUrl(url, 'PCM-2026-0001')).toBeUndefined();
  });

  // 🟢 **反向世界非做不可** —— 少了它,一支 `return undefined` 寫死的函式也會通過上面十格。
  it.each([
    'https://shop.pcmmotorsports.com',
    'https://www.pcmmotorsports.com',
    'http://10.example.com',
  ])('🟢 %s ⇒ 照印(證明它擋的是主機不是「看起來像內網的字」)', (url) => {
    expect(paidEmailOrderUrl(url, 'PCM-2026-0001')).toContain('/account/orders/PCM-2026-0001');
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

describe('assertPdfClaimMatchesAttachments —— 信裡說附了 PDF 而其實沒附 ⇒ 不准寄', () => {
  // 🔴 **這一族要兩個世界都演** —— 一個「該紅的紅」加一個「該綠的綠」。
  //    少了後者, 一支 `throw new Error()` 寫死的函式也會通過前者。
  const withClaim = `<div>${PAID_EMAIL_PDF_ATTACHED_SENTENCE}</div>`;
  const withoutClaim = '<div>訂單金額</div>';

  it('🔴 說了「已附在這封信裡」而附件是 undefined ⇒ throw', () => {
    expect(() => assertPdfClaimMatchesAttachments(withClaim, undefined)).toThrow(/沒有 \.pdf/);
  });

  it('🔴 說了那句話而附件裡只有非 PDF ⇒ throw(不是只看「有沒有附件」)', () => {
    expect(() =>
      assertPdfClaimMatchesAttachments(withClaim, [{ filename: 'logo.png' }]),
    ).toThrow(/沒有 \.pdf/);
  });

  it('🟢 說了那句話而真的附了 PDF ⇒ 放行(該綠的那一側)', () => {
    expect(() =>
      assertPdfClaimMatchesAttachments(withClaim, [{ filename: 'statement.PDF' }]),
    ).not.toThrow();
  });

  it('🟢 沒說那句話 ⇒ 不管附件有沒有都放行(這道尺不管別的事)', () => {
    expect(() => assertPdfClaimMatchesAttachments(withoutClaim, undefined)).not.toThrow();
    expect(() => assertPdfClaimMatchesAttachments(null, undefined)).not.toThrow();
  });

  // 🔴🔴 **這一格驗的是【模板與守門共用同一個常數】** ——
  //    少了它, 有人改了模板那句話而守門仍在找舊字串 ⇒ **守門不再守任何東西, 而它全綠。**
  //    ⇒ 📌 這一格就是那個病的正對照:**尺與被量的東西之間那條線, 也要有東西量它。**
  it('🔴 模板真的印出那個常數(守門找的就是模板印的那一句)', () => {
    const html = renderPaidEmailHtml(ctxWithDiscount(), { hasPdfAttachment: true });
    expect(html).toContain(PAID_EMAIL_PDF_ATTACHED_SENTENCE);
    // 而不翻旗標時不印 ⇒ 反向世界
    expect(renderPaidEmailHtml(ctxWithDiscount(), {})).not.toContain(PAID_EMAIL_PDF_ATTACHED_SENTENCE);
  });

  // 🎯 **而這一格是整族的重點:把兩者接起來, 演一次真正會發生的事故。**
  it('🔴 翻開旗標而沒附 PDF ⇒ 那封信會被擋下來(模板 → 守門 一整條)', () => {
    const html = renderPaidEmailHtml(ctxWithDiscount(), { hasPdfAttachment: true });
    expect(() => assertPdfClaimMatchesAttachments(html, undefined)).toThrow();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 🔴🔴 加不起來就不印金額(2026-09-04 線【帳號】`-account`;`⟦b4-INVOICE5PCT⟧` 第 5 步)
//
// 🔬 **為什麼需要**:DB 的等式含 `tax_total`, 而本檔的金額區只列前三項
//    ⇒ `tax_total > 0` 的那一天, 客人會收到一張【加不起來】的帳。
//    而在本片之前這道判斷**只裝在純文字那一份** ⇒ 兩份信會**各出一種病**。
// 🔵 **本組刻意【不】自己重算平衡** —— 期望值走 `orderAmountsBalance`(與生產碼同一支),
//    因為「測試自己重打一份判準」正是本 repo 記過的假綠形狀。
describe('加不起來就不印金額', () => {
  /**
   * **一列【DB 寫不進去】的訂單** —— 而那是刻意的。
   *
   * 🔴 2026-09-04 唯讀實查:正式庫有 `orders_total_balances`
   *    ⇒ `CHECK (total = subtotal + shipping_fee - discount_total + tax_total)`
   *    ⇒ 🎯 **所以這個 fixture 代表的不是「某一天的資料」, 是【我們這一層弄丟了一項】。**
   *    (codex 對抗審查 R1 nit 指出原註解「模擬稅額開始有值的那一天」不再成立 ⇒ 已改。)
   * 📌 ⇒ 它要測的是:**當四個數字兜不攏時, 信不要印一張兜不攏的帳。**
   */
  function ctxWithTax(): PaidEmailContext {
    const base = ctxWithDiscount();
    // 31120 + 150 - 790 = 30480;稅 = ROUND(30480 × 0.05) = 1524 ⇒ total 32004
    return { ...base, total: (base.total + 1524) as typeof base.total };
  }

  it('🟢 正對照:平衡時金額區【印得出來】(否則下面每一格都證明不了東西)', () => {
    const c = ctxWithDiscount();
    expect(orderAmountsBalance(c), '這個 fixture 本來就該是平衡的').toBe(true);
    const html = renderPaidEmailHtml(c);
    expect(html).toContain('訂單金額');
    expect(html).toContain('小計');
    expect(html).toContain(c.lines[0]!.title);
  });

  it('🔴 不平衡時:金額區與品項表【兩塊一起不見】', () => {
    const c = ctxWithTax();
    expect(orderAmountsBalance(c), '這個 fixture 就是要不平衡').toBe(false);
    const html = renderPaidEmailHtml(c);
    expect(html, '總額那一行還在 ⇒ 客人會收到一張加不起來的帳').not.toContain('訂單金額');
    expect(html, '品項表還在 ⇒ 有小計沒總額, 客人一樣會自己加').not.toContain(c.lines[0]!.title);
  });

  it('🔵 而【信照寄】—— 訂單編號與到會員中心那顆鈕都還在', () => {
    const html = renderPaidEmailHtml(ctxWithTax(), { orderUrl: 'https://x.test/o/1' });
    expect(html).toContain('XMFPNH');
    expect(html).toContain('到會員中心查看訂單');
    expect(html).toContain(PCM_COMPANY_LINE);
  });

  // 🔴🔴 **這一格的標題原本比它證明的【寬】**(codex 對抗審查 R2 nit, 2026-09-04):
  //    ⛔ ~~原標題「判準與純文字那一份【共用同一支函式】—— 兩份不得各判各的」~~
  //    而它**只直接呼叫 helper** ⇒ 🔴 **任一 renderer 哪天不再用那支 helper, 這一格照樣綠。**
  //    ⇒ 📌 **檔名與標題也是一個宣稱, 而它比證據寬的時候沒有東西會紅。**
  // ✅ **改成證得到的形狀**:把 renderer 的【輸出】與 helper 的【裁決】綁在一起逐例比對。
  it('🔴 renderer 印不印金額, 逐例等於 helper 的裁決(不是各判各的)', () => {
    const cases: PaidEmailContext[] = [ctxWithDiscount(), ctxWithTax(), ctxNoDiscountFreeShipping()];
    for (const c of cases) {
      const verdict = orderAmountsBalance(c);
      expect(
        renderPaidEmailHtml(c).includes('訂單金額'),
        `helper 說 ${String(verdict)} 而 renderer 的輸出不一致 ⇒ 兩邊各判各的`,
      ).toBe(verdict);
    }
    // 🟢 而這三例必須【同時含真與假】—— 否則上面那個迴圈只驗了一個世界
    const verdicts = cases.map((c) => orderAmountsBalance(c));
    expect(verdicts).toContain(true);
    expect(verdicts).toContain(false);
    // 🟢 helper 本身對每一個輸入都要有反應, 不是恆真恆假
    const zero = { subtotal: 0, shippingFee: 0, discountTotal: 0, total: 0, taxTotal: 0 };
    expect(orderAmountsBalance(zero)).toBe(true);
    expect(orderAmountsBalance({ ...zero, total: 1 })).toBe(false);
    // 🔴 而【第四項】也要對判準有影響 —— 否則「加了 taxTotal」與「沒加」印同一個答案。
    expect(orderAmountsBalance({ ...zero, taxTotal: 1 })).toBe(false);
    expect(orderAmountsBalance({ ...zero, taxTotal: 1, total: 1 })).toBe(true);
  });
});

describe('不印明細的那封信, 不可以繼續說自己是明細(codex R1 must-fix)', () => {
  function ctxWithTax2(): PaidEmailContext {
    const base = ctxWithDiscount();
    return { ...base, total: (base.total + 1524) as typeof base.total };
  }

  it('🔴 不平衡 ⇒ 開頭那句「這封信是這筆交易的明細」不得出現', () => {
    const html = renderPaidEmailHtml(ctxWithTax2());
    expect(html, '明細被拿掉了而信還在說自己是明細 ⇒ 那一句是假的').not.toContain(
      ORDER_PAID_HTML_LEAD_SENTENCE,
    );
  });

  it('🟢 正對照:平衡時那一句【照印】(否則上面那格證明不了東西)', () => {
    expect(renderPaidEmailHtml(ctxWithDiscount())).toContain(ORDER_PAID_HTML_LEAD_SENTENCE);
  });

  it('🔵 而信的用途沒變 —— 「我們收到您的付款了」與下一步那句都還在', () => {
    const html = renderPaidEmailHtml(ctxWithTax2());
    expect(html).toContain('我們收到您的付款了');
    expect(html).toContain(ORDER_PAID_NEXT_STEP_SENTENCE);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 🔴🔴 稅額那一列(2026-09-04 `⟦b4-INVOICE5PCT⟧` 第 7 步;Sean 拍 Q1=乙)
describe('稅額那一列', () => {
  /** 稅有值【而且平衡】的世界:31120 + 150 − 790 + 1524 = 32004。 */
  function ctxTaxed(): PaidEmailContext {
    const base = ctxWithDiscount();
    return { ...base, taxTotal: (1524 as typeof base.total), total: (32004 as typeof base.total) };
  }

  it('🟢 前提:這個 fixture 是平衡的(否則下面測到的是【不印明細】那條路)', () => {
    expect(orderAmountsBalance(ctxTaxed())).toBe(true);
  });

  it('🔴 有稅 ⇒ 印「稅額」那一列, 且值是稅額不是別的數字', () => {
    const html = renderPaidEmailHtml(ctxTaxed());
    expect(html).toContain('稅額');
    expect(html).toContain('1,524');
  });

  it('🔴 稅 0 ⇒ 【不印】那一列 —— 印「稅額 0」會讓客人以為這筆沒被課稅', () => {
    expect(renderPaidEmailHtml(ctxWithDiscount())).not.toContain('稅額');
  });

  it('🔴 順序:小計 → 運費 → 折扣 → 稅額 → 訂單金額(兩份不該漂)', () => {
    const html = renderPaidEmailHtml(ctxTaxed());
    const at = (s: string) => html.indexOf(s);
    expect(at('小計')).toBeGreaterThan(-1);
    expect(at('運費')).toBeGreaterThan(at('小計'));
    expect(at('折扣')).toBeGreaterThan(at('運費'));
    expect(at('稅額')).toBeGreaterThan(at('折扣'));
    expect(at('訂單金額')).toBeGreaterThan(at('稅額'));
  });
});
