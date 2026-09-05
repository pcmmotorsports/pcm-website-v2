import { afterEach, describe, expect, it, vi } from 'vitest';
import { hctMode, queryEdelno, submitTransData, type HctClientDeps } from './hct-client';
import { buildHctTransData } from './hct-trans-data';

// hct-client.test.ts — ⟦ship-HCTAPI⟧ 片 B 的守門。
//
// 🔴🔴 **這一片交付時那條路是【關著】的** ⇒ 而「關著」不是一個 if, 是**四個性質**,
//    所以下面每一個都各有一發突變殺得死它(清單在 plan §4)。
//
// 🛑 **本檔一發真的請求都不打** —— `fetchImpl` 是注入的。
//    ⇒ 而那不只是為了測試方便:📌 **一支會在測試裡打對方端點的 client, 它的測試本身就是一個對外動作。**

const FIELDS = buildHctTransData({
  displayId: 'PCM-2026-0001',
  recipient: { name: '王小明', phone: '0912345678', line: '新北市新莊區化成路 736 巷 18 號' },
  itemCount: 1,
}).fields;

/** 一支會記錄「被叫了幾次」的假 fetch —— 那個次數是本檔好幾格的承重。 */
function fakeFetch(res: () => Promise<Response> | Response) {
  const calls: string[] = [];
  const impl = ((url: string | URL | Request) => {
    calls.push(String(url));
    return Promise.resolve(res());
  }) as unknown as typeof fetch;
  return { impl, calls };
}

const json = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

// 🔴🔴 **SOAP fixture —— 而它的形狀是【打出來的】, 不是我照文件寫的。**
//    2026-09-05 對 hctrt 打了四發(⟦ship-HCTAPI⟧, Sean 本人授權, 零建單), 回應原文長這樣。
//    📌 **這一段的價值在「它是真的」** —— 一個我自己編的 fixture 會照著我的實作長,
//      而那正是「fixture 往我的結論偏」那一族。
const soap = (body: unknown, method = 'TransData_Json', status = 200): Response =>
  new Response(
    `<?xml version="1.0" encoding="utf-8"?><soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/"><soap:Body><${method}Response xmlns="http://tempuri.org/"><${method}Result>${JSON.stringify(body)}</${method}Result></${method}Response></soap:Body></soap:Envelope>`,
    { status, headers: { 'Content-Type': 'text/xml; charset=utf-8' } },
  );

/** 🔴 今天真的收到的那三句 `ErrMsg` —— 逐字, 不要改。 */
const REAL = {
  badCredential: '公司名稱或密碼錯誤',
  badShape: '資料錯誤請確認',
  /** 🎯 **這一句是「外層被讀懂了」的證據** —— 它已經走進去驗欄位(件數 = `ejamt`)。 */
  parsedThenFieldError: '件數錯誤',
} as const;

/** 真回應的完整欄位形狀(20 欄, 機械數的;而 `CODE6` 不在裡面 —— 未查, 不猜)。 */
const realRow = (over: Record<string, unknown>) => [
  {
    Num: null, success: 'N', edelno: null, epino: null, erstno: null, eqamt: null,
    image: null, ErrMsg: null, NewOutArea: null, eqmny: null,
    CODE1: null, CODE2: null, CODE3: null, CODE4: null, CODE5: null, CODE7: null,
    AREAS: null, MDCODE1: null, MDCODE2: null, MDCODE3: null,
    ...over,
  },
];

function deps(fetchImpl: typeof fetch): HctClientDeps {
  return { fetchImpl, endpoint: 'https://example.invalid/x', account: 'acct', password: 'pw' };
}

afterEach(() => {
  vi.unstubAllEnvs();
});

/** 把閘打開(測試環境預設 `NODE_ENV=test`,而 gate 只擋 development)。 */
function openGates() {
  vi.stubEnv('HCT_SUBMIT_ENABLED', 'true');
  vi.stubEnv('HCT_QUERY_ENABLED', 'true');
}

