import { describe, expect, it } from 'vitest';
import { parseOrderNoteForm } from './note-form';
import {
  NOTE_BODY_FIELD,
  NOTE_CHANNEL_FIELD,
  NOTE_CORRECTS_FIELD,
  NOTE_OCCURRED_AT_FIELD,
  NOTE_ORDER_ID_FIELD,
  NOTE_REQUEST_TOKEN_FIELD,
  NOTE_TYPE_FIELD,
  generateNoteRequestToken,
  isNoteRequestToken,
} from './note-action-state';

// M-4b E10 A9d2-1 解析器。合約來源 = A6 `20260802150000` 與建表 `20260729030000`。

const ORDER_ID = '11111111-2222-3333-4444-555555555555';
const NOTE_ID = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';
const TOKEN = '99999999-8888-7777-6666-555555555555';
const ZWSP = String.fromCharCode(0x200b);

function formOf(fields: Record<string, string>): FormData {
  const data = new FormData();
  for (const [name, value] of Object.entries(fields)) data.set(name, value);
  return data;
}

const internalForm = (over: Record<string, string> = {}) =>
  formOf({
    [NOTE_ORDER_ID_FIELD]: ORDER_ID,
    [NOTE_REQUEST_TOKEN_FIELD]: TOKEN,
    [NOTE_TYPE_FIELD]: 'internal',
    [NOTE_BODY_FIELD]: '客人說先不要出貨',
    ...over,
  });

const contactForm = (over: Record<string, string> = {}) =>
  formOf({
    [NOTE_ORDER_ID_FIELD]: ORDER_ID,
    [NOTE_REQUEST_TOKEN_FIELD]: TOKEN,
    [NOTE_TYPE_FIELD]: 'contact_log',
    [NOTE_BODY_FIELD]: '來電詢問到貨',
    [NOTE_CHANNEL_FIELD]: 'phone',
    [NOTE_OCCURRED_AT_FIELD]: '2026-08-02T14:30:00+08:00',
    ...over,
  });

describe('parseOrderNoteForm — 型別分流(建表檔 :116-127 配對規則)', () => {
  it('internal:channel 與 occurredAt **逐欄為 null**,即使表單上帶了值也不送', () => {
    const parsed = parseOrderNoteForm(
      internalForm({
        [NOTE_CHANNEL_FIELD]: 'line',
        [NOTE_OCCURRED_AT_FIELD]: '2026-08-02T14:30:00+08:00',
      }),
    );
    expect(parsed.ok).toBe(true);
    // 🔴 深度相等:哪天有人「有填就送」,internal 會帶著值過來、撞 INTERNAL_FIELDS_FORBIDDEN
    expect(parsed).toEqual({
      ok: true,
      orderId: ORDER_ID,
      noteType: 'internal',
      body: '客人說先不要出貨',
      channel: null,
      occurredAt: null,
      correctsNoteId: null,
      requestToken: TOKEN,
    });
  });

  it('contact_log:兩欄都必填 —— 缺 channel 或缺 occurredAt 皆 ok:false', () => {
    expect(parseOrderNoteForm(contactForm({ [NOTE_CHANNEL_FIELD]: '' })).ok).toBe(false);
    expect(parseOrderNoteForm(contactForm({ [NOTE_OCCURRED_AT_FIELD]: '' })).ok).toBe(false);
  });

  it('customer_notified 走與 contact_log 相同的必填規則', () => {
    const parsed = parseOrderNoteForm(
      contactForm({ [NOTE_TYPE_FIELD]: 'customer_notified', [NOTE_CHANNEL_FIELD]: 'line' }),
    );
    expect(parsed).toMatchObject({ ok: true, noteType: 'customer_notified', channel: 'line' });
  });

  it('note_type 不在三值內 → ok:false(值域鏡像 :87-88)', () => {
    expect(parseOrderNoteForm(internalForm({ [NOTE_TYPE_FIELD]: 'urgent' })).ok).toBe(false);
  });

  it('channel 不在五值內 → ok:false(值域鏡像 :129-130)', () => {
    expect(parseOrderNoteForm(contactForm({ [NOTE_CHANNEL_FIELD]: 'fax' })).ok).toBe(false);
  });
});

