// ProductInfo.tsx — 商品詳細頁右欄 pd-info column 子元件
//
// M-1-16c-3:由 mock hardcode(COLOR_MAP/sizeOptions/colorOptions 顏色×規格)改吃**真變體**。
// Sean Q1-4=A 拍板:
//   - Q1=A 規格選擇器全用文字按鈕(沿用 design .pd-size-grid/.pd-size-btn 樣式;紋路/表面無真實單色)
//   - Q2=A 規格顯中文(OD-4c 後標籤改 WEAVE_LABEL/FINISH_LABEL/SPECIAL_LABEL;未對照則 fallback 原值)
//   - Q3=A 資料驅動:每個 distinct 值 >1 的 spec key 各渲染一排(weave/finish/special 通吃、含未來擴充);
//          special 僅部分變體有 → 加「標準」(NONE)選項代表無特殊材質
//   - Q4=A 沿用 #161 不顯庫存(變體 availability 不顯、按鈕永遠可點、訂貨型業務)
//
// OD-4a/OD-4c 更新(supersede 上方 16c-3 Q3 的 3 排 weave/finish/special + 「標準」NONE 描述):
//   - OD-4a:selectedVariant 提升至 ProductPage(本元件受控、收 selectedVariant+onSelectVariant props),
//            ProductGallery 隨選變體換圖、mobile buybar 用真選中變體(上方「local state / 預設變體」描述已過時)。
//   - OD-4c:picker 折成 **2 維**(紋路 pattern = weave+special 合併、表面 finish),12K/Kevlar 折進紋路
//            (顯「12K斜紋」「Kevlar斜紋」)、移除「特殊」獨立欄 + NONE「標準」sentinel(Sean Q-OD4c-1/2=A);
//            消光不寫死鎖 —— 真資料 12K 亦有消光(D3=A 真資料為準、選項由 snap 決定)。
//
// 選了變體 → currentVariant(snap 最近、稀疏矩陣保證有效)→ 換價(displayPrice = selectedVariant.price)。
// 變體 UI 價 = priceByTier.general(toUIProduct 已 strip、不帶 priceByTier;詳情頁釘 general、無 NT$0)。
//
// 字面 vs 事實:design ProductPage.jsx 原是顏色 swatch + 規格 size grid(mock 色/尺寸);RPM 真變體是
//   紋路×表面(×特殊)、無「顏色」概念 → Q1=A 業務 override(鐵則 1 例外、Webike 式變體)。沿用 .pd-opt
//   /.pd-size-grid/.pd-size-btn 選擇器 chrome、只換資料源 + 標籤。
//
// 本片 selectedVariant 為 **local state**(16c-4 才提升 ProductPage 給 mobile buybar / gallery 共用);
//   mobile buybar(ProductPage)本片加購用 product 預設變體 = 記錄限制、16c-4 同步(codex 16c-3 k1 consider 2)。
//
// 向後相容:product.variants 空/undefined → 不渲染選擇器、價顯 product.price(mock / related 商品不破)。
//
// 'use client' 必要:useState / useMemo / useEffect + 互動 onClick。對齊 ADR-0006 §1 白名單「Hooks → 'use client'」。

'use client';

import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import type { MemberTier } from '@pcm/domain';
import type { MockProduct, UIVariant } from '@/data/mock-products';
import { useCart, overLimitMessage } from '@/contexts/CartContext';
import { useFavorites } from '@/contexts/FavoritesContext';
import { readSearchVehicle } from '@/lib/search-vehicle';
import { ProductSwatchPreview } from './ProductSwatchPreview';
import { ProductServices } from './ProductServices';
import { useQtyInput } from '@/hooks/useQtyInput';
import { VariantPicker } from './VariantPicker';
import { collectGenericDims, dimValueLabel, isRpmSpecShape, patternKey, sortDimValues, variantDimValue, type Dim, type SpecGroup } from './product-variant-dims';

// OD-4a:selectedVariant 狀態提升至 ProductPage(本元件受控)— picker 改它、ProductGallery 隨它換圖、
//   mobile buybar 用它(修 16c-3 buybar 只能用預設變體的限制)。
export type ProductInfoProps = {
  product: MockProduct;
  tier: MemberTier;
  selectedVariant: UIVariant | null;
  onSelectVariant: (variant: UIVariant | null) => void;
  /** RPM 才顯「泰國原廠」卡(卡級守門);由 ProductPage 依 brandSlug 傳入。預設 false。 */
  isRpmCarbon?: boolean;
};

