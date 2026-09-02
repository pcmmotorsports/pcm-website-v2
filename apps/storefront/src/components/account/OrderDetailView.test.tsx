// @vitest-environment jsdom
//
// OrderDetailView smoke(`#240` 會員訂單明細)。
//
// 驗:
// - 單號 / 狀態徽章三檔 tone / 金額四欄 / 收件三欄
// - 🔴 品牌 null ⇒ **整行不印**;收件缺值 ⇒ **印 `—`**(兩者刻意相反,各有理由)
// - 🔴 運費 0 ⇒「免運」;未付款 ⇒「應付金額」、已付款 ⇒「實付金額」
// - 🔴 itemsTruncated ⇒ 件數印「?」+ 印出說明段;**不得印 0、不得留空**
// - ⛔ ~~🔴 稿上「沒有資料來源」的東西不得出現(**下載訂單 PDF** / 查詢物流)—— 做出來就是第二顆死鈕~~
//   ✅ **2026-08-30 片 C:「下載訂單 PDF」那半已翻面**(它現在有一頁真的可以去);
//     「查詢物流進度」那半**原封不動**——物流資料源今天仍然不存在。
//   🔴 **而舊字面用的是縮寫「下載 PDF」** ⇒ 拿完整字面 `下載訂單 PDF` 跑 `literal-sweep.sh`
//     **撈不到這一行** ⇒ 它會活下來當一句過期的驗收條(code-reviewer 抓)。⇒ 這裡補齊全名。
// - 反洩 guard:畫面文字零經銷價字面

import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { toMoneyAmount, type MemberOrderDetail } from '@pcm/domain';
import { OrderDetailView } from './OrderDetailView';
import {
  ORDER_DETAIL_ITEMS_TRUNCATED_NOTE,
  ORDER_DETAIL_PARTIAL_SHIPMENT_NOTE,
} from '@/lib/account-order-copy';

afterEach(cleanup);

const money = (n: number) => ({ amount: toMoneyAmount(n), currency: 'TWD' as const });

const ORDER: MemberOrderDetail = {
  id: 'o1',
  displayId: 'PCM-2099-0007',
  createdAt: '2099-04-15T10:00:00Z',
  paymentStatus: 'paid',
  fulfillmentStatus: 'shipped',
  paymentMethod: 'tappay',
  paidAt: '2099-04-18T03:00:00Z', // 🔴 刻意與 createdAt(04-15)【不同日】
  shippedAt: null,
  allItemsShipped: false,
  subtotal: money(12000),
  shippingFee: money(100),
  discountTotal: money(0),
  total: money(12100),
  shippingMethod: 'home',
  shippingAddress: { name: '王小明', phone: '0912345678', line: '新北市新莊區化成路 736 巷 18 號' },
  cancelledAt: null,
  cancelKind: 'none' as const,
  items: [
    {
      id: 'oi1',
      variantSku: 'SKU-1',
      brand: 'CNC RACING',
      title: '下鏈條蓋',
      spec: { color: 'black' },
      imageUrl: 'https://x/v.jpg',
      vehicle: { kind: 'dict', brand: 'BMW', model: 'R1250GS', year: 2021, source: 'garage' },
      quantity: 2,
      unitPrice: money(6000),
      lineTotal: money(12000),
    },
  ],
  itemCount: 2,
  itemsTruncated: false,
};

