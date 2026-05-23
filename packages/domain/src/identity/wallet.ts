import type { CustomerId } from './types';

export type WalletEntryId = string;

/**
 * WalletEntryType: 儲值金交易類型(對齊 design WalletTab.jsx + M-1-14a wallet_entry_type enum)。
 * - `deposit` 儲值(amount +)
 * - `use` 消費折抵(amount -)
 * - `refund` 退款返還(amount +、Phase 2 預留)
 */
export type WalletEntryType = 'deposit' | 'use' | 'refund';

/**
 * WalletLedgerEntry: 儲值金交易紀錄 entry(M-1-14)。
 *
 * 對齊 PRD docs/specs/m-1-14-customer-schema.md §4.2 + Supabase migration
 * `20260523034911_init_customers_and_subtables` customer_wallet_ledger 表(M-1-14a);
 * 對齊 design WalletTab.jsx L7-22 + L122-141。
 *
 * amount 用 number(非 shared/MoneyAmount brand):signed integer、deposit + / use - / refund +,
 * MoneyAmount brand 強制非負無法表達 use 的負值;整數性 + sign 由 DB CHECK constraint 守(M-1-14a)。
 * ledger immutable(DB 無 UPDATE / DELETE policy)、INSERT 走 service_role。
 */
export type WalletLedgerEntry = {
  id: WalletEntryId;
  customerUserId: CustomerId;
  entryDate: string; // ISO date
  entryType: WalletEntryType;
  amount: number; // signed integer
  note: string;
  relatedOrderId: string | null; // M-3 訂單 FK(Phase 1 留 null)
  createdAt: string;
};

/**
 * WalletBalance: 儲值金餘額快照(M-1-14)。
 *
 * 對齊 PRD §4.2;Q1=B 拍板下 balance / totalDeposit 來源為 customers.wallet_balance /
 * total_deposit 欄(DB trigger 同步)、lastEntryAt 對齊對帳 view customer_wallet_balance_check。
 * balance / totalDeposit 用 number(整數性由 DB integer 欄守、理由同 [[customer]] walletBalance)。
 */
export type WalletBalance = {
  customerUserId: CustomerId;
  balance: number;
  totalDeposit: number;
  lastEntryAt: string | null;
};
