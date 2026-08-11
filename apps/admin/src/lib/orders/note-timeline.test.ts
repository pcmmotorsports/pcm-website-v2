// note-timeline.test.ts — A10a-1 時間軸純函式(21 格突變 manifest = plan §4,測試名帶 [G*] 供 harness 錨定)。
//
// 🔴 時區判別力前提:本檔第一行把 process.env.TZ 釘成 UTC(2026-08-03 node 實測:UTC env 下
//    「掉 timeZone 的 formatter」輸出 16:30、釘 Asia/Taipei 的輸出翌日 00:30 ⇒ 分岔)。
//    不釘的話,本機(Asia/Taipei)跑 G10 突變會假綠 —— 掉 timeZone 後仍然渲染台北時間。
process.env.TZ = 'UTC';

import { describe, expect, it } from 'vitest';
import type { AdminOrderNote } from '@pcm/domain';
import { NOTE_CHANNELS, NOTE_TYPES } from './note-form';
import {
  CORRECTION_IRREVOCABLE_NOTICE,
  NOTE_CHANNEL_LABEL,
  NOTE_TYPE_LABEL,
  buildNoteTimeline,
  describeCustomerNotified,
  isNotesUnreadable,
  walkCorrectionChain,
} from './note-timeline';

/** fixture:預設 internal(channel/occurredAt 皆 null = DB 配對規則的合法形)。 */
const note = (over: Partial<AdminOrderNote> & Pick<AdminOrderNote, 'id'>): AdminOrderNote => ({
  noteType: 'internal',
  body: '內容',
  channel: null,
  occurredAt: null,
  author: 'sean',
  correctsNoteId: null,
  createdAt: '2026-08-01T00:00:00+00:00',
  corrected: false,
  ...over,
});

/** 兄弟檔慣例的變形:取第一列(noUncheckedIndexedAccess 環境;查無直接炸,不靜默 undefined)。 */
const pickFirst = <T,>(arr: readonly T[]): T => {
  const v = arr[0];
  if (v === undefined) throw new Error('entries 空,向量壞了');
  return v;
};

describe('buildNoteTimeline — 序號與順序', () => {
  // 🔴 三列、id 序非單調(關卡2 R1 MF1):兩列反序向量殺得掉升冪重排、殺不掉降冪重排
  //    (降冪恰等於輸入序)。['mm','zz','aa'] 的升冪 [aa,mm,zz] 與降冪 [zz,mm,aa] 都 ≠ 輸入序。
  it('[G1][G2] seq 依輸入序 1 起編;本模組不重排(排序權威在 mapper)', () => {
    const view = buildNoteTimeline({
      notes: [note({ id: 'mm-middle' }), note({ id: 'zz-later' }), note({ id: 'aa-earlier' })],
      notesTruncated: false,
    });
    expect(view.entries.map((e) => e.id)).toEqual(['mm-middle', 'zz-later', 'aa-earlier']);
    expect(view.entries.map((e) => e.seq)).toEqual([1, 2, 3]);
  });
});

describe('buildNoteTimeline — 更正標記兩個方向', () => {
  // A(n1)被 B(n2)更正;C(n3)更正一筆不在已載入集合的 ghost。
  const notes = [
    note({ id: 'n1', corrected: true }),
    note({ id: 'n2', correctsNoteId: 'n1' }),
    note({ id: 'n3', correctsNoteId: 'ghost' }),
  ];
  const entries = buildNoteTimeline({ notes, notesTruncated: true }).entries;
  const [a, b, c] = [entries[0]!, entries[1]!, entries[2]!]; // 兄弟檔慣例:測試內 non-null 斷言取項

  it('[G4] corrected 是「被指向」不是「有指向」—— 兩個方向同時斷言', () => {
    expect(a.corrected).toBe(true);
    expect(b.corrected).toBe(false); // B 是更正者,自己沒被更正
    expect(a.corrects).toBe(null); // A 沒更正別人
    expect(b.corrects).toEqual({ targetId: 'n1', targetSeq: 1 });
  });

  it('[G3] canCorrect:已被更正列 disable、其餘啟用(契約 C5 partial unique)', () => {
    expect(a.canCorrect).toBe(false);
    expect(b.canCorrect).toBe(true);
    expect(c.canCorrect).toBe(true);
  });

  it('[G5] correctedBySeq:被更正列指回更正者的 seq;未被更正列 = null', () => {
    expect(a.correctedBySeq).toBe(2);
    expect(b.correctedBySeq).toBe(null);
  });

  it('[G6] 更正目標不在已載入集合 ⇒ targetSeq 嚴格 null(不是 0、不是 undefined)', () => {
    expect(c.corrects).not.toBe(null);
    expect(c.corrects?.targetId).toBe('ghost');
    expect(c.corrects?.targetSeq).toBe(null);
  });

  it('[G13] truncated 透傳(兩個方向都釘,恆 true/恆 false 的突變都殺得掉)', () => {
    expect(buildNoteTimeline({ notes, notesTruncated: true }).truncated).toBe(true);
    expect(buildNoteTimeline({ notes: [], notesTruncated: false }).truncated).toBe(false);
  });
});

