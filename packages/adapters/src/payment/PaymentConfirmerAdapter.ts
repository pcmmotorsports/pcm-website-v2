/**
 * @module @pcm/adapters/payment/PaymentConfirmerAdapter — payment_confirmer 窄權 confirm RPC 實作(M-3 階段②-②b)
 *
 * **🔴 server-only + 走 @pcm/adapters/server subpath**(非 root barrel):
 * - 持 `PAYMENT_CONFIRMER_DB_URL`(raw DB credential、敏感度 ≥ service_role)→ 結構守門 = eslint
 *   no-restricted-imports 擋全 storefront import @pcm/adapters/server、只剩 composition root 唯一受控門。
 * - `pg`(node-postgres)只在本 subpath import → 不污染 root barrel 的 tree-shaking(lib/products.ts 零 pg)。
 *
 * **連線模型(2026-06-12 實測修正、原「直連 5432」作廢)**:
 * - **走 Supabase session pooler**(`aws-1-<region>.pooler.supabase.com:5432`、user `payment_confirmer.<ref>`);
 *   原「pg 直連 5432」**行不通**=直連 host `db.<ref>.supabase.co` 為 **IPv6-only**(無 A record)、本機 + Vercel(IPv4)
 *   皆 ENOTFOUND。先前「pooler 呼 SECDEF 必斷」是 **MCP + SET ROLE** 情境;本 adapter **直接以 payment_confirmer
 *   登入(無 SET ROLE)**、實測 session pooler 呼 confirm SECDEF 正常(不斷線)。
 * - **完整 CA 驗證 + host 釘死 + 顯式 servername**:`ssl:{ca:Supabase Root 2021 CA, rejectUnauthorized:true, servername:host}`
 *   (verify-full:完整鏈 + hostname、防 MITM);pooler 憑證 SAN `*.pooler.supabase.com` 涵蓋 host。
 *   🔴 連線字串解析成**離散欄位** + **剝除 SSL query 參數**(見 `buildPgConfig`):不可同時傳 connectionString +
 *   ssl 物件(pg 8.21 連線字串 sslmode 會覆蓋/弱化 ssl 物件、實測 bogus CA + sslmode=no-verify 竟連上);
 *   故 adapter **唯一**指定 ssl、連線字串 sslmode 不參與、無法弱化(負向測試:bogus CA 必被擋)。
 *   🔴 **host 釘死 pooler DNS**(`POOLER_HOST_RE`、非 IP/非空)+ **顯式 servername=host**:pg 只對 DNS host 設
 *   servername、IP host 會使 hostname 驗證未強制 → 釘死 + 顯式 servername 令 verify-full 對所有輸入真成立(MITM 縱深)。
 * - per-request `new Client()` + `finally end()`(Edge Function 持久連線池方案明記 Phase 2);
 *   `connectionTimeoutMillis` + `query_timeout` 防卡。
 *
 * **失敗分類(SHOULD ③、孤兒契約縱深)**:
 * - SQLSTATE P0001(confirm RPC 業務 RAISE)→ `PaymentConfirmError('rejected')`(孤兒、不重 charge/confirm)。
 * - 其餘(連線拒/timeout/語句取消/未連上/回應格式異常)→ `PaymentConfirmError('unreachable')`(可重呼 confirm 冪等)。
 * - 🔴 PF-E:不轉傳 pg 原始 message(通用訊息、不洩內部狀態/total)。
 *
 * @see docs/specs/2026-06-12-m3-stage2-2-tappay-adapter-plan.md §3/§6
 * @see packages/ports/src/IPaymentConfirmer.ts
 * @see supabase/migrations/20260611120000_m3_s2c_confirm_payment_rpc.sql
 */
import 'server-only';

import { isIP } from 'node:net';
import { Client } from 'pg';
import type { IPaymentConfirmer } from '@pcm/ports';
import type { ConfirmOrderPaymentInput, ConfirmOrderPaymentResult, OrderId } from '@pcm/domain';
import { PaymentConfirmError } from '@pcm/domain';
import { SUPABASE_ROOT_CA_2021 } from './supabase-ca';

/** pg Client 最小介面(可注 fake、單元測不開真連線)。 */
export type PgClientLike = {
  connect(): Promise<void>;
  query(text: string, values: unknown[]): Promise<{ rows: Array<Record<string, unknown>> }>;
  end(): Promise<void>;
};

/** SQLSTATE:plpgsql `RAISE EXCEPTION` 預設碼(confirm RPC 業務拒絕走此)。 */
const PG_RAISE_EXCEPTION = 'P0001';

