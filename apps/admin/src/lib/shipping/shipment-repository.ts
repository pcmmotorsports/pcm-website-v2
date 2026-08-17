// shipment-repository.ts — 出貨線(B2)五支 writer RPC 的唯一呼叫面 + 兩個讀取面。
//
// 片 2a(D-347-A / D-349-A;Sean 拍 S1=A C 版 + S2=A 含作廢)。UI 兩片(2b 勾選+彈窗、2c 詳情卡)都吃這支。
//
// 🔴 **寫入一律走既有 RPC,本檔零自寫 SQL**(D-347-A 工程紅線)。真正的正確性層在 DB:
//    CHECK / FK / 冪等層 / 死結重試都在 migration 裡,本檔只是型別安全的傳話筒。
//    ⇒ 這裡**不重複實作任何業務驗證**(例如「carrier 是 other 才可填 note」),那會變成第二個真相源;
//      UI 端擋是為了不讓員工按了才看到錯誤(體驗),DB 擋才是正確性。
//
// 🔴 **冪等鍵由呼叫端給、本檔不自己產**。理由:重試必須沿用**同一把鍵**才叫冪等;
//    若在這裡 `randomUUID()`,每次重試都是新鍵 ⇒ 冪等層完全失效而且零症狀
//    (對齊 memory `feedback_idempotency-key-must-be-verified-not-just-present`)。
//
// ⚠️ **本檔沒有實跑驗證過**:本 worktree 無 DB(無 `.env.local`、不碰 `.env*`)⇒ 下面所有形狀
//    都是**讀 migration 原始檔**得到的合約,不是打過 RPC 的觀察。真 DB smoke 由收割端補。

// 🔴 走 `/server` 子路徑,與 `customer-repository.ts:7` 同一個進入點 —— 從 `@pcm/adapters`
//    根路徑 import 會拿不到這個 export(typecheck 當場紅),而且那條路徑是給 client 用的。
import { createSupabaseServiceClient } from '@pcm/adapters/server';

/**
 * 五支 writer 的共同回傳信封。
 *
 * 🔴 形狀是**單一產生處**決定的:`pcm_b2_shipping_idem_response()`
 * (`20260807160000_…w2_shipping_idempotency_layer.sql`)回
 * `snapshot || {shipment_id, idempotent}`,而 snapshot 的鍵被
 * `pcm_b2_shipping_idem_bad_snapshot_cols()` 限制成**恰好** `id / shipment_reference / customer_user_id`。
 * ⇒ 恆為這五個鍵,首次成功與重放**逐鍵相同、只差 `idempotent`**。
 */
export type ShipmentWriteResult = {
  shipmentId: string;
  shipmentReference: string;
  customerUserId: string;
  /** true = 這次呼叫是**重放**(同鍵同 payload),DB 沒有再動一次。 */
  idempotent: boolean;
};

/** 快遞商三選。字面與 `shipments_carrier_domain` CHECK 同源。 */
export type CarrierCode = 'hct' | 'sf' | 'other';

/** 收件快照。DB 要求**恰好**這三個欄位(`pcm_b2_w3a_recipient_shape`),多一個少一個都退件。 */
export type RecipientSnapshot = { name: string; phone: string; line: string };

/** 掛品項的單筆。同一次呼叫裡 `orderItemId` 不得重複(DB 會退件並要求合併數量)。 */
export type ShipmentItemInput = { orderItemId: string; quantity: number };

/**
 * 把 RPC 的 `Json` 回傳收斂成 `ShipmentWriteResult`。
 *
 * 🔴 **不用 `as` 硬轉**:RPC 宣告的回傳型別是 `Json`,硬轉等於把「DB 真的回了這些鍵」
 *    這件事變成一個沒人驗的假設。少一個鍵時我們要當場炸,而不是讓 `undefined`
 *    一路流進畫面變成空白的箱號。
 */
function toWriteResult(raw: unknown, fn: string): ShipmentWriteResult {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new Error(`${fn}:回傳不是 JSON 物件(實得 ${Array.isArray(raw) ? 'array' : typeof raw})`);
  }
  const o = raw as Record<string, unknown>;
  const need = (k: string): string => {
    const v = o[k];
    if (typeof v !== 'string' || v === '') {
      throw new Error(`${fn}:回傳缺少字串欄位 ${k}(實得 ${JSON.stringify(v)})`);
    }
    return v;
  };
  if (typeof o.idempotent !== 'boolean') {
    // 🔴 這個旗標是「這次到底有沒有真的動到資料」的唯一訊號,缺了它就分不出成功與重放。
    throw new Error(`${fn}:回傳缺少 boolean 欄位 idempotent(實得 ${JSON.stringify(o.idempotent)})`);
  }
  return {
    shipmentId: need('shipment_id'),
    shipmentReference: need('shipment_reference'),
    customerUserId: need('customer_user_id'),
    idempotent: o.idempotent,
  };
}

/**
 * 建箱(W3-1)。
 *
 * ⚠️ 箱子掛在**客人**下、**沒有 order_id** —— 一箱可跨同一位客人的多張訂單(C 版動線的根據)。
 * DB 會擋:carrier 三選 / `other` 與說明欄雙向配對 / 收件快照恰好三欄 / 客人必須存在。
 */
