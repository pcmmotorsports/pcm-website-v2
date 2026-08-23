// CartContext.tsx — Phase 1 client-side cart state(localStorage mock、無後端、對齊 NORTHSTAR Phase 1 M-3 結帳前的 stub 範圍)
//
// 範圍 / 不範圍:
// - 本 Provider 只管「客人手上提籃」型 cart state(items / addItem / removeItem / updateQty / clear)
// - 真實結帳 / order / payment 是 M-3 範圍、不在本 slice
// - 無後端 API、無 syncEngine、無 server validation;經銷價驗證等鐵則「server 端鐵則」仍由 server route handler 守(本 Provider 不碰)
// - M-3 接真後端時、本 Provider 內部從 localStorage 換 API、useCart() 介面不變、調用端零修改
//
// SSR / hydration 安全:
// - Next.js SSR 階段 window/localStorage 不存在、initial state 永遠空陣列 []
// - 由 useEffect 在 client mount 後 hydrate from localStorage、避免 hydration mismatch
// - isHydrated flag 標示「是否已從 localStorage 載入」、UI 可選擇是否在 hydrate 前顯示 0
//
// localStorage key:`pcm-cart-mock-v2`(M-3-S2-b2-c 線契約改 variant_id → bump v1→v2;
//   舊 v1 sku-塞-color hack 資料隨 key-bump 自然失效〔v2 不讀 v1 key、production 等同丟棄〕;
//   readStorage 另對殘留 color/size 欄寬容忽略〔不解析為 variantId、合法 productId 行收為無變體〕。
//   不可靠反推〔color=sku 非 variant uuid〕+ Phase 1 localStorage mock cart〔無真結帳/金額/訂單、
//   丟棄成本=用戶重加幾筆〕→ 不寫 v1→v2 migration)
//
// Identity / line key 設計(M-3-S2-b2-c 改 variant_id 線契約;取代 M-1-13e-b 的 color=sku 權宜 hack):
// - productId 用 string(對齊 domain ProductId / Supabase uuid;mock 路徑傳 product.slug、stable + URL friendly)
// - addItem / removeItem / updateQty 統一用 { productId, variantId } 作 line key:variantId=變體 uuid
//   (= UIVariant.id、建單 RPC create_order 的 variant_id 來源);無變體商品 variantId undefined、退回 productId 當鍵
//   (防同商品不同變體誤殺;🔴 線上只存 variant_id + qty、**不存價**、價由 server 依 tier 取〔鐵則 12〕)
//
// qty guard(Codex review 小風險):readStorage / addItem / updateQty 三入口統一過 Number.isInteger + clamp [1, MAX_QTY]
//
// cart_session_id(M-3 3DS-7 冪等治本、plan §3 7a):購物車生命週期穩定的 idempotency key(uuid)、獨立
//   localStorage key `pcm-cart-session-v1`(與品項 key 分開、不動既有序列化契約);空車首件生、跨重結帳穩定、
//   成交換新(regenerateCartSession)。非價/tier/身分純去重子(鐵則 12 正交);7a 只持有 key、不送 server。
//   🔴 hydration:持久化 gate isHydrated、mount 讀用 `prev ?? stored`(不覆寫 pre-hydrate 已生成的 key、防
//   hydrate-race 覆寫回舊 key;對齊 ClearCartOnSuccess codex must-fix)。7b 送 server + 僅「DB 確定 paid」換新。
//
// 鐵則對齊:
// - 鐵則 9 L1 標記(API 結構穩定、M-3 swap 實作不動介面)
// - 鐵則 6:🔴 本檔**已超過 300 行硬警戒、仍低於 400 行必拆線**(實測 383 行;A1 換人清車後重量,2026-08-23)(原註解「<300 軟警戒內、~230 行」
//   在 2026-07-22 前即已是假字面、當時實為 303 行,同日修正)。不拆的理由:newCartSessionId 為十餘行
//   純函式,與其三個呼叫點(hydrate / addItem / regenerate)同檔內聚;拆出去反而讓「去重子在哪裡生成」
//   要跨檔追,提高雙扣線排查成本。下次再長就評估把持久化 I/O 那段抽出。
// - server 端鐵則「會員與價格」:本 Provider 不存價格(只存 productId + qty + color / size 規格)、價格永遠由 server 端 resolve

