import { describe, it, expect } from 'vitest';
import { AddressInput, CheckoutInvoiceInput } from './index';

// vitest root config glob `{packages,apps}/**/*.{test,spec}.{ts,tsx}` 收本檔。
// #201:name/line 必填欄純空白 trim(對齊 design saveAddress L705 !form.name.trim()||!form.line.trim())。
// U3a:發票規則改由 canonical `CheckoutInvoiceInput` 提供(原本 Address / Checkout 各抄一份);
//   本檔以「特徵測試」鎖住重構前後必須相同的行為,詳 checkout.test.ts 的 U3a 等價性說明。

const valid = {
  name: '王小明',
  // 🔴 2026-09-04 Sean 拍甲:電話改必填 ⇒ 這個共用樣本要帶它, 否則每一格都在驗「缺電話」。
  phone: '0912345678',
  line: '台北市信義區市府路 1 號',
  // M-4b 起 email 為必填(付款要用);長度 21 < 40 上限,不讓這個 fixture 值本身影響長度測試。
  email: 'wang.xiaoming@mail.tw',
  invoice: { type: 'personal' },
};

/** 取指定 path 的 issue message(path 以 '.' 串接比對,避免只驗 path[0] 漏掉巢狀層)。 */
function messageAt(result: ReturnType<typeof AddressInput.safeParse>, path: string): string | undefined {
  if (result.success) return undefined;
  return result.error.issues.find((i) => i.path.join('.') === path)?.message;
}

/** 取所有 issue 的 path 字串(不去重)——用來驗「同一欄只報一次」。 */
function pathsOf(result: ReturnType<typeof AddressInput.safeParse>): string[] {
  if (result.success) return [];
  return result.error.issues.map((i) => i.path.join('.'));
}

describe('AddressInput name/line 純空白 trim(#201)', () => {
  it('合法地址(invoice 子欄 default 補齊)→ 通過', () => {
    expect(AddressInput.safeParse(valid).success).toBe(true);
  });

  it('純空白 name → reject「請填寫收件人」(trim 後為空)', () => {
    const r = AddressInput.safeParse({ ...valid, name: '   ' });
    expect(r.success).toBe(false);
    if (!r.success) {
      const issue = r.error.issues.find((i) => i.path[0] === 'name');
      expect(issue?.message).toBe('請填寫收件人');
    }
  });

  it('純空白 line → reject「請填寫地址」(trim 後為空)', () => {
    const r = AddressInput.safeParse({ ...valid, line: '  \t ' });
    expect(r.success).toBe(false);
    if (!r.success) {
      const issue = r.error.issues.find((i) => i.path[0] === 'line');
      expect(issue?.message).toBe('請填寫地址');
    }
  });

  it('頭尾空白 name/line → 通過且入庫值去空白', () => {
    const parsed = AddressInput.parse({ ...valid, name: '  王小明 ', line: ' 台北市 ' });
    expect(parsed.name).toBe('王小明');
    expect(parsed.line).toBe('台北市');
  });
});