/** 連線字串中所有 SSL 相關 query 參數(剝除、不讓其影響 adapter 強制的 CA 驗證)。 */
const SSL_URL_PARAMS = ['sslmode', 'ssl', 'sslcert', 'sslkey', 'sslrootcert', 'uselibpqcompat'];

/**
 * Supabase session pooler host allowlist(`aws-<N>-<region>.pooler.supabase.com`)。
 * 🔴 host 釘死 DNS pooler 網域 = MITM 縱深:pg 只對 DNS host(`net.isIP(host)===0`)設 TLS servername、
 * IP/非-pooler host 會使 hostname 驗證未強制(verify-full 對 IP 不成立);故 adapter 強制 host 為此格式 +
 * 顯式 ssl.servername=host,verify-full(完整鏈 + hostname)對所有輸入真成立。憑證 SAN=`*.pooler.supabase.com`。
 */
const POOLER_HOST_RE = /^aws-\d+-[a-z0-9-]+\.pooler\.supabase\.com$/;

/**
 * 解析連線字串為**離散欄位** + 強制 CA 驗證(M-3 階段②-②b-fix、codex 關卡2 修正)。
 *
 * 🔴 **不可把 connectionString 與 ssl 物件同時丟給 pg Client**:實測 pg 8.21 會把連線字串的
 * `sslmode` 解析後**覆蓋/擠掉** adapter 的 ssl 物件(`sslmode=no-verify`→rejectUnauthorized:false、
 * `sslmode=disable`→TLS 全關、`sslmode=require`→丟失內嵌 CA)→ 弱化/關閉驗證(反向測試:bogus CA
 * + connectionString sslmode=no-verify 竟連上 = 沒驗證)。
 *
 * 故:URL 解析成 host/port/database/user/password、**剝除所有 SSL query 參數**(`SSL_URL_PARAMS`),
 * adapter **唯一指定** `ssl:{ca,rejectUnauthorized:true,servername:host}`;連線字串的 sslmode 設什麼
 * (no-verify/disable/require/省略)都不參與、無法弱化。
 *
 * 🔴 **host 釘死 pooler DNS + 顯式 servername**(MITM 縱深):host 必為 Supabase session pooler 網域
 * (`POOLER_HOST_RE`)、非 IP literal、非空,否則 throw(由 confirm() try 接 → unreachable、設定層、非孤兒)。
 * 因 pg 只對 DNS host 設 TLS servername、IP host 會使 hostname 驗證未強制 → 釘死 DNS host + 顯式 servername=host
 * 令 verify-full(完整鏈 + hostname)對所有輸入真成立(非僅文件宣稱)。throw 用通用訊息、不洩連線字串內容(PF-E)。
 */
