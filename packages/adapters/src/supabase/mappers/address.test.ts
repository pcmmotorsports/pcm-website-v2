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
});

describe('mapAddressToInsertRow', () => {
  it('should flatten invoice object into columns and omit id/timestamps', () => {
    const input: Omit<CustomerAddress, 'id' | 'createdAt' | 'updatedAt'> = {
      customerUserId: 'cust-1',
      isDefault: false,
      name: '李大華',
      phone: '0922333444',
      line: '新北市板橋區',
      invoice: { type: 'company', carrier: '', title: 'ACME', taxId: '87654321', donateCode: '' },
    };
    expect(mapAddressToInsertRow(input)).toEqual({
      customer_user_id: 'cust-1',
      is_default: false,
      name: '李大華',
      phone: '0922333444',
      line: '新北市板橋區',
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
