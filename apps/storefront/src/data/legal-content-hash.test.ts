import { describe, it, expect } from 'vitest';
import { createHash } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';

import {
  canonicalLegalPayload,
  TERMS_DOC,
  PRIVACY_DOC,
  LEGAL_LAST_UPDATED,
  LEGAL_UI_STRINGS,
} from './legal-content';
import { CURRENT_TERMS_VERSION, CURRENT_TERMS_CONTENT_HASH } from '@/lib/legal/terms-version';

// 法律文字 ↔ 同意版本 綁定守門(#291、2026-07-24)
//
// 這一檔守的是**跨層一致性**,不是渲染:
//   legal_terms_versions 那一列說「版本 X 的內容雜湊是 H」,客人簽的是 X,
//   而客人實際讀到的字必須真的雜湊出 H,且 migration 裡寫的也必須是同一個 H。
// 沒有這些測試,以後有人順手改一句條款,version 不動 → 稽核時「客人同意的內容」查無對證,
// 而三綠 / 型別 / lint 全部都是綠的(改字串不會讓任何東西紅)。

const MIGRATIONS_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '../../../../supabase/migrations');

describe('法律文字內容雜湊 ↔ CURRENT_TERMS_VERSION 綁定', () => {
  it('🔴 canonicalLegalPayload() 的 sha256 必須等於 CURRENT_TERMS_CONTENT_HASH', () => {
    const actual = createHash('sha256').update(canonicalLegalPayload(), 'utf8').digest('hex');
    expect(
      actual,
      [
        '對外法律文字已變動,但 CURRENT_TERMS_CONTENT_HASH 沒跟著換。',
        '🔴 不要只把下面的實際值貼上來就算修好 —— FK 順序是硬性的:',
        '  ① 寫 migration:INSERT INTO legal_terms_versions (新 version, 新 hash)',
        '  ② supabase db push 並確認已套用',
        '  ③ 才 bump CURRENT_TERMS_VERSION + CURRENT_TERMS_CONTENT_HASH',
        '顛倒順序 = 每筆結帳 FK 違反、全站結帳斷線。',
        `實際 hash = ${actual}`,
      ].join('\n'),
    ).toBe(CURRENT_TERMS_CONTENT_HASH);
  });

  it('🔴 supabase migration 必須有一支真的 INSERT 該 version 與該 hash 進 legal_terms_versions', () => {
    // 為什麼需要這條:hash 一致測試只比對 TS 內的兩個常數,對 .sql **零檢查**。
    // 只 bump TS 而漏寫/漏改 migration → 三綠全過,但 apply 後 DB 的 content_hash
    // 仍是舊值,「版本 ≠ 內容」的 bug 原地復發(這正是本 slice 要修掉的東西)。
    //
    // 🔴 **必須先剝掉註解才比對**(codex 關卡2 must-fix #3 實際抓到的假綠路徑):
    //   migration 檔頭註解與 DO 區塊的斷言常數本來就會提到表名、版本與 hash ——
    //   若直接對整檔做字串搜尋,**把真正的 INSERT 整段刪掉測試依然綠**。
    //   剝註解後再要求命中真正的 `INSERT INTO ... legal_terms_versions ... VALUES`,才是可執行語句。
    const stripSqlComments = (sql: string): string =>
      sql
        .replace(/\/\*[\s\S]*?\*\//g, ' ') // 區塊註解
        .replace(/--[^\n]*/g, ' '); // 行註解

    const sqlFiles = readdirSync(MIGRATIONS_DIR).filter((f) => f.endsWith('.sql'));
    expect(sqlFiles.length, `讀不到 migration 目錄:${MIGRATIONS_DIR}`).toBeGreaterThan(0);

    // 🔴 除了剝註解,還要驗**欄位映射與順序**(codex 關卡2 R2 A3):
    //   只檢查「這段同時含 version 與 hash 兩個字面」擋不住欄位對調
    //   (`(version, content_hash) VALUES (<hash>, <version>)` 也會通過)。
    //   ⇒ 解析欄位清單與 VALUES 清單,確認 version 字面落在 version 欄位的位置、hash 落在 content_hash 的位置。
    // ⚠️ **誠實邊界**:這是 smoke 守門、不是 SQL parser ——
    //   它擋不住「寫在字串常值裡的假 INSERT」等刻意規避;目的在於接住**遺漏與手滑**,非防惡意。
    const seeding = sqlFiles.filter((f) => {
      const body = stripSqlComments(readFileSync(join(MIGRATIONS_DIR, f), 'utf8'));
      const inserts = body.match(
        /INSERT\s+INTO\s+[\w.]*legal_terms_versions\s*\(([^)]*)\)\s*VALUES\s*\(([\s\S]*?)\)/gi,
      );
      return (inserts ?? []).some((stmt) => {
        const m = stmt.match(
          /INSERT\s+INTO\s+[\w.]*legal_terms_versions\s*\(([^)]*)\)\s*VALUES\s*\(([\s\S]*?)\)/i,
        );
        if (!m) return false;
        const cols = (m[1] ?? '').split(',').map((c) => c.trim().toLowerCase());
        const vals = (m[2] ?? '').split(',').map((v) => v.trim());
        const versionIdx = cols.indexOf('version');
        const hashIdx = cols.indexOf('content_hash');
        if (versionIdx < 0 || hashIdx < 0) return false;
        return (
          vals[versionIdx] === `'${CURRENT_TERMS_VERSION}'` &&
          vals[hashIdx] === `'${CURRENT_TERMS_CONTENT_HASH}'`
        );
      });
    });

    expect(
      seeding,
      [
        `查無 migration 以真正的 INSERT 登錄 version '${CURRENT_TERMS_VERSION}'`,
        `與 hash ${CURRENT_TERMS_CONTENT_HASH.slice(0, 12)}…(註解不算數)。`,
        '⇒ 條款內容/版本改了但 migration 沒跟上,apply 後 DB 會與畫面對不上。',
        `已掃描 ${sqlFiles.length} 支 migration。`,
      ].join('\n'),
    ).not.toHaveLength(0);
  });
});

