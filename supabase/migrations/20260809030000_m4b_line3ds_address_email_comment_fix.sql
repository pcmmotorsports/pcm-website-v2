-- M-4b LINE 3DS 修復:只修 customer_addresses.email 的欄註解(無 DDL 結構變更)
--
-- 【為什麼要單獨一支】前一支 20260809004000 **已經 apply 到正式庫**,它寫下的
--   COMMENT ON COLUMN 當時說「NULL = 這筆地址從來沒被要求填過」「結帳時 LINE 身分遇到
--   NULL 會被擋下」。codex 關卡2 第二輪指出這兩句與實際實作矛盾,實查後屬實:
--
--   ① 結帳端(lib/payment/cardholder.ts `pickUsableEmail`)把 **NULL 與空字串一視同仁**
--      當「沒有可用 email」,沒有任何分支依這個差別決定攔或放人。
--   ② `authenticated` 對本表有表級 INSERT/UPDATE GRANT + RLS own-only
--      (20260523034911_init_customers_and_subtables.sql:236 / :166-179)
--      ⇒ 客人可直接打 PostgREST 寫 NULL ⇒ NULL **證明不了**「從未填過」。
--
--   改已 apply 的檔案不會改到 DB 上那份註解,所以另建這一支。純 COMMENT、零結構風險。
--
-- 【rollback】把註解改回舊字面即可(但沒有理由這麼做:舊字面是錯的)。

COMMENT ON COLUMN public.customer_addresses.email IS
  '收件人 Email;付款時 cardholder.email 優先取本欄,取不到才回落 session email。'
  '應用層必填(zod AddressInput),DB 端 nullable 是為了既有列相容 —— '
  '🔴 NULL 與空字串在結帳端一視同仁都代表「沒有可用 email」,不是行為分支;'
  '且 authenticated 可直接寫入本表,故 NULL 不足以證明「從未填過」。'
  '總長上限 40:TapPay cardholder.email 的限制(2026-08-09 sandbox 實測 40 過 / 41 回 521 '
  'Out of range : cardholder > email)。上限與格式在應用層 zod 執法;'
  'DB 層目前無 CHECK(補 CHECK 或收回直寫權另立 backlog,見 docs/phase-1-backlog.md)。';