describe('⟦ship-HCTAPI⟧ 片 B · 那道閘 —— 「關著」是四個性質, 不是一個 if', () => {
  it('🔴 未設 ⇒ disabled, 而【一發請求都沒打】', async () => {
    const f = fakeFetch(() => json({}));
    expect(await submitTransData(deps(f.impl), FIELDS)).toEqual({ kind: 'disabled' });
    // 🔴 承重:少了這一行,「先打出去再判斷要不要用結果」也會通過上一行。
    expect(f.calls, '閘關著而請求已經送出去了 ⇒ 對外不可回收(鐵則 12⑤)').toEqual([]);
  });

  it.each(['false', '1', 'TRUE', 'True', 'yes', ''])(
    '🔴 嚴格 opt-in:值是 %o ⇒ 仍然關著(一個打錯的值不會變成開)',
    async (v) => {
      vi.stubEnv('HCT_SUBMIT_ENABLED', v);
      const f = fakeFetch(() => json({}));
      expect(await submitTransData(deps(f.impl), FIELDS)).toEqual({ kind: 'disabled' });
      expect(f.calls).toEqual([]);
    },
  );

  it('🔴 development 一律當關 —— 就算值是字面 true', async () => {
    vi.stubEnv('NODE_ENV', 'development');
    vi.stubEnv('HCT_SUBMIT_ENABLED', 'true');
    const f = fakeFetch(() => json({}));
    expect(
      await submitTransData(deps(f.impl), FIELDS),
      '本機不該有能力送出真的託運單 —— 而這一格不靠「本機剛好沒設值」',
    ).toEqual({ kind: 'disabled' });
    expect(f.calls).toEqual([]);
  });

  it('🔴 兩顆 env 不共用:只開送出 ⇒ 查詢仍然關著(唯讀與送出是兩個授權)', async () => {
    vi.stubEnv('HCT_SUBMIT_ENABLED', 'true');
    const f = fakeFetch(() => json({}));
    expect(await queryEdelno(deps(f.impl), 'PCM-2026-0001')).toEqual({ kind: 'disabled' });
    expect(f.calls, '開了送出就順便可以查 ⇒ 那正是共用一顆 env 的病').toEqual([]);
  });

  it('🔵 負對照:閘開著 ⇒ 真的走完(證明上面那些 disabled 不是因為它永遠失敗)', async () => {
    openGates();
    const f = fakeFetch(() => soap(realRow({ success: 'Y', edelno: '1234567890' })));
    expect(await submitTransData(deps(f.impl), FIELDS)).toMatchObject({
      kind: 'submitted',
      edelno: '1234567890',
    });
    expect(f.calls.length).toBe(1);
  });
});

describe('⟦ship-HCTAPI⟧ 片 B · 第三態 —— 不確定時【絕不】說 failed', () => {
  /**
   * 🔴🔴 **這一族是整片的承重。**
   * `failed` 會讓下一個人**重送**, 而規格第 8 頁逐字「同日重複上傳 ⇒ **視同更正**」
   * ⇒ 🎯 **重送不是重送。** 而更正要帶新竹貨號, 那只有第一次送成功才拿得到。
   */
  it.each([
    ['網路炸掉', () => { throw new Error('boom'); }],
    ['HTTP 500', () => json({}, 500)],
    ['HTTP 200 而 body 不是 JSON', () => new Response('<html>', { status: 200 })],
    ['認不得的 success 值', () => soap(realRow({ success: 'Z' }))],
  ])('🔴 %s ⇒ unknown(不是 failed / rejected)', async (_name, make) => {
    openGates();
    const f = fakeFetch(make as () => Response);
    const out = await submitTransData(deps(f.impl), FIELDS);
    expect(out.kind, '回 failed 會引導出一個破壞性動作(重送 = 更正)').toBe('unknown');
  });

  it('🔵 而【明確的】業務失敗仍然是 rejected —— unknown 不得吃掉它', async () => {
    openGates();
    const f = fakeFetch(() => soap(realRow({ success: 'N', ErrMsg: REAL.badCredential })));
    const out = await submitTransData(deps(f.impl), FIELDS);
    expect(out.kind, '把 N 也讀成 unknown ⇒ 一個真的被拒的單會被當成「可能成功」').toBe('rejected');
    expect(out).toMatchObject({ errMsg: '公司名稱或密碼錯誤' });
  });

  it('🔴 raw 整包留著 —— 出錯那一刻它是唯一能回頭看的東西', async () => {
    openGates();
    const body = [{ success: 'N', ErrMsg: '貨號重複', 我們沒解析的欄: '值' }];
    const f = fakeFetch(() => soap(body));
    const out = await submitTransData(deps(f.impl), FIELDS);
    // 🔴 承重:規格只有錯誤【文字】沒有數字碼 ⇒ 字串會被對方改, 而 raw 是唯一的退路。
    expect(out).toMatchObject({ raw: body });
  });
});