// === U3a:發票規則(重構前後必須完全相同的特徵測試)===
// 🔴 這組測試在「抽 canonical schema」之前與之後都必須全綠 —— 它們是等價性的機械證據,
//    不是新行為。重構前先跑一次確認全綠,才有資格說「規則沒被我改掉」。
describe('AddressInput 發票跨欄位規則(U3a canonical schema)', () => {
  it('personal:不驗公司/捐贈欄,且五個子欄由 default 補齊', () => {
    const parsed = AddressInput.parse(valid);
    expect(parsed.invoice).toEqual({
      type: 'personal',
      carrier: '',
      title: '',
      taxId: '',
      donateCode: '',
    });
  });

  it('company 缺抬頭 → issue path 為完整巢狀 invoice.title', () => {
    const r = AddressInput.safeParse({ ...valid, invoice: { type: 'company', taxId: '12345678' } });
    expect(r.success).toBe(false);
    expect(messageAt(r, 'invoice.title')).toBe('請填寫公司抬頭');
  });

  it.each([
    ['非 8 碼', '123'],
    ['9 碼', '123456789'],
    ['含非數字', '1234567a'],
    ['空字串', ''],
  ])('company 統編%s → issue path 為完整巢狀 invoice.taxId', (_label, taxId) => {
    const r = AddressInput.safeParse({ ...valid, invoice: { type: 'company', title: 'PCM', taxId } });
    expect(r.success).toBe(false);
    expect(messageAt(r, 'invoice.taxId')).toBe('統編需 8 碼數字');
  });

  it('company 抬頭與統編同時錯 → 兩條 issue 一起出現(不逐一阻擋)', () => {
    const r = AddressInput.safeParse({ ...valid, invoice: { type: 'company' } });
    expect(r.success).toBe(false);
    expect(messageAt(r, 'invoice.title')).toBe('請填寫公司抬頭');
    expect(messageAt(r, 'invoice.taxId')).toBe('統編需 8 碼數字');
  });

  it('company 齊全 → 通過', () => {
    expect(
      AddressInput.safeParse({ ...valid, invoice: { type: 'company', title: 'PCM 重機', taxId: '12345678' } })
        .success,
    ).toBe(true);
  });

  it('donate 缺愛心碼 → issue path 為完整巢狀 invoice.donateCode', () => {
    const r = AddressInput.safeParse({ ...valid, invoice: { type: 'donate' } });
    expect(r.success).toBe(false);
    expect(messageAt(r, 'invoice.donateCode')).toBe('請填愛心碼');
  });

  it('donate 有碼 → 通過', () => {
    expect(AddressInput.safeParse({ ...valid, invoice: { type: 'donate', donateCode: '520' } }).success).toBe(
      true,
    );
  });

  it('切到 personal 時,殘留的公司/捐贈欄不再阻擋(隱藏類型錯誤不殘留)', () => {
    expect(
      AddressInput.safeParse({ ...valid, invoice: { type: 'personal', title: '', taxId: '1', donateCode: '' } })
        .success,
    ).toBe(true);
  });

  // 🔴 結構性防漂移:兩張表單必須指向「同一個 schema 物件」,不是兩份長得一樣的定義。
  //    若有人未來把其中一邊改回自己的 z.object,這條會立刻轉紅 —— 這是 U3a 的核心價值。
  it('AddressInput.invoice 與 canonical CheckoutInvoiceInput 是同一個 schema 實例', () => {
    expect(AddressInput.shape.invoice).toBe(CheckoutInvoiceInput);
  });

  // 🔴 Address 端的 fatal sibling 案例(codex 關卡2 must-fix:原本只有 Checkout 端有)。
  //    isDefault 送非 boolean → invalid_type(fatal)。U3a 之前外層 superRefine 會被 zod 中止、
  //    發票錯誤整組消失;之後發票規則住在 invoice 欄自己身上,兩種錯誤一起報。
  //    正常 UI 打不出來(isDefault 由 checkbox 產生),需繞過前端直打 server action。
  it('fatal 兄弟欄位(isDefault 型別錯)不再吞掉發票錯誤', () => {
    const r = AddressInput.safeParse({
      ...valid,
      isDefault: '不是 boolean',
      invoice: { type: 'company' },
    });
    expect(r.success).toBe(false);
    expect(messageAt(r, 'isDefault')).toBeTruthy();
    expect(messageAt(r, 'invoice.title')).toBe('請填寫公司抬頭');
    expect(messageAt(r, 'invoice.taxId')).toBe('統編需 8 碼數字');
  });

  it('fatal 兄弟欄位存在時仍然 reject(等價性:驗證零放寬)', () => {
    expect(AddressInput.safeParse({ ...valid, isDefault: '不是 boolean' }).success).toBe(false);
    expect(AddressInput.safeParse({ ...valid, phone: 42 }).success).toBe(false);
  });

  // 🔴 **獨立一格, 而不是塞進上面那格** —— 上面那格的名字講的是「兄弟欄位」,
  //    我原本把這三個斷言塞在裡面, 而**它紅的時候會指錯方向**(讀的人以為是兄弟欄位壞了)。
  // ── ⟦b4-PHONEREGEXSPLIT⟧ Sean 2026-09-04 拍甲:三頁同一支判準 ──
  // 🔴 **主視窗-94 指定的守門**:`+886-9xx` 與分機**兩個帳號兩頁都填得進**。
  //    而它守的不是「這兩個字串」, 是【三個 schema 走同一支】—— 所以三個都要問一次。
  it('🔴 +886 與分機:註冊 / 個資 / 收件地址【三處都要收】', async () => {
    const { RegisterInput, ProfileInput } = await import('./index');
    for (const v of ['+886-912-345-678', '02-1234-5678 #12']) {
      expect(AddressInput.safeParse({ ...valid, phone: v }).success, `地址頁擋了 ${v}`).toBe(true);
      expect(
        RegisterInput.safeParse({ name: '王小明', email: 'a@b.tw', phone: v, password: 'aA1!aaaa' })
          .error?.issues.some((i) => i.path[0] === 'phone'),
        `註冊頁擋了 ${v} —— 那正是這一列講的病`,
      ).toBeFalsy();
      expect(
        ProfileInput.safeParse({ name: '王小明', phone: v, birthday: '', gender: 'undisclosed' })
          .error?.issues.some((i) => i.path[0] === 'phone'),
        `個資頁擋了 ${v}`,
      ).toBeFalsy();
    }
  });

  it('🔵 負對照:個資頁的電話仍然【選填】(空字串合法)—— 必填與否不由這支判準決定', async () => {
    const { ProfileInput } = await import('./index');
    expect(
      ProfileInput.safeParse({ name: '王小明', phone: '', birthday: '', gender: 'undisclosed' })
        .error?.issues.some((i) => i.path[0] === 'phone'),
    ).toBeFalsy();
  });

  it('🔴 電話必填(Sean 2026-09-04 拍甲)—— 空字串與純空白都要擋', () => {
    // 🔬 為什麼在這裡擋:出貨單那張紙上電話空白, 而正式庫 15 位客人裡 11 位存的是
    //    **空字串**(不是 NULL)⇒ 那個空字串的源頭是這個 schema 以前讓它選填。
    expect(
      AddressInput.safeParse({ ...valid, phone: '' }).success,
      '空字串放行 ⇒ 就是今天正式庫那 11 張空電話的來源',
    ).toBe(false);
    // 🔴 純空白也要擋 —— 否則客人打一個空格就繞過去了(與 name / line 同形狀)
    expect(AddressInput.safeParse({ ...valid, phone: '   ' }).success).toBe(false);
    // 🟢 負對照:有填就要放行, 而**格式刻意不驗** —— +886 / 分機 / 市話都是合法的,
    // ⚠️ **而這個值下游會被截**:新竹那支 `hct-trans-data.ts` 的 `HCT_MAX.phone = 15`
    //    (`ertel1` Char(15))⇒ 這個 20 字元的值送新竹時會被靜靜截成 15(會列進 `truncated`, 不炸)。
    //    📌 **所以它是「schema 該放行的值」, 不是「一路無損的理想值」** —— 別把這一格讀寬。
    //    一道猜錯格式的閘會把真客人擋在門外。要不要限格式是另一題。
    expect(AddressInput.safeParse({ ...valid, phone: '+886 2 1234-5678 #12' }).success).toBe(true);
  });

  // 🔴 code-reviewer 關卡 Critical:上面那條 `toBe` **擋不住最可能的回歸**。
  //    zod 4 的 `z.object({...}).superRefine(...)` 回傳仍是 ZodObject、`.shape.invoice` 不變,
  //    所以「invoice 仍指 canonical、但有人把規則複製回外層 superRefine」(= U3a 之前的原形)
  //    會讓同一個 path 出現**兩條**相同 issue,而 messageAt 用 `.find()` 取第一條 → 全部測試照樣綠。
  //    實測證實:加回外層重複規則後 63 條全綠。唯一擋得住的是「同一欄只能報一次」。
  it.each([
    ['company 雙錯', { type: 'company' }, ['invoice.title', 'invoice.taxId']],
    ['donate 缺碼', { type: 'donate' }, ['invoice.donateCode']],
  ])('%s:同一欄只出現一次 issue(擋規則被複製回外層的回歸)', (_label, invoice, expected) => {
    const paths = pathsOf(AddressInput.safeParse({ ...valid, invoice }));
    for (const p of expected) {
      expect(paths.filter((x) => x === p)).toHaveLength(1);
    }
  });
});

