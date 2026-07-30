/**
 * D1t2:隔離演練庫的 cohort 假資料產生器 —— 印 SQL 到 stdout,由 psql 執行(與 d1-export 同構)。
 *
 * 造出與正式站 cohort **逐格同筆數**的資料(D1a2 v2 口徑):
 *   orders 29(= D1_COHORT 的真 UUID + display_id,守門的 29 組配對才會過)/ order_items 39
 *   / order_legal_consents 4 / payment_charge_attempts 27(delete 側 failed 12 + released 9
 *   + pending 3;retained 側 charged 3)/ pending_invoices 3(全屬留存)
 *   / customers 2 / customer_addresses 3 / products 10 / product_variants 10 / legal_terms_versions 2。
 *
 * 🔴 六筆 read-back 事實的釘死值(judgeReadback 的前置斷言會驗):
 *   0101 = NT$2,400 / unpaid / rec NULL(NO_KEY_ORDER_EXPECTED 逐字);
 *   其餘五筆 rec = REC<單號後四碼>、金額見下表 —— readback fixture 必須與這裡一致。
 *
 * 🔴 auth.users 先 DISABLE TRIGGER 再插(`handle_new_auth_user` AFTER INSERT 會自建 customers,
 *   與顯式 customers 假資料撞 PK;Fable R3-F1 / D1a6 實證),插完 ENABLE 回來。
 */
import { D1_COHORT, D1_DELETE_COHORT, D1_RETAIN_COHORT } from './d1-cohort';

/** 六筆 read-back 對象的金額(整數元位;fixture 同源)。 */
export const READBACK_AMOUNTS: Readonly<Record<string, number>> = {
  'PCM-2026-0052': 5100,
  'PCM-2026-0064': 2400,
  'PCM-2026-0090': 1800,
  'PCM-2026-0101': 2400,
  'PCM-2026-0102': 101,
  'PCM-2026-0104': 5100,
};

export const RETAINED_REC = { 'PCM-2026-0052': 'REC0052', 'PCM-2026-0102': 'REC0102', 'PCM-2026-0104': 'REC0104' } as const;
const PENDING_REC: Readonly<Record<string, string | null>> = {
  'PCM-2026-0064': 'REC0064',
  'PCM-2026-0090': 'REC0090',
  'PCM-2026-0101': null,
};

const U1 = '11111111-1111-4111-8111-111111111111';
const U2 = '22222222-2222-4222-8222-222222222222';
/** 非 cohort 誘餌訂單(固定 UUID;harness 逐列比對跑前後)。 */
export const NON_COHORT_ORDER_IDS = [
  'aaaaaaaa-0000-4000-8000-000000000001',
  'aaaaaaaa-0000-4000-8000-000000000002',
] as const;
const hex = (n: number) => n.toString(16).padStart(4, '0').repeat(16);

