-- M-1-05 刀 2 Sub-slice 2-1:products 表加 price_general + price_store 兩欄
--
-- 設計脈絡(對齊 backlog #118 + #119 + Sean (ii) 拍板):
--   既有 price_by_tier jsonb 內聯 general + store 兩 tier、view 整欄遮會連公開價也擋
--   拆兩 integer 欄、view 投射 price_general、price_store 僅 service_role 看
--   保留 price_by_tier jsonb(雙寫過渡期 source of truth、sub-slice 2-3 雙寫)
--
-- NOT NULL 推遲 sub-slice 2-X(雙寫穩定後另開 migration 加、防 save 漏雙寫即炸)

ALTER TABLE products ADD COLUMN price_general integer;
ALTER TABLE products ADD COLUMN price_store integer;

ALTER TABLE products ADD CONSTRAINT price_general_non_negative CHECK (
  price_general IS NULL OR price_general >= 0
);
ALTER TABLE products ADD CONSTRAINT price_store_non_negative CHECK (
  price_store IS NULL OR price_store >= 0
);

COMMENT ON COLUMN products.price_general IS
  '公開售價(TWD 元位整數、對齊 MoneyAmount brand type)。view 投射、anon / authenticated SELECT 可見。M-1-05 刀 2 Sub-slice 2-1 落地、雙寫過渡期 source of truth 仍是 price_by_tier jsonb。';

COMMENT ON COLUMN products.price_store IS
  '經銷敏感價(TWD 元位整數)。view 永遠排除、僅 service_role 看。M-1-05 刀 2 Sub-slice 2-1 落地、雙寫過渡期 source of truth 仍是 price_by_tier jsonb。';
