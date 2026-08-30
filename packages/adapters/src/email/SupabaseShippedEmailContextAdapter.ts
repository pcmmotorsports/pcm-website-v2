/**
 * @module @pcm/adapters/email/SupabaseShippedEmailContextAdapter — 出貨通知信的**寄送時讀取**(M-4b E4-b)
 *
 * 實作 `IShippedEmailContext`。**這支 port 從 2026-08-18 立好之後就【沒有實作】,本檔是第一份。**
 *
 * 🔴 **為什麼是「寄送時」才讀,而不是入列時存進 payload**(那支 port 的檔頭有全文,這裡留判別句):
 * 追蹤碼與品項都是**可後台改的欄** ⇒ 入列當下凍住的值,員工事後改過就是舊的,
 * 而**信寄出去收不回來**。⇒ 客人拿舊碼去貨運網站查 ⇒ 查無 ⇒ 打電話來。
 *
 * 🔴 **兩種 `null` 不可以合併**(port 檔頭明文,而它是本檔最容易寫錯的地方):
 * ```
 * 整包回 null          = 「讀不到」（我們壞了）⇒ 呼叫端 fail-closed、不寄、計 error
 * trackingNumber: null = 「這一批沒有碼」（自取/自送,合法）⇒ 照寄,信裡寫無追蹤碼
 * ```
 * 合併之後,「系統壞了」與「這批本來就沒碼」在呼叫端變成同一件事,
 * 而其中一條會寄出**一封說「本批為自取」的假話**。
 *
 * 🔴 **`linesTruncated` 是承重的,不是選配**:讀取一定有上限,而**少列幾項的信與正常的信長得一模一樣**
 * —— 客人照著清單對,少的那一項他不會知道要問。⇒ 為 `true` 時呼叫端**必須不寄**。
 */
import { carrierLabelOf } from '@pcm/domain';
import type { IShippedEmailContext, LoadShippedContextResult, ShippedEmailLine } from '@pcm/ports';
import type { SupabaseClient } from '@supabase/supabase-js';

import type { Database } from '../supabase/database.types';

/** 生成型別把關表名/欄名/回傳形狀(鏡像 `EmailOutboxClient`)。 */
export type ShippedEmailContextClient = SupabaseClient<Database>;

/**
 * 一封信最多印幾項。
 *
 * 🔴 **這個值不是「夠用就好」,它是 fail-closed 的門檻**:超過就整封不寄(見 `linesTruncated`)。
 * ⚠️ 而它**遠小於** `db-max-rows`(2026-08-18 實測 2000)⇒ 截斷一定是本常數造成的,
 *    不會是伺服器**靜默**截掉的 —— 兩者的差別是:後者我們偵測不到。
 * 📎 同族分析 backlog `#629`(code 依賴一個住在伺服器設定裡的數字)。
 */
export const SHIPPED_EMAIL_MAX_LINES = 50;

/**
 * 掃「這張訂單還有沒有沒出的東西」時最多讀幾列 `order_items`。
 *
 * 🔴 它與 `SHIPPED_EMAIL_MAX_LINES` **不是同一件事**:那個限的是【這一箱印幾列】,
 * 這個限的是【整張訂單掃幾列】—— 一張單的品項數 ≥ 一箱的品項數, 所以這個要寬。
 * ⚠️ 超過上限時本 adapter **判「還有沒出的」**(見呼叫處註解), 不是 fail-closed ——
 * 那是刻意選的那一邊, 理由寫在那裡。
 */
export const ORDER_ITEMS_SCAN_MAX = 200;

/**
 * 🔴 **本檔【假設】PostgREST 的 `db-max-rows` 至少有這麼大**(codex 2026-08-22 R1 ⑤)。
 *
 * `linesTruncated` 靠「拿得到第 `MAX+1` 列」判定。若伺服器的 `db-max-rows` 掉到 ≤ `MAX`,
 * 伺服器會**先**把結果截到它自己的上限,而我們看到的是「剛好沒有第 51 列」
 * ⇒ **`linesTruncated` 算成 `false`,而信真的少列了品項** —— 少列的信與正常的信長得一模一樣。
 *
 * ⇒ 所以不能只寫註解說「2000 夠大」(那是環境現況,不是程式保證)。
 *   本常數把那個假設**寫成程式裡的一個數字**,並在下方 `assertProbeHeadroom()` 當場檢查關係。
 * 📎 `docs/patterns/pagination-loop-review.md` 第一條:**頁大小嚴格小於 `db-max-rows`**。
 *
 * ⚠️ **而這個值仍然是【申告】,不是量到的** —— 程式沒有辦法問伺服器它的 `db-max-rows` 是多少。
 *   ⇒ 真正的保證只有一個:**上限遠小於它**,而「遠」在這裡 = 40 倍。
 *   ⇒ 有人把伺服器設定調小到 51 以下時,**這裡不會紅** —— 那一格沒有量具,照實寫。
 */
