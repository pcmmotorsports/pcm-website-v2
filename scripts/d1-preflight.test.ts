import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { D1_DELETE_COHORT, D1_RETAIN_COHORT } from './d1-cohort';
import { buildCohortSelectors } from './d1-export';
import { preflight } from './d1-restore';

const ALL_TABLES = buildCohortSelectors([], () => '').map(([table]) => table);

const PROD_URL =
  'postgresql://postgres.bmpnplmnldofgaohnaok:secret@aws-0-ap-southeast-1.pooler.supabase.com:5432/postgres';
const REHEARSAL_URL = 'postgresql://postgres:secret@localhost:5432/postgres';
const PROD_CLUSTER = '7632885393857617092';

/** 與 d1-export.ts 產出的 manifest 同欄序:display_id,id,membership,evidence,exported_at,db,cluster_id */
function writeManifest(
  overrides: {
    deleteIds?: readonly string[];
    retainIds?: readonly string[];
    cluster?: string | ((index: number) => string);
    /** 省略某幾張表的 CSV,模擬「拿到舊版十一表備份」。 */
    omitTables?: readonly string[];
  } = {},
): string {
  const dir = mkdtempSync(join(tmpdir(), 'd1-preflight-'));

  for (const table of ALL_TABLES) {
    if (!overrides.omitTables?.includes(table)) writeFileSync(join(dir, `${table}.csv`), 'header\n');
  }
  const del = overrides.deleteIds ?? D1_DELETE_COHORT.map(({ displayId }) => displayId);
  const keep = overrides.retainIds ?? D1_RETAIN_COHORT.map(({ displayId }) => displayId);
  const cluster = overrides.cluster ?? PROD_CLUSTER;
  const clusterAt = (i: number) => (typeof cluster === 'function' ? cluster(i) : cluster);

  const rows = [
    ...del.map((d) => [d, 'delete'] as const),
    ...keep.map((d) => [d, 'retain'] as const),
  ].map(([displayId, membership], i) =>
    [displayId, 'uuid', membership, '', '2026-07-29', 'postgres', clusterAt(i)].join(','),
  );

  writeFileSync(
    join(dir, 'cohort-manifest.csv'),
    ['display_id,id,membership,evidence,exported_at,db,cluster_id', ...rows].join('\n'),
  );

  return dir;
}

const originalUrl = process.env.D1_DB_URL;

afterEach(() => {
  if (originalUrl === undefined) delete process.env.D1_DB_URL;
  else process.env.D1_DB_URL = originalUrl;
});