export async function createShipment(args: {
  idempotencyKey: string;
  customerUserId: string;
  recipient: RecipientSnapshot;
  carrierCode: CarrierCode;
  /** 只有 `carrierCode === 'other'` 時可(且必須)給。 */
  carrierNote?: string;
}): Promise<ShipmentWriteResult> {
  const { data, error } = await createSupabaseServiceClient().rpc('admin_create_shipment', {
    p_idempotency_key: args.idempotencyKey,
    p_customer_user_id: args.customerUserId,
    p_recipient_snapshot: args.recipient,
    p_carrier_code: args.carrierCode,
    ...(args.carrierNote === undefined ? {} : { p_carrier_note: args.carrierNote }),
  });
  if (error) throw error;
  return toWriteResult(data, 'admin_create_shipment');
}

/**
 * 掛品項(W3-2)。
 *
 * ⚠️ 同一次呼叫裡 `orderItemId` **不得重複**(DB 退件並要求合併數量)⇒ UI 用數量框、不要「再加一次」。
 * 箱子已作廢或已出貨都不能再掛。品項必須屬於這箱的同一位客人。
 */
export async function addShipmentItems(args: {
  idempotencyKey: string;
  shipmentId: string;
  items: readonly ShipmentItemInput[];
}): Promise<ShipmentWriteResult> {
  const { data, error } = await createSupabaseServiceClient().rpc('admin_add_shipment_items', {
    p_idempotency_key: args.idempotencyKey,
    p_shipment_id: args.shipmentId,
    p_items: args.items.map((i) => ({ order_item_id: i.orderItemId, quantity: i.quantity })),
  });
  if (error) throw error;
  return toWriteResult(data, 'admin_add_shipment_items');
}

/**
 * 標已出貨(W3-3)。
 *
 * ⚠️ 三閘:箱子存在且未作廢 / 至少 1 個品項 / 填了單號(只有 `carrier_code = 'other'` 可免)。
 */
export async function markShipmentShipped(args: {
  idempotencyKey: string;
  shipmentId: string;
  /** `carrier_code = 'other'` 以外都必填。 */
  trackingNumber?: string;
}): Promise<ShipmentWriteResult> {
  const { data, error } = await createSupabaseServiceClient().rpc('admin_mark_shipment_shipped', {
    p_idempotency_key: args.idempotencyKey,
    p_shipment_id: args.shipmentId,
    ...(args.trackingNumber === undefined ? {} : { p_tracking_number: args.trackingNumber }),
  });
  if (error) throw error;
  return toWriteResult(data, 'admin_mark_shipment_shipped');
}

/** 作廢這箱(W3-c1)。原因必填。作廢後不可再掛品項、不可出貨;要重出得開新的一箱。 */
export async function voidShipment(args: {
  idempotencyKey: string;
  shipmentId: string;
  voidReason: string;
}): Promise<ShipmentWriteResult> {
  const { data, error } = await createSupabaseServiceClient().rpc('admin_void_shipment', {
    p_idempotency_key: args.idempotencyKey,
    p_shipment_id: args.shipmentId,
    p_void_reason: args.voidReason,
  });
  if (error) throw error;
  return toWriteResult(data, 'admin_void_shipment');
}

/** 復原作廢(W3-c2)。 */
export async function unvoidShipment(args: {
  idempotencyKey: string;
  shipmentId: string;
}): Promise<ShipmentWriteResult> {
  const { data, error } = await createSupabaseServiceClient().rpc('admin_unvoid_shipment', {
    p_idempotency_key: args.idempotencyKey,
    p_shipment_id: args.shipmentId,
  });
  if (error) throw error;
  return toWriteResult(data, 'admin_unvoid_shipment');
}

// ── 讀取面 ─────────────────────────────────────────────────
// 🔴 讀**不走 RPC**:`shipments` / `shipment_items` 都有 `GRANT SELECT … TO service_role`
//    (s1a1:277 / s1b:254)⇒ 直接 SELECT。不為了對稱而多包一層沒有的 RPC。

/**
 * 兩支讀取面**共用**的投影。
 *
 * 🔴 **抽成常數是為了讓一整類 bug 消失,不是為了少打字**(R2 nit-3):
 * 原本兩支各自逐字寫一份 10 欄 ⇒ 「其中一支漏撈 `recipient_snapshot`」是個真的會發生、
 * 而且畫面上完全看不出來的漂移(詳情卡本來就不顯示收件人)。
 * 共用之後那個漂移**構造不出來**。
 * **讓 bug 不可能 > 守著 bug**,所以這個交換划算。
 *
 * 🔴🔴 **這個常數的欄位完整性由 `typecheck` 守,不另立測試格 —— 不要再加一格回來。**
 * R2 實測(2026-08-15,把 `recipient_snapshot` 從本常數刪掉再跑 `pnpm run typecheck`):
 * **`(280,46)` 與 `(302,46)` 兩處 TS2339 當場紅**(兩個 mapper 各一),因為 supabase-js
 * 由 select 字面推導回傳型別。
 * ⇒ 原本那格「兩支都要撈 `recipient_snapshot`」**被 typecheck 嚴格蘊含**:三綠每次都跑 typecheck,
 *   那格**永遠不可能是第一個紅的** = 恆綠格,已刪。
 * ⚠️ 值路徑(撈到之後有沒有正確映射、空字串會不會被折成 null)**typecheck 守不到**,
 *   那幾格留著,見 `shipment-repository.test.ts` 的 `readBoth()` 族。
 */
