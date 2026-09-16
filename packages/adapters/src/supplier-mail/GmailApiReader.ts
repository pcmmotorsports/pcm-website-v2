import type { IInboundMailReader, InboundMailMessage } from '@pcm/ports';
import { OUTBOUND_SEND_TIMEOUT_MS } from '../outbound-timeout';

/**
 * GmailApiReader — 用 OAuth refresh token 讀 sean@ 的 Gmail(PRD §12;Sean Q3 甲:只授權 sean@、只要 gmail.readonly)。
 *
 * 🔴 不加新套件:換 access token 與 list / get 都是 fetch。
 * 🔴 不 log 權杖、不 log 信件內容;錯誤只帶 HTTP 狀態碼。
 * ⚠️ 本檔目前沒有真的連過 Gmail(Sean 還沒授權)—— 形狀照 Gmail API v1 文件;接上真授權那天第一件事是跑一輪看回應。
 */

export interface GmailApiReaderConfig {
  readonly clientId: string;
  readonly clientSecret: string;
  readonly refreshToken: string;
  readonly fetchImpl?: typeof fetch;
}

export class GmailAuthError extends Error {
  readonly code = 'gmail_auth_failed';
  constructor(status: number) {
    super(`Gmail 權杖換取失敗(HTTP ${status})⇒ 授權可能失效,整輪停`);
    this.name = 'GmailAuthError';
  }
}

export class GmailApiError extends Error {
  readonly code = 'gmail_api_failed';
  constructor(what: string, status: number) {
    super(`Gmail ${what} 失敗(HTTP ${status})`);
    this.name = 'GmailApiError';
  }
}

const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const API = 'https://gmail.googleapis.com/gmail/v1/users/me';

type GmailPart = {
  mimeType?: string;
  headers?: { name?: string; value?: string }[];
  body?: { data?: string };
  parts?: GmailPart[];
};

function decode(data: string | undefined): string | null {
  return data ? Buffer.from(data, 'base64url').toString('utf8') : null;
}

function findBody(part: GmailPart | undefined, mime: string): string | null {
  if (!part) return null;
  if (part.mimeType === mime && part.body?.data) return decode(part.body.data);
  for (const child of part.parts ?? []) {
    const found = findBody(child, mime);
    if (found !== null) return found;
  }
  return null;
}

export class GmailApiReader implements IInboundMailReader {
  private token: { value: string; expiresAt: number } | null = null;
  private readonly fetchImpl: typeof fetch;

  constructor(private readonly config: GmailApiReaderConfig) {
    this.fetchImpl = config.fetchImpl ?? fetch;
  }

  private async accessToken(): Promise<string> {
    if (this.token && this.token.expiresAt > Date.now() + 60_000) return this.token.value;
    const res = await this.fetchImpl(TOKEN_URL, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: this.config.clientId,
        client_secret: this.config.clientSecret,
        refresh_token: this.config.refreshToken,
        grant_type: 'refresh_token',
      }),
      signal: AbortSignal.timeout(OUTBOUND_SEND_TIMEOUT_MS),
    });
    if (!res.ok) throw new GmailAuthError(res.status);
    const json = (await res.json()) as { access_token?: unknown; expires_in?: unknown };
    if (typeof json.access_token !== 'string') throw new GmailAuthError(res.status);
    const ttl = typeof json.expires_in === 'number' ? json.expires_in : 3600;
    this.token = { value: json.access_token, expiresAt: Date.now() + ttl * 1000 };
    return this.token.value;
  }

  private async get(path: string, what: string): Promise<unknown> {
    const res = await this.fetchImpl(`${API}${path}`, {
      headers: { authorization: `Bearer ${await this.accessToken()}` },
      signal: AbortSignal.timeout(OUTBOUND_SEND_TIMEOUT_MS),
    });
    if (res.status === 401 || res.status === 403) throw new GmailAuthError(res.status);
    if (!res.ok) throw new GmailApiError(what, res.status);
    return res.json();
  }

  async listMessageIds(input: { query: string; max: number }): Promise<readonly string[]> {
    const q = new URLSearchParams({ q: input.query, maxResults: String(input.max) });
    const json = (await this.get(`/messages?${q.toString()}`, 'list')) as { messages?: { id?: unknown }[] };
    return (json.messages ?? []).map((m) => m.id).filter((id): id is string => typeof id === 'string');
  }

  async getMessage(id: string): Promise<InboundMailMessage> {
    const json = (await this.get(`/messages/${encodeURIComponent(id)}?format=full`, 'get')) as {
      id?: string;
      threadId?: string;
      internalDate?: string;
      payload?: GmailPart;
    };
    const headers = json.payload?.headers ?? [];
    const header = (name: string) => headers.filter((h) => h.name?.toLowerCase() === name).map((h) => h.value ?? '');
    const internal = Number(json.internalDate);
    return {
      id: json.id ?? id,
      threadId: json.threadId ?? null,
      from: header('from')[0] ?? '',
      subject: header('subject')[0] ?? null,
      receivedAt: new Date(Number.isFinite(internal) ? internal : Date.now()).toISOString(),
      authenticationResults: header('authentication-results'),
      textBody: findBody(json.payload, 'text/plain'),
      htmlBody: findBody(json.payload, 'text/html'),
    };
  }
}
