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
  const displayPrice = selectedVariant?.price ?? product.price;

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
      {/* M-1-16c-4a:料號顯選中變體真 sku(隨 selectSpec 連動;Sean Q1=A、取代原 PCM-{id hash} 亂碼數)。
          無變體 mock fallback 用 slug(sane、非 hash;design VariantCFull.jsx L81 原 PCM-XXXXX 格式退場)。

          🔴🔴 **Sean 2026-09-03 拍 `Q23 = 丙`:兩個編號都印並標清楚。**
          🛑 **而丙【不會讓料號變成搜得到】—— 它只是讓客人知道該抄哪一個。**
             真正的修法是甲(要貼 SQL, 排在丙之後)。⇒ **不要拿本片去說「料號搜尋修好了」。**

          🔬 **病灶(量到的)**:這一行印的是 `variant.sku`,而顧客站搜尋比對的是
             `products.external_id`(= `product.productCode`)——
             `product-query-support.ts` 的 `SEARCHABLE_COLUMNS` 只有
             title / subtitle / description / external_id, **`sku` 結構上不在 `products_public` 上**。
          ⇒ 📌 **客人照著這一行抄去搜, 搜不到。** 而它**有時候搜得到**(兩個號剛好相同時)
             ⇒ **客人分不出這一次是哪一種。**

          ⚠️ **標籤那兩個字是【暫用】, 等 Sean 定** —— 他批的是「兩個都印」,
             而題目第③格逐字寫著「料號 / 產品型號兩個叫法六個地方在用而**沒有任何一筆拍板**,
             你順手定一下叫法」⇒ **他沒答那一格。**
          🛑 **暫用字面刻意【不用】「料號」或「產品型號」任一個** —— 那兩個名字正是他要拍的東西,
             用了就是替他選了一個。這裡用「搜尋用」:它描述**功能**不是**命名**,
             而它同時就是客人現在最需要知道的那件事(該抄哪一個)。
          📌 **TODO(等 Sean 拍叫法)**:兩個標籤定案後回來換掉這裡的字面。 */}
      <div className="pd-sku">{product.brand} · {selectedVariant?.sku ?? product.slug}</div>
      {/* 🔵 只在【兩個號不同】時才多印一行 —— 相同時多印一次會讓客人以為那是兩件事。 */}
      {product.productCode && product.productCode !== (selectedVariant?.sku ?? product.slug) ? (
        <div className="pd-sku pd-sku-searchable">{product.productCode}(搜尋用)</div>
      ) : null}

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
          {tier === 'store' || tier === 'premiumStore' ? (
            <>
              <span className="pd-price-orig">
                NT$ {(product.origPrice ?? displayPrice).toLocaleString()}
              </span>
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
        <div className="pd-price-sub">含稅 · 滿 NT$ 5,000 免運</div>
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
