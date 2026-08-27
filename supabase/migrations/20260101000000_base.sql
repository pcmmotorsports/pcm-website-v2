CREATE TABLE public.order_payments (id int);
REVOKE ALL ON public.order_payments FROM anon, authenticated, service_role;
-- ACL-GATE-EXEMPT: public.brands -- 品牌目錄公開讀, storefront 匿名逛(#885, 2026-08-27 裁)
GRANT SELECT ON public.brands TO anon;
