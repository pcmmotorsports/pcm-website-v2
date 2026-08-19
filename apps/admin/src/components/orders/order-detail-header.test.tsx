// @vitest-environment jsdom
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render } from '@testing-library/react';
import type { AdminOrderDetail } from '@pcm/domain';

import { OrderDetail } from './order-detail';

import { stripComments } from '../../lib/test-support/strip-comments';

// order-detail-header.test.ts — 片2 標頭列的守門(設計稿 §1)。
//
// 🔴 **為什麼需要它**:本片動手前,標頭那一段**一格守門都沒有** —— 我把客人入口從第一行
//    搬到第二行、把下單日期搬走、加了狀態 chip,`pnpm test` 全程 864 格**沒有一格紅**。
//    ⇒ 「改了沒東西紅」在這裡不代表沒破壞,代表**那塊沒有人在看**。
//
// ⚠️⚠️ **本檔擋得住什麼、擋不住什麼(不要讀成「標頭已驗證」)**:
//   擋得住 —— 三個欄位被刪、客人入口被拿掉、有人把「未收齊」硬寫進來、標籤表換成自寫字面。
//   **擋不住** —— 版面長相、兩行有沒有真的排成兩行、chip 顏色對不對、`✕` 好不好按。
//   那些要**真瀏覽器 + Sean 的眼睛**(交付形式照 Sean 2026-08-17 逐字「直接來真的但是開伺服器做＋看」)。
//
// 🔴 **設計真權威的狀態,講精確一點**(我上一版寫「拿不到」,`W4-004` 更正:只對一半):
//   · `git submodule update --init design-reference/` ⇒ **拿得到**(W4 當場跑成功)。
//     ⇒ 下一個人照「拿不到」那句,**連 submodule 都不會去試** —— 所以那句要改。
//   · **但 `design-reference/` 不含 admin 訂單 UI**(它是 storefront 的)⇒ 對本片沒有用。
//   · 本片的真權威是 OD 專案 `pcm-admin-order-ui`,而 **OD daemon `127.0.0.1:7456` 連不上** ⇒ **那才是缺口。**
//   ⇒ **結論不變(做結構、不宣稱像素對齊),理由要換。**
//
// 🔴🔴 **本檔第一版寫「render 的 mock 前置是 60 行」—— 那個數字是【我編的,從沒量過】。**
//   `W4-004` F1 抓到,而它的失敗情境是具體的:下一個人照那句話決定「render 不划算」,
//   於是「兩行有沒有真的排成兩行」「chip 有沒有真的畫出來」**永遠沒有人守**,
//   **而那句讀起來像我已經評估過成本。**
//
//   **實際量到的(2026-08-19,本檔當場做出來的)**:
//     · 沿用既有頁層 harness(`app/orders/[id]/cancel-wiring.test.tsx`)⇒ 邊際成本 **~5 行**
//       (該檔 `:288-296` 就是一個 3 行的 `render(<OrderDetail …/>)`,而且自帶正向對照)
//     · 開新檔照抄那份頁層 harness ⇒ **~86 行**(14 個 `vi.mock` + 61 行 fixture)—— **比我編的 60 還多**
//     · 🔴 **而本檔用的是第三條路:把 OrderDetail 的子元件【全部 mock 掉】** ⇒ **~25 行**
//       ⇒ fixture 只需要標頭真的讀到的那幾個欄位,其餘不必湊。
//   ⇒ 📌 **教訓不是「render 很便宜」,是【我在沒量的情況下寫了一個成本數字,而它決定了要不要做】。**
//
// ⚠️ 兩層守門各自的射程,不要互相冒充:
//   **字面守門**只證明「code 裡有那個字串」;**render 守門**才證明「那個字串真的進到畫面」。

