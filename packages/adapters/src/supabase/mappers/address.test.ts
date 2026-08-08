import { describe, expect, it } from 'vitest';
import type { CustomerAddress } from '@pcm/domain';
import {
  mapAddressPatchToRow,
  mapAddressToInsertRow,
  mapSupabaseAddressToDomain,
  type SupabaseAddressRow,
} from './address';

const baseRow: SupabaseAddressRow = {
  id: 'addr-1',
  customer_user_id: 'cust-1',
  is_default: true,
  name: '王小明',
  phone: '0912345678',
  line: '台北市大安區忠孝東路 1 號 5 樓',
  email: 'wang@mail.tw',
  invoice_type: 'personal',
  invoice_carrier: '/ABCD123',
  invoice_title: '',
  invoice_tax_id: '',
  invoice_donate_code: '',
  created_at: '2026-05-23T00:00:00Z',
  updated_at: '2026-05-23T01:00:00Z',
};

describe('mapSupabaseAddressToDomain', () => {
  it('should nest flattened invoice columns into invoice object (personal)', () => {
    const a = mapSupabaseAddressToDomain(baseRow);
    expect(a.customerUserId).toBe('cust-1');
    expect(a.isDefault).toBe(true);
    expect(a.invoice).toEqual({
      type: 'personal',
      carrier: '/ABCD123',
      title: '',
      taxId: '',
      donateCode: '',
    });
  });

  it('should nest company invoice (title + taxId)', () => {
    const a = mapSupabaseAddressToDomain({
      ...baseRow,
      invoice_type: 'company',
      invoice_carrier: '',
      invoice_title: 'PCM 公司',
      invoice_tax_id: '12345678',
    });
    expect(a.invoice.type).toBe('company');
    expect(a.invoice.title).toBe('PCM 公司');
    expect(a.invoice.taxId).toBe('12345678');
  });

  it('should nest donate invoice (donateCode)', () => {
    const a = mapSupabaseAddressToDomain({
      ...baseRow,
      invoice_type: 'donate',
      invoice_carrier: '',
      invoice_donate_code: '8585',
    });
    expect(a.invoice.type).toBe('donate');
    expect(a.invoice.donateCode).toBe('8585');
  });

  it('should coalesce null phone and invoice_carrier to empty string', () => {
    const a = mapSupabaseAddressToDomain({ ...baseRow, phone: null, invoice_carrier: null });
    expect(a.phone).toBe('');
    expect(a.invoice.carrier).toBe('');
  });

  it('should pass email through as-is', () => {
    expect(mapSupabaseAddressToDomain(baseRow).email).toBe('wang@mail.tw');
  });

  // 🔴 M-4b:email 是本 mapper 裡**唯一刻意不做 `?? ''`** 的 nullable 欄。
  //    突變「email: row.email ?? ''」只會紅這一條 —— 而那個突變看起來完全合理
  //    (跟隔壁 phone 一模一樣),所以必須有東西守著。
  //    保留 null 的理由 = **不在 mapper 這層抹掉存量資料的形狀**(舊列 vs 有填過),
  //    盤點與資料修復都靠它分得出來。
  //    ⚠️ 但**不要**把它講成行為分支(R2/R3 審查糾正、與 domain 註解對齊):
  //    結帳端把 null 與 '' 一視同仁當「沒有可用 email」,沒有任何分支只針對 null 引導補填;
  //    而且客人可直接寫 null(見 backlog #343)⇒ null 也證明不了「從未填過」。
  it('🔴 should keep null email as null (NOT coalesced to empty string, unlike phone)', () => {
    const a = mapSupabaseAddressToDomain({ ...baseRow, email: null });
    expect(a.email).toBeNull();
    expect(a.email).not.toBe('');
  });
});

describe('mapAddressToInsertRow', () => {
  it('should flatten invoice object into columns and omit id/timestamps', () => {
    const input: Omit<CustomerAddress, 'id' | 'createdAt' | 'updatedAt'> = {
      customerUserId: 'cust-1',
      isDefault: false,
      name: '李大華',
      phone: '0922333444',
      line: '新北市板橋區',
      email: 'lee@mail.tw',
      invoice: { type: 'company', carrier: '', title: 'ACME', taxId: '87654321', donateCode: '' },
    };
    expect(mapAddressToInsertRow(input)).toEqual({
      customer_user_id: 'cust-1',
      is_default: false,
      name: '李大華',
      phone: '0922333444',
      line: '新北市板橋區',
      email: 'lee@mail.tw',
      invoice_type: 'company',
      invoice_carrier: '',
      invoice_title: 'ACME',
      invoice_tax_id: '87654321',
      invoice_donate_code: '',
    });
  });
});

describe('mapAddressPatchToRow', () => {
  it('should map only present top-level keys', () => {
    expect(mapAddressPatchToRow({ isDefault: true, name: '改名' })).toEqual({
      is_default: true,
      name: '改名',
    });
  });

  // 🔴 M-4b:舊地址補 Email 是本次修復的核心自救動線 —— 這條之前沒有守門,
  //    拿掉 mapper 裡的 email 那行,整組測試照樣全綠,而客人補的 Email 會靜默寫不進 DB。
  //    (codex 關卡2 must-fix)
  it('🔴 should map email when present (舊地址補 Email 的寫回路徑)', () => {
    expect(mapAddressPatchToRow({ email: 'new@mail.tw' })).toEqual({ email: 'new@mail.tw' });
  });

  it('should not emit email key when absent (未帶不覆寫既有值)', () => {
    expect(mapAddressPatchToRow({ name: '只改名' })).not.toHaveProperty('email');
  });

  it('should flatten all 5 invoice fields when invoice present', () => {
    expect(
      mapAddressPatchToRow({
        invoice: { type: 'donate', carrier: '', title: '', taxId: '', donateCode: '925' },
      }),
    ).toEqual({
      invoice_type: 'donate',
      invoice_carrier: '',
      invoice_title: '',
      invoice_tax_id: '',
      invoice_donate_code: '925',
    });
  });

  it('should ignore customerUserId / id / timestamps even if present', () => {
    const row = mapAddressPatchToRow({
      customerUserId: 'other-cust',
      id: 'x',
      createdAt: 'y',
      updatedAt: 'z',
      name: 'keep',
    } as Partial<CustomerAddress>);
    expect(row).toEqual({ name: 'keep' });
  });

  it('should produce empty object for empty patch', () => {
    expect(mapAddressPatchToRow({})).toEqual({});
  });
});
