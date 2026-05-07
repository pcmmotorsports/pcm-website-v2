-- M-1-03 main-c drift-fix
-- 對齊 Sean 業務拍板:商品「品牌+分類」必填、資料缺就擋下不准存
-- 推翻 main-c sub-slice 2 raise B4 推遲方向、走 B1 schema NOT NULL

ALTER TABLE products ALTER COLUMN brand_id SET NOT NULL;
ALTER TABLE products ALTER COLUMN category_id SET NOT NULL;