export const ASSUMED_DB_MAX_ROWS = 2000;

/**
 * 探針要有餘裕:`MAX + 1` 必須**嚴格小於**我們假設的 `db-max-rows`。
 * 🔴 在 module 載入時就跑 —— 有人把 `SHIPPED_EMAIL_MAX_LINES` 調到接近上限時,
 *    **import 這支檔就會 throw**,而不是等到某一封信真的少列了才發現。
 */
function assertProbeHeadroom(): void {
  if (SHIPPED_EMAIL_MAX_LINES + 1 >= ASSUMED_DB_MAX_ROWS) {
    throw new Error(
      `出貨信品項上限(${SHIPPED_EMAIL_MAX_LINES})+1 必須嚴格小於假設的 db-max-rows(${ASSUMED_DB_MAX_ROWS})` +
        ' —— 否則截斷偵測會靜默失效(信少列了品項,而 linesTruncated 是 false)',
    );
  }
}
assertProbeHeadroom();

/** 只帶固定 code、不帶任何 DB 訊息(DB 錯誤訊息裡可能裝著出事那一行的內容)。 */
export class ShippedContextQueryError extends Error {
  constructor(readonly code: string) {
    super(`出貨脈絡讀取失敗(code=${code})`);
    this.name = 'ShippedContextQueryError';
  }
}

/** `order_items.product_snapshot` 的 title(白名單三欄之一;缺 → null,與 `AdminOrderDetailItem` 同慣例)。 */
function snapshotTitle(raw: unknown): string | null {
  if (raw === null || typeof raw !== 'object') return null;
  const t = (raw as Record<string, unknown>).title;
  return typeof t === 'string' && t.trim() !== '' ? t : null;
}

export class SupabaseShippedEmailContextAdapter implements IShippedEmailContext {
  constructor(private readonly client: ShippedEmailContextClient) {}

