// CSP 違規回報的解析與讀取上限(給 `app/api/csp-report/route.ts` 用;路由檔不能匯出路由以外的名字)。
// 設計見那支路由的檔頭。

const MAX_BYTES = 8 * 1024;
const SITES = new Set(['www.pcmmotorsports.com', 'b2b.pcmmotorsports.com', 'admin.pcmmotorsports.com']);

export async function readCapped(req: Request): Promise<string | null> {
  if (Number(req.headers.get('content-length') ?? 0) > MAX_BYTES) return null;
  if (!req.body) return null;
  const reader = req.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > MAX_BYTES) {
      await reader.cancel();
      return null;
    }
    chunks.push(value);
  }
  return new TextDecoder().decode(Buffer.concat(chunks));
}

/** `blocked-uri` 只留來源網域;`inline` / `eval` / `data` 這類關鍵字原樣(只收小寫字母與連字號)。 */
function blockedOrigin(raw: unknown): string {
  if (typeof raw !== 'string') return 'unknown';
  try {
    return new URL(raw).origin;
  } catch {
    return /^[a-z-]{1,20}$/.test(raw) ? raw : 'unknown';
  }
}

/** 解析一則回報成要記的那一行;不該記的回 null。 */
export function describeReport(body: string): string | null {
  let report: unknown;
  try {
    report = (JSON.parse(body) as Record<string, unknown>)['csp-report'];
  } catch {
    return null;
  }
  if (!report || typeof report !== 'object') return null;
  const r = report as Record<string, unknown>;
  let page: URL;
  try {
    page = new URL(String(r['document-uri']));
  } catch {
    return null;
  }
  if (!SITES.has(page.hostname)) return null;
  const rawDirective = r['effective-directive'] ?? r['violated-directive'];
  const directive = typeof rawDirective === 'string' && /^[a-z-]{1,40}$/.test(rawDirective.split(' ')[0] ?? '')
    ? rawDirective.split(' ')[0]
    : 'unknown';
  return `[csp] site=${page.hostname} directive=${directive} blocked=${blockedOrigin(r['blocked-uri'])} page=${page.pathname}`;
}