const SHIPMENT_ROW_SELECT =
  'id, shipment_reference, customer_user_id, carrier_code, carrier_note, tracking_number, shipped_at, deleted_at, void_reason, recipient_snapshot';

/** 畫面用的一箱。`voidedAt` 非 null = 已作廢;`shippedAt` 非 null = 已出貨。 */
export type ShipmentRow = {
  id: string;
  shipmentReference: string;
  customerUserId: string;
  carrierCode: string;
  carrierNote: string | null;
  trackingNumber: string | null;
  shippedAt: string | null;
  voidedAt: string | null;
  voidReason: string | null;
  /**
   * 這箱**實際寄達**的收件資料(`#10` 片2a 起才撈;在此之前 TS 側從不讀它,只寫)。
   *
   * 🔴🔴 **三個欄位都可能是空字串 `''`,而且那是合法寫入、不是髒資料。** 寫入鏈四層,沒有一層擋空:
   *   `shipment-launcher.tsx:135` 缺資料時給 `{name:null,phone:null,line:null}`
   *   → `shipment-dialog.tsx:186` `recipient.name ?? ''` **把 null 折成空字串**
   *   → `shipment-actions.ts:40/100` 原封轉送、零驗證零 trim
   *   → DB CHECK `shipments_recipient_snapshot_shape`
   *     (`20260805170000:120-125`)只要求「物件 + 恰三鍵 + 值皆為 string」——**`''` 是 string,過**。
   * ⇒ **CHECK 保證的是鍵存在,不保證值有內容。** 要印在紙上的地方**必須自己判空並 fail-closed**,
   *   不可以假設有地址。(一張沒有收件人的出貨單被印出來,會有人真的拿去寄。)
   *
   * 🔴 **`null` = 「這欄讀不出來」**(jsonb 形狀不符),與「三個空字串」是兩件事:
   * 前者是我們讀壞了,後者是建箱當下真的沒填。兩者都不可印,但原因不同、文案該不同。
   * 用 `X | null` 表達「不知道」是本 repo 的既有 idiom(`packages/domain/src/order/types.ts:1121`)。
   *
   * 🔴🔴 **本欄讓 `ShipmentRow` 自 `#10` 片2a 起帶 PII(收件人姓名 / 電話 / 地址)。**
   * 在此之前這個型別全是箱號與狀態,可以隨手往下傳;**現在不行了。**
   * ⇒ **絕不可以把整個 `ShipmentRow` 展開丟進 client component**(`{...shipment}` / 當 prop 整包傳)——
   *   那會把收件人 PII 送進瀏覽器。要用就**逐欄挑**你真的要顯示的那幾個。
   * (現況零 client 消費端:`shipment-section.tsx` 是 server component、只往下傳純量;
   *  但型別上沒有任何東西擋住下一個人,所以把話寫在這裡。)
   */
  recipientSnapshot: RecipientSnapshot | null;
};

/**
 * 把 DB 的 jsonb 收成 `RecipientSnapshot`;形狀不符回 `null`(**不 throw**)。
 *
 * 🔴 **為什麼不比照 `toWriteResult()` 直接 throw**:那支守的是**寫入**回傳,炸掉是對的
 * (寫壞了要當場知道)。本支餵的是**訂單詳情頁的出貨卡**——為了一箱的收件快照形狀怪
 * 而讓整張詳情頁掛掉,代價遠大於「那一箱的收件人顯示為不可用」。
 * ⚠️ 但**不可以靜默補空物件** —— 那會讓「讀壞了」長得跟「沒填」一模一樣。回 `null`,呼叫端分得出來。
 */
function toRecipientSnapshot(raw: unknown): RecipientSnapshot | null {
  if (raw === null || typeof raw !== 'object') return null;
  const o = raw as Record<string, unknown>;
  const { name, phone, line } = o;
  if (typeof name !== 'string' || typeof phone !== 'string' || typeof line !== 'string') return null;
  // 🔴 **不 trim、不補值**:原樣回傳,讓呼叫端自己判空。
  //    在這裡 trim 會讓「只打了幾個空白」與「真的填了」在上層分不出來。
  return { name, phone, line };
}

/** 一箱裡的一個品項。 */
export type ShipmentItemRow = {
  id: string;
  shipmentId: string;
  orderItemId: string;
  shippedQuantity: number;
};

/**
 * 依箱 id 取箱(訂單詳情頁的出貨卡用:先由品項查到箱 id,再查箱本身)。
 *
 * ⚠️ 不走 `listShipmentsByCustomer` 的原因:`AdminOrderDetail` **沒有 customer id**
 * (見 `shipment-candidates.ts` 檔頭那段)。
 * 🔴 **2026-08-10 #351④ 更正**:上一句的後半原本寫「詳情頁**拿不到**客人身分」,那已被證偽 ——
 * `loadEmptyShipments` 就是在詳情頁用 `listOrderCustomerUserIds()`(兩欄獨立查詢、不碰 PII 白名單)
 * 拿到客人身分的。**仍然不走** `listShipmentsByCustomer` 的真正理由是:本支要的是
 * 「**這批品項所在的那些箱**」,拿客人的全部箱回來再濾是多查一堆用不到的列。
 */