describe('⟦ship-HCTAPI⟧ 片 B · queryEdelno —— fail-closed', () => {
  it.each(['', '   ', '\t'])('🔴 訂單編號是 %o ⇒ 丟例外, 而【請求沒送出去】', async (bad) => {
    openGates();
    const f = fakeFetch(() => json({}));
    await expect(queryEdelno(deps(f.impl), bad)).rejects.toThrow(/不得為空/);
    expect(f.calls, '空的識別鍵等於問新竹「隨便給我一張單」').toEqual([]);
  });

  it('🔵 正對照:有訂單編號且閘開著 ⇒ 找得到(證明上面那幾格不是因為它永遠丟例外)', async () => {
    openGates();
    const f = fakeFetch(() => soap(realRow({ success: 'Y', edelno: '9990001234' }), 'QueryEDELNO_Json'));
    expect(await queryEdelno(deps(f.impl), 'PCM-2026-0001')).toMatchObject({
      kind: 'found',
      edelno: '9990001234',
    });
  });
});

describe('⟦ship-HCTAPI⟧ 片 B · 打錯環境 —— 網址分不出來, 帳號分得出來', () => {
  it('🔴 帳號是 test ⇒ test 模式;其餘一律 live', () => {
    // 規格第 10 頁逐字給了測試帳密「公司名稱[test] 密碼[test1]」。
    expect(hctMode('test')).toBe('test');
    // 🔴 承重:一個「看起來像測試」的帳號【不是】測試帳號 —— 只有字面 test 是。
    expect(hctMode('test2'), '模糊比對會把一個正式帳號讀成測試 ⇒ 員工以為沒送出去').toBe('live');
    expect(hctMode('TEST')).toBe('live');
    expect(hctMode('pcm-live')).toBe('live');
  });
});


