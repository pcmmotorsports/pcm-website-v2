// node env;mock 'server-only'(adapter 檔頭 import 'server-only')。
import { describe, it, expect, vi } from 'vitest';

vi.mock('server-only', () => ({}));

import {
  SupabaseEmailOutboxAdapter,
  type EmailOutboxClient,
  type EmailOutboxQueryBuilder,
} from './SupabaseEmailOutboxAdapter';
import { orderCreatedSubject } from './order-email-assembly';
import type { EnqueueEmailInput, EmailSendErrorCode } from '@pcm/ports';

/** 測試用假域(真值由 composition 從 line.ts 注入;測試不複製正式字面 = 單一來源紀律)。 */
const FAKE_DOMAIN = 'line.example.local';

type Resp = { data: unknown; error: { code?: string; message: string } | null };

/** 鏈式 thenable builder mock:任意鏈方法回自身、await 回注入結果;紀錄呼叫供斷言。 */
function makeBuilder(result: Resp) {
  const calls: Array<[string, unknown[]]> = [];
  const b: Record<string, unknown> = { calls };
  // 🔵 ⟦b4-SHIPGATE1⟧ 2026-09-01 加 `not` —— 而【在加它之前既有測試全綠】,
  //    因為既有路徑一次都沒呼叫它(未給 excludeEventTypes ⇒ 那一句不執行)。
  //    📌 ⇒ 那本身就是「未給 ⇒ 查詢逐位元不變」的一個側面證據。
  for (const m of ['insert', 'select', 'update', 'eq', 'neq', 'in', 'not', 'lt', 'lte', 'order', 'limit']) {
    b[m] = vi.fn((...args: unknown[]) => {
      calls.push([m, args]);
      return b;
    });
  }
  b.then = (resolve: (v: Resp) => unknown) => Promise.resolve(result).then(resolve);
  return b as unknown as EmailOutboxQueryBuilder & { calls: Array<[string, unknown[]]> };
}

function makeClient(...builders: EmailOutboxQueryBuilder[]): EmailOutboxClient {
  const from = vi.fn();
  for (const b of builders) {
    from.mockReturnValueOnce(b);
  }
  return { from } as unknown as EmailOutboxClient;
}

function argsOf(b: { calls: Array<[string, unknown[]]> }, method: string): unknown[][] {
  return b.calls.filter(([m]) => m === method).map(([, args]) => args);
}

const BASE_INPUT: EnqueueEmailInput = {
  eventType: 'order_created',
  orderId: 'ord-uuid-1',
  displayId: 'PCM-2026-0001',
  paidAt: '2026-07-17T02:00:00Z',
  recipientEmail: 'customer@example.com',
  requestId: 'req-1',
};

const JOB_ROW = {
  id: 'outbox-1',
  event_type: 'order_created',
  order_id: 'ord-uuid-1',
  dedup_key: 'ord-uuid-1',
  recipient_email: 'customer@example.com',
  subject: 'PCM 訂單 PCM-2026-0001 付款成功通知',
  payload: { event_version: 1 },
  attempts: 0,
  max_attempts: 5,
  request_id: 'req-1',
};

// 🔴 `#858` 片0-a:gate 判準**已經不住在這個 package 裡了** —— 它由 composition 注入
//    (`@pcm/schemas` 的 `isSyntheticEmailDomain`,那是三處共用的唯一一份規則)。
//    ⇒ 原本這裡那個 `describe('isSyntheticEmail(假信箱 gate 判準)')` **整段刪除**:
//      它測的是本 package 自己實作的第二份規則,而那份規則正是分岔的來源。
//      **規則本身的測試搬到規則住的地方**(`packages/schemas`),這裡只測「有沒有真的去問它」。
const fakeGate = (email: string) => email.trim().toLowerCase().endsWith(`@${FAKE_DOMAIN}`);

function adapter(client: EmailOutboxClient) {
  return new SupabaseEmailOutboxAdapter(client, { isSyntheticEmail: fakeGate });
}

describe('假信箱 gate 的【接線】(判準本身在 @pcm/schemas,不在這裡)', () => {
  it('🔴 注入的判斷式**真的會被呼叫**,而且拿到的是原始 recipient_email', async () => {
    const seen: string[] = [];
    const b = makeBuilder({ data: [{ id: 'outbox-1' }], error: null });
    await new SupabaseEmailOutboxAdapter(makeClient(b), {
      isSyntheticEmail: (email) => {
        seen.push(email);
        return false;
      },
    }).enqueue(BASE_INPUT);
    expect(seen).toEqual([BASE_INPUT.recipientEmail]);
  });

  // ── 🔴 codex R1 MF2:注入錯的東西會怎樣?**三種都要有答案,不能用「不會發生」帶過。** ──
  it('🔴 沒傳 config ⇒ fail-closed:在 insert 之前就炸,不會靜默放行', async () => {
    const b = makeBuilder({ data: [{ id: 'outbox-1' }], error: null });
    const client = makeClient(b);
    await expect(
      // @ts-expect-error 故意不給 config —— 型別層擋得住,這一格量的是【執行期】。
      new SupabaseEmailOutboxAdapter(client, undefined).enqueue(BASE_INPUT),
    ).rejects.toThrow(TypeError);
  });

  it('🔴 傳 undefined 當判斷式 ⇒ fail-closed:同樣在 insert 之前炸', async () => {
    const b = makeBuilder({ data: [{ id: 'outbox-1' }], error: null });
    await expect(
      // @ts-expect-error 故意傳 undefined
      new SupabaseEmailOutboxAdapter(makeClient(b), { isSyntheticEmail: undefined }).enqueue(BASE_INPUT),
    ).rejects.toThrow(TypeError);
  });

  it('🔴🔴 傳「永遠說不是」的判斷式 ⇒ **fail-open,假信箱照樣落 pending**(誠實記錄,不是通過)', async () => {
    // 這一格**不是**在證明系統安全,它是在把「型別層擋不住的那個洞」寫下來。
    // 唯一擋得住它的是 composition.test.ts 那個 `toBe` 身分斷言(注入必須是 schemas 那一份本人)。
    const b = makeBuilder({ data: [{ id: 'outbox-1' }], error: null });
    const r = await new SupabaseEmailOutboxAdapter(makeClient(b), {
      isSyntheticEmail: () => false,
    }).enqueue({ ...BASE_INPUT, recipientEmail: 'line_u1@line.pcmmotorsports.local' });
    expect(r).toEqual({ kind: 'enqueued', id: 'outbox-1' }); // 🔴 不是 skipped —— 它會被寄出去
  });

  it('🔴 判斷式說「是假信箱」⇒ 走 skipped;說「不是」⇒ 走 pending(接線方向沒有反過來)', async () => {
    const b1 = makeBuilder({ data: [{ id: 'outbox-1' }], error: null });
    const skipped = await new SupabaseEmailOutboxAdapter(makeClient(b1), {
      isSyntheticEmail: () => true,
    }).enqueue(BASE_INPUT);
    expect(skipped).toEqual({ kind: 'skipped_no_real_email', id: 'outbox-1' });

    const b2 = makeBuilder({ data: [{ id: 'outbox-2' }], error: null });
    const queued = await new SupabaseEmailOutboxAdapter(makeClient(b2), {
      isSyntheticEmail: () => false,
    }).enqueue(BASE_INPUT);
    expect(queued).toEqual({ kind: 'enqueued', id: 'outbox-2' });
  });
});