'use client';

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';


const STORAGE_KEY = 'pcm-cart-mock-v2';
const SESSION_KEY = 'pcm-cart-session-v1'; // 3DS-7 cart-instance idempotency key(獨立、與品項 key 分開)
// #245:cart_session_id 讀回格式守門(inline 重複、對齊 charge-actions / callback 同層 UUID_RE 慣例;
//   storefront 無 zod 直接依賴,不引 z.uuid 避脆弱 transitive import)。
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
// 匯出給 W11-019 B1 數量輸入框共用(ProductInfo/CartView 前端夾值上限要對齊這裡,不得各自硬寫 99)。
export const MAX_QTY = 99;

/** 產生 cart-instance 去重子(3DS-7 cart_session_id)。
 *
 *  🔴 為什麼不能直接呼 `crypto.randomUUID()`:它是 **secure-context-only** API(僅 HTTPS / localhost)。
 *     2026-07-22 實測 `http://192.168.0.234:3001`(區域網路真機驗收):`isSecureContext=false`、
 *     `typeof crypto.randomUUID === 'undefined'` → 舊版在 `addItem` 直接 throw、整頁 crash、購物車完全不能用。
 *     正式站是 HTTPS(secure context)故真實客人從未遇到;壞的是區網 HTTP 的開發／真機驗收路徑。
 *
 *  🔴 fallback 為什麼必須密碼學強度:本值是**雙扣防線的去重把手**(charge-actions ②d 讀 client 值 →
 *     begin cart-instance dedup),碰撞會讓兩筆不同結帳被誤判為同一筆。故用 `crypto.getRandomValues`
 *     (非 secure-context-only、全 context 可用、與 randomUUID 同等熵),**絕不使用 Math.random**。
 *
 *  產出格式與 randomUUID 相同(RFC 4122 v4:version nibble=4、variant 高位=10xx),
 *  必通過本檔 UUID_RE 與 server 端 charge-actions / callback 的同層 UUID_RE fail-closed 驗證。
 */
