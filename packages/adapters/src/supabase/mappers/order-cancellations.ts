import type {
  AdminOrderCancellation,
  AdminOrderCancellationItem,
  AdminOrderCancellationReasonCode,
} from '@pcm/domain';
import type { Database } from '../database.types';
import { compareByCreatedAtThenId } from './created-at-order';

/**
 * @module @pcm/adapters/supabase/mappers/order-cancellations — `order_cancellations`
 *   (含兩層內嵌 `order_cancellation_items`)→ domain 取消歷程(M-4b E10 A9g-3)。
 *
 * 🔴 **投影取顯示與對帳需要的欄**:`payload_hash`
 * (`supabase/migrations/20260730130000_m4b_e10_a7_order_cancellations.sql:93`)不取 ——
 * 那顆對員工不可讀、對不了帳,取了只是白給的面;`order_id` 也不取(父列就是該單)。
 * 🔴 **`idempotency_key`(`:86`)A9d2-2b 起取**:片 3 當時與 `payload_hash` 同列為「內部機制」
 * 刻意不取,依 `A-203-STOP` ③ 主視窗裁示 A 改判 —— 員工開表單時手上就握著這顆 token,
 * 它是災難當天唯一能把「我送出的那次」與歷程列對上的鍵
 * (完整理由見 `AdminOrderCancellation.idempotencyKey`;對客投影仍**永遠**不得有它)。
 *
 * 🔴 **排序自己做**:PostgREST **不保證**內嵌列順序 ⇒ 這裡釘死 `createdAt` ASC + 全序 tie-break,
 * 實作沿用 `created-at-order.ts` 的 `compareByCreatedAtThenId`(與 notes / 採購時間軸同一支)。
 * 請求端則反過來要 **DESC**:配上限時要留下的是**最新的 N 筆**,不是最舊的 N 筆
 * (理由逐字同 `order-notes.ts`;顯示序與請求序刻意不同,不是筆誤)。
 */

/**
 * 內嵌取消列的請求上限。
 *
 * 🔴 100 的理由:一張單的取消次數 = 部分取消的分次數,實務上個位數;100 遠高於任何合理值,
 * 又低於伺服器 `max-rows`(~~2026-08-02 production 實測 1000~~ ⇒ **2026-08-18 實測 2000**,
 * V 窗量:`products?select=id&limit=5000` ⇒ `content-range 0-1999/19777`;**本檔改動者未自驗**。
 * 舊量測方法見 `order-notes.ts` 檔頭)。**兩個值之下本常數都嚴格更小 ⇒ 結論不變。**
 * ⚠️ **殘餘風險與全 repo 每個 embed limit 相同、非本片引入**(`order-notes.ts` 檔頭已逐字記錄):
 * 若日後把 `max-rows` 設到低於本值,截斷會發生在那個更低的數字上而本判定看不見。
 * 已立 backlog **#325**(max-rows 漂移偵測;commit `1a145ac`、`docs/phase-1-backlog.md`)。
 */
export const ORDER_CANCELLATIONS_EMBED_LIMIT = 100;

/**
 * 每次取消的品項內嵌上限。
 * 🔴 200 = 與 `ORDER_ITEMS_EMBED_LIMIT` 取同值:一次取消的品項數不會超過該單的品項數
 * (`UNIQUE (cancellation_id, order_item_id)`,建表檔 `:243-244`,同一次不得重複列同一品項)
 * ⇒ 兩個常數取同值,「品項讀得到但它的取消列讀不到」這種不對稱就不會發生。
 * ⚠️ **這不代表 200 一定夠**(R3 nit 3 更正原本的推論):`ORDER_ITEMS_EMBED_LIMIT` 自己也是
 * 請求上限、不是訂單品項數的上界 —— 品項數本身無上限,300 品項的單兩邊會各自截斷。
 */
export const ORDER_CANCELLATION_ITEMS_EMBED_LIMIT = 200;

export type SupabaseOrderCancellationItemRow = Pick<
  Database['public']['Tables']['order_cancellation_items']['Row'],
  'id' | 'order_item_id' | 'cancelled_quantity'
>;

export type SupabaseOrderCancellationRow = Pick<
  Database['public']['Tables']['order_cancellations']['Row'],
  'id' | 'reason_code' | 'reason_detail' | 'actor' | 'idempotency_key' | 'created_at'
> & {
  /**
   * 🔴 optional + nullable 理由同 `SupabaseAdminOrderDetailRow.order_notes`:
   * 投影退版會讓這個鍵**整個不存在**,而型別若宣告成必填就會對 mapper 說謊
   * (實際餵得進 undefined、且有守門測試在測)。
   */
  order_cancellation_items?: SupabaseOrderCancellationItemRow[] | null;
};

export type AdminOrderCancellationsProjection = {
  /** `null` = 沒讀到;`[]` = 真的沒被取消過(詳 `AdminOrderDetail.cancellations`)。 */
  cancellations: AdminOrderCancellation[] | null;
  /** 只表示觸及 `ORDER_CANCELLATIONS_EMBED_LIMIT`。 */
  cancellationsTruncated: boolean;
};