export async function listShipmentsByIds(ids: readonly string[]): Promise<ShipmentRow[]> {
  if (ids.length === 0) return [];
  const { data, error } = await createSupabaseServiceClient()
    .from('shipments')
    .select(SHIPMENT_ROW_SELECT)
    .in('id', [...ids])
    .order('created_at', { ascending: true });
  if (error) throw error;
  return (data ?? []).map((r) => ({
    id: r.id,
    shipmentReference: r.shipment_reference,
    customerUserId: r.customer_user_id,
    carrierCode: r.carrier_code,
    carrierNote: r.carrier_note,
    trackingNumber: r.tracking_number,
    shippedAt: r.shipped_at,
    voidedAt: r.deleted_at,
    voidReason: r.void_reason,
    recipientSnapshot: toRecipientSnapshot(r.recipient_snapshot),
  }));
}

/** 某位客人的所有包裹(建箱動線用:看他還有哪些箱在路上)。 */
export async function listShipmentsByCustomer(customerUserId: string): Promise<ShipmentRow[]> {
  const { data, error } = await createSupabaseServiceClient()
    .from('shipments')
    .select(SHIPMENT_ROW_SELECT)
    .eq('customer_user_id', customerUserId)
    .order('created_at', { ascending: false });
  if (error) throw error;
  return (data ?? []).map((r) => ({
    id: r.id,
    shipmentReference: r.shipment_reference,
    customerUserId: r.customer_user_id,
    carrierCode: r.carrier_code,
    carrierNote: r.carrier_note,
    trackingNumber: r.tracking_number,
    shippedAt: r.shipped_at,
    voidedAt: r.deleted_at,
    voidReason: r.void_reason,
    recipientSnapshot: toRecipientSnapshot(r.recipient_snapshot),
  }));
}

/**
 * `listAssignedQuantitiesByOrderItemIds` 一次塞進 `.in()` 的 id 數。
 *
 * 🔴 **這道解的是【URL 長度】,不是列數**(codex 2026-08-17 R2 抓到,兩者常被混為一談):
 * `.in()` 走 GET query string,而上游允許 50 張單 × 每張撈到盡 ⇒ **上萬個 uuid**
 * ⇒ 查詢字串可達數十萬字元 ⇒ **請求會先被 URL / gateway 上限拒絕,根本走不到任何列數守門**。
 * ⚠️ 本檔另外兩支讀取面也吃同一個形狀(`shipment-repository.ts` 內 `.in('shipment_id', …)`
 * 那條的 URL 過長風險 `order-shipments.ts` 已明寫「記在這裡不假裝沒有」)——
 * **本片只治這一支**,另外那支的輸入基數小一個量級,不順手改。
 * ⚠️ `200` 是**估的,不是量的**:沒有量過本專案的實際 URL 上限。
 *    取這個值的理由只是「明顯遠低於任何常見的 8KB～16KB header 限制」(200 × 37 字元 ≈ 7.4KB)。
 */
export const ASSIGNED_QUANTITY_ID_CHUNK = 200;

/**
 * 每次翻頁要幾列。
 *
 * 🔴🔴 **這【不是】一道守門,是頁大小 —— 兩者差別是本片第二輪被打回的原因,寫在這裡免得又繞回去。**
 * 上一版用的是「自夾一個 `N`、超過就 fail-closed」,而那個形狀有**兩個都沒量過的邊界**:
 * ```
 * 伺服器 max-rows 若【低於】N ⇒ 判定恆假、守門靜默變 no-op ⇒ 原病照舊（fail-open）
 * 合法用量若【高於】N        ⇒ 建箱彈窗常態性打不開，員工只看到一則通用錯誤
 * ```
 * 兩邊都是猜的 ⇒ **不管挑哪個數字都會錯一邊。**⇒ 改成翻頁,**把「要挑一個數」這件事拿掉**。
 * 🔴 **本迴圈的正確性不依賴這個數**:終止條件是「**拿到 0 列**」、`from` 前進**實得筆數**
 * ⇒ 伺服器把頁切短時只是多跑幾圈,**不會跳過任何一列**。這個數只影響往返次數。
 * ⚠️ **不可以改成「本頁不滿即停」** —— 那會讓「伺服器砍過的一頁」與「真正的末頁」
 *    在觀察上完全一樣,正是 `listOrderItemsForPrint` docstring 那段「零餘裕」的病。
 * 形狀與 `PRINT_ORDER_ITEMS_PAGE_SIZE`(adapter 側,同樣是 200)同源,**刻意用同一個做法**。
 */
export const ASSIGNED_QUANTITY_PAGE_SIZE = 200;

/** 防呆上限:每個 chunk `200 × 50 = 10,000` 列。命中時 **throw、不回部分**(理由同下)。 */
export const ASSIGNED_QUANTITY_MAX_PAGES = 50;

