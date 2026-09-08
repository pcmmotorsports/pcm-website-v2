import { describe, expect, it } from 'vitest';
import { EMAIL_VERIFICATION_LABEL, type EmailVerification } from './email-verification';
import {
  emailChangeBlockedCode,
  emailChangeEligibility,
  emailChangeResultCode,
  type EmailChangeResultKind,
} from './email-change-state';

// 🔴🔴 **分母從【承重的那份型別的執行期投影】來, 不是我手寫的。**
//    ⛔ ~~舊版寫成手寫的 6 格 `as const satisfies readonly Kind[]`~~ ——
//    code-reviewer 與 codex 2026-09-08 **各自獨立**指出它沒有牙齒:
//    `satisfies readonly Kind[]` 對「union 多一格」只是**子集**、不報錯
//    ⇒ 有人新增第七格 kind ⇒ 本檔**全綠**, 而它的測項名字寫著「本格會紅」。
//    ⇒ 📌 一句宣稱有牙齒而沒有牙齒的自檢, **比沒有那一格更糟**
//       (memory `feedback_a-toothless-selftest-is-worse-than-none`)。
// ✅ `EMAIL_VERIFICATION_LABEL` 是 `Record<EmailVerification['kind'], string>`
//    ⇒ 少一格 ⇒ 那支檔 typecheck 紅;多一格 ⇒ **本檔的分母當場變大**、下面的斷言紅。
const ALL_KINDS = Object.keys(EMAIL_VERIFICATION_LABEL) as EmailVerification['kind'][];

/** 純密碼註冊的帳號(GoTrue `app_metadata.providers`)。 */
const EMAIL_ONLY = ['email'];

describe('emailChangeEligibility — 軸一:這個位址是不是我們自己編出來的', () => {
  it.each(['verified', 'unverified'] as const)('%s + 純信箱登入 → 可以改', (kind) => {
    expect(emailChangeEligibility(kind, EMAIL_ONLY).allowed).toBe(true);
  });

  it.each(['line', 'manual', 'synthetic', 'unknown'] as const)(
    '%s → 擋下(即使 providers 是純信箱)',
    (kind) => {
      expect(emailChangeEligibility(kind, EMAIL_ONLY).allowed).toBe(false);
    },
  );

  // 🔴 這一格守的是「白名單」本身:新增第七格 kind 而沒有人判它 ⇒ 分母變 7 ⇒ 本格紅。
  it('🔴 分母恰好六格, 而恰好兩格可以改 —— 新增一格 kind 沒人判 ⇒ 本格紅', () => {
    expect(ALL_KINDS).toHaveLength(6);
    expect(ALL_KINDS.filter((k) => emailChangeEligibility(k, EMAIL_ONLY).allowed)).toEqual([
      'verified',
      'unverified',
    ]);
  });
});

describe('emailChangeEligibility — 軸二:這個帳號是不是靠信箱密碼登入的', () => {
  // 🔴🔴 **本族是 code-reviewer 與 codex 各自獨立抓到的那條缺口。**
  //    Google 一鍵註冊沒有 `pcm_provider`、email 是真 gmail ⇒ kind 會判成 `verified`
  //    ⇒ 只有軸一的話它**塌進白名單的第一格**、直接放行。
  it('🔴 Google 帳號(kind=verified)→ 擋下', () => {
    const r = emailChangeEligibility('verified', ['google']);
    expect(r.allowed).toBe(false);
    if (r.allowed) return;
    expect(r.reason).toContain('google');
  });

  it('🔴 信箱 + Google 都綁著 → 擋下(不是「有 email 就放行」)', () => {
    expect(emailChangeEligibility('verified', ['email', 'google']).allowed).toBe(false);
  });

  it.each([
    ['null(讀不到)', null],
    ['undefined(欄位不在)', undefined],
    ['空陣列', []],
  ])('🔴 %s → fail-closed 擋下', (_label, providers) => {
    expect(emailChangeEligibility('verified', providers).allowed).toBe(false);
  });

  // 🟢 正對照:少了這一格, 上面每一格在「一律擋下」的實作下也會全綠。
  it('🟢 正對照:純 email → 放行(尺不是恆回擋下)', () => {
    expect(emailChangeEligibility('verified', ['email']).allowed).toBe(true);
  });
});

describe('emailChangeEligibility — 擋下來要說得出下一步', () => {
  it.each(['line', 'manual', 'synthetic', 'unknown'] as const)('%s → 有一句話', (kind) => {
    const r = emailChangeEligibility(kind, EMAIL_ONLY);
    expect(r.allowed).toBe(false);
    if (r.allowed) return;
    expect(r.reason.length).toBeGreaterThan(10);
  });

  it('🔴 四句彼此不同(共用文案 = 又把它們印成同一件事)', () => {
    const texts = (['line', 'manual', 'synthetic', 'unknown'] as const).map((k) => {
      const r = emailChangeEligibility(k, EMAIL_ONLY);
      return r.allowed ? '' : r.reason;
    });
    expect(new Set(texts).size).toBe(4);
  });

  it('🔴 unknown 那句要說得出「這不代表不能改」', () => {
    const r = emailChangeEligibility('unknown', EMAIL_ONLY);
    expect(r.allowed).toBe(false);
    if (r.allowed) return;
    expect(r.reason).toContain('不代表不能改');
  });
});

describe('emailChangeBlockedCode — 暫時 vs 永久要送不同的碼', () => {
  // 🔴 這兩顆碼在畫面上叫員工做**相反**的事(再試一次 / 不要再試)⇒ 分得開才有意義。
  it('unknown → unreadable(等一下再試)', () => {
    expect(emailChangeBlockedCode('unknown', EMAIL_ONLY)).toBe('unreadable');
  });
  it('軸二讀不到 → unreadable(同樣是「現在不知道」)', () => {
    expect(emailChangeBlockedCode('verified', null)).toBe('unreadable');
  });
  it.each(['line', 'manual', 'synthetic'] as const)('%s → not_eligible(永久)', (kind) => {
    expect(emailChangeBlockedCode(kind, EMAIL_ONLY)).toBe('not_eligible');
  });
  it('🔴 Google(軸二不過而不是讀不到)→ not_eligible, 不是 unreadable', () => {
    expect(emailChangeBlockedCode('verified', ['google'])).toBe('not_eligible');
  });
});

describe('emailChangeResultCode — 前綴', () => {
  it('十三顆全部帶 customer_email_ 前綴(共用 MESSAGES 表, 撞號會顯示別條線的話)', () => {
    const kinds: EmailChangeResultKind[] = [
      'saved',
      'saved_audit_failed',
      'no_change',
      'denied',
      'invalid',
      'not_eligible',
      'unreadable',
      'taken',
      'auth_unknown',
      'not_found',
      'half_done',
      'half_done_stuck',
      'error',
    ];
    const codes = kinds.map(emailChangeResultCode);
    expect(codes.every((c) => c.startsWith('customer_email_'))).toBe(true);
    expect(new Set(codes).size).toBe(13);
  });
});
