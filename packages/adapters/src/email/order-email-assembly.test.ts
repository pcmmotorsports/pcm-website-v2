import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import {
  buildOrderCreatedPayload,
  orderCreatedSubject,
  bankOrderCreatedSubject,
  bankOrderAmountChangedSubject,
  bankOrderAmountChangedDedupKey,
  buildBankOrderAmountChangedPayload,
  BANK_ORDER_AMOUNT_CHANGED_EVENT_VERSION,
  ORDER_CREATED_EVENT_VERSION,
  ORDER_CREATED_SNAPSHOT_EVENT_VERSION,
  PAID_SNAPSHOT_TITLE_MAX_CHARS,
} from './order-email-assembly';
import type { PaidEmailContext } from '@pcm/ports';

describe('buildOrderCreatedPayload(REQUIRED-E1b 組裝層)', () => {
  it('payload = 顯式三欄 allowlist(event_version/display_id/paid_at),恰好、不多不少', () => {
    const payload = buildOrderCreatedPayload({
      displayId: 'PCM-2026-0001',
      paidAt: '2026-07-17T02:00:00Z',
    });
    expect(payload).toEqual({
      event_version: ORDER_CREATED_EVENT_VERSION,
      display_id: 'PCM-2026-0001',
      paid_at: '2026-07-17T02:00:00Z',
    });
    expect(Object.keys(payload).sort()).toEqual(['display_id', 'event_version', 'paid_at']);
  });

  it('🔴 負向:來源偷渡 PII(email/phone/address/巢狀物件)→ 物理上到不了 payload', () => {
    const dirty = {
      displayId: 'PCM-2026-0001',
      paidAt: '2026-07-17T02:00:00Z',
      email: 'leak@example.com',
      customerPhone: '0912345678',
      shipping: { address: '台北市中山區', phone: '0987654321' },
    } as unknown as { displayId: string; paidAt: string };
    const payload = buildOrderCreatedPayload(dirty);
    const json = JSON.stringify(payload);
    expect(json).not.toContain('leak@example.com');
    expect(json).not.toContain('0912345678');
    expect(json).not.toContain('台北市');
    expect(json).not.toContain('0987654321');
    expect(Object.keys(payload)).toHaveLength(3);
  });

  it('🔴 runtime 型別檢查:非字串/空字串 → throw,且錯誤訊息不含值(值可能是 PII)', () => {
    expect(() =>
      buildOrderCreatedPayload({ displayId: '', paidAt: '2026-07-17T02:00:00Z' }),
    ).toThrow('displayId');
    expect(() =>
      buildOrderCreatedPayload({
        displayId: { phone: '0912345678' } as unknown as string,
        paidAt: '2026-07-17T02:00:00Z',
      }),
    ).toThrow('displayId');
    try {
      buildOrderCreatedPayload({
        displayId: { secret: '0912345678' } as unknown as string,
        paidAt: '2026-07-17T02:00:00Z',
      });
      expect.unreachable('非字串 displayId 應 throw');
    } catch (e) {
      expect((e as Error).message).not.toContain('0912345678');
    }
  });
  it('🔵 沒有快照 ⇒ 仍是 v1 三欄(今天的行為)', () => {
    expect(buildOrderCreatedPayload({ displayId: 'X', paidAt: 'Y' }).event_version).toBe(ORDER_CREATED_EVENT_VERSION);
  });
});

describe('orderCreatedSubject(固定模板)', () => {
  it('唯一動態欄 = display_id;L2 佔位字面、E3 定案給 Sean 過目', () => {
    const subject = orderCreatedSubject('PCM-2026-0001');
    expect(subject).toContain('PCM-2026-0001');
    expect(subject).toBe('PCM 訂單 PCM-2026-0001 付款成功通知');
  });
});

// ══════════════════════════════════════════════════════════════════
// ⟦b4-BANKNOEMAIL⟧ 主旨的鎖 —— **它住在產生它的那一側**(codex R1-#10)
// ══════════════════════════════════════════════════════════════════
// 🔴 為什麼在這裡而不是 sweep 那支測試:sweep 送的是 `job.subject`
//    (enqueue 當下就寫進 outbox 的那一份)⇒ 在那裡鎖它, **鎖到的是 fixture 不是碼**。
// 🛑 **改這格期望值 = 重設一道對外文案的鎖 ⇒ 需要授權**(同內文那一格)。
describe('bankOrderCreatedSubject:對外主旨的鎖', () => {
  it('🔴 主旨逐字 = Sean 核可的那一份(spec 檔對照, 不是手打副本)', () => {
    const spec = readFileSync(
      join(__dirname, '..', '..', '..', '..', 'docs', 'specs', '2026-09-06-bank-order-created-email-copy.md'),
      'utf8',
    );
    const block = spec.split('## 主旨')[1];
    expect(block, 'spec 檔裡找不到「## 主旨」那一節 ⇒ 這道鎖沒接上').toBeDefined();
    const expected = block!.split('```')[1]!.replace(/^\n/, '').replace(/\n$/, '')
      .replaceAll('(訂單編號)', 'PCM-2026-0142');
    // 🔵 自檢:佔位詞要換掉 —— 否則下面那個 toBe 會因為【錯的理由】紅。
    expect(expected).not.toContain('(訂單編號)');
    expect(bankOrderCreatedSubject('PCM-2026-0142')).toBe(expected);
  });
});