describe('buildNoteTimeline — 欄位與格式化', () => {
  it('[G7] internal:channelLabel 與 occurredAtDisplay 恆 null', () => {
    const entry = pickFirst(buildNoteTimeline({
      notes: [note({ id: 'n1' })],
      notesTruncated: false,
    }).entries);
    expect(entry.typeLabel).toBe(NOTE_TYPE_LABEL.internal);
    expect(entry.channelLabel).toBe(null);
    expect(entry.occurredAtDisplay).toBe(null);
    // [G18][G19] raw enum 透傳(白天半片篩選/上色用;與 [G9] 的不同值成對,硬編碼必死一邊)
    expect(entry.noteType).toBe('internal');
    expect(entry.channel).toBe(null);
  });

  // 🔴 兩欄餵「不同日、不同時分」的時刻:occurredAt 誤接 createdAt(G9)時兩條斷言都紅。
  it('[G9] occurredAt 與 createdAt 各自格式化、互不錯接', () => {
    const entry = pickFirst(buildNoteTimeline({
      notes: [
        note({
          id: 'n1',
          noteType: 'contact_log',
          channel: 'phone',
          occurredAt: '2026-03-10T02:00:00+00:00', // 台北 2026-03-10 10:00
          createdAt: '2026-03-11T05:30:00+00:00', // 台北 2026-03-11 13:30(補登:隔天才記)
        }),
      ],
      notesTruncated: false,
    }).entries);
    expect(entry.channelLabel).toBe(NOTE_CHANNEL_LABEL.phone);
    expect(entry.occurredAtDisplay).toBe('2026-03-10 10:00');
    expect(entry.createdAtDisplay).toBe('2026-03-11 13:30');
    // [G18][G19] 與 internal 測試成對的另一組值
    expect(entry.noteType).toBe('contact_log');
    expect(entry.channel).toBe('phone');
  });

  // 🔴 選跨日邊界時刻:UTC 16:30 = 台北翌日 00:30。TZ=UTC 下,掉 timeZone 的突變(G10)
  //    會輸出 '2026-01-15 16:30' ⇒ 紅。
  it('[G10] 時區釘死 Asia/Taipei(跨日邊界向量)', () => {
    // 🔴 前提自證(關卡2 R1 nit2):檔頭的 TZ=UTC 若在某天的 pool/平台下沒生效,
    //    本格會靜默失去判別力(真碼自己釘 Taipei 照樣綠)⇒ 先斷言前提再斷言行為。
    expect(Intl.DateTimeFormat().resolvedOptions().timeZone).toBe('UTC');
    const entry = pickFirst(buildNoteTimeline({
      notes: [note({ id: 'n1', createdAt: '2026-01-15T16:30:00Z' })],
      notesTruncated: false,
    }).entries);
    expect(entry.createdAtDisplay).toBe('2026-01-16 00:30');
  });

  it('[G11] 解析不出的時間字面原樣返回(DB 腐壞不顯示 Invalid Date)', () => {
    const entry = pickFirst(buildNoteTimeline({
      notes: [note({ id: 'n1', createdAt: 'not-a-timestamp' })],
      notesTruncated: false,
    }).entries);
    expect(entry.createdAtDisplay).toBe('not-a-timestamp');
  });

  it('[G8] body 逐字轉交(前導/尾隨空白與非 BMP 字元都不動)', () => {
    const body = '  前導空白🏍️尾空白  ';
    const entry = pickFirst(buildNoteTimeline({
      notes: [note({ id: 'n1', body })],
      notesTruncated: false,
    }).entries);
    expect(entry.body).toBe(body);
  });
});

describe('describeCustomerNotified — 三態(契約 C4)', () => {
  it('[G12] null = unknown,與 false 是不同態(?? false 的突變殺手)', () => {
    const unknown = describeCustomerNotified(null, false);
    const notNotified = describeCustomerNotified(false, false);
    const notified = describeCustomerNotified(true, false);
    expect(unknown.state).toBe('unknown');
    expect(notNotified.state).toBe('not_notified');
    expect(notified.state).toBe('notified');
    expect(unknown.state).not.toBe(notNotified.state);
    expect(unknown.label).not.toBe(notNotified.label);
  });
});

