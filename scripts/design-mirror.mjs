#!/usr/bin/env node
// design-mirror.mjs - PCM 設計 ↔ 現場 對照工具
//
// 用途:
//   Cowork / Code 動 storefront 元件前 Read manifest、列對應 design + 業務 override + 連動檔 + 同步狀態
//   commit pre-check hook 也用此工具寫 .claude/scratch/{slice-id}/inspect.json 證明跑過
//
// 對齊:
//   - rules: 鐵則 8 重大改動先 plan(超 3 檔連動觸發提議)
//   - lessons §12-25 字面內嵌義務(manifest 對照表本身就是字面源、Cowork/Code 不憑記憶)
//   - working-style 第 27 條(純 code 題 Cowork 自決、不丟 Sean、本工具屬此範圍)
//
// 使用:
//   node scripts/design-mirror.mjs --target apps/storefront/src/components/ProductsPage.tsx [--slice-id <id>]
//   node scripts/design-mirror.mjs --validate
//   node scripts/design-mirror.mjs --diff-against-storefront
//   node scripts/design-mirror.mjs --update-sync <ComponentName> --commit-hash <hash>
//   node scripts/design-mirror.mjs --update-global-sync
//
// 依賴: yaml ^2.6.0 (devDep)

import { readFileSync, writeFileSync, mkdirSync, existsSync, statSync } from 'node:fs';
import { resolve, dirname, basename } from 'node:path';
import { parseArgs } from 'node:util';
import { execSync } from 'node:child_process';
import { parse as parseYaml, stringify as stringifyYaml } from 'yaml';

// ---- 常數 ----
const REPO_ROOT = resolve(process.cwd());
const MANIFEST_PATH = resolve(REPO_ROOT, 'docs/design-storefront-manifest.yaml');
const SCRATCH_BASE = resolve(REPO_ROOT, '.claude/scratch');
const RULE_BIG_CHANGE = 3; // 鐵則 8 連動檔 ≥ N 觸發 plan 提議

// ---- 參數解析 ----
const { values, positionals } = parseArgs({
  options: {
    target: { type: 'string' },
    'slice-id': { type: 'string' },
    component: { type: 'string' },
    validate: { type: 'boolean' },
    'diff-against-storefront': { type: 'boolean' },
    'update-sync': { type: 'string' },
    'commit-hash': { type: 'string' },
    'update-global-sync': { type: 'boolean' },
    help: { type: 'boolean' },
  },
  allowPositionals: true,
});

if (values.help) {
  console.log(`design-mirror.mjs - PCM 設計 ↔ 現場 對照工具

Usage:
  node scripts/design-mirror.mjs --target <path> [--slice-id <id>] [--component <Name>]
    inspect 模式:比對 storefront.component / storefront.css / related_storefront[]、列對應 design + 業務 override + 連動檔 + 同步狀態
    若 --slice-id 提供、寫 .claude/scratch/{slice-id}/inspect.json 供 hook 用
    shared path(css / related)命中多個元件時列出全部(exit 0);用 --component <Name> 指定主元件

  node scripts/design-mirror.mjs --validate
    驗 manifest 內所有 path-like 欄位(storefront/design 各檔 + related_storefront[])都存在
    + 案 A 可達性 gate(backlog #180):每個 last_modified_commit(非佔位)須 HEAD 可達祖先、非 orphan

  node scripts/design-mirror.mjs --diff-against-storefront
    對齊 design submodule update 後跑、列「design 端有改但 storefront 沒跟」、寫進 manifest open_drifts

  node scripts/design-mirror.mjs --update-sync <ComponentName> --commit-hash <hash>
    slice 寫前跑、寫對應 component 的 last_modified_commit + date(案 A 記可達祖先=
    前一個已落地可達 commit、通常本 slice 父 commit;不 amend 自身、見 #180)

  node scripts/design-mirror.mjs --update-global-sync
    design submodule update 後跑、更 last_global_sync 段
`);
  process.exit(0);
}

// ---- Manifest 讀寫 ----
function loadManifest() {
  if (!existsSync(MANIFEST_PATH)) {
    console.error(`❌ Manifest not found: ${MANIFEST_PATH}`);
    process.exit(1);
  }
  return parseYaml(readFileSync(MANIFEST_PATH, 'utf8'));
}

