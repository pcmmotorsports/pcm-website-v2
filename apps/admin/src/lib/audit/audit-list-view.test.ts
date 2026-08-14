import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AdminAuditLogRow } from './types';
import type { StaffActor } from '../staff';
import {
  AUDIT_ACTION_LABEL,
  formatAuditAction,
  formatAuditActor,
  formatAuditTarget,
  toAuditListRow,
} from './audit-list-view';

const STAFF: StaffActor[] = [
  { id: 'sean', label: '洪先生' },
  { id: 'amy', label: '小美' },
];

function row(over: Partial<AdminAuditLogRow> = {}): AdminAuditLogRow {
  return {
    id: '11111111-2222-4333-8444-555555555555',
    actor: 'sean',
    action: 'customer.tier.change',
    target: 'customer:abc-123',
    before: null,
    after: null,
    reason: null,
    request_id: 'req-1',
    source_app: 'admin',
    created_at: '2026-08-01T02:00:00+00:00',
    ...over,
  };
}

afterEach(() => {
  vi.unstubAllEnvs();
});

/**
 * 🔴 驗收 5:字典**一定會過期**(`AdminAuditAction` 型別層是 `string`、不列舉)。
 * **「不會爆」與「顯示得體」是兩件事,兩個都要斷言**(主視窗 2026-08-15 提醒)。
 */
describe('formatAuditAction — 未知代碼', () => {
  it('字典有的 ⇒ 中文', () => {
    expect(formatAuditAction('order.cancel')).toBe('取消訂單');
  });

  it('🔴 字典沒有的 ⇒ 不爆,而且**原樣回代碼**(不是空字串、不是「未知動作」)', () => {
    const unknown = 'brand_new.thing.happened';
    expect(() => formatAuditAction(unknown)).not.toThrow();
    expect(formatAuditAction(unknown)).toBe(unknown);
    // 🔴 這兩條分開釘:空字串會讓畫面出現空格(不爆但看不懂);
    //    固定字串「未知動作」得體但把代碼丟掉 ⇒ 查不出是哪個。稽核的用途是追查。
    expect(formatAuditAction(unknown)).not.toBe('');
    expect(formatAuditAction(unknown)).not.toBe('未知動作');
  });

  // 正向對照:證明上面不是「這函式恆回輸入」。
  // 🔴 E 窗 R1 must-fix:這兩個**寫檔當下就在樹裡**(`staff-actions.ts:274-275`),我抄舊清單時漏了。
  it.each([
    ['settings.staff.deactivate', '停用員工'],
    ['settings.staff.reactivate', '啟用員工'],
  ])('%s ⇒ %s(補漏)', (code, label) => {
    expect(formatAuditAction(code)).toBe(label);
  });

  it('🔴 正向對照:至少一個代碼真的被翻譯了(證明字典有生效)', () => {
    expect(formatAuditAction('payment.reverse')).not.toBe('payment.reverse');
    expect(Object.keys(AUDIT_ACTION_LABEL).length).toBeGreaterThan(0);
  });
});

describe('formatAuditActor', () => {
  it('名單內 ⇒ 中文姓名', () => {
    expect(formatAuditActor(STAFF, 'sean')).toBe('洪先生');
  });

  /**
   * 🔴 舊紀錄的 actor 查不到是**預期,不是異常** ——
   * `listActiveStaff()` 只回**啟用中**的人,而稽核是歷史紀錄(當時那人可能已離職)。
   */
  it('🔴 名單外(已離職 / 已停用)⇒ 原樣回 slug,不爆、不空白', () => {
    expect(formatAuditActor(STAFF, 'left_the_company')).toBe('left_the_company');
    expect(formatAuditActor([], 'sean')).toBe('sean');
  });
});

/**
 * 🔴 主視窗 2026-08-15 明點:**切不開的時候要有明確行為,不要靜默回空字串。**
 * ⚠️ 關鍵是「**沒有 target**」與「**target 壞了**」**必須看得出差別** ——
 *    都回空字串的話,那兩件事在畫面上長得一模一樣。
 */
