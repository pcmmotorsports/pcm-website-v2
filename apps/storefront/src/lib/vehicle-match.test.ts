// vehicle-match 單測(V-1b 比對核心;REQUIRED-2 正規化規格)。

import { describe, it, expect } from 'vitest';
import {
  normalizeVehicleQuery,
  looseVehicleKey,
  filterVehicleOptions,
  uniqueExactMatch,
} from './vehicle-match';

const BRANDS = [{ name: 'Yamaha' }, { name: 'Kawasaki' }, { name: 'KTM' }, { name: 'Kymco' }];
const nameOf = (b: { name: string }) => b.name;

describe('normalizeVehicleQuery', () => {
  it('trim+小寫+全形→半形(NFKC);不動內容字面以外的東西', () => {
    expect(normalizeVehicleQuery('  Ya ')).toBe('ya');
    expect(normalizeVehicleQuery('ＹＡＭＡＨＡ')).toBe('yamaha');
    expect(normalizeVehicleQuery('ｒ６')).toBe('r6');
  });
});

describe('filterVehicleOptions — prefix 優先、substring 殿後、字典字面直出', () => {
  it('ya → Yamaha(prefix);k → Kawasaki/KTM/Kymco 保序', () => {
    expect(filterVehicleOptions(BRANDS, 'ya', nameOf).map(nameOf)).toEqual(['Yamaha']);
    expect(filterVehicleOptions(BRANDS, 'k', nameOf).map(nameOf)).toEqual([
      'Kawasaki',
      'KTM',
      'Kymco',
    ]);
  });

  it('substring 命中排 prefix 之後;空查詢=全清單;全形查詢可命中', () => {
    const models = [{ name: 'MT-09 SP' }, { name: 'SP-9' }];
    expect(filterVehicleOptions(models, 'sp', nameOf).map(nameOf)).toEqual(['SP-9', 'MT-09 SP']);
    expect(filterVehicleOptions(BRANDS, '', nameOf)).toHaveLength(4);
    expect(filterVehicleOptions(BRANDS, 'ＹＡ', nameOf).map(nameOf)).toEqual(['Yamaha']);
  });

  it('查無 → 空陣列(不猜、不模糊)', () => {
    expect(filterVehicleOptions(BRANDS, 'zzz', nameOf)).toEqual([]);
  });
});

describe('uniqueExactMatch — 唯一精確命中才回(REQUIRED-2 自動套用條件)', () => {
  it('正規化全等恰一 → 回原字面物件;prefix 命中不算', () => {
    expect(uniqueExactMatch(BRANDS, 'yamaha', nameOf)?.name).toBe('Yamaha');
    expect(uniqueExactMatch(BRANDS, 'ＹＡＭＡＨＡ ', nameOf)?.name).toBe('Yamaha');
    expect(uniqueExactMatch(BRANDS, 'ya', nameOf)).toBeNull();
  });

  it('0 或多個全等 → null;空查詢 → null', () => {
    const dup = [{ name: 'R6' }, { name: 'r6' }];
    expect(uniqueExactMatch(dup, 'R6', nameOf)).toBeNull();
    expect(uniqueExactMatch(BRANDS, '', nameOf)).toBeNull();
  });
});

// ── 2026-08-08 空格不敏感比對(Sean:打「RS6」要找得到「RS 660」)────────────────────
//
// 🔴 本族的重點有一半在**反面**:寬鬆只准出現在「打字過濾」這一層。
//    同樣的寬鬆放進 `normalizeVehicleQuery`,會讓 taxonomy 把兩台車折成一台、
//    讓 PDP 做出**假的「✓ 適用」**(codex MF-1 修過的東西;見 `looseVehicleKey` 註解)。
const RS = [{ name: 'RS 660' }, { name: 'RSV4' }];
const GSX = [{ name: 'GSX-8S' }, { name: 'GSX-R1000' }];

describe('looseVehicleKey — 只給打字過濾用的寬鬆鍵', () => {
  // 突變:`.replace(/[\s-]+/g, '')` 拿掉 ⇒ 只紅這族與下面的過濾格
  it('去空白與連字號、其餘沿用 normalizeVehicleQuery(NFKC/trim/小寫)', () => {
    expect(looseVehicleKey('RS 660')).toBe('rs660');
    expect(looseVehicleKey('GSX-8S')).toBe('gsx8s');
    expect(looseVehicleKey('  ＭＴ－０９  ')).toBe('mt09'); // 全形也要先被 NFKC 折平
  });

  // 只去這兩種分隔符,不多不少(plan §3-2:多去一個字元就多一分誤命中)
  it('不去 . / + 等其他字元', () => {
    expect(looseVehicleKey('F.850 GS')).toBe('f.850gs');
    expect(looseVehicleKey('S1000 R/RR')).toBe('s1000r/rr');
  });
});

