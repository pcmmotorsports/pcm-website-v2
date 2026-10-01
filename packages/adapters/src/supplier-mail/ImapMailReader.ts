import type { Readable } from 'node:stream';
import { ImapFlow, type FetchMessageObject, type MessageStructureObject } from 'imapflow';
import type { IInboundMailReader, InboundMailMessage } from '@pcm/ports';

/**
 * ImapMailReader — 用 IMAP + 應用程式密碼讀 Gmail(取代 GmailApiReader 的 mac mini 版)。
 *
 * Sean 2026-10-01:讀 dayun.info@gmail.com、只讀 Gmail 標籤「PCM新品」最近 3 天、只讀不刪。
 * 計畫:~/pcm-mailbox/計畫-電子報草稿-macmini-20261001.md §3。
 *
 * 🔴 只讀:標籤在 IMAP 裡是同名資料夾 ⇒ `readOnly: true` 開(EXAMINE);抓標頭與內文都走 BODY.PEEK ⇒ 不會標成已讀。
 *    不刪、不搬、不改旗標 —— 本檔沒有任何寫入的呼叫。
 * 🔴 id = Gmail 的 X-GM-MSGID(跟 Gmail API 的 message id 同一個數字的十進位), 存進 supplier_inbound_emails.gmail_message_id 去重。
 * 🔴 查詢式沿用 use-case 的 `label:PCM新品 newer_than:3d`:資料夾已經是那個標籤 ⇒ 把 `label:` 拿掉, 剩下的交給 Gmail 的 X-GM-RAW。
 * 🔴 不 log 信件內容、不 log 密碼。
 */

/** 本檔用到的 ImapFlow 方法(測試用假的換掉)。 */
export interface ImapClientLike {
  mailboxOpen(path: string, options: { readOnly: boolean }): Promise<unknown>;
  search(query: { gmraw?: string; emailId?: string }, options: { uid: true }): Promise<number[] | false | undefined>;
  fetchOne(
    seq: string,
    query: Record<string, unknown>,
    options: { uid: true },
  ): Promise<FetchMessageObject | false | undefined>;
  download(range: string, part: string, options: { uid: true; maxBytes: number }): Promise<{ content?: Readable } | unknown>;
  logout(): Promise<void>;
}

export interface ImapMailReaderConfig {
  readonly user: string;
  readonly password: string;
  /** Gmail 標籤名(= IMAP 資料夾名), 例「PCM新品」。 */
  readonly mailbox: string;
  readonly host?: string;
  readonly port?: number;
  /** 測試用:換掉真的連線。 */
  readonly connect?: () => Promise<ImapClientLike>;
}

/** 單一內文部分最多讀多少位元組(use-case 只用前 2,000 字;HTML 要抽圖所以留寬一點)。 */
const PART_MAX_BYTES = 512 * 1024;

export class ImapReadError extends Error {
  readonly code = 'imap_read_failed';
  constructor(reason: string) {
    super(`IMAP 讀信失敗:${reason}`);
    this.name = 'ImapReadError';
  }
}

/** `label:PCM新品 newer_than:3d` ⇒ `newer_than:3d`(資料夾已經是那個標籤)。 */
export function toGmailRaw(query: string): string {
  return query.replace(/(^|\s)label:\S+/g, ' ').replace(/\s+/g, ' ').trim();
}

/** 抓回來的標頭區塊 ⇒ 小寫名稱 → 每一條的值(照信件裡的順序;折行接回一行)。 */
export function parseHeaderBlock(raw: string): Map<string, string[]> {
  const out = new Map<string, string[]>();
  const unfolded = raw.replace(/\r\n/g, '\n').replace(/\n[ \t]+/g, ' ');
  for (const line of unfolded.split('\n')) {
    const i = line.indexOf(':');
    if (i <= 0) continue;
    const name = line.slice(0, i).trim().toLowerCase();
    const list = out.get(name) ?? [];
    list.push(line.slice(i + 1).trim());
    out.set(name, list);
  }
  return out;
}