describe('OrderDetailView', () => {
  it('渲染單號 / 成立日 / 件數 / 品名 / 品牌 / 車款 / 金額', () => {
    const { container } = render(<OrderDetailView order={ORDER} />);
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('PCM-2099-0007');
    expect(container.textContent).toContain('2099-04-15 成立');
    expect(container.textContent).toContain('共 2 件商品');
    expect(container.textContent).toContain('下鏈條蓋');
    expect(container.querySelector('.od-line-brand')?.textContent).toBe('CNC RACING');
    expect(container.querySelector('.od-line-fits')?.textContent).toBe('BMW R1250GS 2021');
    expect(container.textContent).toContain('NT$ 12,100');
  });

  it('狀態徽章:paid → 處理中 + is-progress', () => {
    const { container } = render(<OrderDetailView order={ORDER} />);
    const badge = container.querySelector('.od-status');
    expect(badge?.textContent).toBe('處理中');
    expect(badge?.className).toContain('is-progress');
  });

  // 🔴 稿上那格 label 是「付款確認中」= 2026-08-07 的字面,而 Sean 08-18 拍 Q06=甲 改成「已收訂金」
  //    ⇒ **逐字搬稿會把被推翻的字面搬回線上**。這一格釘住「字面走 helper、tone 才照稿」。
  it('狀態徽章:partiallyPaid → 走 orderStatusLabel 的「已收訂金」(**不是稿上的「付款確認中」**)+ is-action', () => {
    const { container } = render(
      <OrderDetailView order={{ ...ORDER, paymentStatus: 'partiallyPaid' }} />,
    );
    const badge = container.querySelector('.od-status');
    expect(badge?.textContent).toBe('已收訂金');
    expect(badge?.textContent).not.toBe('付款確認中');
    expect(badge?.className).toContain('is-action');
  });

  it('未付款 ⇒「應付金額」;已付款 ⇒「實付金額」(稿:未付款的訂單不能寫「實付」)', () => {
    const { container: paidC } = render(<OrderDetailView order={ORDER} />);
    expect(paidC.textContent).toContain('實付金額');
    expect(paidC.textContent).not.toContain('應付金額');
    cleanup();
    const { container: unpaidC } = render(
      <OrderDetailView order={{ ...ORDER, paymentStatus: 'unpaid' }} />,
    );
    expect(unpaidC.textContent).toContain('應付金額');
    expect(unpaidC.textContent).not.toContain('實付金額');
  });

  // 🔴 codex 關卡2 must-fix:原本 `paid ? 實付 : 應付` 的二元式對三個狀態說假話。
  it('🔴 退款 / 已退部分 / 已收訂金 ⇒ **不得**印「應付金額」(退款客人不能被告知還欠全額)', () => {
    for (const st of ['refunded', 'partiallyRefunded', 'partiallyPaid'] as const) {
      cleanup();
      const { container } = render(<OrderDetailView order={{ ...ORDER, paymentStatus: st }} />);
      expect(container.textContent).not.toContain('應付金額');
      expect(container.textContent).not.toContain('實付金額');
      expect(container.textContent).toContain('訂單金額');
    }
    // 負對照:paid 仍要印「實付金額」—— 否則上面三格在「永遠印訂單金額」時也會綠。
    cleanup();
    const { container } = render(<OrderDetailView order={ORDER} />);
    expect(container.textContent).toContain('實付金額');
    expect(container.textContent).not.toContain('訂單金額');
  });

  // 🔴 codex 關卡2 must-fix:原本拿 createdAt 冒充付款日。
  it('🔴 「付款完成」那階的日期用 paidAt、**不是** createdAt;paidAt 為 null ⇒ 不印日期', () => {
    const { container } = render(<OrderDetailView order={ORDER} />);
    const steps = Array.from(container.querySelectorAll('.od-step'));
    const paidStep = steps[1]!;
    expect(paidStep.querySelector('.od-step-t')?.textContent).toBe('付款完成');
    expect(paidStep.querySelector('.od-step-d')?.textContent).toBe('2099-04-18'); // paidAt
    expect(paidStep.querySelector('.od-step-d')?.textContent).not.toBe('2099-04-15'); // createdAt
    cleanup();
    const { container: c2 } = render(<OrderDetailView order={{ ...ORDER, paidAt: null }} />);
    const paidStep2 = Array.from(c2.querySelectorAll('.od-step'))[1]!;
    expect(paidStep2.querySelector('.od-step-d')?.textContent).toBe('');
  });

  it('運費 0 ⇒ 印「免運」;非 0 ⇒ 印金額', () => {
    const { container } = render(<OrderDetailView order={{ ...ORDER, shippingFee: money(0) }} />);
    expect(container.textContent).toContain('免運');
    cleanup();
    const { container: c2 } = render(<OrderDetailView order={ORDER} />);
    expect(c2.textContent).toContain('NT$ 100');
  });

  // 🔴 兩種缺值刻意相反,判準 = 「缺值本身算不算一個需要被看見的事實」
  it('品牌 null ⇒ .od-line-brand 整行不印(不是印 —)', () => {
    const { container } = render(
      <OrderDetailView order={{ ...ORDER, items: [{ ...ORDER.items[0]!, brand: null }] }} />,
    );
    expect(container.querySelector('.od-line-brand')).toBeNull();
    // 負對照:有品牌時那一行【要在】—— 否則上面那格在「永遠不印」時也會綠。
    cleanup();
    const { container: c2 } = render(<OrderDetailView order={ORDER} />);
    expect(c2.querySelector('.od-line-brand')).not.toBeNull();
  });

  it('收件三欄缺值 ⇒ 各印「—」(這裡缺值是異常、要看得出來)', () => {
    const { container } = render(
      <OrderDetailView
        order={{ ...ORDER, shippingAddress: { name: null, phone: null, line: null } }}
      />,
    );
    const dds = Array.from(container.querySelectorAll('.od-info dd')).map((d) => d.textContent);
    expect(dds.slice(0, 3)).toEqual(['—', '—', '—']);
  });

  it('車款 null ⇒ .od-line-fits 不印', () => {
    const { container } = render(
      <OrderDetailView order={{ ...ORDER, items: [{ ...ORDER.items[0]!, vehicle: null }] }} />,
    );
    expect(container.querySelector('.od-line-fits')).toBeNull();
  });

  // 🔴 不印 0、不留空(逐字沿用 OrderListItem:196 的紀律)
  it('itemsTruncated ⇒ 件數印「?」+ 印出說明段,而【不是】印 0 或留空', () => {
    const { container } = render(
      <OrderDetailView order={{ ...ORDER, itemsTruncated: true, itemCount: 2 }} />,
    );
    const meta = container.querySelector('.od-head-meta')?.textContent ?? '';
    expect(meta).toContain('共 ? 件商品');
    expect(meta).not.toContain('共 0 件商品');
    expect(meta).not.toContain('共 2 件商品');
    expect(container.textContent).toContain(ORDER_DETAIL_ITEMS_TRUNCATED_NOTE);
    // 負對照:沒截斷時說明段不得出現(否則它是恆真的)。
    cleanup();
    const { container: c2 } = render(<OrderDetailView order={ORDER} />);
    expect(c2.textContent).not.toContain(ORDER_DETAIL_ITEMS_TRUNCATED_NOTE);
  });

  // 🔴 說明段不得叫客人做一件永遠不會成功的事(全陣紀律:「請重新整理」只准出現在真的重整就會好的地方)
  it('截斷說明段零「重新整理」類字面', () => {
    for (const bad of ['重新整理', '重整', '再試一次', '稍後', '稍候', '重新載入', 'F5']) {
      expect(ORDER_DETAIL_ITEMS_TRUNCATED_NOTE).not.toContain(bad);
    }
    // 負對照:證明這把尺是活的 —— 它確實在讀那個常數的內容。
    expect(ORDER_DETAIL_ITEMS_TRUNCATED_NOTE).toContain('不會自己恢復');
  });

  // 🔴 稿上有、而本片刻意不做的東西 —— 做出來就是第二顆死鈕(本片存在的理由是消滅第一顆)
  //
  // 🔴🔴 **2026-08-30 片 C:這一格【半格翻面】,而【只翻半格】是刻意的。**
  //    ⛔ ~~`expect(container.textContent).not.toContain('下載訂單 PDF')`~~ —— **前提消失了**:
  //       那顆鈕現在**有一頁真的可以去**(`/account/orders/<id>/statement`,片 A+B 已落地)
  //       ⇒ 它不再是死鈕。
  //    ✅ **而「查詢物流進度」那一半原封不動** —— 它的前提**沒有**變:
  //       物流資料源今天仍然不存在(稿 `:167-175` 自己就寫著「需要第 2 批【包裹真相】」)。
  //    📌 **⇒ 一格守門的兩個宣稱可以【一個過期一個沒有】,而它們寫在同一行。**
  //       ⇒ 整格刪掉的話,物流那顆死鈕就沒有人守了 —— 而那正是本格存在的理由。
  //
  // 🔴 **而真正該加強的是下面那半(結構),不是上面那半(字面)**:
  //    字面那半只擋得住「我想得到的那兩顆」;結構那半擋的是**任何一顆**死鈕,
  //    而它**不需要我先知道那顆鈕叫什麼名字**。
  it('零死鈕:物流入口仍不得出現;而任何 <a> 都要有真的去處', () => {
    const { container } = render(<OrderDetailView order={ORDER} />);
    expect(container.textContent, '物流資料源今天仍然不存在').not.toContain('查詢物流進度');

    // 🔴 結構那半 —— 整頁不得有任何【沒有 href 的 <a>】或【沒有 onClick 的 <button>】
    expect(container.querySelector('button')).toBeNull();
    const links = Array.from(container.querySelectorAll('a'));
    // 🔴 分母:掃到空集合會無聲通過。
    //    ⛔ ~~`toBeGreaterThanOrEqual(2)`~~ —— **那比註解宣稱的弱一格**(code-reviewer 抓):
    //       這一頁**恆有 3 顆** `<a>`(`:154` 返回 / `:180` 明細 / LINE 那顆,三顆都無條件渲染)
    //       ⇒ `>=2` 在**任何一顆消失時仍然綠**。⇒ 釘死 3。
    expect(links.length, '<a> 的顆數變了 —— 少一顆代表有入口不見了, 多一顆代表有沒被這格驗過的新入口').toBe(3);
    for (const a of links) {
      const href = a.getAttribute('href');
      expect(href, `這顆連結沒有去處:${a.textContent}`).toBeTruthy();
      // 🔴 加強:`href="#"` 也是死鈕,而舊的 `toBeTruthy()` 讓它過關。
      //    ⛔ ~~我原本寫「`href=""` 也是」~~ —— **那句是錯的**:`''` 是 falsy,舊尺本來就擋得住。
      //    ⚠️ 而這一條**擋不住** `#top` / `javascript:void(0)`(code-reviewer 標的射程)。
      expect(href, `這顆連結的 href 是佔位符:${a.textContent}`).not.toBe('#');
    }
  });

  // 🔴🔴 **2026-08-24 codex must-fix:這一格【整個翻面】。**
  //    ~~原本:「已取消訂單 ⇒ **印可對客的取消原因**」~~ —— 那個前提是假的:
  //    `cancelled_reason` 在 `p_reason_code = 'other'` 時裝的是**員工當場打的原文**
  //    (`20260804180000_..._admin_cancel_order.sql:135-136`)⇒ 印它 = 把內部說法給客人看。
  //    ⇒ 現在客人端**連拿都拿不到那串字**(mapper 端收斂成 `cancelKind` 枚舉)。
  it('已取消訂單 ⇒ 印固定字串、**不印任何自由文字**;未取消 ⇒ 整區不印', () => {
    const { container } = render(
      <OrderDetailView
        order={{ ...ORDER, cancelledAt: '2099-05-01T00:00:00Z', cancelKind: 'cancelled' }}
      />,
    );
    expect(container.textContent).toContain('訂單已取消');
    expect(container.textContent).toContain('這張訂單已經取消,不需要付款');
    cleanup();
    const { container: c2 } = render(<OrderDetailView order={ORDER} />);
    expect(c2.querySelector('[data-od-id="order-cancelled"]')).toBeNull();
  });

  // ── 🔴🔴 `#249`(2026-08-24):這一頁對【取消單】從今天起才走得到 ────────────────
  // 在此之前 adapter 的 `.neq('payment_status','unpaid')` 把取消單全濾掉了(取消不動 payment_status
  // ⇒ 每一張取消單都是 unpaid)。下面三格**不是新功能**,是一段沒人走過的路被點亮之後才暴露的東西。
  // 📌 形狀:**拆掉一道濾網,等於把它背後所有沒被走過的路一次點亮 —— 而那些路沒有人驗過。**
  // ── 🔴🔴 `#249`(2026-08-24):這一頁對【取消單】從今天起才走得到 ────────────────
  // 在此之前 adapter 的 `.neq('payment_status','unpaid')` 把取消單全濾掉了(取消不動 payment_status
  // ⇒ 每一張取消單都是 unpaid)。下面三格**不是新功能**,是一段沒人走過的路被點亮之後才暴露的東西。
  // 📌 形狀:**拆掉一道濾網,等於把它背後所有沒被走過的路一次點亮 —— 而那些路沒有人驗過。**
  describe('片 C:客人拿得走自己的訂單明細(板 `:416` ⟦b4-CUSTPDF1⟧)', () => {
    it('🔴🔴 那顆鈕連到 `/statement`,**不是** `/statement.pdf`(照稿抄會 404)', () => {
      const { container } = render(<OrderDetailView order={ORDER} />);
      const link = container.querySelector('[data-od-id="order-statement-link"]');
      expect(link, '那顆鈕不見了').not.toBeNull();
      expect(link!.getAttribute('href')).toBe('/account/orders/PCM-2099-0007/statement');
      // 🔴 **這一半是本格真正的重點**:稿 `:288` 寫的是 `statement.pdf`,而那句話假設伺服器產檔。
      //    照它抄 ⇒ 那條路由不存在 ⇒ 404,而**稿 `:286` 自己就警告過「不給一個會 404 的 href」**。
      //    ⇒ 稿在同一段裡同時給了陷阱與警告,而抄的人只會看到前者。
      // ⚠️ **這一條在上面那個 exact `toBe` 通過時【不可能紅】**(code-reviewer 抓)——
      //    承重的是 `toBe`,不是它。留著的用途只有一個:**擋住有人手改上面那個期望值**
      //    (改期望值讓測試變綠, 是 R4 換路訊號裡點名的那個動作)。⇒ 它是絆線, 不是量具。
      expect(link!.getAttribute('href'), '抄了稿上那個 .pdf ⇒ 這顆鈕會 404').not.toContain('.pdf');
    });

    it('🔴 它開【新分頁】, 而且帶 `rel="noopener noreferrer"`(Sean 2026-08-30 直接下的)', () => {
      // 他的原話逐字:「有但是直接取代整個頁面, 我要可以跳新分頁或者直接下載PDF」
      // ⇒ 取代整頁 = 客人回不去他原本在看的那張訂單。
      const { container } = render(<OrderDetailView order={ORDER} />);
      const link = container.querySelector('[data-od-id="order-statement-link"]');
      expect(link, '那顆鈕不見了').not.toBeNull();
      expect(link!.getAttribute('target'), '它還是會取代整個頁面').toBe('_blank');
      // 🔴 `rel` 這一半:`target="_blank"` 會把 `window.opener` 交給新分頁。
      //    這條紀律**不看目的地** —— 下一個人改 href 時不會回來補它。
      const rel = link!.getAttribute('rel') ?? '';
      expect(rel).toContain('noopener');
      expect(rel).toContain('noreferrer');
      // 🔴 負對照:同一頁的「返回」那顆**不該**是新分頁(證明上面不是「每顆都有 target」)
      const back = container.querySelector('[data-od-id="order-back"]');
      expect(back, '返回那顆不見了 ⇒ 這個負對照失去意義').not.toBeNull();
      expect(back!.getAttribute('target')).toBeNull();
    });

    it('🔴 它是 `<a>` 不是 `<button>` —— 導覽要能中鍵開新分頁 / 右鍵複製網址', () => {
      const { container } = render(<OrderDetailView order={ORDER} />);
      const el = container.querySelector('[data-od-id="order-statement-link"]');
      // 🔴 先證它在 —— 否則鈕不見時是 `null.tagName` 拋 TypeError:**會紅, 而訊息說錯原因**。
      expect(el, '那顆鈕不見了').not.toBeNull();
      expect(el!.tagName).toBe('A');
    });

    it('🔴 單號要被 encode —— 而下游那一頁刻意【不再解一次碼】,兩端要對得起來', () => {
      // Next 的動態路由段進來就已解碼;再解一次遇到 `%` 會拋 URIError 而整頁 500
      // (`statement/page.tsx` 那條 codex must-fix)。⇒ 這一端負責 encode。
      const weird = { ...ORDER, displayId: 'PCM 100%/A' as typeof ORDER.displayId };
      const { container } = render(<OrderDetailView order={weird} />);
      const href = container
        .querySelector('[data-od-id="order-statement-link"]')!
        .getAttribute('href')!;
      expect(href).toBe('/account/orders/PCM%20100%25%2FA/statement');
      // 翻面:解回來要等於原值 —— 沒有這一半,上面那串亂碼「對不對」沒有人證得了
      expect(decodeURIComponent(href.slice('/account/orders/'.length, -'/statement'.length))).toBe(
        'PCM 100%/A',
      );
    });

    it('🔴 class 照稿(`.od-head-actions` > `.acc-btn-ghost`)—— 這兩個 class 的 CSS 早就在', () => {
      const { container } = render(<OrderDetailView order={ORDER} />);
      const link = container.querySelector('[data-od-id="order-statement-link"]');
      expect(link!.className).toContain('acc-btn-ghost');
      expect(link!.parentElement!.className).toContain('od-head-actions');
      // 🔴 負對照 —— ⛔ ~~`not.toContain('zzz-not-a-class')`~~ **那是恆真的**
      //    (`zzz-not-a-class` 全 repo 只出現在那一行自己;正對照 `acc-btn-ghost` ⇒ 7 檔)
      //    ⇒ 換成一個**真的存在、但屬於別人**的 class:父層是版面容器,它不該長得像一顆鈕。
      expect(link!.parentElement!.className, '父層混進了鈕的 class ⇒ 上面兩格可能只是撞到字串').not.toContain(
        'acc-btn-ghost',
      );
    });
  });

  // 🔴 **這一格補在 code-reviewer(2026-08-30)抓到之後** —— 那一片的存在理由就是這一格的畫面,
  //    而在它之前,畫面那一側只有【一發手動瀏覽器觀察】在守。
  //    reviewer 的失敗情境逐字:把 `:286` 回捲成 `dash(order.paymentMethod)` ⇒ 54 格**全綠**
  //    而客人再次看到 `tappay`。純函式那四格證的是 `paymentMethodLabel` 對,
  //    **證不了有人真的把它接上去**。
  it('🔴 付款方式印中文、不印 DB 原始值(接線格:純函式測試證不到這一段)', () => {
    const { container } = render(<OrderDetailView order={ORDER} />);
    const text = container.textContent ?? '';
    expect(text).toContain('信用卡');
    // 負對照:原始值不得出現在畫面上。少了這一行,一個「兩個都印」的實作也會過。
    expect(text).not.toContain('tappay');
  });

  it('付款方式為 null ⇒ 仍印 —(空值語意未被翻譯層改掉)', () => {
    const { container } = render(<OrderDetailView order={{ ...ORDER, paymentMethod: null }} />);
    const dds = [...container.querySelectorAll('dd')].map((e) => e.textContent);
    expect(dds).toContain('—');
  });

  describe('`#249` 取消單:一段今天才走得到的路', () => {
    const CANCELLED = {
      ...ORDER,
      paymentStatus: 'unpaid' as const,
      paidAt: null,
      paymentMethod: null,
      cancelledAt: '2099-05-01T00:00:00Z',
      cancelKind: 'cancelled' as const,
    };
    const EXPIRED = { ...CANCELLED, cancelKind: 'expired' as const };

    it('🔴 徽章不得是 `is-action`(那一檔是【催客人去付款】的顏色)', () => {
      const { container } = render(<OrderDetailView order={CANCELLED} />);
      const badge = container.querySelector('.od-status');
      expect(badge?.textContent).toBe('已取消');
      // 負對照在下一行:同一支元件對【沒取消的 unpaid 單】仍然要給 is-action,
      // 否則這一格在「is-action 整個壞掉」時也會綠。
      expect(badge?.className).not.toContain('is-action');
      cleanup();
      const { container: c2 } = render(
        <OrderDetailView order={{ ...CANCELLED, cancelledAt: null, cancelKind: 'none' }} />,
      );
      expect(c2.querySelector('.od-status')?.className).toContain('is-action');
    });

    it('🔴 金額欄不得寫「應付金額」—— 那會告訴一個取消單的客人他還欠錢', () => {
      const { container } = render(<OrderDetailView order={CANCELLED} />);
      expect(container.textContent).not.toContain('應付金額');
      expect(container.textContent).toContain('訂單金額');
    });

    it('🔴 逾期單:標題「訂單已逾期」,而且**不得把英文機器碼印給客人**', () => {
      const { container } = render(<OrderDetailView order={EXPIRED} />);
      expect(container.textContent).toContain('訂單已逾期');
      // 🔴 `payment_expired` 是 pg_cron 寫進 cancelled_reason 的**機器碼**,不是文案
      //    (`20260809160000_..._expire_unpaid_orders_fn.sql:174` 逐字)。
      expect(container.innerHTML).not.toContain('payment_expired');
      expect(container.textContent).toContain('超過付款期限');
      // 負對照:人工取消的單標題仍是「訂單已取消」、而它也是固定字串
      cleanup();
      const { container: c2 } = render(<OrderDetailView order={CANCELLED} />);
      expect(c2.textContent).toContain('訂單已取消');
      expect(c2.textContent).toContain('這張訂單已經取消,不需要付款');
    });
  });

  it('反洩 guard:畫面文字零經銷價字面', () => {
    const { container } = render(<OrderDetailView order={ORDER} />);
    for (const token of ['price_store', 'price_by_tier', 'priceStore', '經銷價', 'cost']) {
      expect(container.innerHTML).not.toContain(token);
    }
    // 負對照:尺是活的(成交價確實印在畫面上)。
    expect(container.textContent).toContain('NT$ 6,000');
  });


});

