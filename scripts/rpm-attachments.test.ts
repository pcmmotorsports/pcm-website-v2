// rpm-attachments.test.ts — 說明書標籤改吃 doc_type(合約 v5)+ 影片挑選(自 rpm-transform 搬移)
//
// 合約來源:docs/handoff/2026-08-07-f-line-attachments-final-handoff.md §2/§3。
// 🔴 這組測試釘的是「只看 doc_type」:type_id 不得影響任何標籤(它只有 akrapovic 有值,
//    拿它判種類會讓五家七千多份說明書全變通稱 —— 比錯標更糟)。

import { describe, it, expect } from 'vitest';
import { normalizeManuals, normalizeSoundClips, pickInstallVideo, filenameLabelOf, isHttpUrl } from './rpm-attachments';

const NUM = { appendFilename: false }; // akrapovic 型:同類多份用編號
const FILE = { appendFilename: true }; // gbracing / evotech 型:同類多份接檔名

describe('normalizeManuals — doc_type → 三中文名(合約 v5 §2)', () => {
  it('三值各自對到中文名', () => {
    const docs = [
      { doc_type: 'install', url: 'https://x.com/a.pdf' },
      { doc_type: 'parts_diagram', url: 'https://x.com/b.pdf' },
      { doc_type: 'other', url: 'https://x.com/c.pdf' },
    ];
    expect(normalizeManuals(docs, NUM).map((m) => m.label)).toEqual(['安裝說明書', '零件分解圖', '文件']);
  });

  it('🔴 過渡期:doc_type 缺 / null → 視為 install(不得整列 reject、維持現狀)', () => {
    // 2026-08-08 實查:akrapovic 635 列的 pdf_docs 只有 {url,type_id}、無 doc_type 鍵
    expect(normalizeManuals([{ url: 'https://x.com/a.pdf', type_id: 90 }], NUM)[0]!.label).toBe('安裝說明書');
    expect(normalizeManuals([{ doc_type: null, url: 'https://x.com/a.pdf' }], NUM)[0]!.label).toBe('安裝說明書');
  });

  it('🔴 只看 doc_type:type_id 不同不影響標籤(合約紅線,拿 type_id 判種類會全變通稱)', () => {
    const docs = [
      { doc_type: 'install', type_id: 87, url: 'https://x.com/a.pdf' },
      { doc_type: 'install', type_id: 106, url: 'https://x.com/b.pdf' },
      { doc_type: 'install', type_id: null, url: 'https://x.com/c.pdf' },
    ];
    expect(normalizeManuals(docs, NUM).map((m) => m.label)).toEqual([
      '安裝說明書 1', '安裝說明書 2', '安裝說明書 3',
    ]);
  });

  it('🔴 未知 doc_type → 落「文件」而非「安裝說明書」(fail-safe:不把雜項冒充成客人要的東西)', () => {
    expect(normalizeManuals([{ doc_type: 'certificate', url: 'https://x.com/a.pdf' }], NUM)[0]!.label).toBe('文件');
  });

  it('🔴 doc_type 取到原型鏈成員不得變成標籤(constructor / toString / __proto__)', () => {
    // 用物件字面當對照表時 `LABEL[doc.doc_type]` 會取到函式且 truthy → 標籤變 "function Object()…"
    for (const evil of ['constructor', 'toString', '__proto__', 'hasOwnProperty']) {
      expect(normalizeManuals([{ doc_type: evil, url: 'https://x.com/a.pdf' }], NUM)[0]!.label).toBe('文件');
    }
  });
});

