import { beforeEach, describe, expect, it, vi } from 'vitest';
import type {
  BannerCopyInput,
  CatalogSkuMatch,
  HomeBannerSystemDraft,
  IBannerCopywriter,
  ICatalogSkuMatcher,
  IInboundMailReader,
  ISupplierNewProductStore,
  InboundMailMessage,
  InboundMailRecord,
  SupplierMailSender,
} from '@pcm/ports';
import {
  SUPPLIER_MAIL_QUERY,
  SUPPLIER_MAIL_TIME_BUDGET_MS,
  authAligned,
  buildLinkPath,
  draftSupplierNewProductBanners,
  extractImages,
  extractSkuCandidates,
  matchSender,
  parseFromAddress,
} from './draft-supplier-newproduct-banners';

/** Gmail 自己寫的那一條(authserv-id = mx.google.com)。 */
const PASS = (d: string) => [`mx.google.com; dkim=pass header.i=@${d} header.s=s1; spf=pass smtp.mailfrom=news@${d}; dmarc=pass (p=NONE) header.from=${d}`];

function msg(over: Partial<InboundMailMessage> & { id: string }): InboundMailMessage {
  return {
    threadId: `t-${over.id}`,
    from: 'Akrapovic <News@Akrapovic.com>',
    subject: 'New Slip-On Line for 2026',
    receivedAt: '2026-09-15T22:12:00.000Z',
    authenticationResults: PASS('akrapovic.com'),
    textBody: null,
    htmlBody: null,
    ...over,
  };
}

const SENDERS: SupplierMailSender[] = [
  { sender: '@akrapovic.com', brandSlugs: ['akrapovic'], rightsPolicy: 'ask_each_time' },
  { sender: 'newsletter@rizoma.com', brandSlugs: ['rizoma'], rightsPolicy: 'allowed' },
  { sender: '@gillestooling.com', brandSlugs: ['gilles'], rightsPolicy: 'not_allowed' },
];

class FakeReader implements IInboundMailReader {
  queries: { query: string; max: number }[] = [];
  constructor(private readonly messages: InboundMailMessage[], private readonly broken: string[] = [], private readonly onGet?: () => void) {}
  async listMessageIds(input: { query: string; max: number }) {
    this.queries.push(input);
    return [...this.messages.map((m) => m.id), ...this.broken];
  }
  async getMessage(id: string) {
    this.onGet?.();
    const m = this.messages.find((x) => x.id === id);
    if (!m) throw new Error('gmail 500');
    return m;
  }
}

class FakeCopywriter implements IBannerCopywriter {
  inputs: BannerCopyInput[] = [];
  constructor(private readonly failFor: string[] = []) {}
  async draft(input: BannerCopyInput) {
    this.inputs.push(input);
    if (this.failFor.includes(input.subject ?? '')) throw new Error('llm down');
    return { eyebrow: 'AKRAPOVIC ‧ 新品到貨', titleLine1: 'Slip-On 鈦合金尾段,', titleLine2: '2026 年式新款到貨', subtitle: null, ctaLabel: '看新品'.repeat(10) };
  }
}

class FakeMatcher implements ICatalogSkuMatcher {
  async match(input: { skus: readonly string[]; brandSlugs: readonly string[] }): Promise<CatalogSkuMatch[]> {
    const catalog: CatalogSkuMatch[] = [
      { variantId: 'v1', sku: 'S-B10SO4-HAPXT', productTitle: 'Slip-On Line 鈦合金尾段', brandSlug: 'akrapovic' },
      { variantId: 'v2', sku: 'S-B10SO4-HAPXC', productTitle: 'Slip-On Line 碳纖維尾段', brandSlug: 'akrapovic' },
    ];
    return catalog.filter((c) => input.skus.includes(c.sku) && input.brandSlugs.includes(c.brandSlug));
  }
}

class FakeStore implements ISupplierNewProductStore {
  records: { record: InboundMailRecord; draft: HomeBannerSystemDraft | null }[] = [];
  constructor(private readonly known: string[] = []) {}
  async knownMessageIds(ids: readonly string[]) {
    return new Set(ids.filter((id) => this.known.includes(id)));
  }
  async record(record: InboundMailRecord, draft: HomeBannerSystemDraft | null) {
    this.records.push({ record, draft });
    return 'recorded' as const;
  }
}