function newCartSessionId(): string {
  if (typeof crypto.randomUUID === 'function') return crypto.randomUUID();
  const b = crypto.getRandomValues(new Uint8Array(16));
  b[6] = (b[6]! & 0x0f) | 0x40; // version 4
  b[8] = (b[8]! & 0x3f) | 0x80; // variant 10xx
  const h = Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

export type CartLineKey = {
  productId: string;
  /** 變體 uuid(= UIVariant.id、建單 RPC create_order 的 variant_id 來源);無變體商品 undefined、退回 productId 當鍵 */
  variantId?: string;
};

// V-2a「給哪台車用」(值班台 REQUIRED-1 判別式形狀):
//   kind:'dict' = 來自字典(picker/typeahead/搜尋帶入/車庫 dict 對非 null)、brand/model 為字典名稱字面
//     → §7 商品頁比對只判此類;
//   kind:'free' = 自由輸入 or 車庫舊自由文字(dict 對雙 null)、只有 raw 原字串 → §7 恆走「人工確認」路。
// 🔴 freetext 不得偽造 dict 對(車種鐵律零猜);vehicle 非 line key discriminator=同品同變體不因車款分裂兩列。
// 純 client(localStorage)、不送價/不寫 DB;V-3 才落 order_items.vehicle_snapshot。
export type CartItemVehicle =
  | { kind: 'dict'; brand: string; model: string; year?: number; source: 'search' | 'garage' | 'picker' }
  | { kind: 'free'; raw: string; year?: number; source: 'garage' | 'freetext' };

export type CartItem = CartLineKey & {
  qty: number;
  /** V-2a:此列適用車款(選填;§2 帶入優先序;無=未填、不擋結帳) */
  vehicle?: CartItemVehicle;
};

export type CartContextValue = {
  items: CartItem[];
  totalQty: number;
  isHydrated: boolean;
  /** 3DS-7 cart-instance idempotency key(uuid);空車首件生、成交換新;hydrate 前 null。非價/tier/身分。 */
  cartSessionId: string | null;
  /** 加一列進車。**回傳「因為上限 MAX_QTY 而被夾掉幾件」**(0 = 一件都沒被夾掉)。
   *  🔴 2026-08-24 N4:原本回傳 `void` ⇒ 想講「這次少加了幾件」的呼叫端得【自己】去 `items`
   *    找那一列、再自己呼叫 `clampDrop` —— 而三個呼叫端裡只有一個做了(桌機商品頁),
   *    另兩個(手機 sticky 買價列 / 商品卡快速加入)在車上已滿時**一件都沒進去卻說「已加入」**。
   *  📌 形狀:**「哪些情況要顯示什麼」寫在呼叫端就會漏,寫在共用層才有分母** ——
   *    夾值本來就發生在 `addItem` 裡,現在只是讓它把自己做了什麼**講出來**,
   *    第四個呼叫端不必知道要去 find 那一列。 */
  addItem: (item: CartItem) => number;
  removeItem: (key: CartLineKey) => void;
  updateQty: (key: CartLineKey, qty: number) => void;
  /** V-2a:設/清單列適用車款(null=清)。vehicle 非 line key、不動去重/session。 */
  setItemVehicle: (key: CartLineKey, vehicle: CartItemVehicle | null) => void;
  /** V-2a:整車套用——一次帶入全列(§2「不造成選擇負擔」;覆蓋各列既有值)。 */
  setAllItemsVehicle: (vehicle: CartItemVehicle | null) => void;
  clear: () => void;
  /** 成交後換新 key(7b 僅在「DB 確定 paid」呼;模糊態保留 key=dedup 防雙扣把手)。 */
  regenerateCartSession: () => void;
};

const CartContext = createContext<CartContextValue | null>(null);

function sameLine(a: CartLineKey, b: CartLineKey): boolean {
  // 變體 uuid 為主 discriminator;無變體商品(variantId undefined)退回 productId(undefined===undefined 同行)。
  return a.productId === b.productId && a.variantId === b.variantId;
}

function clampQty(qty: unknown): number {
  if (typeof qty !== 'number' || !Number.isFinite(qty)) return 0;
  const floored = Math.floor(qty);
  if (floored < 1) return 0;
  return Math.min(floored, MAX_QTY);
}

/** A5:同一列再加購時,**因為上限而被丟掉幾件**(0 = 沒被丟)。
 *
 *  🔴 這支住在這裡、不住在畫面那邊,是因為**夾值本身就發生在這個檔**
 *  (`addItem` 的 `clampQty(p.qty + safeQty)`)。算法跟著它走,畫面只負責把數字唸出來
 *  ⇒ 哪天 `MAX_QTY` 或 clamp 規則改了,不會有一個「講另一套數字」的提示留在別的檔裡。
 *
 *  🔴 **2026-08-24 N4:上面那段「另兩個沒接、風險小很多」已經作廢 —— 它是錯的判斷。**
 *    ~~「qty 恆 1 ⇒ 最多只丟得掉 1 件 ⇒ 風險小很多」~~ ——
 *    **丟掉幾件不是重點,重點是那一刻畫面說了什麼。** 車上已 99 再按一次:
 *      · `ProductPage` 手機列 ⇒ 滑出面板照樣寫「已加入・數量 99」
 *      · `ProductCard` 卡片   ⇒ 鈕照樣閃「✓ 已加入」1.5 秒
 *    **一件都沒進去,而兩個畫面都說進去了** —— 與 `#883` 的 `/logout`「您已登出」同族:
 *    **一句斷言它沒有造成的事**。而 Sean 拍的是「不要靜默夾」⇒ **他的拍板只落到了桌機。**
 *  ⇒ 修法**不是**去接第二、第三個呼叫端(那是把同一套判斷寫三次,而第四個呼叫端還是會漏),
 *    是讓 `addItem` **自己回傳被夾掉幾件**。這支純函式現在由 `addItem` 呼叫,
 *    呼叫端只負責【怎麼顯示】。 */
export function clampDrop(existingQty: number, addQty: number): number {
  const wanted = existingQty + addQty;
  return Math.max(0, wanted - clampQty(wanted));
}

/** A5/N4:「因為上限少加了幾件」那句**常駐**提示的字面(Sean 2026-08-23 拍甲:不再 2.5 秒消失)。
 *  回 `null` = 沒被夾到 = 不出這句。
 *
 *  🔴 **它住這裡的理由與 `clampDrop` 同一條**:句子裡的 `MAX_QTY` 與「少加了幾件」都是這個檔算出來的
 *  ⇒ 哪天上限或 clamp 規則改了,不會有一份**講另一套數字**的字面留在畫面那邊。
 *  ⚠️ 而**現在有兩個畫面要唸同一句**(桌機商品頁 `ProductInfo` / 手機 sticky 買價列 `ProductPage`)——
 *    複製兩份的話,下次 Sean 改字只會改到其中一份,**而兩份都不會紅**。 */
export function overLimitMessage(dropped: number): string | null {
  return dropped > 0 ? `已達購買上限 ${MAX_QTY},這次少加了 ${dropped} 件` : null;
}

/** A 段 nit(2026-08-24):「打字打超過上限」那句一次性提示的字面。
 *  🔴 **原本同一句客人文案有兩份字面** —— `ProductInfo.tsx` 的數量框與 `CartQtyInput.tsx` 各寫一次。
 *    兩支的 `commitQty` 幾乎是逐字相同的複製,而**字面被複製時沒有任何東西會紅**:
 *    下次 Sean 改字,只會改到其中一份,**而兩份都通過所有測試**。
 *  ⚠️ 這裡**只抽字面,不抽那兩支重複的元件** —— 那是另一片的工作,
 *    在補洞片裡順手合併兩個有各自 state 與計時器的元件,風險遠大於它解決的問題。 */
export const QTY_CAP_NOTICE = `已達購買上限 ${MAX_QTY}`;

/** V-2a:CartItem.vehicle 讀回逐 kind 分驗(壞資料→undefined 丟棄、絕不 throw;鏡像既有逐欄防禦)。 */
function readVehicle(v: unknown): CartItemVehicle | undefined {
  if (!v || typeof v !== 'object') return undefined;
  const o = v as Record<string, unknown>;
  const year = typeof o.year === 'number' && Number.isInteger(o.year) ? o.year : undefined;
  if (o.kind === 'dict') {
    if (typeof o.brand !== 'string' || o.brand.length === 0) return undefined;
    if (typeof o.model !== 'string' || o.model.length === 0) return undefined;
    if (o.source !== 'search' && o.source !== 'garage' && o.source !== 'picker') return undefined;
    return { kind: 'dict', brand: o.brand, model: o.model, year, source: o.source };
  }
  if (o.kind === 'free') {
    if (typeof o.raw !== 'string' || o.raw.length === 0) return undefined;
    if (o.source !== 'garage' && o.source !== 'freetext') return undefined;
    return { kind: 'free', raw: o.raw, year, source: o.source };
  }
  return undefined;
}

function readStorage(): CartItem[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    const out: CartItem[] = [];
    for (const x of parsed) {
      if (!x || typeof x !== 'object') continue;
      if (typeof x.productId !== 'string' || x.productId.length === 0) continue;
      const qty = clampQty(x.qty);
      if (qty < 1) continue;
      // v2:只認 variantId(string 非空 → 帶、否則無變體 undefined);舊 v1 的 color/size 不解析、自然丟棄。
      const variantId =
        typeof x.variantId === 'string' && x.variantId.length > 0 ? x.variantId : undefined;
      const vehicle = readVehicle(x.vehicle); // V-2a:選填、壞資料丟棄不擋整筆
      out.push({ productId: x.productId, qty, variantId, ...(vehicle ? { vehicle } : {}) });
    }
    return out;
  } catch {
    return [];
  }
}