describe('SupabaseEmailOutboxAdapter.enqueue(落表邊界內部重組)', () => {
  it('真實信箱 → 顯式逐欄 insert、status=pending、subject/payload/dedup_key 皆內部重組', async () => {
    const b = makeBuilder({ data: [{ id: 'outbox-1' }], error: null });
    const result = await adapter(makeClient(b)).enqueue(BASE_INPUT);
    expect(result).toEqual({ kind: 'enqueued', id: 'outbox-1' });
    const row = argsOf(b, 'insert')[0]![0] as Record<string, unknown>;
    expect(row.status).toBe('pending');
    expect(row.event_type).toBe('order_created');
    // 🔴 三個危險欄呼叫端無法指定:dedup_key=orderId、subject=固定模板、payload=allowlist 三欄。
    expect(row.dedup_key).toBe('ord-uuid-1');
    expect(row.subject).toBe(orderCreatedSubject('PCM-2026-0001'));
    expect(row.payload).toEqual({
      event_version: 1,
      display_id: 'PCM-2026-0001',
      paid_at: '2026-07-17T02:00:00Z',
    });
    // 🔴 REQUIRED-E1b:落表欄位 = 固定 8 欄 allowlist。
    expect(Object.keys(row).sort()).toEqual([
      'dedup_key',
      'event_type',
      'order_id',
      'payload',
      'recipient_email',
      'request_id',
      'status',
      'subject',
    ]);
  });

  it('🔴 直接呼叫 adapter 偷渡 PII(多餘欄位/假 subject/假 payload)→ 不落表(codex R1 迴歸)', async () => {
    const b = makeBuilder({ data: [{ id: 'outbox-1' }], error: null });
    const dirty = {
      ...BASE_INPUT,
      customerPhone: '0912345678',
      subject: '偷渡的 subject 含電話 0987654321',
      payload: { email: 'leak@example.com' },
    } as unknown as EnqueueEmailInput;
    await adapter(makeClient(b)).enqueue(dirty);
    const row = argsOf(b, 'insert')[0]![0] as Record<string, unknown>;
    const json = JSON.stringify(row);
    expect(json).not.toContain('0912345678');
    expect(json).not.toContain('0987654321');
    expect(json).not.toContain('leak@example.com');
    expect(row.subject).toBe(orderCreatedSubject('PCM-2026-0001'));
    expect(row.payload).toEqual({
      event_version: 1,
      display_id: 'PCM-2026-0001',
      paid_at: '2026-07-17T02:00:00Z',
    });
  });

  it('🔴 合成假信箱 → status=skipped_no_real_email、回 skipped(不進 due、E3 據此不呼 Resend)', async () => {
    const b = makeBuilder({ data: [{ id: 'outbox-2' }], error: null });
    const result = await adapter(makeClient(b)).enqueue({
      ...BASE_INPUT,
      recipientEmail: 'line_Uabc@LINE.example.local',
    });
    expect(result).toEqual({ kind: 'skipped_no_real_email', id: 'outbox-2' });
    const row = argsOf(b, 'insert')[0]![0] as Record<string, unknown>;
    expect(row.status).toBe('skipped_no_real_email');
    // gate 只做判斷、不改寫落表原值。
    expect(row.recipient_email).toBe('line_Uabc@LINE.example.local');
  });

  it('23505 + 查核同事件同訂單 → duplicate 冪等、不 throw(codex R1:不盲回)', async () => {
    const insertB = makeBuilder({ data: null, error: { code: '23505', message: 'dup' } });
    const verifyB = makeBuilder({ data: [{ id: 'outbox-1', order_id: 'ord-uuid-1' }], error: null });
    await expect(adapter(makeClient(insertB, verifyB)).enqueue(BASE_INPUT)).resolves.toEqual({
      kind: 'duplicate',
    });
    expect(argsOf(verifyB, 'eq')).toEqual([
      ['event_type', 'order_created'],
      ['dedup_key', 'ord-uuid-1'],
    ]);
  });

  it('🔴 23505 但查無同事件列(=PK/其他約束撞鍵)→ throw、不得吞成 duplicate', async () => {
    const insertB = makeBuilder({ data: null, error: { code: '23505', message: 'dup' } });
    const verifyB = makeBuilder({ data: [], error: null });
    await expect(adapter(makeClient(insertB, verifyB)).enqueue(BASE_INPUT)).rejects.toThrow(
      '查無同事件列',
    );
  });

  it('🔴 23505 且 dedup_key 撞到別張訂單 → throw(跨訂單碰撞=漏信前兆、拒回 duplicate)', async () => {
    const insertB = makeBuilder({ data: null, error: { code: '23505', message: 'dup' } });
    const verifyB = makeBuilder({
      data: [{ id: 'outbox-9', order_id: 'ord-uuid-OTHER' }],
      error: null,
    });
    await expect(adapter(makeClient(insertB, verifyB)).enqueue(BASE_INPUT)).rejects.toThrow(
      '跨訂單碰撞',
    );
  });

  it('其他 DB 錯誤 → throw,且錯誤訊息不含收件者(PII 不進錯誤)', async () => {
    const b = makeBuilder({ data: null, error: { code: '42501', message: 'denied' } });
    await expect(adapter(makeClient(b)).enqueue(BASE_INPUT)).rejects.toThrow('42501');
    try {
      await adapter(
        makeClient(makeBuilder({ data: null, error: { code: '42501', message: 'x' } })),
      ).enqueue(BASE_INPUT);
    } catch (e) {
      expect((e as Error).message).not.toContain('customer@example.com');
    }
  });
});

