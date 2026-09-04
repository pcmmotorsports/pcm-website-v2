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
import { PCM_REMITTANCE_EXPIRE_DAYS, toMoneyAmount, type MemberOrderDetail } from '@pcm/domain';
import { OrderDetailView } from './OrderDetailView';
import {
  ORDER_DETAIL_ITEM_CANCELLED_MARK,
  ORDER_DETAIL_ITEM_SHIPPED_MARK,
  ORDER_DETAIL_ITEMS_TRUNCATED_NOTE,
  ORDER_DETAIL_PARTIAL_SHIPMENT_NOTE,
  ORDER_DETAIL_UNPAID_SHIPPED_NOTE,
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
  // 🔵 段 3 加欄:這些 fixture 演的是【已付款的刷卡單】⇒ 填 'tappay',
  //   不是「隨便填一個讓它綠」——填的是這個 fixture 本來就在演的那個世界。
  paymentChannel: 'tappay' as const,
  paidAt: '2099-04-18T03:00:00Z', // 🔴 刻意與 createdAt(04-15)【不同日】
  shippedAt: null,
  allItemsShipped: false,
  subtotal: money(12000),
  shippingFee: money(100),
  discountTotal: money(0),
  taxTotal: money(0),
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
      shipped: false,
    },
  ],
  itemCount: 2,
  itemsTruncated: false,
};

