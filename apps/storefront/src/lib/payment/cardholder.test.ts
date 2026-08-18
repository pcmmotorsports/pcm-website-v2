// node env;mock 'server-only'(cardholder.ts 檔頭 import 'server-only')。
// Q3=B 級聯 + trim min(1) + fail-closed 全分支(plan v6 §5/§10 ②-③d 驗收)。
import { describe, it, expect, vi } from 'vitest';
import type { Customer, CustomerAddress } from '@pcm/domain';
import type { IAddressRepository, ICustomerRepository } from '@pcm/ports';

vi.mock('server-only', () => ({}));

import { buildCardholder } from './cardholder';

const USER = { id: 'user-uuid-1', email: 'a@b.com' };
const ADDR_ID = 'addr-uuid-1';

function customer(over: Partial<Customer> = {}): Customer {
  return {
    id: 'user-uuid-1',
    email: 'a@b.com',
    name: '王小明',
    phone: '0900111222',
    birthday: null,
    tier: 'general',
    walletBalance: 0,
    totalDeposit: 0,
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
    ...over,
  };
}

function address(over: Partial<CustomerAddress> = {}): CustomerAddress {
  return {
    id: ADDR_ID,
    customerUserId: 'user-uuid-1',
    name: '收件人甲',
    phone: '0912345678',
    line: '台北市信義區 1 號',
    // 預設 null = **新欄之前就存在的舊地址**(最貼近真實存量資料);
    // 要驗「地址自帶 email」的案例各自 over 掉。
    email: null,
    isDefault: true,
    invoice: { type: 'personal', carrier: '', title: '', taxId: '', donateCode: '' },
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
    ...over,
  };
}

function deps(opts: { customer?: Customer | null; addresses?: CustomerAddress[] } = {}) {
  const customers = {
    findById: vi.fn(async () => (opts.customer === undefined ? customer() : opts.customer)),
  } as unknown as ICustomerRepository;
  const addresses = {
    listByCustomer: vi.fn(async () => opts.addresses ?? [address()]),
  } as unknown as IAddressRepository;
  return { customers, addresses };
}

describe('buildCardholder — happy + Q3=B 級聯', () => {
  it('全齊 → name=profile、phone=地址、email=user(地址 phone 優先於 profile phone)', async () => {
    const res = await buildCardholder(deps(), { user: USER, addressId: ADDR_ID });
    expect(res).toEqual({
      ok: true,
      cardholder: { name: '王小明', email: 'a@b.com', phoneNumber: '0912345678' },
      addressEmail: null, // 🔴 B-4:ok 分支多這個原值(未驗)給通知信解析;地址 fixture 預設 email:null
    });
  });

  it('profile name 空 → 級聯收件人 name(Q3=B)', async () => {
    const res = await buildCardholder(deps({ customer: customer({ name: '' }) }), {
      user: USER,
      addressId: ADDR_ID,
    });
    expect(res).toMatchObject({ ok: true, cardholder: { name: '收件人甲' } });
  });

  it('地址 phone 空 → 級聯 profile phone(Q3=B)', async () => {
    const res = await buildCardholder(deps({ addresses: [address({ phone: '' })] }), {
      user: USER,
      addressId: ADDR_ID,
    });
    expect(res).toMatchObject({ ok: true, cardholder: { phoneNumber: '0900111222' } });
  });

  it('🔴 trim:全形空白/空格不得當有值(「   」→ 級聯;email 兩側空白剝除)', async () => {
    const res = await buildCardholder(
      deps({
        customer: customer({ name: '\u3000\u3000' }), // 全形空白(U+3000)
        addresses: [address({ phone: '  ' })],
      }),
      { user: { id: USER.id, email: '  a@b.com  ' }, addressId: ADDR_ID },
    );
    expect(res).toEqual({
      ok: true,
      cardholder: { name: '收件人甲', email: 'a@b.com', phoneNumber: '0900111222' },
      addressEmail: null, // 🔴 B-4:原值直傳、本層不驗(地址 fixture 預設 email:null)
    });
  });
});