  async loadShippedContext(input: {
    orderId: string;
    shipmentId: string;
  }): Promise<LoadShippedContextResult> {
    // ── ① 箱本身 ───────────────────────────────────────────────────────────
    // 🔴 順便把「已作廢」擋在這裡:箱作廢了就不該再寄它的通知信。
    //    ⚠️ 作廢欄是 `deleted_at`,**不是 `voided_at`**(TS 側 `ShipmentRow.voidedAt` 是改過名的,
    //    `apps/admin/src/lib/shipping/shipment-repository.ts:285`)。照 TS 的名字寫會拿到 42703。
    const shipment = await this.query('shipment', () =>
      this.client
        .from('shipments')
        .select('shipment_reference, carrier_code, carrier_note, tracking_number, shipped_at, deleted_at')
        .eq('id', input.shipmentId)
        // 🔴🔴 **這裡刻意【不】用 `.is('deleted_at', null)` 過濾**(2026-08-22 Fable R2 F2)。
        //    過濾掉的話,「這箱被作廢了」與「這箱根本不存在」會回**同一個空結果**
        //    ⇒ 而作廢是**正常業務動作**(裝箱打錯的唯一補救就是整箱作廢重開),
        //      把它當成異常會讓一個正常動作**每天發告警**。
        //    ⇒ 撈回來自己判,才回得出 `voided` 這個可辨識的態。
        .limit(1),
    );
    const box = shipment?.[0];
    // 🔴 查不到 ⇒ `unavailable`。**不得**退化成一封沒有箱號的通用信
    //    (DB COLUMN COMMENT 明文禁止:「不得寄出『已出貨但無單號』的通用信」)。
    if (box === undefined) return { kind: 'unavailable' };
    // 🔴 作廢 ⇒ 可辨識的態,呼叫端據此落「跳過」痕跡而不是計 error。
    if (box.deleted_at !== null) return { kind: 'voided' };
    // 還沒標出貨 ⇒ 我們對「這封信該寄」的判斷與資料對不上 ⇒ 這一態**應該**吵。
    if (box.shipped_at === null) return { kind: 'unavailable' };

    // ── ② 這一箱裡【屬於這張訂單】的品項 ────────────────────────────────────
    // 🔴 `order_items!inner` 的 `!inner` 是承重的,不是風格:少了它,`order_id` 那個篩選
    //    會變成「篩子表但父列照回」⇒ 撈到**別張訂單的品項**印進這封信。
    //    (同款陷阱的完整記述在 `SupabasePaidOrderScannerAdapter` 檔頭。)
    // 多要一列當探針:拿到 MAX+1 就代表沒載完。
    const items = await this.query('items', () =>
      this.client
        .from('shipment_items')
        // 🔴 `orders!inner(display_id)` 也在這裡撈:`ShippedEmailContext.orderDisplayId` 是必填,
        //    而**回一個空字串等於寫一封「訂單 」開頭的信** —— 那個值看起來合法、長度也對,
        //    是本 repo 反覆記載的那種「接通了而送空值」的形狀。⇒ 撈不到就整包 null。
        .select('shipped_quantity, order_items!inner(order_id, product_snapshot, orders!inner(display_id))')
        .eq('shipment_id', input.shipmentId)
        .eq('order_items.order_id', input.orderId)
        // 🔴 排序帶唯一鍵:少了它,兩封重送的信品項順序可能不同 ⇒ 客人對不起來。
        .order('id', { ascending: true })
        .limit(SHIPPED_EMAIL_MAX_LINES + 1),
    );
    if (items === null) return { kind: 'unavailable' };

    // 🔴 **0 項也回 null**,不回一封空清單的信:
    //    這張訂單在這一箱裡沒有任何品項 = 我們對「哪一封信該寄」的判斷與資料對不上,
    //    而一封「你的貨出了,內容:(空白)」比不寄更糟。
    if (items.length === 0) return { kind: 'unavailable' };

    // 🔴 display_id 從 embed 拿,拿不到就整包 null(不得用空字串頂替)。
    const displayId = firstDisplayId(items);
    if (displayId === null) return { kind: 'unavailable' };

    const linesTruncated = items.length > SHIPPED_EMAIL_MAX_LINES;
    const lines: ShippedEmailLine[] = items.slice(0, SHIPPED_EMAIL_MAX_LINES).map((row) => ({
      title: snapshotTitle((row.order_items as { product_snapshot?: unknown } | null)?.product_snapshot),
      quantity: row.shipped_quantity,
    }));

    // ── ③ 這張訂單【還有沒有沒出的東西】 ──────────────────────────────────
    // 🔴 它答的是拍板 C 第二段的【條件】(「其餘商品出貨時會另外通知您」該不該印)。
    //    判準逐字對齊 DB 那一側 `20260816050000_m4b_522_*.sql:88-90`:
    //      全出完 ⟺ bool_and( COALESCE(shipped,0) >= GREATEST(quantity - COALESCE(cancelled,0), 0) )
    //    ⚠️ PostgREST 比不了兩個欄位 ⇒ 撈回來在 TS 算,而**公式要與 SQL 逐字同形**。
    //    🔴 `cancelled_quantity` 不是裝飾:少了它,「訂 3 取消 1 出 2」會被判成還有東西沒出
    //       ⇒ 客人等一封永遠不會來的信。
    const summary = await this.query('order_summary', () =>
      this.client
        .from('order_items')
        .select('quantity, order_item_quantity_summary(shipped_quantity, cancelled_quantity)')
        .eq('order_id', input.orderId)
        // 多要一列當探針:拿到 MAX+1 就代表沒載完(與品項那段同一個手法)。
        .order('id', { ascending: true })
        .limit(ORDER_ITEMS_SCAN_MAX + 1),
    );
    if (summary === null) return { kind: 'unavailable' };
    // 🔴 一張訂單撈不到任何品項 ⇒ 我們對這封信的判斷與資料對不上 ⇒ 應該吵,不猜。
    if (summary.length === 0) return { kind: 'unavailable' };
    const orderHasUnshippedItems = summary.length > ORDER_ITEMS_SCAN_MAX
      ? // 🔴 沒載完時【印那一句】,不是不印 —— 這是刻意選的那一邊:
        //    品項多到超過上限的單,分批出貨近乎必然;而兩種錯的代價不對稱
        //    (沒印 ⇒ 客人收到第二封以為重複寄,那正是 Sean 選 C 要防的)。
        true
      : summary.some((row) => {
          const s = row.order_item_quantity_summary as
            | { shipped_quantity?: number; cancelled_quantity?: number }
            | null;
          const shipped = s?.shipped_quantity ?? 0;
          const cancelled = s?.cancelled_quantity ?? 0;
          return shipped < Math.max(row.quantity - cancelled, 0);
        });

    return {
      kind: 'ok',
      context: {
        orderDisplayId: displayId,
        shipmentReference: box.shipment_reference,
        // 🔴 `carrierLabelOf` 查不到就回**代碼本身**,絕不回空字串 —— 回空白的話
        //    信上「貨運商:」後面什麼都沒有,而客人以為沒有貨運商、不會來問(少報)。
        //    ⚠️ `other` 有 `carrier_note`(自取/自送的自由文字)⇒ 有 note 時以 note 為準。
        carrierName: pickCarrierName(box.carrier_code, box.carrier_note),
        trackingNumber: emptyToNull(box.tracking_number),
        lines,
        linesTruncated,
        orderHasUnshippedItems,
      },
    };
  }

