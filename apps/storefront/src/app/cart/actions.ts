'use server';

// app/cart/actions.ts — 購物車 line 解析 server action(M-3-S2-b2-d)
//
// 為何需要 server 解析:
//   cart 線契約(M-3-S2-b2-c)只存 { productId, variantId?, qty } —— **不存價、不存標題/圖**
//   (鐵則 12 + memory project_security-audit H-1:價由 server 依 tier 取、client 永不存價)。
//   購物車頁要顯示 標題 / 品牌 / 圖 / 適用車款 / 單價,故 client 把 line key 丟回 server,
//   server 依 productId(= handle/slug)查真資料、回 UI 顯示所需欄位 + 「general 公開單價」。
//
// ⛔ ~~🔴 釘 general(階段① general-only、階段⓪ 經銷價 tier-aware 硬 gate 未解)~~
// 🔴 **[2026-09-07 M-2-08 B2a 起這句不再成立]**:`tier === 'store'` 的人拿的是 store 價。
//    而 general / 未登入**仍然走原路**(那一段根本不執行)⇒ 舊字面對他們仍是對的, 對經銷商不是。
//    ⇒ 📌 舊字面留刪除線, 讓照它做判斷的人撞到這裡。原文:
//   走既有 fetchProductByHandle(@/lib/products)—— 該路徑已釘 'general'、且 server-side strip
//   priceByTier/store(public view 物理排除 price_store、UIVariant 型別無 priceByTier)。
//   本 action 回傳僅 `unitPrice: number`(= general)、**逐欄白名單、絕不夾帶 priceByTier/store/cost**。
//   tier-aware 購物車價待階段⓪ 解 gate + M-2-08 server-side pricing endpoint(同詳情頁 g-2 釘法)。
//
// 安全 / 信任邊界:
//   - 本 action 只解析「公開 general 價」(與 /products/[slug] 公開頁同一資料面)、無權限升級風險;
//     不需 auth gate(任何人本就能在詳情頁看到 general 價)。階段⓪ tier-aware 時才接 auth→customers.tier。
//   - 仍對 client 輸入 fail-closed:非陣列 / 非 {productId:string} / 超量 → 跳過或截斷
//     (品項上限 MAX_LINES 對齊 create_order RPC「品項≤200」、防濫用打爆 Supabase)。
//   - 找不到商品 / 變體已不存在(舊 cart stale)→ found:false,client 不顯示該行、不計入小計。

import { fetchProductByHandle } from '@/lib/products';
// ⟦auth-DEALERTIERPRICING⟧ M-2-08 B2a —— 見下方 `applyTierPrices` 那段。
import { fetchProductIdsByHandles } from '@/lib/products';
import { resolveAuthenticatedTierStrict } from '@/lib/tier';
import {
  fetchEffectivePrices,
  priceKey,
} from '@/lib/tier-prices';
import type { UIFitment } from '@/data/mock-products';

/** client 傳入的 line key(僅 productId + 選用 variantId;qty 由 client 自管、不影響單價解析)。 */
export type CartLineInput = {
  productId: string;
  variantId?: string;
};

/**
 * server 解析後回 client 的單行顯示資料。
 * 🔴 經銷防護:價格欄只有 `unitPrice`(general、整數元位 number)、無任何 tier/經銷結構。
 */
