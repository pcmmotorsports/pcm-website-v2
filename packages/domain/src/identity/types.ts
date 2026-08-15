import type { MemberTier } from '../shared/types';

export type CustomerId = string; // = auth.users.id uuid(M-1-14 customers PK)

/**
 * Customer: 會員 entity(M-1-14 擴自 M-0-04 type stub)。
 *
 * 對齊 PRD docs/specs/m-1-14-customer-schema.md §4.1 + Supabase migration
 * `20260523034911_init_customers_and_subtables` customers 表(M-1-14a);
 * 逐欄對齊 design AccountPages.jsx L312-414 user 物件(email / name / phone / birthday)。
 *
 * 命名:DB snake_case ↔ domain camelCase(wallet_balance ↔ walletBalance 等)、由 adapter mapper 轉。
 * tier 由後台手動標記(Q1=A、design TierComponents L27)、客人不可自改(DB column GRANT + RLS 守);
 * tier 寫入不經 ICustomerRepository(走 service_role、見 IAdminCustomerRepository M-4a)。
 *
 * walletBalance / totalDeposit 用 number(非 shared/MoneyAmount brand):
 * brand type 強制非負、但這兩欄語意上由 ledger signed amount 累加而來(use entry 為負);
 * 整數性由 DB integer column + CHECK constraint 守(M-1-14a)、不在 domain 重複守門。
 *
 * 子 entity 分檔:[[address]] / [[vehicle]] / [[wallet]](identity/address.ts 等)。
 */
export type Customer = {
  id: CustomerId;
  email: string;
  name: string;
  phone: string;
  birthday: string | null; // ISO date 'YYYY-MM-DD' or null
  tier: MemberTier;
  walletBalance: number; // Q1=B:DB trigger 同步、authenticated 不可直寫
  totalDeposit: number; // Q1=B:累積儲值(後台參考門檻、非 auto-upgrade 觸發)
  createdAt: string; // ISO datetime
  updatedAt: string;
};

// ── M-4a 客戶管理:後台客戶列表讀模型(admin read-model)──

/**
 * AdminCustomerFilter: 後台客戶列表篩選(value-object;全欄可選、缺 = 不限)。
 *
 * v1 只 `tier` 軸(依會員等級找經銷 / 一般客);free-text 姓名 / email 搜尋留 follow-up。
 */
export type AdminCustomerFilter = {
  tier?: MemberTier;
};

/**
 * AdminCustomerSummary: 後台客戶列表摘要投影(admin read-model、server 分頁)。
 *
 * 🔴 刻意**排除** `walletBalance` / `totalDeposit`(#202 儲值金台灣法規 HOLD、不進雛型)+ `birthday`(列表不需);
 * 型別層無任何成本 / 經銷價欄(customers 表本身無)。`tier` = 會員等級標籤(admin 需知經銷身分、**非價格**);
 * `phone` 可 null(DB 欄 nullable);`createdAt` ISO 原樣(UI 端格式化)。
 */
export type AdminCustomerSummary = {
  id: CustomerId;
  name: string;
  email: string;
  phone: string | null;
  tier: MemberTier;
  /** 註冊時間 ISO(customers.created_at 原樣) */
  createdAt: string;

  // ── 客戶頁三欄(`admin_customer_list_v` 的聚合欄)────────────────────────────
  //
  // 🔴 **三欄共用一條口徑:已取消的訂單不算。** 不扣退款。
  //    主視窗 2026-08-16 裁(消費金額那條)+ Q-522-分母 同一天裁「最後下單也排除」——
  //    理由是**兩欄並排必須共用一條規則**,否則員工要學兩套而畫面看起來是同一組資訊。
  //    ⚠️ 要「他最近有沒有來」那個行為訊號,那是**另一個欄位**(「最後互動」),不是改這欄。
  //
  // ⚠️ **欄名帶 `active` 是刻意的** —— 對齊 view 的 `active_order_count` 等。
  //    UI 標籤仍是 Sean 指定的「訂單數 / 消費金額 / 最後下單」;
  //    **標籤旁要不要註明「不含已取消」是文案題,本片沒做。**

  /** 未取消訂單數。零訂單 = 0(不會是 null)。 */
  activeOrderCount: number;
  /** 未取消訂單的 total 加總,**整數元位**(禁浮點)。零訂單 = 0。 */
  activeSpendTotal: number;
  /**
   * 最後一筆未取消訂單的建立時間 ISO。
   * 🔴 **零訂單 = `null`,不是 0 也不是空字串** —— 沒有一個合理的「零日期」。
   *    UI 必須顯示成「從未下單」或「—」,**不得留白**:留白與載入失敗長得一樣。
   */
  lastActiveOrderedAt: string | null;
};