export function buildPgConfig(connectionString: string) {
  const u = new URL(connectionString);
  const host = u.hostname;
  // 🔴 host allowlist(MITM 縱深):非空 + 非 IP literal(pg 不對 IP 設 servername)+ Supabase pooler 網域。
  //    通用訊息、不洩連線字串內容(PF-E)。
  if (!host || isIP(host) !== 0 || !POOLER_HOST_RE.test(host)) {
    throw new Error('payment_confirmer 連線設定無效(host 非 Supabase pooler 網域)');
  }
  const stripped = SSL_URL_PARAMS.filter((p) => u.searchParams.has(p));
  if (stripped.length > 0) {
    // 誠實揭示:連線字串帶了 SSL 參數但被剝除(adapter 端硬性 CA 驗證、不採信連線字串)。
    console.info('[PaymentConfirmerAdapter] 連線字串 SSL 參數已剝除(adapter 強制 CA 驗證):', stripped);
  }
  return {
    host,
    port: u.port ? Number(u.port) : 5432,
    database: u.pathname.replace(/^\//, '') || 'postgres',
    user: decodeURIComponent(u.username),
    password: decodeURIComponent(u.password),
    // 🔴 顯式 servername=host(已釘死 pooler DNS)→ hostname 驗證不依賴 pg 隱式 IP 判斷;belt-and-suspenders。
    ssl: { ca: SUPABASE_ROOT_CA_2021, rejectUnauthorized: true, servername: host },
    connectionTimeoutMillis: 8000,
    // query_timeout(12s)> 伺服器 statement_timeout(8s)→ 令伺服器端先 timeout(語句取消會 rollback、可重試)。
    query_timeout: 12000,
  };
}

/** 預設 pg client factory:離散欄位(剝 SSL 參數)+ adapter 強制 CA 驗證(見 buildPgConfig)。 */
function defaultClientFactory(connectionString: string): PgClientLike {
  return new Client(buildPgConfig(connectionString)) as unknown as PgClientLike;
}

export class PaymentConfirmerAdapter implements IPaymentConfirmer {
  constructor(
    private readonly connectionString: string,
    private readonly clientFactory: (
      connectionString: string,
    ) => PgClientLike = defaultClientFactory,
  ) {}

  async confirm(input: ConfirmOrderPaymentInput): Promise<ConfirmOrderPaymentResult> {
    // 🔴 clientFactory(內含 buildPgConfig)納入 try:壞連線字串(URL parse / percent-decode / port)throw
    //    → classifyPgError 歸 unreachable(設定/連線層失敗、可重 confirm、勿重 charge),非誤映 confirm_rejected。
    let client: PgClientLike | undefined;
    try {
      client = this.clientFactory(this.connectionString);
      await client.connect();
      const res = await client.query(
        'SELECT public.confirm_order_payment($1::uuid, $2::integer, $3::text) AS result',
        // 🔴 鐵則 12:p_amount = server read-back orders.total 整數(amount.amount、無浮點);client 永不送價。
        [input.orderId, input.amount.amount, input.recTradeId],
      );
      return parseConfirmResult(res.rows);
    } catch (err) {
      throw classifyPgError(err);
    } finally {
      // 🔴 SHOULD ③:finally 永遠釋放連線(client 未建〔buildPgConfig throw〕則跳過;end() 也可能 throw、吞掉不掩蓋主錯誤)。
      if (client) {
        try {
          await client.end();
        } catch {
          /* swallow: 連線已斷時 end 可能 throw、不蓋過 confirm 的真實結果/錯誤 */
        }
      }
    }
  }

  /**
   * M-3 3DS-1b:成交(paid)點冪等記「該單待開票」(record_pending_invoice RPC、S1=B、master plan §5)。
   *
   * 回 `true`=首記 / `false`=重入 no-op;失敗 → throw `PaymentConfirmError`(settleCharge best-effort 接、不翻 paid)。
   * 同 confirm 的連線縱深(buildPgConfig CA 驗證 + per-request end);PF-E:不轉傳 pg 原文。
   */
  async recordPendingInvoice(orderId: OrderId): Promise<boolean> {
    let client: PgClientLike | undefined;
    try {
      client = this.clientFactory(this.connectionString);
      await client.connect();
      const res = await client.query(
        'SELECT public.record_pending_invoice($1::uuid) AS result',
        [orderId],
      );
      return parsePendingInvoiceResult(res.rows);
    } catch (err) {
      throw classifyPgError(err);
    } finally {
      if (client) {
        try {
          await client.end();
        } catch {
          /* swallow: 連線已斷時 end 可能 throw、不蓋過真實結果/錯誤 */
        }
      }
    }
  }
}

/** 解析 confirm RPC 回的 jsonb `{confirmed, idempotent}`;形狀不符 → unreachable(可重 confirm 不重 charge)。 */
function parseConfirmResult(
  rows: Array<Record<string, unknown>>,
): ConfirmOrderPaymentResult {
  const result = rows[0]?.result as { confirmed?: unknown; idempotent?: unknown } | undefined;
  if (!result || typeof result.confirmed !== 'boolean' || typeof result.idempotent !== 'boolean') {
    throw new PaymentConfirmError('unreachable', 'confirm RPC 回應格式異常');
  }
  return { confirmed: result.confirmed, idempotent: result.idempotent };
}

/** 解析 record_pending_invoice RPC 回的 boolean(inserted);形狀不符 → unreachable。 */
function parsePendingInvoiceResult(rows: Array<Record<string, unknown>>): boolean {
  const result = rows[0]?.result;
  if (typeof result !== 'boolean') {
    throw new PaymentConfirmError('unreachable', 'record_pending_invoice 回應格式異常');
  }
  return result;
}

/**
 * 分類 pg 錯誤(SHOULD ③):P0001(RPC RAISE 業務拒絕)→ rejected;其餘 → unreachable。
 * parseConfirmResult 已 throw 的 PaymentConfirmError 原樣傳遞。
 */
function classifyPgError(err: unknown): PaymentConfirmError {
  if (err instanceof PaymentConfirmError) {
    return err;
  }
  const code = (err as { code?: unknown } | null)?.code;
  if (code === PG_RAISE_EXCEPTION) {
    return new PaymentConfirmError('rejected', '付款確認被拒(業務規則)');
  }
  return new PaymentConfirmError('unreachable', '付款確認連線失敗(可重試)');
}