describe('normalizeManuals — 同類多份的區分(合約 v5 §3)', () => {
  it('🔴 編號是「同類內」的事,不是全群連號', () => {
    const docs = [
      { doc_type: 'install', url: 'https://x.com/a.pdf' },
      { doc_type: 'install', url: 'https://x.com/b.pdf' },
      { doc_type: 'parts_diagram', url: 'https://x.com/c.pdf' },
    ];
    expect(normalizeManuals(docs, NUM).map((m) => m.label)).toEqual([
      '安裝說明書 1', '安裝說明書 2', '零件分解圖', // 分解圖只有一份 → 不編號
    ]);
  });

  it('單份不編號', () => {
    expect(normalizeManuals([{ doc_type: 'install', url: 'https://x.com/a.pdf' }], NUM)[0]!.label).toBe('安裝說明書');
  });

  it('🔴 appendFilename=true(gbracing/evotech):標籤後括號接檔名', () => {
    const docs = [
      { doc_type: 'install', url: 'https://www.gbracing.eu/files//4e0e2479-a843/1198 2007-2013.pdf' },
      { doc_type: 'install', url: 'https://www.gbracing.eu/files//89170943-758f/M Paddock Stand Bobbins ALL.pdf' },
    ];
    expect(normalizeManuals(docs, FILE).map((m) => m.label)).toEqual([
      '安裝說明書(1198 2007-2013)',
      '安裝說明書(M Paddock Stand Bobbins ALL)',
    ]);
  });

  it("evotech S3 檔名的 '+' 當空白、%XX 解碼", () => {
    const docs = [
      { doc_type: 'install', url: 'https://evotech.s3.eu-west-2.amazonaws.com/i/015396+triumph+trident+tail+tidy.pdf' },
      { doc_type: 'install', url: 'https://cdn.shopify.com/s/files/014169_bmw%20r%20ninet.pdf?v=1759763071' },
    ];
    expect(normalizeManuals(docs, FILE).map((m) => m.label)).toEqual([
      '安裝說明書(015396 triumph trident tail tidy)',
      '安裝說明書(014169_bmw r ninet)', // query string 不進標籤
    ]);
  });

  it('🔴 appendFilename 模式:同檔名不同存放路徑 → 只留一項(同群多變體常見,否則客人看到重複列)', () => {
    const docs = [
      { doc_type: 'install', url: 'https://www.gbracing.eu/files//aaa/Paddock Stand Bobbins ALL.pdf' },
      { doc_type: 'install', url: 'https://www.gbracing.eu/files//bbb/Paddock Stand Bobbins ALL.pdf' },
    ];
    expect(normalizeManuals(docs, FILE)).toEqual([
      { label: '安裝說明書(Paddock Stand Bobbins ALL)', url: 'https://www.gbracing.eu/files//aaa/Paddock Stand Bobbins ALL.pdf' },
    ]);
  });

  it('🔴 同檔名但不同類 → 兩項都留(去重是同標籤,不是同檔名)', () => {
    const docs = [
      { doc_type: 'install', url: 'https://x.com/a/m.pdf' },
      { doc_type: 'parts_diagram', url: 'https://x.com/b/m.pdf' },
    ];
    expect(normalizeManuals(docs, FILE).map((m) => m.label)).toEqual([
      '安裝說明書(m)', '零件分解圖(m)',
    ]);
  });

  it('appendFilename=true 但取不出檔名 → 退回編號、不吐空括號', () => {
    const docs = [
      { doc_type: 'install', url: 'https://x.com/' },
      { doc_type: 'install', url: 'https://x.com/?a=1' },
    ];
    expect(normalizeManuals(docs, FILE).map((m) => m.label)).toEqual(['安裝說明書 1', '安裝說明書 2']);
  });

  it('🔴 akrapovic 走編號不接檔名(檔名是 GUID,接了會變「安裝說明書(ffdd4e47-…)」)', () => {
    const docs = [
      { doc_type: 'install', type_id: 90, url: 'https://d1s.net/Documents/38/bb91e3d04ea243ed989f8a2d6f8c3304.pdf' },
      { doc_type: 'install', type_id: 93, url: 'https://d1s.net/Documents/38/f1e8c74c4ae746328d7cc8c8cf0b05fa.pdf' },
    ];
    const labels = normalizeManuals(docs, NUM).map((m) => m.label);
    expect(labels).toEqual(['安裝說明書 1', '安裝說明書 2']);
    expect(labels.join('')).not.toContain('bb91e3d0');
  });
});

describe('normalizeManuals — 髒值與去重', () => {
  it('依 URL 去重保序(同群多變體常帶重複 URL)', () => {
    const docs = [
      { doc_type: 'install', url: 'https://x.com/a.pdf' },
      { doc_type: 'install', url: 'https://x.com/a.pdf' },
      { doc_type: 'install', url: 'https://x.com/b.pdf' },
    ];
    expect(normalizeManuals(docs, NUM).map((m) => m.url)).toEqual(['https://x.com/a.pdf', 'https://x.com/b.pdf']);
  });

  it('濾非 http(s) 與無 host(擋 javascript: 注入、與 UI 白名單雙層)', () => {
    const docs = [
      { doc_type: 'install', url: 'javascript:alert(1)' },
      { doc_type: 'install', url: 'ftp://x/a.pdf' },
      { doc_type: 'install', url: 'https://' },
      { doc_type: 'install', url: 'https://x.com/a.pdf' },
    ];
    expect(normalizeManuals(docs, NUM)).toEqual([{ label: '安裝說明書', url: 'https://x.com/a.pdf' }]);
  });

  it('元素 null / 缺 url / url 非字串 → 跳過不 throw', () => {
    const docs = [null, undefined, {} as never, { url: 123 as unknown as string }, { doc_type: 'install', url: 'https://x.com/a.pdf' }];
    expect(normalizeManuals(docs, NUM)).toEqual([{ label: '安裝說明書', url: 'https://x.com/a.pdf' }]);
  });

  it('空輸入 → []', () => {
    expect(normalizeManuals([], NUM)).toEqual([]);
    expect(normalizeManuals([], FILE)).toEqual([]);
  });
});