describe('parseOrderNoteForm — occurredAt 時區(關卡1 F6:本片最容易靜默寫錯資料的一條)', () => {
  // 🔴 `datetime-local` 的 value 不帶偏移;server 跑 UTC ⇒ 台北 14:30 會被存成台北 22:30,
  //    差 8 小時、在 DB 合法範圍內、靜默接受、append-only 永久留存,而那是告知義務的證據時間。
  it('不帶時區偏移的 datetime-local 原始值 → ok:false(fail-closed,不自行假設 Asia/Taipei)', () => {
    expect(
      parseOrderNoteForm(contactForm({ [NOTE_OCCURRED_AT_FIELD]: '2026-08-02T14:30' })).ok,
    ).toBe(false);
    expect(
      parseOrderNoteForm(contactForm({ [NOTE_OCCURRED_AT_FIELD]: '2026-08-02T14:30:00' })).ok,
    ).toBe(false);
  });

  it('帶 +08:00 偏移 → 收,且**原樣**帶著偏移送出(丟掉偏移就是丟掉 8 小時)', () => {
    const parsed = parseOrderNoteForm(contactForm());
    expect(parsed).toMatchObject({ ok: true, occurredAt: '2026-08-02T14:30:00+08:00' });
  });

  it('`Z` 結尾算合法偏移(toISOString() 的產物 = A10a 最自然的產法)', () => {
    const parsed = parseOrderNoteForm(
      contactForm({ [NOTE_OCCURRED_AT_FIELD]: '2026-08-02T06:30:00.000Z' }),
    );
    expect(parsed).toMatchObject({ ok: true, occurredAt: '2026-08-02T06:30:00.000Z' });
  });

  it('同一個掛鐘時間配不同偏移 = 不同的真實瞬間(殺「把偏移丟掉」的實作)', () => {
    const taipei = parseOrderNoteForm(contactForm());
    const utc = parseOrderNoteForm(
      contactForm({ [NOTE_OCCURRED_AT_FIELD]: '2026-08-02T14:30:00+00:00' }),
    );
    expect(taipei.ok && utc.ok).toBe(true);
    const ms = (p: typeof taipei) => (p.ok ? Date.parse(p.occurredAt as string) : NaN);
    expect(ms(utc) - ms(taipei)).toBe(8 * 60 * 60 * 1000);
  });
});

describe('parseOrderNoteForm — token / id 形狀', () => {
  it('產生器產的 token 過得了驗證器(同源;不得改用 lib/request-id 的 req_<uuid>)', () => {
    const token = generateNoteRequestToken();
    expect(isNoteRequestToken(token)).toBe(true);
    // 🔴 關卡1 F3:A10a 最自然的寫法是重用現成的 generateRequestId(),而它回 `req_<uuid>`
    expect(isNoteRequestToken(`req_${token}`)).toBe(false);
  });

  it('缺 token / token 形狀不合 → ok:false(缺了它整條功能不能用,fail-closed)', () => {
    expect(parseOrderNoteForm(internalForm({ [NOTE_REQUEST_TOKEN_FIELD]: '' })).ok).toBe(false);
    expect(
      parseOrderNoteForm(internalForm({ [NOTE_REQUEST_TOKEN_FIELD]: `req_${TOKEN}` })).ok,
    ).toBe(false);
  });

  it('orderId 非 uuid → ok:false(成功路徑蘊含它已被驗過 ⇒ redirect 目標不是注入面)', () => {
    expect(parseOrderNoteForm(internalForm({ [NOTE_ORDER_ID_FIELD]: '../../evil' })).ok).toBe(false);
  });

  it('correctsNoteId:省略/空字串 → null;有值須 uuid', () => {
    expect(parseOrderNoteForm(internalForm())).toMatchObject({ correctsNoteId: null });
    expect(
      parseOrderNoteForm(internalForm({ [NOTE_CORRECTS_FIELD]: NOTE_ID })),
    ).toMatchObject({ correctsNoteId: NOTE_ID });
    expect(parseOrderNoteForm(internalForm({ [NOTE_CORRECTS_FIELD]: 'nope' })).ok).toBe(false);
  });
});

describe('parseOrderNoteForm — body', () => {
  it('純零寬字元的內容 → ok:false(`.trim()` 不剝 U+200B,`rpcTrim` 會)', () => {
    expect(parseOrderNoteForm(internalForm({ [NOTE_BODY_FIELD]: ZWSP.repeat(5) })).ok).toBe(false);
    expect(`${ZWSP}`.trim()).not.toBe(''); // 釘住「為什麼不能用 .trim()」
  });

  it('🔴 body **原文**送出、不做正規化(A6 的 body_sha256 量的是原文)', () => {
    const raw = '  客人\t說先不要出貨  ';
    expect(parseOrderNoteForm(internalForm({ [NOTE_BODY_FIELD]: raw }))).toMatchObject({
      body: raw,
    });
  });

  it('4000 碼位上限**刻意不在這層重做**(單一真相在 RPC)⇒ 超長仍 ok:true', () => {
    const long = '字'.repeat(5000);
    expect(parseOrderNoteForm(internalForm({ [NOTE_BODY_FIELD]: long }))).toMatchObject({
      ok: true,
    });
  });
});
