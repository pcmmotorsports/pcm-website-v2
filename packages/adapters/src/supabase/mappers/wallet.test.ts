import { describe, expect, it } from 'vitest';
import type { WalletLedgerEntry } from '@pcm/domain';
import {
  mapSupabaseWalletEntryToDomain,
  mapWalletEntryToInsertRow,
  type SupabaseWalletLedgerRow,
} from './wallet';

const depositRow: SupabaseWalletLedgerRow = {
  id: 'led-1',
  customer_user_id: 'cust-1',
  entry_date: '2026-05-23',
  entry_type: 'deposit',
  amount: 30000,
  note: '儲值 NT$ 30,000',
  related_order_id: null,
  created_at: '2026-05-23T10:00:00Z',
};

describe('mapSupabaseWalletEntryToDomain', () => {
  it('should rename snake_case columns to camelCase', () => {
    const e = mapSupabaseWalletEntryToDomain(depositRow);
    expect(e.id).toBe('led-1');
    expect(e.customerUserId).toBe('cust-1');
    expect(e.entryDate).toBe('2026-05-23');
    expect(e.entryType).toBe('deposit');
    expect(e.note).toBe('儲值 NT$ 30,000');
    expect(e.createdAt).toBe('2026-05-23T10:00:00Z');
  });

  it('should pass related_order_id null through (no coalesce)', () => {
    expect(mapSupabaseWalletEntryToDomain(depositRow).relatedOrderId).toBeNull();
  });

  it('should pass non-null related_order_id through', () => {
    const e = mapSupabaseWalletEntryToDomain({ ...depositRow, related_order_id: 'ord-9' });
    expect(e.relatedOrderId).toBe('ord-9');
  });

  it('should preserve positive amount for deposit', () => {
    expect(mapSupabaseWalletEntryToDomain(depositRow).amount).toBe(30000);
  });

  it('should preserve negative amount for use (no sign flip)', () => {
    const e = mapSupabaseWalletEntryToDomain({
      ...depositRow,
      entry_type: 'use',
      amount: -1200,
      note: '訂單 PCM-2026-0421 折抵',
    });
    expect(e.amount).toBe(-1200);
    expect(e.entryType).toBe('use');
  });
});

describe('mapWalletEntryToInsertRow', () => {
  it('should map to snake_case and omit id/created_at', () => {
    const input: Omit<WalletLedgerEntry, 'id' | 'createdAt'> = {
      customerUserId: 'cust-1',
      entryDate: '2026-05-23',
      entryType: 'deposit',
      amount: 5000,
      note: '儲值',
      relatedOrderId: null,
    };
    expect(mapWalletEntryToInsertRow(input)).toEqual({
      customer_user_id: 'cust-1',
      entry_date: '2026-05-23',
      entry_type: 'deposit',
      amount: 5000,
      note: '儲值',
      related_order_id: null,
    });
  });

  it('should preserve negative amount and pass related_order_id through', () => {
    const input: Omit<WalletLedgerEntry, 'id' | 'createdAt'> = {
      customerUserId: 'cust-1',
      entryDate: '2026-05-24',
      entryType: 'use',
      amount: -800,
      note: '折抵',
      relatedOrderId: 'ord-3',
    };
    expect(mapWalletEntryToInsertRow(input)).toEqual({
      customer_user_id: 'cust-1',
      entry_date: '2026-05-24',
      entry_type: 'use',
      amount: -800,
      note: '折抵',
      related_order_id: 'ord-3',
    });
  });
});