describe('buildCardholder — fail-closed 全分支', () => {
  // M-4b 改寫:舊版是「session email 空 → email_missing,且零 DB 讀(email gate 排最前)」。
  // 🔴 **「零 DB 讀」這個性質本片刻意放棄了**,不是漏掉:email 現在要先看**選中地址**的
  //    email 才決定得了(順位:地址 → session),而拿地址本來就要讀 DB。
  //    代價是空 email 這種案例多兩次 repo 呼叫;換到的是 LINE 身分能靠地址 email 付款。
  it('🔴 地址 email 為 null 且 session email 空 → email_unusable(不送空給 TapPay)', async () => {
    const d = deps(); // 地址 fixture 預設 email: null
    for (const email of ['', '   ', null, undefined]) {
      const res = await buildCardholder(d, { user: { id: USER.id, email }, addressId: ADDR_ID });
      expect(res).toEqual({ ok: false, reason: 'email_unusable' });
    }
  });

  it('🔴 profile 查無 row → profile_not_found(round6 NIT:不靜默級聯)', async () => {
    const res = await buildCardholder(deps({ customer: null }), { user: USER, addressId: ADDR_ID });
    expect(res).toEqual({ ok: false, reason: 'profile_not_found' });
  });

  it('🔴 addressId 非本人/不存在(RLS 濾掉)→ address_not_found', async () => {
    const res = await buildCardholder(deps(), { user: USER, addressId: 'addr-other' });
    expect(res).toEqual({ ok: false, reason: 'address_not_found' });
  });

  it('name 雙空(profile + 收件人;防 DB 腐壞)→ name_missing', async () => {
    const res = await buildCardholder(
      deps({ customer: customer({ name: '' }), addresses: [address({ name: '  ' })] }),
      { user: USER, addressId: ADDR_ID },
    );
    expect(res).toEqual({ ok: false, reason: 'name_missing' });
  });

  it('🔴 phone 雙空(地址 + profile)→ phone_missing(引導補手機)', async () => {
    const res = await buildCardholder(
      deps({ customer: customer({ phone: '' }), addresses: [address({ phone: '' })] }),
      { user: USER, addressId: ADDR_ID },
    );
    expect(res).toEqual({ ok: false, reason: 'phone_missing' });
  });

  it('repo throw → 原樣上拋(action 吞通用字面、不在本層吞)', async () => {
    const d = deps();
    (d.customers.findById as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
      new Error('connection refused'),
    );
    await expect(buildCardholder(d, { user: USER, addressId: ADDR_ID })).rejects.toThrow();
  });
});

// ===== M-4b:LINE 身分 × 收件地址 Email(plan §3.1;P-209-STOP 查出的零交會缺口)=====
//
// 🔴 背景(sandbox 對照實測 7 發,2026-08-09):TapPay 對 cardholder.email 有總長 <= 40 的
//    驗證,超過回 status 521 `Out of range : cardholder > email`;**同網域的短信箱可過**
//    ⇒ 被拒的是長度、不是 `.local` 網域。LINE 合成信箱 line_U<32hex>@line.pcmmotorsports.local
//    = 64 字元恆超標 ⇒ 3DS 啟動必被拒,客人拿不到 payment_url。
//
// 🔴 fixture 紀律:本組的 LINE session email **一律用真實形狀的 64 字元合成信箱**,
//    不圖方便寫成短假值 —— 寫短了,「合成域」與「超長」兩條就分不出是誰擋的,
//    整組守門會退化成恆真。
const LINE_SUB = 'U4f8c2a9d1e7b3f6a5c0d9e8f7a6b5c4d'; // 32 hex,對齊 auth/line.ts 產生的形狀
const LINE_EMAIL = `line_${LINE_SUB}@line.pcmmotorsports.local`; // 64 字元
const LINE_USER = { id: USER.id, email: LINE_EMAIL };

