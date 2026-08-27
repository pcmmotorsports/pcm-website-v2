-- M-4b LINE 3DS 修復:customer_addresses 加 email 欄
-- plan:docs/specs/2026-08-09-line-3ds-cardholder-email-plan.md §2.1
--
-- 【為什麼】TapPay pay-by-prime 3DS 對 cardholder.email 有**總長 <= 40** 的驗證,超過即回
--   status 521 'Out of range : cardholder > email'(2026-08-09 sandbox 對照實測 7 發:
--   40 字元過 / 41 字元拒;同網域短信箱過 => `.local` 網域本身無罪、長度才是原因)。
--   LINE 登入的合成信箱 = line_U<32hex>@line.pcmmotorsports.local = 64 字元**恆超標**
--   => 3DS 啟動呼叫必被拒、客人拿不到 payment_url,DB 留下 pending + rec_trade_id NULL
--   且 TapPay 端零交易紀錄(與 2026-08-08 正式站指紋一致)。
--   修法:收件地址自帶 email,cardholder 改用它;順位與擋門見 plan §2.3。
--
-- 【形狀】DB 層 nullable、**應用層必填**(zod AddressInput)。
--   不採本表既有的 `text DEFAULT ''` 慣例(phone / invoice_* 都是空字串當沒填),
--   讓既有列維持 NULL、與「有填過」在**資料上**分得出來。
--   🔴 **但不要把這個區分講成行為分支**(codex 關卡2 round2 must-fix,原字面已更正):
--   結帳端把 NULL 與空字串**一視同仁**當「沒有可用 email」,沒有任何分支依這個差別攔或放人;
--   而且 authenticated 可直接寫 NULL(見下方誠實邊界)⇒ NULL 也不能證明「從未填過」。
--   ⇒ nullable 的實際價值 = 既有資料相容 + 盤點時分得出存量列,不是行為依據。
--   ⚠️ 本檔的 `COMMENT ON COLUMN` **已經 apply 到正式庫**,改本檔字面不會改到 DB 上那份;
--      更正後的欄註解另放 `20260809030000_m4b_line3ds_address_email_comment_fix.sql`(待 apply)。
--
--   不加 UNIQUE:Sean 拍板「可以接受客人用不同 email」,同一人多個地址亦可共用同一 email。
--   不加格式 CHECK:格式規則的單一真相在應用層 zod;DB 端加正規式 = 第二處要同步的規則。
--
-- 【GRANT / RLS】customer_addresses 走**表級** GRANT + own-only policy 四條
--   (20260523034911_init_customers_and_subtables.sql:236 / :166-179)=> 新欄自動涵蓋、無需另授權。
--   🔴 但 apply 後仍要**實跑**驗證新欄真的讀寫得到 —— 表級 ACL 攤平看不到欄級差異(既有教訓)。
--
-- 🔴🔴 【誠實邊界:應用層必填**不是** DB 層保證】(codex 關卡2 must-fix;已實查 GRANT 坐實)
--   authenticated 對本表有 INSERT/UPDATE 權限(同檔 :236 表級 GRANT)+ RLS own-only
--   => 登入的客人**可以直接打 PostgREST 寫自己的列**,塞 NULL、空字串或畸形 email,
--      完全繞過 zod AddressInput。
--   ⇒ 不得宣稱「email 必填涵蓋全部寫入路徑」,也不得假設「NULL 只可能是舊列」。
--   ⇒ 金流端**不依賴**這個保證:cardholder 組裝時用同一支 schema(AddressEmailInput)
--      把取到的值重驗一次,髒值一律擋下不送 TapPay(lib/payment/cardholder.ts pickUsableEmail)。
--   ⇒ 要在 DB 層補 CHECK(允許舊列 NULL、擋畸形值)或收回直接寫入權改走 RPC,是**另一片**:
--      動既有 GRANT 會影響地址簿現行功能,且套用前需先唯讀盤點既有髒資料。已列 backlog #343、不在本片做。
--
-- 【rollback】見檔尾。🔴 DROP COLUMN 會丟掉客人已填的 email(不可逆)
--   => 必須先退應用層、確認不再依賴該欄,才准 drop。
--
-- 【部署順序】🔴 migration apply -> 驗證新欄可讀寫 -> 重 gen database.types.ts -> 應用層才上線。
--   反過來 = 應用層先於 migration 上線,正式站會壞(2026-08-07 A9h 已有前科)。

ALTER TABLE public.customer_addresses ADD COLUMN email text;

COMMENT ON COLUMN public.customer_addresses.email IS
  '收件人 Email。應用層必填(zod AddressInput),DB 端 nullable 是為了既有列 —— '
  'NULL 的語意是「這筆地址從來沒被要求填過」,不是「填了又清空」,'
  '結帳時 LINE 身分遇到 NULL 會被擋下並引導補填(plan §2.3 順位 3)。'
  '總長上限 40:TapPay cardholder.email 的限制(2026-08-09 sandbox 實測 40 過 / 41 回 521 '
  'Out of range : cardholder > email),上限在應用層 zod 執法、此處不設 CHECK 以免規則兩處分岔。';

-- ============================================================================
-- rollback(需要時手動執行;🔴 會丟掉已填資料,先退應用層再跑)
-- ============================================================================
-- ALTER TABLE public.customer_addresses DROP COLUMN email;
