-- 20260831140000_m4b_customers_gender.sql
-- ⟦客戶篩選多軸 + 註冊表單加性別⟧ 片 B-1:`customers` 加 `gender` 欄。
--
-- ══ 拍板(三格,都不是我判的)═══════════════════════════════════════════════
--   Sean 2026-08-26 逐字「不用改隱私正政策,直接做性別」⇒ 收集性別本身已解鎖。
--   Sean 2026-08-31 答【甲】:照做,而它**只涵蓋 Email 註冊的人**(見下方 §0)。
--   Sean 2026-08-23 逐字「不用回去問,現在都是假帳號」⇒ **既有列不回填**。
--   選項字面 = Sean `Q3`=乙「不透露」(他答過兩次:08-16 `Q2`=甲「不願透露」、08-26 `Q11`=甲)
--     ⇒ 統一為 `不透露`,**不要再問第四次**。
--
-- ══ 🔴🔴 §0 這一欄【誰會有值、誰恆 NULL】—— 寫在這裡,因為做報表的人不會讀 plan ══
--   註冊有三條路,而**只有一條經過我們那張表單**:
--     ① Email 表單  `/register` → RegisterPage → registerAction → auth.signUp   ⇒ ✅ 會填這一欄
--     ② Google 一鍵 `LoginPage.tsx:128` `signInWithOAuth({provider:'google'})`  ⇒ 🔴 **恆 NULL**
--     ③ LINE        `lib/auth/line-admin.ts:82` `app_metadata.pcm_provider='line'` ⇒ 🔴 **恆 NULL**
--   ⇒ ②③ 的使用者**從頭到尾沒看過我們的任何欄位** —— 那是【結構】,不是漏做。
--   🛑 **所以「客人性別分布」這種報表【一定是偏的】,而那個偏差在報表上沒有形狀。**
--      正確的宣稱是「**用 Email 註冊的人**有收性別」,不是「註冊時有收性別」。
--   ⚠️ 而 `customers` **沒有任何一欄記錄【這個人從哪條路進來】**(provider 在 `auth.users`
--      的 `raw_app_meta_data`,而唯讀角色讀不到 `auth` schema —— 兩把鑰匙四發全 permission denied)
--      ⇒ **你無法事後把「有值的那群」與「Email 註冊的那群」對起來。**
--
-- ══ 為什麼是 text + CHECK 而不是 enum(而同一張表的 tier 是 enum)═══════════
--   🔴 這一格刻意與鄰居不一致,**不是不小心**:
--     全 repo `AS ENUM` 3 支 / `CHECK (... IN (...))` 38 支 ⇒ repo 慣例 = CHECK
--     而同一張表的 `tier` 是 enum(`20260523034911:8` `CREATE TYPE member_tier AS ENUM`)
--     ⇒ **兩個都合法的分母給相反的答案 ⇒ 改用【成本不對稱】判**:
--       enum 要改選項字面 ⇒ 重建 type + 改欄 + 重寫既有列(⚠️ 一般 PG 行為,**本專案未實測**)
--       CHECK 要改        ⇒ DROP CONSTRAINT + ADD CONSTRAINT,不動型別、不重寫列
--     📌 `tier` 是**我們自己的商業分級**(三級,我們說了算);性別選項是**社會用語**
--        ⇒ 它變的時候我們不會想付重建型別的錢。
--   (`-2d` 2026-08-31 批;理由逐字採用。)
--
-- ══ NULL 可 —— 這不是選擇,是推導 ═══════════════════════════════════════════
--   他拍「不回填」,而 NOT NULL 要嘛給 DEFAULT(= 替既有列**編**一個性別)、要嘛先回填
--   ⇒ **「不回填 + NOT NULL」邏輯上不能並存** ⇒ 只能可 NULL。
--
-- ══ 不 apply ══════════════════════════════════════════════════════════════
--   本檔由 Sean 本人在 SQL Editor 貼;施工窗不 apply、不碰正式庫。
--   🔵 交付走**檔案**(沿 `20260831020000` / `20260831010000` 兩次的教訓:
--      說明文字不與 SQL 放在同一種框裡,否則會被一起貼進去而 42601)。
--   ⚠️ 前置:**B-2(註冊表單加那一欄)要等本檔 apply 之後才有欄位可寫。**
--      而 B-1 與 B-2 **不能只做一半** —— 實例就在同一張表上:`birthday` 欄在 schema 裡
--      而註冊表單沒有在收 ⇒ 既有 14 筆裡**只有 2 筆有值**(2026-08-31 唯讀實查)。

-- ══ 🔴 0. 交易與逾時(codex 對抗審查 must-fix,2026-08-31)═══════════════════
--   codex 逐字:「兩次 `ALTER TABLE` 都需要取得強鎖,但整支沒有 `lock_timeout`。
--   若正式庫當時有長交易正在使用 `customers`,SQL Editor 可能長時間等待;
--   排隊中的 DDL 也可能連帶堵住後續流量。**資料列少只能讓 CHECK 掃描很快,
--   不能縮短「等待取得鎖」的時間。**」
--   🔴 而它不只是理論:**這個 repo 有 90 支 migration 已經在用 `lock_timeout`**
--   (`command grep -rl 'lock_timeout' supabase/migrations/ | wc -l` ⇒ 90;
--    負對照現造字面 ⇒ 0),house 值 = `'5s'`,形狀照 `20260811060000:54-58`。
--   ⇒ 📌 **我第一版沒寫它 —— 那不是「想到而省略」,是我沒去讀鄰居。**
BEGIN;

SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';
SET LOCAL transaction_timeout = '90s';

-- ══ 1. 加欄 ════════════════════════════════════════════════════════════════
-- 🔴 不用 `IF NOT EXISTS`:它把「撞到不一致」從 error 變成 silent skip
--    (照 precedent `20260820040000:71-72`)。
ALTER TABLE public.customers
  ADD COLUMN gender text;

-- ══ 2. CHECK(值域;NULL 由 CHECK 語意自動放行)══════════════════════════════
-- 🔵 `CHECK (col IN (...))` 在 col IS NULL 時求值為 NULL ⇒ 約束**不拒絕** ⇒ 既有列不受影響。
--    這正是「不回填」要的行為,而它是 SQL 三值邏輯的結果,不是我們額外開的例外。
ALTER TABLE public.customers
  ADD CONSTRAINT customers_gender_chk
    CHECK (gender IN ('男', '女', '不透露'));

-- ══ 3. COMMENT —— 🔴 這一段是本片的產出之一,不是裝飾 ═════════════════════
COMMENT ON COLUMN public.customers.gender IS
  '性別(選填)。值域:男 / 女 / 不透露(Sean Q3=乙)。'
  '🔴 只有【Email 註冊路徑】會填這一欄;Google / LINE 進來的使用者恆 NULL —— '
  '他們從頭到尾沒有看過我們的註冊表單,那是結構不是漏做。'
  '⇒ 任何「性別分布」的統計都只涵蓋 Email 註冊的那一群,而 customers 沒有欄位記錄'
  '註冊來源(provider 在 auth.users.raw_app_meta_data)⇒ 無法事後把兩群對起來。'
  'NULL 的意思是「沒有值」,它同時涵蓋「沒被問」與「問了沒填」,兩者分不開。';

COMMIT;