describe('buildCardholder — M-4b 收件地址 Email', () => {
  it('自我保護:LINE fixture 真的是 64 字元的合成信箱(不是短假值)', () => {
    expect(LINE_EMAIL).toHaveLength(64);
    expect(LINE_EMAIL.endsWith('@line.pcmmotorsports.local')).toBe(true);
  });

  // ① LINE × 地址有 email → 用地址的(修復生效的正向證據)
  it('🔴 LINE 身分 × 地址有 email → cardholder.email 等於**地址**的 email', async () => {
    const d = deps({ addresses: [address({ email: 'line-user@mail.tw' })] });
    const res = await buildCardholder(d, { user: LINE_USER, addressId: ADDR_ID });
    expect(res).toEqual({
      ok: true,
      cardholder: { name: '王小明', email: 'line-user@mail.tw', phoneNumber: '0912345678' },
      addressEmail: 'line-user@mail.tw', // 🔴 B-4:LINE 客人的通知信就是靠這個值落地
    });
  });

  // ② LINE × 舊地址(email null)→ 擋下(唯一會被擋的組合)
  it('🔴 LINE 身分 × 舊地址(email null)→ email_unusable,合成信箱不得外流', async () => {
    const res = await buildCardholder(deps(), { user: LINE_USER, addressId: ADDR_ID });
    expect(res).toEqual({ ok: false, reason: 'email_unusable' });
  });

  // ③ email 身分 × 舊地址 → 回落 session。
  //    ⚠️ 措辭精準化(codex 關卡2):可以宣稱的是「**舊地址(email 為 null)時行為不變**」,
  //    **不能**宣稱「非 LINE 用戶一律零變化」—— 見下面 ④:地址一旦有 email,
  //    送出的就是地址的那個(即使與登入信箱不同)。那是 Sean 拍板要的(可用不同 email),
  //    但它確實是行為變更,不該用「零回歸」四個字蓋過去。
  it('email 身分 × 舊地址(email null)→ 回落 session email、照常成交', async () => {
    const res = await buildCardholder(deps(), { user: USER, addressId: ADDR_ID });
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.cardholder.email).toBe('a@b.com');
  });

  // ④ 順位可觀察:兩邊都有值時,地址優先於 session
  it('email 身分 × 地址也有 email → 用**地址**的(順位 1 優先於 2)', async () => {
    const d = deps({ addresses: [address({ email: 'ship-to@mail.tw' })] });
    const res = await buildCardholder(d, { user: USER, addressId: ADDR_ID });
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.cardholder.email).toBe('ship-to@mail.tw');
  });

  // ⑤ 🔴 毒地址:證明**合成網域那一條**單獨活著的負測。
  //
  //    🔴🔴 這裡的值必須是「**短的**合成信箱」(27 字元),不能用上面那個 64 字元的
  //    `LINE_EMAIL` —— 實測踩過:用 64 字元時,把合成域檢查拿掉,長度閘(64 > 40)
  //    照樣擋住它,測試仍然全綠 ⇒ 這條負測對合成域閘**零判別力**。
  //    兩條規則都能擋的值,證明不了是哪一條在擋。
  //
  //    情境本身也真實:繞過 zod 寫進 DB 的髒資料、或未來新增的寫入路徑忘了驗。
  //    順位 1 會挑中它 ⇒ 只有出口閘攔得下。
  const SHORT_SYNTHETIC = 'a@line.pcmmotorsports.local'; // 27 字元:過得了長度閘

  it('🔴 毒地址(短的合成域 email)+ session 也不可用 → 擋下;專證「合成域檢查」單獨有效', async () => {
    expect(SHORT_SYNTHETIC.length).toBeLessThanOrEqual(40); // 長度閘不可能替它擋
    const d = deps({ addresses: [address({ email: SHORT_SYNTHETIC })] });
    // 🔴 session 必須也不可用,否則候選會回落到它、結果變成 ok ——
    //    那樣這條就測不到「合成域被擋」了(codex 關卡2 指出的判別力破口)。
    const res = await buildCardholder(d, { user: { id: USER.id, email: '' }, addressId: ADDR_ID });
    expect(res).toEqual({ ok: false, reason: 'email_unusable' });
  });

  // ⑤b 逐個候選試:地址髒但 session 合格 → **不該擋**(codex 關卡2 must-fix:別誤擋付得成功的客人)
  it('🔴 地址 email 髒但 session email 合格 → 回落 session、照常成交(不誤擋)', async () => {
    const d = deps({ addresses: [address({ email: SHORT_SYNTHETIC })] });
    const res = await buildCardholder(d, { user: USER, addressId: ADDR_ID });
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.cardholder.email).toBe('a@b.com');
  });

  // ⑤c 格式:短、非合成域,但根本不是合法 email —— 舊版只驗「網域 + 長度」時這些會漏出去
  it.each(['abc', 'a@b', 'a b@mail.tw', 'a@@mail.tw', '大@mail.tw'])(
    '🔴 畸形 email %s(短且非合成域)→ 不得送進 TapPay',
    async (bad) => {
      const d = deps({ addresses: [address({ email: bad })] });
      const res = await buildCardholder(d, { user: { id: USER.id, email: '' }, addressId: ADDR_ID });
      expect(res).toEqual({ ok: false, reason: 'email_unusable' });
    },
  );

  // ⑤d 反面:半形頭尾空白**不是**畸形,要被正規化後收下 —— 客人多打一個空白不該被擋在付款前。
  //     (第一版我把它寫進上面的畸形清單、測試紅了才發現是我的斷言量錯東西。)
  it('半形頭尾空白的 email → 正規化後照常成交,不是畸形', async () => {
    const d = deps({ addresses: [address({ email: '  ship@mail.tw  ' })] });
    const res = await buildCardholder(d, { user: { id: USER.id, email: '' }, addressId: ADDR_ID });
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.cardholder.email).toBe('ship@mail.tw');
  });

  // ⑤e 🔴 送出的必須是 **schema 正規化後**的值,不是原字面(codex 關卡2 round2 must-fix)。
  //     大小寫是唯一能區分兩者的觀察點:網域轉小寫、local-part 保留原樣。
  //     沒有這條的話,`pickUsableEmail` 改成 `return candidate`(丟掉 parsed.data)也照樣全綠。
  it('🔴 送進 TapPay 的是 schema 正規化後的值(網域轉小寫、local-part 不動)', async () => {
    const d = deps({ addresses: [address({ email: 'User.Name@MAIL.TW' })] });
    const res = await buildCardholder(d, { user: { id: USER.id, email: '' }, addressId: ADDR_ID });
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.cardholder.email).toBe('User.Name@mail.tw');
  });

  // ⑤f tab / 全形空白包起來的值:schema 的 canonicalize 只剝半形空白 ⇒ 這些仍是畸形、要被擋。
  //     這條釘住「本層不得自己再 trim 一次」——外層多一道 trim 就會放行它們,兩套標準。
  it.each(['\tship@mail.tw', '　ship@mail.tw'])(
    '🔴 tab/全形空白包起來的 email → 仍是畸形、擋下(不得在本層另做 trim)',
    async (bad) => {
      const d = deps({ addresses: [address({ email: bad })] });
      const res = await buildCardholder(d, { user: { id: USER.id, email: '' }, addressId: ADDR_ID });
      expect(res).toEqual({ ok: false, reason: 'email_unusable' });
    },
  );

  // ⑥ 長度邊界:40 過 / 41 拒(值取自 sandbox 實測,不是猜的)
  it('🔴 邊界:地址 email 總長 40 → 過;41 → 擋(差一錯寫成 < 40 只有前者會紅)', async () => {
    const at = (n: number) => `${'a'.repeat(n - 1 - 'mail.tw'.length)}@mail.tw`;
    expect(at(40)).toHaveLength(40);
    expect(at(41)).toHaveLength(41);

    const ok = await buildCardholder(deps({ addresses: [address({ email: at(40) })] }), {
      user: LINE_USER,
      addressId: ADDR_ID,
    });
    expect(ok.ok).toBe(true);
    if (ok.ok) expect(ok.cardholder.email).toBe(at(40));

    // 🔴 41 這半刻意用**合格的** session 當回落(R3 審查 N2):
    //    原本用 LINE_USER,它的 64 字元合成信箱也不可用 ⇒ 這條被「兩個都不可用」過度決定,
    //    把候選順位對調它照樣綠。改成合格 session 後,斷言變成「地址的 41 字元不被採用、
    //    改用 session」—— 若 41 被誤判為可用,送出的就會是 41 字元那個值 ⇒ 紅。
    const fellBack = await buildCardholder(deps({ addresses: [address({ email: at(41) })] }), {
      user: USER,
      addressId: ADDR_ID,
    });
    expect(fellBack.ok).toBe(true);
    if (fellBack.ok) expect(fellBack.cardholder.email).toBe('a@b.com');

    // 41 且無回落 → 真的擋下
    const rejected = await buildCardholder(deps({ addresses: [address({ email: at(41) })] }), {
      user: { id: USER.id, email: '' },
      addressId: ADDR_ID,
    });
    expect(rejected).toEqual({ ok: false, reason: 'email_unusable' });
  });

  // ⑦ 順帶收掉的既有雷:email 登入但真實信箱 > 40 字元的人,現況同樣付不了款。
  it('🔴 email 身分 × session email 41 字元 × 舊地址 → 擋下(既有雷,本片一併收)', async () => {
    const long = `${'a'.repeat(33)}@mail.tw`;
    expect(long).toHaveLength(41);
    const res = await buildCardholder(deps(), {
      user: { id: USER.id, email: long },
      addressId: ADDR_ID,
    });
    expect(res).toEqual({ ok: false, reason: 'email_unusable' });
  });

  // ⑧ 成功案抽查:幾組代表性輸入的產出都不是合成網域。
  //    ⚠️ **降格措辭**(codex 關卡2 round2 nit):第一版叫它「全域不變量 / 兜底斷言」,
  //    但它餵的全是本來就會產生合格 email 的案例 ⇒ 拿掉合成域防線它照樣全綠、
  //    **當不了第二腿證據**。真正的判別力在上面那條「短合成域負測」。
  //    留著是因為它便宜地覆蓋了三種身分×地址組合的產出形狀,不是因為它守得住什麼。
  it('成功案抽查:幾組代表性輸入產出的 cardholder.email 都不是合成網域', async () => {
    const cases = [
      { user: LINE_USER, addresses: [address({ email: 'a@mail.tw' })] },
      { user: USER, addresses: [address()] },
      { user: USER, addresses: [address({ email: 'b@mail.tw' })] },
    ];
    for (const c of cases) {
      const res = await buildCardholder(deps({ addresses: c.addresses }), {
        user: c.user,
        addressId: ADDR_ID,
      });
      expect(res.ok).toBe(true);
      if (res.ok) expect(res.cardholder.email).not.toContain('line.pcmmotorsports.local');
    }
  });
});