// ══════════════════════════════════════════════════════════════════════════
// 🔴🔴 ⟦ship-HCTAPI⟧ 2026-09-05:外層形狀是【打出來的】—— 這一組守的是那個結論
// ══════════════════════════════════════════════════════════════════════════
describe('⟦ship-HCTAPI⟧ SOAP 信封與外層形狀(真回應當 fixture)', () => {
  it('🔴 送出去的是 SOAP, 不是純 JSON POST —— 而那是打出來的, 不是讀來的', async () => {
    let seen: RequestInit | undefined;
    const impl = ((_u: unknown, init?: RequestInit) => {
      seen = init;
      return Promise.resolve(soap(realRow({ ErrMsg: REAL.parsedThenFieldError })));
    }) as unknown as typeof fetch;
    openGates();
    await submitTransData(deps(impl), FIELDS);
    const headers = seen?.headers as Record<string, string>;
    expect(headers['Content-Type'], '不是 text/xml ⇒ 那個服務只講 SOAP').toContain('text/xml');
    expect(headers['SOAPAction']).toBe('"http://tempuri.org/TransData_Json"');
    const body = String(seen?.body);
    expect(body, '沒有 SOAP 信封').toContain('<soap:Envelope');
    // 🔴 三個參數名【全小寫】—— 2022 版 PDF 寫大寫 Company, 而那份是舊的。
    expect(body).toContain('<company>');
    expect(body, '大寫 Company 是舊 PDF 的字面, 服務描述是小寫').not.toContain('<Company>');
  });

  it('🎯 `json` 參數是【純陣列】, 不是 {"data":[…]} —— ①③ 回泛用拒絕而 ② 回欄位錯', async () => {
    let seen: RequestInit | undefined;
    const impl = ((_u: unknown, init?: RequestInit) => {
      seen = init;
      return Promise.resolve(soap(realRow({ ErrMsg: REAL.parsedThenFieldError })));
    }) as unknown as typeof fetch;
    openGates();
    await submitTransData(deps(impl), FIELDS);
    const body = String(seen?.body);
    const inner = /<json>([\s\S]*?)<\/json>/.exec(body)?.[1] ?? '';
    // 🔴 它是一段【JSON 字串】塞在 XML 裡 ⇒ 先還原 XML 跳脫再 parse。
    const parsed: unknown = JSON.parse(
      inner.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, '&'),
    );
    expect(Array.isArray(parsed), '外層必須是陣列 —— {"data":[…]} 那一版新竹回「資料錯誤請確認」').toBe(true);
    // ⛔ ~~expect(parsed).not.toHaveProperty('data')~~ —— codex must-fix ⑦:
    //    確認是陣列【之後】再斷言它沒有 `data` 屬性 **近乎恆真** ⇒ 那一格不承重。
    // ✅ 換成:它是一個【長度 1 且第一個元素就是我們那張單的欄位】的陣列。
    const arr = parsed as unknown[];
    expect(arr).toHaveLength(1);
    expect(arr[0]).toMatchObject({ epino: FIELDS.epino });
  });

  it('🔴 `soap:Fault`(信封層錯)不得被讀成「新竹拒絕了」', async () => {
    const f = fakeFetch(
      () =>
        new Response(
          '<?xml version="1.0"?><soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/"><soap:Body><soap:Fault><faultstring>Server was unable to process request.</faultstring></soap:Fault></soap:Body></soap:Envelope>',
          { status: 200, headers: { 'Content-Type': 'text/xml' } },
        ),
    );
    openGates();
    const out = await submitTransData(deps(f.impl), FIELDS);
    // 🎯 它與業務失敗【都回 200】⇒ 分不開的話, 「我們包錯了」會被讀成「新竹拒絕了」。
    expect(out.kind).toBe('unknown');
    expect(out.kind === 'unknown' ? out.reason : '').toBe('soap_fault');
  });

  it('🔵 XML 跳脫:地址裡的 & 與 < 不得把信封弄成 not-well-formed', async () => {
    let seen: RequestInit | undefined;
    const impl = ((_u: unknown, init?: RequestInit) => {
      seen = init;
      return Promise.resolve(soap(realRow({})));
    }) as unknown as typeof fetch;
    openGates();
    await submitTransData(
      { ...deps(impl), account: 'a&b', password: 'p<q' },
      FIELDS,
    );
    const body = String(seen?.body);
    expect(body).toContain('<company>a&amp;b</company>');
    expect(body).toContain('<password>p&lt;q</password>');
    // 🟢 負對照:沒跳脫的原字元不得出現在標籤之間。
    expect(body).not.toContain('<company>a&b</company>');
  });

  it('🔴 `queryEdelno` 送出去的東西也要被看一眼 —— 它的形狀【沒有量過】', async () => {
    // 📌 codex must-fix ⑦:`fakeFetch` 只記 url、完全忽略 request
    //    ⇒ 舊的 26 格裡, **query 的 payload 送什麼都會過**。
    // 🛑 而這一格【不宣稱那個形狀是對的】—— 它只釘住「我們今天送的是什麼」,
    //    好讓將來真的打過一發之後, 改動看得見。
    let seen: RequestInit | undefined;
    const impl = ((_u: unknown, init?: RequestInit) => {
      seen = init;
      return Promise.resolve(soap(realRow({ success: 'N', ErrMsg: '查無資料' }), 'QueryEDELNO_Json'));
    }) as unknown as typeof fetch;
    openGates();
    await queryEdelno(deps(impl), 'PCM-2026-0001');
    const headers = seen?.headers as Record<string, string>;
    expect(headers['SOAPAction']).toBe('"http://tempuri.org/QueryEDELNO_Json"');
    const inner = /<json>([\s\S]*?)<\/json>/.exec(String(seen?.body))?.[1] ?? '';
    // 🔴 它在 XML 裡 ⇒ 引號是 `&quot;` ⇒ 先還原再 parse(這一格我自己踩了一次)。
    const unesc = inner
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"')
      .replace(/&apos;/g, "'")
      .replace(/&amp;/g, '&');
    expect(JSON.parse(unesc)).toEqual([{ epino: 'PCM-2026-0001' }]);
  });

  it.each([
    ['Y 是【新增成功】', 'Y', 'submitted'],
    ['R 是【修改成功】—— 新竹那邊本來就有一張', 'R', 'amended'],
  ])('🔴 %s ⇒ kind = %s', async (_n, success, kind) => {
    // 🔴🔴 **這一格守的是「R 不是 Y」** —— 規格第 8 頁逐字
    //    「新竹貨號+訂單編號 -> 當日重複上傳, 視同【更正】資料內容」
    //    ⇒ 收到 R 代表**新竹那邊本來就有一張**, 而我們以為自己是第一次送
    //    ⇒ 📌 那是「我們的狀態與新竹不同步」的訊號, **不是一次成功**。
    //    🛑 而舊碼把兩者當同一件事 ⇒ 一張【被我們改掉的既有單】會被記成「送成功了」,
    //      而**沒有人會去看它到底改掉了什麼**。
    const f = fakeFetch(() => soap(realRow({ success, edelno: '1234567890', epino: FIELDS.epino })));
    openGates();
    const out = await submitTransData(deps(f.impl), FIELDS);
    expect(out.kind).toBe(kind);
  });

  it('🔴 回應講的是【別張單】⇒ unknown —— 不得把別人的成功記在我們頭上', async () => {
    const f = fakeFetch(() =>
      soap(realRow({ success: 'Y', edelno: '1234567890', epino: 'SOMEONE-ELSE' })),
    );
    openGates();
    const out = await submitTransData(deps(f.impl), FIELDS);
    expect(out.kind).toBe('unknown');
    expect(out.kind === 'unknown' ? out.reason : '').toBe('epino_mismatch');
  });

  it('🔴 回【多列】⇒ unknown —— 我們不知道哪一列在講這一箱, 而取第一列是在猜', async () => {
    const f = fakeFetch(() =>
      soap([
        ...realRow({ success: 'Y', edelno: '111', epino: FIELDS.epino }),
        ...realRow({ success: 'Y', edelno: '222', epino: FIELDS.epino }),
      ]),
    );
    openGates();
    const out = await submitTransData(deps(f.impl), FIELDS);
    expect(out.kind).toBe('unknown');
    expect(out.kind === 'unknown' ? out.reason : '').toBe('row_count_2');
  });

  it('🛑 認不得的 body ⇒ unknown, 不猜 —— 一個「盡力猜」的 parser 會把看不懂變成看起來懂', async () => {
    const f = fakeFetch(() => new Response('<html>維護中</html>', { status: 200 }));
    openGates();
    const out = await submitTransData(deps(f.impl), FIELDS);
    expect(out.kind).toBe('unknown');
    expect(out.kind === 'unknown' ? out.reason : '').toBe('body_not_soap_json');
  });
});
