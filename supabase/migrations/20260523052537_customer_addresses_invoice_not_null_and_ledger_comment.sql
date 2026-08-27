-- ============================================================
-- M-1-14a-patch: Codex Review FAIL 處置(M1 + C2)
-- 對應 docs/reviews/2026-05-23-m-1-14a-customer-schema-packet.md FAIL findings
-- forward-only:不改既有 migration 9faf35a 字面、開新 migration
-- ============================================================

-- M1(必修): invoice_title / invoice_tax_id / invoice_donate_code 加 NOT NULL
--   堵 Postgres CHECK 對 NULL 通過漏洞:
--   既有 CHECK addresses_invoice_company_has_data =
--     invoice_type != 'company' OR (invoice_title != '' AND invoice_tax_id != '')
--   若 invoice_title IS NULL → `invoice_title != ''` 評為 NULL → `FALSE OR NULL` = NULL → CHECK 放行(NULL ≠ FALSE)。
--   authenticated 可寫 invoice_type='company' 但 title/tax_id = NULL 繞過 validation。
--   三欄已有 DEFAULT ''、customer_addresses 0 rows、SET NOT NULL 安全(無既有 NULL 資料)。
ALTER TABLE customer_addresses
  ALTER COLUMN invoice_title SET NOT NULL,
  ALTER COLUMN invoice_tax_id SET NOT NULL,
  ALTER COLUMN invoice_donate_code SET NOT NULL;

-- C2(順手): customer_wallet_ledger COMMENT 更新對齊 Q1=B
--   原 COMMENT 字面寫「balance = SUM via customer_wallet_balance view、不存欄位避免 drift」、
--   與 Q1=B 拍板(存 customers 表 + trigger sync)矛盾、本 patch 校正。
COMMENT ON TABLE customer_wallet_ledger IS
  'M-1-14 Q1=B 拍板:wallet_balance / total_deposit 存 customers 表欄位、ledger AFTER INSERT trigger 自動同步(非 view 即時算)。customer_wallet_balance_check view 留作 admin 對帳工具、非 storefront hot path。amount signed integer / deposit + / use - / refund +、CHECK constraint 守門。Phase 1 deposit 為 mock(TapPay 整合留 M-3);use 由 M-3 結帳折抵時寫入。';