export function ProductInfo({ product, tier, selectedVariant, onSelectVariant, isRpmCarbon = false }: ProductInfoProps) {
  const variants = product.variants ?? [];
  const hasVariants = variants.length > 0;

  // W2:RPM 形狀走現行合成 2 維;非 RPM 泛型模式(維 = spec 實際 key)。
  const rpmShape = useMemo(() => isRpmSpecShape(product.variants ?? []), [product.variants]);

  // OD-4c:派生選擇器維;只渲染 distinct >1 的維(資料驅動)。
  //   RPM = pattern / finish(pattern 已把 special 折入,見 patternKey);泛型 = collectGenericDims。
  const specGroups = useMemo<SpecGroup[]>(() => {
    const vs = product.variants ?? [];
    const dims: Dim[] = rpmShape ? ['pattern', 'finish'] : collectGenericDims(vs);
    return dims
      .map((dim) => {
        const values: string[] = [];
        for (const v of vs) {
          const val = variantDimValue(v, dim, rpmShape);
          // 泛型模式濾空值(對抗審 F1):spec key 不齊(如 eazigrip 主列 {} + 變體列 {color})
          //   會產生 '' 值 → 空白按鈕 + snap 污染;缺 key 變體仍可經其他維 + snap 選到。
          //   RPM 模式不濾(patternKey 可為 '' 是現行行為、byte 不變)。
          if (!rpmShape && val === '') continue;
          if (!values.includes(val)) values.push(val);
        }
        return { dim, values: sortDimValues(dim, values, rpmShape) };
      })
      .filter((g) => g.values.length > 1);
  }, [product.variants, rpmShape]);

  // 數量輸入狀態機已搬到 hooks/useQtyInput.ts(#888 刀C);承重註解隨碼在那支檔裡。
  //   `resetQty` 刻意留給元件呼叫 —— 搬那個 effect 會改 effect 執行順序(見 hook 檔頭)。
  const { qty, qtyText, setQtyText, qtyNotice, commitQty, resetQty } = useQtyInput();
  // M-4b #191:收藏改吃 FavoritesContext(與商品卡那顆同一個資料源)。
  const { isFavorite, toggleFavorite } = useFavorites();
  const liked = isFavorite(product.slug);
  const { addItem, items } = useCart();
  const router = useRouter();

  // product 變更 → reset qty(selectedVariant reset 在 ProductPage)
  useEffect(() => {
    resetQty();
  }, [product.variants, resetQty]);

  // ── A3:桌機按「加入購物車」零回饋(補洞窗)────────────────────────────────────
  // 病徵:在這之前 `addToCart` 只呼叫 `addItem` 就結束,**畫面完全不動** ——
  //   客人不知道按到了沒 ⇒ 再按三下 ⇒ 結帳才發現買了 4 個。
  //
  // 抄的形狀:手機列**已經有這個東西**(`ProductPage.tsx:288` 那條「已加入・數量」滑出列),
  //   桌機沒有。這裡不自創,照它:**「已加入」+ 車上那一列現在幾件**。
  //   桌機不重放一個數量控制項(上面 `.pd-qty` 已經有一個)⇒ 只出字。
  //   而「顯示車上現有件數」正是治那個病的那一半:他再按一下,數字會從 1 變 2 ⇒ **畫面會動**。
  //
  // 🔴 **連它的壽命一起抄,那段是承重的**(`ProductPage.tsx:131-155` 有全文與真瀏覽器實走紀錄):
  //   面板的壽命綁在**它在講的那一列**上。少了這個 effect 會長出一模一樣的病 ——
  //   「黑」加入後換規格到「銀」(從沒被加過),字還留著說「已加入」,而購物車裡沒有那一列。
  //   ⚠️ 加入購物車**不會**改變 `selectedVariant?.id` / `product.slug` ⇒ 本 effect 不重跑
  //     ⇒ `addToCart` 裡設的 `true` 活得下來。
  const [addedToCart, setAddedToCart] = useState(false);
  // 🔴 A5 的上限提示**自己一個 state**,不與 `qtyNotice` 共用(Sean 2026-08-23 拍甲之後拆的):
  //   `qtyNotice` 現在有兩個生產者,而**只有其中一個被拍過板**:
  //     ① 打字超過上限(`commitQty`)⇒「已達購買上限 99」  —— **Sean 沒有被問到這一句**
  //     ② 加購被夾掉(下方 `addToCart`)⇒「…這次少加了 N 件」—— **他拍的是這一句**
  //   逐字題目:「『因為超過上限,你少加了 N 件』這句提示要留多久?」⇒ 答**甲 = 常駐**
  //   ⇒ 共用一個 state 的話,改 ② 會**順手把 ① 也改掉** —— 那是把他的裁定擴張到他沒被問的東西上。
  //   (memory `project_0823-sean-overlimit-notice-persists`)
  const [overLimitNotice, setOverLimitNotice] = useState<string | null>(null);
  /**
   * 🔵 「這件不能單獨買」的提示(板 `⟦b4-NOVARIANT1⟧`)。
   * 🛑 **與 `overLimitNotice` 分開兩個 state, 而共用同一個顯示位置** ——
   *    它們是兩件事(「拿不到那麼多」vs「這件不能單獨買」), 合成一個會讓其中一句蓋掉另一句。
   */
  const [cannotBuyAloneNotice, setCannotBuyAloneNotice] = useState<string | null>(null);
  // 🔴 終止條件用**他的字面**:「直到他**換規格或離開**」—— 不是「按了確定」(那會多一個動作)。
  //   ⇒ 與 A3 的「已加入」共用同一個生命週期(離開 = 換商品 / 關頁面 = 元件卸載)。
  useEffect(() => {
    setAddedToCart(false);
    setOverLimitNotice(null);
  }, [selectedVariant?.id, product.slug]);
  // 車上那一列現在幾件(line key 與 `addToCart` 送出去的那組完全一致)。
  const cartLineQty =
    items.find((it) => it.productId === product.slug && it.variantId === selectedVariant?.id)?.qty ?? 0;

  // OD-4c:選某維(pattern/finish)的值;候選 = 該維=value 的變體;snap「另一維與當前相符最多」者
  // (稀疏矩陣保證選到有效變體、不卡死;候選保留 variants 排序、首個 max-score 穩定 tie-break)。
  const selectSpec = (dim: Dim, value: string) => {
    const candidates = variants.filter((v) => variantDimValue(v, dim, rpmShape) === value);
    if (candidates.length === 0) return;
    const cur = selectedVariant;
    let best = candidates[0]!;
    let bestScore = -1;
    for (const v of candidates) {
      let score = 0;
      if (cur) {
        for (const g of specGroups) {
          if (g.dim === dim) continue;
          if (variantDimValue(v, g.dim, rpmShape) === variantDimValue(cur, g.dim, rpmShape)) score += 1;
        }
      }
      if (score > bestScore) {
        bestScore = score;
        best = v;
      }
    }
    onSelectVariant(best);
  };

  // 顯示價:選到變體用變體價(general)、否則 product.price(無變體 mock fallback)
  // ⟦b4-DEALERSIGNUPUNSEEN⟧ M-2-08:經銷會員顯自己的價(2026-09-07)。
  // 🔵 `dealerPrice` **只在 tier==='store' 時存在**(route 端填;見 `MockProduct.dealerPrice` 註解)。
  // 🔴 **那個 fallback 是承重的**：**id 不在 Map 時**（下架 / amount NULL / uuid 查無）
  //    `dealerPrice` 是 `undefined` ⇒ 退回一般價。**少了它就是 `NT$ 0`** —— 那正是
  //    `app/products/[slug]/page.tsx` 檔頭記的坑。⚠️ **無差價【不會】走這條** —— RPC 會 coalesce 回 general。
  //    ⛔ ~~原本這兩句寫成「`?? price` 承重」~~ —— 2026-09-07 裁甲之後**已經不是 `??` 了**
  //    （`??` 會把合法的 `0` 一起讓掉）⇒ 改用 `typeof dealer === 'number'`，承重的是**那個型別判斷**。
  // 🔵 **只有 `store` 走經銷價那條路** —— 與 route 端、與 `lib/tier-prices.ts:63` 那道邊界同一個判準。
  const usesDealerPrice = tier === 'store';
  // ⟦b4-DEALERSIGNUPUNSEEN⟧ M-2-08（2026-09-07；主視窗 B 裁【甲】）。
  // 🔴🔴 **判準是「route 端【有沒有替這個 id 取到價】」, 不是「那個數字大不大」。**
  //    ⛔ ~~R1 之後我寫成 `dealer > 0`~~ —— 那把兩個不同案壓成一個（codex R2 must-fix ②）：
  //      · **無差價** ⇒ RPC 自己 `coalesce` 回 general ⇒ **回來的永遠不是 0**；
  //      · **真的 0 元商品** ⇒ `price_store` 的約束是 `CHECK (price_store IS NULL OR price_store >= 0)`
  //        （`20260531142533_init_product_variants.sql:56-61`）⇒ **0 是合法價, 要顯 `NT$ 0`**。
  //    ✅ 而「取不到」在型別上已經有形狀：`fetchEffectivePrices` 對 `amount === null` **不放進 Map**
  //      （`lib/tier-prices.ts` 那一行逐字寫著）⇒ route 端 `!== undefined` 才賦值
  //      ⇒ 📌 **這裡的 `undefined` = 沒取到**，而 `0` = 取到了一個 0。
  //    🔵 同形前例：auth 窗同日在 transform 用 `.has(sku)` 分「整列消失」與「明示 null」。
  // 🔴 **選了變體就【只認變體自己的價】** —— 不跨層退回商品級經銷價（codex R2 must-fix ⑤）：
  //    變體的一般價彼此不同 ⇒ 拿商品級那個數字套在變體上, 印出來的是**不屬於這個變體的金額**,
  //    而它是個合法的整數 ⇒ 看不出來。取不到 ⇒ 退回**這個變體自己的**一般價。
  const dealer = usesDealerPrice
    ? (selectedVariant ? selectedVariant.dealerPrice : product.dealerPrice)
    : undefined;
  const displayPrice =
    typeof dealer === 'number' ? dealer : (selectedVariant?.price ?? product.price);
  // 🔵 「原價」那一格要**與 `displayPrice` 同一層** —— 選了變體就拿那個變體的一般價。
  //   ⛔ ~~原本直接用 `product.price`~~：`displayPrice` 已經可能是**變體**的經銷價，
  //   而拿商品級的一般價去跟它並排，劃掉的那個數字不屬於同一件東西。
  const generalPrice = selectedVariant?.price ?? product.price;
  // 🔴 **`hasDiscount` 要求 `origPrice > 一般價`**（`design-reference/components/ProductPage.jsx:294` 同形）。
  //   ⛔ ~~原本 ProductInfo 寫 `product.origPrice ?? product.price`~~（codex R2 must-fix ③）：
  //   `origPrice === 0` 會印出**「原價 NT$ 0」**，而比一般價**更低**的假原價也會被照畫。
  const hasDiscount = product.origPrice != null && product.origPrice > generalPrice;
  // 🔴🔴 **「有沒有經銷價」與「他是不是經銷商」是兩件事**（codex R3 must-fix ②）。
  //   ⛔ ~~原本標記與原價那一格掛在 `usesDealerPrice`~~ ⇒ **RPC 少回那一列時**，畫面會出現
  //     **`NT$ 8,400` + `原價 NT$ 8,400` + 「經銷價」** = 假標記 + **同一個數字印兩次**
  //     —— 而那正是 R1 對 `premiumStore` 判 must-fix 的同一個形狀。
  const hasDealerPrice = typeof dealer === 'number';
  // 🔵 **只有【真的比較便宜】才劃掉原價** —— 無差價時 RPC coalesce 回 general，
  //   兩個數字相等 ⇒ 劃一條線在一模一樣的數字上，對客人是雜訊、對我們是假的折扣感。
  const showDealerOrig = hasDealerPrice && (hasDiscount || dealer! < generalPrice);

  // OD-7c:預覽卡的「紋路 · 表面」文字 — 反映實際選擇(含 12K/Kevlar 合併款、空維過濾)。
  //   W2:預覽卡限 RPM 形狀(非 RPM 不渲染、文字不需算)。
  const previewValueText = rpmShape && selectedVariant
    ? [
        dimValueLabel('pattern', variantDimValue(selectedVariant, 'pattern', true), true),
        dimValueLabel('finish', variantDimValue(selectedVariant, 'finish', true), true),
      ]
        .filter(Boolean)
        .join(' · ')
    : '';

  /**
   * 🔴🔴 **一件【沒有任何規格】的商品不能單獨買**(板 `⟦b4-NOVARIANT1⟧`;Sean 2026-08-31 拍「不賣」)。
   *
   * ⛔ **而修法【不是】把加入鈕變灰** —— `:283` 那一行逐字寫著
   *    「#161 **業務拍板:永遠可點、無 disabled**」⇒ 變灰會推翻一個既有拍板。
   * ⇒ 📌 **所以鈕照樣可點, 變的是【點下去發生什麼】。**
   *
   * 🔴 **而它擋的位置是刻意選的**:客人在【還沒填卡號】之前就知道。
   *    ⛔ 現況是**填完卡號、按下確認付款【之後】**才被退回(`useChargePayment.tsx:140`)——
   *      而那句話叫他「返回購物車重新確認」, **而購物車上沒有東西可以修**
   *      (那支商品本來就沒有規格可選)⇒ **他被叫去做一件做不到的事。**
   *
   * 🛑 **而這道擋【不取代】結帳那一道** —— 那一道是最後的 fail-closed 底線,
   *    前面加了不代表可以拆後面。(測試釘住它還在。)
   */
  const addToCart = () => {
    // M-3-S2-b2-c:cart 線契約改帶 variant_id(變體 uuid = selectedVariant.id、建單 RPC create_order 的
    //   variant_id 來源;取代 M-1-16c-3 把 sku 塞 color 的權宜 hack)。無變體 → variantId undefined、
    //   line key 退回 productId。🔴 不送價(server 依 tier 取價、鐵則 12)。
    // V-2a 帶入路徑1(搜尋情境自動帶):選車 context 有字典名稱字面 → 標 kind:'dict' source:'search'
    //   (V-2h/MF-4 抽 readSearchVehicle 供 mobile buybar 共用同一來源、零猜邏輯在純函式)。
    // 🔴🔴 **一件【沒有任何規格】的商品不能單獨買**(板 `⟦b4-NOVARIANT1⟧`;Sean 2026-08-31 拍「不賣」)。
    //
    // ⛔ **修法【不是】把加入鈕變灰** —— 本檔 `:283` 逐字寫著
    //    「#161 **業務拍板:永遠可點、無 disabled**」⇒ 變灰會推翻一個既有拍板。
    //    ⇒ 📌 **鈕照樣可點, 變的是【點下去發生什麼】。**
    //
    // 🔴 **而擋在這裡是刻意的**:客人在【還沒填卡號】之前就知道。
    //    ⛔ 現況是**填完卡號、按下確認付款【之後】**才被退回(`useChargePayment.tsx:140`),
    //      而那句話叫他「返回購物車重新確認」—— **購物車上沒有東西可以修**
    //      (那支商品本來就沒有規格可選)⇒ **他被叫去做一件做不到的事。**
    //
    // 🛑 **這道【不取代】結帳那一道** —— 那是最後的 fail-closed 底線,
    //    前面加了不代表可以拆後面(測試釘住它還在)。
    // 🔵 而「客服 LINE」是**沿用既有字面**(付款那條路四處都這樣寫)——
    //    自己發明一種說法會讓它變成第六種。
    if (!hasVariants) {
      setCannotBuyAloneNotice('這件商品目前不能單獨購買,請聯繫客服 LINE 協助訂購。');
      setAddedToCart(false);
      return;
    }
    const vehicle = readSearchVehicle();
    // 🔴 N4(2026-08-24):`addItem` 現在**自己回傳「因為上限而被夾掉幾件」** ——
    //   算法與「這一列現在幾件」都住共用層(`CartContext.tsx`),這裡只負責【怎麼顯示】。
    //   ~~原本這裡自己 `clampDrop(cartLineQty, qty)`~~ ⇒ 那讓另外兩個呼叫端各自漏掉了這一步。
    const dropped = addItem({
      productId: product.slug,
      qty,
      variantId: selectedVariant?.id,
      ...(vehicle ? { vehicle } : {}),
    });
    // 🔴🔴 **2026-08-23 R1 must-fix:`setAddedToCart(true)` 原本是【無條件】的。**
    //   病:車上已經 99,再按一次加入 ⇒ **一件都沒進去**,而畫面說「已加入購物車 · 車上共 99 件」。
    //   真瀏覽器實測(同一發同時讀三個值):
    //     `localStorage` 前後都是 `[{"productId":"g3-probe-0006","qty":99}]`(**沒有變**)
    //     而畫面同時出「已加入購物車 · 車上共 99 件」與「已達購買上限 99,這次少加了 6 件」
    //   🔴 **那是一句斷言它沒有造成的事** —— 與 `#883` 的 `/logout`「您已登出」同族,同一晚兩個實例。
    //   ⇒ `dropped === qty` = 全部被夾掉 = **零件進車** ⇒ 那一刻不該說「已加入」。
    //   ⚠️ 而 `false` 那半是承重的:上一次成功加入留下的那句必須**當場收掉**,
    //     否則它會停在畫面上,變成一句過期的「已加入」。
    setAddedToCart(dropped < qty); // A3:讓畫面動一下 —— 沒有這行,客人只能靠猜
    // A5:靜默夾值 ⇒ 明說。病:車裡 90 再加 20 ⇒ 變 99,**沒有一個字告訴他少了 11 件**。
    //
    // 🔴 **Sean 2026-08-23 拍甲:這句改【常駐】,不再 2.5 秒消失。**
    //   ~~原本沿用同檔 `qtyNotice` 的一次性提示(2500ms)~~ ⇒ 改用自己的 `overLimitNotice`。
    //   ⚠️ **那個 2500ms 不是有人為這句挑的**,是**沿用**來的預設值 ——
    //     而它把原本情境(打字打太大,馬上就看得到框裡被改成 99)的假設一起帶了過來:
    //     那個情境**當場有一個看得見的補償**(數字就在眼前變了),而**加購這個情境沒有**。
    //   🔴 **一個沿用來的預設值,會把它原本情境的假設一起帶過來,而沒有人重新問過那個假設。**
    //   📌 而這題**不是有人去看畫面看出來的**:是驗收時**連截三次都撲空**
    //     ⇒ **「截不到圖」這件事本身,就是那個設計問題的證據。**
    //   (memory `project_0823-sean-overlimit-notice-persists`)
    //
    //   ⚠️ 「連按兩下的第二下可能算不準」那條限制**跟著算法搬去 `CartContext.addItem` 了** ——
    //     限制要跟著它所限制的那段碼走,留一份副本在這裡只會有一天變成過期的話。
    // 🔴 `else` 那半是承重的:同一列**先夾到、再改規格數量重加而沒夾到**時,
    //   舊那句必須**當場收掉** —— 常駐的提示若不清,它會變成一句停在畫面上的過期話。
    // N4:字面搬去 `CartContext.overLimitMessage` —— 手機 sticky 買價列要唸**同一句**,
    //   複製兩份的話下次改字只會改到一份,而兩份都不會紅。
    setOverLimitNotice(overLimitMessage(dropped));
  };

  // 立即購買(Sean 2026-07-11):加入購物車後直接前往購物車頁(非結帳);與「加入購物車」的差別=多一步導頁。
  // 🔴 手機版同款邏輯在 ProductPage.tsx 的 buyNow(2026-08-21 F-81 補)——兩份各自的元件、
  //    各自的 addToCart 閉包,沒辦法共用同一支函式;改這裡的行為時記得那邊也要一起改。
  const buyNow = () => {
    addToCart();
    router.push('/cart');
  };

  return (
    <aside className="pd-info">
      {/* 🔴🔴 **Sean 2026-09-03 【重答】Q23 = 甲:商品頁只印「原廠料號」。**
          ⛔ ~~原本(M-1-16c-4a):印選中變體的真 `sku`,隨 selectSpec 連動~~
          ⛔ ~~同日稍早的丙:兩個編號都印,暫用標籤「搜尋用」(commit `c68cc9fe`)~~

          🎯 **為什麼推翻 —— 而丙那一版的【存在理由仍然成立, 換掉的是解法】**:
             丙要解的病是「客人照商品頁上那一串抄去搜 ⇒ 0 筆」。**那個病沒有變。**
             而 Sean 給了一句我們沒有的業務事實,逐字:
             **「但是其實我們不太會用商品編號耶 我們工作基本上都是用原廠料號在工作」**
             ⇒ 📌 他們工作上只用原廠料號,而**顧客站搜尋比對的剛好就是那一個**
             ⇒ ⇒ **所以問題不是「要印兩個」, 是【我們印錯了那一個】。**
          ⇒ 🛑 **下一個讀 `c68cc9fe` 的人:丙沒有錯 —— 是前提換了。**

          🔬 **「原廠料號」是哪一個欄位 —— 這一格我用 repo 自己的字面判, 不是猜**:
             `packages/domain/src/catalog/types.ts:283` 逐字稱 `productCode` 是
             **「vendor 來源料號(如 RPM 的 `RPM-DCC01`)」**、← wire `products.external_id`;
             `:288` 稱 `ProductVariant.sku` 是「各變體個別料號」。
             ⇒ 而搜尋比對的 `SEARCHABLE_COLUMNS` 正是 `external_id`
             ⇒ ✅ 兩邊指向同一個:**原廠料號 = `productCode`**。

          ⚠️ **代價照實記**:這一頁**不再印變體個別料號**(`sku`)。
             ⇒ 同一支商品不同規格的號從畫面上消失了 —— 而規格本身仍看得到(選擇器在)。
             ⇒ 🛑 **哪天發現出貨單 / 揀貨單 / 發票上對帳靠的是那個變體號, 這一片要重議。**
                (主視窗 `-87` 明說:那是**它的判讀不是 Sean 的字** —— 他選甲, 它讀成
                 「紙上不是靠那個號對帳」。這一格留著, 因為它是這片唯一沒有被證實的假設。)

          🔵 **叫法定案 = 「原廠料號」**(Sean 自己的用語)⇒ 這不再是暫用字面, TODO 已收。
             🛑 而**站上另外六處**「料號 / 產品型號」混用**本片不動** —— 那是另一片, 已標進板子。 */}
      {/* 🔴🔴 **2026-09-06 Sean 親眼看到:選了紅色而這裡仍印母料號 `PET52`, 他要 `PET52R`。**
          ⇒ 📌 **這不是推翻他當初選的甲, 是上面那段註解自己寫的「要重議」兌現了** ——
             逐字「⚠️ 代價照實記:這一頁不再印變體個別料號(sku)…🛑 哪天發現…這一片要重議」。
          ✅ **選中的變體有 `sku` ⇒ 印變體 sku;沒選 / 沒有 sku ⇒ 照舊印母料號。**
          🛑 **只改【值】不改【字】** —— 「原廠料號」是 Sean 自己的用語, 既有註解記著「叫法定案」。
          🔵 `selectedVariant` 本來就是這個元件的 prop(`:52`)⇒ 不必提升狀態、不動 `ProductPage`。
          🔴 **空字串要退回母料號, 不是印空** —— `sku` 在型別上是 `string`(非 optional),
             而**型別不保證執行期**:mock / 舊資料 / 未來的 mapper 都可能給空字串
             ⇒ 用 `?.trim() ||` 而不是 `??`(`??` 只擋 null/undefined, 擋不掉 `''`)。
          🛑 **而括號裡那半【逐字不動】** —— 仍是 `product.productCode ?? product.slug`, 不是 `||`。
             ⇒ 📌 改成 `||` 會讓「`productCode` 是空字串」那個世界的行為也跟著變,
                而**那個世界與本片無關** —— 驗收第①格逐字寫「沒選變體 ⇒ 不得因為本片而改變」。
             ⇒ ⇒ **順手「修好」一個沒人叫我修的東西, 就是把一個未經檢驗的改動混進來。**
          🔬 **順帶記一個【我差點下錯的診斷】**:我第一版把它拆成兩行、中間放 `{' '}`,
             四格紅的訊息是「Unable to find an element with the text …(text is broken up by
             multiple elements)」⇒ 我第一個念頭是「排版把 text node 切開了」。
             ⛔ ~~而那個念頭是錯的~~ ⇒ 🔬 **改回單行之後【紅的格數一個都沒變, 還是 4】**
             ⇒ 📌 **那句「broken up by multiple elements」是 testing-library 的【罐頭提示】,
                不是診斷** —— 它對每一個找不到文字的失敗都印同一句。
             ⇒ ⇒ **一個看起來很像成因的錯誤訊息, 與真正的成因長得一樣。** */}
      <div className="pd-sku">
        {product.brand} · 原廠料號 {selectedVariant?.sku?.trim() || (product.productCode ?? product.slug)}
      </div>

      <h1 className="pd-title">{product.name}</h1>

      {/* M-1-16c-4a:副標顯 DB 真 subtitle(Webike 式如「Ducati Panigale · 碳纖維」;Sean Q2=A);
          拿掉寫死「義大利原裝進口」(RPM 非義大利、backlog #162 placeholder 退場);無 subtitle fallback「適用 {fits}」。
          確切排版/字面 Sean 後續用網頁設計 skill 調(對齊 feedback_sean-owns-visual-design)。 */}
      <div className="pd-sub">{product.subtitle || `適用 ${product.fits || '通用款'}`}</div>

      {/* M-1-16c-3:價改 displayPrice(選變體換價);詳情頁釘 general、tier 經銷分支 general 不觸發
          (變體無真經銷價、tier-aware 變體價延 M-2-08);非變體 mock 走 product.price + 原 tier/orig 條件 */}
      <div className="pd-price-block">
        <div className="pd-price-row">
          <span className="pd-price">NT$ {displayPrice.toLocaleString()}</span>
          {/* 🔴🔴 **條件從「tier 是不是經銷」改成「我們有沒有【替這個 tier 取過價】」**
                  (code-reviewer R1 must-fix 2):route 只在 `tier === 'store'` 時叫 RPC
                  (`fetchEffectivePrices` 內部那道邊界也只放 `store` 過),
                  而**舊條件把 `premiumStore` 也算進來** ⇒ 那種會員會看到
                  **`NT$ 8,400` + `原價 NT$ 8,400` + `經銷價`** = 假標記 + 同一個數字印兩次。
                  🛑 **而那一格是【本片新引入的】** —— 改前 `tier` 釘 general, 這個分支根本走不到。
                  ⚠️ `premiumStore` 是真的 enum 值(`20260523034911_init_customers_and_subtables.sql:8`),
                  它的價待 M-2-08 後續片(plan §C 明寫本片不做)。 */}
              {hasDealerPrice ? (
            <>
              {/* 🔴 **與稿同形**(`design-reference/components/ProductPage.jsx:294` 逐字
                  `hasDiscount ? product.origPrice : product.price`)——
                  ⛔ ~~原本是 `product.origPrice ?? displayPrice`~~:那在 tier 釘 general 的世界看不出差別,
                  而**一旦 `displayPrice` 變成經銷價, 它會把「原價」印成同一個數字**(2026-09-07 front 量到)。
                  🔵 `origPrice` 今天恆 `null`(`lib/products.ts:190`, promo 未做)⇒ 這行取 `product.price` = 一般價。 */}
              {showDealerOrig && (
                <span className="pd-price-orig">
                  NT$ {(hasDiscount ? product.origPrice! : generalPrice).toLocaleString()}
                </span>
              )}
              <span className="pd-price-tag-dealer">經銷價</span>
            </>
          ) : product.origPrice && product.origPrice > displayPrice ? (
            <>
              <span className="pd-price-orig">
                NT$ {product.origPrice.toLocaleString()}
              </span>
              <span className="pd-price-save">
                −{Math.round(((product.origPrice - displayPrice) / product.origPrice) * 100)}%
              </span>
            </>
          ) : null}
        </div>
        {/* 🔴 **經銷 tier 不印這一句**（Sean 2026-09-06 拍 Q24 逐字「未稅 但是不標未稅」；
              memory `project_0906-dealer-price-display-tax-by-payment-method`）——
              經銷看到的是**未稅**數字 ⇒ **「含稅」與「未稅」兩個字樣都不印**。
              🛑 少了這一格 = **未稅的數字配「含稅」字樣**，刷卡再 +5% 時 PDP 的宣稱與實收對不上
              （codex R2 must-fix ①）。稅由**付款方式**決定（刷卡 +5% / 匯款不加）⇒ 總額是結帳頁的事
              （⟦auth-TIERTOTALBYPAYMENT⟧），PDP 這一層答不出來。
              ⚠️ **代價明寫**：「滿 NT$ 5,000 免運」那半也跟著不見了 —— 那是照拍板的字面做的，
              而**「經銷會員有沒有免運門檻」未確認**；要單獨留運費那半，要 Sean 一句。 */}
        {!usesDealerPrice && <div className="pd-price-sub">含稅 · 滿 NT$ 5,000 免運</div>}
      </div>

      {/* OD-7c:picker 上方即時預覽卡 — 顯當前選中變體對應的紋路樣品圖(findSwatch + fallback);
          點圖開 lightbox 瀏覽全 10 張樣品。與 Hero 圖庫(OD-7d 真變體實拍)互補(預覽=乾淨紋路參考)。
          W2:限 RPM 形狀 — 非 RPM(bonamici/cncracing 色彩變體)降級不渲染,防 findSwatch
          fallback 顯示錯誤的 RPM 碳纖樣品圖(#265;通用色塊 hex_color 為後續獨立工作)。 */}
      {hasVariants && rpmShape && (
        <ProductSwatchPreview selectedVariant={selectedVariant} valueText={previewValueText} />
      )}

      {/* OD-4c 選擇器已搬到 VariantPicker.tsx(#888 刀B);承重註解隨碼一起在那支檔裡。 */}
      {hasVariants && (
        <VariantPicker
          specGroups={specGroups}
          selectedVariant={selectedVariant}
          rpmShape={rpmShape}
          onSelectSpec={selectSpec}
        />
      )}

      {/* M-1-13e-a:Buy row(design ProductPage.jsx L334-349);#161 業務拍板:永遠可點、無 disabled */}
      <div className="pd-buy-row">
        <div className="pd-qty">
          <button
            type="button"
            onClick={() => commitQty(String(qty - 1))}
            aria-label="減少數量"
          >
            −
          </button>
          {/* W11-019 B1:span 換 input —— 支援鍵盤直接輸入,+/− 仍保留(手機點/桌機打字各取所需,§6)。
              inputMode=numeric 叫數字鍵盤;不用 type="number"(§5:各瀏覽器行為不一、滾輪會改值)。 */}
          <input
            type="text"
            inputMode="numeric"
            pattern="[0-9]*"
            aria-label="數量"
            className="pd-qty-input"
            value={qtyText}
            onChange={(e) => setQtyText(e.target.value.replace(/[^0-9]/g, ''))}
            onBlur={() => commitQty(qtyText)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') e.currentTarget.blur();
            }}
          />
          <button
            type="button"
            onClick={() => commitQty(String(qty + 1))}
            aria-label="增加數量"
          >
            +
          </button>
          {qtyNotice && (
            <div className="pd-qty-notice" role="status">
              {qtyNotice}
            </div>
          )}
        </div>
        <button type="button" className="pd-add-btn" onClick={addToCart}>
          加入購物車
        </button>
        <button
          type="button"
          className={`pd-like ${liked ? 'is-liked' : ''}`}
          onClick={() => toggleFavorite(product.slug)}
          aria-label="收藏"
          aria-pressed={liked}
        >
          <svg
            width="18"
            height="18"
            viewBox="0 0 24 24"
            fill={liked ? 'currentColor' : 'none'}
            stroke="currentColor"
            strokeWidth="1.6"
            aria-hidden="true"
          >
            <path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z" />
          </svg>
          {/* Q3(主視窗代裁,Sean 授權「愛心的問題給你決定就好」):手機也要看得見這顆。
              整條 `.pd-buy-row` 在 ≤1079 是 `display: none`(改由 sticky 購買列接手),
              手機版把這顆單獨放回來、拉成整列 ⇒ 一顆 48×48 的裸方框看起來像壞掉,故補字。
              桌機 `.pd-like-label` 是 `display: none`、視覺零變化。 */}
          <span className="pd-like-label">{liked ? '已收藏' : '收藏'}</span>
        </button>
      </div>

      {/* A3:加入購物車的回饋(手機列同款字面「已加入」;`role="status"` 沿用 `.pd-qty-notice` 的無障礙慣例
          ⇒ 讀螢幕的人也會被念到)。`cartLineQty > 0` 一起判:面板說「已加入」而車上那列是 0 件的話,
          寧可不出字 —— 那是騙人,而騙人比沒有回饋更糟。 */}
      {addedToCart && cartLineQty > 0 && (
        <div className="pd-added-notice" role="status">
          已加入購物車 · 車上共 {cartLineQty} 件
        </div>
      )}

      {/* 🔴 A5 常駐版(Sean 2026-08-23 拍甲)。**位置刻意排在「已加入」之下**:
          兩句現在會**同時常駐**,而它們的關係是「發生了什麼」+「而其中有一部分沒進去」——
          後者是前者的修正,讀的順序要對。
          ⚠️ 它**不再借用** `.pd-qty-notice`(那是貼著數量框浮出的絕對定位、給一次性提示用的)——
            一個**常駐**的東西用絕對定位會一直蓋住底下的內容。改用 `.pd-added-notice` 的同款排版,
            靠 `.pd-over-limit-notice` 換成警示色。
          `role="alert"` 而不是 `status`:這句是「你要的東西沒有全部拿到」,讀螢幕的人該被主動打斷。 */}
      {overLimitNotice && (
        <div className="pd-added-notice pd-over-limit-notice" role="alert">
          {overLimitNotice}
        </div>
      )}
      {/* 🔵 沿用同一個顯示位置與 role="alert" —— 這句同樣是「你要的事情沒有發生」。 */}
      {cannotBuyAloneNotice && (
        <div className="pd-added-notice pd-over-limit-notice" role="alert">
          {cannotBuyAloneNotice}
        </div>
      )}

      {/* M-1-13e-a:buynow(design ProductPage.jsx L351);#161 永遠可點 */}
      <button type="button" className="pd-buynow-btn" onClick={buyNow}>
        立即購買
      </button>

      {/* 服務保障(Sean 2026-07-11 拍板):原 OD-5 放 hero 下方全寬橫條 → 移進買價下方右欄空白,
          省一條橫條、填滿右欄、零重複。全寬版樣式改窄欄直立(product-page.css .pd-services-*)。 */}
      <ProductServices isRpmCarbon={isRpmCarbon} />
    </aside>
  );
}