function writeStorage(items: CartItem[]) {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(items));
  } catch {
    // localStorage 滿 / 隱私模式 / disabled — 靜默失敗、cart 退化為 session-only
  }
}

function readSessionId(): string | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = window.localStorage.getItem(SESSION_KEY);
    // 🔴 #245:只信任 UUID 格式(對齊 charge-actions / callback server 端 UUID_RE fail-closed)。
    //   非 UUID 污染值(使用者亂改 localStorage / 未來誤寫 SESSION_KEY 的新路徑)→ 丟棄視同無 key,
    //   交 mount `?? 補生` + writeSessionId 覆寫自癒;否則重整恆讀回污染值 → server 拒 → 結帳卡死不自癒。
    return typeof raw === 'string' && UUID_RE.test(raw) ? raw : null;
  } catch {
    return null;
  }
}

function writeSessionId(id: string | null) {
  if (typeof window === 'undefined') return;
  try {
    if (id) window.localStorage.setItem(SESSION_KEY, id);
    else window.localStorage.removeItem(SESSION_KEY);
  } catch {
    // 同 writeStorage:localStorage 滿 / 隱私模式 → 靜默失敗
  }
}

export function CartProvider({
  children,
  // 車的主人 = server 端 `supabase.auth.getUser()` 的結果,由 `app/layout.tsx` 交下來。
  // 🔴 **三態,而 `undefined` 不是「沒登入」是「不知道」**:
  //   `string` 有人 / `null` **確定沒人** / `undefined` **這一次沒讀到**(或呼叫端沒帶這個 prop)。
  //   ⚠️ **不要給它 `= null` 的預設值** —— 那會把「不知道」壓成「登出了」,而下游拿它去清車。
  serverOwnerId,
}: {
  children: ReactNode;
  serverOwnerId?: string | null;
}) {
  const [items, setItems] = useState<CartItem[]>([]);
  const [isHydrated, setIsHydrated] = useState(false);
  const [cartSessionId, setCartSessionId] = useState<string | null>(null);

  useEffect(() => {
    const restored = readStorage();
    const storedSession = readSessionId();
    setItems(restored);
    // 🔴 prev ?? stored ?? 還原車補生:不覆寫 pre-hydrate 已 regenerate/addItem 的 key(hydrate-race 防線);
    //   storedSession 無但有還原品項(7a 前的舊車)→ 補生一把,使既有車也納入去重。
    setCartSessionId(
      (prev) => prev ?? storedSession ?? (restored.length > 0 ? newCartSessionId() : null),
    );
    setIsHydrated(true);
  }, []);

  // ── 車不跟人走的洞(補洞窗 A1)────────────────────────────────────────────────
  // 病徵:車行共用一台電腦,A 加了一車、登出走人,B 坐下來看到的還是 A 的車。
  //   本 Provider 是 **localStorage-only**(檔頭 Phase 1 mock),而 localStorage 是**綁瀏覽器不綁人**
  //   ⇒ 在有 A1 之前,`grep -c 'userId' CartContext.tsx` = 0,登出也不清。
  //
  // 抄的形狀:`FavoritesContext.tsx:145` 的 onAuthStateChange 訂閱(連 try/catch 一起抄 ——
  //   env / browser client 不可用時**維持未登入預設、不阻斷 render**)。
  //
  // 🔴 **只差一個地方,而那個差別是刻意的**:收藏清「每一次 userId 變動」,購物車**不清 `null → A`**。
  //   收藏住在 server(換人 = 重載那個人的),購物車住在這台瀏覽器裡。
  //
  //   🔴 **承重的理由是 `INITIAL_SESSION`**(R2 更正,2026-08-23):每次開頁 `prevOwnerRef` 都從
  //   `null` 起步,而訂閱當下就 emit `INITIAL_SESSION` 帶回登入者 ⇒ **每一次重整都是 `null → A`**
  //   ⇒ 清它 = **每個回頭客每次開頁被倒車**。這條與動線假設無關,是機制逼出來的,**沒有第二種寫法**。
  //
  //   次要理由(方向相同,但**它可以被推翻,別拿它當唯一依據**):訪客先逛先加、結帳那步才登入
  //   —— 我沒有量過這條動線有多少人在走,只是「若成立則同向」。
  //   ⇒ 只清這兩種:`A → null`(登出)與 `A → B`(換人)。
  //
  //   ⚠️ **兩條沒蓋住而都不走 auth 事件**(R2 nit F2,主視窗已另立條目、**不在本片**):
  //     ① session 在沒有分頁開著時死掉(過期 / 遠端 revoke / 改密碼)⇒ 重開是 `null`,A 的車還在
  //        storage ⇒ B 登入走 `null → B` ⇒ **繼承 A 的車**
  //     ② 前一人全程訪客沒登入 ⇒ 下一人登入繼承訪客車(**原理上分不出**是誰的)
  //     ③ **A 沒有登出就走人**(R3 nit,2026-08-23 明文寫進清單):下一個人坐下來時 A 還登著,
  //        `ownerId` 從頭到尾沒變過 ⇒ 這段**不會觸發**,而那是對的 —— 它守的是「主人換了」,
  //        不是「坐在椅子上的人換了」,後者**在瀏覽器裡量不到**。
  //        ⚠️ 寫進來的理由:不寫,它每隔一陣子就會被當成 bug 重報一次。
  //     ④ cookie 還在而 session 真的過期 / 被 revoke ⇒ `layout.tsx` 判 `undefined` ⇒ 車留著
  //        (該清而沒清;取捨與理由在 `layout.tsx` 那段註解,方向是「不倒別人的車」)
  //
  // 🔴 為什麼不用 `.clear()` 那條 R3 must-fix(`FavoritesContext.tsx:161` 上方那段)去照抄:
  //   那條治的是「舊帳號還在路上的 worker,收尾時動到新帳號的那份 ref」。
  //   **本 Provider 沒有任何 async worker**(addItem/updateQty 全是同步 setState)⇒ 沒有孤兒可寫回。
  //   這裡用 `setItems([])`(新陣列)本來就不共用物件,不需要那道防線。若哪天 cart 接了 server,
  //   把那段連同它的理由一起搬過來。
  // 🔴🔴 **主人是誰,由 server 交下來,不由 client 去問**(2026-08-23 真瀏覽器實測後改寫)。
  //   ~~原版訂 `createBrowserSupabaseClient().auth.onAuthStateChange`~~ —— **那條在本站【永遠不會響】**:
  //   登入是 server action(`app/login/actions.ts` 伺服器端 `signInWithPassword` → 設 cookie → redirect),
  //   瀏覽器那個 supabase 實例**從頭到尾沒有執行過登入** ⇒ 收不到 `SIGNED_IN`。
  //
  //   🔴 實測序列(真瀏覽器,舊版):99 件 → 登甲 99 → 重整 99 → 登出 99 → **登乙 99(該清而沒清)**;
  //   身分是量到的(cookie `sb-…-auth-token` 解出 sub 由 2222… 變 1111…),而 `pcm-cart-mock-v2`
  //   與 `pcm-cart-session-v1` 全程同一筆。
  //
  //   🔴 **而單元測試是綠的** —— 因為它**自己去呼叫**那個 callback。
  //   一個自己扮演呼叫端的測試,永遠不會發現沒有呼叫端。⇒ 這一段的證人改成【真瀏覽器序列】。
  //
  //   ⚠️ 一併證偽的假設:「登入是整頁重載 ⇒ provider 重掛 ⇒ ref 歸零」——
  //   登入前在 `window` 放 marker、登入後 marker 還在 ⇒ **是 client-side 導覽,provider 沒重掛**。
  //   那個假設解釋得通,而它是假的。
  const ownerId = serverOwnerId;

  const prevOwnerRef = useRef<string | null>(null);
  const warnedUnknownOwnerRef = useRef(false);
  useEffect(() => {
    // 🔴 `undefined` = 這一次沒讀到主人是誰 ⇒ **什麼都不做,連 `prevOwnerRef` 都不更新**。
    //   更新了它,下一次真的讀到時就會拿 `undefined` 當「前一個人」去比,比出一個假的換人。
    if (ownerId === undefined) {
      // 🔴 活性訊號(R3 nit):`undefined` 一路安靜下去 = 這段清車**永遠不會發生**,
      //   而畫面在「裝了而生效」與「裝了而沒生效」兩個世界長得一模一樣 ——
      //   那正是這一片第一版翻車的形狀。連續多次就吼一聲,只吼一次、不洗版。
      // ⚠️ 這裡**不能**數「連續幾次」:本 effect 的依賴是 `[ownerId]`,而一連串 `undefined` 之間
      //   值沒有變 ⇒ effect 根本不會再跑。**數 effect 跑幾次的量具,量不到「一直是 undefined」。**
      //   (第一版就是這樣寫的,而它的測試當場紅 —— 那一格救了這個錯。)
      //   ⇒ 改成:**這次掛載第一次讀不到就吼一次**。env 壞掉的常態失敗從第一次 render 就成立。
      if (!warnedUnknownOwnerRef.current) {
        warnedUnknownOwnerRef.current = true;
        console.warn(
          '[cart] 讀不到購物車主人是誰 ⇒ 換人清車這段這次沒有作用(這不代表「沒有人換帳號」)。' +
            '查 app/layout.tsx 的 getUser() 與 NEXT_PUBLIC_SUPABASE_URL。',
        );
      }
      return;
    }
    const prev = prevOwnerRef.current;
    prevOwnerRef.current = ownerId;
    // `null → A` = 訪客登入(含每次開頁的 INITIAL_SESSION)⇒ 車留著。
    if (prev === null || prev === ownerId) return;
    // `A → null`(登出)/ `A → B`(換人)⇒ 清品項,並把去重子一起收掉
    //   (`cartSessionId` 是**這一車**的 idempotency 把手;車沒了它就不該再跟著新的人跑,
    //    留著會讓 B 的第一次結帳帶著 A 的去重子送 server)。
    //   持久化交給下面既有的兩支 effect(isHydrated 已為 true)⇒ localStorage 同步被清。
    setItems([]);
    setCartSessionId(null);
  }, [ownerId]);

  useEffect(() => {
    if (isHydrated) writeStorage(items);
  }, [items, isHydrated]);

  useEffect(() => {
    if (isHydrated) writeSessionId(cartSessionId);
  }, [cartSessionId, isHydrated]);

  // N4:`addItem` 的 useCallback deps 是 `[]`(刻意:身分穩定),所以它 closure 裡的 `items` 會過期
  // ⇒ 用一支 ref 抓最新快照,只給「這一列現在幾件」這個唯讀問題用,不參與任何寫入。
  const itemsRef = useRef(items);
  useEffect(() => {
    itemsRef.current = items;
  }, [items]);

  const addItem = useCallback((item: CartItem): number => {
    const safeQty = clampQty(item.qty);
    if (safeQty < 1) return 0;
    // 走到這一行就保證 `item.qty` 是有限數且 ≥ 1(`clampQty` 對 NaN/Infinity/<1 一律回 0)
    // ⇒ 下面把**未經上限截斷的原始請求量**餵給 `clampDrop` 是安全的,
    //   且比餵 `safeQty` 誠實:一次要加 200 件而車上是空的 ⇒ 該說「少加了 101 件」,不是 0。
    const existingQty = itemsRef.current.find((p) => sameLine(p, item))?.qty ?? 0;
    setCartSessionId((prev) => prev ?? newCartSessionId()); // 空車首件 → 生 key
    setItems((prev) => {
      const idx = prev.findIndex((p) => sameLine(p, item));
      if (idx >= 0) {
        return prev.map((p, i) =>
          i === idx ? { ...p, qty: clampQty(p.qty + safeQty) } : p
        );
      }
      return [...prev, { ...item, qty: safeQty }];
    });
    // ⚠️ `existingQty` 讀的是**上一次 render 後**的快照 ⇒ **連按兩下的第二下可能算不準**
    //   (頂多是「該提示而沒提示」,不會提示錯的數字)。要完全準得把算法搬進上面那個更新函式裡,
    //   那會讓一個純函式變成有副作用的更新器 —— 不划算。這段原本寫在 `ProductInfo`,
    //   隨算法一起搬過來:**限制要跟著它所限制的那段碼走。**
    return clampDrop(existingQty, item.qty);
  }, []);

  const removeItem = useCallback((key: CartLineKey) => {
    setItems((prev) => prev.filter((p) => !sameLine(p, key)));
  }, []);

  const updateQty = useCallback((key: CartLineKey, qty: number) => {
    const safeQty = clampQty(qty);
    setItems((prev) => {
      if (safeQty < 1) return prev.filter((p) => !sameLine(p, key));
      return prev.map((p) => (sameLine(p, key) ? { ...p, qty: safeQty } : p));
    });
  }, []);

  // V-2a:設/清單列車款(不變 qty/session/去重;null=移除該欄)。以 line key 定位。
  const setItemVehicle = useCallback((key: CartLineKey, vehicle: CartItemVehicle | null) => {
    setItems((prev) =>
      prev.map((p) => {
        if (!sameLine(p, key)) return p;
        if (vehicle === null) {
          const { vehicle: _drop, ...rest } = p;
          return rest;
        }
        return { ...p, vehicle };
      }),
    );
  }, []);

  // V-2a:整車套用(全列同一車款;null=全清)。頂部車款欄一次填=§2 預設路。
  const setAllItemsVehicle = useCallback((vehicle: CartItemVehicle | null) => {
    setItems((prev) =>
      prev.map((p) => {
        if (vehicle === null) {
          const { vehicle: _drop, ...rest } = p;
          return rest;
        }
        return { ...p, vehicle };
      }),
    );
  }, []);

  const clear = useCallback(() => setItems([]), []);

  // 成交換新 key(7b 僅「DB 確定 paid」呼)。hydrate 前呼也安全:mount 讀用 prev ?? 不覆寫、持久化 gate isHydrated。
  const regenerateCartSession = useCallback(() => setCartSessionId(newCartSessionId()), []);

  const totalQty = useMemo(
    () => items.reduce((sum, item) => sum + item.qty, 0),
    [items]
  );

  const value = useMemo<CartContextValue>(
    () => ({
      items,
      totalQty,
      isHydrated,
      cartSessionId,
      addItem,
      removeItem,
      updateQty,
      setItemVehicle,
      setAllItemsVehicle,
      clear,
      regenerateCartSession,
    }),
    [items, totalQty, isHydrated, cartSessionId, addItem, removeItem, updateQty, setItemVehicle, setAllItemsVehicle, clear, regenerateCartSession]
  );

  return <CartContext.Provider value={value}>{children}</CartContext.Provider>;
}

export function useCart(): CartContextValue {
  const ctx = useContext(CartContext);
  if (!ctx) {
    throw new Error('useCart must be used within <CartProvider>');
  }
  return ctx;
}
