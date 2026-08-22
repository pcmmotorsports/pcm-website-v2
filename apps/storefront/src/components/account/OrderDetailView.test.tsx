// @vitest-environment jsdom
//
// OrderDetailView smoke(`#240` 會員訂單明細)。
//
// 驗:
// - 單號 / 狀態徽章三檔 tone / 金額四欄 / 收件三欄
// - 🔴 品牌 null ⇒ **整行不印**;收件缺值 ⇒ **印 `—`**(兩者刻意相反,各有理由)
// - 🔴 運費 0 ⇒「免運」;未付款 ⇒「應付金額」、已付款 ⇒「實付金額」
// - 🔴 itemsTruncated ⇒ 件數印「?」+ 印出說明段;**不得印 0、不得留空**
// - 🔴 稿上「沒有資料來源」的東西不得出現(下載 PDF / 查詢物流)—— 做出來就是第二顆死鈕
// - 反洩 guard:畫面文字零經銷價字面

import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { toMoneyAmount, type MemberOrderDetail } from '@pcm/domain';
import { OrderDetailView } from './OrderDetailView';
import { ORDER_DETAIL_ITEMS_TRUNCATED_NOTE } from '@/lib/account-order-copy';

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
  subtotal: money(12000),
  shippingFee: money(100),
  discountTotal: money(0),
  total: money(12100),
  shippingMethod: 'home',
  shippingAddress: { name: '王小明', phone: '0912345678', line: '新北市新莊區化成路 736 巷 18 號' },
  cancelledAt: null,
  cancelledReason: null,
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
  it('零死鈕:不得出現「下載訂單 PDF」/「查詢物流進度」(兩者都沒有資料來源)', () => {
    const { container } = render(<OrderDetailView order={ORDER} />);
    expect(container.textContent).not.toContain('下載訂單 PDF');
    expect(container.textContent).not.toContain('查詢物流進度');
    // 🔴 反向那半:整頁不得有任何【沒有 href 的 <a>】或【沒有 onClick 的 <button>】
    expect(container.querySelector('button')).toBeNull();
    for (const a of Array.from(container.querySelectorAll('a'))) {
      expect(a.getAttribute('href')).toBeTruthy();
    }
  });

  it('已取消訂單 ⇒ 印可對客的取消原因;未取消 ⇒ 整區不印', () => {
    const { container } = render(
      <OrderDetailView
        order={{ ...ORDER, cancelledAt: '2099-05-01T00:00:00Z', cancelledReason: '缺貨,已全額退款' }}
      />,
    );
    expect(container.textContent).toContain('訂單已取消');
    expect(container.textContent).toContain('缺貨,已全額退款');
    cleanup();
    const { container: c2 } = render(<OrderDetailView order={ORDER} />);
    expect(c2.querySelector('[data-od-id="order-cancelled"]')).toBeNull();
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
