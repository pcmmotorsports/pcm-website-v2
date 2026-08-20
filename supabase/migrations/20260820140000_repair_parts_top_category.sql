-- ============================================================
-- 維修零件:補【大類 + 子類】兩列(加法,舊列不動)
-- ============================================================
-- plan 真權威:~/pcm-mailbox/W1-104-plan-件二-維修零件大類-加法-20260820.md(807 行,W9e 審過)
-- 交接:      ~/pcm-mailbox/W1-105-交接-20260820-收工.md
-- 前例:      20260811120000_m4b_storefront_412_service_other_category.sql(同款「大類+子類」加法)
-- 授權:      鐵則 8:2026-08-20 深夜 Sean 對「那 807 行的件二 plan,你算批准了嗎」逐字答 **「算」**,
--            明確追認批准(選項是「算 | 我要先看」,他選「算」)。
--            🔴 **而他答的是【要不要算批准】這一題,不是【他逐條看過那 807 行】** ——
--            那兩件事今晚仍然不同,**下一個人不要用前者推後者**。
--            (先前的口頭起點是「現在就開始寫,今天不用睡」,那句話是「開工」不是「我看過了」。)
--
-- ── 為什麼要這兩列 ────────────────────────────────────────────
-- 報價單側要把 products.major_category_v2_zh 從「服務與其他」改成「維修零件」(sub 欄不動)。
-- 我方 import 以「大類 · 子類」組 raw_path 解析到【子類】id(scripts/rpm-import.ts:257 逐字
--   pairs.add(major_category_v2_zh + CATEGORY_PATH_SEP + sub_category_v2_zh)),
-- 查無 ⇒ unseededSubGroups > 0 ⇒ **WRITE 模式在 upsert 前 throw、整批不寫**(:350)。
-- ⇒ 新鍵 = '維修零件 · 維修零件'。而**大類自己也要一列** —— 樹的頂層與 rollup 篩選都吃它。
--
-- 🔴 停更面積比件一大:件一是 EBC 一家;本片的來源橫跨 bonamici / evotech / lightech
--   (matrix fail-fast:false ⇒ 三個 job 各自 abort,不互相拖)。
--
-- ── 為什麼是【加法】不是【改名】────────────────────────────────
-- 查無的後果是【整批 abort】不是【部分髒】⇒ 任何一刻兩邊不同步,那幾家就完全停更。
-- 加法讓新舊兩種來源狀態都查得到 ⇒ 誰先誰後都不會破口。舊的兩列本片一個字不動。
--
-- ── 🔴 這一片與件一不同的地方(不要照件一抄)──────────────────
-- ① **本檔沒有 SET LOCAL / 沒有 row lock。** 件一有,是因為它的斷言跨語句 ⇒ 中間有併發窗。
--    本檔整支是**單一 DO 區塊 = 一個語句** ⇒ 沒有跨語句的窗要保護,INSERT 走 ON CONFLICT 本身就防撞。
--    形狀與理由同 `20260811120000`(該檔檔頭記了繞三圈才收斂的完整脈絡,**不要再繞一次**)。
-- ② **`sort_order` 刻意【不】進 DO UPDATE 的 SET 清單**(對齊 `20260811120000:186` 的既有裁定)。
--    🔴 **W3 2026-08-20 nit-1 更正了我第一版的理由,照實記**:我原本寫「本片兩列都是新造的、
--    沒有錯值要收斂」—— 而 `ON CONFLICT … DO UPDATE` **只在它們【不是】新造的時候才執行**
--    ⇒ 那個理由在它自己治理的那個分支上**不成立**。
--    ✅ 正確的理由:重放/別人先建過的情況下,`sort_order` 是「**別人可能刻意調過**」的欄,
--       本檔不該默默把它改回 1001。
--    🔴 而那留下一個真的洞:若既有值是 **0**(DEFAULT 漏出來),本檔不會收斂它,
--       側欄會把它排到所有大類之前。⇒ 補 **斷言①-d** 擋這個值。
--       ⚠️ 原本這一格只由結尾的 `RAISE NOTICE` surface,而**「SQL Editor 顯不顯示 NOTICE」
--          今晚實測未確認**(W3 指出)⇒ 用 NOTICE 當唯一出口 = 那個值可能沒有人看得到。
--
-- ── 🔴 本檔【不寫 products 一列】,而且有斷言在守 ────────────────
-- 那 820 群的搬移是 **import 做的,不是 migration 做的**(rpm-import 每輪重寫 category_id)。
-- 斷言④拍全表 (id, category_id) 指紋、跑完再比 ⇒ 搬移/新增/刪除三種都會炸。
-- ⚠️ 它守不到 products 的**其他欄位**(價格、標題…)—— 那要靠讀本檔(全檔零 products 的
--    INSERT/UPDATE/DELETE 敘述)。**不要把它引用成「零 products 寫入」的全稱證明。**
--
-- ── 🔴 中文字面:全檔只有【一個】,而且它不是新打的 ──────────────
-- 唯一手打 = 查找鍵 '服務與其他 · 維修零件',與 `20260811120000:199` **逐字相同**(已 diff,0 差異)。
-- **新的兩個值(維修零件 / 維修零件 · 維修零件)一個字都不手打**,由該列 raw_path 的右半 derive。
-- 分隔符另有 byte 前置斷言(必須是 20c2b720 = 半形空格 + C2 B7 + 半形空格)。
-- 實測(2026-08-20 21:3x,唯讀):右半 hex = e7b6ade4bfaee99bb6e4bbb6,與報價單側回報的值逐字相同。
--
-- ── 🔴 本片【沒有做完】的那一半 ────────────────────────────────
-- 820 群裡有 **123 群是 extreme**,而 `.github/workflows/rpm-sync.yml:73` 的 matrix **沒有 extreme**
-- ⇒ 排程只會搬走 697 群;那 123 群要一次人工授權的 `--confirm-write`(backlog **#799**)。
-- ⇒ **A10 沒過之前,本片的狀態是【進行中】,不是【做完】。** 判準見 plan §8-完。
--
-- ── 🔴 apply 之後的記帳(W3 nit-2)────────────────────────────────
-- 本檔 `grep -c -E '^BEGIN;|^COMMIT;'` ⇒ **0**(今晚那六支各帶 2)⇒ 它是 **MCP 形狀**
-- ⇒ 走 `apply_migration` 時**版本號由平台現場指派、與檔名的 20260820140000 對不上**
-- ⇒ **`supabase/APPLIED.tsv` 兩個號都要記**:檔名這個號 + 帳本實際拿到的那個號。
--    (只記一個 ⇒ 下一個人用檔名去 `schema_migrations` 查會查無,然後以為沒套。)
--
-- ── 實跑到哪裡(2026-08-21 更新;**原句已過期,見本段末的說明**)──────────
-- ✅ 在【拋棄式 PG】上實跑過:前置三道、四道斷言、rollback 全部跑過,
--    **十發突變靶每一發紅在自己的訊息上**(不是「有紅就算」);
--    冪等連跑三次終態指紋逐字相同;rollback 後 categories 與 products 指紋逐字回到套之前。
-- 🔴 效度限制不放寬:拋棄式庫證的是「這支 SQL 在【它的前置】下會怎麼跑」,
--    **不證正式庫的完整結構下也一樣** —— 本機沒有其他 27 顆分類、820 件真商品、RLS 實際角色。
-- 🔴 **斷言③(舊子類還在)構造不出來讓它開火** —— 那一發被前置②攔在前面;
--    它只在「有別的交易在中途刪掉那一列」時才到得了。**標【未表演到】,不標【通過】。**
-- 🔴 **正式庫仍未 apply 過 —— apply 的人是第一個在正式結構上驗證的人。**
--
-- 📌 **本段原本寫的是「本檔的 SQL 一次都沒跑過」,而那句在實跑之後就不成立了。**
--    它是在 commit 之後、apply 之前被讀到才發現的。
--    🔴 **作者寫下的限定,與執行者讀到的限定,中間有一段時間差 —— 而限定會在那段時間裡過期。**
--    ⇒ 過期的限定比沒有限定更糟:它讓讀的人**以為沒有人驗過**,然後重做一次,
--      或反過來,以為「已驗」的部分也一樣可疑。**改它,不要刪它** —— 它要防的事仍然值得防。
-- ============================================================

DO $mig$
DECLARE
  v_sep         text := ' · ';
  v_src         text := '服務與其他 · 維修零件';   -- 全檔唯一的中文字面;= 20260811120000:199
  v_leaf        text;
  v_new_top     text;
  v_new_sub     text;
  v_top_id      uuid;
  v_sub_parent  uuid;
  v_before_n    bigint;
  v_before_fp   text;
  v_after_n     bigint;
  v_after_fp    text;
  v_before_ids  text;   -- MF-1:只有 id 的指紋(用來證明上面那支【真的】含 category_id)
BEGIN

  -- ── 前置① 分隔符的 byte(打成全形點/半形點/日文中黑點都會在這裡炸,而不是靜默建錯鍵)
  IF encode(convert_to(v_sep, 'UTF8'), 'hex') <> '20c2b720' THEN
    RAISE EXCEPTION
      '維修零件:分隔符 byte 應為 20c2b720(半形空格 + C2B7 + 半形空格),實得 %;拒繼續',
      encode(convert_to(v_sep, 'UTF8'), 'hex');
  END IF;

  -- ── 前置② 來源那一列必須恰一列(查找鍵打錯 ⇒ 這裡炸,不會靜默 0 列往下走)
  IF (SELECT count(*) FROM public.categories WHERE raw_path = v_src) <> 1 THEN
    RAISE EXCEPTION
      '維修零件:來源列 raw_path=% 應恰 1 列,實得 % 列;拒繼續',
      v_src, (SELECT count(*) FROM public.categories WHERE raw_path = v_src);
  END IF;

  -- ── derive:新值全部從來源那一列的右半長出來,零手打
  SELECT split_part(raw_path, v_sep, 2) INTO v_leaf
    FROM public.categories WHERE raw_path = v_src;
  IF v_leaf IS NULL OR v_leaf = '' THEN
    RAISE EXCEPTION '維修零件:來源列 % 切不出右半(分隔符不符?);拒繼續', v_src;
  END IF;
  v_new_top := v_leaf;
  v_new_sub := v_leaf || v_sep || v_leaf;

  -- ── 前置③ 新大類的鍵若已存在,必須本來就是頂層(存在但不是頂層 ⇒ 本片的假設整個不成立)
  IF EXISTS (
    SELECT 1 FROM public.categories
     WHERE raw_path = v_new_top AND parent_category_id IS NOT NULL
  ) THEN
    RAISE EXCEPTION '維修零件:% 已存在但不是頂層 —— 本片會把它從別人的子類搶成大類;拒繼續', v_new_top;
  END IF;

  -- ── 0. 寫入前全表指紋(給斷言④;形狀照 20260811120000:165-172)
  --    存完整 ordered serialization 而不是它的 md5:md5 會碰撞,而 string_agg 本來就要先組出
  --    完整字串才餵得進 md5 ⇒ 直接比完整字串不多花聚合記憶體。md5 只留在錯誤訊息裡當人眼短碼。
  SELECT count(*),
         coalesce(string_agg(p.id::text || ':' || p.category_id::text, ',' ORDER BY p.id), ''),
         coalesce(string_agg(p.id::text, ',' ORDER BY p.id), '')
    INTO v_before_n, v_before_fp, v_before_ids
    FROM public.products p;

  -- 🔴 MF-1(W3 2026-08-20):**斷言④ 那支指紋自己從來沒有被表演過。**
  --    失敗情境:有人重構 string_agg 時把 `|| ':' || p.category_id::text` 寫掉
  --    ⇒ 指紋只認 id ⇒ **級聯搬移(商品換分類)發生時,斷言④ 照樣綠。**
  --    ⇒ 這一條就是那支指紋的正向對照:它必須與「只有 id」的那支**不相等**。
  --    ⚠️ 空表時兩支都是 '' ⇒ 必然相等 ⇒ 只在 v_before_n > 0 時才有判別力(空庫重放照樣過)。
  IF v_before_n > 0 AND v_before_fp IS NOT DISTINCT FROM v_before_ids THEN
    RAISE EXCEPTION
      '維修零件 斷言④-0:products 指紋與「只有 id」的指紋相同 —— 它沒有含 category_id,'
      '斷言④ 對「商品被搬去別的分類」是瞎的;拒繼續';
  END IF;

  -- ── 1. 新大類(頂層)
  INSERT INTO public.categories (name, raw_path, parent_category_id, sort_order, segments)
  VALUES (v_new_top, v_new_top, NULL, 1001, to_jsonb(ARRAY[v_new_top]))
  ON CONFLICT (raw_path) DO UPDATE
     SET name               = EXCLUDED.name,
         parent_category_id = EXCLUDED.parent_category_id,
         segments           = EXCLUDED.segments,
         updated_at         = now();
  -- sort_order 1001:v2 大類是 10..140、未分類 999、服務與其他 1000(2026-08-20 21:2x 唯讀實測)。
  -- 🔴 給 1000 會與「服務與其他」同值,而 category-taxonomy.ts:44 逐字 `.sort((a,b)=>a.sortOrder-b.sortOrder)`
  --    **沒有 tie-break** ⇒ 側欄相對順序未定義。那正是件一的已知 nit③,本片不複製它。
  -- 🔴 `sort_order` 不進 DO UPDATE:見檔頭「與件一不同的地方 ②」。
  -- 🔴 `name` / `parent_category_id` / `segments` **必須**收斂(不可寫 DO NOTHING):
  --    「那一列已存在但 name 錯」會靜默通過,而前端磚牆排除是拿 `name` 逐字比對的
  --    (CategoryGrid.tsx 的 HOME_WALL_EXCLUDED)⇒ name 一旦不對,那顆分類就會爬上首頁,
  --    而 migration 顯示成功。前例逐字:20260811120000:187-188。

  SELECT id INTO v_top_id
    FROM public.categories
   WHERE raw_path = v_new_top AND parent_category_id IS NULL;
  IF v_top_id IS NULL THEN
    RAISE EXCEPTION '維修零件 斷言①:新大類 % 不存在或不是頂層 —— 上一段沒生效', v_new_top;
  END IF;

  -- ── 2. 新子類
  INSERT INTO public.categories (name, raw_path, parent_category_id, sort_order, segments)
  VALUES (v_leaf, v_new_sub, v_top_id, 10, to_jsonb(string_to_array(v_new_sub, v_sep)))
  ON CONFLICT (raw_path) DO UPDATE
     SET name               = EXCLUDED.name,
         parent_category_id = EXCLUDED.parent_category_id,
         segments           = EXCLUDED.segments,
         updated_at         = now();
  -- sort_order 10 = 沿用舊子類實測值(該大類底下只有這一個子類、值不影響順序,但明寫、不吃 DEFAULT 0)。
  -- segments 由 raw_path 切出來、不手打(20260712120000:9-10 的既有慣例)。

  -- ── 3. 斷言(全部與資料量無關 ⇒ 空庫重放照樣有效)

  --   ①-b 大類的 name 逐字對:前端磚牆排除清單比對的就是這個字面
  --   🔴 **codex 關卡2 MF-2**:純量比較一律用 `IS DISTINCT FROM`,不用 `<>`。
  --       理由:`<>` 遇到 NULL 回 NULL ⇒ `IF NULL` **不會進去** ⇒ 斷言靜默通過。
  --       欄位本身是 NOT NULL(name/segments,`20260505130758:41,43`)⇒ 這一格目前不可達;
  --       🔴 **而 `segments->>N` 抽出來的元素【真的可能是 NULL】**(實測 `'[null]'::jsonb->>0` ⇒ NULL)
  --       ⇒ 下面兩處 segments 的元素比較是真的入口,一併改。
  --       ⚠️ 可達性:categories 上**零 trigger**(實測 `pg_trigger` 查無)⇒ 本檔寫進去的值不會被改寫
  --          ⇒ 我**構造不出**能走到這裡的路徑。**折它是因為零成本 + 這是 fail-closed 斷言**,
  --            不是因為我證明了它會發生。
  IF (SELECT name FROM public.categories WHERE id = v_top_id) IS DISTINCT FROM v_new_top THEN
    RAISE EXCEPTION
      '維修零件 斷言①-b:大類 name 是「%」不是「%」—— 前端排除清單會失效、它會爬上首頁磚牆',
      (SELECT name FROM public.categories WHERE id = v_top_id), v_new_top;
  END IF;
  IF (SELECT jsonb_array_length(segments) FROM public.categories WHERE id = v_top_id) IS DISTINCT FROM 1
     OR (SELECT segments->>0 FROM public.categories WHERE id = v_top_id) IS DISTINCT FROM v_new_top THEN
    RAISE EXCEPTION
      '維修零件 斷言①-c:大類 segments 不是 ["%"](實際 = %)',
      v_new_top, (SELECT segments::text FROM public.categories WHERE id = v_top_id);
  END IF;

  --   ①-d 大類 sort_order 不得是 0(nit-1):0 = DEFAULT 漏出來、或有人清掉了,
  --       而 category-taxonomy.ts:44 逐字 `.sort((a,b)=>a.sortOrder-b.sortOrder)`
  --       ⇒ 0 會把它排到**所有大類之前**(現存最小值是「操控部品」的 1)。
  --       🔴 這一條不與「不覆寫別人調過的值」衝突:**沒有人會刻意把它調成 0。**
  --   🔴 **codex 關卡2 MF-1(2026-08-20)**:第一版寫 `= 0`,而**負數一樣排在所有大類之前**。
  --       實跑重現:先塞一列 sort_order = **-5** ⇒ 本檔回 **rc=0 / NOTICE OK**,而終態 sort_order 仍是 -5
  --       ⇒ **斷言為真而世界是壞的。** 改成擋掉所有無效值。
  --       (`IS NULL` 目前不可達 —— `sort_order integer NOT NULL DEFAULT 0`,`20260505130758:44`;
  --        留著是因為它零成本,而 `NULL <= 0` 會回 NULL ⇒ IF 不進去 ⇒ 靜默放行,
  --        那正是本斷言最不該有的失敗形態。)
  IF (SELECT sort_order FROM public.categories WHERE id = v_top_id) IS NULL
     OR (SELECT sort_order FROM public.categories WHERE id = v_top_id) <= 0 THEN
    RAISE EXCEPTION
      '維修零件 斷言①-d:大類 sort_order = %(必須 > 0)—— 側欄會把它排到所有大類之前;'
      '本檔刻意不覆寫既有 sort_order,請人工設成 1001 再重跑',
      coalesce((SELECT sort_order FROM public.categories WHERE id = v_top_id)::text, 'NULL');
  END IF;

  --   ② 子類存在、parent 指向新大類、segments 兩段(分隔符打錯這裡會炸)
  SELECT parent_category_id INTO v_sub_parent
    FROM public.categories WHERE raw_path = v_new_sub;
  IF v_sub_parent IS NULL OR v_sub_parent <> v_top_id THEN
    RAISE EXCEPTION '維修零件 斷言②:子類 % 不存在或 parent 沒指向新大類', v_new_sub;
  END IF;
  IF (SELECT jsonb_array_length(segments) FROM public.categories WHERE raw_path = v_new_sub) IS DISTINCT FROM 2
     OR (SELECT segments->>0 FROM public.categories WHERE raw_path = v_new_sub) IS DISTINCT FROM v_new_top
     OR (SELECT segments->>1 FROM public.categories WHERE raw_path = v_new_sub) IS DISTINCT FROM v_leaf THEN
    RAISE EXCEPTION
      '維修零件 斷言②-b:子類 segments 不是 ["%","%"](實際 = %)—— 分隔符可能打錯',
      v_new_top, v_leaf, (SELECT segments::text FROM public.categories WHERE raw_path = v_new_sub);
  END IF;

  --   ③ 🔴 舊的那一列必須【還在】—— 本片是加法。它不見了 = 有人把它改名了,不是加法。
  IF (SELECT count(*) FROM public.categories WHERE raw_path = v_src) <> 1 THEN
    RAISE EXCEPTION '維修零件 斷言③:舊子類 % 不見了 —— 本片是加法,不該動它', v_src;
  END IF;

  --   ④ 🔴 本檔沒有動任何商品的分類歸屬(雙向:搬移=值變 / 新增=多一筆 / 刪除=少一筆,三種都會炸)
  --      比較用 IS DISTINCT FROM(兩邊都 NULL 不算差、單邊 NULL 算差)。
  SELECT count(*),
         coalesce(string_agg(p.id::text || ':' || p.category_id::text, ',' ORDER BY p.id), '')
    INTO v_after_n, v_after_fp
    FROM public.products p;
  IF v_after_n IS DISTINCT FROM v_before_n OR v_after_fp IS DISTINCT FROM v_before_fp THEN
    RAISE EXCEPTION
      '維修零件 斷言④:本檔動到了 products 的分類歸屬(跑前 % 筆/指紋 %,跑後 % 筆/指紋 %)—— 本片只該加分類列',
      v_before_n, left(md5(v_before_fp), 8), v_after_n, left(md5(v_after_fp), 8);
  END IF;

  RAISE NOTICE
    '維修零件 OK: 大類 %(id=%,sort_order=%) + 子類 % 已就位;products 全表 % 筆指紋未變。'
    '🔴 本片尚未完成 —— extreme 123 群要跑 backlog #799 那一發,A10 過了才算做完。',
    v_new_top, v_top_id,
    (SELECT sort_order FROM public.categories WHERE id = v_top_id),
    v_new_sub, v_after_n;
END
$mig$;

-- ============================================================
-- ── rollback(**不是自動的**;要人判、要停同步、要用對的角色)────
-- ============================================================
-- 🔴 有效期 = 一個【可查詢的狀態】,不是一個【事件】:
--    子類的窗在「第一輪同步把 697 群寫進來」的那一刻關掉。
--    大類的窗只要沒有別的子類掛上來就一直開著,但刪它之前必須先刪子類。
--    ⇒ 實際有效期 = 兩者交集 = **到第一輪同步為止**。
--    窗關了之後的回退路 = 停同步 → 回退報價單側的 major → 重跑一輪 → 再驗。**不是 DELETE。**
--
-- 🔴 前置(流程不是 SQL):**先停掉同步** —— 鎖只鎖得住已存在的列,鎖不住 importer 待會要 INSERT 的。
--
--   BEGIN;
--
--     -- 角色 fail-closed:用 anon 跑,RLS `USING (delisted_at IS NULL)`(20260602135934:15)
--     -- 會藏掉已下架的引用列 ⇒ 得到假 0 ⇒ DELETE 撞 FK,而那看起來像「窗還開著」。
--     DO $rb$
--     BEGIN
--       IF current_user NOT IN ('postgres', 'service_role') THEN
--         RAISE EXCEPTION 'rollback 必須以 postgres / service_role 執行,當前是 %;拒繼續', current_user;
--       END IF;
--     END $rb$;
--
--     SELECT id FROM public.categories
--      WHERE raw_path IN ('維修零件', '維修零件 · 維修零件') FOR UPDATE;
--
--     -- 🔴 四個引用一起數。大類那格【不能】用 child_refs = 0 ——
--     --    本片自己建的子類就掛在它上面 ⇒ 那條判準從第一秒起就不成立,
--     --    而它看起來像「窗已經關了」,不像「判準寫錯了」。
--     SELECT
--       (SELECT count(*) FROM public.products p
--         WHERE p.category_id = (SELECT id FROM public.categories WHERE raw_path='維修零件 · 維修零件'))
--         AS sub_product_refs,
--       (SELECT count(*) FROM public.categories c
--         WHERE c.parent_category_id = (SELECT id FROM public.categories WHERE raw_path='維修零件 · 維修零件'))
--         AS sub_child_refs,
--       (SELECT count(*) FROM public.products p
--         WHERE p.category_id = (SELECT id FROM public.categories WHERE raw_path='維修零件'))
--         AS top_product_refs,
--       (SELECT count(*) FROM public.categories c
--         WHERE c.parent_category_id = (SELECT id FROM public.categories WHERE raw_path='維修零件')
--           AND c.raw_path <> '維修零件 · 維修零件')
--         AS top_other_child_refs;
--     -- 四個都是 0 才往下;任一非 0 ⇒ ROLLBACK
--
--     DELETE FROM public.categories WHERE raw_path = '維修零件 · 維修零件';   -- 先子
--     DELETE FROM public.categories WHERE raw_path = '維修零件';              -- 後父
--
--     -- 刪除後的存在性斷言:DELETE 0 列不會報錯,只有這一條分得出來。
--     DO $rb2$
--     DECLARE v_left integer;
--     BEGIN
--       SELECT count(*) INTO v_left FROM public.categories
--        WHERE raw_path IN ('維修零件', '維修零件 · 維修零件');
--       IF v_left <> 0 THEN
--         RAISE EXCEPTION 'rollback:刪除後仍有 % 列 —— 沒有真的刪掉,拒 COMMIT', v_left;
--       END IF;
--     END $rb2$;
--   COMMIT;
--
-- ── 已知代價 / 未解(不要當成沒有)──────────────────────────────
-- · 🔴 extreme 那 123 群不會被排程搬走 ⇒ 舊子類的引用數會停在 123 而**永遠不歸零**
--      ⇒ 「刪舊子類」那一片的前置條件跟著永遠不成立。處置 = backlog **#799**。
-- · 舊大類「服務與其他」**永遠不刪**:它直掛補差額賣場 1 件(manual/pcm),
--      且 `docs/specs/2026-07-24-m3-balance-payment-product-seed.sql:60-81` 會重建它。
-- · 過渡窗最長 900 秒(CATALOG_REVALIDATE_SECONDS,apps/storefront/src/lib/products.ts:132);
--      `revalidateTag('catalog')` 全 repo 零呼叫 ⇒ **沒辦法提早,只能等**。
-- · 🔴 **正式庫仍未 apply 過**;拋棄式 PG 的實跑範圍與效度限制見檔頭「實跑到哪裡」那一段。
--      (原句寫「一次都沒跑過」,2026-08-21 已更正 —— 那句在實跑之後就不成立了。)
-- ============================================================