// ── 2026-09-13 部分取消補寄信(`bank_order_amount_changed`)────────────────────────
describe('bankOrderAmountChangedDedupKey:與 SQL 那一份的字面鎖', () => {
  /**
   * 🔴🔴 **這一道是本片最承重的測試。**
   *
   * 鍵有**兩份實作**:本支(落表時算)與 SQL 的
   * `public.pcm_bank_amount_changed_email_dedup_key(uuid, uuid)`
   * (`supabase/migrations/20260913010000_...sql`,掃描面 view 的 anti-join 呼它)。
   * 🛑 **兩份漂掉不會報錯、三綠不會紅**,症狀是二選一:
   *   · 落表的鍵與 view 算的不同 ⇒ anti-join 永遠對不上 ⇒ 同一次取消每輪重排、撞唯一鍵
   *   · 或該補寄的那一次取消永遠撈不出來
   * ✅ 兩邊各有一道**用同一組固定 uuid 比同一串輸出**的釘樁 ——
   *   SQL 那半是 apply 期的 DO block(那支 migration 裡),本支是 TS 那半。
   *   📌 形狀照出貨那族的先例(`pcm_shipped_email_dedup_key` + `20260822010000:198-213`)。
   */
  it('🔴 鍵的字面 = {cancellationId}:{orderId} —— 改分隔符 / 倒序 / 少冒號都要紅', () => {
    // 🔵 **刻意用與 SQL 釘樁【同一組】uuid**(那一支用 …c1 / …d2)⇒ 兩邊比的是同一串字。
    const key = bankOrderAmountChangedDedupKey({
      cancellationId: '00000000-0000-0000-0000-0000000000c1',
      orderId: '00000000-0000-0000-0000-0000000000d2',
    });
    expect(key).toBe(
      '00000000-0000-0000-0000-0000000000c1:00000000-0000-0000-0000-0000000000d2',
    );
  });

  it('🔴 同一張單的兩次取消 ⇒ 兩把不同的鍵(Sean 2026-09-13 A1 甲:要收兩封)', () => {
    // 🛑 這一格守的是**拍板本身**:綁回 orderId 會讓兩次取消撞同一把鍵
    //    ⇒ 第二封永遠插不進去 ⇒ 客人照第一封那個過期金額匯錢。
    const order = '00000000-0000-0000-0000-0000000000d2';
    const first = bankOrderAmountChangedDedupKey({ cancellationId: 'c-1', orderId: order });
    const second = bankOrderAmountChangedDedupKey({ cancellationId: 'c-2', orderId: order });
    expect(first).not.toBe(second);
  });

  it('🔵 負對照:同一次取消算兩次 ⇒ 同一把鍵(否則去重整個失效)', () => {
    const src = { cancellationId: 'c-1', orderId: 'o-1' };
    expect(bankOrderAmountChangedDedupKey(src)).toBe(bankOrderAmountChangedDedupKey(src));
  });

  it('🔴 鍵【不含】金額 —— plan §3-bis-4 明文禁止(會隨算式改變而漂)', () => {
    // 🔵 尺是活的:它比的是「金額變了而鍵沒變」,而鍵的輸入裡根本沒有金額欄位
    //    ⇒ 這一格守的是**將來有人把金額加進去**那個改動。
    const key = bankOrderAmountChangedDedupKey({ cancellationId: 'c-1', orderId: 'o-1' });
    expect(key).not.toContain('900');
    expect(key.split(':')).toHaveLength(2);
  });
});