const SHIPPED_INPUT: EnqueueEmailInput = {
  eventType: 'order_shipped',
  orderId: 'ord-uuid-1',
  displayId: 'PCM-2026-0001',
  // 🔴 **必須是真的 uuid 形狀**:2026-08-22 起 `buildOrderShippedPayload` 對這一欄多驗一道形狀
  //    (它是寄送時去主表撈脈絡的唯一鍵;傳成箱【號】BCDF23 的症狀不是報錯,
  //     是撈不到 ⇒ 那封信永遠寄不出去而且每輪都吵)。~~原本寫 'shp-uuid-9'~~ ⇒ 會被擋下。
  shipmentId: '00000000-0000-0000-0000-0000000000d1',
  shipmentReference: 'BCDF23',
  shippedAt: '2026-08-22T02:00:00Z',
  recipientEmail: 'customer@example.com',
  requestId: null,
};

describe('SupabaseEmailOutboxAdapter.enqueue(order_shipped;M-4b E4-a)', () => {
  it('🔴 dedup_key = `{shipment_id}:{order_id}`(TS 側的字面;SQL 側由 contract test 對帳)', async () => {
    // 為什麼是「唯一」:唯一鍵是 (event_type, dedup_key) 且**不含 order_id**
    // (`20260717020000:377`),`:350` 要求同 event_type 內全域唯一。
    // 只用 order_id ⇒ **同一張單的第二箱被當成 duplicate 吞掉 = 漏一封信,而且不報錯**。
    // ⚠️ 2026-08-22 唯讀量測:正式庫「裝超過一張單的箱」= 0
    //    ⇒ 真實流量走不到這條路 ⇒ 它壞掉時沒有人會發現。**這一格就是那個會叫的東西。**
    // ⚠️ **SQL 側有第二份實作**:`public.pcm_shipped_email_dedup_key(uuid, uuid)`
    //    (`supabase/migrations/20260822010000_m4b_e4a_shipped_email_scan_view.sql` §4)。
    //    兩份漂掉的症狀是**同一封信重複排入、重複寄出**。改任一邊之前先看另一邊。
    const b = makeBuilder({ data: [{ id: 'outbox-9' }], error: null });
    await adapter(makeClient(b)).enqueue(SHIPPED_INPUT);
    const row = argsOf(b, 'insert')[0]![0] as Record<string, unknown>;

    // 🔴 精確等值就夠了 —— codex R2 nit:後面再加一句 `not.toBe(orderId)` **沒有額外判別力**
    //    (等值成立時它必然成立)。想擋「退化成 order_id」那個形狀,靠的是這一行本身。
    expect(row.dedup_key).toBe('00000000-0000-0000-0000-0000000000d1:ord-uuid-1');
    expect(row.event_type).toBe('order_shipped');
    expect(row.order_id).toBe('ord-uuid-1');
  });

  it('🔴 同一箱、兩張訂單 ⇒ 兩把【不同】的 dedup_key(這才是「一箱兩單寄兩封」的落點)', async () => {
    // ⚠️ use-case 那邊的「一箱兩單」測試碰不到這裡(它只呼叫 mocked outbox,codex R1)。
    //    **這一格才是 TS 側真的算出鍵的地方。**
    const bA = makeBuilder({ data: [{ id: 'outbox-A' }], error: null });
    const bB = makeBuilder({ data: [{ id: 'outbox-B' }], error: null });
    await adapter(makeClient(bA)).enqueue({ ...SHIPPED_INPUT, orderId: 'ord-A' });
    await adapter(makeClient(bB)).enqueue({ ...SHIPPED_INPUT, orderId: 'ord-B' });

    const keyA = (argsOf(bA, 'insert')[0]![0] as Record<string, unknown>).dedup_key;
    const keyB = (argsOf(bB, 'insert')[0]![0] as Record<string, unknown>).dedup_key;
    expect(keyA).toBe('00000000-0000-0000-0000-0000000000d1:ord-A');
    expect(keyB).toBe('00000000-0000-0000-0000-0000000000d1:ord-B');
    // 🔴 這一行是重點:兩把鍵**必須不同**,相同 = 第二封被唯一鍵擋掉 = 漏一封信。
    expect(keyA).not.toBe(keyB);
  });

  it('🔴 payload 裡【沒有】追蹤碼、沒有品項 —— 存了會過期,而信寄出去收不回來', async () => {
    const b = makeBuilder({ data: [{ id: 'outbox-9' }], error: null });
    await adapter(makeClient(b)).enqueue(SHIPPED_INPUT);
    const row = argsOf(b, 'insert')[0]![0] as Record<string, unknown>;

    expect(row.payload).toEqual({
      event_version: 1,
      display_id: 'PCM-2026-0001',
      // 🔴 箱 uuid **在** payload 裡(2026-08-22 codex R1 ④ 之後加):
      //    它是寄送時去主表撈脈絡的唯一安全接點。可以存,因為它**不可變**;
      //    而追蹤碼不行,因為它**後台可改**。判別的是可不可變,不是是不是 id。
      shipment_id: '00000000-0000-0000-0000-0000000000d1',
      shipment_reference: 'BCDF23',
      shipped_at: '2026-08-22T02:00:00Z',
    });
    // 逐一釘死:這幾個鍵**不得**出現(它們都是「可後台改」的欄)。
    const payload = row.payload as Record<string, unknown>;
    for (const forbidden of ['tracking_number', 'trackingNumber', 'lines', 'items', 'carrier_name']) {
      expect(payload).not.toHaveProperty(forbidden);
    }
  });

  it('subject 帶箱號 —— 少了它,同一張單的兩封信主旨一模一樣', async () => {
    const b = makeBuilder({ data: [{ id: 'outbox-9' }], error: null });
    await adapter(makeClient(b)).enqueue(SHIPPED_INPUT);
    const row = argsOf(b, 'insert')[0]![0] as Record<string, unknown>;

    expect(row.subject).toContain('PCM-2026-0001');
    expect(row.subject).toContain('BCDF23'); // ← 這一格是「分得出哪一箱」的唯一保證
  });

  it('🔴 撞唯一鍵時,回查用的是**算出來的 dedup_key**、不是 orderId', async () => {
    // 原版寫死 `.eq('dedup_key', input.orderId)` ⇒ order_shipped 撞鍵後回查查不到
    // ⇒ throw「撞唯一鍵但查無同事件列」⇒ 呼叫端記 errors ⇒ 下輪再撈再撞
    // ⇒ **那封信永遠排不進去,而且每一輪都吵**。型別擋不住(兩邊都是 string)。
    const insertB = makeBuilder({ data: null, error: { code: '23505', message: 'dup' } });
    const verifyB = makeBuilder({ data: [{ id: 'outbox-9', order_id: 'ord-uuid-1' }], error: null });
    await expect(adapter(makeClient(insertB, verifyB)).enqueue(SHIPPED_INPUT)).resolves.toEqual({
      kind: 'duplicate',
    });

    const eqArgs = argsOf(verifyB, 'eq');
    expect(eqArgs).toContainEqual(['dedup_key', '00000000-0000-0000-0000-0000000000d1:ord-uuid-1']);
    expect(eqArgs).not.toContainEqual(['dedup_key', 'ord-uuid-1']);
  });
});

