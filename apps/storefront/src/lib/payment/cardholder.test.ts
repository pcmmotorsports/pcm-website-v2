// node env;mock 'server-only'(cardholder.ts 檔頭 import 'server-only')。
// Q3=B 級聯 + trim min(1) + fail-closed 全分支(plan v6 §5/§10 ②-③d 驗收)。
import { describe, it, expect, vi } from 'vitest';
import type { Customer, CustomerAddress } from '@pcm/domain';
import type { IAddressRepository, ICustomerRepository } from '@pcm/ports';

vi.mock('server-only', () => ({}));

import { buildCardholder } from './cardholder';

const USER = { id: 'user-uuid-1', email: 'a@b.com' };
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
    isDefault: true,
    invoice: { type: 'personal', carrier: '', title: '', taxId: '', donateCode: '' },
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
    ...over,
  };
}

function deps(opts: { customer?: Customer | null; addresses?: CustomerAddress[] } = {}) {
  const customers = {
    findById: vi.fn(async () => (opts.customer === undefined ? customer() : opts.customer)),
  } as unknown as ICustomerRepository;
  const addresses = {
    listByCustomer: vi.fn(async () => opts.addresses ?? [address()]),
  } as unknown as IAddressRepository;
  return { customers, addresses };
}

describe('buildCardholder — happy + Q3=B 級聯', () => {
  it('全齊 → name=profile、phone=地址、email=user(地址 phone 優先於 profile phone)', async () => {
    const res = await buildCardholder(deps(), { user: USER, addressId: ADDR_ID });
    expect(res).toEqual({
      ok: true,
      cardholder: { name: '王小明', email: 'a@b.com', phoneNumber: '0912345678' },
    });
  });

  it('profile name 空 → 級聯收件人 name(Q3=B)', async () => {
    const res = await buildCardholder(deps({ customer: customer({ name: '' }) }), {
      user: USER,
      addressId: ADDR_ID,
    });
    expect(res).toMatchObject({ ok: true, cardholder: { name: '收件人甲' } });
  });

  it('地址 phone 空 → 級聯 profile phone(Q3=B)', async () => {
    const res = await buildCardholder(deps({ addresses: [address({ phone: '' })] }), {
      user: USER,
      addressId: ADDR_ID,
    });
    expect(res).toMatchObject({ ok: true, cardholder: { phoneNumber: '0900111222' } });
  });

  it('🔴 trim:全形空白/空格不得當有值(「   」→ 級聯;email 兩側空白剝除)', async () => {
    const res = await buildCardholder(
      deps({
        customer: customer({ name: '\u3000\u3000' }), // 全形空白(U+3000)
        addresses: [address({ phone: '  ' })],
      }),
      { user: { id: USER.id, email: '  a@b.com  ' }, addressId: ADDR_ID },
    );
    expect(res).toEqual({
      ok: true,
      cardholder: { name: '收件人甲', email: 'a@b.com', phoneNumber: '0900111222' },
    });
  });
});

describe('buildCardholder — fail-closed 全分支', () => {
  it('🔴 email 空/null → email_missing(不送空給 TapPay;零 repo 呼叫)', async () => {
    const d = deps();
    for (const email of ['', '   ', null, undefined]) {
      const res = await buildCardholder(d, { user: { id: USER.id, email }, addressId: ADDR_ID });
      expect(res).toEqual({ ok: false, reason: 'email_missing' });
    }
    expect(d.customers.findById).not.toHaveBeenCalled(); // email gate 最先(零 DB 讀)
    expect(d.addresses.listByCustomer).not.toHaveBeenCalled();
  });

  it('🔴 profile 查無 row → profile_not_found(round6 NIT:不靜默級聯)', async () => {
    const res = await buildCardholder(deps({ customer: null }), { user: USER, addressId: ADDR_ID });
    expect(res).toEqual({ ok: false, reason: 'profile_not_found' });
  });

  it('🔴 addressId 非本人/不存在(RLS 濾掉)→ address_not_found', async () => {
    const res = await buildCardholder(deps(), { user: USER, addressId: 'addr-other' });
    expect(res).toEqual({ ok: false, reason: 'address_not_found' });
  });

  it('name 雙空(profile + 收件人;防 DB 腐壞)→ name_missing', async () => {
    const res = await buildCardholder(
      deps({ customer: customer({ name: '' }), addresses: [address({ name: '  ' })] }),
      { user: USER, addressId: ADDR_ID },
    );
    expect(res).toEqual({ ok: false, reason: 'name_missing' });
  });

  it('🔴 phone 雙空(地址 + profile)→ phone_missing(引導補手機)', async () => {
    const res = await buildCardholder(
      deps({ customer: customer({ phone: '' }), addresses: [address({ phone: '' })] }),
      { user: USER, addressId: ADDR_ID },
    );
    expect(res).toEqual({ ok: false, reason: 'phone_missing' });
  });

  it('repo throw → 原樣上拋(action 吞通用字面、不在本層吞)', async () => {
    const d = deps();
    (d.customers.findById as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
      new Error('connection refused'),
    );
    await expect(buildCardholder(d, { user: USER, addressId: ADDR_ID })).rejects.toThrow();
  });
});