beforeEach(() => {
  vi.spyOn(console, 'warn').mockImplementation(() => {});
});

describe('draftSupplierNewProductBanners(假 Gmail + 假 AI + 假 DB 端到端)', () => {
  const akrapovicHtml =
    '<p>Meet the new Slip-On Line (S-B10SO4-HAPXT / S-B10SO4-HAPXC) for BMW S 1000 RR.</p>' +
    '<img src="https://cdn.akrapovic.com/open/track.gif" width="1" height="1">' +
    '<img src="https://cdn.akrapovic.com/slip-on-2026.jpg" width="1200">' +
    '<img src="https://cdn.akrapovic.com/logo.png" width="200">';

  it('一輪跑完:配到商品 ⇒ drafted;沒在白名單 ⇒ skipped_sender;冒名 ⇒ skipped_auth;已讀過 ⇒ known;讀不到 ⇒ failed', async () => {
    const reader = new FakeReader(
      [
        msg({ id: 'a', htmlBody: akrapovicHtml }),
        msg({ id: 'b', from: 'Random <deals@spam.example>' }),
        msg({ id: 'c', from: 'Akrapovic <news@akrapovic.com>', authenticationResults: ['mx.google.com; dkim=pass header.i=@evil.example; spf=fail smtp.mailfrom=x@evil.example'] }),
        msg({ id: 'd' }),
      ],
      ['broken'],
    );
    const store = new FakeStore(['d']);
    const copywriter = new FakeCopywriter();
    const result = await draftSupplierNewProductBanners({ reader, copywriter, matcher: new FakeMatcher(), store, senders: SENDERS });

    expect(reader.queries).toEqual([{ query: SUPPLIER_MAIL_QUERY, max: 20 }]);
    expect(result).toEqual({ listed: 5, known: 1, skippedSender: 1, skippedAuth: 1, drafted: 1, noProducts: 0, failed: 1, deferred: 0 });

    const a = store.records.find((r) => r.record.gmailMessageId === 'a')!;
    expect(a.record).toMatchObject({ sender: 'news@akrapovic.com', status: 'drafted', authPassed: true, errorCode: null });
    expect(a.record.extracted).toMatchObject({
      matched_skus: ['S-B10SO4-HAPXT', 'S-B10SO4-HAPXC'],
      images: ['https://cdn.akrapovic.com/slip-on-2026.jpg'],
    });
    // 🔴 連結與圖由程式決定;AI 回超長按鈕字被截到 20
    expect(a.draft).toMatchObject({
      linkPath: '/products?pbrands=akrapovic',
      imageDesktopUrl: 'https://cdn.akrapovic.com/slip-on-2026.jpg',
      titleLine1: 'Slip-On 鈦合金尾段,',
      matchedVariantIds: ['v1', 'v2'],
    });
    expect([...(a.draft!.ctaLabel ?? '')]).toHaveLength(20);
    // 🔴 不存內文:記錄裡沒有 body
    expect(JSON.stringify(a.record)).not.toContain('Meet the new');
    expect(copywriter.inputs[0]).toMatchObject({ subject: 'New Slip-On Line for 2026', productTitles: ['Slip-On Line 鈦合金尾段', 'Slip-On Line 碳纖維尾段'] });
    expect(copywriter.inputs[0]!.textExcerpt).not.toContain('<img');

    expect(store.records.find((r) => r.record.gmailMessageId === 'b')).toMatchObject({ record: { status: 'skipped_sender' }, draft: null });
    expect(store.records.find((r) => r.record.gmailMessageId === 'c')).toMatchObject({ record: { status: 'skipped_auth', authPassed: false }, draft: null });
    expect(store.records.some((r) => r.record.gmailMessageId === 'd')).toBe(false);
  });

  it('🔴 R1 M1:信裡自己塞一條假的 dmarc=pass(不是 Gmail 寫的)⇒ skipped_auth、不起草', async () => {
    const forged = msg({
      id: 'forged',
      htmlBody: akrapovicHtml,
      authenticationResults: [
        'mx.google.com; dkim=none; spf=softfail smtp.mailfrom=x@evil.example; dmarc=fail (p=REJECT) header.from=akrapovic.com',
        'x.attacker; dkim=pass header.i=@akrapovic.com; spf=pass smtp.mailfrom=news@akrapovic.com; dmarc=pass header.from=akrapovic.com',
      ],
    });
    const store = new FakeStore();
    const result = await draftSupplierNewProductBanners({ reader: new FakeReader([forged]), copywriter: new FakeCopywriter(), matcher: new FakeMatcher(), store, senders: SENDERS });
    expect(result).toMatchObject({ skippedAuth: 1, drafted: 0 });
    expect(store.records[0]).toMatchObject({ record: { status: 'skipped_auth' }, draft: null });
  });

  it('🔴 R1 M2:顯示名稱裡藏白名單信箱、真寄件者是別人 ⇒ 不當成廠商', async () => {
    const trick = msg({
      id: 'trick',
      from: '"Akrapovic <news@akrapovic.com>" <x@evil.example>',
      htmlBody: akrapovicHtml,
      authenticationResults: ['mx.google.com; dkim=pass header.i=@evil.example; spf=pass smtp.mailfrom=x@evil.example; dmarc=pass header.from=evil.example'],
    });
    const store = new FakeStore();
    const result = await draftSupplierNewProductBanners({ reader: new FakeReader([trick]), copywriter: new FakeCopywriter(), matcher: new FakeMatcher(), store, senders: SENDERS });
    expect(result).toMatchObject({ skippedSender: 1, drafted: 0 });
    expect(store.records[0]!.record.sender).toBe('x@evil.example');
  });

  it('配不到商品 + AI 掛了 ⇒ no_products、標題用主旨、連結放品牌頁、記 copy_fallback', async () => {
    const reader = new FakeReader([msg({ id: 'r', from: 'newsletter@rizoma.com', subject: 'Novità 2026', authenticationResults: PASS('rizoma.com'), textBody: 'Nuovi prodotti' })]);
    const store = new FakeStore();
    const result = await draftSupplierNewProductBanners({ reader, copywriter: new FakeCopywriter(['Novità 2026']), matcher: new FakeMatcher(), store, senders: SENDERS });
    expect(result.noProducts).toBe(1);
    expect(store.records[0]).toMatchObject({
      record: { status: 'no_products', errorCode: 'copy_fallback' },
      draft: { titleLine1: 'Novità 2026', linkPath: '/brands/rizoma', imageDesktopUrl: null },
    });
  });

  it('授權政策 not_allowed ⇒ 草稿不帶圖', async () => {
    const reader = new FakeReader([msg({ id: 'g', from: 'marketing@gillestooling.com', authenticationResults: PASS('gillestooling.com'), htmlBody: '<img src="https://gilles.example/big.jpg" width="1600">' })]);
    const store = new FakeStore();
    await draftSupplierNewProductBanners({ reader, copywriter: new FakeCopywriter(), matcher: new FakeMatcher(), store, senders: SENDERS });
    expect(store.records[0]!.draft!.imageDesktopUrl).toBeNull();
    expect(store.records[0]!.record.extracted).toMatchObject({ images: [] });
  });

  it('寫草稿失敗 ⇒ 記 failed(帶分類碼),不擋下一封', async () => {
    const reader = new FakeReader([msg({ id: 'x', htmlBody: akrapovicHtml }), msg({ id: 'y', from: 'newsletter@rizoma.com', authenticationResults: PASS('rizoma.com'), textBody: 'hi' })]);
    const store = new FakeStore();
    const original = store.record.bind(store);
    store.record = async (record, draft) => {
      if (draft !== null && record.gmailMessageId === 'x') throw Object.assign(new Error('check violation'), { code: '23514' });
      return original(record, draft);
    };
    const result = await draftSupplierNewProductBanners({ reader, copywriter: new FakeCopywriter(), matcher: new FakeMatcher(), store, senders: SENDERS });
    expect(result).toMatchObject({ failed: 1, noProducts: 1 });
    expect(store.records.find((r) => r.record.gmailMessageId === 'x')!.record).toMatchObject({ status: 'failed', errorCode: '23514' });
  });

  it('🔴 R1 C2:超過 45 秒不再開始新的一封,剩下的算 deferred', async () => {
    let clock = 0;
    const reader = new FakeReader(
      [msg({ id: '1', textBody: 'a' }), msg({ id: '2', textBody: 'b' }), msg({ id: '3', textBody: 'c' })],
      [],
      () => { clock += SUPPLIER_MAIL_TIME_BUDGET_MS + 1; },
    );
    const store = new FakeStore();
    const result = await draftSupplierNewProductBanners({ reader, copywriter: new FakeCopywriter(), matcher: new FakeMatcher(), store, senders: SENDERS, now: () => clock });
    expect(result).toMatchObject({ listed: 3, noProducts: 1, deferred: 2 });
  });

  it('列信失敗(權杖失效)⇒ 整輪 throw', async () => {
    const reader: IInboundMailReader = { listMessageIds: async () => { throw new Error('invalid_grant'); }, getMessage: async () => { throw new Error('x'); } };
    await expect(draftSupplierNewProductBanners({ reader, copywriter: new FakeCopywriter(), matcher: new FakeMatcher(), store: new FakeStore(), senders: SENDERS })).rejects.toThrow('invalid_grant');
  });
});