/**
 * 給一組訂單品項 id,算出**每個品項已經被配進箱子的數量**(排除已作廢的箱)。
 *
 * 🔴 **這不是 `order_item_quantity_summary.shipped_quantity`,而且刻意不是。**
 * 那一欄算的是「**已寄出**」(`shipments.shipped_at` 有值);而建箱畫面要排除的是
 * 「**已經被裝進任何一個沒作廢的箱**」—— 包含**還沒寄出的草稿箱**。
 * 用 `shipped_quantity` 的話,已經放進草稿箱的品項仍會顯示成可選 ⇒ **同一件被裝進第二個箱子**。
 * 兩個是不同的問題,不是同一個數字的兩種取法。
 *
 * 🔴 作廢的箱要排除:`admin_void_shipment` 之後那些品項應該**回到可出貨池**
 * (合約:「要重新出這批貨請開一張新的包裹」)。漏了這個過濾,作廢一箱等於把貨永久鎖住。
 *
 * ⚠️ 本函式**沒有實跑驗證**(本 worktree 無 DB)。`!inner` + 巢狀 `.is()` 的過濾語意
 * 是照 PostgREST 文件寫的,真行為要收割端的 smoke 驗。
 *
 * 🔴🔴 **截斷 = fail-open,而那是本函式最危險的失敗模式**(2026-08-16 code-reviewer R1 MF1 指出;
 *    ~~當時刻意不修,理由逐字是「修它要連呼叫端(建箱彈窗候選流程)一起 fail-closed,
 *    那是另一條動線、另一片」~~ ⇒ **2026-08-17 `D2` 甲那一片就是「另一片」,延後的理由到期,這裡補上。**
 *    (codex 2026-08-17 對抗審查 MF1 再次點名;**它是對的,而且理由比上次更硬**,見下。))
 *    **它的輸入基數比同檔另外兩支【都大】** —— 是「N 張訂單的全部品項」(`shipment-candidates.ts`),
 *    而 `D2` 甲把上游從「每單最多 200 件」改成「撈到盡」⇒ **這支的輸入只會變大,不會變小。**
 *    ⚠️ **少算的方向就是危險那一邊**:`already` 少算 ⇒ **已裝箱的品項顯示成還可以出**
 *    ⇒ **同一件被裝進第二個箱** —— 正是本函式上方那段拚命要擋的那件事,而**畫面完全正常**。
 *
 * 🔴🔴 **修法是【翻頁撈到盡】,不是「自夾一個上限」——第一版挑了 `900`,兩輪 codex 都打回。**
 *    被打回的理由不是數字挑錯,是**形狀錯**:那個做法要同時猜「伺服器上限」與「合法最大用量」,
 *    而**兩個我都沒量過** ⇒ 猜低了就常態性失敗、猜高了守門靜默 no-op。詳見兩個頁大小常數的註解。
 *    ⇒ 現在**沒有任何一個數字承擔正確性**:終止條件是「拿到 0 列」,伺服器怎麼切都只是多跑幾圈。
 *
 * 🔴 **兩層分批,治的是兩件不同的事,不要合併理解**:
 *    · **外層 chunk `.in()` 的 id** ⇒ 治 **URL 長度**(見 `ASSIGNED_QUANTITY_ID_CHUNK`)
 *    · **內層 `.range()` 翻頁**   ⇒ 治 **回傳列數**(見 `ASSIGNED_QUANTITY_PAGE_SIZE`)
 *    少了外層,請求根本發不出去;少了內層,發得出去但**被靜默切掉**。
 *
 * 🔴 **按 `shipment_items.id` 去重**:翻頁期間有寫入時同一列可能跨頁重複出現,
 *    而本函式是**加總** ⇒ 重複會讓 `already` **偏高** ⇒ 那個方向是 fail-closed(安全側),
 *    但仍然是錯的數字(員工看到「不能出」而其實能出)。去重兩行,把這個失敗模式**結構性消掉**。
 *
 * 🔴 **撈不完 ⇒ throw,不回部分 Map**(與 `listOrderItemsForPrint` 同一立場,Sean `Q2` 甲):
 *    部分 Map 會讓 `already` **少算** ⇒ **已裝進別的箱的件顯示成還可以出**
 *    ⇒ **同一件被裝進第二個箱**,而彈窗看起來完全正常。
 *    ⚠️ 回空 Map 更糟:那是「一件都還沒配箱」=「全部都可以出」,正好是最危險的那個答案。
 */