/** 從信件結構挑第一個 text/plain 與 text/html(附件不算)。單一部分的信沒有 part 編號 ⇒ 用 '1'。 */
export function pickTextParts(node: MessageStructureObject | undefined): { plain?: string; html?: string } {
  const out: { plain?: string; html?: string } = {};
  const walk = (n: MessageStructureObject | undefined, isRoot: boolean) => {
    if (!n) return;
    if (n.childNodes && n.childNodes.length > 0) {
      for (const c of n.childNodes) walk(c, false);
      return;
    }
    if ((n.disposition ?? '').toLowerCase() === 'attachment') return;
    const part = n.part ?? (isRoot ? '1' : undefined);
    if (!part) return;
    const type = (n.type ?? '').toLowerCase();
    if (type === 'text/plain' && out.plain === undefined) out.plain = part;
    if (type === 'text/html' && out.html === undefined) out.html = part;
  };
  walk(node, true);
  return out;
}

async function readAll(stream: Readable | undefined): Promise<string | null> {
  if (!stream) return null;
  const chunks: Buffer[] = [];
  for await (const chunk of stream) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk)));
  return Buffer.concat(chunks).toString('utf8');
}

export class ImapMailReader implements IInboundMailReader {
  private client: ImapClientLike | null = null;
  private readonly uidById = new Map<string, number>();

  constructor(private readonly config: ImapMailReaderConfig) {}

  private async open(): Promise<ImapClientLike> {
    if (this.client) return this.client;
    let client: ImapClientLike;
    try {
      client = this.config.connect
        ? await this.config.connect()
        : await (async () => {
            const c = new ImapFlow({
              host: this.config.host ?? 'imap.gmail.com',
              port: this.config.port ?? 993,
              secure: true,
              auth: { user: this.config.user, pass: this.config.password },
              logger: false,
            });
            await c.connect();
            return c as unknown as ImapClientLike;
          })();
      await client.mailboxOpen(this.config.mailbox, { readOnly: true });
    } catch (error) {
      // 不帶原始訊息(可能含帳號);只說是哪一步
      throw new ImapReadError(`登入或開資料夾失敗(${(error as { code?: unknown } | null)?.code ?? 'unknown'})`);
    }
    this.client = client;
    return client;
  }

  async listMessageIds(input: { query: string; max: number }): Promise<readonly string[]> {
    const client = await this.open();
    const uids = (await client.search({ gmraw: toGmailRaw(input.query) }, { uid: true })) || [];
    const ids: string[] = [];
    // 最新的在前(uid 遞增 = 收信先後)
    for (const uid of [...uids].sort((a, b) => b - a).slice(0, input.max)) {
      const m = await client.fetchOne(String(uid), { emailId: true }, { uid: true });
      if (m && m.emailId) {
        this.uidById.set(m.emailId, uid);
        ids.push(m.emailId);
      }
    }
    return ids;
  }

  async getMessage(id: string): Promise<InboundMailMessage> {
    const client = await this.open();
    let uid = this.uidById.get(id);
    if (uid === undefined) {
      const found = (await client.search({ emailId: id }, { uid: true })) || [];
      uid = found[0];
    }
    if (uid === undefined) throw new ImapReadError('找不到這封');
    const m = await client.fetchOne(
      String(uid),
      { emailId: true, threadId: true, internalDate: true, envelope: true, bodyStructure: true, headers: ['from', 'subject', 'authentication-results'] },
      { uid: true },
    );
    if (!m) throw new ImapReadError('讀不到這封');
    const headers = parseHeaderBlock(m.headers ? m.headers.toString('utf8') : '');
    const parts = pickTextParts(m.bodyStructure);
    const read = async (part: string | undefined) => {
      if (!part) return null;
      const d = (await client.download(String(uid), part, { uid: true, maxBytes: PART_MAX_BYTES })) as { content?: Readable };
      return readAll(d?.content);
    };
    const internal = m.internalDate ? new Date(m.internalDate) : null;
    return {
      id: m.emailId ?? id,
      threadId: m.threadId ?? null,
      from: headers.get('from')?.[0] ?? '',
      // 主旨用 envelope 的(已經解過 =?UTF-8?…?= 編碼);沒有才退回原始標頭
      subject: m.envelope?.subject ?? headers.get('subject')?.[0] ?? null,
      receivedAt: (internal && !Number.isNaN(internal.getTime()) ? internal : new Date()).toISOString(),
      authenticationResults: headers.get('authentication-results') ?? [],
      textBody: await read(parts.plain),
      htmlBody: await read(parts.html),
    };
  }

  /** 一輪結束要關;沒開過就什麼都不做。 */
  async close(): Promise<void> {
    const c = this.client;
    this.client = null;
    if (c) await c.logout().catch(() => undefined);
  }
}