/**
 * ⟦b9-SHIPUI⟧ 進度軸「已出貨」那一階 —— 從包裹真相點亮(Sean 2026-09-02 拍**丙**)。
 *
 * 🔴 **三格缺一不可, 而【第二格】最容易漏**:
 *   少了「沒出貨的單一個字都不能變」那一格,
 *   一個**把每一階都無條件點亮**的錯誤實作**照樣讓第一格通過**。
 * 📌 ⇒ 一個只驗「該亮的有亮」的測試, 分不出「它會判斷」與「它全部都亮」。
 */
describe('⟦b9-SHIPUI⟧ 進度軸「已出貨」', () => {
  it('🟢 有出貨 ⇒ 那一階亮、印出貨日期,而分批小字出現', () => {
    render(
      <OrderDetailView
        order={{ ...ORDER, shippedAt: '2099-04-20T06:00:00Z', allItemsShipped: false }}
      />,
    );
    expect(screen.getByText('已出貨')).toBeTruthy();
    /**
     * 🔴 **日期字面用 `formatOrderDate` 的產出(`YYYY-MM-DD`), 而不是稿的 `MM-DD`。**
     *   Sean 2026-09-02 的選項字面(`拍板-20260902-上午.md:147`)**逐字**是:亮「已出貨 09-02」
     *   ⚠️ 上面那串是**原檔的位元組** —— 不加粗體、不換引號。codex 2026-09-02 抓到我第二版
     *      仍然「宣稱逐字而自己加了 `**` 與 `『』`」⇒ 📌 **「逐字」二字自己也要逐字。**
     *   ⛔ ~~本行原本寫「逐字是『亮「已出貨 MM-DD」』」~~ —— `MM-DD` 是**我們的轉寫**,不是他打的字
     *      (code-reviewer R2 抓:`#7` 那一輪我只改了兩處裡的一處,**而漏掉的正是還寫著「逐字」的這處**)。
     *   而他那個字面是在**描述稿的畫法**
     *   (稿 `order-detail-page.html:174` 的 `const md = (s) => String(s || '').slice(5, 10);`
     *    ⚠️ 前一版漏抄了 `|| ''`,codex 2026-09-02 抓 ⇒ **引程式碼字面時連 falsy 防護一起抄**)。
     * 🎯 而我方進度軸的**前兩階早就用 `formatOrderDate`(en-CA ⇒ `YYYY-MM-DD`)**
     *   ⇒ 第三階改用 MM-DD 會讓**同一個元件裡三個日期兩種格式**。
     * ⇒ **我選了與鄰居一致**, 而這個落差寫在這裡讓下一個人看得到、也讓 Sean 可以推翻。
     *   ⛔ ~~**這是我的判斷不是他的拍板** —— 已同步交主視窗。~~
     *
     * ✅ **2026-09-02 結掉了:Sean 拍甲「跟鄰居一致(`2026-09-02`)」**
     *   落點 `~/pcm-mailbox/拍板-20260902-上午.md:244`(Q31),他逐字「Q:日期格式?」/「A: 甲 跟鄰居一致」。
     * 🔴 **而 Q11 拍丙的原字面「已出貨 `09-02`」(MM-DD)【已被推翻】** —— Q31 晚於 Q11,
     *   而且它**專門在答這一格** ⇒ **以 Q31 為準,用 `YYYY-MM-DD`。**
     *   📌 那個 `09-02` 字面刻意留在這一段裡:**grep 到它的人要在同一發撞到「它被推翻了」。**
     * ⚠️ 而 Q31 是**拍板當下沒落檔、下游窗查無才補**的(該檔 `:250` 自陳)⇒ 上面那句
     *   ~~「這是我的判斷不是他的拍板」~~ 在寫下的當天**是對的**,不是 `-5b` 判斷錯。
     */
    expect(screen.getByText('2099-04-20')).toBeTruthy();
    expect(screen.getByText(ORDER_DETAIL_PARTIAL_SHIPMENT_NOTE)).toBeTruthy();
  });

  /**
   * 🔴 **這三格 2026-09-02 被 code-reviewer 抓出是【恆真格】,已補實**(`-fc` 實跑複驗):
   * 原本只 assert 那句小字在不在,而**那句小字自己的渲染條件就含 `shippedAt !== null`**
   * ⇒ 它對 `ok`(亮不亮)與 `d`(印不印日期)**零判別力**。
   * 🔬 突變證實:把 `OrderDetailView.tsx` 的 `ok: order.shippedAt !== null` 改成 `ok: true`
   *    ⇒ **29 passed 全綠**。而測試的名字明寫「那一階不亮」。
   * ✅ ⇒ 改成 assert `.od-step` 的 `is-done` class,形狀照本檔 `:126` 既有那格。
   * ⚠️ **本段刻意不寫那兩個行號** —— 第一版寫了 `:166` / `:236`,而**在同一顆 commit 裡**
   *    就被我自己後續的編輯推成 `:172` / `:242`(code-reviewer R2 抓)。
   *    📌 **同一支檔裡的行號,連【自己這一輪】都撐不到收工。認字面:`ok: order.shippedAt`、`is-done`。**
   */
  it('🔵 **沒出貨 ⇒ 那一階不亮、不印日期、分批小字不出現**(少了這格,「全部都亮」也會過)', () => {
    const { container } = render(
      <OrderDetailView order={{ ...ORDER, shippedAt: null, allItemsShipped: false }} />,
    );
    const shipStep = Array.from(container.querySelectorAll('.od-step'))[2]!;
    expect(shipStep.querySelector('.od-step-t')?.textContent).toBe('已出貨');
    // 🔴 這一行是那個突變唯一殺得死它的地方。
    expect(shipStep.className).not.toContain('is-done');
    expect(shipStep.querySelector('.od-step-d')?.textContent).toBe('');
    expect(screen.queryByText(ORDER_DETAIL_PARTIAL_SHIPMENT_NOTE)).toBeNull();
  });

  it('🔵 全部出完 ⇒ 那一階亮,而**分批小字不出現**(那句話對它是假的)', () => {
    const { container } = render(
      <OrderDetailView
        order={{ ...ORDER, shippedAt: '2099-04-20T06:00:00Z', allItemsShipped: true }}
      />,
    );
    // ⚠️ `getByText('已出貨')` 那個字串在 ok=true 與 ok=false 時**都在畫面上** ⇒ 零判別力。
    //    要看的是 class 與日期,而它們與上一格是**相反的世界**。
    const shipStep = Array.from(container.querySelectorAll('.od-step'))[2]!;
    // 🔵 錨:進度軸插一階時,`[2]` 會安靜地量錯階段而仍然綠(code-reviewer R2 nit)。
    expect(shipStep.querySelector('.od-step-t')?.textContent).toBe('已出貨');
    expect(shipStep.className).toContain('is-done');
    // 🔴 **`is-now` 那一半原本一格都沒有人測**(codex 對抗審查 2026-09-02):
    //    把 `nowIdx` 寫死成 0 ⇒ 「已出貨」不再是**目前階段**(客人看到的高亮跑回第一階),
    //    而在補這一行之前那個突變**全綠**。`is-done` 與 `is-now` 是兩個不同的視覺狀態。
    expect(shipStep.className).toContain('is-now');
    expect(
      Array.from(container.querySelectorAll('.od-step'))[0]!.className,
      'nowIdx 寫死成 0 ⇒ 高亮會停在「訂單成立」,而那一階與最後一個完成的階段不是同一個',
    ).not.toContain('is-now');
    expect(shipStep.querySelector('.od-step-d')?.textContent).toBe('2099-04-20');
    expect(
      screen.queryByText(ORDER_DETAIL_PARTIAL_SHIPMENT_NOTE),
      '全部出完了還說「其餘商品出貨時會再通知您」⇒ 客人會為了等一批不存在的貨而不聯絡我們',
    ).toBeNull();
  });

  /**
   * 🔴🔴 **這一格守的是【版面結構】,而它是 2026-09-02 真瀏覽器抓到的。**
   *
   * 那句小字原本寫在 `.od-steps` 裡面 ⇒ 而 `.od-steps` 是 `display:flex`
   * ⇒ **它變成第 5 個 flex item**,被排在「已送達」右邊:
   *   桌面 1200px 佔 191px · **手機 375px 佔 191px(超過一半)⇒ 四階被擠成每格 38px**
   *   ⇒ 標題折成「訂單成 / 立」、日期折成「2026- / 09-02」
   * 🛑 **而 jsdom 量不到寬度**(`getBoundingClientRect` 在這裡一律回 0)
   *    ⇒ 本格只能守【結構】:那個 `<p>` 不得住在 `.od-steps` 裡。
   * ⚠️ **而結構這一格擋得住這一次,擋不住「有人把別的東西放進去」**
   *    ⇒ 所以第二個 assert 釘的是 **`.od-steps` 的子節點【只能】是 `.od-step`**,
   *      而不是只問我這一個 `<p>` 在不在裡面。
   * 🔵 **真正的行為(每一階的寬度)只有真瀏覽器答得出來** —— 量法與數字寫在
   *    `OrderDetailView.tsx` 那段註解裡;本格是它在 CI 裡的替身,不是它的等價物。
   */
  it('🔴 分批小字**不得**住在 `.od-steps` 裡(它是 flex ⇒ 會變成第 5 階)', () => {
    const { container } = render(
      <OrderDetailView
        order={{ ...ORDER, shippedAt: '2099-04-20T06:00:00Z', allItemsShipped: false }}
      />,
    );
    const note = container.querySelector('[data-od-id="order-partial-shipment-note"]');
    // 🟢 正對照:先證這一格的尺會動 —— 那句小字這一輪確實有被渲染出來。
    expect(note, '小字沒渲染 ⇒ 下面兩個 assert 會恆真').not.toBeNull();
    expect(note!.closest('.od-steps'), '那句小字被排進進度軸那一列 ⇒ 手機上會把四階擠成 38px').toBeNull();
    // 🔴 更硬的那一半:`.od-steps` 的子節點只能是階段本身。
    const kids = [...container.querySelector('.od-steps')!.children];
    expect(kids.length, '進度軸應恰有四階').toBe(4);
    expect(
      kids.filter((k) => !k.classList.contains('od-step')).length,
      '.od-steps 底下混進了不是 .od-step 的東西 ⇒ 它會被 flex 排成額外一格',
    ).toBe(0);
  });

  it('🔵 「已送達」永遠是空心點 —— delivered_at 全 repo 零來源,那是誠實不是漏做', () => {
    const { container } = render(
      <OrderDetailView
        order={{ ...ORDER, shippedAt: '2099-04-20T06:00:00Z', allItemsShipped: true }}
      />,
    );
    // 🛑 它在畫面上要看得到(那一階存在), 而它不得被標成完成。
    // 🔴 而「看得到」那半**在兩個世界印同一句** ⇒ 承重的是下面那行 class。
    expect(screen.getByText('已送達')).toBeTruthy();
    const doneStep = Array.from(container.querySelectorAll('.od-step'))[3]!;
    expect(doneStep.querySelector('.od-step-t')?.textContent).toBe('已送達');
    expect(doneStep.className).not.toContain('is-done');
    expect(doneStep.querySelector('.od-step-d')?.textContent).toBe('');
  });
});