export async function listAssignedQuantitiesByOrderItemIds(
  orderItemIds: readonly string[],
): Promise<Map<string, number>> {
  if (orderItemIds.length === 0) return new Map();
  const supabase = createSupabaseServiceClient();
  // 🔴 按列 `id` 去重(理由見 docstring);值在全部撈完之後才加總,不邊撈邊加。
  const rowsById = new Map<string, { orderItemId: string; quantity: number }>();

  for (let i = 0; i < orderItemIds.length; i += ASSIGNED_QUANTITY_ID_CHUNK) {
    const chunk = orderItemIds.slice(i, i + ASSIGNED_QUANTITY_ID_CHUNK);
    // 🔴🔴 **游標綁【資料】不綁【位置】(keyset),不可以用 `.range()` 的位移量。**
    //    這一條是 codex R3 換角度打回來的,而**我第一版真的寫成 `.range()`** ——
    //    理由是「照抄 `listOrderItemsForPrint`」,而**那支的前提在這裡不成立**:
    //    ```
    //    order_items      建單之後不再新增/刪除（那支 docstring 逐支數過 8 支 migration）
    //                     ⇒ 集合固定 ⇒ OFFSET 安全
    //    shipment_items   建箱【會新增】、作廢箱【會退出結果集】（本檔上面五支 writer 就在寫它）
    //                     ⇒ 集合會動 ⇒ OFFSET 位移之後【會跳過還沒讀到的列】
    //    ```
    //    ⚠️ 而 `Map` 去重**救不了漏列** —— 去重處理的是「同一列出現兩次」,
    //       漏列是「有一列一次都沒出現」,兩者不是同一件事。
    //    📎 那支自己的 docstring 就寫著失效條件(「哪天有補品項/刪品項的功能…要回頭改成 keyset」)——
    //       **我照抄了做法,沒照抄它的適用條款。**
    let cursor: string | null = null;
    let done = false;
    for (let page = 0; page < ASSIGNED_QUANTITY_MAX_PAGES; page += 1) {
      let q = supabase
        .from('shipment_items')
        .select('id, order_item_id, shipped_quantity, shipments!inner(deleted_at)')
        .in('order_item_id', [...chunk])
        .is('shipments.deleted_at', null)
        // 🔴 排序鍵要**唯一**,否則同一列可能在兩頁都不出現(不只是重複,是【漏】)。
        //    `shipment_items.id` 是 PK ⇒ 唯一。
        .order('id', { ascending: true })
        .limit(ASSIGNED_QUANTITY_PAGE_SIZE);
      // 🔴 **不要寫成三元運算子的 `await (cursor === null ? q : q.gt(…))`** ——
      //    那會讓 TS 推不出 `data` 的型別(TS7022 循環:`cursor` 由 `data` 推、`data` 又由 `cursor` 推)。
      //    分開寫沒有那個環,而且讀起來也直接。
      if (cursor !== null) q = q.gt('id', cursor);
      const { data, error } = await q;
      if (error) throw error;
      const batch = data ?? [];
      // 🔴 終止條件是「**拿到 0 列**」,不是「本頁不滿」—— 後者在頁大小等於伺服器上限時
      //    會把「被切斷」讀成「撈完了」,而那正是本片在修的病。
      if (batch.length === 0) {
        done = true;
        break;
      }
      for (const r of batch) {
        rowsById.set(r.id, { orderItemId: r.order_item_id, quantity: r.shipped_quantity });
      }
      // 🔴 游標 = 這一頁**最後一列的 id**(已排序)。下一圈從它之後開始 ⇒
      //    中途有列被刪或新增,都不會讓還沒讀到的列被跳過。
      cursor = batch[batch.length - 1]!.id;
    }
    if (!done) {
      // 🔴 **throw,不回部分** —— 部分結果會讓已配箱量少算而畫面完全正常。
      // 🔴 訊息要帶得出**是哪一批**(codex R3:原版只寫函式名 ⇒ 值班的人查不出哪張單哪一步)。
      throw new Error(
        `listAssignedQuantitiesByOrderItemIds:第 ${i / ASSIGNED_QUANTITY_ID_CHUNK + 1} 批` +
          `(${chunk.length} 個品項,起於 ${chunk[0]},游標停在 ${cursor})` +
          `達 MAX_PAGES=${ASSIGNED_QUANTITY_MAX_PAGES}` +
          `(${ASSIGNED_QUANTITY_MAX_PAGES * ASSIGNED_QUANTITY_PAGE_SIZE} 列)仍未撈完;` +
          `不回傳部分結果 —— 少算已配箱量會讓同一件貨被裝進第二個箱。`,
      );
    }
  }

  const out = new Map<string, number>();
  for (const r of rowsById.values()) {
    out.set(r.orderItemId, (out.get(r.orderItemId) ?? 0) + r.quantity);
  }
  return out;
}

/**
 * 給一組訂單 id,查出各自掛在哪位客人下。
 *
 * 🔴 **為什麼不從 `AdminOrderDetail` 拿**:那份讀模型沒有 customer id,而它的白名單
 * `ADMIN_ORDER_DETAIL_SELECT` 是**帶 PII 的明細專用**白名單 —— 為了一個 id 去動它又是一輪鐵則 12。
 * 這裡只投影 `id, customer_user_id` 兩欄:零金額、零 PII,是最便宜的取法。
 *
 * 🔴 **這條的用途是「不信任 client 送來的客人 id」**:建箱時客人身分改由 server 從 `orders`
 * 自己查(見 `shipment-candidates.ts`),client 沒有機會送一個別人的 id 進來。
 *
 * ⚠️ `orders.customer_user_id` 是 **NOT NULL**(`database.types.ts` 的 `orders.Insert`
 * 把它列為必填、非 nullable)⇒ 下面那個 `typeof === 'string'` **不是在處理 null 值**,
 * 它處理的是「這一列根本沒讀到」那類契約破裂。查不到的 id 只是**不出現在 Map 裡**,
 * 呼叫端會因此判定「這批單沒有共同客人」而不給建箱 —— fail-closed,不會拿半個答案去打 RPC。
 */
export async function listOrderCustomerUserIds(
  orderIds: readonly string[],
): Promise<Map<string, string>> {
  if (orderIds.length === 0) return new Map();
  const { data, error } = await createSupabaseServiceClient()
    .from('orders')
    .select('id, customer_user_id')
    .in('id', [...orderIds]);
  if (error) throw error;
  const out = new Map<string, string>();
  for (const r of data ?? []) {
    if (typeof r.customer_user_id === 'string' && r.customer_user_id !== '') {
      out.set(r.id, r.customer_user_id);
    }
  }
  return out;
}

