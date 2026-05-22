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
  node scripts/design-mirror.mjs --target <storefront-file> [--slice-id <id>]
    inspect 模式:列對應 design + 業務 override + 連動檔 + 同步狀態
    若 --slice-id 提供、寫 .claude/scratch/{slice-id}/inspect.json 供 hook 用

  node scripts/design-mirror.mjs --validate
    驗 manifest 內 storefront / design 對應檔路徑都存在

  node scripts/design-mirror.mjs --diff-against-storefront
    對齊 design submodule update 後跑、列「design 端有改但 storefront 沒跟」、寫進 manifest open_drifts

  node scripts/design-mirror.mjs --update-sync <ComponentName> --commit-hash <hash>
    slice 結束後跑、amend 對應 component 的 last_modified_commit + date

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
function findComponentByStorefrontPath(manifest, storefrontPath) {
  // 對齊 storefront 字面、不憑記憶
  const norm = (p) => p.replace(/^\.\//, '').replace(/^\//, '');
  for (const [name, entry] of Object.entries(manifest.components || {})) {
    if (norm(entry.storefront?.component || '') === norm(storefrontPath)) {
      return { name, entry };
    }
  }
  return null;
}

function checkFileExists(relPath) {
  return existsSync(resolve(REPO_ROOT, relPath));
}

// ---- --validate ----
function cmdValidate() {
  const manifest = loadManifest();
  let issues = 0;
  for (const [name, entry] of Object.entries(manifest.components || {})) {
    const storefrontComp = entry.storefront?.component;
    const designComp = entry.design?.component;
    // storefront 可能標未建
    if (storefrontComp && !storefrontComp.startsWith('(') && !checkFileExists(storefrontComp)) {
      console.error(`❌ [${name}] storefront file missing: ${storefrontComp}`);
      issues++;
    }
    if (designComp && !designComp.startsWith('(') && !checkFileExists(designComp)) {
      console.error(`❌ [${name}] design file missing: ${designComp}`);
      issues++;
    }
  }
  if (issues === 0) {
    console.log(`✅ Manifest validated, all ${Object.keys(manifest.components || {}).length} components OK`);
    process.exit(0);
  } else {
    console.error(`❌ Found ${issues} broken link(s)`);
    process.exit(1);
  }
}

// ---- --target ----
function cmdTarget(targetPath, sliceId) {
  const manifest = loadManifest();
  const found = findComponentByStorefrontPath(manifest, targetPath);
  if (!found) {
    console.error(`❌ No manifest entry for ${targetPath}`);
    console.error(`提示:若此檔該入 manifest、請 Cowork amend; 若 Phase 2 範圍、加 --skip-manifest-check 略過(待實作)`);
    process.exit(1);
  }
  const { name, entry } = found;
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
  cmdTarget(values.target, values['slice-id']);
} else {
  console.error(`❌ No mode specified. Use --help`);
  process.exit(1);
}