describe('formatAuditTarget', () => {
  it('order:<id> ⇒ 有連結', () => {
    expect(formatAuditTarget('order:abc')).toEqual({ label: '查看訂單', href: '/orders/abc' });
  });

  /**
   * 🔴 **「看得懂但沒有可以去的頁面」與「看不懂」是兩件事**(E 窗 R1 must-fix 第二層)。
   * `app/settings/staff/` 只有 `page.tsx`、沒有 per-id 頁 ⇒ 給得體標籤、不給連結。
   * ⚠️ 沒有這格的話那一列會是「`settings.staff.deactivate` + `staff:8f3a-…`」兩欄都是機器字串。
   */
  it('🔴 staff:<id>(認得前綴但無頁面)⇒ 得體標籤、無連結、且不同於「看不懂」', () => {
    const got = formatAuditTarget('staff:8f3a');
    expect(got).toEqual({ label: '員工設定', href: null });
    // 與「前綴不認得」分得出來:那個會原樣顯示整串。
    expect(formatAuditTarget('invoice:8f3a').label).toBe('invoice:8f3a');
  });

  it('customer:<id> ⇒ 有連結', () => {
    expect(formatAuditTarget('customer:xyz')).toEqual({ label: '查看客人', href: '/customers/xyz' });
  });

  it('🔴 null / 空字串(全域動作,建表註解逐字「全域動作可省略」)⇒ 破折號、無連結', () => {
    expect(formatAuditTarget(null)).toEqual({ label: '—', href: null });
    expect(formatAuditTarget('')).toEqual({ label: '—', href: null });
  });

  it.each([
    ['沒有冒號', 'order-abc'],
    ['前綴不認得', 'invoice:abc'],
    ['uuid 段為空', 'order:'],
    ['冒號在開頭(前綴為空)', ':abc'],
  ])('🔴 %s ⇒ **原樣顯示整串、不給連結**(不是空字串)', (_label, bad) => {
    const got = formatAuditTarget(bad);
    expect(got.href, '格式不符時不得給連結').toBeNull();
    expect(got.label, '要原樣顯示,讓人看得出「這裡有東西但帶不過去」').toBe(bad);
    expect(got.label).not.toBe('');
    expect(got.label, '不得與「沒有 target」的破折號混淆').not.toBe('—');
  });
});

/**
 * 🔴 時區:`vitest.config.ts` 把 `TZ` 釘死在 `Asia/Taipei`
 * ⇒ **不 stub 的話,拿掉實作裡的 `timeZone` 那行,這格照樣綠 = 零判別力**
 *   (house 範本 `lib/orders/payment-list-view.test.ts:96-107`)。
 * ⚠️ 正式站是 Vercel Node **UTC** ⇒ 那正是「本機恆綠、上線差八小時」。
 */
describe('toAuditListRow — 時間', () => {
  it('🔴 執行環境在 UTC 時仍印台北時間(唯一能證明 timeZone 有效的一格)', () => {
    vi.stubEnv('TZ', 'UTC');
    try {
      // 前提斷言:先確認 stub 真的改到執行期時區 —— 沒改到的話下面那句在台北下恆綠。
      expect(Intl.DateTimeFormat().resolvedOptions().timeZone, '前提:stub 應改到執行期時區').toBe('UTC');
      expect(toAuditListRow(row(), STAFF).at).toBe('2026-08-01 10:00');
    } finally {
      vi.unstubAllEnvs();
    }
    // 收尾也驗:時區有還原,否則本檔後面的格子會在 UTC 下跑。
    expect(Intl.DateTimeFormat().resolvedOptions().timeZone).toBe('Asia/Taipei');
  });
});

describe('toAuditListRow — 四欄與邊界', () => {
  it('四欄齊全', () => {
    expect(toAuditListRow(row(), STAFF)).toEqual({
      id: '11111111-2222-4333-8444-555555555555',
      at: '2026-08-01 10:00',
      actor: '洪先生',
      action: '調整會員等級',
      target: { label: '查看客人', href: '/customers/abc-123' },
    });
  });

  /**
   * 🔴🔴 驗收 6:`before`/`after` **不得出現在列表層** ——
   * 建表 `20260712210000:26-28` 逐字說那兩欄「可合法含經銷價 / 成本 / PII」。
   * 這格塞一個帶成本欄的 payload,斷言**輸出的任何欄位都不含它**。
   */
  it('🔴 before/after 的內容不得進入輸出(含成本欄字面)', () => {
    const out = toAuditListRow(
      row({ before: { cost: 12345, dealer_price: 999 }, after: { cost: 54321 } }),
      STAFF,
    );
    const serialised = JSON.stringify(out);
    expect(serialised).not.toContain('12345');
    expect(serialised).not.toContain('54321');
    expect(serialised).not.toContain('dealer_price');
    expect(serialised).not.toContain('cost');
    // 正向對照:證明上面不是「輸出根本是空的」。
    expect(serialised).toContain('洪先生');
  });
});