  /** 兩條失敗路徑(error 欄 / 直接 reject)收成一條,且**不接住原始錯誤物件**。 */
  private async query<T>(
    stage: string,
    run: () => PromiseLike<{
      data: T[] | null;
      error: { code?: string } | null;
    }>,
  ): Promise<T[] | null> {
    let outcome: { data: T[] | null; error: { code?: string } | null };
    try {
      outcome = await run();
    } catch {
      throw new ShippedContextQueryError(`${stage}:rejected`);
    }
    if (outcome.error) {
      throw new ShippedContextQueryError(`${stage}:${outcome.error.code || 'unknown'}`);
    }
    return outcome.data;
  }
}

/**
 * 貨運商顯示名。
 *
 * 🔴🔴 **`null` 那條路在正式庫【走不到】—— 2026-08-22 codex R1 指出,我開 migration 核過**:
 * ```
 * 20260805170000_m4b_e10_b2_s1a1_shipments.sql:112 逐字（雙向 CHECK）：
 *   CHECK ((carrier_code = 'other') = (NOT public.pcm_b2_is_blank(carrier_note)))
 * ⇒ carrier_code='other'  ⇒ carrier_note **必須非空**
 * ⇒ carrier_code≠'other'  ⇒ carrier_note **必須是空的**
 * ```
 * ⇒ 「自取 / 自送」在這個 schema 裡是 **`other` + note 寫「自取」/「自送」**,
 *   **不是**「`other` + 沒有 note」。⇒ **本函式在正式資料上永遠回得出字。**
 *
 * ⚠️ **那為什麼還留 `| null`**:CHECK 擋的是**未來寫入**,而
 * ① 既有列不會因函式改版被自動重驗(`pcm_b2_is_blank` 的 COMMENT 逐字寫著這件事);
 * ② 有人繞過 migration 直接改線上 CHECK 時,這條路會活過來。
 * ⇒ 這是**縱深**,不是「常態路徑」。呼叫端仍須能處理 `null`(port 型別就是 `string | null`)。
 * 🔴 而我原本的測試把「`other` + 沒有 note」寫成**合法正例** —— 那是一份 DB 生不出來的假資料。
 */
function pickCarrierName(code: string, note: string | null): string | null {
  const trimmedNote = note === null ? '' : note.trim();
  if (code === 'other') return trimmedNote === '' ? null : trimmedNote;
  return carrierLabelOf(code);
}

/** 從 embed 撈訂單顯示編號;形狀不符或空字串一律 `null`(呼叫端據此 fail-closed)。 */
function firstDisplayId(rows: readonly { order_items?: unknown }[]): string | null {
  const oi = rows[0]?.order_items as { orders?: { display_id?: unknown } | null } | null | undefined;
  const v = oi?.orders?.display_id;
  return typeof v === 'string' && v.trim() !== '' ? v : null;
}

function emptyToNull(v: string | null): string | null {
  return v === null || v.trim() === '' ? null : v;
}