describe('filenameLabelOf / isHttpUrl(helper 直測)', () => {
  it('去 .pdf 副檔名(大小寫皆可)、去路徑、去 query', () => {
    expect(filenameLabelOf('https://x.com/a/b/My File.PDF?v=1')).toBe('My File');
  });
  it('壞 URL / 無路徑 → 空字串(不 throw)', () => {
    expect(filenameLabelOf('not a url')).toBe('');
    expect(filenameLabelOf('https://x.com/')).toBe('');
  });
  it('壞 %XX 序列 → 回空字串(不只是「不 throw」;Fable 對抗審 N3)', () => {
    // 只斷言 not.toThrow 沒有判別力:把 catch 改成「回未解碼的原字串」照樣綠,
    // 但標籤會變成「安裝說明書(%E0%A4%A)」端到客人臉上。要斷言回空 ⇒ 上層退回編號。
    expect(() => filenameLabelOf('https://x.com/%E0%A4%A.pdf')).not.toThrow();
    expect(filenameLabelOf('https://x.com/%E0%A4%A.pdf')).toBe('');
    expect(normalizeManuals([{ doc_type: 'install', url: 'https://x.com/%E0%A4%A.pdf' }], FILE)[0]!.label).toBe(
      '安裝說明書',
    );
  });
  it('isHttpUrl:http/https 且有 host 才過', () => {
    expect(isHttpUrl('https://x.com/a')).toBe(true);
    expect(isHttpUrl('http://x.com/a')).toBe(true);
    expect(isHttpUrl('https://')).toBe(false);
    expect(isHttpUrl('javascript:alert(1)')).toBe(false);
  });
});

describe('normalizeSoundClips — 排氣聲浪(片 3a;Sean 08-08 拍 Q25=A 存原文)', () => {
  it('🔴 title 存**英文原文原樣**,不中文化、不改字面', () => {
    // Sean 08-08 Q25=A:719 段實測 112 種型別詞、260 段(36%)塞不進交接檔說的三個中文值,
    // 硬壓會讓 14 群撞名 ⇒ DB 存原文(可逆),中文化留給顯示層(片 3b)。
    const src = [
      { title: 'Stock exhaust; BMW S 1000 RR', url: 'https://d1s.net/a.wav' },
      { title: 'Complete; APRILIA TUAREG 660', url: 'https://d1s.net/b.wav' },
      { title: 'Slip-On wo insert', url: 'https://d1s.net/c.mp3' },
    ];
    expect(normalizeSoundClips(src).map((c) => c.title)).toEqual([
      'Stock exhaust; BMW S 1000 RR', 'Complete; APRILIA TUAREG 660', 'Slip-On wo insert',
    ]);
  });

  it('🔴 無標題段回 title:null,**不在管線塞「聲音檔 N」**(那是顯示層的中性 fallback)', () => {
    // 在管線塞會讓「真的沒標題」與「標題就叫聲音檔 1」永久無法分辨;實測約 3.8% 段落無標題。
    const src = [
      { title: null, url: 'https://d1s.net/a.wav' },
      { url: 'https://d1s.net/b.wav' }, // 連 key 都沒有
      { title: 123 as unknown as string, url: 'https://d1s.net/c.wav' }, // 非字串
    ];
    expect(normalizeSoundClips(src)).toEqual([
      { title: null, url: 'https://d1s.net/a.wav' },
      { title: null, url: 'https://d1s.net/b.wav' },
      { title: null, url: 'https://d1s.net/c.wav' },
    ]);
  });

  it('依 URL 去重保序(群級彙整跨變體)', () => {
    const src = [
      { title: 'A', url: 'https://d1s.net/a.wav' },
      { title: 'A 重複', url: 'https://d1s.net/a.wav' }, // 同 URL → 保留先到的那筆
      { title: 'B', url: 'https://d1s.net/b.wav' },
    ];
    expect(normalizeSoundClips(src)).toEqual([
      { title: 'A', url: 'https://d1s.net/a.wav' },
      { title: 'B', url: 'https://d1s.net/b.wav' },
    ]);
  });

  it('🔴 濾非 http(s) 與無 host(擋 javascript: 注入 —— 音檔 URL 會被前台餵給 <audio src>)', () => {
    const src = [
      { title: 'x', url: 'javascript:alert(1)' },
      { title: 'x', url: 'ftp://x/a.wav' },
      { title: 'x', url: 'https://' },
      { title: 'x', url: 'file:///tmp/a.wav' },
      { title: 'ok', url: 'https://d1s.net/a.wav' },
    ];
    expect(normalizeSoundClips(src)).toEqual([{ title: 'ok', url: 'https://d1s.net/a.wav' }]);
  });

  it('元素 null / 缺 url / url 非字串 → 跳過不 throw;空輸入 → []', () => {
    const src = [null, undefined, {} as never, { url: 5 as unknown as string }, { title: 'ok', url: 'https://d1s.net/a.wav' }];
    expect(normalizeSoundClips(src)).toEqual([{ title: 'ok', url: 'https://d1s.net/a.wav' }]);
    expect(normalizeSoundClips([])).toEqual([]);
  });

  it('title 原樣保留前後空白與分號逗號冒號三種分隔符(不 trim、不切段)', () => {
    // 實測分隔符:分號 623 / 逗號 37 / 無分隔 32,另有冒號型;切段是顯示層的事,管線不動字面
    const src = [{ title: '  Stock: HONDA CBR1000RR-R  ', url: 'https://d1s.net/a.wav' }];
    expect(normalizeSoundClips(src)[0]!.title).toBe('  Stock: HONDA CBR1000RR-R  ');
  });
});

