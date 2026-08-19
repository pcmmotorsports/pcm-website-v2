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
  // 🔴🔴 **本組由「第二行三格」改成「單列」**(2026-08-19 片2b):
  //    上一版斷言標頭有「客戶/下單/發票」三個**字面標籤**,那是我照 `MAIN-057` 的 ASCII 轉錄做的,
  //    而**設計稿標頭是單列、沒有那三個標籤字、也沒有發票那一格**。
  //    ⇒ 那三格斷言曾經全綠,而它們守的是一個**錯的形狀** —— **測試綠不保證形狀對。**
  // ⚠️ **nit(W6-019 ①):下面那條原本比對【連在一起的四個 class】,等於把順序也鎖住了** ——
  //    它是守門不是絆線,而假紅是成本。改成逐個查存在,順序不管。
  //    (排序器在不在我**沒查** —— 所以不倚賴「反正它會排好」。)
  it('🔴 標頭是**單列**:`flex-nowrap` + 逐字搬的 `h-[38px]` / `gap-[9px]`(設計稿 `:219`)', () => {
    for (const cls of ['flex-nowrap', 'h-[38px]', 'gap-[9px]', 'items-center']) {
      expect({ [cls]: DETAIL.includes(cls) }).toEqual({ [cls]: true });
    }
    // 負向:上一版那個會換行的容器不得復活。
    expect({ 有flexwrap: /flex-wrap items-center gap-3'>\s*<h1/.test(DETAIL) }).toEqual({ 有flexwrap: false });
  });

  it('🔴 金額那一格在(設計稿 `:1113` `<span class="amt">NT$ …`;上一版【漏做也沒揭露】)', () => {
    expect(DETAIL).toContain('formatOrderAmount(detail.total.amount)');
  });

  it('🔴 發票那一格**已拿掉**(設計稿標頭沒有它;它與兩列標頭同一個根因)', () => {
    expect({ 標頭仍有發票: DETAIL.includes('INVOICE_STATUS_LABEL') }).toEqual({ 標頭仍有發票: false });
  });

  it('🔴 客人明細入口**還在**(OD 要求它做在名字上;搬行可以,拿掉不行)', () => {
    expect(DETAIL).toContain('customerHref !== null');
    expect(DETAIL).toMatch(/<Link\s+href=\{customerHref\}/);
  });

  // 🔴🔴 這一格守的是**拍板**,不是程式:Sean 2026-08-18 `Q3` 把 `partiallyPaid` 的字面
  //    定為「已收訂金」。設計稿寫「未收齊」⇒ 若有人照設計稿硬寫,同一張畫面會出現兩個詞
  //    指同一件事。要改是**兩處一起改 + 他點頭**,不是在這裡補一個字面。
  it('🔴 狀態 chip 走既有標籤表,**沒有人把「未收齊」硬寫進來**', () => {
    expect(DETAIL).toContain('PAYMENT_STATUS_LABEL[detail.paymentStatus]');
    expect({ 硬寫未收齊: DETAIL.includes('未收齊') }).toEqual({ 硬寫未收齊: false });
  });

  // ⚠️ **nit(W6-019 ②)**:`flex-1` 是裸字面 —— 今天全檔只有 1 處(實量),所以不是恆綠;
  //    但日後檔內多一個 `flex-1`,**就算 spacer 被刪掉這一格也會綠**。
  //    ⇒ 改成連著它前後的結構一起比,讓它綁在【標頭那一列裡】而不是「這個檔裡有這個字」。
  it('🔴 彈性空白那一格在**標頭列裡**(設計稿 `:1115` `<span class="sp">`)', () => {
    const i = DETAIL.indexOf("flex h-[38px] flex-nowrap");
    expect(i).toBeGreaterThan(-1);
    const row = DETAIL.slice(i, DETAIL.indexOf('</div>', i));
    expect(row).toContain("className='flex-1'");
  });

  // 🔴🔴 **W6-019 M1**:標頭列裡該固定寬的東西都要 `shrink-0` ——
  //    沒有它的會被**安靜壓扁而不是溢出**;而 spacer 到 0 之後飽和 ⇒ 我那把尺失去判別力。
  //    **壓扁不像壞掉、像設計** ⇒ 連「拿去真瀏覽器給人看」那道驗證都騙得過去。
  //
  // ⚠️⚠️ **本格的射程,寫準(`W6-020` nit;而它正是產生 M1 的【同一個母題】)**:
  //    下面那條 regex **只蓋 `h1` 與 `Link`** ⇒ **抓不到 `<OrderHeadChip/>`(M1 的一半就是它)**,
  //    也抓不到日後任何新加的元件或 `span`。
  //    🔴 **我上一版的註解寫「這一列【每一顆】都要 shrink-0」—— 那句【比它實際跑的寬】。**
  //    ⇒ 具體後果:把 `OrderHeadChip` 根元素的 `shrink-0` 拿掉,**這一格照樣綠**。
  //    ⇒ 所以下面補了第二格,專門釘那個元件。**兩格加起來仍不是「每一顆」,不要再那樣寫。**
  it('🔴 標頭列裡的 `h1` 與每一顆 `Link` 都帶 `shrink`(否則會被安靜壓扁,而不是看得見地溢出)', () => {
    const i = DETAIL.indexOf('flex h-[38px] flex-nowrap');
    const row = DETAIL.slice(i, DETAIL.indexOf('</div>', i));
    const 缺 = [...row.matchAll(/<(h1|Link)\b[^>]*/g)]
      .map((m) => m[0])
      .filter((t) => !t.includes('shrink'));
    expect({ 缺shrink的數量: 缺.length }).toEqual({ 缺shrink的數量: 0 });
  });

  // 🔴 M1 的另一半:`OrderHeadChip` 不是 `h1` 也不是 `Link` ⇒ 上一格看不到它。
  //    它的 `shrink-0` 掛在**元件自己的根元素**上(正確的位置),所以這裡讀它的函式體。
  it('🔴 `OrderHeadChip` 自己的根元素帶 `shrink-0`(它是 M1 的另一半,上一格抓不到它)', () => {
    const i = DETAIL.indexOf('function OrderHeadChip');
    expect(i).toBeGreaterThan(-1);
    const body = DETAIL.slice(i, DETAIL.indexOf('\n}', i));
    expect({ chip帶shrink: body.includes('shrink-0') }).toEqual({ chip帶shrink: true });
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

  it('🔴 單列那幾格【真的畫出來】+ 正向對照(沒有對照的話「都在」可能是恆真)', () => {
    const { container } = render(
      // 🔴 `customerHref` 必須傳 —— 它預設 `null` = **不渲染入口**(fail-closed),
      //    不傳的話下面那條「客人入口有畫出來」會**因為入口根本不該出現而紅**,
      //    而那個紅講的是我漏傳,不是產品壞了。
      <OrderDetail
        detail={HEAD_DETAIL}
        returnTo='/orders'
        payments={{ status: 'ok', rows: [] }}
        customerHref='/customers/abc'
      />,
    );
    // 正向對照:證明元件真的渲染了(否則下面幾條在「什麼都沒畫」時也會失敗得莫名其妙)。
    expect(container.textContent).toContain('ABC123');
    expect(container.textContent).toContain('沈佑霖');        // 客人入口
    expect(container.textContent).toContain('NT$ 23,800');    // 金額(設計稿 :1113)
  });

  it('🔴 chip 畫出來的是【既有標籤表的字】,不是設計稿那個「未收齊」', () => {
    const { container } = render(
      <OrderDetail detail={HEAD_DETAIL} returnTo='/orders' payments={{ status: 'ok', rows: [] }} />,
    );
    // `partiallyPaid` 的字面 Sean 2026-08-18 `Q3` 拍為「已收訂金」。
    expect(container.textContent).toContain('已收訂金');
    expect(container.textContent).not.toContain('未收齊');
  });

  it('🔴 標頭**不再**畫發票狀態(拿掉那一格之後,`未開立` 不該再出現在標頭)', () => {
    const { container } = render(
      <OrderDetail detail={HEAD_DETAIL} returnTo='/orders' payments={{ status: 'ok', rows: [] }} />,
    );
    // ⚠️ 射程:子元件全被 mock 成 null ⇒ 這一格量的確實只有標頭那一列,
    //    不會因為下方發票卡也印「未開立」而假綠。
    expect(container.textContent).not.toContain('未開立');
  });
});
