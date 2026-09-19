import { describe, expect, it } from 'vitest';
import {
  LINE_SYNTHETIC_EMAIL_DOMAIN,
  NOTIFICATION_EMAIL_MAX_OCTETS,
  NotificationEmailInput,
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

// ── 254 octets 上限(2026-09-19 補)────────────────────────────────────────────
//
// 🔴 **為什麼是這裡**:結帳頁那格「通知 Email」2026-09-19 整格拿掉之後,
//    原本守這條上限的 `checkout.test.ts` 那一格跟著退場, 而**沒有替身**。
// 🔬 對照組(a1 2026-09-19 實跑, 落筆前先餵的那一發該紅的):把 `NOTIFICATION_EMAIL_MAX_OCTETS`
//    從 254 改成 1000 ⇒ 本檔 `Tests 2 failed | 6 passed (8)` ⇒ **這三格真的咬得住。**
//    ⚠️ 「改成 1000 而全樹沒有一格紅」那一句是**本片開工前的盤點結論(R1)**, 不是我這一發量的
//    —— 我量的是**加了這三格之後它會紅**。兩件事, 不要讀成同一件。
// ⛔ 另一發【沒跑成】:把 refine 裡那條 byteLength 整條拿掉、看這三格會不會紅
//    ⇒ 被 Claude Code 自動模式分類器擋下(判成「移除安全檢查」)。**未確認**, 沒有繞過去。
// 🛑 而它不是裝飾:`AddressEmailInput` 由本 schema refine 而來 ⇒ 收件地址的 email 也吃這條。
describe('NotificationEmailInput 的 octet 上限', () => {
  // 🔴 這裡**刻意寫死 254 / 255**, 不用 `NOTIFICATION_EMAIL_MAX_OCTETS` 造字串 ——
  //    拿常數造、再拿常數斷言 = 那一格跟著常數一起變, 只會紅在「量長度」那行。
  //    寫死才擋得住【兩種】壞法:改寬常數 · 把 refine 裡那條 byteLength 整條拿掉。
  //    本地部分固定 64 字元, 用網域長度湊到剛好(全 ASCII ⇒ 1 字元 = 1 octet)。
  const build = (octets: number) => {
    const local = 'a'.repeat(64);
    return `${local}@${'b'.repeat(octets - local.length - 1 - '.com'.length)}.com`;
  };

  it('🟢 剛好 254 octets ⇒ 過', () => {
    const at254 = build(254);
    expect(Buffer.byteLength(at254, 'utf8')).toBe(254); // 先確認這把尺量的是 octet
    expect(NotificationEmailInput.safeParse(at254).success).toBe(true);
  });

  it('🔴 255 octets ⇒ 被擋(放寬上限 / 拿掉 byteLength 那條 ⇒ 這一格會紅)', () => {
    const at255 = build(255);
    expect(Buffer.byteLength(at255, 'utf8')).toBe(255);
    expect(NotificationEmailInput.safeParse(at255).success).toBe(false);
  });

  it('常數本身仍是 254(改了它 ⇒ 上面兩格的前提就不成立)', () => {
    expect(NOTIFICATION_EMAIL_MAX_OCTETS).toBe(254);
  });
});
