import { Readable } from 'node:stream';
import { describe, expect, it } from 'vitest';
import { ImapMailReader, parseHeaderBlock, pickTextParts, toGmailRaw, type ImapClientLike } from './ImapMailReader';

const HEADERS = [
  'From: Akrapovic <news@akrapovic.com>',
  'Subject: =?UTF-8?B?TmV3?=',
  'Authentication-Results: mx.google.com;',
  '       dkim=pass header.i=@akrapovic.com header.s=s1;',
  '       spf=pass smtp.mailfrom=news@akrapovic.com',
  'Authentication-Results: other.example; dmarc=pass header.from=akrapovic.com',
  '',
].join('\r\n');

function fakeClient() {
  const calls: { op: string; args: unknown[] }[] = [];
  const client: ImapClientLike = {
    async mailboxOpen(...args) { calls.push({ op: 'open', args }); return {}; },
    async search(...args) { calls.push({ op: 'search', args }); return [5, 9, 7]; },
    async fetchOne(seq, query, options) {
      calls.push({ op: 'fetch', args: [seq, query, options] });
      if ((query as { bodyStructure?: boolean }).bodyStructure) {
        return {
          seq: 1, uid: Number(seq), emailId: `g${seq}`, threadId: `t${seq}`, internalDate: new Date('2026-10-01T01:02:03Z'),
          envelope: { subject: 'New Slip-On' }, headers: Buffer.from(HEADERS),
          bodyStructure: { type: 'multipart/mixed', childNodes: [
            { part: '1', type: 'text/plain' }, { part: '2', type: 'text/html' }, { part: '3', type: 'text/plain', disposition: 'attachment' },
          ] },
        } as never;
      }
      return { seq: 1, uid: Number(seq), emailId: `g${seq}` } as never;
    },
    async download(range, part, options) {
      calls.push({ op: 'download', args: [range, part, options] });
      return { content: Readable.from([Buffer.from(part === '1' ? '純文字' : '<p>html</p>')]) };
    },
    async logout() { calls.push({ op: 'logout', args: [] }); },
  };
  return { client, calls };
}

describe('ImapMailReader', () => {
  it('🔴 唯讀開標籤資料夾;查詢拿掉 label:;最新的在前、只取 max 封;id = X-GM-MSGID', async () => {
    const { client, calls } = fakeClient();
    const reader = new ImapMailReader({ user: 'u', password: 'p', mailbox: 'PCM新品', connect: async () => client });
    const ids = await reader.listMessageIds({ query: 'label:PCM新品 newer_than:3d', max: 2 });
    expect(calls[0]).toEqual({ op: 'open', args: ['PCM新品', { readOnly: true }] });
    expect(calls[1]).toEqual({ op: 'search', args: [{ gmraw: 'newer_than:3d' }, { uid: true }] });
    expect(ids).toEqual(['g9', 'g7']);
  });

  it('讀一封:多條 Authentication-Results 照順序、折行接回;只抓非附件的 text/plain 與 text/html;主旨用解碼後的', async () => {
    const { client, calls } = fakeClient();
    const reader = new ImapMailReader({ user: 'u', password: 'p', mailbox: 'PCM新品', connect: async () => client });
    await reader.listMessageIds({ query: 'label:PCM新品 newer_than:3d', max: 5 });
    const m = await reader.getMessage('g9');
    expect(m).toMatchObject({
      id: 'g9', threadId: 't9', from: 'Akrapovic <news@akrapovic.com>', subject: 'New Slip-On',
      receivedAt: '2026-10-01T01:02:03.000Z', textBody: '純文字', htmlBody: '<p>html</p>',
    });
    expect(m.authenticationResults).toEqual([
      'mx.google.com; dkim=pass header.i=@akrapovic.com header.s=s1; spf=pass smtp.mailfrom=news@akrapovic.com',
      'other.example; dmarc=pass header.from=akrapovic.com',
    ]);
    expect(calls.filter((c) => c.op === 'download').map((c) => c.args[1])).toEqual(['1', '2']);
    await reader.close();
    expect(calls.at(-1)).toEqual({ op: 'logout', args: [] });
  });

  it('🔴 本檔沒有任何寫入呼叫(不刪、不搬、不改旗標)', async () => {
    const { client, calls } = fakeClient();
    const reader = new ImapMailReader({ user: 'u', password: 'p', mailbox: 'PCM新品', connect: async () => client });
    await reader.listMessageIds({ query: 'newer_than:3d', max: 5 });
    await reader.getMessage('g5');
    expect(new Set(calls.map((c) => c.op))).toEqual(new Set(['open', 'search', 'fetch', 'download']));
  });

  it('登入失敗 ⇒ 丟 ImapReadError, 訊息不帶帳號', async () => {
    const reader = new ImapMailReader({ user: 'secret-user', password: 'p', mailbox: 'PCM新品', connect: async () => { throw Object.assign(new Error('AUTHENTICATIONFAILED secret-user'), { code: 'AUTH' }); } });
    await expect(reader.listMessageIds({ query: 'newer_than:3d', max: 1 })).rejects.toThrow(/登入或開資料夾失敗\(AUTH\)/);
    await expect(reader.listMessageIds({ query: 'newer_than:3d', max: 1 })).rejects.not.toThrow(/secret-user/);
  });
});

describe('純函式', () => {
  it('toGmailRaw / parseHeaderBlock / pickTextParts', () => {
    expect(toGmailRaw('label:PCM新品 newer_than:3d')).toBe('newer_than:3d');
    expect(toGmailRaw('newer_than:3d label:x')).toBe('newer_than:3d');
    expect(parseHeaderBlock('A: 1\r\nB: 2\r\n  cont\r\nA: 3\r\n').get('a')).toEqual(['1', '3']);
    expect(parseHeaderBlock('B: 2\r\n  cont\r\n').get('b')).toEqual(['2 cont']);
    // 單一部分的信沒有 part 編號 ⇒ '1'
    expect(pickTextParts({ type: 'text/html' } as never)).toEqual({ html: '1' });
    expect(pickTextParts({ type: 'multipart/alternative', childNodes: [{ part: '1', type: 'text/html' }] } as never)).toEqual({ html: '1' });
    expect(pickTextParts(undefined)).toEqual({});
  });
});