describe('preflight', () => {
  it('連線目標對、備份 cohort 相符、來源叢集對 → 放行', () => {
    process.env.D1_DB_URL = PROD_URL;

    expect(() => preflight('production', writeManifest())).not.toThrow();
  });

  // 🔴 Fable R3-F3:07-29 早上那包只有十一份 CSV(父表後來才加)。preflight 若只讀 manifest,
  //    拿舊包會走到交易中段才炸 —— 而父列若已被刪就永久救不回。
  it('備份缺父表 CSV(舊版十一表備份)→ 進交易前就中止', () => {
    process.env.D1_DB_URL = PROD_URL;
    const dir = writeManifest({
      omitTables: ['customers', 'customer_addresses', 'products', 'product_variants', 'legal_terms_versions'],
    });

    expect(() => preflight('production', dir)).toThrow(/備份缺 5 份檔案/);
  });

  // 🔴 Fable R3-F5:psql 吃的是原始 URL,libpq 會讓 ?host=/?hostaddr= 把連線導去別處,
  //    而 buildD1PgConfig 驗過的那份離散設定根本沒參與 ⇒ 從源頭拒收帶參數的 URL。
  it.each([['?host=evil.example.com'], ['?sslmode=disable'], ['?hostaddr=203.0.113.1']])(
    '連線字串帶 %s → 中止',
    (qs) => {
      process.env.D1_DB_URL = `${PROD_URL}${qs}`;

      expect(() => preflight('production', writeManifest())).toThrow(/不得帶 query string/);
    },
  );

  it('manifest 欄位含引號逗號也不會讓 cluster 檢查位移', () => {
    process.env.D1_DB_URL = PROD_URL;
    const dir = writeManifest();
    const file = join(dir, 'cohort-manifest.csv');
    // 模擬 evidence 文案哪天多了一個半形逗號 —— psql 會加引號。
    writeFileSync(
      file,
      readFileSync(file, 'utf8').replace(/,,2026-07-29/, ',"有逗號,的說明",2026-07-29'),
    );

    expect(() => preflight('production', dir)).not.toThrow();
  });

  it('缺 D1_DB_URL → 中止(不接受用命令列傳,ps 看得到密碼)', () => {
    delete process.env.D1_DB_URL;

    expect(() => preflight('production', writeManifest())).toThrow(/缺 D1_DB_URL/);
  });

  // 🔴 這是 codex R2-P1 的核心:交易內的 system_identifier 擋不掉實體快照 clone
  //    (pg_basebackup / storage snapshot 原樣保留同一個識別碼)。連線字串是唯一能分辨的東西。
  it('production 模式但連線字串不是 production pooler → 中止', () => {
    process.env.D1_DB_URL = REHEARSAL_URL;

    expect(() => preflight('production', writeManifest())).toThrow();
  });

  it('演練模式但連線字串指向 production 專案 → 中止', () => {
    process.env.D1_DB_URL = PROD_URL;

    expect(() => preflight('rehearsal', writeManifest())).toThrow(/指向 production 專案/);
  });

  // 🔴 腳本內的 EXCEPT ALL 是自我比對、恆真 —— 指錯備份目錄照樣全綠。
  //    「這包備份就是那 26 張」只有 manifest 證得了。
  it('manifest 的待刪名單與 cohort 不符 → 中止', () => {
    process.env.D1_DB_URL = PROD_URL;
    const dir = writeManifest({
      deleteIds: [
        ...D1_DELETE_COHORT.slice(1).map(({ displayId }) => displayId),
        'PCM-2026-9999',
      ],
    });

    expect(() => preflight('production', dir)).toThrow(/待刪名單與 d1-cohort\.ts 不符/);
  });

  it('待刪名單少一張 → 中止', () => {
    process.env.D1_DB_URL = PROD_URL;
    const dir = writeManifest({
      deleteIds: D1_DELETE_COHORT.slice(1).map(({ displayId }) => displayId),
    });

    expect(() => preflight('production', dir)).toThrow(/待刪名單與 d1-cohort\.ts 不符/);
  });

  it('留存名單被動過 → 中止', () => {
    process.env.D1_DB_URL = PROD_URL;

    expect(() =>
      preflight('production', writeManifest({ retainIds: ['PCM-2026-0052', 'PCM-2026-0102'] })),
    ).toThrow(/留存名單與 d1-cohort\.ts 不符/);
  });

  it('manifest 混了兩個來源叢集 → 中止', () => {
    process.env.D1_DB_URL = PROD_URL;
    const dir = writeManifest({ cluster: (i) => (i === 0 ? '123' : PROD_CLUSTER) });

    expect(() => preflight('production', dir)).toThrow(/多個來源叢集/);
  });

  it('備份不是出自 production 卻要還原到 production → 中止', () => {
    process.env.D1_DB_URL = PROD_URL;

    expect(() => preflight('production', writeManifest({ cluster: '123' }))).toThrow(
      /來源叢集不是 production/,
    );
  });

  // 演練庫的備份可以是任何叢集 —— 那正是演練的意義。
  it('演練模式不限制備份來源叢集', () => {
    process.env.D1_DB_URL = REHEARSAL_URL;

    expect(() => preflight('rehearsal', writeManifest({ cluster: '123' }))).not.toThrow();
  });
});
