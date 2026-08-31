-- 20260831150000_m4b_handle_new_auth_user_gender.sql
-- 片 B-2a:讓 `handle_new_auth_user()` 把 `gender` 一起搬進 `public.customers`。
--
-- ══ 為什麼需要這一支(而 B-2 原本被當成純前端片)═══════════════════════════
--   `gender` 送進 `auth.signUp` 的 `options.data` ⇒ 落進 `auth.users.raw_user_meta_data`
--   ⇒ 而建 `customers` 列的是這支 trigger 函式,**它寫死了欄位清單**
--   正式庫實查(2026-08-31 14:2x,唯讀 `pg_get_functiondef`,與 repo 唯一那一代逐字相同):
--     `INSERT INTO public.customers (user_id, email, name, phone)`
--   🛑 ⇒ **只做前端 = 表單上有那個下拉,而 `customers.gender` 永遠是 NULL。**
--
-- ══ 🔴🔴 兩個【會讓註冊整個失敗】的寫法,而它們都很自然 ═════════════════════
--   ① 照鄰居抄 `COALESCE(..., '')`(現行 name / phone 就是這樣寫的)
--      ⇒ 沒帶 gender 時填入 `''`,而 `''` **不在 `customers_gender_chk` 的值域裡**
--      ⇒ **Google / LINE 註冊全部炸掉** —— 他們結構上不會帶這個欄位。
--      📌 這是「照慣例做」會出事的實例,不是「照慣例比較貴」。
--   ② 直接 `NEW.raw_user_meta_data->>'gender'` 原樣寫進去
--      ⇒ 🔴 **而 `raw_user_meta_data` 是【客戶端送的】** —— `options.data` 是瀏覽器送的 JSON。
--      ⇒ 送一個不在值域裡的字串(打錯 / 舊版前端 / 有人手改請求)⇒ CHECK 違反
--      ⇒ **trigger 失敗 ⇒ 那個人註冊不成功。**
--      🛑 **⇒ 一個【客戶端送的值】直接落進一個【有 CHECK 的欄】,那個 CHECK 就變成一個 DoS 面。**
--   ✅ ⇒ 所以在 trigger 裡**收斂**,不信任前端:不認得的值一律當作沒填(NULL)。
--      (`-2d` 2026-08-31 指出 ②;寫法採它給的 CASE。)
--
-- ══ ⚠️ 那三個字面現在寫在【兩個地方】,而它們會漂 ═══════════════════════════
--   ① `customers_gender_chk` 的 CHECK(`20260831140000`)
--   ② 本函式的 CASE
--   🔴 **兩邊不同步時不會有任何東西紅**:CHECK 放寬而 CASE 沒跟 ⇒ 新值被靜靜吃成 NULL;
--      CASE 放寬而 CHECK 沒跟 ⇒ 回到上面 ② 那個 DoS 面。
--   ⇒ **改任何一邊,必須同一顆 commit 改另一邊**,並在驗收裡把兩邊的值集合各數一次、比相同。
--   (為什麼不用一個共用函式:那會讓這支 SECURITY DEFINER 的 trigger 多一個外部依賴,
--    而它的失敗代價是「每個新註冊的人都建不出列」⇒ 這裡選【重複兩份 + 明寫約束】。)
--
-- ══ 🔴 這一支比 B-1 危險一級 ═══════════════════════════════════════════════
--   B-1 加欄寫錯 ⇒ 多一個沒人用的欄。
--   **本支寫錯 ⇒ 每一個新註冊的人(三條路都是)都建不出 `customers` 列。**
--   ⇒ 拋棄式 PG 五個世界 + 一發負對照已跑,結果寫在 commit body 與 APPLIED.tsv。
--
-- ══ 不 apply ══════════════════════════════════════════════════════════════
--   由 Sean 本人在 SQL Editor 貼;施工窗不 apply。一次只貼這一支。
--   ⚠️ 前置:`20260831140000`(gender 欄 + CHECK)**必須先 apply** —— 否則本支寫入的欄不存在。
--   ⚠️ 後置:B-2b(前端表單送 `gender` 進 `options.data`)要在本支 apply 之後才有意義。

BEGIN;

SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';
SET LOCAL transaction_timeout = '90s';

-- ══ 0. 前置閘(fail-closed):欄與 CHECK 都在,才准改這支 trigger ═══════════
-- 🔴 沒有這一段的話,在「20260831140000 還沒 apply」的庫上 CREATE OR REPLACE 會成功,
--    而下一個註冊的人才會炸 —— 那是把失敗從【現在、對我】搬到【稍後、對客人】。
DO $gender_preflight$
BEGIN
  -- 🔴 codex R2 must-fix ③:原本只驗【欄存在】,沒驗【可為 NULL】。
  --    失敗情境:gender 若漂成 NOT NULL ⇒ 沒帶 / 不合法值經 CASE 收成 NULL ⇒ **註冊仍然失敗**
  --    ⇒ 這一片存在的目的(不讓註冊掛掉)整個落空,而前置閘照樣放行。
  IF NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_attribute
     WHERE attrelid    = 'public.customers'::regclass
       AND attname     = 'gender'
       AND NOT attisdropped
       AND NOT attnotnull                          -- 必須可為 NULL(見上)
       AND atttypid    = 'text'::regtype           -- 型別也要對
       AND attgenerated = ''                        -- 不是 generated 欄
  ) THEN
    RAISE EXCEPTION '前置未滿足:public.customers.gender 不存在 / 不是可為 NULL 的 text / 是 generated 欄 ⇒ 請先 apply 20260831140000';
  END IF;

  -- 🔴 codex R1 must-fix(2026-08-31):原本這裡【只比對 conname】。
  --    失敗情境(它給的):別張表剛好有同名 constraint、或 customers 上的同名 constraint
  --    已漂成較窄的值域 ⇒ 前置閘照樣通過 ⇒ 之後合法的「不透露」在 trigger 內撞 CHECK
  --    ⇒ **那個人註冊失敗**。而本段自稱 fail-closed ⇒ 這個洞是 must-fix。
  --    📌 ⇒ 這正是我在【驗收 B-1】時堅持「讀定義不讀名字」的那一條,
  --       而我在【自己的前置閘】裡沒有套用它。
  IF NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_constraint
     WHERE conname   = 'customers_gender_chk'
       AND conrelid  = 'public.customers'::regclass   -- 綁在【這張表】上
       AND contype   = 'c'                            -- 真的是 CHECK
       AND convalidated                               -- 已驗證(不是 NOT VALID)
       -- ⛔ ~~R2 曾在這裡加一條【比對完整 canonical 定義字串】~~ ⇒ **R3 把它判成 must-fix, 已移除。**
       --    🔴 R3 逐字:「`pg_get_constraintdef` 把 PostgreSQL 的**反編譯結果**當成穩定 schema identity。
       --       官方只把它定義為【反編譯重建】,不是原始 DDL;沒有保證跨版本維持逐字相同。」
       --       ⇒ 這些【合法且等價】的寫法會被誤擋:三個值換順序 / 顯式加 `gender IS NULL OR ...` /
       --         合法重建產生不同 cast 或括號 / 未來反編譯器改輸出格式
       --       ⇒ 📌 **它會變成一道【自己會壞,而壞的時候擋住正確的資料庫】的閘。**
       --    📌 而這一格是【第三輪換角度】才看得到的:R1/R2 都在問「這個框架裡還漏了什麼」,
       --       R2 的答案是【收更緊】—— 而收更緊正好製造了這個新失效。
       --       ⇒ R3 問的是「這個框架對不對」, 才看到收緊本身是病。
       --    ✅ 保留的是【結構】檢查(conrelid / contype / convalidated), 那些是 catalog 事實,
       --       不是反編譯字串 ⇒ 它們不會因為別人合法重寫而誤擋。
  ) THEN
    RAISE EXCEPTION
      '前置未滿足:customers_gender_chk 不存在 / 不在 public.customers 上 / 不是已驗證的 CHECK / 值域不含三個預期值 ⇒ 請先 apply 20260831140000';
  END IF;

  -- 🔴 同 must-fix:既有函式與 trigger 必須都在且互相綁定。
  --    否則 `CREATE OR REPLACE` 會變成【新建】一支函式 ⇒ 「既有 ACL 會被保留」這個假設不成立;
  --    而 trigger 若不在,本片改完【沒有任何東西會呼叫它】—— 那是一個安靜的空轉。
  IF NOT EXISTS (
    SELECT 1
      FROM pg_catalog.pg_trigger t
      JOIN pg_catalog.pg_proc p ON p.oid = t.tgfoid
     WHERE t.tgname     = 'on_auth_user_created'
       AND t.tgrelid    = 'auth.users'::regclass
       AND NOT t.tgisinternal
       AND p.proname    = 'handle_new_auth_user'
       AND p.pronamespace = 'public'::regnamespace
       -- 🔴 codex R2 must-fix ②:原本沒驗【它是不是還開著】與【事件對不對】。
       --    失敗情境:trigger 被 DISABLE、或漂成 UPDATE / STATEMENT 級
       --    ⇒ 過閘, 而結果一樣是【註冊後沒有建出 customers 列】。
       AND t.tgenabled <> 'D'                                  -- 沒有被 DISABLE
       AND pg_get_triggerdef(t.oid) LIKE '%AFTER INSERT%'       -- 事件仍是 AFTER INSERT
       AND pg_get_triggerdef(t.oid) LIKE '%FOR EACH ROW%'       -- 仍是 row 級
  ) THEN
    RAISE EXCEPTION
      '前置未滿足:on_auth_user_created 不存在 / 沒綁在 auth.users / 沒指向 public.handle_new_auth_user / 被停用 / 不是 AFTER INSERT FOR EACH ROW ⇒ 停止,不要盲目 CREATE OR REPLACE';
  END IF;