function mapItems(rows?: SupabaseOrderCancellationItemRow[] | null): {
  items: AdminOrderCancellationItem[] | null;
  itemsTruncated: boolean;
} {
  // 🔴 缺鍵 / null / **空陣列**都是「沒讀到」,不是「這次取消沒動到任何品項」。
  //    後者在 DB 端**根本不可能**,兩條寫入路徑都證得了:
  //    ①整單取消 A8a1 逐品項寫入後有筆數守 `v_bad <> v_cnt → RAISE`
  //      (`20260804180000_m4b_e10_a8a1_admin_cancel_order.sql:231-240`);
  //    ②部分取消 A8a2 零品項 header 被健康閘擋掉(`20260805100000` 步5、「全零增量拒」)。
  //    ⇒ 觀察到 `[]` 必然是沒讀到或資料腐壞 ⇒ fail-closed。
  // 🔴 `[]` 這一格是 R1 code-reviewer 抓到的:`[]` 是 truthy,原本會走到下面得 `false`
  //    = 「完整地取消了 0 件」—— 正是本檔要防的那個形狀,而且它與「真的有品項但沒讀到」同形。
  // 🔴 R3 M2:改回 `null`(不是 `[]` + truncated)—— 空清單與「讀不到」在畫面上長得一樣,
  //    型別給 null 才逼得動消費端先處理。`itemsTruncated` 從此只表示「觸及上限」。
  if (!rows || rows.length === 0) return { items: null, itemsTruncated: false };
  return {
    items: rows
      .map((row) => ({
        id: row.id,
        orderItemId: row.order_item_id,
        cancelledQuantity: row.cancelled_quantity,
      }))
      // id 升冪 = 穩定顯示序(本表無 created_at 以外的業務序,且同次取消的列時間幾乎相同)。
      // ⚠️ 這層與查詢鏈的 `.order('id', ascending: true)` 方向相同 = **刻意的雙保險**
      //    (R3 nit 2):PostgREST 不保證內嵌列順序,而請求端那道若被誰改掉,這裡仍守得住顯示序。
      //    外層那層不同 —— 外層請求 DESC(取最新 N 筆)、顯示 ASC,mapper 那道是**必要**不是冗餘。
      .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)),
    itemsTruncated: rows.length >= ORDER_CANCELLATION_ITEMS_EMBED_LIMIT,
  };
}

/**
 * 取消歷程內嵌 → domain 投影。
 *
 * 🔴🔴 **「沒讀到」必須翻成 `cancellationsTruncated=true`,不能翻成「這張單沒被取消過」**。
 * 缺鍵(投影退版)與 null 都代表「不知道」,而空陣列與「真的沒取消過」在畫面上長得一模一樣。
 *
 * 🔴 **授權面的精確說法**(R1 nit 6 更正原本說太滿的字面):兩張表是
 * `REVOKE ALL FROM PUBLIC, anon, authenticated, service_role` 後只 `GRANT SELECT TO service_role`
 * (`20260730130000:202-203`、`:267-268`)⇒ **沒有 grant 的角色讀會 42501 直接 throw**,不是靜默回空。
 * 靜默回空的前提是「**被授了 SELECT 但不 BYPASSRLS**」(RLS enable 零 policy `:200`、`:265`)——
 * 那條路由 `scripts/a9g2-charge-attempts-grant-guard.test.ts` 守(A9g-3 起已含這兩張表)。
 */
export function mapSupabaseOrderCancellationRowsToProjection(
  rows?: SupabaseOrderCancellationRow[] | null,
): AdminOrderCancellationsProjection {
  // 🔴 R3 M2:缺鍵 / null → `cancellations: null`(= 沒讀到),**不是** `[]` + truncated。
  //    `[]` 是「真的沒被取消過」這個事實,兩者必須分得出來(詳 `AdminOrderDetail.cancellations`)。
  if (!rows) return { cancellations: null, cancellationsTruncated: false };
  return {
    // 🔴 **先排原始列、再映射**(慣例逐字同 `order-notes.ts:74`):`compareByCreatedAtThenId`
    //    吃的是 snake_case 的 `created_at`。拿映射後的物件(`createdAt`)去排,
    //    `Date.parse(undefined)` 全部是 NaN、**不會報錯**,只會靜默退化成純 id 排序 ——
    //    症狀是次毫秒/跨秒排錯,沒有任何型別或測試會自動轉紅。
    cancellations: [...rows]
      .sort(compareByCreatedAtThenId)
      .map((row) => {
        const { items, itemsTruncated } = mapItems(row.order_cancellation_items);
        return {
          id: row.id,
          // 慣例逐字同 `order-notes.ts:80` 的 note_type;權威是建表 CHECK(`20260730130000:131-139`)。
          reasonCode: row.reason_code as AdminOrderCancellationReasonCode,
          reasonDetail: row.reason_detail,
          actor: row.actor,
          idempotencyKey: row.idempotency_key,
          createdAt: row.created_at,
          items,
          itemsTruncated,
        };
      }),
    cancellationsTruncated: rows.length >= ORDER_CANCELLATIONS_EMBED_LIMIT,
  };
}