/**
 * 給一組**訂單品項** id,查出它們分別屬於哪位客人(去重後的集合)。
 *
 * 🔴🔴 **這是建箱時「箱子掛誰」的唯一來源**(見 `shipment-actions.ts` 的 `submitShipment`)。
 * 從**品項本身**反查,而不是收 client 送來的客人 id:client 就算竄改品項清單,
 * 推出來的也是那些品項真正的擁有者 ⇒ 建箱與掛品項對得起來,構造不出跨客人的箱。
 *
 * ⚠️ **刻意分兩次查、不用內嵌 join**:內嵌層的過濾/展開語意押在**本機測不到**的 PostgREST 行為上
 * (本機是裸 PG、沒有 PostgREST)。兩次平凡的 `.in()` 查詢沒有這個不確定性,
 * 而這條路徑上的筆數是個位數。
 *
 * 🔴 **更正(`#10` 片2a R2 nit-1)**:原文寫「**本專案**無法實測」並引
 * `SupabaseOrderAdapter.ts:408-413` 稱「那段註解逐字說明過這件事」——**兩件都不成立**:
 *   · 該檔 `:408-413`(HEAD 版逐字相同)是 **server-only / root barrel** 那段,與 PostgREST 內嵌無關;
 *   · `grep -n "本專案無法實測|裸 PG" SupabaseOrderAdapter.ts` ⇒ **0 命中** —— 那句話在該檔裡不存在。
 * 而真正相關的 `PROCUREMENT_EMBED_PATH` docstring(`SupabaseOrderAdapter.ts:375-382`)講的**恰恰相反**:
 * 2026-08-03 對 production 唯讀實跑,**兩層深內嵌的 order/limit 確實驗過**。
 * ⇒ 正確口徑是「**本機**測不到」,不是「本專案無法實測」。引用已移除(**指錯位置比不指更糟**);
 *   分兩次查的**理由不變** —— 能不押在本機測不到的語意上就不押。
 */
export async function listCustomerUserIdsByOrderItemIds(
  orderItemIds: readonly string[],
): Promise<Set<string>> {
  const wanted = new Set(orderItemIds);
  if (wanted.size === 0) return new Set();

  const { data, error } = await createSupabaseServiceClient()
    .from('order_items')
    .select('id, order_id')
    .in('id', [...wanted]);
  if (error) throw error;
  const rows = data ?? [];

  // 🔴 **有任何一個品項查不到就整批不算數**(回空集合 ⇒ 呼叫端 fail-closed)。
  //    漏掉這道的話:清單裡混一個不存在的品項時,剩下的仍推出「恰好一位客人」⇒ 箱子照建,
  //    那個假品項要到掛品項才被 FK 擋掉,而**箱子已經留在 DB 裡了**(禁刪、只能作廢)。
  // ⚠️ **已知天花板**(codex R3,nit):PostgREST 單次回傳上限 = `db-max-rows`
  //    (~~原寫 1000~~ ⇒ **2026-08-18 實測 2000**,V 窗量、本檔改動者未自驗)。一次送超過該上限個
  //    品項時這裡會被靜默截斷 ⇒ 本條把它判成「查不到」而擋下建箱。**方向是安全的**
  //    (擋下、不是建錯箱),症狀是合法操作被誤擋。實務上一箱是個位數品項 ⇒ 不預先加分頁,
  //    真的撞到再說。**不要**把這道改成寬鬆比較來「修」它 —— 那會把上面那個洞打開。
  if (rows.length !== wanted.size) return new Set();

  const orderIds = [...new Set(rows.map((r) => r.order_id))];
  const byOrder = await listOrderCustomerUserIds(orderIds);
  // 🔴 同理:有訂單查不到客人就整批不算數,不拿剩下那位「湊」一個出來。
  if (byOrder.size !== orderIds.length) return new Set();
  return new Set(byOrder.values());
}

/**
 * 給一組**包裹** id,查出它們各自裝了什麼(#351④ 空箱區用)。
 *
 * 🔴 **方向與下面那支相反,不可互相取代**:下面是 `by orderItemIds`(從品項找箱),
 * 這支是 `by shipmentIds`(從箱找品項)。#351④ 要回答的是「**這箱有沒有東西**」,
 * 而「從品項找箱」在定義上**找不到空箱** —— 空箱沒有任何品項可以當查詢起點。
 * 那正是 Sean 2026-08-09 逐字「我也找不到那個箱子在哪裡」的機制成因:
 * 出貨卡整張都是從品項反查箱畫出來的,空箱在那條路徑上不可能出現。
 *
 * ⚠️ 這支只回答「有哪些品項」,**不判斷「是不是空箱」** —— 那是呼叫端的事:
 * 「空」是相對於一組箱子的集合差,單一查詢表達不了。
 *
 * 🔴 **截斷邊界由我們的常數擁有,不是伺服器的**(A9a-1 R1 已判過一次同型 must-fix,
 * STATUS.md 逐字「常數 1000 是遠端設定的複本、程式釘不住它(max-rows 調低就靜默失效)」)。
 * 這裡顯式送 `.limit(N+1)`、N **嚴格低於**已對 production 實測過的上限
 * (~~1000~~ ⇒ **2000**,2026-08-18 V 窗量;**兩個值之下 N 都嚴格更小 ⇒ 結論不變**)
 * ⇒ 回傳 `> N` 就是「這批可能不完整」,而那個判定與專案設定脫鉤。
 * 不自夾的話,max-rows 被調到低於 N 時呼叫端的 `>= N` 恆假 ⇒ **守門靜默變 no-op、零測試轉紅**。
 * (取 N+1 判截斷的寫法 = backlog #325 的 canonical 形狀。)
 */