describe('canonical payload 涵蓋範圍(漏收 = 該段可被改而 hash 不變)', () => {
  it('🔴 涵蓋 LegalDocPage / route 輸出的每一個欄位(逐行比對,非整包 toContain)', () => {
    // 🔴 **一律斷言完整 canonical 行**(`文件別\t序號\t型別\t文字`),不是 payload.toContain(文字)。
    //   codex 關卡2 must-fix #3 實際抓到:用整包 toContain 時,把 title 序列化整個拿掉,
    //   測試仍綠 —— 因為「服務條款」四個字本來就出現在隱私政策內文裡、「隱私政策」也出現在條款內文裡。
    //   對完整行斷言才真的釘住「這個欄位有被序列化、且帶著它的文件別與型別」。
    const lines = new Set(canonicalLegalPayload().split('\n'));
    const has = (line: string, what: string) => expect(lines.has(line), `漏收:${what}`).toBe(true);

    // 版面固定字(LegalDocPage 直接渲染)
    has(`META\t0\tU\t${LEGAL_LAST_UPDATED}`, '最後更新日');
    has(`META\t0\tX\t${LEGAL_UI_STRINGS.lastUpdatedLabel}`, '最後更新標籤');
    has(`META\t0\tB\t${LEGAL_UI_STRINGS.breadcrumbHome}`, '麵包屑首段');

    for (const doc of [TERMS_DOC, PRIVACY_DOC]) {
      has(`${doc.key}\t0\tM\t${doc.title}${LEGAL_UI_STRINGS.titleSuffix}`, `${doc.key} 分頁標題`);
      has(`${doc.key}\t0\tT\t${doc.title}`, `${doc.key} 頁標題`);
      has(`${doc.key}\t0\tS\t${doc.subtitle}`, `${doc.key} 副標`);
      has(`${doc.key}\t0\tD\t${doc.description}`, `${doc.key} SEO 描述`);
      doc.sections.forEach((section, i) => {
        // 帶序號 ⇒ 同時釘住「對條文順序敏感」:調換兩節位置,這裡的行就對不上。
        has(`${doc.key}\t${i + 1}\tH\t${section.heading}`, `${doc.key} 第 ${i + 1} 節標題`);
        (section.paragraphs ?? []).forEach((p) => {
          has(`${doc.key}\t${i + 1}\tP\t${p}`, `${doc.key} 第 ${i + 1} 節內文「${p.slice(0, 16)}…」`);
        });
        (section.items ?? []).forEach((item) => {
          has(`${doc.key}\t${i + 1}\tL\t${item}`, `${doc.key} 第 ${i + 1} 節條列「${item.slice(0, 16)}…」`);
        });
      });
    }
  });

  it('版本鍵格式為 YYYY-MM-DD、hash 為 64 位小寫十六進位', () => {
    expect(CURRENT_TERMS_VERSION).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(CURRENT_TERMS_CONTENT_HASH).toMatch(/^[0-9a-f]{64}$/);
  });
});