export type ResolvedCartLine = {
  /** 回 echo line key(client 用來對應回自己的 cart item;= handle/slug) */
  productId: string;
  /** 回 echo line key(無變體商品為 undefined) */
  variantId?: string;
  /** 商品 / 變體是否解析成功(false = stale cart entry,client 不顯示) */
  found: boolean;
  /** 商品連結用 slug(= productId,顯式回傳避免 client 重組) */
  slug: string;
  brand: string;
  name: string;
  /** 代表圖 URL(無圖 null,client fallback) */
  image: string | null;
  /** 適用車款衍生字串(design cart-item-vehicle「適用 X」) */
  fits: string;
  /** 變體識別字串(**純規格** spec 值合併;spec 空 or 無變體 → null;V-2a2 起不再 fallback sku) */
  variantLabel: string | null;
  /** 料號(V-2a2:變體=variant.sku;無變體商品無料號欄 → null;公開識別、無價格面) */
  sku: string | null;
  /** 🔴 公開單價(整數元位 NT$);**唯一價格欄、無 priceByTier/store/cost** */
  unitPrice: number;
  /**
   * 🔴🔴 **這個價是不是【未稅】的**(⟦auth-TIERTOTALBYPAYMENT⟧ B2b, codex must-fix)。
   *
   * `true`  = 經銷價(RPC `get_effective_prices` 給的, Sean Q24「未稅」)⇒ 呼叫端要外加營業稅
   * 省略/false = 一般價(含稅)⇒ 不得再加, 加了就是重複課稅
   *
   * 🛑 **為什麼掛在【每一列】而不是回傳一個總的 tier**:
   *   codex 2026-09-07 抓到 —— 結帳頁原本用 `checkout/page.tsx` 那一次**獨立查詢**得到的
   *   `memberTier` 決定加不加稅, 而**單價來自本 action 這一次查詢**。兩次查詢會分歧:
   *   ```
   *   page 那次讀 customers 失敗 ⇒ 退成 general ⇒ 不加稅
   *   本 action 這次成功        ⇒ 給的是 store 未稅價
   *   ⇒ 畫面顯示 1,100 而應該是 1,155 ⇒ 少收 5%, 而每一格都綠
   *   ```
   *   ⇒ 📌 **旗標跟著【那個數字】走, 就不可能與它分歧** —— 那是本欄存在的全部理由。
   */
  priceUntaxed?: boolean;
  /** V-2e:適用車款(UIFitment 公開欄白名單投影、與 PDP 同 shape;client 對 line vehicle 跑
   *  checkFitment 顯「可能不適用」;🔴 判定在 client=cart vehicle 不出站紅線不動)。 */
  fitments: UIFitment[];
};

/** V-2e:UIFitment 公開欄白名單投影(逐欄重建、不透傳整物件;yearEnd null=開放式語意保留、禁塌)。 */
function projectFitments(fitments: UIFitment[] | undefined): UIFitment[] {
  return (fitments ?? []).map((f) => ({
    motoBrand: f.motoBrand,
    modelCode: f.modelCode,
    ...(f.yearStart !== undefined ? { yearStart: f.yearStart } : {}),
    ...(f.yearEnd !== undefined ? { yearEnd: f.yearEnd } : {}),
  }));
}

// 品項上限:對齊 create_order RPC「品項≤200」fail-closed(防 client 送超量 line 打爆查詢)。
const MAX_LINES = 200;
// 單欄長度上限(public server action input、防超長字串濫用打 DB;productId=slug 約 ≤128、
// variantId=uuid 36)。超出 → 視為竄改、fail-closed 跳該行。
const MAX_PRODUCT_ID_LEN = 256;
const MAX_VARIANT_ID_LEN = 64;

/** 把變體 spec 物件壓成**純規格**顯示字串(值合併、去空);無有效值回 null。
 *  V-2a2:不再 fallback sku(料號改獨立 sku 欄恆顯,避免規格空時料號被塞進規格行=雙顯/語意混淆)。 */
function variantLabelFromSpec(spec: Record<string, string>): string | null {
  const values = Object.values(spec)
    .map((v) => (typeof v === 'string' ? v.trim() : ''))
    .filter((v) => v.length > 0);
  return values.length > 0 ? values.join(' · ') : null;
}

/**
 * 解析購物車 line keys → 顯示資料 + 單價(server-only)。
 * ⛔ ~~general 單價(釘 general)~~ ⇒ **2026-09-07 起:`tier === 'store'` 拿 store 價**,
 *    其餘一律 general(見尾端 M-2-08 B2a 那一段)。
 *
 * @param lines client cart items 的 line key 陣列(只 productId + variantId);非法 / 超量 fail-closed。
 * @returns 每行解析結果(found:false = 已下架 / 變體不存在,client 略過顯示)。
 */
