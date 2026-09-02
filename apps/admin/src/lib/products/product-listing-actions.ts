'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { authorizeAdminMutation } from '../session/authorize';
import { getRequestId } from '../audit/context';
import { setProductListing } from './product-repository';
import { findVariantSkuCollisionOrUnavailable } from './variant-sku-collision';
import {
  parseListingToggleForm,
  LISTING_NOOP_NOTE_DROPPED_RESULT_CODE,
} from './product-listing-form';

// M-4b `#20` 後台上下架 server action。plan = `docs/specs/2026-08-19-product-listing-toggle-plan.md`。
// 鏡像 `lib/customers/tier-actions.ts` 的全套紀律(它是同族樣板)。
//
// 🔴 安全縱深(三層,與 tier 同):
//   ① `authorizeAdminMutation()` —— session 自驗 / Origin fail-closed / 具名 actor;
//   ② 形狀層 `parseListingToggleForm`(UUID / delisted 嚴格字面 / note 長度;語意權威在 RPC);
//   ③ 寫入走 `admin_set_product_listing` owner RPC —— 兩欄同一個 UPDATE、稽核同交易、
//      EXECUTE 僅 `service_role`。**稽核在 RPC,本檔不另接。**
//
// 🔴🔴 **NO_CHANGE 時,員工打的備註【會被丟掉】—— 而畫面必須說出來**(GR R1 must-fix-lite,
//    2026-08-19 在拋棄式 PG 上量到:同狀態再按一次並帶備註 ⇒ 回 `NO_CHANGE`、
//    `admin_audit_log` 裡提到那句備註的列數 = **0**)。
//    ⇒ 所以結果碼分成 `noop` 與 **`noop_note_dropped`** 兩個 —— 不是同一個。
//    ⚠️ 合併成一個的話,員工會以為他留了紀錄,而世界上沒有。

type ResultCode =
  | 'saved'
  /** 🔵 疑似「別支商品的規格」而員工還沒確認 ⇒ 擋下這一次, 而**不是永久封鎖**(見下方那段)。 */
  | 'variant_sku_collision'
  /** 🔴 那道確認【查不出來】⇒ 暫時擋 + 叫他重試(fail-closed;codex R1 #2)。 */
  | 'variant_sku_check_unavailable'
  | 'noop'
  | typeof LISTING_NOOP_NOTE_DROPPED_RESULT_CODE
  | 'not_found'
  | 'invalid'
  | 'denied'
  | 'error';

/** 結果碼 → `returnTo?r=<code>`(PRG;returnTo 已由 parse 限定站內 `/products` 路徑)。 */
function redirectWith(returnTo: string, code: ResultCode): never {
  const sep = returnTo.includes('?') ? '&' : '?';
  redirect(`${returnTo}${sep}r=${code}`);
}