END
$gender_preflight$;

-- ══ 1. 函式 ═══════════════════════════════════════════════════════════════
-- 🔵 基準 = `20260523034911:278`(repo 唯一一代;而 2026-08-31 正式庫實查【與它逐字相同】)。
--    本次唯一的改動 = 多一個 gender 欄與它的 CASE;name / phone 兩條路一字未動。
CREATE OR REPLACE FUNCTION public.handle_new_auth_user()
RETURNS trigger AS $$
BEGIN
  INSERT INTO public.customers (user_id, email, name, phone, gender)
  VALUES (
    NEW.id,
    NEW.email,
    COALESCE(NEW.raw_user_meta_data->>'name', ''),
    COALESCE(NEW.raw_user_meta_data->>'phone', ''),
    -- 🔴 收斂,不信任前端:認得的三個值才收,其餘(含沒帶、空字串、亂送)一律 NULL。
    --    ⚠️ 這三個字面必須與 `customers_gender_chk` 的值域【逐字相同】—— 見檔頭那一節。
    CASE WHEN NEW.raw_user_meta_data->>'gender' IN ('男', '女', '不透露')
         THEN NEW.raw_user_meta_data->>'gender'
         ELSE NULL
    END
  );
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = '';

COMMENT ON FUNCTION public.handle_new_auth_user IS
  'M-1-14:auth.users 新增時自動建 public.customers row(對齊 Supabase 官方 social-login pattern)。'
  'name / phone / gender 從 raw_user_meta_data 取(register 時由 storefront 傳 options.data)。'
  'SECURITY DEFINER 必要(trigger 需以 owner 權限寫 public.customers)。'
  'Google / LINE OAuth 註冊也走此 trigger:Google 走 Supabase 內建 signInWithOAuth、'
  'LINE 走自寫 OAuth + Supabase Admin API createUser(都會觸發 auth.users insert)。'
  '🔴 gender 走 CASE 白名單收斂(20260831150000):raw_user_meta_data 是【客戶端送的】,'
  '直接寫進有 CHECK 的欄 ⇒ 送一個值域外的字串就會讓 trigger 失敗 ⇒ 那個人註冊不成功。'
  '⇒ 不認得的值一律當作沒填(NULL),而不是讓註冊掛掉。'
  '⚠️ 那三個字面與 customers_gender_chk 重複兩份 ⇒ 改一邊必須同一顆 commit 改另一邊。'
  '🔴 而 gender 只有【Email 註冊路徑】會帶;Google / LINE 進來的恆 NULL(結構,不是漏做)。';

COMMIT;