describe('匯款資訊那一塊(M-4b 段 3)', () => {
  // 🔴🔴 **這一族裡①最不重要。**
  //   ① 證明它【會出現】;而 ②③ 證明它【不會出現在錯的地方】——
  //   而錯的地方那兩條, 後果分別是「客人把我們的帳號當成他該匯的」與「叫他再匯一次全額」。
  //   📌 一個只驗「有沒有出現」的測試, 對一個不可回收的東西是不夠的。
  const bank = (over: Partial<MemberOrderDetail> = {}): MemberOrderDetail => ({
    ...ORDER,
    paymentChannel: 'bank_transfer' as const,
    paymentStatus: 'unpaid' as const,
    paymentMethod: null,
    paidAt: null,
    ...over,
  });
  const box = () => document.querySelector('[data-od-id="order-remittance"]');

  it('① 匯款 + 未付款 ⇒ 那一塊出現, 而帳號【逐字】是那 12 碼', () => {
    render(<OrderDetailView order={bank()} />);
    const el = document.querySelector('[data-od-id="order-remittance-account"]');
    expect(el).not.toBeNull();
    // 🔴 **逐字比對**, 不是「有數字就好」—— 錯一碼 = 錢進別人的帳戶。
    expect(el!.textContent).toBe('200540278354');
    expect(box()).not.toBeNull();
  });

  it('🔴 ② 刷卡 + 未付款 ⇒ 那一塊【不可以】出現(刷卡失敗的客人不該看到我們的帳號)', () => {
    // 🛑 這一格擋的是「用 paymentStatus 當近似判準」那個做法 ——
    //   刷卡失敗的單也是 unpaid, 而它會把銀行帳號印給一個沒有要匯款的人。
    render(<OrderDetailView order={bank({ paymentChannel: 'tappay' as const })} />);
    expect(box()).toBeNull();
  });

  it('🔴 ③ 匯款 + 已收一部分錢 ⇒ 那一塊【不可以】出現(否則叫他再匯一次全額)', () => {
    // 🛑 這一格擋的是「用【不等於 paid】當條件」那個做法。
    //   payment_status 有五個值, 而 partiallyPaid 已收到一部分 ⇒ 印 total 會叫他重匯全額。
    render(<OrderDetailView order={bank({ paymentStatus: 'partiallyPaid' as const })} />);
    expect(box()).toBeNull();
  });

  it('🟢 ④ 正對照:匯款 + 已付款 ⇒ 不出現', () => {
    render(<OrderDetailView order={bank({ paymentStatus: 'paid' as const })} />);
    expect(box()).toBeNull();
  });

  it('⑤ 備註那行帶著【這一單的】單號, 不是寫死的字', () => {
    // 🔵 而「帶單號」是我們加的, Sean 的原話只有「匯款備註請填寫訂單編號」——
    //   這一格釘住的是「它是動態的」, 不是那句話本身。
    render(<OrderDetailView order={bank()} />);
    expect(box()!.textContent).toContain(ORDER.displayId);
  });

  it('🔴 ⑦ 已取消的匯款單 ⇒ 那一塊【不可以】出現(reviewer must-fix ①)', () => {
    // 🛑 兩條取消路徑**都保留** payment_status='unpaid' + payment_channel='bank_transfer'
    //   ⇒ 少了 `!cancelled`, 同一頁會同時印「訂單已取消」與「請於 5 天內完成匯款」。
    //   🔴 而 superseded_by_card 那條的客人**剛剛才刷卡付過一次** —— 我們會叫他再匯一次。
    render(
      <OrderDetailView
        order={bank({ cancelledAt: '2026-09-04T00:00:00Z', cancelKind: 'cancelled' as const })}
      />,
    );
    expect(box()).toBeNull();
  });

  it('🔴 ⑧ 已逾期的匯款單 ⇒ 同樣不可以出現(cancelKind 的另一個值)', () => {
    // 🔵 `expired` 與 `cancelled` 是兩個值 —— 只擋一個 ⇒ 另一個那條路照樣印。
    render(
      <OrderDetailView
        order={bank({ cancelledAt: '2026-09-04T00:00:00Z', cancelKind: 'expired' as const })}
      />,
    );
    expect(box()).toBeNull();
  });

  it('🔴 ⑨ 銀行 / 戶名 / 備註三個值逐字正確(reviewer nit ②③)', () => {
    // 🛑 少了這一格:把「銀行(分行)」寫反成「分行(銀行)」⇒ 六格全綠。
    //   而備註那格釘的是**常數有被用到** —— 我第一版手打了那句話, 而段 4 那封信用的是常數
    //   ⇒ 兩份字面從第一天起就會分岔。
    render(<OrderDetailView order={bank()} />);
    const q = (id: string) => document.querySelector(`[data-od-id="${id}"]`)!.textContent;
    expect(q('order-remittance-bank')).toBe('中國信託(城北分行)');
    expect(q('order-remittance-holder')).toBe('派達有限公司');
    expect(q('order-remittance-memo')).toContain('匯款備註請填寫訂單編號');
  });

  it('⑥ 期限那句印的是【常數】, 而常數與 migration 由 remittance-info.test.ts 比對', () => {
    render(<OrderDetailView order={bank()} />);
    const note = document.querySelector('[data-od-id="order-remittance-expiry"]');
    expect(note!.textContent).toContain(String(PCM_REMITTANCE_EXPIRE_DAYS));
  });
});

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
      // 🔴 **這一處的註解我第一版寫錯了**(code-reviewer nit ①):
      //   它上下文是 unpaid / 取消單, **不是「已付款的刷卡單」** ——
      //   值 'tappay' 站得住(那是它的付款管道), 而**那句理由對這一處是假的**。
      //   📌 我用一句話覆蓋了 10 處, 而其中 3 處演的是別的世界。
      //   不是「隨便填一個讓它綠」——填的是這個 fixture 本來就在演的那個世界。
      paymentChannel: 'tappay' as const,
      cancelledAt: '2099-05-01T00:00:00Z',
      cancelKind: 'cancelled' as const,
    };
    const EXPIRED = { ...CANCELLED, cancelKind: 'expired' as const };

    /**
     * ⟦ship-CANCELSTEPS⟧ 取消單的進度軸(2026-09-04)。
     *
     * 🔬 **病灶是量出來的** —— 修法之前拿 `CANCELLED` 渲染, 四個子節點實際是:
     *    `od-step is-done is-now │ 訂單成立 …` / `od-step │ 付款完成` / `已出貨` / `已送達`
     *    ⇒ 🎯 已取消的單, 軸上有三格「還沒完成」的待辦, 而 `is-now` 落在第一格
     *    ⇒ 而同一頁徽章寫著「已取消」⇒ **一頁兩句相反的話, 而圖形贏過文字。**
     *
     * 🔵 **印那份 DOM 本身踩過一個坑, 記在這裡**:第一發用 `console.log` 印,
     *    **vitest 把它吞掉了** ⇒ 畫面全空 ⇒ 🔴 **而「空白」會被讀成「那裡沒有東西」。**
     *    ✅ 改用 `throw new Error(...)` 才看得到。
     *    📌 **一個正確的探針印出空白, 與一個沒接上的探針, 長得一模一樣。**
     *
     * ⛔ ~~第一版的修法是「取消單整條軸不畫」~~ ⇒ 🔴 **code-reviewer 打掉了, 而它是對的**:
     *    `paidAt` / `shippedAt` **只住在那條軸上**, 頁面沒有第二個顯示位置
     *    ⇒ 對一張「部分出貨 + 全額退款 + 標記取消」的單(`admin_mark_order_cancelled`
     *      `20260902140000:316-330` **零出貨閘** ⇒ 構造得出來), 整條不畫會**丟掉兩個真事實**。
     *    ✅ 改成:**只留真的發生過的那幾階, 而且沒有 `is-now`。**
     *    📌 **⇒ 我第一版把「不該說未來式」修成了「什麼都不說」—— 另一個方向的錯。**
     *
     * 🛑 **三種單、三個方向, 缺一這道守門就沒有判別力**:
     *    · 未付款就取消 ⇒ 軸上**只剩一階**、零 `is-now`
     *    · 🔴 **已付款已出貨才被取消** ⇒ 三階都在(**真事實不得被吃掉**)、零 `is-now`、
     *      而「已送達」與分批小字都**不得出現**(那兩句對死掉的單是假的)
     *    · 🔵 **正對照:沒取消的單 ⇒ 軸【逐字不變】** —— 少了它,「整段刪掉」也會全綠
     */
    const SHIPPED_CANCELLED = {
      ...ORDER,
      paymentStatus: 'refunded' as const,
      paidAt: '2099-04-20T00:00:00Z',
      shippedAt: '2099-04-25T00:00:00Z',
      allItemsShipped: false,
      cancelledAt: '2099-05-01T00:00:00Z',
      cancelKind: 'cancelled' as const,
    };

    it('🔴 未付款就取消 ⇒ 軸上只剩【真的發生過的】那一階, 而且沒有「現在這一步」', () => {
      for (const [name, o] of [
        ['cancelled', CANCELLED],
        ['expired', EXPIRED],
      ] as const) {
        const { container } = render(<OrderDetailView order={o} />);
        const steps = container.querySelector('[data-od-id="order-steps"]');
        expect(steps, `${name}:軸整個不見了 ⇒ 真事實被吃掉`).not.toBeNull();
        expect(
          Array.from(steps!.children).map((el) => el.className),
          [
            `${name}:已取消的單軸上還有【還沒完成】的階。`,
            '🔴 那會把「付款完成 / 已出貨 / 已送達」畫成待辦, 而 `is-now` 落在第一格',
            '   ⇒ 讀起來是「才剛開始, 下一步等付款」。',
            '🛑 而同一頁的徽章寫著「已取消」⇒ **一頁兩句相反的話, 而圖形贏過文字。**',
          ].join('\n'),
        ).toEqual(['od-step is-done']);
        expect(steps!.textContent, `${name}:未付款的單不得出現「付款完成」`).not.toContain('付款完成');
      }
    });

    it('🔴🔴 已付款已出貨才被取消 ⇒ 那三個【真事實】要留著, 而未來式的兩句要消失', () => {
      const { container } = render(<OrderDetailView order={SHIPPED_CANCELLED} />);
      const steps = container.querySelector('[data-od-id="order-steps"]');
      expect(
        Array.from(steps!.children).map((el) => el.className),
        '真事實被吃掉了 ⇒ 客人再也看不到他何時付款 / 何時出貨(頁面沒有第二個顯示位置)',
      ).toEqual(['od-step is-done', 'od-step is-done', 'od-step is-done']);
      const txt = steps!.textContent ?? '';
      expect(txt, '付款日是真的, 不得消失').toContain('2099-04-20');
      expect(txt, '出貨日是真的, 不得消失').toContain('2099-04-25');
      expect(txt, '「已送達」對一張取消單是假的').not.toContain('已送達');
      expect(
        container.querySelector('[data-od-id="order-partial-shipment-note"]'),
        '「其餘商品出貨時會再通知您」對一張死掉的單是假的 —— 而它與進度軸是同一個病',
      ).toBeNull();
    });

    /**
     * ⟦ship-REFUNDEDPAIDSTEP⟧ 「付款完成」問的是**他付過沒**, 不是**現在的狀態**。
     * Sean 2026-09-04 拍甲(逐字「他確實付過, 那是發生過的事實」)。
     *
     * 🔴 **三個方向, 而中間那個是我加的、要能被推翻**:
     *    · `refunded`         ⇒ 打勾(他拍的)
     *    · `partiallyRefunded` ⇒ 打勾(**我加的** —— 它蘊含之前已全額付款)
     *    · 🛑 `partiallyPaid`  ⇒ **不得打勾**(只收了訂金, 那個人還欠錢)⇒ 打勾會是謊
     * 🔵 而**第三格就是這一片的負對照** —— 少了它,「一律打勾」也會通過。
     */
    it.each([
      ['refunded', true],
      ['partiallyRefunded', true],
      ['partiallyPaid', false],
    ] as const)('🔴 %s 的單 ⇒ 「付款完成」打勾 = %s', (status, shouldTick) => {
      const { container } = render(
        <OrderDetailView
          order={{ ...ORDER, paymentStatus: status, paidAt: '2099-04-20T00:00:00Z' }}
        />,
      );
      const steps = Array.from(
        container.querySelector('[data-od-id="order-steps"]')!.children,
      );
      const step = steps.find((el) => el.textContent?.includes('付款完成'));
      expect(step, '「付款完成」那一階不見了 ⇒ 這一格已經不是在量同一個東西').toBeDefined();
      expect(
        step!.className.includes('is-done'),
        shouldTick
          ? `${status}:客人真的付過, 而畫面把「付款完成」畫成灰的 ⇒ 他剛收到退款而我們說沒收到錢, 兩個訊息打架`
          : `${status}:只收了訂金而打勾 ⇒ 那是一句謊(他還欠錢)`,
      ).toBe(shouldTick);
    });

    it('🔵 正對照:沒取消的單 ⇒ 進度軸四格【逐字不變】', () => {
      const { container } = render(<OrderDetailView order={ORDER} />);
      const steps = container.querySelector('[data-od-id="order-steps"]');
      expect(steps, '沒取消的單也被改了 ⇒ 上面那兩格變成恆綠').not.toBeNull();
      expect(
        Array.from(steps!.children).map((el) => el.className),
        '進度軸的形狀被改了 ⇒ 上面那兩格守的東西已經不是同一個',
      ).toEqual(['od-step is-done', 'od-step is-done is-now', 'od-step', 'od-step']);
    });

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
  /**
   * ⟦ship-AXISHOLE⟧ 進度軸中間那個洞(Sean 2026-09-04 Q7 拍乙:那格變灰色 + 一句「尚未收到匯款」)。
   *
   * 🔴🔴 **「那格變灰色」那一半【不可以拿來當驗收條件】** —— 它在改之前也是灰的
   *    (`ok: paymentCompleted` 為 false ⇒ 沒有 `is-done`)⇒ 🎯 **零判別力**:
   *    把整個 `unpaidButShipped` 分支刪掉, 一格「是灰的」的斷言照樣全綠。
   *    ⇒ ✅ **承重的是 `.od-step-d` 的字**, 而下面每一格都釘那一格。
   *
   * 🛑 **四格是三個方向 + 一個正對照, 少任一格這道守門就漏一種錯法**:
   *    · 洞的世界 ⇒ 印那句話(**改對了沒**)
   *    · 沒出貨的未付款單 ⇒ **不印**(證明它不是無條件印 —— 少了這格,`d: 常數` 寫死也全綠)
   *    · 付過款的單 ⇒ 印**日期**(證明那句話沒有把一個真事實蓋掉)
   *    · 🔴 取消單 ⇒ 不印, **而且「付款完成」那一階不得被打勾**
   */
  describe('⟦ship-AXISHOLE⟧ 先出貨後收款 ⇒ 付款完成那一格說得出【為什麼是灰的】', () => {
    // 匯款單:貨出了而錢還沒到。`paidAt` 為 null 是這個世界的定義, 不是順手設的。
    const UNPAID_SHIPPED = {
      ...ORDER,
      paymentStatus: 'unpaid' as const,
      paidAt: null,
      shippedAt: '2099-04-25T00:00:00Z',
      allItemsShipped: true,
    };
    // 付款完成 = 第 2 階。🔵 錨:進度軸插一階時 `[1]` 會安靜地量錯階段而仍然綠
    //    ⇒ 每一格都先斷言標題字, 照本檔既有那幾格的形狀。
    const payStep = (c: HTMLElement) => {
      const el = Array.from(c.querySelectorAll('.od-step'))[1]!;
      expect(el.querySelector('.od-step-t')?.textContent).toBe('付款完成');
      return el;
    };

    it('🔴 已出貨而未付款 ⇒ 那一格印「尚未收到匯款」, 而且仍然是灰的', () => {
      const { container } = render(<OrderDetailView order={UNPAID_SHIPPED} />);
      const el = payStep(container);
      expect(el.querySelector('.od-step-d')?.textContent).toBe(
        ORDER_DETAIL_UNPAID_SHIPPED_NOTE,
      );
      // 🛑 這一行本身零判別力(見上面的 docstring), 留著是因為「印了字卻順手打了勾」
      //    會是一句與那行字**相反**的話 —— 兩者要一起被釘住。
      expect(el.className).not.toContain('is-done');
    });

    it('🔵 負對照:還沒出貨的未付款單 ⇒ 那一格【空白】(少了這格, 寫死一個常數也會全綠)', () => {
      const { container } = render(
        <OrderDetailView order={{ ...UNPAID_SHIPPED, shippedAt: null, allItemsShipped: false }} />,
      );
      expect(payStep(container).querySelector('.od-step-d')?.textContent).toBe('');
    });

    it('🔵 負對照:付過款的單 ⇒ 那一格印【日期】, 那句話不得蓋掉一個真事實', () => {
      const { container } = render(
        <OrderDetailView
          order={{ ...ORDER, shippedAt: '2099-04-25T00:00:00Z', allItemsShipped: true }}
        />,
      );
      expect(payStep(container).querySelector('.od-step-d')?.textContent).toBe('2099-04-18');
      expect(screen.queryByText(ORDER_DETAIL_UNPAID_SHIPPED_NOTE)).toBeNull();
    });

    /**
     * 🔴🔴 **這一格擋的是我在寫這一片時【差點自己製造】的缺陷, 不是假想的世界。**
     *
     * `happened()` 的判準是 `s.ok || s.d !== ''`, 而 `shownSteps` 對取消單把留下來的
     * 每一階 **一律 `ok: true`** ⇒ 🛑 只要那句話進了取消單的 `d`,
     * 「付款完成」就會從【整格不顯示】變成【顯示 **而且打勾**】
     * ⇒ 🎯 **一張從來沒付過錢的單, 畫面上會打勾說他付了** —— 而勾旁邊寫著「尚未收到匯款」。
     * 📌 **⇒ 一個只負責多印一句話的修法, 透過一個它沒有讀的判準改掉了【打不打勾】。**
     */
    it('🔴 取消單 ⇒ 那句話不出現, 而且「付款完成」不得因此被打勾', () => {
      const CANCELLED_UNPAID_SHIPPED = {
        ...UNPAID_SHIPPED,
        cancelledAt: '2099-05-01T00:00:00Z',
        cancelKind: 'cancelled' as const,
      };
      const { container } = render(<OrderDetailView order={CANCELLED_UNPAID_SHIPPED} />);
      expect(screen.queryByText(ORDER_DETAIL_UNPAID_SHIPPED_NOTE)).toBeNull();
      // 🔴 承重的一行:拿掉 `unpaidButShipped` 的 `!cancelled` ⇒ 這裡會冒出「付款完成」。
      expect(
        Array.from(container.querySelectorAll('.od-step-t')).map((n) => n.textContent),
        '取消單的軸上只該留【真的發生過】的階段 —— 而這張單從來沒付過錢',
      ).not.toContain('付款完成');
    });
  });
  /**
   * ⟦ship-WHICHITEMSSHIPPED⟧ 部分出貨時, 客人看不看得出是【哪幾件】(Sean 2026-09-04 Q5 拍甲)。
   *
   * 🔬 **修法之前的畫面是量到的, 不是推的**:真瀏覽器實測一張 5 品項出了 3 件的單
   *    ⇒ 徽章「處理中」· 進度軸「已出貨」亮 · 小字「其餘商品出貨時會再通知您」都**對**,
   *    而 🔴 **商品明細五列逐字相同**。⇒ 🎯 客人被告知出了一部分, 而畫面說不出是哪一部分。
   *
   * 🛑 **三格是三個方向, 而中間那格是這道守門唯一殺得死「無條件印」的地方**:
   *    · 出了的那幾列 ⇒ 印(**改對了沒**)
   *    · 🔴 **沒出的那幾列 ⇒ 不印**(少了它, `{ORDER_DETAIL_ITEM_SHIPPED_MARK}` 寫死不帶條件也全綠)
   *    · 🔵 **全部沒出 ⇒ 一個都不印**(整張單的負對照)
   */
  describe('⟦ship-WHICHITEMSSHIPPED⟧ 部分出貨 ⇒ 客人看得出是哪幾件', () => {
    // 三件的單:第 1 件與第 3 件出了, 第 2 件沒有。
    // 🔴 **刻意讓出貨的那兩件【不相鄰】** —— 若接線接成「前 N 件」, 一組相鄰的 fixture 會安靜地全綠。
    const it3 = (over: Partial<MemberOrderDetail['items'][number]>, i: number) => ({
      ...ORDER.items[0]!,
      id: `oi-${i}`,
      variantSku: `SKU-${i}`,
      title: `品項${i}`,
      ...over,
    });
    const PARTIAL: MemberOrderDetail = {
      ...ORDER,
      shippedAt: '2099-04-25T00:00:00Z',
      allItemsShipped: false,
      items: [
        it3({ shipped: true }, 1),
        it3({ shipped: false }, 2),
        it3({ shipped: true }, 3),
      ],
    };
    const marks = (c: HTMLElement) =>
      Array.from(c.querySelectorAll('.od-line')).map(
        (l) => l.querySelector('[data-od-id="order-line-shipped"]')?.textContent ?? null,
      );

    it('🔴 出了第 1、3 件 ⇒ 只有那兩列印「已出貨」, 中間那列不印', () => {
      const { container } = render(<OrderDetailView order={PARTIAL} />);
      expect(marks(container)).toEqual([
        ORDER_DETAIL_ITEM_SHIPPED_MARK,
        null,
        ORDER_DETAIL_ITEM_SHIPPED_MARK,
      ]);
      // 🔵 而那句「其餘商品出貨時會再通知您」在這個世界裡是**對的** ⇒ 兩者要同時成立。
      expect(screen.getByText(ORDER_DETAIL_PARTIAL_SHIPMENT_NOTE)).toBeTruthy();
      /**
       * 🔴 **它落在【哪一欄】也要釘**(adversarial-reviewer 2026-09-04 nit):
       * `marks()` 只問「這一列底下有沒有那個節點」⇒ 把那個 `<div>` 搬進 `.od-line-r`(金額那欄)
       * **三格照樣全綠**, 而畫面上「已出貨」會跑到價格旁邊。
       * ⇒ ✅ 釘法:它必須與品名 `.od-line-name` **同一個父節點**(中間那一欄)。
       */
      const firstLine = container.querySelector('.od-line')!;
      const mark = firstLine.querySelector('[data-od-id="order-line-shipped"]')!;
      expect(
        mark.parentElement,
        '「已出貨」跑到金額那一欄 ⇒ 客人會把它讀成價格的註解',
      ).toBe(firstLine.querySelector('.od-line-name')!.parentElement);
    });

    it('🔵 負對照:一件都沒出 ⇒ 一個「已出貨」都不印(少了這格, 無條件印也會全綠)', () => {
      const { container } = render(
        <OrderDetailView
          order={{
            ...PARTIAL,
            shippedAt: null,
            items: PARTIAL.items.map((x) => ({ ...x, shipped: false })),
          }}
        />,
      );
      expect(marks(container)).toEqual([null, null, null]);
    });

    it('🔵 全部出完 ⇒ 每一列都印, 而分批小字不出現(那句話對它是假的)', () => {
      const { container } = render(
        <OrderDetailView
          order={{
            ...PARTIAL,
            allItemsShipped: true,
            items: PARTIAL.items.map((x) => ({ ...x, shipped: true })),
          }}
        />,
      );
      expect(marks(container)).toEqual([
        ORDER_DETAIL_ITEM_SHIPPED_MARK,
        ORDER_DETAIL_ITEM_SHIPPED_MARK,
        ORDER_DETAIL_ITEM_SHIPPED_MARK,
      ]);
      expect(screen.queryByText(ORDER_DETAIL_PARTIAL_SHIPMENT_NOTE)).toBeNull();
    });
  });
  /**
   * ⟦ship-WHICHITEMSSHIPPED⟧ **一張部分出貨【之後被取消】的單**(Sean 2026-09-04 拍 Q-C 乙)。
   *
   * 🎯 **這個縫是逐件標記上線之後才露出來的**:3 列「已出貨」+ 2 列**空白**,
   *    而那 2 件永遠不會來 —— 而「其餘商品出貨時會再通知您」對取消單是**刻意不印的**
   *    ⇒ 🛑 在此之前那兩列沒有任何一句話講它。
   *
   * 🔴 **本 describe 的斷言【寫字面值, 不寫 import 來的常數】** —— 而那是 2026-09-04
   *    adversarial-reviewer 打出來的:上面「已出貨」那族三格全部 `import` 常數去比
   *    ⇒ **把常數的值改掉每一格照樣全綠** ⇒ 🎯 測試問的是「畫面印的與常數一樣嗎」,
   *    **而沒有人問「常數是他拍的那句話嗎」**。
   *    ⇒ ✅ 這一族從出生就帶著修法, 不等下一輪審查再補。
   *    🔵 而**常數那一側另有一格逐字釘**(`account-order-copy.test.ts`)⇒ 兩層各守一半。
   */
  describe('⟦ship-WHICHITEMSSHIPPED⟧ 部分出貨之後被取消 ⇒ 沒出的那幾件說得出「不會來了」', () => {
    const line = (over: Partial<MemberOrderDetail['items'][number]>, i: number) => ({
      ...ORDER.items[0]!,
      id: `oc-${i}`,
      variantSku: `SKU-${i}`,
      title: `品項${i}`,
      ...over,
    });
    // 出了第 1、3 件之後整張被取消。🔴 刻意讓出貨的兩件【不相鄰】。
    const PARTIAL_CANCELLED: MemberOrderDetail = {
      ...ORDER,
      paymentStatus: 'refunded',
      paidAt: '2099-04-18T03:00:00Z',
      shippedAt: '2099-04-25T00:00:00Z',
      allItemsShipped: false,
      cancelledAt: '2099-05-01T00:00:00Z',
      cancelKind: 'cancelled',
      items: [
        line({ shipped: true }, 1),
        line({ shipped: false }, 2),
        line({ shipped: true }, 3),
      ],
    };
    /** 每一列印的那句話(兩個標記各查一次;都沒有 ⇒ null)。 */
    const says = (c: HTMLElement) =>
      Array.from(c.querySelectorAll('.od-line')).map((l) => {
        const shipped = l.querySelector('[data-od-id="order-line-shipped"]')?.textContent;
        const cancelled = l.querySelector('[data-od-id="order-line-cancelled"]')?.textContent;
        // 🔴 兩個同時出現 = 同一列講兩句相反的話 ⇒ 讓它顯形, 不要靜靜取一個
        if (shipped !== undefined && cancelled !== undefined) return '兩句都印了';
        return shipped ?? cancelled ?? null;
      });

    it('🔴 出了的印「已出貨」、沒出的印「已取消」—— 字面寫死, 不從常數 import', () => {
      const { container } = render(<OrderDetailView order={PARTIAL_CANCELLED} />);
      // 🔴 這三個字面是【Sean 打的字】, 不是「跟常數一樣就好」。
      expect(says(container)).toEqual(['已出貨', '已取消', '已出貨']);
    });

    it('🔵 負對照:同一張單【沒有取消】⇒ 中間那列回到空白(證明它吃的是 cancelled)', () => {
      const { container } = render(
        <OrderDetailView
          order={{ ...PARTIAL_CANCELLED, cancelledAt: null, cancelKind: 'none' }}
        />,
      );
      expect(says(container)).toEqual(['已出貨', null, '已出貨']);
    });

    /**
     * 🔵 **整張都沒出就取消 ⇒ 每一列都印它。這是刻意的, 不是溢出。**
     * 徽章講的是**整張單**, 而客人問的是**這一件會不會來** ⇒ 兩個問題、兩個位置。
     * ⚠️ 而代價明寫:那種單上這句話**與徽章重複** ⇒ 若 Sean 覺得吵, 那是一個可以縮的板。
     */
    it('🔵 整張都沒出就取消 ⇒ 每一列都印「已取消」(刻意, 不是溢出)', () => {
      const { container } = render(
        <OrderDetailView
          order={{
            ...PARTIAL_CANCELLED,
            shippedAt: null,
            items: PARTIAL_CANCELLED.items.map((x) => ({ ...x, shipped: false })),
          }}
        />,
      );
      expect(says(container)).toEqual(['已取消', '已取消', '已取消']);
    });

    /**
     * 🔴 **對一件【已經送到客人手上】的東西印「已取消」是一句假話, 而它比空白糟。**
     * 這一格單獨釘住那個互斥:少了它, 把條件從 `cancelled && !item.shipped`
     * 寫成 `cancelled` ⇒ 上面第一格會印「兩句都印了」而**第三格照樣全綠**。
     */
    it('🔴 出過的那幾件不得被標成「已取消」—— 那是一句假話', () => {
      const { container } = render(<OrderDetailView order={PARTIAL_CANCELLED} />);
      const shippedLines = Array.from(container.querySelectorAll('.od-line')).filter((l) =>
        l.querySelector('[data-od-id="order-line-shipped"]'),
      );
      expect(shippedLines.length, '沒抓到任何一列已出貨 ⇒ 這把尺沒接上').toBe(2);
      for (const l of shippedLines) {
        expect(
          l.querySelector('[data-od-id="order-line-cancelled"]'),
          '一件已經送到客人手上的東西被標成「已取消」',
        ).toBeNull();
      }
    });
  });
});