// === M-4b:收件地址 Email(LINE 3DS 修復;plan §2.2 / §3)===
// 🔴 背景:TapPay `cardholder.email` 有**總長 <= 40** 的驗證(2026-08-09 sandbox 對照實測 7 發:
//    40 字元 Success / 41 字元回 status 521 `Out of range : cardholder > email`;
//    同網域的短信箱可過 => 被拒的原因是**長度**、不是 `.local` 網域)。
//    LINE 合成信箱 line_U<32hex>@line.pcmmotorsports.local = 64 字元恆超標 => 3DS 啟動必被拒。
//
// 🔴 本組測試的判別力設計(兩條規則各自要有「只紅自己」的負測):
//    - 「拒合成網域」用一個 **27 字元**(<=40)的合成信箱 => 長度閘不會替它擋,紅的只可能是網域那條。
//    - 「<=40」用一個 **41 字元的真網域**信箱 => 網域閘不會替它擋,紅的只可能是長度那條。
//    若兩條都用「64 字元的合成信箱」測,任一條規則被拿掉測試都照樣綠 => 零判別力。
describe('AddressInput email(M-4b 付款用必填欄)', () => {
  /** 造一個總長剛好 n 的合法真網域 email(local 部分補 a)。 */
  function emailOfLength(n: number): string {
    const domain = 'mail.tw';
    const local = 'a'.repeat(n - 1 - domain.length);
    const email = `${local}@${domain}`;
    // 自我保護:構造錯了就當場失敗,不要讓一個長度不對的字串默默通過長度測試。
    expect(email).toHaveLength(n);
    return email;
  }

  it('缺 email → reject(必填)', () => {
    const { email: _omitted, ...withoutEmail } = valid;
    const r = AddressInput.safeParse(withoutEmail);
    expect(r.success).toBe(false);
    expect(pathsOf(r)).toContain('email');
  });

  it('空字串 email → reject「請填寫 Email」', () => {
    const r = AddressInput.safeParse({ ...valid, email: '' });
    expect(r.success).toBe(false);
    expect(messageAt(r, 'email')).toBe('請填寫 Email');
  });

  it('🔴 LINE 合成網域 → reject(且該值只有 27 字元、擋它的必然是網域那條規則)', () => {
    const synthetic = 'a@line.pcmmotorsports.local';
    expect(synthetic.length).toBeLessThanOrEqual(40); // 長度閘不可能替它擋
    const r = AddressInput.safeParse({ ...valid, email: synthetic });
    expect(r.success).toBe(false);
    expect(pathsOf(r)).toContain('email');
  });

  it('🔴 邊界:總長 40 → 通過(拿掉這條,把 <=40 寫成 <40 的差一錯就沒人會紅)', () => {
    const r = AddressInput.safeParse({ ...valid, email: emailOfLength(40) });
    expect(r.success).toBe(true);
  });

  it('🔴 邊界:總長 41 → reject(真網域、格式合法,唯一被拒的理由是長度)', () => {
    const overLimit = emailOfLength(41);
    const r = AddressInput.safeParse({ ...valid, email: overLimit });
    expect(r.success).toBe(false);
    expect(messageAt(r, 'email')).toBe('Email 請控制在 40 字元內(付款驗證限制)');
  });

  it('入庫值:網域轉小寫、local-part 原字面保留(沿用 NotificationEmailInput 的 canonicalize)', () => {
    const parsed = AddressInput.parse({ ...valid, email: '  Wang.Xiao@Mail.TW  ' });
    expect(parsed.email).toBe('Wang.Xiao@mail.tw');
  });
});