const read = (rel: string) => stripComments(readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8'));
const DETAIL = read('./order-detail.tsx');
const PANEL = read('../../app/@panel/orders/page.tsx');

describe('片2 標頭列', () => {
  it.each(['客戶', '下單 ', '發票 '])('🔴 第二行帶「%s」這一格', (label) => {
    expect({ [label]: DETAIL.includes(label) }).toEqual({ [label]: true });
  });

  it('🔴 客人明細入口**還在**(OD 要求它做在名字上;搬行可以,拿掉不行)', () => {
    expect(DETAIL).toContain('customerHref !== null');
    expect(DETAIL).toMatch(/<Link href=\{customerHref\}/);
  });

  // 🔴🔴 這一格守的是**拍板**,不是程式:Sean 2026-08-18 `Q3` 把 `partiallyPaid` 的字面
  //    定為「已收訂金」。設計稿寫「未收齊」⇒ 若有人照設計稿硬寫,同一張畫面會出現兩個詞
  //    指同一件事。要改是**兩處一起改 + 他點頭**,不是在這裡補一個字面。
  it('🔴 狀態 chip 走既有標籤表,**沒有人把「未收齊」硬寫進來**', () => {
    expect(DETAIL).toContain('PAYMENT_STATUS_LABEL[detail.paymentStatus]');
    expect({ 硬寫未收齊: DETAIL.includes('未收齊') }).toEqual({ 硬寫未收齊: false });
  });

  it('🔴 發票那一格與發票卡共用同一支標籤表(兩處各寫一份 ⇒ 改詞只會改到一邊)', () => {
    expect(DETAIL).toContain('INVOICE_STATUS_LABEL[detail.invoiceStatus]');
  });
});

describe('片2 面板專屬的兩件(整頁版不得受影響)', () => {
  it('🔴 M 三色條在**面板路由**、用既有 `.m-stripe`、且推出容器內距才會通欄', () => {
    expect(PANEL).toContain('m-stripe');
    expect(PANEL).toMatch(/-mx-4 -mt-4/);
    expect({ 裝飾不該被唸出來: /aria-hidden/.test(PANEL) }).toEqual({ 裝飾不該被唸出來: true });
  });

  it('🔴 關閉文案是 `✕`,且**只在面板這一邊**(整頁版走 app/orders/[id],不吃這一行)', () => {
    expect(PANEL).toContain("label: '✕ 關閉'");
    expect(DETAIL).not.toContain('✕');
  });
});


// ── render 層:證明那三格【真的進到畫面】,不只是 code 裡有那個字串 ──────────────
//
// 🔴 **把 OrderDetail 的子元件全部 mock 成 `() => null`** —— 這一片守的是標頭,
//    而標頭以外的每一塊都會自己拉 server action / repository / `server-only`。
//    mock 掉之後 fixture 只需要**標頭真的讀到的欄位**,不必湊出一整份 `AdminOrderDetail`。
vi.mock('server-only', () => ({}));
vi.mock('./order-detail-summary-cards', () => ({ OrderSummaryCards: () => null }));
vi.mock('./notes-timeline', () => ({ NotesTimeline: () => null }));
vi.mock('./note-compose-form', () => ({ NoteComposeForm: () => null }));
vi.mock('./order-edit-form', () => ({ OrderEditForm: () => null }));
vi.mock('./order-detail-items-table', () => ({ ItemsTable: () => null }));
vi.mock('./item-procurement-section', () => ({ ItemProcurementSection: () => null }));
vi.mock('./payment-section', () => ({ PaymentSection: () => null }));
vi.mock('./shipment-section', () => ({ ShipmentSection: () => null }));
vi.mock('./order-cancel-block', () => ({ OrderCancelBlock: () => null }));
vi.mock('./refund-ledger-section', () => ({ RefundLedgerSection: () => null }));
vi.mock('./refund-section', () => ({ RefundSection: () => null }));

// 🔴 `as unknown as` 是刻意的:本檔**只**渲染標頭,湊一份完整 `AdminOrderDetail`
//    等於把 61 行 fixture 抄進來,而那 61 行沒有一行被本檔的斷言讀到。
//    ⚠️ 代價要講白:欄位改名時本 fixture **不會編譯紅** —— 那一面由型別檢查在**正式呼叫端**擋。
const HEAD_DETAIL = {
  id: '11111111-1111-4111-8111-111111111111',
  displayId: 'ABC123',
  createdAt: '2026-08-10T02:00:00+00:00',
  paymentStatus: 'partiallyPaid',
  invoiceStatus: 'not_issued',
  cancelledAt: null,
  customer: { name: '沈佑霖', phone: null, email: null },
  customerUserId: null,
  total: { amount: 23800, currency: 'TWD' },
  items: [],
  notes: [],
} as unknown as AdminOrderDetail;

describe('片2 標頭列 · render 層', () => {
  afterEach(cleanup);

  it('🔴 三格【真的畫出來】+ 正向對照(沒有對照的話「都在」可能是恆真)', () => {
    const { container } = render(
      <OrderDetail detail={HEAD_DETAIL} returnTo='/orders' payments={{ status: 'ok', rows: [] }} />,
    );
    // 正向對照:證明元件真的渲染了(否則下面三條在「什麼都沒畫」時也會失敗得莫名其妙)。
    expect(container.textContent).toContain('ABC123');
    expect(container.textContent).toContain('客戶');
    expect(container.textContent).toContain('下單');
    expect(container.textContent).toContain('發票');
  });

  it('🔴 chip 畫出來的是【既有標籤表的字】,不是設計稿那個「未收齊」', () => {
    const { container } = render(
      <OrderDetail detail={HEAD_DETAIL} returnTo='/orders' payments={{ status: 'ok', rows: [] }} />,
    );
    // `partiallyPaid` 的字面 Sean 2026-08-18 `Q3` 拍為「已收訂金」。
    expect(container.textContent).toContain('已收訂金');
    expect(container.textContent).not.toContain('未收齊');
  });

  it('🔴 發票那一格畫的是狀態字,不是發票號碼(同 orders-table 那次踩過的坑)', () => {
    const { container } = render(
      <OrderDetail detail={HEAD_DETAIL} returnTo='/orders' payments={{ status: 'ok', rows: [] }} />,
    );
    expect(container.textContent).toContain('未開立');
  });
});
