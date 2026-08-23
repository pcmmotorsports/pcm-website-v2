import { describe, expect, it } from 'vitest';
import {
  LINE_SYNTHETIC_EMAIL_DOMAIN,
  SYNTHETIC_EMAIL_BASE_DOMAIN,
  isSyntheticEmailDomain,
} from './notification-email';

// notification-email.test.ts — `#858` 片0-a:合成信箱判斷式**本身**的測試落點。
//
// ⚠️ **原本這裡寫「唯一測試落點」—— 落筆即為假**(codex nit):同一個函式至少還有兩處直接呼叫
//    (`synthetic-domain-sql-contract.test.ts` / `apps/admin/.../manual-customer.test.ts`)。
//    📌 判別句掛在**量詞**上,不掛在總結句上:**打出「唯一 / 全部 / 零」就當場停下來數。**
//    本檔的正確定位是:**規則的行為**在這裡測;別處是**接線**在測。
//
// 🔴 **為什麼測試在這裡而不在 outbox adapter**:片0-a 之前這條規則有兩份實作
//    (`@pcm/schemas` 認子網域 / `SupabaseEmailOutboxAdapter` 只認完全相等),而它們**已經分岔**。
//    片0-a 把 adapter 那份刪掉、改由 composition 注入本函式 ⇒ **規則只剩一份,測試就只該有一處。**
//    adapter 那邊留下的是「有沒有真的去問它」的接線測試,不是規則測試。
//
// 🔴 **修閘【前】的實測留檔**:`~/pcm-mailbox/線C-858-片0a-修閘前量測-20260823.md`
//    (第 3、4 列當時是放行 —— 那份證據修完就再也造不出來)。

describe('isSyntheticEmailDomain(合成信箱判準;三處共用的唯一一份)', () => {
  it('🔴 fail-closed 正對照:既有 LINE 合成信箱仍然被擋(片0-a 沒把既有防護弄鬆)', () => {
    expect(isSyntheticEmailDomain('line_u1@line.pcmmotorsports.local')).toBe(true);
    expect(isSyntheticEmailDomain('  Line_U1@LINE.PCMMotorsports.LOCAL  ')).toBe(true);
    expect(isSyntheticEmailDomain('line_u1@line.pcmmotorsports.local.')).toBe(true);
  });

  it('🔴 片0-a 補上的那個洞:第二種用途的合成信箱也被擋', () => {
    // 片0-a 之前:schemas 與 outbox **兩把都放行** ⇒ 假信箱會被送去 Resend。
    expect(isSyntheticEmailDomain('manual_0912345678@manual.pcmmotorsports.local')).toBe(true);
    // 片0-a 之前:schemas 擋、outbox 放 ⇒ 兩把閘互相矛盾。
    expect(isSyntheticEmailDomain('manual_1@manual.line.pcmmotorsports.local')).toBe(true);
    // 基底本身也算(沒有子網域的情況)。
    expect(isSyntheticEmailDomain('someone@pcmmotorsports.local')).toBe(true);
  });

  it('🔴 負對照:真客人的信箱一律放行(片0-a 不得誤傷)', () => {
    expect(isSyntheticEmailDomain('customer@example.com')).toBe(false);
    // 🔴 正式對外網域是 .com,與保留的 .local **不是同一個東西**,絕不可被擋。
    expect(isSyntheticEmailDomain('sean@pcmmotorsports.com')).toBe(false);
  });

  it('🔴 比對必須帶 `.` 前綴:尾碼相似的網域不算我們的(防 endsWith 誤判族)', () => {
    // 'evil-pcmmotorsports.local' 以基底結尾,但它不是我們的子網域 ⇒ 必須放行。
    expect(isSyntheticEmailDomain('a@evil-pcmmotorsports.local')).toBe(false);
    expect(isSyntheticEmailDomain('a@pcmmotorsports.local.attacker.com')).toBe(false);
    expect(isSyntheticEmailDomain('not-an-email')).toBe(false);
  });

  it('🔴 LINE 那個網域是【由基底 derive 的】,不是另外抄的字面', () => {
    expect(LINE_SYNTHETIC_EMAIL_DOMAIN).toBe(`line.${SYNTHETIC_EMAIL_BASE_DOMAIN}`);
    // ⇒ 改基底時 LINE 那份會跟著動;它們不可能再分岔。
    expect(isSyntheticEmailDomain(`x@${LINE_SYNTHETIC_EMAIL_DOMAIN}`)).toBe(true);
  });
});