describe('稅額那一列與「小計(未稅)」(⟦b4-TAXSURFACES⟧ 第 7 步;Sean 2026-09-04 拍甲)', () => {
  afterEach(cleanup);

  // 🔴🔴 **這一族要驗的是「兩個世界印不同的東西」** ——
  //    今天每一張單的稅都是 0(價格含稅)⇒ 只驗有稅那一格的話,
  //    **今天的世界從來沒有被測過**, 而它才是每天在跑的那一個。

  it('🔵 稅 0(= 今天每一張單)⇒ 不印稅額那一列, 標籤維持「商品小計」', () => {
    render(<OrderDetailView order={ORDER} />);
    expect(screen.queryByText('稅額')).toBeNull();
    expect(screen.getByText('商品小計')).toBeTruthy();
    expect(screen.queryByText('商品小計(未稅)')).toBeNull();
  });

  it('🔴 稅 > 0 ⇒ 印出稅額那一列, 而標籤變成「商品小計(未稅)」', () => {
    // 🔴🔴 **有稅的 fixture 一定要【平衡】**(codex R3 must-fix 2):
    //    `subtotal + 運費 − 折扣 + 稅 = total`。⛔ 我第一版沿用原本的 `total` 12,100
    //    ⇒ 那種單**違反 DB 的金額等式、正式庫根本寫不進去**
    //    ⇒ 📌 **我在測一個不存在的世界, 而它照樣全綠。**
    // 12000 + 100 − 0 + 605 = 12705
    render(<OrderDetailView order={{ ...ORDER, taxTotal: money(605), total: money(12705) }} />);
    expect(screen.getByText('稅額')).toBeTruthy();
    expect(screen.getByText('商品小計(未稅)')).toBeTruthy();
    // 🔴 舊標籤**必須消失** —— 少了這一格, 一個「兩個標籤都印」的實作會全綠。
    expect(screen.queryByText('商品小計')).toBeNull();
  });

  it('🔴 順序:小計 → 運費 → 折扣 → 稅額 → 訂單金額(codex R1 must-fix:原本零守門)', () => {
    // 🛑 少了這一格, **把稅額列搬到小計之前或總額之後, 上面每一格都照樣綠**。
    // 🔵 折扣要 > 0, 否則折扣那一列根本沒印 ⇒ 拿 -1 當座標會假綠。
    // 🔴 量的是 `.od-sums` 那一塊裡**每一列的標籤**, 不是整頁字串 ——
    //    整頁量的話會撞到別處同名的字(客人那張紙那支檔實測撞過一次:
    //    「訂單金額」在文件更前面也出現)。
    const { container } = render(
    // 🔴🔴 **有稅的 fixture 一定要【平衡】**(codex R3 must-fix 2):
    //    `subtotal + 運費 − 折扣 + 稅 = total`。⛔ 我第一版沿用原本的 `total` 12,100
    //    ⇒ 那種單**違反 DB 的金額等式、正式庫根本寫不進去**
    //    ⇒ 📌 **我在測一個不存在的世界, 而它照樣全綠。**
    // 12000 + 100 − 150 + 605 = 12555
      <OrderDetailView
        order={{ ...ORDER, discountTotal: money(150), taxTotal: money(605), total: money(12555) }}
      />,
    );
    const labels = Array.from(container.querySelectorAll('.od-sums .od-sum > span')).map(
      (el) => el.textContent,
    );
    expect(labels.slice(0, 4)).toEqual(['商品小計(未稅)', '運費', '折扣', '稅額']);
    // 🟢 而最後一列是總額(它的標籤隨付款狀態變 ⇒ 只驗它在最後、不驗字面)
    expect(labels).toHaveLength(5);
  });

  it('🔴 稅額那一列的值是【逐字精確】的, 不是子字串(codex R2 must-fix 3)', () => {
    // ⛔ 原本是 `toContain('605')` ⇒ 📌 **印成 `NT$ 1,605` 也會綠** —— 這是金額面, 不能只問子字串。
    // ✅ 改成把【標籤與它那一格的值】綁在同一列, 並驗那一格的**完整文字**。
    // 🔬 值用【四位數】—— 三位數時「有沒有千分位」印同一個東西。
    // 🔵 而這一面**印 `NT$`**, 客人那張紙**不印**(紙的區塊標題已寫「新臺幣」)——
    //    兩份格式化本來就不同, 不要拿一份的字面去套另一份。(實測改的)
    // 🔴🔴 **有稅的 fixture 一定要【平衡】**(codex R3 must-fix 2):
    //    `subtotal + 運費 − 折扣 + 稅 = total`。⛔ 我第一版沿用原本的 `total` 12,100
    //    ⇒ 那種單**違反 DB 的金額等式、正式庫根本寫不進去**
    //    ⇒ 📌 **我在測一個不存在的世界, 而它照樣全綠。**
    // 12000 + 100 − 0 + 1605 = 13705
    render(<OrderDetailView order={{ ...ORDER, taxTotal: money(1605), total: money(13705) }} />);
    const row = screen.getByText('稅額').closest('.od-sum');
    expect(row).not.toBeNull();
    expect(row!.querySelector('b')?.textContent).toBe('NT$ 1,605');
  });
});
