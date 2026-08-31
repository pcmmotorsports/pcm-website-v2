import 'server-only';
import { createSupabaseServiceClient } from '@pcm/adapters/server';

// variant-sku-collision.ts — 偵測「這支商品看起來是【別支商品的一個規格】」。
//
// 🔴🔴 **它擋的不是今天, 是它們【下次長回來】那一刻**(板 `⟦b4-NOVARIANT1⟧`;Sean 2026-08-31 拍 `Q2=甲`)。
//    2026-08-31 唯讀正式庫實量:命中 8 支, 而那 8 支**架上 0 支、歷來被下單 0 行**
//    ⇒ 📌 **今天沒有人撞得到, 而那不等於修好了** —— 它們只是被【下架】不是被刪除,
//      後台按一下上架就回到架上。
//
// 📎 那 8 支的來歷(2026-08-31 兩個 repo 各自量到底, 完整因果在板 `:503` 那一列):
//    來源那側 view 逐字 `COALESCE(NULLIF(p.group_code, ''), upper(p.sku)) AS main_sku`
//    ⇒ `group_code` 空的時候 fallback 成 `upper(sku)` ⇒ 那幾列各自成一群
//    ⇒ 我們的匯入照著建出「商品」, 而它們其實是別支商品的規格。
//    ⚠️ 而來源那側 `group_code` **沒有 NOT NULL 也沒有 CHECK** ⇒ **今天 0 顆, 明天不保證。**
//
// ── 🛑🛑 這把尺的兩格天花板(plan 要求逐字寫在碼旁, 不是只寫在 plan)────────────
//
//  ① **它只認【這一個形狀】**:變體 sku 被當成商品的 `external_id`。
//     用**別的方式**產生的重複商品(例如兩支商品標題相同而料號不同)⇒ **它一支都抓不到。**
//
//  ② 🔴 **它靠【本尊還在】**:命中的條件是「有另一支商品的變體 sku 等於我的 external_id」
//     ⇒ 若那支本尊(例:`ARSV421-08`)哪天被刪掉, 它的變體跟著消失,
//       那幾支孤兒就**不再命中**, 而畫面上什麼都不會說。
//     ⇒ 📌 **這把尺會在資料變得【更糟】的時候變得更安靜。**
//        **多數尺在世界變糟時叫得更大聲 —— 而這一把相反。**
//
// ── 🔴 為什麼判準是【兩個條件】而不是一個(數字是量到的)────────────────────
//    只有「external_id 是某支別的商品的 variant sku」⇒ 全站命中 **34 支**,
//    而其中 **26 支是正常商品**(它們自己有變體, 只是料號恰好與別人的變體 sku 相同)
//    ⇒ **誤報 76%**。
//    加上「而它自己沒有任何變體」⇒ 命中**正好那 8 支**, 誤報 0。
//    ⇒ 🛑 **少掉第二個條件, 這道確認會對 26 支正常商品跳出來** ——
//      而那種確認會被一路按過去, 然後在真的該叫的那一次也一起被按掉。

/** 命中時回傳「它看起來屬於誰」;沒命中回 `null`。 */
export type VariantSkuCollision = {
  /** 被檢查的那支商品自己的料號。 */
  readonly externalId: string;
  /** 它看起來是【這一支】商品的規格(對方的料號)。 */
  readonly belongsToExternalId: string;
};

/**
 * 這支商品是不是「別支商品的一個規格」?
 *
 * 🔵 **唯讀** —— 只 SELECT,不寫任何東西。
 * 🛑 **查不到 / 查錯 ⇒ 回 `null`(= 不擋)**, 而那是刻意的:
 *    這是一道**確認**不是**封鎖**, 它的失敗方向必須是「不打擾」而不是「擋住上架」。
 *    ⇒ 📌 代價明寫:**DB 出問題時這道確認會安靜地消失**, 而畫面上與「這支商品沒問題」長得一樣。
 */
export async function findVariantSkuCollision(productId: string): Promise<VariantSkuCollision | null> {
  return runCollisionQuery(productId);
}

/**
 * 🔴 **與上面那支的差別:它把「查不出來」與「沒撞名」分開**(codex R1 #2/#3 must-fix)。
 *
 * ⛔ ~~原本只有一支函式, 任何錯誤都回 `null`~~ —— 而 `null` 的意思是【沒撞名, 放行】
 *    ⇒ 📌 **DB 出問題時, 那道確認會安靜地變成「這支商品沒問題」。**
 * ⇒ 現在:`'unavailable'` = 我查不出來(呼叫端自己決定要不要擋)。
 * 🔴 而「錯誤一律回 null」那句我原本寫在檔頭 —— **它當時是假的**:
 *    client 建立或 query 直接 `throw` 時根本沒有被接住(codex R1 #3)。**現在真的接住了。**
 */
export async function findVariantSkuCollisionOrUnavailable(
  productId: string,
): Promise<VariantSkuCollision | null | 'unavailable'> {
  try {
    return await runCollisionQuery(productId, { strict: true });
  } catch (error) {
    console.error('[admin/products] variant-sku-collision 查詢丟例外', error);
    return 'unavailable';
  }
}

async function runCollisionQuery(
  productId: string,
  opts?: { strict?: boolean },
): Promise<VariantSkuCollision | null> {
  const strict = opts?.strict === true;
  /** strict 模式下把「查不出來」往上拋, 由呼叫端決定;非 strict 回 null(不打擾)。 */
  const giveUp = (why: string): null => {
    if (strict) throw new Error(`variant-sku-collision:${why}`);
    return null;
  };
  const sb = createSupabaseServiceClient();

  const self = await sb.from('products').select('external_id').eq('id', productId).maybeSingle();
  const externalId = self.data?.external_id;
  if (self.error) return giveUp('讀不到這支商品的料號');
  if (typeof externalId !== 'string' || externalId === '') return null;

  // 條件一:有【別支商品】的變體 sku 等於我的料號。
  // 🔴 `neq('product_id', productId)` 這一格是必要的 —— 少了它,
  //    一支「料號 = 自己第一個變體 sku」的**正常**商品會命中自己。
  //    (全站有 15,060 支商品的 external_id 等於它自己的某個變體 sku ⇒ 那是完全正常的形狀。)
  const owner = await sb
    .from('product_variants')
    .select('sku, product_id, products!inner(external_id)')
    .eq('sku', externalId)
    .neq('product_id', productId)
    .limit(1)
    .maybeSingle();
  if (owner.error) return giveUp('讀不到變體歸屬');
  if (!owner.data) return null;

  // 條件二:而我自己【沒有任何變體】。
  // 🔴 缺這一格 ⇒ 誤報 76%(見檔頭那段量測)。
  const mine = await sb.from('product_variants').select('id').eq('product_id', productId).limit(1);
  if (mine.error) return giveUp('讀不到這支商品自己的變體');
  if ((mine.data?.length ?? 0) > 0) return null;

  const belongsTo = (owner.data as { products?: { external_id?: unknown } }).products?.external_id;
  if (typeof belongsTo !== 'string' || belongsTo === '') return null;

  return { externalId, belongsToExternalId: belongsTo };
}