describe('filterVehicleOptions 寬鬆化 — Sean 的原始需求', () => {
  // 突變:filterVehicleOptions 改回吃 normalizeVehicleQuery ⇒ 只紅這兩條
  it('🔴 RS6 → 命中 RS 660(現況要打「RS 6」才找得到)', () => {
    expect(filterVehicleOptions(RS, 'RS6', nameOf).map(nameOf)).toEqual(['RS 660']);
  });

  it('🔴 gsx8 → 命中 GSX-8S(連字號那半)', () => {
    expect(filterVehicleOptions(GSX, 'gsx8', nameOf).map(nameOf)).toEqual(['GSX-8S']);
  });

  it('既有行為不回歸:prefix 仍優先於 substring、空查詢仍回全清單', () => {
    const models = [{ name: 'MT-09 SP' }, { name: 'SP-9' }];
    expect(filterVehicleOptions(models, 'sp', nameOf).map(nameOf)).toEqual(['SP-9', 'MT-09 SP']);
    expect(filterVehicleOptions(BRANDS, '', nameOf)).toHaveLength(4);
  });
});

describe('🔴 不得變寬的三道防線(本片的承重,不是附帶)', () => {
  // 突變:讓 uniqueExactMatch 也吃 looseVehicleKey ⇒ 只紅這條。
  // 🔴 **輸入要選對才殺得死突變**:第一版我寫 `'rs6'` —— 那個在寬鬆化之後仍然 ≠ `'rs660'`
  //    (exact 要求全等,不是 prefix)⇒ 突變後照樣回 null、測試照樣綠 = **零判別力**,
  //    突變矩陣當場抓到。真正會被寬鬆化翻面的是「**字面只差分隔符**」那格:
  //    `'RS660'` 在嚴格下 ≠ `'rs 660'`(不自動套),在寬鬆下 === `'rs660'`(**會自動套**)。
  // 行為上這是刻意的嚴格側:客人打「RS660」直接離開欄位不會被系統擅自套車;
  //    他要那台車就從(已經找得到的)候選清單點一下 —— 那條路走的不是本函式。
  it('🔴 自動套用維持嚴格:「RS660」(少一個空格)不會被自動套成「RS 660」', () => {
    expect(uniqueExactMatch(RS, 'RS660', nameOf)).toBeNull();
    // 🔴 **清單要餵對**:第一版這行寫 `uniqueExactMatch(RS, 'GSX8S', …)` —— `RS` 裡根本沒有 GSX,
    //    嚴格/寬鬆兩態都回 null ⇒ **恆真**。與上面那條剛修過的是同一個形狀、在下一行復發(R1 抓到)。
    expect(uniqueExactMatch(GSX, 'GSX8S', nameOf)).toBeNull();
    // 正向對照:字面全等(僅大小寫/全形差異)仍會自動套用 ⇒ 上面紅的是「折平」不是「整支壞掉」
    expect(uniqueExactMatch(RS, 'rs 660', nameOf)).toEqual({ name: 'RS 660' });
  });

  // 突變:把去分隔符併進 normalizeVehicleQuery ⇒ 紅這條(taxonomy 與 fitment 的共同上游)
  it('normalizeVehicleQuery 逐字不動:「MT 09」與「MT-09」仍是兩個不同的鍵', () => {
    expect(normalizeVehicleQuery('MT 09')).toBe('mt 09');
    expect(normalizeVehicleQuery('MT-09')).toBe('mt-09');
    expect(normalizeVehicleQuery('MT 09')).not.toBe(normalizeVehicleQuery('MT-09'));
  });
});

describe('R1 抓到的兩個未申報行為(補守門)', () => {
  // nit-⑥:查詢只由分隔符組成 ⇒ 寬鬆鍵為空。若照「空查詢」處理會回**整份清單**,
  //   而 FilterDrawerVehicleTab 的標題仍寫「符合『-』的車款」= 字面說謊。
  // 突變:把 `filterVehicleOptions` 的 `key` 選擇拿掉、一律用 looseVehicleKey ⇒ 只紅這條
  it('🔴 只打分隔符(「-」)→ 退回嚴格比對,不得變成「回整份清單」', () => {
    const models = [{ name: 'GSX-8S' }, { name: 'RS 660' }, { name: 'RSV4' }];
    // 舊行為:只列名稱真的含連字號的
    expect(filterVehicleOptions(models, '-', nameOf).map(nameOf)).toEqual(['GSX-8S']);
    // 反面:不得回整份清單(那是「真的沒打字」才有的行為)
    expect(filterVehicleOptions(models, '-', nameOf)).not.toHaveLength(models.length);
    // 真的沒打字 → 仍是全清單(既有行為不回歸)
    expect(filterVehicleOptions(models, '   ', nameOf)).toHaveLength(3);
  });

  // nit-⑦:`vehicleLabel` 用空格串「品牌 車型」⇒ 空格折平後會**跨詞命中**。
  //   這不是本片目標、是必然副作用,多半也是想要的(客人常連著打)⇒ 釘住、不讓它悄悄消失或悄悄擴大。
  // 突變:filterVehicleOptions 退回嚴格鍵 ⇒ 這條也紅(與 RS6 那條同源,非獨立靶)
  it('跨詞命中:「yamahamt」命中「YAMAHA MT-09」(空格折平的副作用,已申報)', () => {
    const labels = [{ name: 'YAMAHA MT-09' }, { name: 'HONDA CB650R' }];
    expect(filterVehicleOptions(labels, 'yamahamt', nameOf).map(nameOf)).toEqual(['YAMAHA MT-09']);
  });
});