export async function resolveCartLines(lines: unknown): Promise<ResolvedCartLine[]> {
  // fail-closed 輸入守門:非陣列 → 空;截斷至 MAX_LINES。
  if (!Array.isArray(lines)) return [];
  const safeLines = lines.slice(0, MAX_LINES);

  const out: ResolvedCartLine[] = [];
  for (const raw of safeLines) {
    if (!raw || typeof raw !== 'object') continue;
    const productIdRaw = (raw as { productId?: unknown }).productId;
    if (typeof productIdRaw !== 'string') continue;
    const productId = productIdRaw.trim();
    // 空 / 超長 productId → fail-closed 跳(防超長字串濫用)。
    if (productId.length === 0 || productId.length > MAX_PRODUCT_ID_LEN) continue;
    const variantIdRaw = (raw as { variantId?: unknown }).variantId;
    // variantId 出現但非 string(竄改:number/object/null 等)→ 整行 fail-closed 跳。
    // (不可退化成「無變體 → 群價」:該行原意為某變體、退化會回錯價〔群價=群內最低〕。
    //  genuine 無變體商品的 variantId 欄為 undefined〔localStorage JSON 省略〕、走下方正常路徑。)
    if (variantIdRaw !== undefined && typeof variantIdRaw !== 'string') continue;
    let variantId: string | undefined;
    if (typeof variantIdRaw === 'string') {
      const trimmed = variantIdRaw.trim();
      // 超長 variantId = 竄改 → 整行跳(不退化成無變體群價、避免錯價);空 → 無變體。
      if (trimmed.length > MAX_VARIANT_ID_LEN) continue;
      variantId = trimmed.length > 0 ? trimmed : undefined;
    }

    // fetchProductByHandle:server-only、cache() per-request(同 handle 多變體只查一次)、釘 general。
    const product = await fetchProductByHandle(productId);
    if (!product) {
      out.push({
        productId,
        variantId,
        found: false,
        slug: productId,
        brand: '',
        name: '',
        image: null,
        fits: '',
        variantLabel: null,
        sku: null,
        unitPrice: 0,
        fitments: [], // found:false 不渲染、無判定需求
      });
      continue;
    }

    let unitPrice: number;
    let variantLabel: string | null = null;
    let sku: string | null = null; // V-2a2:變體=variant.sku、無變體=null
    if (variantId) {
      const variant = (product.variants ?? []).find((v) => v.id === variantId);
      if (!variant) {
        // 變體已不存在(舊 cart stale / 商品改版)→ found:false。
        out.push({
          productId,
          variantId,
          found: false,
          slug: product.slug,
          brand: product.brand,
          name: product.name,
          image: product.image ?? null,
          fits: product.fits,
          variantLabel: null,
          sku: null,
          unitPrice: 0,
          fitments: [],
        });
        continue;
      }
      // 🔴 變體單價取 UIVariant.price(= priceByTier.general、唯一真值;toUIProduct 已 strip)。
      unitPrice = variant.price;
      variantLabel = variantLabelFromSpec(variant.spec);
      sku = variant.sku.trim().length > 0 ? variant.sku.trim() : null; // 料號恆顯(獨立行)
    } else if ((product.variants?.length ?? 0) > 0) {
      // 🔴 有變體商品卻未帶有效 variantId(省略 / 空字串 / 空白)→ fail-closed found:false。
      //   不退化成群代表價(群價 = 群內最低、回該價 = 錯價;對齊 round1 / 非-string variantId 同類)。
      out.push({
        productId,
        variantId,
        found: false,
        slug: product.slug,
        brand: product.brand,
        name: product.name,
        image: product.image ?? null,
        fits: product.fits,
        variantLabel: null,
        sku: null,
        unitPrice: 0,
        fitments: [],
      });
      continue;
    } else {
      // genuine 無變體商品(variants 空)→ 取群代表價(= general、toUIProduct product.price);不變、無回歸。
      unitPrice = product.price;
    }

    out.push({
      productId,
      variantId,
      found: true,
      slug: product.slug,
      brand: product.brand,
      name: product.name,
      image: product.image ?? null,
      fits: product.fits,
      variantLabel,
      sku,
      unitPrice,
      fitments: projectFitments(product.fitments), // V-2e:白名單投影(client 判「可能不適用」)
    });
  }

  // ══ ⟦auth-DEALERTIERPRICING⟧ M-2-08 B2a:經銷會員換成自己那個 tier 的價 ══
  //
  // 🔴🔴 **只有 tier === 'store' 才走這一段** —— 而那是安全邊界不是效能考量:
  //    RPC 貼板(68)之前正式庫裡沒有 `get_effective_prices` ⇒ 叫它會炸。
  //    ⇒ 若每個人都叫, **貼板之前全站的購物車都壞掉**。
  //    ✅ `resolveAuthenticatedTier()` 不需要 RPC 就查得到 tier ⇒ **general / 未登入根本不叫**
  //    ⇒ 📌 fail-closed 的射程收窄到【經銷商】, 而他們正是拿到錯價會被多收/少收的那群人。
  //
  // 🛑 **RPC 失敗 ⇒ 往上拋, 不靜默退回 general** —— 退回去會讓經銷商
  //    **用一般價結帳而畫面上完全正常**, 那是錢錯而它不會紅。
  //
  // 🔵 **今天正式庫零判別力**:25,769 件商品 + 59,841 個變體全無差價
  //    ⇒ 這一段上線後**畫面零改動**。那是 fail-safe 的方向, **不是沒生效**。
  // 🔴🔴 **codex R1 must-fix ①:`resolveAuthenticatedTier()` 的 tier 查詢【失敗時回 general】**
  //    (`lib/tier.ts` 檔頭自陳:任何不確定都回 general, 不得回經銷 tier)
  //    ⇒ 經銷會員在那個世界會**成功拿到一般價、而且根本不叫 RPC** ⇒ **同一個錢錯, 從另一個門進來。**
  //    🛑 而那支 helper 的降級方向【本身是對的】(它服務首頁 render, 不能讓 Supabase 一抖就 500)
  //      ⇒ 📌 **不改它, 改的是【購物車這條路要多問一句】**:
  //        「你確定他不是經銷商, 還是你只是查不到?」
  const tierResolved = await resolveAuthenticatedTierStrict();
  // 🔴🔴 **R3 must-fix ③:這道擋門的射程原本是【全部客人】, 而註解說的是【經銷商】。**
  //   ⛔ ~~原本 `if (!tierResolved.ok) throw`~~ —— 它在 `tier === 'store'` **上面**
  //     ⇒ 訪客與一般會員也跑得到 ⇒ Supabase 認證層一抖, **全站購物車與結帳頁一起掛掉**,
  //       而改動前這條路根本不碰 auth。📌 **我寫的註解宣稱射程收窄, 而碼沒有收窄。**
  //   ✅ 收窄成只擋 `reason === 'tier'` —— 那是**已經登入而 tier 讀不到**的人,
  //     也就是「他可能是經銷商而我不知道」那個世界;訪客與未登入者一格都不受影響。
  //   ⚠️ **殘餘風險明寫, 不自宣接受**:`reason === 'auth'`(認證層抖動)時, 一位經銷商
  //     會走 general —— 那與**改動前的行為一模一樣**, 而在 B2c 之後它會變成少收 5%。
  //     ⇒ 「認證抖動要選【全站掛掉】還是【經銷商可能少收】」**是 Sean 的題, 不是我的**,
  //       已進 QB 佇列;在他拍板之前, 這裡選的是**與改動前相同**的那一側。
  if (!tierResolved.ok && tierResolved.reason === 'tier') {
    throw new Error('tier price: 已登入而 tier 讀不到 ⇒ 不得以一般價結帳(可能是經銷會員)');
  }
  const tier = tierResolved.tier;
  if (tier === 'store' && out.length > 0) {
    const found = out.filter((l) => l.found);
    // 🔴 商品那半要 uuid, 而 UI 型別裡沒有 ⇒ 另外要一次(見 `fetchProductIdsByHandles` 檔頭)。
    const handles = [...new Set(found.filter((l) => !l.variantId).map((l) => l.productId))];
    const idByHandle = await fetchProductIdsByHandles(handles);
    const variantIds = [...new Set(found.map((l) => l.variantId).filter((v): v is string => !!v))];
    const priced = await fetchEffectivePrices({
      tier,
      productIds: [...idByHandle.values()],
      variantIds,
    });
    for (const line of out) {
      if (!line.found) continue;
      // 🔴🔴 **用 `(kind, id)` 配對, 不是只用 id**(codex 2026-09-07 指出)——
      //    同一個 uuid 可以同時出現在兩邊, 而**單用 id 建 Map 會互相覆蓋**
      //    ⇒ 一行會拿到另一行的價, 而兩邊都是合法的整數 ⇒ **看不出來。**
      const key = line.variantId
        ? priceKey('variant', line.variantId)
        : (() => {
            const uuid = idByHandle.get(line.productId);
            return uuid ? priceKey('product', uuid) : null;
          })();
      // 🔴🔴 **codex R1 must-fix ②:這三種「拿不到」以前都【保留 general 且 found:true】**
      //    ⇒ 經銷商用一般價結帳而畫面上完全正常 ⇒ **錢錯而它不會紅。**
      //    ⛔ ~~`continue` 保留 general~~ ⇒ ✅ **一律 throw** —— 與 RPC 拋錯同一個處置。
      //    📌 判準:**「我不知道這位經銷商該付多少」的每一種形狀, 結果都要一樣。**
      if (!key) {
        throw new Error(`tier price: 查不到 uuid(handle=${line.productId})⇒ 不得以 general 結帳`);
      }
      const amount = priced.get(key);
      if (typeof amount !== 'number') {
        // 🔵 RPC 少回一列的成因有兩種(商品在兩次查詢之間下架 / 資料壞掉),
        //    而**兩種都不該讓他用一般價買** ⇒ 不分。
        throw new Error(`tier price: RPC 沒回 ${key} 的價 ⇒ 不得以 general 結帳`);
      }
      line.unitPrice = amount;
      // 🔴 與上一行**同一個動作** —— 換價與標記未稅之間不准有第二個判斷。
      line.priceUntaxed = true;
    }
  }
  return out;
}