export async function setProductListingAction(formData: FormData): Promise<void> {
  // ① 授權閘。
  const auth = await authorizeAdminMutation();
  if (!auth) {
    redirectWith('/products', 'denied');
  }

  // ② 表單 → RPC 參數(形狀層)。
  const parsed = parseListingToggleForm(formData);
  if (!parsed.ok) {
    redirectWith('/products', 'invalid');
  }

  const requestId = await getRequestId();

  // attempt log:只留識別欄位與目標狀態。**變更原因不進 log** —— 稽核真相在 `admin_audit_log`
  // (同 tier 線紀律:備註可能含客訴內容/人名)。
  console.info('[admin/products] product.listing.change.attempt', {
    request_id: requestId,
    sid: auth.sid,
    actor: auth.actorId,
    product_id: parsed.productId,
    delisted: parsed.delisted,
  });

  /**
   * 🔴🔴 **第二層:上架前的確認**(板 `⟦b4-NOVARIANT1⟧`;Sean 2026-08-31 拍 `Q2=甲`)。
   *
   * 🛑 **只在【要上架】時檢查** —— `parsed.delisted === true`(要下架)一律放行。
   *    把一支可疑商品**下架**永遠是安全的, 對它多問一句只會擋住正確的動作。
   *
   * 🔵 **這是【確認】不是【封鎖】**:員工在畫面上按了「我確定」⇒ 表單帶 `confirm` ⇒ 這裡放行。
   *    ⇒ 📌 誤上架擋得住, 而**刻意上架不擋**。
   *
   * 🔴 **而為什麼 server 端要再算一次**(頁面那一層已經顯示過了):
   *    第一層是【給人看的】—— 它讓人在按之前就知道;
   *    第二層才是【真的擋的】—— 少了它, 改一個表單欄位就繞過去了。
   *    ⇒ 兩層各自不可省, 而理由不是保險, 是它們擋的東西不同。
   *
   * ⚠️ `findVariantSkuCollision` **查不到或查錯時回 `null`(= 不擋)** ——
   *    那個失敗方向是刻意的, 而代價明寫:**DB 出問題時這道確認會安靜地消失。**
   */
  if (!parsed.delisted) {
    const collision = await findVariantSkuCollisionOrUnavailable(parsed.productId);

    // 🔴🔴 **fail-closed**(codex R1 #2 must-fix):查不出來 ⇒ **擋下**, 不是放行。
    //    ⛔ ~~原本任何錯誤都當「沒撞名」⇒ 繼續上架~~ —— 那讓【真的擋的那一層】在 DB 故障時失效。
    //    🔵 而它與「是確認不是封鎖」不衝突:這是**暫時擋 + 叫他重試**, 不是永久封鎖。
    if (collision === 'unavailable') {
      console.error('[admin/products] product.listing.variant_sku_check_unavailable', {
        request_id: requestId,
        product_id: parsed.productId,
      });
      redirectWith(parsed.returnTo, 'variant_sku_check_unavailable');
    }

    if (collision) {
      // 🔴 兩個條件, 而第二個是 codex R1 #5:
      //    ① 他有沒有【主動勾】那個 checkbox
      //    ② 他勾的那一刻看到的是不是【同一支商品】—— 畫面顯示 A 而資料變成 B ⇒ 不算確認過
      const confirmedThisOne = parsed.confirmed && parsed.confirmOwner === collision.belongsToExternalId;
      if (!confirmedThisOne) {
        console.warn('[admin/products] product.listing.variant_sku_collision', {
          request_id: requestId,
          product_id: parsed.productId,
          external_id: collision.externalId,
          belongs_to: collision.belongsToExternalId,
          // 🔵 分得出「沒勾」與「勾了但看到的是別支」—— 兩者要查的東西不一樣。
          confirmed: parsed.confirmed,
          confirm_owner: parsed.confirmOwner,
        });
        redirectWith(parsed.returnTo, 'variant_sku_collision');
      }
    }
  }

  let code: ResultCode;
  try {
    const result = await setProductListing({
      productId: parsed.productId,
      delisted: parsed.delisted,
      note: parsed.note,
      actor: auth.actorId,
      requestId,
    });
    code =
      result === 'UPDATED'
        ? 'saved'
        : result === 'NOT_FOUND'
          ? 'not_found'
          : // 🔴 NO_CHANGE 分兩種:有沒有打字。有打字而狀態沒變 ⇒ 那段字被丟掉了,畫面要講。
            parsed.note === null
            ? 'noop'
            : LISTING_NOOP_NOTE_DROPPED_RESULT_CODE;
  } catch (err) {
    // DB error / RPC 輸入 RAISE(變更原因非法等)→ 固定碼、不外洩;server log 只留摘要
    // (不印整個 err 物件:訊息可能回顯輸入值)。
    const e = err as { code?: unknown; message?: unknown };
    console.error('[admin/products] 上下架失敗', {
      request_id: requestId,
      code: typeof e.code === 'string' ? e.code : undefined,
      message: String(e.message ?? '').slice(0, 200),
    });
    redirectWith(parsed.returnTo, 'error');
  }

  // 成功路徑 revalidate(列表的上架狀態欄 + 這一筆的明細);redirect 在 catch 外(不被吞)。
  revalidatePath('/products');
  revalidatePath(`/products/${parsed.productId}`);
  redirectWith(parsed.returnTo, code);
}
