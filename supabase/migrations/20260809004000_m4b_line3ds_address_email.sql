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
--   刻意**不採**本表既有的 `text DEFAULT ''` 慣例(phone / invoice_* 都是空字串當沒填):
--   本片需要區分「從來沒被要求填過」(既有列 => NULL)與「填了又清空」(應用層必填會擋),
--   plan §2.4 的舊地址升級動線正是靠這個區分決定「結帳當下要不要攔這位客人」。
--   空字串慣例會讓兩者長得一樣,那張矩陣就畫不出來。
--
--   不加 UNIQUE:Sean 拍板「可以接受客人用不同 email」,同一人多個地址亦可共用同一 email。
--   不加格式 CHECK:格式規則的單一真相在應用層 zod;DB 端加正規式 = 第二處要同步的規則。
--
-- 【GRANT / RLS】customer_addresses 走**表級** GRANT + own-only policy 四條
--   (20260523034911_init_customers_and_subtables.sql:236 / :166-179)=> 新欄自動涵蓋、無需另授權。
--   🔴 但 apply 後仍要**實跑**驗證新欄真的讀寫得到 —— 表級 ACL 攤平看不到欄級差異(既有教訓)。
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