describe('#328 isNotesUnreadable —— 兩種 null 要分得開', () => {
  // 🔴 為什麼需要這個判別式:`customerNotified === null` 有兩個成因,而**員工的下一步不同** ——
  //    截斷要去看更早的紀錄,讀取失敗要重新整理 / 通知維護。共用一句文案就會把人帶錯路。
  it('🔴 null + 未截斷 = 讀取失敗(整段沒讀到)', () => {
    expect(isNotesUnreadable({ customerNotified: null, notesTruncated: false })).toBe(true);
  });

  it('🔴 null + 已截斷 = 截斷,不是讀取失敗', () => {
    // 突變:把判別式寫成「只看 customerNotified === null」⇒ 這格紅(截斷會被誤報成讀取失敗)。
    expect(isNotesUnreadable({ customerNotified: null, notesTruncated: true })).toBe(false);
  });

  it('🔴 非 null 一律不是讀取失敗(兩個值都試)', () => {
    // 突變:把判別式寫成「只看 !notesTruncated」⇒ 這格紅(每一張正常單都會顯示讀取失敗)。
    expect(isNotesUnreadable({ customerNotified: false, notesTruncated: false })).toBe(false);
    expect(isNotesUnreadable({ customerNotified: true, notesTruncated: false })).toBe(false);
  });

  it('🔴 unknown 的兩種文案必須不同,而且各自講對「下一步」', () => {
    const unreadable = describeCustomerNotified(null, true);
    const truncated = describeCustomerNotified(null, false);
    expect(unreadable.state).toBe('unknown');
    expect(truncated.state).toBe('unknown');
    // 同一個 state、不同的話 —— 只比 state 的測試對這條 bug 全盲。
    expect(unreadable.label).not.toBe(truncated.label);
    expect(unreadable.label).toContain('讀取失敗');
    // 🔴 反向:讀取失敗那句**不可以**沿用「超過載入上限」——那是假的,且會叫員工去找不存在的舊紀錄。
    expect(unreadable.label).not.toContain('載入上限');
    expect(truncated.label).toContain('載入上限');
  });
});

describe('標籤表與文案常數', () => {
  it('[G16] 標籤值全部非空且互不相同(兩型別共用一個字 = 員工分不出)', () => {
    for (const table of [NOTE_TYPE_LABEL, NOTE_CHANNEL_LABEL]) {
      const values = Object.values(table);
      expect(values.every((v) => v.length > 0)).toBe(true);
      expect(new Set(values).size).toBe(values.length);
    }
  });

  // 文案字面待 Sean 潤稿 ⇒ 只釘語意錨點,不逐字釘(plan §5;本條無突變格)。
  it('更正不可撤回文案含三個不可刪的語意錨點', () => {
    expect(CORRECTION_IRREVOCABLE_NOTICE).toContain('不可撤回');
    // 🔴 R1 nit10:toContain('恢復') 擋不住語意反轉(「會讓…恢復」也含這兩字)⇒ 釘否定詞連結
    expect(CORRECTION_IRREVOCABLE_NOTICE).toMatch(/不會[^。]*恢復/);
    expect(CORRECTION_IRREVOCABLE_NOTICE).toContain('重新登記');
  });

  // 🔴 R1 nit11:note-form 的值域清單與本檔標籤表是兩份清單,今天相同、明天沒人守
  //    ⇒ 集合相等釘死(白天表單用 NOTE_TYPES 產 option、用 NOTE_TYPE_LABEL 取字,缺一邊就出無標籤值)。
  it('[G20] 標籤表鍵集合 = note-form 值域清單(兩份清單不准漂移)', () => {
    expect(new Set(Object.keys(NOTE_TYPE_LABEL))).toEqual(new Set(NOTE_TYPES));
    expect(new Set(Object.keys(NOTE_CHANNEL_LABEL))).toEqual(new Set(NOTE_CHANNELS));
  });
});

describe('walkCorrectionChain — 四種停止原因(契約 C3)', () => {
  const chain = [
    note({ id: 'a' }),
    note({ id: 'b', correctsNoteId: 'a' }),
    note({ id: 'c', correctsNoteId: 'b' }),
  ];

  it('走到鏈尾:C→B→A,stop=end', () => {
    expect(walkCorrectionChain('c', chain)).toEqual({ chainIds: ['b', 'a'], stop: 'end' });
  });

  it('指向不在已載入集合:stop=missing、含 dangling id(截斷情境)', () => {
    const notes = [note({ id: 'b', correctsNoteId: 'ghost' })];
    expect(walkCorrectionChain('b', notes)).toEqual({ chainIds: ['ghost'], stop: 'missing' });
  });

  it('[G17] 起點查無:stop=missing、chainIds 空', () => {
    expect(walkCorrectionChain('nope', chain)).toEqual({ chainIds: [], stop: 'missing' });
  });

  // 🔴 環在應用路徑構造不出來(A6 單列 INSERT);這是 owner 手寫入的腐壞情境(建表檔 :186-195)。
  //    G14(移除 visited)後這條不會掛死 —— 深度閘會接住 —— 但 stop 會變 'depth' ⇒ 紅在此。
  it('[G14] 互指成環:stop=cycle(顯性回報腐壞,不靜默截短)', () => {
    const corrupt = [note({ id: 'a', correctsNoteId: 'b' }), note({ id: 'b', correctsNoteId: 'a' })];
    expect(walkCorrectionChain('a', corrupt)).toEqual({ chainIds: ['b', 'a'], stop: 'cycle' });
  });

  it('[G15] 深度上限:maxDepth=1 對三列直鏈,stop=depth(移除深度閘 ⇒ 變 end ⇒ 紅)', () => {
    expect(walkCorrectionChain('c', chain, 1)).toEqual({ chainIds: ['b'], stop: 'depth' });
  });
});
