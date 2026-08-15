import { afterEach, describe, expect, it, vi } from 'vitest';
import { isAuditUiEnabled } from './audit-ui-flag';

// audit-ui-flag.test.ts — 證明這個開關**預設是關的**。
//
// 🔴 **為什麼這三格值得寫**(主視窗 2026-08-15 裁定,理由是今晚自己得出的結論):
//   > **如果某個檢查從來沒紅過,它的綠沒有資訊量。**
//   這個 flag 是用來擋「Sean 先 push、後 apply ⇒ 正式站壞」的**機制**
//   (事故先例:2026-08-07 A9h,正式站壞約 8 小時,而**審查看不到它** —— 單測 mock 掉 rpc、hook 看不到 deploy)。
//   ⇒ **一個沒有人證明過會關的開關,保護的是我們的心情,不是正式站。**
//
// 🔴 **每格都先驗 stub 真的生效再斷言結果**(house 範本 `lib/orders/payment-list-view.test.ts:96-107`)。
//   不驗前提的話,`vi.stubEnv` 沒改到時下面那句在「env 本來就沒設」的環境下**恆綠** ——
//   那正是「偵測器根本沒吐東西」的假綠。

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('isAuditUiEnabled — 預設關(這是機制,不是配置)', () => {
  it('env 未設 ⇒ false', () => {
    vi.stubEnv('AUDIT_UI_ENABLED', undefined as unknown as string);
    expect(process.env.AUDIT_UI_ENABLED, '前提:stub 後該欄應為 undefined').toBeUndefined();
    expect(isAuditUiEnabled()).toBe(false);
  });

  /**
   * 🔴 `'true'` 那格是這一族裡最重要的:
   * 下一個人**很可能**設 `AUDIT_UI_ENABLED=true` 然後以為開了 —— 而判定式只認 `'1'`。
   * 失敗方向是**安全的**(以為開了其實關著),但**排錯會很久**,所以要有一格明說。
   */
  it.each(['0', 'true', 'TRUE', 'yes', '', ' 1', '1 '])('env=%o ⇒ false(只認逐字 "1")', (value) => {
    vi.stubEnv('AUDIT_UI_ENABLED', value);
    expect(process.env.AUDIT_UI_ENABLED, '前提:stub 應真的寫進 process.env').toBe(value);
    expect(isAuditUiEnabled()).toBe(false);
  });

  // 🔴 正向對照:證明上面那些 false **不是因為這個函式恆回 false**。
  //    少了這一格,把 `isAuditUiEnabled` 改成 `return false` 也會全綠 —— 那就是恆綠格。
  it('🔴 env="1" ⇒ true(正向對照:證明上面那些 false 有判別力)', () => {
    vi.stubEnv('AUDIT_UI_ENABLED', '1');
    expect(process.env.AUDIT_UI_ENABLED, '前提:stub 應為 "1"').toBe('1');
    expect(isAuditUiEnabled()).toBe(true);
  });
});