// ── pickInstallVideo:自 rpm-transform.test.ts 原樣搬移(行為未改、只換檔案位置)──
describe('pickInstallVideo(裸 URL → 第一支可解析的 youtube/vimeo/影片直檔)', () => {
  const YT = 'https://youtu.be/dQw4w9WgXcQ'; // 11 碼合法 id
  it('取能解析的 YouTube(youtube.com watch / youtu.be)', () => {
    expect(pickInstallVideo(['https://youtube.com/watch?v=dQw4w9WgXcQ'])).toBe('https://youtube.com/watch?v=dQw4w9WgXcQ');
    expect(pickInstallVideo([YT])).toBe(YT);
  });
  it('www. 前綴 normalize(與 UI parseYoutubeId 對齊、避免 www.youtu.be false-negative)', () => {
    expect(pickInstallVideo(['https://www.youtube.com/watch?v=dQw4w9WgXcQ'])).toBe('https://www.youtube.com/watch?v=dQw4w9WgXcQ');
    expect(pickInstallVideo(['https://www.youtu.be/dQw4w9WgXcQ'])).toBe('https://www.youtu.be/dQw4w9WgXcQ');
  });
  it('Vimeo 可解析(vimeo.com/<數字> / player.vimeo.com/video/<數字>)', () => {
    expect(pickInstallVideo(['https://vimeo.com/123456'])).toBe('https://vimeo.com/123456');
    expect(pickInstallVideo(['https://player.vimeo.com/video/123456'])).toBe('https://player.vimeo.com/video/123456');
    expect(pickInstallVideo(['https://www.vimeo.com/123456'])).toBe('https://www.vimeo.com/123456');
  });
  it('影片直檔可解析(副檔名白名單)、白名單外網頁 URL 跳過', () => {
    const MP4 = 'https://cdn.shopify.com/videos/c/o/v/abc123.mp4';
    expect(pickInstallVideo([MP4])).toBe(MP4);
    expect(pickInstallVideo(['https://x.s3.eu-west-2.amazonaws.com/v.MP4?sig=1'])).toBe(
      'https://x.s3.eu-west-2.amazonaws.com/v.MP4?sig=1',
    );
    expect(pickInstallVideo(['https://example.com/page.html', MP4])).toBe(MP4);
  });
  it('多支混合 → 取第一支可解析', () => {
    expect(pickInstallVideo(['https://vimeo.com/1', YT])).toBe('https://vimeo.com/1');
    expect(pickInstallVideo(['https://example.com/', YT, 'https://vimeo.com/123456'])).toBe(YT);
  });
  it('🔴 host 符合但無 id(頻道/播放清單/短 id/非數字 vimeo 路徑)→ 跳過續試下一支', () => {
    expect(pickInstallVideo(['https://youtube.com/channel/UC1234ABCD', YT])).toBe(YT);
    expect(pickInstallVideo(['https://www.youtube.com/@brandname'])).toBeNull();
    expect(pickInstallVideo(['https://youtu.be/ab12'])).toBeNull();
    expect(pickInstallVideo(['https://vimeo.com/channels/staffpicks'])).toBeNull();
  });
  it('全空 / 壞 URL / 偽裝 scheme → null(不 throw)', () => {
    expect(pickInstallVideo([])).toBeNull();
    expect(pickInstallVideo([null, '', 'not a url'])).toBeNull();
    expect(pickInstallVideo(['javascript://youtu.be/dQw4w9WgXcQ'])).toBeNull();
    expect(pickInstallVideo(['javascript://vimeo.com/123456'])).toBeNull();
    expect(pickInstallVideo(['file:///tmp/x.mp4'])).toBeNull();
  });
});