function saveManifest(manifest) {
  writeFileSync(MANIFEST_PATH, stringifyYaml(manifest, { lineWidth: 120 }), 'utf8');
}

// ---- 工具 ----
const normPath = (p) => (p || '').replace(/^\.\//, '').replace(/^\//, '');

function findComponentsByPath(manifest, targetPath) {
  // 對齊字面、不憑記憶;比對 storefront.component / storefront.css / related_storefront[] 三類 path-like 欄位
  // shared CSS / shared related path 命中多個元件 → 全部回傳、不挑一(每個 match 標 matched_field)
  const target = normPath(targetPath);
  const matches = [];
  if (!target) return matches;
  for (const [name, entry] of Object.entries(manifest.components || {})) {
    const sf = entry.storefront || {};
    if (normPath(sf.component) === target) {
      matches.push({ name, entry, matched_field: 'storefront.component' });
      continue; // 一元件一 match、避免同元件重複
    }
    if (normPath(sf.css) === target) {
      matches.push({ name, entry, matched_field: 'storefront.css' });
      continue;
    }
    if ((entry.related_storefront || []).some((p) => normPath(p) === target)) {
      matches.push({ name, entry, matched_field: 'related_storefront' });
    }
  }
  return matches;
}

function checkFileExists(relPath) {
  return existsSync(resolve(REPO_ROOT, relPath));
}

// 案 A 可達性檢查(backlog #180):last_modified_commit 須為 HEAD 可達祖先(非 orphan/dangling)。
// 回 true = 可達;false = 不可達 / 非 commit / git 不可用。hash 已先過 HASH_RE 格式驗、避 shell 注入。
function isReachableCommit(hash) {
  try {
    execSync(`git merge-base --is-ancestor ${hash} HEAD`, { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

// ---- --validate ----
function cmdValidate() {
  const manifest = loadManifest();
  const components = manifest.components || {};
  // 佔位字面(以 "(" 開頭、例「(未建)」「(待 amend)」)視為未建、不驗
  const isPlaceholder = (p) => !p || p.startsWith('(');
  let issues = 0;
  let pathsChecked = 0;
  for (const [name, entry] of Object.entries(components)) {
    const sf = entry.storefront || {};
    const dz = entry.design || {};
    const fields = [
      ['storefront.component', sf.component],
      ['storefront.css', sf.css],
      ['design.component', dz.component],
      ['design.css', dz.css],
      ['design.reference', dz.reference],
      ['design.explorations_css', dz.explorations_css],
      ['design.data_mock', dz.data_mock],
      ['design.handoff_doc', dz.handoff_doc],
    ];
    (entry.related_storefront || []).forEach((p, i) => fields.push([`related_storefront[${i}]`, p]));
    for (const [field, val] of fields) {
      if (isPlaceholder(val)) continue;
      pathsChecked++;
      if (!checkFileExists(val)) {
        console.error(`❌ [${name}] ${field} missing: ${val}`);
        issues++;
      }
    }
  }
  // ---- 案 A 可達性 gate(backlog #180):last_modified_commit 須 HEAD 可達祖先、非 orphan/dangling ----
  const HASH_RE = /^[0-9a-f]{7,40}$/i;
  let orphanIssues = 0;
  let commitsChecked = 0;
  for (const [name, entry] of Object.entries(components)) {
    const lmc = entry.storefront?.last_modified_commit;
    if (isPlaceholder(lmc)) continue; // 佔位字面(如「(未動於本輪 session)」)跳過
    commitsChecked++;
    if (!HASH_RE.test(lmc)) {
      console.error(`❌ [${name}] last_modified_commit 非合法 hash 格式: ${lmc}`);
      orphanIssues++;
      continue;
    }
    if (!isReachableCommit(lmc)) {
      console.error(`❌ [${name}] last_modified_commit ${lmc} 非 HEAD 可達祖先(orphan/dangling?案 A 須記可達祖先、見 backlog #180 + docs/patterns/slice-checkpoint.md)`);
      orphanIssues++;
    }
  }

  const total = issues + orphanIssues;
  if (total === 0) {
    console.log(
      `✅ Manifest validated, ${Object.keys(components).length} components / ${pathsChecked} paths OK / ${commitsChecked} last_modified_commit 可達 OK`,
    );
    process.exit(0);
  } else {
    console.error(
      `❌ Found ${issues} broken link(s) out of ${pathsChecked} paths + ${orphanIssues} unreachable/malformed commit(s) out of ${commitsChecked} checked`,
    );
    process.exit(1);
  }
}

// ---- --target ----
function cmdTarget(targetPath, sliceId, componentFilter) {
  const manifest = loadManifest();
  let matches = findComponentsByPath(manifest, targetPath);
  if (matches.length === 0) {
    console.error(`❌ No manifest entry for ${targetPath}`);
    console.error(`提示:若此檔該入 manifest、請 Cowork amend manifest;若屬 Phase 2 範圍或刻意不入 manifest、由 Sean 拍板跳過、勿憑印象。`);
    process.exit(1);
  }
  // shared path(css / related)命中多個元件 → 用 --component 指定、否則列出全部(非錯誤、exit 0)
  if (matches.length > 1) {
    if (componentFilter) {
      const filtered = matches.filter((m) => m.name === componentFilter);
      if (filtered.length === 0) {
        console.error(`❌ --component ${componentFilter} 不在 ${targetPath} 命中清單(命中:${matches.map((m) => m.name).join(', ')})`);
        process.exit(1);
      }
      matches = filtered;
    } else {
      console.log(`📋 ${targetPath} 命中 ${matches.length} 個元件(shared path、非錯誤):`);
      matches.forEach((m) => {
        console.log(`   - ${m.name}  [${m.matched_field}]  → ${m.entry.storefront?.component || '(未建)'}`);
      });
      console.error(`\n提示:shared path 命中多個元件、本 slice 主元件請用 --component <Name> 指定;若仍無法判定、Cowork/Code 自判 + Sean 拍板,勿憑印象。`);
      process.exit(0);
    }
  }
  const { name, entry } = matches[0];
  const lines = [];
  lines.push(`📋 動到的 storefront 元件: ${name}`);
  lines.push(`   檔案: ${entry.storefront.component}`);
  if (entry.storefront.css) lines.push(`   CSS: ${entry.storefront.css}`);
  lines.push(``);
  lines.push(`🎨 對應 design 字面源:`);
  lines.push(`   元件: ${entry.design.component}`);
  if (entry.design.css) lines.push(`   CSS: ${entry.design.css}`);
  if (entry.design.reference) lines.push(`   參考: ${entry.design.reference}`);
  if (entry.design.handoff_doc) lines.push(`   Handoff: ${entry.design.handoff_doc}`);
  lines.push(``);

  const related = entry.related_storefront || [];
  lines.push(`🔗 連動 storefront 檔: ${related.length}`);
  related.forEach((p) => lines.push(`   - ${p}`));
  lines.push(``);

  const overrides = entry.business_overrides || [];
  lines.push(`✅ 業務 override(以下偏離合法、勿當誤翻譯): ${overrides.length}`);
  overrides.forEach((o) => {
    lines.push(`   - ${o.field}`);
    lines.push(`     design: ${o.design_value}`);
    lines.push(`     現場: ${o.storefront_value}`);
    lines.push(`     拍板: ${o.decided_at} ← ${o.decision_source}`);
    if (o.backlog) lines.push(`     backlog: ${o.backlog}`);
    if (o.reason) lines.push(`     reason: ${o.reason}`);
  });
  lines.push(``);

  const drifts = entry.open_drifts || [];
  lines.push(`⚠️  未解決偏離(可能要動 Claude Design / Cowork 寫 PRD): ${drifts.length}`);
  drifts.forEach((d) => {
    lines.push(`   - ${d.field}: ${d.note}`);
    if (d.plan) lines.push(`     plan: ${d.plan}`);
    if (d.backlog) lines.push(`     backlog: ${d.backlog}`);
  });
  lines.push(``);

  lines.push(`🕐 最近設計同步: ${manifest.last_global_sync.design_submodule_commit} (${manifest.last_global_sync.design_submodule_date})`);
  lines.push(`🕐 最近現場修改: ${entry.storefront.last_modified_commit} (${entry.storefront.last_modified_date})`);
  lines.push(``);

  // 鐵則 8 連動檔 ≥ 3 觸發 plan 提議
  if (related.length >= RULE_BIG_CHANGE) {
    lines.push(`⚠️  本 slice 連動 ${related.length} 檔(≥ ${RULE_BIG_CHANGE})、屬鐵則 8 重大改動、Cowork 必先寫 plan 等 Sean 拍`);
  }

  console.log(lines.join('\n'));

  // 寫 inspect.json 供 hook 用
  if (sliceId) {
    const scratchDir = resolve(SCRATCH_BASE, sliceId);
    mkdirSync(scratchDir, { recursive: true });
    const inspectPath = resolve(scratchDir, 'inspect.json');
    writeFileSync(inspectPath, JSON.stringify({
      slice_id: sliceId,
      target: targetPath,
      component_name: name,
      related_count: related.length,
      overrides_count: overrides.length,
      open_drifts_count: drifts.length,
      timestamp: new Date().toISOString(),
      manifest_global_sync: manifest.last_global_sync,
    }, null, 2));
    console.log(`\n📝 寫入 ${inspectPath} 供 commit pre-check hook 檢驗`);
  }
}

// ---- --update-sync ----
function cmdUpdateSync(componentName, commitHash) {
  const manifest = loadManifest();
  if (!manifest.components[componentName]) {
    console.error(`❌ Component "${componentName}" not in manifest`);
    process.exit(1);
  }
  const today = new Date().toISOString().slice(0, 10);
  manifest.components[componentName].storefront.last_modified_commit = commitHash;
  manifest.components[componentName].storefront.last_modified_date = today;
  saveManifest(manifest);
  console.log(`✅ Updated ${componentName} last_modified_commit=${commitHash} date=${today}`);
}

// ---- --update-global-sync ----
function cmdUpdateGlobalSync() {
  const manifest = loadManifest();
  // 從 design-reference submodule 抽當前 commit hash
  let hash;
  try {
    hash = execSync('git -C design-reference rev-parse HEAD').toString().trim().slice(0, 7);
  } catch (e) {
    console.error(`❌ Failed to read design-reference submodule HEAD`);
    process.exit(1);
  }
  const today = new Date().toISOString().slice(0, 10);
  manifest.last_global_sync.design_submodule_commit = hash;
  manifest.last_global_sync.design_submodule_date = today;
  manifest.last_global_sync.audited_at = today;
  saveManifest(manifest);
  console.log(`✅ Updated last_global_sync: ${hash} (${today})`);
}

// ---- --diff-against-storefront ----
function cmdDiffAgainstStorefront() {
  // TODO: 對齊 design submodule 當前 vs manifest last_global_sync 差異、列「design 端有改但 storefront 沒跟」
  //       Phase 1 簡化實作:提醒人工檢查、不自動 diff
  console.log(`⚠️  --diff-against-storefront: 簡化實作、提醒人工檢查`);
  console.log(`   1. 跑 git -C design-reference log --oneline ${loadManifest().last_global_sync.design_submodule_commit}..HEAD`);
  console.log(`   2. 看哪些元件改了`);
  console.log(`   3. 在 manifest 對應元件 open_drifts 段加紀錄、等對應 slice 處理`);
  console.log(`   4. 跑 --update-global-sync 更 last_global_sync 段`);
}

// ---- main ----
if (values.validate) {
  cmdValidate();
} else if (values['diff-against-storefront']) {
  cmdDiffAgainstStorefront();
} else if (values['update-sync']) {
  if (!values['commit-hash']) {
    console.error(`❌ --update-sync requires --commit-hash`);
    process.exit(1);
  }
  cmdUpdateSync(values['update-sync'], values['commit-hash']);
} else if (values['update-global-sync']) {
  cmdUpdateGlobalSync();
} else if (values.target) {
  cmdTarget(values.target, values['slice-id'], values.component);
} else {
  console.error(`❌ No mode specified. Use --help`);
  process.exit(1);
}
