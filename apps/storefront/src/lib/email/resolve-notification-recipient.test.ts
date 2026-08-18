// node env;mock 'server-only'(本檔與 cardholder.ts / line.ts 檔頭都 import 'server-only')。
//
// M-4a B-4 plan §6 的 #3(§3.3 真釘子)與 §3.5(合成信箱不得過)兩格住在這裡;
// #1/#2/#4/#5/#7/#8 在 `app/checkout/charge-actions.test.ts`、#6 在 `mappers/order.test.ts`。
import { describe, it, expect, vi } from 'vitest';
import type { Customer, CustomerAddress } from '@pcm/domain';
import type { IAddressRepository, ICustomerRepository } from '@pcm/ports';

vi.mock('server-only', () => ({}));

import { resolveNotificationRecipient } from './resolve-notification-recipient';
import { buildCardholder } from '../payment/cardholder';
import { isValidLineUserId, lineSyntheticEmail } from '../auth/line';

const ADDR_ID = 'addr-uuid-1';

function customer(over: Partial<Customer> = {}): Customer {
  return {
    id: 'user-uuid-1',
    email: 'a@b.com',
    name: '王小明',
    phone: '0900111222',
    birthday: null,
    tier: 'general',
    walletBalance: 0,
    totalDeposit: 0,
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
    ...over,
  };
}

function address(over: Partial<CustomerAddress> = {}): CustomerAddress {
  return {
    id: ADDR_ID,
    customerUserId: 'user-uuid-1',
    name: '收件人甲',
    phone: '0912345678',
    line: '台北市信義區 1 號',
    email: null,
    isDefault: true,
    invoice: { type: 'personal', carrier: '', title: '', taxId: '', donateCode: '' },
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
    ...over,
  };
}

function deps(addressEmail: string | null) {
  return {
    customers: { findById: vi.fn(async () => customer()) } as unknown as ICustomerRepository,
    addresses: {
      listByCustomer: vi.fn(async () => [address({ email: addressEmail })]),
    } as unknown as IAddressRepository,
  };
}

describe('resolveNotificationRecipient — 候選順位與 canonical', () => {
  it('回第一個通過的候選,且回的是 canonical 值(網域小寫、頭尾半形空白剝除)', () => {
    expect(resolveNotificationRecipient([' Member@EXAMPLE.COM ', 'addr@mail.tw'])).toBe(
      'Member@example.com',
    );
  });

  it('前面的候選不合格就往下落(null / undefined / 空字串 / 畸形都跳過)', () => {
    expect(resolveNotificationRecipient([null, undefined, '   ', 'not-an-email', 'addr@mail.tw'])).toBe(
      'addr@mail.tw',
    );
  });

  it('全不合格 ⇒ null(防腐分支;plan §5:結帳這條路上游產不出來)', () => {
    expect(resolveNotificationRecipient([null, undefined, '', 'nope'])).toBeNull();
  });
});

describe('🔴 plan §3.5:LINE 合成信箱不得被持久化(斷言,不是註解)', () => {
  it('直接用 line.ts 的產生器造一個真的合成信箱餵 resolver ⇒ 被拒', () => {
    const sub = `U${'a'.repeat(32)}`;
    expect(isValidLineUserId(sub)).toBe(true); // fixture 自檢:餵的是真格式,不是隨手編的字串
    const synthetic = lineSyntheticEmail(sub);

    expect(resolveNotificationRecipient([synthetic])).toBeNull();
    // 合成信箱在前也不得吃掉後面那個真信箱
    expect(resolveNotificationRecipient([synthetic, 'real@mail.tw'])).toBe('real@mail.tw');
  });
});

// 🔴 plan §6 #3(§3.3 的真釘子):「拒單這件事還在」由 cardholder.test.ts 那 8 格守;
//    這一格守的是**另一半** —— buildCardholder 回 ok 的輸入下,resolver 必非 null。
//
// 🔴🔴 **只有「非 null」是不夠的**(codex 關卡2 R1 must-fix 2,採納):
//    七列全部只斷言非 null ⇒ **把順位交換、或把接受集縮成 `AddressEmailInput`,七列照樣全綠**。
//    ~~plan §6 #3 那一列寫的突變「換成比 AddressEmailInput 嚴的」~~ **實測不成立** ——
//    樣本 email 全都 ≤40 octets,縮成 `AddressEmailInput` 對它們沒有差別;
//    我當時是把門檻壓到 ≤10 才看到紅,那比 plan 寫的嚴得多。**以本檔為準,plan 那一列的突變描述是錯的。**
//    ⇒ 下面多一列 `LONG_SESSION`(41-254 octets:過 `NotificationEmailInput`、**不過** `AddressEmailInput`)
//      並斷言**等於 canonical session email**。那一列對「順位交換」與「接受集縮窄」**兩種突變都紅**。
describe('🔴 plan §6 #3:buildCardholder 回 ok ⇒ resolver 必非 null', () => {
  const LINE_EMAIL = lineSyntheticEmail(`U${'b'.repeat(32)}`);
  const SHORT_SYNTHETIC = 'x@line.pcmmotorsports.local';

  it.each([
    ['一般客人 × 舊地址(email null)', 'a@b.com', null],
    ['session email 兩側有空白', '  a@b.com  ', null],
    ['LINE 客人 × 地址有 email', LINE_EMAIL, 'line-user@mail.tw'],
    ['一般客人 × 地址也有 email', 'a@b.com', 'ship-to@mail.tw'],
    ['session 空 × 地址 email 兩側有空白', '', '  ship@mail.tw  '],
    ['session 空 × 地址 email 混大小寫', '', 'User.Name@MAIL.TW'],
    ['地址 email 是合成域(髒)但 session 合格', 'a@b.com', SHORT_SYNTHETIC],
  ])('%s', async (_label, sessionEmail, addressEmail) => {
    const res = await buildCardholder(deps(addressEmail), {
      user: { id: 'user-uuid-1', email: sessionEmail },
      addressId: ADDR_ID,
    });

    expect(res.ok).toBe(true); // 前提自檢:這一列真的是「建得成單」的樣本
    if (!res.ok) return;
    expect(resolveNotificationRecipient([sessionEmail, res.addressEmail])).not.toBeNull();
  });

  it('🔴 順位與接受集都要對:session 是長信箱(過 NotificationEmailInput、不過 AddressEmailInput)⇒ 收件人是它,不是地址', async () => {
    // 41-254 octets ⇒ TapPay 的 cardholder 用不了它(≤40),但通知信可以(≤254)。
    // 這一列的用途:①順位交換 ⇒ 回地址 ⇒ 紅 ②接受集縮成 AddressEmailInput ⇒ 落到地址 ⇒ 紅。
    const LONG_SESSION = `${'m'.repeat(40)}@example.com`; // 52 octets
    expect(LONG_SESSION.length).toBeGreaterThan(40); // 量具自檢:它真的超過 cardholder 那把尺
    const res = await buildCardholder(deps('ship@mail.tw'), {
      user: { id: 'user-uuid-1', email: LONG_SESSION },
      addressId: ADDR_ID,
    });

    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.cardholder.email).toBe('ship@mail.tw'); // cardholder 只能用短的那個(順位刻意相反的證據)
    expect(resolveNotificationRecipient([LONG_SESSION, res.addressEmail])).toBe(LONG_SESSION);
  });
});