describe('buildBankOrderAmountChangedPayload:落表邊界的三道閘', () => {
  const ok = {
    displayId: 'PCM-2026-0142',
    createdAt: '2026-09-01T00:00:00Z',
    cancellationId: '00000000-0000-0000-0000-0000000000c1',
    total: 900,
    balanceDue: 900,
  };

  it('🟢 正常路:五欄原樣落表 + event_version', () => {
    expect(buildBankOrderAmountChangedPayload(ok)).toEqual({
      display_id: 'PCM-2026-0142',
      created_at: '2026-09-01T00:00:00Z',
      cancellation_id: '00000000-0000-0000-0000-0000000000c1',
      total: 900,
      balance_due: 900,
      event_version: BANK_ORDER_AMOUNT_CHANGED_EVENT_VERSION,
    });
  });

  it('🔴 空的 cancellationId ⇒ throw(而這一格是本族最要緊的)', () => {
    // 🛑 少了它,鍵會變成 `:{orderId}` ⇒ **同一張單的每一次取消撞同一把鍵**
    //    ⇒ 那正是 Sean A1 甲禁止的「只寄第一次」,而它會**安靜地**發生。
    expect(() => buildBankOrderAmountChangedPayload({ ...ok, cancellationId: '   ' })).toThrow(
      /cancellationId/,
    );
  });

  it('🔴 空的 displayId ⇒ throw(否則主旨中間兩個空格見客)', () => {
    expect(() => buildBankOrderAmountChangedPayload({ ...ok, displayId: '' })).toThrow(
      /displayId/,
    );
  });

  it('🔴 空的 createdAt ⇒ throw(否則期限句算不出來)', () => {
    expect(() => buildBankOrderAmountChangedPayload({ ...ok, createdAt: '' })).toThrow(
      /createdAt/,
    );
  });

  it('🔵 錯誤訊息零 PII:只有事件名與欄位名,不含那個值', () => {
    // 🔴 值可能是誤傳的 PII(例:有人把 email 或電話傳進 displayId)⇒ 它不可以進錯誤訊息。
    // 🔬 ⛔ **我第一版這一格是假的**:我傳空字串進去 ⇒ 根本沒有值可以洩
    //    ⇒ 📌 那個 `toThrow` 在「訊息含值」與「訊息不含值」兩個世界都會綠。
    // ✅ 改成傳一個**非字串**的 PII 形狀值:`requireNonEmptyString` 對非字串也 throw,
    //    而這樣才有一個真的值可以被洩出來 ⇒ 這一格才量得到東西。
    // ⛔ **這一格我寫錯過【兩次】, 兩次都留痕**:
    //   第一版傳空字串 ⇒ 根本沒有值可以洩 ⇒ 那個 toThrow 在兩個世界都綠。
    //   第二版補了一段「拿合法字串呼叫、斷言 message 仍是空的」的自檢 ——
    //   🔴 **而那段是死碼**(Fable 2026-09-13 F2):它驗的是「合法輸入不 throw」,
    //      與「訊息會不會洩值」無關, 而它讓這一格看起來比實際上守得多。
    // ✅ 第三版只留真正量得到的那一半。
    const pii = 'leak@example.com';
    // 🔴 餵一個**非字串**的值:`requireNonEmptyString` 對非字串也 throw,
    //    而這樣才有一個真的值可以被洩出來 ⇒ 這一格才量得到東西。
    let message = '';
    try {
      buildBankOrderAmountChangedPayload({ ...ok, displayId: 12345 as unknown as string });
    } catch (e) {
      message = e instanceof Error ? e.message : String(e);
    }
    // 🔵 自檢:它**真的 throw 了**(否則下面兩個 not.toContain 會因為 message 是空字串而假綠)。
    expect(message).not.toBe('');
    // 🔴 整句錨定 ⇒ 任何人把 `${value}` 插進訊息都會紅。
    expect(message).toBe('bank_order_amount_changed 組裝失敗:displayId 必須是非空字串');
    expect(message).not.toContain('12345');
    expect(message).not.toContain(pii);
  });
});