describe('SupabaseEmailOutboxAdapter.claimDue / claimById(CAS 認領)', () => {
  it('due 掃描後逐列 CAS:寫 sending+claimed_at+attempts+1,述詞含樂觀鎖與上限 guard', async () => {
    const dueB = makeBuilder({ data: [JOB_ROW], error: null });
    const casB = makeBuilder({ data: [{ ...JOB_ROW, attempts: 1 }], error: null });
    const jobs = await adapter(makeClient(dueB, casB)).claimDue(10);
    expect(jobs).toHaveLength(1);
    expect(jobs[0]!.id).toBe('outbox-1');
    expect(jobs[0]!.attempts).toBe(1);
    // due 述詞:pending|failed + next_retry_at <= now。
    expect(argsOf(dueB, 'in')[0]).toEqual(['status', ['pending', 'failed']]);
    expect(argsOf(dueB, 'lte')[0]![0]).toBe('next_retry_at');
    // CAS:update 值 + WHERE id/status/attempts 樂觀鎖/attempts<max。
    const casUpdate = argsOf(casB, 'update')[0]![0] as Record<string, unknown>;
    expect(casUpdate.status).toBe('sending');
    expect(casUpdate.claimed_at).toEqual(expect.any(String));
    expect(casUpdate.attempts).toBe(1);
    expect(argsOf(casB, 'eq')).toEqual([
      ['id', 'outbox-1'],
      ['attempts', 0],
    ]);
    expect(argsOf(casB, 'in')[0]).toEqual(['status', ['pending', 'failed']]);
    expect(argsOf(casB, 'lt')[0]).toEqual(['attempts', 5]);
  });

  it('🔴 死列(attempts >= max_attempts)不進 CAS(REQUIRED-E2a guard 的 app 半段)', async () => {
    const dead = { ...JOB_ROW, id: 'outbox-dead', attempts: 5, max_attempts: 5 };
    const dueB = makeBuilder({ data: [dead], error: null });
    const client = makeClient(dueB);
    const jobs = await adapter(client).claimDue(10);
    expect(jobs).toEqual([]);
    // 只打了 due 掃描那一次,沒有第二次 from()(= 零 CAS 嘗試)。
    expect((client.from as unknown as ReturnType<typeof vi.fn>).mock.calls).toHaveLength(1);
  });

  it('🔴 R1 Critical 迴歸:死列佔滿排序最前(恆最老),活信仍被認領、不被 limit 餓死', async () => {
    // 死列 next_retry_at 恆最老 → PostgREST 回列排最前;limit=2 若先裁再過濾 = 全是死列。
    const deadRows = Array.from({ length: 5 }, (_, i) => ({
      ...JOB_ROW,
      id: `outbox-dead-${i}`,
      dedup_key: `dead-${i}`,
      attempts: 5,
      max_attempts: 5,
    }));
    const live = { ...JOB_ROW, id: 'outbox-live', dedup_key: 'live-1' };
    const dueB = makeBuilder({ data: [...deadRows, live], error: null });
    const casB = makeBuilder({ data: [{ ...live, attempts: 1 }], error: null });
    const jobs = await adapter(makeClient(dueB, casB)).claimDue(2);
    expect(jobs.map((j) => j.id)).toEqual(['outbox-live']);
    // 取大窗:DB 端 limit = max(caller limit, DUE_SCAN_CAP=200)、非 caller 的 2。
    expect(argsOf(dueB, 'limit')[0]).toEqual([200]);
  });

  it('limit = 認領上限:湊滿即停、不多打 CAS', async () => {
    const rowB = { ...JOB_ROW, id: 'outbox-b', dedup_key: 'ord-uuid-2' };
    const dueB = makeBuilder({ data: [JOB_ROW, rowB], error: null });
    const casB = makeBuilder({ data: [{ ...JOB_ROW, attempts: 1 }], error: null });
    const client = makeClient(dueB, casB);
    const jobs = await adapter(client).claimDue(1);
    expect(jobs).toHaveLength(1);
    // from() 恰 2 次 = due 掃描 + 1 次 CAS(第二列不再嘗試)。
    expect((client.from as unknown as ReturnType<typeof vi.fn>).mock.calls).toHaveLength(2);
  });

  it('CAS 搶輸(0 列)→ 該列靜默略過、其餘照常(搶輸不消耗認領額度)', async () => {
    const rowB = { ...JOB_ROW, id: 'outbox-b', dedup_key: 'ord-uuid-2', order_id: 'ord-uuid-2' };
    const dueB = makeBuilder({ data: [JOB_ROW, rowB], error: null });
    const loseCas = makeBuilder({ data: [], error: null });
    const winCas = makeBuilder({ data: [{ ...rowB, attempts: 1 }], error: null });
    const jobs = await adapter(makeClient(dueB, loseCas, winCas)).claimDue(1);
    expect(jobs.map((j) => j.id)).toEqual(['outbox-b']);
  });

  it('claimById:非 due(查無列)→ null;命中 → CAS 認領', async () => {
    const missB = makeBuilder({ data: [], error: null });
    expect(await adapter(makeClient(missB)).claimById('outbox-x')).toBeNull();

    const hitB = makeBuilder({ data: [JOB_ROW], error: null });
    const casB = makeBuilder({ data: [{ ...JOB_ROW, attempts: 1 }], error: null });
    const job = await adapter(makeClient(hitB, casB)).claimById('outbox-1');
    expect(job?.id).toBe('outbox-1');
    expect(argsOf(hitB, 'eq')[0]).toEqual(['id', 'outbox-1']);
  });
});