export function buildSeedScript(): string {
  const lines: string[] = ['BEGIN;'];

  // 父表:users(trigger off)→ customers → addresses → products/variants → terms。
  lines.push('ALTER TABLE auth.users DISABLE TRIGGER ALL;');
  lines.push(`INSERT INTO auth.users (id, email, raw_user_meta_data) VALUES ('${U1}', 'drill-1@example.com', '{}'), ('${U2}', 'drill-2@example.com', '{}');`);
  lines.push('ALTER TABLE auth.users ENABLE TRIGGER ALL;');
  lines.push(`INSERT INTO public.customers (user_id, email) VALUES ('${U1}', 'drill-1@example.com'), ('${U2}', 'drill-2@example.com');`);
  lines.push(`INSERT INTO public.customer_addresses (customer_user_id, name, line) VALUES ('${U1}', '演練一', '演練地址 1'), ('${U1}', '演練二', '演練地址 2'), ('${U2}', '演練三', '演練地址 3');`);
  lines.push(`INSERT INTO public.brands (name, slug) VALUES ('演練品牌', 'drill-brand');`);
  lines.push(`INSERT INTO public.categories (name, raw_path, segments) VALUES ('演練分類', '演練分類', '["演練分類"]');`);
  for (let i = 1; i <= 10; i += 1) {
    lines.push(`INSERT INTO public.products (external_id, title, handle, price_by_tier, brand_id, category_id) SELECT 'drill-p${i}', '演練商品 ${i}', 'drill-p${i}', '{"general": 100, "store": 100, "premiumStore": 100}', b.id, c.id FROM public.brands b, public.categories c WHERE b.slug = 'drill-brand' AND c.raw_path = '演練分類';`);
  }
  for (let i = 1; i <= 10; i += 1) {
    lines.push(`INSERT INTO public.product_variants (product_id, sku) SELECT id, 'drill-v${i}' FROM public.products WHERE external_id = 'drill-p${i}';`);
  }
  // legal_terms_versions 由 migration 自 seed(2026-06-30 / 2026-07-24 兩版,共 2 筆 = production 口徑);
  // 不另插,consents 直接引用既有版本。

  // orders 29(cohort 真 UUID/display_id;trigger 會覆寫運送快照 —— 演練不驗快照忠實度,放行)。
  const retainedIds = new Set<string>(D1_RETAIN_COHORT.map(({ displayId }) => displayId));
  for (const [i, { id, displayId }] of D1_COHORT.entries()) {
    const retained = retainedIds.has(displayId);
    const total = READBACK_AMOUNTS[displayId] ?? 1000 + i;
    const user = i % 2 === 0 ? U1 : U2;
    const rec = retained ? `'${RETAINED_REC[displayId as keyof typeof RETAINED_REC]}'` : 'NULL';
    lines.push(
      `INSERT INTO public.orders (id, display_id, customer_user_id, shipping_address_snapshot, tier_at_checkout, payment_status, subtotal, shipping_fee, discount_total, total, shipping_method, invoice, tappay_rec_trade_id, paid_at) VALUES ` +
        `('${id}', '${displayId}', '${user}', '{"name":"演練","phone":"0900000000","line":"演練地址"}', 'general', '${retained ? 'paid' : 'unpaid'}', ${total}, 0, 0, ${total}, 'home', '{"type":"personal"}', ${rec}, ${retained ? 'now()' : 'NULL'});`,
    );
  }

  // order_items 39 = delete 36(前 10 張各 2 + 其餘 16 張各 1)+ retained 3(各 1)。
  let variant = 0;
  const item = (orderId: string) => {
    variant = (variant % 10) + 1;
    return `INSERT INTO public.order_items (order_id, variant_id, variant_sku, product_snapshot, quantity, unit_price, line_total) SELECT '${orderId}', v.id, v.sku, '{"title":"演練商品","sku":"drill","spec":{}}', 1, 100, 100 FROM public.product_variants v WHERE v.sku = 'drill-v${variant}';`;
  };
  D1_DELETE_COHORT.forEach(({ id }, i) => {
    lines.push(item(id));
    if (i < 10) lines.push(item(id));
  });
  for (const { id } of D1_RETAIN_COHORT) lines.push(item(id));

  // consents 4 = delete 2(0064/0090)+ retained 2(0052/0102)。
  for (const d of ['PCM-2026-0064', 'PCM-2026-0090', 'PCM-2026-0052', 'PCM-2026-0102']) {
    const { id } = D1_COHORT.find((o) => o.displayId === d)!;
    lines.push(`INSERT INTO public.order_legal_consents (order_id, terms_version) VALUES ('${id}', '2026-06-30');`);
  }

  // attempts 27:retained 3 charged;pending 3(0064/0090/0101);failed 12 + released 9 攤在其餘 23 張。
  let seq = 0;
  const attempt = (orderId: string, user: string, status: string, rec: string | null) => {
    seq += 1;
    return `INSERT INTO public.payment_charge_attempts (order_id, customer_user_id, status, rec_trade_id, fallback_token_hash) VALUES ('${orderId}', '${user}', '${status}', ${rec ? `'${rec}'` : 'NULL'}, '${hex(seq)}');`;
  };
  for (const { id, displayId } of D1_RETAIN_COHORT) {
    lines.push(attempt(id, U1, 'charged', RETAINED_REC[displayId as keyof typeof RETAINED_REC]));
  }
  const pendingIds = new Set(Object.keys(PENDING_REC));
  for (const d of pendingIds) {
    const { id } = D1_COHORT.find((o) => o.displayId === d)!;
    lines.push(attempt(id, U2, 'pending', PENDING_REC[d]!));
  }
  const others = D1_DELETE_COHORT.filter(({ displayId }) => !pendingIds.has(displayId));
  others.slice(0, 12).forEach(({ id }) => lines.push(attempt(id, U1, 'failed', null)));
  others.slice(12, 21).forEach(({ id }) => lines.push(attempt(id, U2, 'released', null)));

  // pending_invoices 3(全屬留存、status pending)。
  for (const { id } of D1_RETAIN_COHORT) {
    lines.push(`INSERT INTO public.pending_invoices (order_id, status) VALUES ('${id}', 'pending');`);
  }

  // 🔴 非 cohort 誘餌(codex K2:seed 只有 29 張 cohort 的話,「全表 DELETE」這類回歸
  //    三段照樣綠)。兩張固定 UUID 的旁觀訂單 + 各一筆子列/發票/outbox,
  //    D1 全程一列都不准動 —— harness 以逐列摘要跑前後比對。
  for (const [i, ncId] of NON_COHORT_ORDER_IDS.entries()) {
    lines.push(
      `INSERT INTO public.orders (id, display_id, customer_user_id, shipping_address_snapshot, tier_at_checkout, payment_status, subtotal, shipping_fee, discount_total, total, shipping_method, invoice, paid_at) VALUES ` +
        `('${ncId}', 'PCM-2026-9${90 + i}0', '${i === 0 ? U1 : U2}', '{"name":"旁觀","phone":"0900000001","line":"旁觀地址"}', 'general', 'paid', 777, 0, 0, 777, 'home', '{"type":"personal"}', now());`,
    );
    lines.push(item(ncId));
  }
  lines.push(attempt(NON_COHORT_ORDER_IDS[0]!, U1, 'charged', 'REC-NC-1'));
  lines.push(`INSERT INTO public.pending_invoices (order_id, status) VALUES ('${NON_COHORT_ORDER_IDS[0]}', 'pending');`);
  lines.push(`INSERT INTO public.order_legal_consents (order_id, terms_version) VALUES ('${NON_COHORT_ORDER_IDS[1]}', (SELECT version FROM public.legal_terms_versions ORDER BY version LIMIT 1));`);
  lines.push(
    `INSERT INTO public.email_outbox (event_type, order_id, dedup_key, recipient_email, subject, payload) VALUES ('order_created', '${NON_COHORT_ORDER_IDS[0]}', '${NON_COHORT_ORDER_IDS[0]}', 'drill-1@example.com', '演練誘餌信', '{}');`,
  );

  lines.push('COMMIT;');
  lines.push(String.raw`\echo seed 完成:orders 29 / items 39 / consents 4 / attempts 27 / invoices 3`);
  return lines.join('\n');
}