describe('純函式', () => {
  it('parseFromAddress:取最後一個角括號(顯示名稱裡的不算)', () => {
    expect(parseFromAddress('Akrapovic <News@Akrapovic.com>')).toBe('news@akrapovic.com');
    expect(parseFromAddress('news@rizoma.com')).toBe('news@rizoma.com');
    expect(parseFromAddress('"Akrapovic <news@akrapovic.com>" <x@evil.example>')).toBe('x@evil.example');
    expect(parseFromAddress('no address')).toBeNull();
  });

  it('matchSender:@網域只認那個網域本身', () => {
    expect(matchSender(SENDERS, 'news@akrapovic.com')?.brandSlugs).toEqual(['akrapovic']);
    expect(matchSender(SENDERS, 'x@mail.akrapovic.com')).toBeNull();
    expect(matchSender(SENDERS, 'other@rizoma.com')).toBeNull();
  });

  it('authAligned:只信 mx.google.com 那條;header.from 對不上就不過;別的網域簽的 DKIM 不算', () => {
    expect(authAligned(PASS('akrapovic.com'), 'akrapovic.com')).toBe(true);
    expect(authAligned(['mx.google.com; dkim=pass header.d=mail.akrapovic.com'], 'akrapovic.com')).toBe(true);
    expect(authAligned(['x.attacker; dmarc=pass header.from=akrapovic.com'], 'akrapovic.com')).toBe(false);
    expect(authAligned(['mx.google.com; dkim=pass header.i=@akrapovic.com; dmarc=pass header.from=evil.example'], 'akrapovic.com')).toBe(false);
    expect(authAligned(['mx.google.com; dkim=pass header.i=@evil.example; dmarc=fail header.from=akrapovic.com'], 'akrapovic.com')).toBe(false);
    expect(authAligned([], 'akrapovic.com')).toBe(false);
  });

  it('🔴 R2 K1 / K2:兩條 mx.google.com、驗證結果裡有引號、兩個 dmarc 片段 ⇒ 一律不過', () => {
    expect(authAligned([...PASS('akrapovic.com'), ...PASS('akrapovic.com')], 'akrapovic.com')).toBe(false);
    expect(
      authAligned(['mx.google.com; spf=pass smtp.mailfrom="x;dmarc=pass header.from=akrapovic.com z"@evil.example; dmarc=fail header.from=evil.example'], 'akrapovic.com'),
    ).toBe(false);
    expect(authAligned(['mx.google.com; dmarc=pass header.from=akrapovic.com; dmarc=fail header.from=akrapovic.com'], 'akrapovic.com')).toBe(false);
  });

  it('extractImages / extractSkuCandidates / buildLinkPath', () => {
    expect(extractImages('<img src="http://a/b.jpg" width="900"><img src=\'https://a/c.jpg\'>')).toEqual(['https://a/c.jpg']);
    expect(extractImages(`<img src="https://a/${'x'.repeat(2100)}.jpg">`)).toEqual([]);
    expect(extractSkuCandidates('Code s-b10so4-hapxt and 2026-09 and ABC-DEF')).toEqual(['s-b10so4-hapxt', 'S-B10SO4-HAPXT', '2026-09']);
    expect(buildLinkPath([], ['a', 'b'])).toBeNull();
    expect(buildLinkPath([{ variantId: 'v', sku: 's', productTitle: 't', brandSlug: 'bad slug' }], ['x'])).toBeNull();
  });
});