describe('SupabaseEmailOutboxAdapter 持有者路徑三出口(雙向 CHECK + ABA 世代柵欄)', () => {
  it('markSent:status=sent + sent_at + 🔴 claimed_at=NULL,述詞鎖 sending + attempts 世代', async () => {
    const b = makeBuilder({ data: [{ id: 'outbox-1' }], error: null });
    expect(await adapter(makeClient(b)).markSent('outbox-1', 1)).toBe(true);
    const vals = argsOf(b, 'update')[0]![0] as Record<string, unknown>;
    expect(vals.status).toBe('sent');
    expect(vals.claimed_at).toBeNull();
    expect(vals.sent_at).toEqual(expect.any(String));
    expect(argsOf(b, 'eq')).toEqual([
      ['id', 'outbox-1'],
      ['status', 'sending'],
      ['attempts', 1],
    ]);
  });

  it('🔴 ABA 迴歸(codex R1):lease 回收+他人再認領(attempts 已推進)→ 舊世代標記 0 列 → false', async () => {
    // DB 端:列現況 status=sending、attempts=2(B 的認領);A 帶舊世代 1 來標 → eq(attempts,1) 失配。
    const b = makeBuilder({ data: [], error: null });
    expect(await adapter(makeClient(b)).markSent('outbox-1', 1)).toBe(false);
    // 述詞確實帶了世代柵欄(這就是 0 列的機制,不是碰巧)。
    expect(argsOf(b, 'eq')).toEqual([
      ['id', 'outbox-1'],
      ['status', 'sending'],
      ['attempts', 1],
    ]);
  });

  it('markFailed:status=failed + 錯誤碼 + next_retry_at + 🔴 claimed_at=NULL;attempts 不遞增', async () => {
    const b = makeBuilder({ data: [{ id: 'outbox-1' }], error: null });
    const retryAt = new Date('2026-07-17T03:00:00Z');
    expect(await adapter(makeClient(b)).markFailed('outbox-1', 1, 'http_429', retryAt)).toBe(true);
    const vals = argsOf(b, 'update')[0]![0] as Record<string, unknown>;
    expect(vals.status).toBe('failed');
    expect(vals.last_error_code).toBe('http_429');
    expect(vals.next_retry_at).toBe(retryAt.toISOString());
    expect(vals.claimed_at).toBeNull();
    expect(vals).not.toHaveProperty('attempts');
  });

  it('🔴 runtime allowlist 迴歸(codex R1):過 DB regex 但非 allowlist 的碼 → 改寫 provider_error', async () => {
    const b = makeBuilder({ data: [{ id: 'outbox-1' }], error: null });
    // 'sean_0912345678' 符合 ^[a-z0-9_]{1,64}$ = DB 擋不住的 PII 走私樣本。
    const rogue = 'sean_0912345678' as EmailSendErrorCode;
    await adapter(makeClient(b)).markFailed('outbox-1', 1, rogue, new Date());
    const vals = argsOf(b, 'update')[0]![0] as Record<string, unknown>;
    expect(vals.last_error_code).toBe('provider_error');
  });

  it('markSkippedOrderIneligible:不可翻轉終態 + 🔴 last_error_code=order_ineligible(稽核碼必寫)', async () => {
    const b = makeBuilder({ data: [{ id: 'outbox-1' }], error: null });
    expect(await adapter(makeClient(b)).markSkippedOrderIneligible('outbox-1', 1)).toBe(true);
    const vals = argsOf(b, 'update')[0]![0] as Record<string, unknown>;
    expect(vals.status).toBe('skipped_order_ineligible');
    expect(vals.last_error_code).toBe('order_ineligible');
    expect(vals.claimed_at).toBeNull();
    expect(argsOf(b, 'eq')).toEqual([
      ['id', 'outbox-1'],
      ['status', 'sending'],
      ['attempts', 1],
    ]);
  });

  // 🔴🔴 **⟦b4-MAILCANCEL1⟧(2026-09-02)—— 而這一格是【突變逼出來的】, 不是想到的。**
  //    我先寫了 use-case 那三格(不寄 / 不計 error / CAS 柵欄), 三發突變都殺得掉。
  //    🛑 而第四發:把本 adapter 的 `last_error_code` 從 `order_ineligible_at_send`
  //      改回 `order_ineligible` ⇒ **全綠, 45 passed, 一格都沒紅。**
  //    ⇒ 📌 而那正是【唯一承重的那個字面】:兩層落同一個碼 ⇒ 上游那道閘變成看不見的
  //      (主視窗 2026-08-24 拍乙)⇒ port 要的那個比值永遠算不出來。
  //    ⇒ ⇒ **use-case 那一層守不住它** —— 那一層只看得到「呼了哪一支方法」,
  //      看不到那支方法【往 DB 寫了哪個字】。⇒ 只有這一層守得住。
  it('markSkippedOrderCancelled:同一個 status,而 🔴 last_error_code=order_ineligible_at_send(那個差是承重的)', async () => {
    const b = makeBuilder({ data: [{ id: 'outbox-1' }], error: null });
    expect(await adapter(makeClient(b)).markSkippedOrderCancelled('outbox-1', 1)).toBe(true);
    const vals = argsOf(b, 'update')[0]![0] as Record<string, unknown>;
    // 🔵 態【刻意】與上一格相同 —— 沿用既有白名單 ⇒ 零 migration
    expect(vals.status).toBe('skipped_order_ineligible');
    // 🔴 而碼【必須】不同 —— 這一行就是那道乙
    expect(vals.last_error_code).toBe('order_ineligible_at_send');
    expect(vals.claimed_at).toBeNull();
    expect(argsOf(b, 'eq')).toEqual([
      ['id', 'outbox-1'],
      ['status', 'sending'],
      ['attempts', 1],
    ]);
  });

  // 🔴 codex R1 must-fix(8/8):新 mark 出口原本【零正向測試】——
  //    我只在 use-case 那側的 fake 加了「呼到就 reject」, 而那守不住這一層的四件事:
  //    落哪個 status / 稽核碼寫了沒 / claimed_at 有沒有清 / 世代柵欄 CAS 帶對了沒。
  it('markSkippedShipmentVoided:落 skipped_shipment_voided + 🔴 稽核碼 shipment_voided + 清 claimed_at + 世代柵欄', async () => {
    const b = makeBuilder({ data: [{ id: 'outbox-9' }], error: null });
    expect(await adapter(makeClient(b)).markSkippedShipmentVoided('outbox-9', 3, 'ship-1:ord-1')).toBe(true);
    const vals = argsOf(b, 'update')[0]![0] as Record<string, unknown>;
    expect(vals.status).toBe('skipped_shipment_voided');
    // 🔴 與 order_ineligible 分開是承重的:合併之後稽核會得到一個【錯而合理】的答案
    expect(vals.last_error_code).toBe('shipment_voided');
    expect(vals.claimed_at).toBeNull();
    expect(argsOf(b, 'eq')).toEqual([
      ['id', 'outbox-9'],
      ['status', 'sending'],
      ['attempts', 3],
    ]);
  });

  // 🔴 ⟦5b-TRACKNUMGAP1⟧ 片 C(codex 對抗審查 2026-09-04 must-fix):
  //    `markSkippedTrackingSuperseded` **原本零測試** —— sweeper 那側把它 mock 掉,
  //    ⇒ 📌 那一層只看得到「呼了哪一支方法」, **看不到那支方法往 DB 寫了哪個字**
  //      ⇒ 一個「什麼都沒更新」的實作在 use-case 那側照樣全綠。
  it('markSkippedTrackingSuperseded:落 skipped_order_ineligible + 稽核碼 tracking_superseded + 清 claimed_at + 世代柵欄', async () => {
    const b = makeBuilder({ data: [{ id: 'outbox-7' }], error: null });
    expect(
      await adapter(makeClient(b)).markSkippedTrackingSuperseded('outbox-7', 2, 'ship-1:AAA-111'),
    ).toBe(true);
    const vals = argsOf(b, 'update')[0]![0] as Record<string, unknown>;
    // 🔵 態沿用既有白名單 ⇒ 零 migration(與上面兩格同一個理由)
    expect(vals.status).toBe('skipped_order_ineligible');
    // 🔴 而碼必須是自己的一個 —— 合併進別的碼, 稽核會得到一個【錯而合理】的答案
    expect(vals.last_error_code).toBe('tracking_superseded');
    expect(vals.claimed_at).toBeNull();
    expect(argsOf(b, 'eq')).toEqual([
      ['id', 'outbox-7'],
      ['status', 'sending'],
      ['attempts', 2],
    ]);
  });

  it('🔴🔴 更正信退休 dedup_key —— 而且【與 status 在同一發 update】', async () => {
    const b = makeBuilder({ data: [{ id: 'outbox-7' }], error: null });
    await adapter(makeClient(b)).markSkippedTrackingSuperseded('outbox-7', 2, 'ship-1:AAA-111');
    const calls = argsOf(b, 'update');
    // 🔴 承重:分兩發 update 的實作, 中間掛掉會留下一個【態改了而鍵沒退休】的列
    //    ⇒ 那個舊鍵會永久擋住同一箱同一號碼的下一封。
    expect(calls).toHaveLength(1);
    const vals = calls[0]![0] as Record<string, unknown>;
    expect(vals.dedup_key).toBe('ship-1:AAA-111:superseded:outbox-7');
    // 🔴 退休鍵必須含 id —— 少了它, 同一個舊鍵退休兩次會自己撞自己的唯一鍵。
    expect(String(vals.dedup_key)).toContain('outbox-7');
  });

  // ⟦b4-SHIPUNVOID1⟧ 2026-08-31 —— 🔴 **這三格守的是一個【沒有東西會叫】的漏信。**
  it('🔴🔴 退休 dedup_key,而且【與 status 在同一發 update】', async () => {
    const b = makeBuilder({ data: [{ id: 'outbox-9' }], error: null });
    await adapter(makeClient(b)).markSkippedShipmentVoided('outbox-9', 3, 'ship-1:ord-1');
    const calls = argsOf(b, 'update');
    // 🔴 **只有一發 update** —— 拆成兩發的話,「先 unvoid 後 skip」那個順序會讓退休撲空
    //    (probe W4 實測那個順序可達;W4b 負對照對另一個順序印不同的值)。
    expect(calls.length).toBe(1);
    const vals = calls[0]![0] as Record<string, unknown>;
    expect(vals.dedup_key).toBe('ship-1:ord-1:voided:outbox-9');
    // 🔴 status 與它在**同一個 values 物件**裡 ⇒ 同一發 UPDATE ⇒ 不可能一個成功一個失敗
    expect(vals.status).toBe('skipped_shipment_voided');
  });

  it('🔴 負對照:兩列不同的 outbox ⇒ 兩把不同的退休鍵(否則第二列會撞到第一列)', async () => {
    const b1 = makeBuilder({ data: [{ id: 'a' }], error: null });
    await adapter(makeClient(b1)).markSkippedShipmentVoided('outbox-A', 1, 'ship-1:ord-1');
    const b2 = makeBuilder({ data: [{ id: 'b' }], error: null });
    await adapter(makeClient(b2)).markSkippedShipmentVoided('outbox-B', 1, 'ship-1:ord-1');
    expect((argsOf(b1, 'update')[0]![0] as Record<string, unknown>).dedup_key)
      .not.toBe((argsOf(b2, 'update')[0]![0] as Record<string, unknown>).dedup_key);
  });

  it('🔴 冪等:同一列被 skip 兩次 ⇒ 算出來的鍵【相同】(不會越疊越長)', async () => {
    const b1 = makeBuilder({ data: [{ id: 'x' }], error: null });
    await adapter(makeClient(b1)).markSkippedShipmentVoided('outbox-9', 3, 'ship-1:ord-1');
    const b2 = makeBuilder({ data: [{ id: 'x' }], error: null });
    await adapter(makeClient(b2)).markSkippedShipmentVoided('outbox-9', 3, 'ship-1:ord-1');
    expect((argsOf(b1, 'update')[0]![0] as Record<string, unknown>).dedup_key)
      .toBe((argsOf(b2, 'update')[0]![0] as Record<string, unknown>).dedup_key);
  });

  it('🔴 對照:同一支出口, 所有權已失(0 列)⇒ false 且不覆寫(證明上一格的 true 是資料造成的)', async () => {
    const b = makeBuilder({ data: [], error: null });
    expect(await adapter(makeClient(b)).markSkippedShipmentVoided('outbox-9', 3, 'ship-1:ord-1')).toBe(false);
  });

  it('所有權已失(lease 被回收、0 列)→ false 不覆寫', async () => {
    const b = makeBuilder({ data: [], error: null });
    expect(await adapter(makeClient(b)).markSent('outbox-1', 1)).toBe(false);
  });
});