/**
 * readback fixture 產生(rehearsal 專用):
 * - happy:五筆全命中(0052/0102/0104 = 全額退 status 3;0064/0090 = -1/5)→ 段 A 覆蓋 refund-confirmed;
 * - no-hit-0052:0052 零命中 → 段 C 覆蓋 keep-original 合法出口(Fable R3-F4);
 * - no-hit-0102:0102 零命中 → 段 B 負向(必 abort)。
 * merchant 基準 = fixture 自帶宣告(形狀紀律、非身分證明)。
 */
export function buildFixture(variant: 'happy' | 'no-hit-0052' | 'no-hit-0102'): string {
  const MERCHANT = 'drill-merchant';
  const uuidOf = (d: string) => D1_COHORT.find((o) => o.displayId === d)!.id;
  const hit = (d: string, rec: string, recordStatus: number) => ({
    status: 0,
    msg: '',
    number_of_transactions: 1,
    trade_records: [
      {
        rec_trade_id: rec,
        order_number: uuidOf(d),
        merchant_id: MERCHANT,
        // #301:全額退款後 amount 歸 0、原額在 original_amount(真實 Record API 形狀)。
        amount: recordStatus === 3 ? 0 : READBACK_AMOUNTS[d],
        original_amount: READBACK_AMOUNTS[d],
        currency: 'TWD',
        record_status: recordStatus,
        is_captured: recordStatus !== 3, // 實測:已退款筆 is_captured=false(原本寫反了)
        refunded_amount: recordStatus === 3 ? READBACK_AMOUNTS[d] : 0,
        time: 1753000000000,
      },
    ],
  });
  const noHit = { status: 2, msg: '', number_of_transactions: 0 };
  const responses: Record<string, unknown> = {
    'PCM-2026-0052': variant === 'no-hit-0052' ? noHit : hit('PCM-2026-0052', 'REC0052', 3),
    'PCM-2026-0102': variant === 'no-hit-0102' ? noHit : hit('PCM-2026-0102', 'REC0102', 3),
    'PCM-2026-0104': hit('PCM-2026-0104', 'REC0104', 3),
    'PCM-2026-0064': hit('PCM-2026-0064', 'REC0064', 5),
    'PCM-2026-0090': hit('PCM-2026-0090', 'REC0090', -1),
  };
  return JSON.stringify({ merchantId: MERCHANT, responses }, null, 2);
}

if (process.argv[1]?.endsWith('d1t2-seed.ts')) {
  const [, , mode, variant] = process.argv;
  if (mode === '--fixture') {
    if (variant !== 'happy' && variant !== 'no-hit-0052' && variant !== 'no-hit-0102') {
      console.error('用法:d1t2-seed.ts --fixture happy|no-hit-0052|no-hit-0102');
      process.exit(2);
    }
    console.log(buildFixture(variant));
  } else {
    console.log(buildSeedScript());
  }
}