describe('bankOrderAmountChangedSubject:對外主旨', () => {
  /**
   * 🛑🛑 **這一道【不是】spec 檔對照那種等級的鎖, 而差別要講清楚。**
   *
   * 隔壁 `bankOrderCreatedSubject` 那一道是**讀 `docs/specs/...` 那支檔、整串比對** ——
   * 📌 那不是「測我寫對了」, 是把【Sean 核可的字】與【寄出去的字】綁在一起。
   *
   * 🔴 **而本型別今天綁不到那種鎖**:文案真來源是 Sean 2026-09-13 親手給的那一份,
   * 而它住在 **repo 外**(`~/pcm-mailbox/0913-Sean文案-部分取消補寄信.md`)
   * ⇒ 測試讀不到(那是每台機器各自的檔)。
   * 而且他還有一格沒答:**標點半形還是全形** ⇒ 這個字面**可能還會變**。
   *
   * ⇒ ✅ 所以本道只是一道**「不要不小心改到」的字面鎖**,它證的是
   *   「這一行與我 commit 當下寫的相同」,**不證**「這一行是 Sean 核可的」。
   * 🔴 **文案核可、抄進 `docs/specs/` 之後,這一道要換成 spec 檔對照那種形狀。**
   *   在那之前,寄信那一步由 `sweep-email-outbox.ts` 的 fail-closed throw 擋著。
   */
  it('🔵 字面鎖(非 spec 對照 —— 理由見上面):A 版主旨 + 全形逗號', () => {
    expect(bankOrderAmountChangedSubject('PCM-2026-0142')).toBe(
      '訂單 PCM-2026-0142 部分商品已取消，應付金額更新通知',
    );
  });

  it('🔴 逗號是【全形】—— 而那是因為那是 Sean 親手打的那個字元, 不是我選的', () => {
    // ⚠️ 既有四封信的正文與三行金額用**半形**、只有 LINE 那一行全形
    //    (`docs/specs/2026-09-06-bank-order-created-email-copy.md` 那張表逐字)。
    //    ⇒ 📌 **他若挑半形, 這一格與上面那一格都要改** —— 而那正是本測試存在的用途:
    //      讓「改了對外字面」變成一個**必須有人按下同意**的動作, 而不是一次安靜的編輯。
    expect(bankOrderAmountChangedSubject('X')).toContain('，');
    expect(bankOrderAmountChangedSubject('X')).not.toContain(',');
  });
});

// ── 2026-09-11 凍-C:v2 = 金額凍結快照(plan-paid-amount-frozen;Sean 拍「甲、甲」)────────
describe('buildOrderCreatedPayload v2(金額凍結快照)', () => {
  const m = (n: number) => n as PaidEmailContext['total'];
  const snap = (over: Partial<PaidEmailContext> = {}): PaidEmailContext => ({
    orderDisplayId: 'IGNORED-ID',
    lines: [{ title: '排氣管', variantSku: 'SKU-1', quantity: 2, lineTotal: m(940) }],
    linesTruncated: false,
    subtotal: m(940),
    shippingFee: m(160),
    discountTotal: m(50),
    taxTotal: m(47),
    total: m(1097),
    ...over,
  });
  const base = { displayId: 'PCM-2026-0001', paidAt: '2026-09-11T02:00:00Z' };

  it('🟢 有快照 ⇒ v2,逐欄恰好這些(orderDisplayId / linesTruncated 不落表)', () => {
    expect(buildOrderCreatedPayload({ ...base, paidSnapshot: snap() })).toEqual({
      event_version: ORDER_CREATED_SNAPSHOT_EVENT_VERSION,
      display_id: 'PCM-2026-0001',
      paid_at: '2026-09-11T02:00:00Z',
      subtotal: 940,
      shipping_fee: 160,
      discount_total: 50,
      tax_total: 47,
      total: 1097,
      lines: [{ variant_sku: 'SKU-1', quantity: 2, line_total: 940, title: '排氣管' }],
    });
  });

  it('🔴 快照物件夾帶多餘欄位(含 PII)⇒ 到不了 payload', () => {
    const dirty = {
      ...snap(),
      email: 'leak@example.com',
      lines: [{ ...snap().lines[0], unitPrice: 470, phone: '0912345678' }],
    } as unknown as PaidEmailContext;
    const json = JSON.stringify(buildOrderCreatedPayload({ ...base, paidSnapshot: dirty }));
    expect(json).not.toContain('leak@example.com');
    expect(json).not.toContain('0912345678');
    expect(json).not.toContain('unitPrice');
    expect(json).not.toContain('IGNORED-ID');
  });

  it('🔴 自由文字例外 #2:品名只存前 120 字,而且不切半個字', () => {
    const long = '字'.repeat(119) + '😀' + '尾'.repeat(10);
    const p = buildOrderCreatedPayload({
      ...base,
      paidSnapshot: snap({ lines: [{ title: long, variantSku: null, quantity: 1, lineTotal: m(940) }] }),
    });
    const title = p.event_version === 2 ? p.lines[0]!.title : null;
    expect(Array.from(title ?? '')).toHaveLength(PAID_SNAPSHOT_TITLE_MAX_CHARS);
    expect(title?.endsWith('😀')).toBe(true);
  });

  it.each([
    ['截斷', { linesTruncated: true }],
    ['0 項', { lines: [] }],
    ['金額不是安全整數', { total: m(2 ** 60) }],
    ['小數', { shippingFee: 1.5 as PaidEmailContext['total'] }],
  ])('🔴 %s ⇒ throw(半份快照比沒有快照糟)', (_l, over) => {
    expect(() => buildOrderCreatedPayload({ ...base, paidSnapshot: snap(over as Partial<PaidEmailContext>) })).toThrow(
      'order_created 組裝失敗',
    );
  });
});
