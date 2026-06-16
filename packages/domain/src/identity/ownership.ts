/**
 * @module @pcm/domain/identity/ownership — 會員子資源歸屬錯誤
 *
 * 鏡像 order/errors.ts OrderError 慣例:domain 命名 + Error 子類 + readonly 判別欄。
 * 會員 use-case 的 ownership 驗證(地址/愛車 id 不屬於目前 customer)一律 throw NotOwnedError;
 * use-case / delivery / 測試斷言型別(instanceof + resource),不脆弱比對 message 字面(鐵則 10 bug 可追蹤性)。
 *
 * @see packages/domain/src/order/errors.ts:OrderError(同型別慣例)
 * @see packages/domain/src/identity/auth.ts:AuthError
 */

/** 被越權存取的會員子資源型別。 */
export type NotOwnedResource = 'address' | 'vehicle';

/**
 * NotOwnedError:會員子資源歸屬驗證失敗(addressId / vehicleId 不屬於目前 customer)。
 *
 * 單一錯誤語意(歸屬不符),`resource` 為判別欄(domain 命名、被越權的子資源型別);
 * use-case / UI 只看 resource、不解析 message。RLS 仍是 ownership 邊界,本錯誤是 app 層縱深(#199)
 * 與刪除/設預設/設主車路徑統一拋出的型別(取代既有 plain Error、#176)。
 */
export class NotOwnedError extends Error {
  constructor(
    readonly resource: NotOwnedResource,
    message: string,
  ) {
    super(message);
    this.name = 'NotOwnedError';
  }
}