describe('SupabaseEmailOutboxAdapter.reclaimStaleLeases(回收器路徑;E2a-a、Sean Q2=A)', () => {
  const STALE_BEFORE = new Date('2026-07-17T02:00:00Z');
  const NEXT_RETRY = new Date('2026-07-17T03:00:00Z');

  it('stale sending → failed + 🔴 last_error_code=lease_reclaimed + claimed_at=NULL + next_retry_at', async () => {
    const b = makeBuilder({ data: [{ id: 'outbox-1' }], error: null });
    expect(await adapter(makeClient(b)).reclaimStaleLeases(STALE_BEFORE, NEXT_RETRY)).toBe(1);
    const vals = argsOf(b, 'update')[0]![0] as Record<string, unknown>;
    // Q2=A:落 failed(可重試態)、非 pending —— 訊號 2 述詞含 failed@max ⇒ 零盲區。
    expect(vals.status).toBe('failed');
    expect(vals.last_error_code).toBe('lease_reclaimed');
    expect(vals.claimed_at).toBeNull();
    expect(vals.next_retry_at).toBe(NEXT_RETRY.toISOString());
    // 關卡2 code-reviewer nit:逐欄斷言放行「多寫一個無關欄」(如 sent_at=說謊成已寄)→ 釘死全集。
    expect(Object.keys(vals).sort()).toEqual([
      'claimed_at',
      'last_error_code',
      'next_retry_at',
      'status',
    ]);
  });

  it('🔴 反證「回收不可改走 markFailed」:把 lease_reclaimed 餵進 markFailed → 被改寫成 provider_error', async () => {
    // 關卡2 code-reviewer nit:前版只斷言「常數 !== provider_error」= 同義反覆、從未跑過 allowlist,
    // 證不到它宣稱的性質。真證據 = 反向跑一次:證明「走 markFailed 這條路,稽核碼會被靜默吃掉」,
    // 這才是 reclaimStaleLeases 必須自己寫欄、不得複用 markFailed 的實據(Q2=A 要的碼會消失)。
    const b = makeBuilder({ data: [{ id: 'outbox-1' }], error: null });
    await adapter(makeClient(b)).markFailed(
      'outbox-1',
      1,
      'lease_reclaimed' as EmailSendErrorCode,
      NEXT_RETRY,
    );
    expect((argsOf(b, 'update')[0]![0] as Record<string, unknown>).last_error_code).toBe(
      'provider_error',
    );
  });

  it('🔴 述詞 = status=sending + claimed_at < staleBefore(所有權判定;不帶也不可能帶世代柵欄)', async () => {
    const b = makeBuilder({ data: [{ id: 'outbox-1' }], error: null });
    await adapter(makeClient(b)).reclaimStaleLeases(STALE_BEFORE, NEXT_RETRY);
    expect(argsOf(b, 'eq')).toEqual([['status', 'sending']]);
    expect(argsOf(b, 'lt')).toEqual([['claimed_at', STALE_BEFORE.toISOString()]]);
    // 關卡2 Fable F3:精確比對 lt/eq 抓不到「有人日後用 .lte 加 attempts guard」→ 顯式釘死空集。
    expect(argsOf(b, 'lte')).toEqual([]);
    // 🔴 關卡2 codex must-fix:fake builder 不論有無 .select 都回注入 data → 拔掉實作的
    // `.select('id')` 時 7 測仍全綠 = 自證自演。但真 Supabase 的 UPDATE **預設不回列**
    // (官方:須接 .select() 才回更新列)→ 屆時 data 恆空、reclaim 永遠回 0 = 回收靜默失效
    // (列繼續卡 sending → 訊號 3 永久告警)。故顯式釘死投射。
    expect(argsOf(b, 'select')).toEqual([['id']]);
  });

  it('🔴 attempts 一律不動(認領時已 +1;世代 token 單調遞增是 ABA 柵欄的前提)', async () => {
    const b = makeBuilder({ data: [{ id: 'outbox-1' }], error: null });
    await adapter(makeClient(b)).reclaimStaleLeases(STALE_BEFORE, NEXT_RETRY);
    const vals = argsOf(b, 'update')[0]![0] as Record<string, unknown>;
    expect(vals).not.toHaveProperty('attempts');
  });

  it('🔴 刻意無 attempts < max guard:達上限的列也必須離開 sending(否則訊號 3 永久告警)', async () => {
    const b = makeBuilder({ data: [{ id: 'outbox-max' }], error: null });
    await adapter(makeClient(b)).reclaimStaleLeases(STALE_BEFORE, NEXT_RETRY);
    // 回收後 = failed@max → 由訊號 2(dead letter)接手,而非卡在 sending 讓訊號 3 一直叫。
    expect(argsOf(b, 'lt')).toEqual([['claimed_at', STALE_BEFORE.toISOString()]]);
  });

  it('批次回收 → 回傳實際列數;無 stale 列 → 0(sweeper 回應 counts-only 的來源)', async () => {
    const many = makeBuilder({ data: [{ id: 'a' }, { id: 'b' }, { id: 'c' }], error: null });
    expect(await adapter(makeClient(many)).reclaimStaleLeases(STALE_BEFORE, NEXT_RETRY)).toBe(3);
    const none = makeBuilder({ data: [], error: null });
    expect(await adapter(makeClient(none)).reclaimStaleLeases(STALE_BEFORE, NEXT_RETRY)).toBe(0);
  });

  it('DB 錯誤 → throw,且訊息不含收件者/payload(PII 不進錯誤)', async () => {
    const b = makeBuilder({ data: null, error: { code: '42501', message: 'permission denied' } });
    await expect(
      adapter(makeClient(b)).reclaimStaleLeases(STALE_BEFORE, NEXT_RETRY),
    ).rejects.toThrow(/lease 回收失敗\(42501\)/);
  });
});

