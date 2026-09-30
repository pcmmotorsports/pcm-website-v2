import { describe, expect, it } from 'vitest';
import type { AdminAuditLogRow } from '../audit/types';
import { PRODUCT_HISTORY_ACTIONS, productHistoryTarget, toProductHistoryRows } from './product-history';

// product-history.test.ts — 商品頁「最近的變更」(商品編輯計畫片 9;Sean C4 甲:全員可改、留變更紀錄)。
// 守:每一列講得出【誰、什麼時候、哪個欄位、原本 → 改成】,而且「還原成供應商的」看得出來。

function log(over: Partial<AdminAuditLogRow>): AdminAuditLogRow {
  return {
    id: 'a-1',
    actor: 'staff:mei',
    actor_label: '小美',
    actor_is_manager: false,
    action: 'product.override.change',
    target: 'product:p-1',
    before: { field: 'title', value: null },
    after: { field: 'title', value: '我們的標題' },
    reason: null,
    request_id: 'r-1',
    source_app: 'admin',
    created_at: '2026-09-27T02:12:00Z',
    ...over,
  };
}

describe('查詢條件', () => {
  it('target 格式 = product:<id>(與兩支 RPC 寫入的一致)', () => {
    expect(productHistoryTarget('p-1')).toBe('product:p-1');
  });
  it('只讀商品頁會改的四種動作(商品頁乙 C4 加分類、P8 加價格)', () => {
    expect([...PRODUCT_HISTORY_ACTIONS].sort()).toEqual([
      'product.category.change',
      'product.listing.change',
      'product.override.change',
      'product.price.change',
    ]);
  });
});

describe('toProductHistoryRows', () => {
  it('改標題:時間走台北、誰用快照名字、欄位中文、原本是供應商的', () => {
    expect(toProductHistoryRows([log({})], [])).toEqual([
      // 時間格式 = 後台共用的 formatOrderDateTime(「操作紀錄」頁同一支),UTC 02:12 = 台北 10:12
      { id: 'a-1', at: '2026-09-27 10:12', actor: '小美', field: '標題', from: '(用供應商的)', to: '我們的標題' },
    ]);
  });

  it('還原成供應商的 ⇒ 改成那一格看得出來', () => {
    const [r] = toProductHistoryRows(
      [log({ before: { field: 'subtitle', value: '我們的副標' }, after: { field: 'subtitle', value: null } })],
      [],
    );
    expect(r).toMatchObject({ field: '副標', from: '我們的副標', to: '(用供應商的)' });
  });

  it('賣點是陣列 ⇒ 每點一行', () => {
    const [r] = toProductHistoryRows(
      [log({ before: { field: 'highlights', value: null }, after: { field: 'highlights', value: ['輕量', '好裝'] } })],
      [],
    );
    expect(r).toMatchObject({ field: '賣點', to: '輕量\n好裝' });
  });

  it('上下架:原本 → 改成 用「上架中 / 已下架」', () => {
    const [r] = toProductHistoryRows(
      [
        log({
          action: 'product.listing.change',
          before: { delisted_at: null, listing_set_by: 'sync' },
          after: { delisted_at: '2026-09-27T02:12:00Z', listing_set_by: 'staff' },
        }),
      ],
      [],
    );
    expect(r).toMatchObject({ field: '上架狀態', from: '上架中', to: '已下架' });
  });

  it('管理者加尾綴;快照沒有名字就查名單;名單也查無 ⇒ 講出來, 不印成空白', () => {
    const rows = toProductHistoryRows(
      [
        log({ id: '1', actor_is_manager: true }),
        log({ id: '2', actor_label: null, actor: 'staff:ken' }),
        log({ id: '3', actor_label: null, actor: 'staff:gone' }),
      ],
      [{ id: 'staff:ken', label: '阿肯' } as never],
    );
    expect(rows.map((r) => r.actor)).toEqual(['小美(管理者)', '阿肯', 'staff:gone(查無此員工)']);
  });

  it('紀錄格式不認得 ⇒ 不猜, 請員工到操作紀錄看', () => {
    const [r] = toProductHistoryRows([log({ before: 'x', after: 'y' })], []);
    expect(r).toMatchObject({ field: '修改商品文字', from: '—', to: '格式不同，請到「操作紀錄」查看' });
  });
});

describe('商品頁乙 C4:分類變更', () => {
  it('分類 id 翻成名字,並寫出是員工設定還是跟著同步;名字查不到寫「另一個分類」', () => {
    const rows = toProductHistoryRows(
      [log({ action: 'product.category.change', before: { category_id: 'c1', locked: false }, after: { category_id: 'c2', locked: true } })],
      [],
      new Map([['c2', '引擎部品 · 排氣管']]),
    );
    expect(rows[0]).toMatchObject({ field: '分類', from: '另一個分類(跟著同步)', to: '引擎部品 · 排氣管(員工設定)' });
  });
});

describe('商品頁乙 P8:價格變更', () => {
  it('寫出改前改後的一般價與經銷價;有特價才寫特價', () => {
    const rows = toProductHistoryRows(
      [
        log({
          action: 'product.price.change',
          before: { variant_id: 'v1', price_general: 6800, price_store: null, sale_price_general: null },
          after: { variant_id: 'v1', price_general: 7200, price_store: 6000, sale_price_general: 5000 },
        }),
      ],
      [],
      new Map(),
    );
    expect(rows[0]).toMatchObject({
      field: '價格',
      from: '一般價 NT$ 6,800 · 經銷價 未設定',
      to: '一般價 NT$ 7,200 · 經銷價 NT$ 6,000 · 特價 NT$ 5,000',
    });
  });
});