export const SHIPMENT_ITEM_ROWS_LIMIT = 500;

export async function listShipmentItemsByShipmentIds(
  shipmentIds: readonly string[],
): Promise<ShipmentItemRow[]> {
  // 🔴 同下面那支:空輸入短路,不賭 `in.()` 的行為。
  if (shipmentIds.length === 0) return [];
  const { data, error } = await createSupabaseServiceClient()
    .from('shipment_items')
    .select('id, shipment_id, order_item_id, shipped_quantity')
    .in('shipment_id', [...shipmentIds])
    // 🔴 N+1:回傳剛好 N 是「正好這麼多」,回傳 N+1 才代表**可能還有更多**。
    .limit(SHIPMENT_ITEM_ROWS_LIMIT + 1);
  if (error) throw error;
  return (data ?? []).map((r) => ({
    id: r.id,
    shipmentId: r.shipment_id,
    orderItemId: r.order_item_id,
    shippedQuantity: r.shipped_quantity,
  }));
}

/**
 * 給一組訂單品項 id,查出它們分別裝在哪些箱(訂單詳情頁的出貨卡 + **出貨單那張紙**用)。
 *
 * ⚠️ 回傳的箱子**可能還裝著別單的品項** —— 箱子掛客人不掛訂單。
 * 呼叫端要自己決定只列本單的品項(C-3 線框上那句話講的就是這件事)。
 *
 * 🔴🔴 **截斷訊號(2026-08-16 補;codex 金額片關卡1 抓的)**:
 *    這支原本**沒有 `limit`、沒有截斷訊號、呼叫端也沒檢查**,而**上面那支
 *    `listShipmentItemsByShipmentIds` 早就有**(同一支檔、同一個形狀)⇒ 兩支並排看差別一眼。
 *    ⚠️ **後果不對稱**:PostgREST 截斷時回的是**非空但不完整**的一包
 *    ⇒ 出貨單上**少列品項**、而金額片接上去之後**本次小計也會偏低**,
 *    **而且紙看起來完全正常。**
 *    🔴 **少報比多報壞**:多報客人會打電話來問,**少報沒有人會發現。**
 *    ⇒ 沿用本檔既有的 N+1 形狀與同一個常數,**不自創第二套**。
 *
 * 🔴🔴 **而本檔查 `shipment_items` 的是【三支】,不是兩支**(code-reviewer R1 MF2 更正 —— 我原本寫兩支):
 *    數法:`grep -c "\.from('shipment_items')" 本檔` ⇒ **3**(前面那個 `.` 少不得 —— 不加會撈到這行註解自己)。
 *    ```
 *    listShipmentItemsByShipmentIds    ✅ 早就有 limit（SHIPMENT_ITEM_ROWS_LIMIT = 500）
 *    listShipmentItemsByOrderItemIds   ✅ 2026-08-16 補上（就是這一支，同上常數）
 *    listAssignedQuantitiesByOrderItemIds  ✅ 2026-08-17 —— 🔴 但它走的是【另一條路】：
 *                                             chunk `.in()` ＋ keyset 翻頁【撈到盡】，不是自夾上限
 *    ```
 *    🔴🔴 **第三支刻意不用前兩支的形狀,而理由值得讀完**(2026-08-17 codex 兩輪打回):
 *    - 「自夾 N、超過 fail-closed」要同時猜**伺服器 max-rows** 與**合法最大用量**,
 *      而那兩個都沒量過 ⇒ 猜低了常態性失敗、猜高了守門靜默 no-op。它的基數比前兩支大一個量級,
 *      所以前兩支容得下的猜測,在它身上兩邊都會踩到。
 *    - 而它翻的是**會被寫的表**(本檔上面五支 writer 就在寫 `shipment_items`)
 *      ⇒ 連 `.range()` 都不安全,要 keyset。詳見它自己的 docstring。
 *    ⚠️ **所以前兩支的 `500` 不是「比較保守的同一個東西」,是另一個做法** ——
 *       想「統一一下」的人,先讀第三支的 docstring 再決定要統一到哪一邊。
 *       (前兩支的基數小、集合也相對穩,自夾在它們身上仍然成立;**沒有要順手改它們**。)
 */
export async function listShipmentItemsByOrderItemIds(
  orderItemIds: readonly string[],
): Promise<ShipmentItemRow[]> {
  // 🔴 空陣列直接短路:`.in('col', [])` 在 PostgREST 會產生 `in.()`,行為不保證 ——
  //    與其賭它回空,不如根本不發這個請求(而且空輸入本來就沒有答案要查)。
  if (orderItemIds.length === 0) return [];
  const { data, error } = await createSupabaseServiceClient()
    .from('shipment_items')
    .select('id, shipment_id, order_item_id, shipped_quantity')
    .in('order_item_id', [...orderItemIds])
    // 🔴 N+1:回傳剛好 N 是「正好這麼多」,回傳 N+1 才代表**可能還有更多**。
    //    常數與上面那支共用 —— 兩支查的是同一張表,分開兩個數字只會讓人以為它們有差別。
    .limit(SHIPMENT_ITEM_ROWS_LIMIT + 1);
  if (error) throw error;
  return (data ?? []).map((r) => ({
    id: r.id,
    shipmentId: r.shipment_id,
    orderItemId: r.order_item_id,
    shippedQuantity: r.shipped_quantity,
  }));
}