// ⟦b4-SHIPGATE1⟧ 2026-09-01:線關著時不要認領 order_shipped。
describe('⟦b4-SHIPGATE1⟧ claimDue 的 excludeEventTypes', () => {
  // 🔴🔴 **2026-09-01 R3 must-fix F2:改用 `.neq` —— 而 `.not(…,'in',…)` 那個形狀本 repo 零前例。**
  //    ⛔ ~~原本斷言 `[['event_type','in','(order_shipped)']]`~~ —— 而那一格斷言的是
  //       **實作自己寫出來的同一個字面** ⇒ 對「PostgREST 收不收這個文法」**零判別力**
  //       ⇒ **兩邊一起錯會印綠。**⇒ 改成釘住【已證形狀】。
  it('🔴 給了一個 ⇒ 查詢帶 .neq(event_type, …)(突變:拿掉 adapter 那一句 ⇒ 這格必須紅)', async () => {
    const b = makeBuilder({ data: [], error: null });
    await adapter(makeClient(b)).claimDue(10, { excludeEventTypes: ['order_shipped'] });
    expect(argsOf(b, 'neq')).toEqual([['event_type', 'order_shipped']]);
    // 🔵 而【不得】再用那個沒驗過的 in 形狀
    expect(argsOf(b, 'not')).toEqual([]);
  });

  // 🔴🔴 **2026-09-04(片 C, codex R2 must-fix #1)—— 這一格從「必須 throw」翻成「必須不 throw」。**
  //    ⛔ ~~原本:給兩個以上 ⇒ throw(不猜沒驗過的 PostgREST 文法)~~
  //    ⇒ 🛑 **那道拒絕在片 C 變成一顆炸彈**:片 C 把第二個事件加進同一份清單
  //      ⇒ 截止開關關著時 exclude 有 2 個 ⇒ `claimDue` throw
  //      ⇒ sweeper 的 `catch { errors++ }` 吃掉 ⇒ `jobs = []`
  //      ⇒ **連 `order_created` 都不寄, 每 5 分鐘一次。**
  //    ✅ 修法不引進新文法:查詢層只在恰好 1 個時下 `.neq`(既有呼叫端逐位元不變),
  //      ≥2 個改在 app 層 `candidates` 那一發濾掉 —— 那道閘的目的是「不要**認領**」,
  //      而認領發生在 filter 之後 ⇒ 目的達成, 零新文法。
  it('🔴🔴 給兩個以上 ⇒ 【不 throw】, 而且【查詢逐位元不變】(不猜沒驗過的文法)', async () => {
    const b = makeBuilder({ data: [], error: null });
    await expect(
      adapter(makeClient(b)).claimDue(10, {
        excludeEventTypes: ['order_shipped', 'shipment_tracking_corrected'],
      }),
    ).resolves.toEqual([]);
    // 🔴 承重:≥2 個時**不得**下 `.neq`(那會只濾掉一個而看起來像濾掉了)、更不得用 `not in`。
    expect(argsOf(b, 'neq')).toEqual([]);
    expect(argsOf(b, 'not')).toEqual([]);
  });

  it('🔴🔴 給兩個 ⇒ 兩種都【不會被認領】—— 而這一格才是那道閘的目的', async () => {
    // 🛑 上一格只證「不炸」。**「不炸」與「真的擋住了」是兩個宣稱** ——
    //    而 ≥2 個時查詢層一個字都沒加 ⇒ 擋住它的是 app 層那一發 filter。
    //    ⇒ 📌 沒有這一格, 把那個 `!excludeSet.has(...)` 整段刪掉照樣全綠。
    const rows = [
      { id: 'a', event_type: 'order_shipped', attempts: 0, max_attempts: 5 },
      { id: 'b', event_type: 'shipment_tracking_corrected', attempts: 0, max_attempts: 5 },
      { id: 'c', event_type: 'order_created', attempts: 0, max_attempts: 5 },
    ];
    const scan = makeBuilder({ data: rows, error: null });
    // 🔵 掃描之後每一列會各叫一次 `from` 去 CAS 認領 ⇒ 第一發之後一律回一個「誰都搶不到」的 builder。
    const claim = () => makeBuilder({ data: [], error: null });
    const from = vi.fn().mockReturnValue(claim());
    from.mockReturnValueOnce(scan);
    const client = { from } as unknown as EmailOutboxClient;

    const got = await adapter(client).claimDue(10, {
      excludeEventTypes: ['order_shipped', 'shipment_tracking_corrected'],
    });
    expect(got).toEqual([]);
    // 🔴 承重:`from` 被叫幾次 = 1(掃描)+ 【嘗試認領幾列】。
    //    三列裡只有 `order_created` 該被嘗試 ⇒ 總共 2 次。
    //    ⇒ 刪掉 adapter 那個 `!excludeSet.has(...)` ⇒ 會變成 4 次 ⇒ 這一格紅。
    expect(from).toHaveBeenCalledTimes(2);
  });

  it('🟢 未給 ⇒ 【一次都不呼叫 not】(既有查詢逐位元不變)', async () => {
    const b = makeBuilder({ data: [], error: null });
    await adapter(makeClient(b)).claimDue(10);
    expect(argsOf(b, 'not')).toEqual([]);
  });

  it('🔵 給空陣列 ⇒ 也【一次都不呼叫 not】', async () => {
    // 🛑 這一格是承重的:**若沒有 `exclude.length > 0` 那道守門**, 空陣列會組出
    //    `not('event_type','in','()')` —— 而空的 `not in ()` 給 PostgREST 是**語法錯**,
    //    它會炸。⛔ ~~「在【所有既有路徑】上炸」~~ **那句誇大了**(codex R2 nit):
    //       既有呼叫端傳的是 `undefined`, 而空陣列今天**只出現在這一格專屬測試裡**。
    //    ⇒ 而它仍然值得守:哪天有人「順手」傳一個算出來的空陣列進來, 那條路就活了。
    //    ✅ 而**今天不會發生**, 因為那道守門在。**這一格釘的就是那道守門。**
    const b = makeBuilder({ data: [], error: null });
    await adapter(makeClient(b)).claimDue(10, { excludeEventTypes: [] });
    expect(argsOf(b, 'not')).toEqual([]);
  });
});
