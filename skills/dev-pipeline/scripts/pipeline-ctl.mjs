#!/usr/bin/env node
/**
 * dev-pipeline deterministic gatekeeper script (zero external dependencies)
 *
 * Subcommands:
 *   1. install [--target <subagents_dir>]
 *   2. init <task_dir>
 *   3. status <task_dir>
 *   4. check-scope <task_dir>
 *   5. verify-readonly <task_dir> save
 *      verify-readonly <task_dir> check [--allow <path>...]
 *   6. lint
 */

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const SKILL_ROOT = path.resolve(__dirname, '..');

const DEFAULT_IGNORE_PREFIXES = [
  '.pipeline/',
  '.git/',
  'node_modules/',
  'dist/',
  'build/',
  'coverage/',
  '.next/',
  '.nuxt/',
  '.turbo/',
  '.cache/',
  '.vite/',
  '*.tsbuildinfo',
];

function git(args, cwd = process.cwd(), allowFail = false) {
  try {
    return execFileSync('git', args, {
      cwd,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    }).trimEnd();
  } catch (err) {
    if (allowFail) return null;
    throw err;
  }
}

function isGitRepo(cwd = process.cwd()) {
  const out = git(['rev-parse', '--is-inside-work-tree'], cwd, true);
  return out === 'true';
}

function sha256File(filePath) {
  if (!fs.existsSync(filePath)) return 'DELETED';
  const stat = fs.statSync(filePath);
  if (stat.isDirectory()) return 'DIR';
  const buf = fs.readFileSync(filePath);
  return crypto.createHash('sha256').update(buf).digest('hex');
}

function gitBlobHash(filePath, cwd = process.cwd()) {
  const full = path.resolve(cwd, filePath);
  if (!fs.existsSync(full)) return 'DELETED';
  const stat = fs.statSync(full);
  if (stat.isDirectory()) return 'DIR';
  const out = git(['hash-object', '--', filePath], cwd, true);
  return out || sha256File(full);
}

function normalizeRelPath(p, cwd = process.cwd()) {
  const abs = path.resolve(cwd, p);
  const rel = path.relative(cwd, abs);
  return rel.split(path.sep).join('/');
}

/**
 * Parse git status --porcelain=v1 -z --untracked-files=all
 * Properly handles renames (splits into old path + new path) and untracked files inside directories.
 */
function getWorkingTreeDirtyFiles(cwd = process.cwd()) {
  const raw = git(['status', '--porcelain=v1', '-z', '--untracked-files=all'], cwd, true);
  if (!raw) return [];
  const entries = raw.split('\0');
  const paths = new Set();
  for (let i = 0; i < entries.length; i++) {
    const entry = entries[i];
    if (!entry || entry.length < 4) continue;
    const xy = entry.slice(0, 2);
    const filePath = entry.slice(3);
    paths.add(filePath);
    if (xy.includes('R') || xy.includes('C')) {
      i += 1;
      if (i < entries.length && entries[i]) {
        paths.add(entries[i]);
      }
    }
  }
  return Array.from(paths).sort();
}

/**
 * 1. install [--target <subagents_dir>]
 */
function cmdInstall(args) {
  let targetDir = process.env.PIPELINE_AGENTS_DIR || '';
  for (let i = 0; i < args.length; i++) {
    if ((args[i] === '--target' || args[i] === '-t') && args[i + 1]) {
      targetDir = args[i + 1];
      i++;
    } else if (!args[i].startsWith('-') && !targetDir) {
      targetDir = args[i];
    }
  }
  if (!targetDir) {
    targetDir = path.resolve(process.cwd(), '.claude/agents');
  } else {
    targetDir = path.resolve(process.cwd(), targetDir);
  }

  const slotsSrcDir = path.join(SKILL_ROOT, 'slots');
  if (!fs.existsSync(slotsSrcDir)) {
    console.error(`ERROR: slots directory not found at ${slotsSrcDir}`);
    process.exit(1);
  }

  fs.mkdirSync(targetDir, { recursive: true });
  const files = fs.readdirSync(slotsSrcDir).filter((f) => f.endsWith('.md')).sort();
  const installed = [];

  for (const file of files) {
    const src = path.join(slotsSrcDir, file);
    const dest = path.join(targetDir, file);
    fs.copyFileSync(src, dest);
    installed.push(dest);
  }

  // Detect legacy per-role registrations (pre-slot versions); never auto-delete.
  const legacyCandidates = [
    'pipeline-explorer.md',
    'pipeline-designer.md',
    'pipeline-design-reviewer.md',
    'pipeline-implementer.md',
    'pipeline-verifier.md',
    'pipeline-code-reviewer.md',
    'pipeline-fast.md',
  ];
  const legacyFound = legacyCandidates.filter((f) => fs.existsSync(path.join(targetDir, f)));

  const note =
    legacyFound.length > 0
      ? `Slot agents copied to the target harness subagents directory. Legacy per-role registrations found (${legacyFound.join(', ')}); remove them manually to keep single-path dispatch.`
      : 'Slot agents copied to the target harness subagents directory.';

  console.log(
    JSON.stringify(
      {
        ok: true,
        target_dir: targetDir,
        installed_count: installed.length,
        files: installed.map((f) => path.basename(f)),
        legacy_found: legacyFound,
        note,
      },
      null,
      2
    )
  );
}

/**
 * 2. init <task_dir>
 */
function cmdInit(args) {
  const taskDirArg = args[0];
  const force = args.includes('--force');
  if (!taskDirArg || taskDirArg.startsWith('-')) {
    console.error('Usage: pipeline-ctl.mjs init <task_dir> [--force]');
    process.exit(1);
  }
  const cwd = process.cwd();
  const taskDir = path.resolve(cwd, taskDirArg);
  fs.mkdirSync(taskDir, { recursive: true });

  const decisionsPath = path.join(taskDir, 'decisions.md');
  if (!fs.existsSync(decisionsPath)) {
    fs.writeFileSync(decisionsPath, '# Decisions\n', 'utf8');
  }
  const runLogPath = path.join(taskDir, 'run.log');
  if (!fs.existsSync(runLogPath)) {
    fs.writeFileSync(runLogPath, '', 'utf8');
  }

  const baselinePath = path.join(taskDir, '00-baseline.txt');
  if (fs.existsSync(baselinePath) && !force) {
    console.error(
      `ERROR: 00-baseline.txt already exists in ${taskDir}; rerunning init would absorb interim changes into the baseline. Skip init to reuse it, or pass --force to rebuild.`
    );
    process.exit(2);
  }
  if (!isGitRepo(cwd)) {
    fs.writeFileSync(baselinePath, 'NON_GIT\n', 'utf8');
    console.log(
      JSON.stringify({ ok: true, git: false, task_dir: normalizeRelPath(taskDir, cwd) }, null, 2)
    );
    return;
  }

  const branch = git(['branch', '--show-current'], cwd, true) || 'DETACHED';
  const headFull = git(['rev-parse', 'HEAD'], cwd, true) || 'EMPTY_HEAD';
  const headShort = headFull !== 'EMPTY_HEAD' ? headFull.slice(0, 8) : 'EMPTY_HEAD';

  const dirtyFiles = getWorkingTreeDirtyFiles(cwd).filter(
    (p) => !p.startsWith('.pipeline/')
  );

  const lines = [
    `BRANCH: ${branch}`,
    `HEAD: ${headFull}`,
    `HEAD_SHORT: ${headShort}`,
    `DIRTY_COUNT: ${dirtyFiles.length}`,
    '--- FILES ---',
  ];

  for (const relPath of dirtyFiles) {
    const h = gitBlobHash(relPath, cwd);
    lines.push(`${h}\t${relPath}`);
  }

  fs.writeFileSync(baselinePath, lines.join('\n') + '\n', 'utf8');

  console.log(
    JSON.stringify(
      {
        ok: true,
        git: true,
        task_dir: normalizeRelPath(taskDir, cwd),
        branch,
        head: headFull,
        head_short: headShort,
        dirty_count: dirtyFiles.length,
        baseline_pointer: `HEAD ${headShort} @ ${branch}；基线脏文件 ${dirtyFiles.length} 个；详见 00-baseline.txt`,
      },
      null,
      2
    )
  );
}

function parseBaseline(taskDir) {
  const baselinePath = path.join(taskDir, '00-baseline.txt');
  if (!fs.existsSync(baselinePath)) {
    throw new Error(`00-baseline.txt not found in ${taskDir}`);
  }
  const content = fs.readFileSync(baselinePath, 'utf8').trim();
  if (content === 'NON_GIT') {
    return { isGit: false, branch: '', head: '', dirtyMap: new Map() };
  }
  const lines = content.split(/\r?\n/);
  let branch = '';
  let head = '';
  let inFiles = false;
  const dirtyMap = new Map();

  for (const line of lines) {
    if (line === '--- FILES ---') {
      inFiles = true;
      continue;
    }
    if (!inFiles) {
      if (line.startsWith('BRANCH: ')) branch = line.slice(8).trim();
      if (line.startsWith('HEAD: ')) head = line.slice(6).trim();
    } else if (line.trim()) {
      const idx = line.indexOf('\t');
      if (idx !== -1) {
        const hash = line.slice(0, idx).trim();
        const file = line.slice(idx + 1).trim();
        dirtyMap.set(file, hash);
      }
    }
  }
  return { isGit: true, branch, head, dirtyMap };
}

function parseIgnorePathsFromTask(taskDir) {
  const taskPath = path.join(taskDir, '00-task.md');
  const ignores = [...DEFAULT_IGNORE_PREFIXES];
  if (!fs.existsSync(taskPath)) return ignores;
  const content = fs.readFileSync(taskPath, 'utf8');
  const match = content.match(/(?:忽略路径|Ignore Paths)[：:]\s*([^\n]+)/i);
  if (match && match[1]) {
    const items = match[1]
      .split(/[,，、\s]+/)
      .map((s) => s.replace(/`/g, '').trim())
      .filter((s) => s && s !== '无' && s !== 'None');
    ignores.push(...items);
  }
  return ignores;
}

function isIgnoredPath(relPath, ignorePatterns) {
  for (const pat of ignorePatterns) {
    if (pat.startsWith('*.')) {
      const ext = pat.slice(1);
      if (relPath.endsWith(ext)) return true;
    } else if (pat.endsWith('/')) {
      if (relPath.startsWith(pat) || relPath === pat.slice(0, -1)) return true;
    } else if (relPath === pat || relPath.startsWith(pat + '/')) {
      return true;
    }
  }
  return false;
}

/**
 * Compute all source files changed since 00-baseline.txt (handles committed, uncommitted, untracked, deleted, and baseline-dirty files).
 */
function getChangedFilesSinceBaseline(taskDir, cwd = process.cwd()) {
  const baseline = parseBaseline(taskDir);
  if (!baseline.isGit || !isGitRepo(cwd)) {
    return [];
  }
  const ignorePatterns = parseIgnorePathsFromTask(taskDir);
  const candidates = new Set();

  for (const f of baseline.dirtyMap.keys()) {
    candidates.add(f);
  }
  for (const f of getWorkingTreeDirtyFiles(cwd)) {
    candidates.add(f);
  }
  if (baseline.head && baseline.head !== 'EMPTY_HEAD') {
    const diffOut = git(['diff', '--name-only', baseline.head], cwd, true);
    if (diffOut) {
      for (const f of diffOut.split(/\r?\n/).filter(Boolean)) {
        candidates.add(f);
      }
    }
  }

  const changed = [];
  for (const relPath of Array.from(candidates).sort()) {
    if (isIgnoredPath(relPath, ignorePatterns)) continue;
    const currentHash = gitBlobHash(relPath, cwd);
    if (baseline.dirtyMap.has(relPath)) {
      const baseHash = baseline.dirtyMap.get(relPath);
      if (currentHash !== baseHash) {
        changed.push(relPath);
      }
    } else {
      // Was clean at baseline HEAD; if it differs from baseline HEAD or is untracked, it changed.
      let headHash = 'DELETED';
      if (baseline.head && baseline.head !== 'EMPTY_HEAD') {
        const revOut = git(['rev-parse', '--verify', `${baseline.head}:${relPath}`], cwd, true);
        if (revOut) headHash = revOut;
      }
      if (currentHash !== headHash) {
        changed.push(relPath);
      }
    }
  }
  return changed;
}

/**
 * 3. status <task_dir>
 */
function cmdStatus(args) {
  const taskDirArg = args[0];
  if (!taskDirArg) {
    console.error('Usage: pipeline-ctl.mjs status <task_dir>');
    process.exit(1);
  }
  const cwd = process.cwd();
  const taskDir = path.resolve(cwd, taskDirArg);
  if (!fs.existsSync(taskDir)) {
    console.error(`ERROR: task directory not found: ${taskDir}`);
    process.exit(1);
  }

  const files = fs.readdirSync(taskDir).filter((f) => f.endsWith('.md') || f.endsWith('.txt')).sort();
  const artifacts = {};
  for (const f of files) {
    const full = path.join(taskDir, f);
    if (fs.statSync(full).isFile()) {
      const firstLine = (fs.readFileSync(full, 'utf8').split(/\r?\n/)[0] || '').trim();
      artifacts[f] = firstLine;
    }
  }

  // Parse decisions.md for [回设计 j | r_base=<r> | 来源=BLOCKED|check-scope] and [回方案 j]
  let returnToDesignJ = 0;
  let returnToDesignBlockedJ = 0;
  let latestRBase = 0;
  let returnToPlanJ = 0;

  const decisionsPath = path.join(taskDir, 'decisions.md');
  if (fs.existsSync(decisionsPath)) {
    const decLines = fs.readFileSync(decisionsPath, 'utf8').split(/\r?\n/);
    for (const line of decLines) {
      const mDesign = line.match(/\[回设计\s+(\d+)\s*\|\s*r_base=(\d+)(?:\s*\|\s*来源=(\S+))?\]/);
      if (mDesign) {
        returnToDesignJ += 1;
        latestRBase = Number(mDesign[2]);
        if (mDesign[3] === 'BLOCKED') {
          returnToDesignBlockedJ += 1;
        }
      }
      const mPlan = line.match(/\[回方案\s+(\d+)\]/);
      if (mPlan) {
        returnToPlanJ += 1;
      }
    }
  }

  // Max 03-review-<r>.md number
  let maxReviewR = 0;
  for (const f of files) {
    const m = f.match(/^03-review-(\d+)\.md$/);
    if (m) {
      maxReviewR = Math.max(maxReviewR, Number(m[1]));
    }
  }

  // Design revisions k in current cycle: 02-response-<r>.md where r > latestRBase
  let designRevisionsK = 0;
  for (const f of files) {
    const m = f.match(/^02-response-(\d+)\.md$/);
    if (m && Number(m[1]) > latestRBase) {
      designRevisionsK += 1;
    }
  }

  // Repairs by key: 04-impl-<key>-修复-<n>.md (ignores 04-impl-<key>-人工修复-<k>.md)
  const repairsByKey = {};
  let blockedDesignCount = 0;
  for (const f of files) {
    const mRepair = f.match(/^04-impl-(.+)-修复-(\d+)\.md$/);
    if (mRepair) {
      const key = mRepair[1];
      if (!key.endsWith('-人工')) {
        repairsByKey[key] = (repairsByKey[key] || 0) + 1;
      }
    }
    if (f.startsWith('04-impl') && f.endsWith('.md')) {
      const first = artifacts[f] || '';
      if (/^STATUS:\s*BLOCKED\((设计遗漏|设计事实有误)\)/.test(first)) {
        blockedDesignCount += 1;
      }
    }
  }

  const hasExtraExplore = fs.existsSync(path.join(taskDir, '01-explore-补-1.md'));
  const changedFiles = fs.existsSync(path.join(taskDir, '00-baseline.txt'))
    ? getChangedFilesSinceBaseline(taskDir, cwd)
    : [];

  console.log(
    JSON.stringify(
      {
        ok: true,
        git: isGitRepo(cwd),
        task_dir: normalizeRelPath(taskDir, cwd),
        max_review_r: maxReviewR,
        latest_r_base: latestRBase,
        counts: {
          design_revisions_k: designRevisionsK,
          return_to_design_j: returnToDesignJ,
          return_to_design_blocked_j: returnToDesignBlockedJ,
          return_to_plan_j: returnToPlanJ,
          blocked_design_count: blockedDesignCount,
          repairs_by_key: repairsByKey,
          has_extra_explore: hasExtraExplore,
        },
        changed_files: changedFiles,
        artifacts,
      },
      null,
      2
    )
  );
}

/**
 * Parse 02-design.md "## 改动清单" table first column.
 */
function parseDesignChangeList(designPath) {
  if (!fs.existsSync(designPath)) {
    throw new Error(`Design file not found: ${designPath}`);
  }
  const content = fs.readFileSync(designPath, 'utf8');
  const lines = content.split(/\r?\n/);

  let inSection = false;
  const designFiles = [];

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (/^##\s+改动清单/.test(line)) {
      inSection = true;
      continue;
    }
    if (inSection && /^##\s+/.test(line)) {
      break;
    }
    if (!inSection || !line.startsWith('|')) continue;

    const cells = line
      .split('|')
      .slice(1, -1)
      .map((c) => c.trim());
    if (cells.length === 0) continue;

    const firstCol = cells[0].replace(/^`+|`+$/g, '').trim();
    if (
      !firstCol ||
      firstCol === '文件' ||
      firstCol === '路径' ||
      firstCol.toLowerCase() === 'file' ||
      firstCol.toLowerCase() === 'path' ||
      /^[-:]+$/.test(firstCol)
    ) {
      continue;
    }

    if (firstCol.includes('*') || /\s/.test(firstCol)) {
      throw new Error(
        `Invalid path entry in 02-design.md 改动清单 first column: "${firstCol}" (must be a single pure relative file path without wildcards or spaces)`
      );
    }

    const cleanPath = firstCol.replace(/^\.\//, '');
    if (!designFiles.includes(cleanPath)) {
      designFiles.push(cleanPath);
    }
  }

  if (designFiles.length === 0) {
    throw new Error(
      'Failed to parse any valid file paths from 02-design.md "## 改动清单" table.'
    );
  }
  return designFiles;
}

/**
 * 4. check-scope <task_dir>
 */
function cmdCheckScope(args) {
  const taskDirArg = args[0];
  if (!taskDirArg) {
    console.error('Usage: pipeline-ctl.mjs check-scope <task_dir>');
    process.exit(1);
  }
  const cwd = process.cwd();
  const taskDir = path.resolve(cwd, taskDirArg);
  const designPath = path.join(taskDir, '02-design.md');

  let designFiles;
  try {
    designFiles = parseDesignChangeList(designPath);
  } catch (err) {
    console.error(`ERROR: ${err.message}`);
    process.exit(2);
  }

  if (!isGitRepo(cwd)) {
    // Explicit degradation: never emit a green in_scope_* result outside git.
    console.log(
      JSON.stringify(
        {
          ok: false,
          mode: 'non_git',
          skipped: true,
          reason:
            'not a git work tree: check-scope unavailable; reconcile scope from the union of 04-impl*.md changed-file lists instead',
        },
        null,
        2
      )
    );
    process.exit(4);
  }

  const changedFiles = getChangedFilesSinceBaseline(taskDir, cwd);
  const designSet = new Set(designFiles);
  const changedSet = new Set(changedFiles);

  const inScopeChanged = designFiles.filter((f) => changedSet.has(f));
  const inScopeUnchanged = designFiles.filter((f) => !changedSet.has(f));
  const outOfScopeChanged = changedFiles.filter((f) => !designSet.has(f));

  const clean = outOfScopeChanged.length === 0;
  console.log(
    JSON.stringify(
      {
        ok: clean,
        in_scope_changed: inScopeChanged,
        in_scope_unchanged: inScopeUnchanged,
        out_of_scope_changed: outOfScopeChanged,
      },
      null,
      2
    )
  );
  if (!clean) {
    process.exit(3);
  }
}

/**
 * Collect snapshot of working tree dirty files + all files inside taskDir.
 */
function captureReadonlySnapshot(taskDir, cwd = process.cwd()) {
  const snap = {};
  if (isGitRepo(cwd)) {
    const head = git(['rev-parse', 'HEAD'], cwd, true) || 'EMPTY_HEAD';
    snap['__GIT_HEAD__'] = head;
    for (const relPath of getWorkingTreeDirtyFiles(cwd)) {
      if (relPath.endsWith('.readonly-snap.json')) continue;
      snap[relPath] = gitBlobHash(relPath, cwd);
    }
  }
  // Also snapshot all files inside taskDir recursively
  function walk(dir) {
    if (!fs.existsSync(dir)) return;
    for (const entry of fs.readdirSync(dir)) {
      if (entry === '.readonly-snap.json' || entry === 'run.log') continue;
      const full = path.join(dir, entry);
      const stat = fs.statSync(full);
      if (stat.isDirectory()) {
        walk(full);
      } else {
        const rel = normalizeRelPath(full, cwd);
        snap[rel] = sha256File(full);
      }
    }
  }
  walk(taskDir);
  return snap;
}

/**
 * 5. verify-readonly <task_dir> save | check [--allow <path>...]
 */
function cmdVerifyReadonly(args) {
  const taskDirArg = args[0];
  const mode = args[1];
  if (!taskDirArg || (mode !== 'save' && mode !== 'check')) {
    console.error(
      'Usage: pipeline-ctl.mjs verify-readonly <task_dir> save | check [--allow <path>...]'
    );
    process.exit(1);
  }
  const cwd = process.cwd();
  const taskDir = path.resolve(cwd, taskDirArg);
  const snapPath = path.join(taskDir, '.readonly-snap.json');

  if (mode === 'save') {
    const isGit = isGitRepo(cwd);
    const snap = captureReadonlySnapshot(taskDir, cwd);
    fs.writeFileSync(snapPath, JSON.stringify(snap, null, 2), 'utf8');
    console.log(
      JSON.stringify({
        ok: true,
        mode: 'save',
        git: isGit,
        snapshot: normalizeRelPath(snapPath, cwd),
        ...(isGit ? {} : { note: 'non-git: verification only covers the task directory' }),
      })
    );
    return;
  }

  if (!fs.existsSync(snapPath)) {
    console.error(`ERROR: readonly snapshot not found at ${snapPath}. Run "save" before dispatch.`);
    process.exit(2);
  }

  const allowList = [];
  for (let i = 2; i < args.length; i++) {
    if (args[i] === '--allow') {
      while (i + 1 < args.length && !args[i + 1].startsWith('--')) {
        allowList.push(normalizeRelPath(args[i + 1], cwd));
        i++;
      }
    }
  }

  const ignorePatterns = parseIgnorePathsFromTask(taskDir);
  const beforeSnap = JSON.parse(fs.readFileSync(snapPath, 'utf8'));
  const afterSnap = captureReadonlySnapshot(taskDir, cwd);

  const allKeys = new Set([...Object.keys(beforeSnap), ...Object.keys(afterSnap)]);
  const violations = [];

  for (const key of Array.from(allKeys).sort()) {
    if (key === '__GIT_HEAD__') {
      if (beforeSnap[key] !== afterSnap[key]) {
        violations.push({ path: 'GIT_HEAD', before: beforeSnap[key], after: afterSnap[key] });
      }
      continue;
    }
    if (isIgnoredPath(key, ignorePatterns) && !key.startsWith(normalizeRelPath(taskDir, cwd))) {
      continue;
    }
    const isAllowed = allowList.some(
      (allowed) => key === allowed || key.startsWith(allowed.replace(/\/$/, '') + '/')
    );
    if (isAllowed) continue;

    const b = beforeSnap[key] ?? 'ABSENT';
    const a = afterSnap[key] ?? 'ABSENT';
    if (b !== a) {
      violations.push({ path: key, before: b, after: a });
    }
  }

  const ok = violations.length === 0;
  const isGit = isGitRepo(cwd);
  console.log(
    JSON.stringify(
      {
        ok,
        mode: isGit ? 'git' : 'non_git',
        allowed: allowList,
        violations,
        ...(isGit ? {} : { note: 'non-git: verification only covers the task directory' }),
      },
      null,
      2
    )
  );
  if (!ok) {
    process.exit(3);
  }
}

/**
 * 6. lint — static consistency check of the dev-pipeline skill files
 */
function cmdLint() {
  const requiredFiles = [
    'SKILL.md',
    'roles.md',
    'pipelines/dev.md',
    'pipelines/design-review.md',
    'pipelines/impl-verify.md',
    'pipelines/bugfix-verify.md',
    'agents/pipeline-explorer.md',
    'agents/pipeline-designer.md',
    'agents/pipeline-design-reviewer.md',
    'agents/pipeline-implementer.md',
    'agents/pipeline-verifier.md',
    'agents/pipeline-code-reviewer.md',
    'slots/pipeline-primary.md',
    'slots/pipeline-peer.md',
    'slots/pipeline-executor.md',
    'references/start.md',
    'references/comms.md',
    'scripts/pipeline-ctl.mjs',
    'maint/authoring.md',
    'maint/dry-run.md',
    'maint/design-notes.md',
  ];

  const errors = [];
  for (const rel of requiredFiles) {
    const full = path.join(SKILL_ROOT, rel);
    if (!fs.existsSync(full)) {
      errors.push(`Missing required file: ${rel}`);
    }
  }

  // Agent contracts must be plain markdown: no YAML frontmatter (bindings live in slots/)
  const agentFiles = requiredFiles.filter((f) => f.startsWith('agents/'));
  for (const rel of agentFiles) {
    const full = path.join(SKILL_ROOT, rel);
    if (!fs.existsSync(full)) continue;
    const text = fs.readFileSync(full, 'utf8');
    if (/^---\n/.test(text)) {
      errors.push(`${rel}: agent contracts must not contain YAML frontmatter`);
    }
  }

  // Slot templates: required frontmatter fields, name matches filename, peer must not have Edit
  const slotFiles = requiredFiles.filter((f) => f.startsWith('slots/'));
  for (const rel of slotFiles) {
    const full = path.join(SKILL_ROOT, rel);
    if (!fs.existsSync(full)) continue;
    const text = fs.readFileSync(full, 'utf8');
    const fmMatch = text.match(/^---\n([\s\S]*?)\n---/);
    if (!fmMatch) {
      errors.push(`${rel}: Missing YAML frontmatter`);
      continue;
    }
    const fm = fmMatch[1];
    for (const field of ['name:', 'description:', 'model:', 'tools:']) {
      if (!fm.includes(field)) {
        errors.push(`${rel}: Frontmatter missing "${field}"`);
      }
    }
    const nameMatch = fm.match(/^name:\s*(\S+)/m);
    if (nameMatch && nameMatch[1] !== path.basename(rel, '.md')) {
      errors.push(`${rel}: frontmatter name "${nameMatch[1]}" does not match filename`);
    }
    if (rel === 'slots/pipeline-peer.md' && /\bEdit\b/.test(fm)) {
      errors.push(`${rel}: peer slot must not have Edit tool in frontmatter`);
    }
  }

  // Verify obsolete files or references are not present in runtime files
  const runtimeFiles = requiredFiles.filter((f) => !f.startsWith('maint/') && !f.startsWith('scripts/'));
  const forbiddenTokens = [
    { pattern: /state\.md/, label: 'obsolete state.md reference' },
    { pattern: /metrics\.md/, label: 'obsolete metrics.md reference' },
    { pattern: /references\/preflight\.md/, label: 'obsolete preflight.md path' },
    { pattern: /references\/launch\.md/, label: 'obsolete launch.md path' },
    { pattern: /references\/accounting\.md/, label: 'obsolete accounting.md path' },
    { pattern: /references\/recovery\.md/, label: 'obsolete recovery.md path' },
    { pattern: /references\/concurrency\.md/, label: 'obsolete concurrency.md path' },
    { pattern: /references\/piece-acceptance\.md/, label: 'obsolete piece-acceptance.md path' },
    { pattern: /BLOCKED\(拆分过粗\)/, label: 'obsolete BLOCKED(拆分过粗)' },
    { pattern: /\bfast\b/, label: 'obsolete fast slot name (renamed to executor)' },
  ];

  for (const rel of runtimeFiles) {
    const full = path.join(SKILL_ROOT, rel);
    if (!fs.existsSync(full)) continue;
    const text = fs.readFileSync(full, 'utf8');
    for (const { pattern, label } of forbiddenTokens) {
      if (pattern.test(text)) {
        errors.push(`${rel}: Contains ${label}`);
      }
    }
  }

  console.log(
    JSON.stringify(
      {
        ok: errors.length === 0,
        checked_files: requiredFiles.length,
        errors,
      },
      null,
      2
    )
  );
  if (errors.length > 0) {
    process.exit(1);
  }
}

// CLI Router
const [, , subcmd, ...restArgs] = process.argv;
switch (subcmd) {
  case 'install':
    cmdInstall(restArgs);
    break;
  case 'init':
    cmdInit(restArgs);
    break;
  case 'status':
    cmdStatus(restArgs);
    break;
  case 'check-scope':
    cmdCheckScope(restArgs);
    break;
  case 'verify-readonly':
    cmdVerifyReadonly(restArgs);
    break;
  case 'lint':
    cmdLint();
    break;
  default:
    console.error(
      'Usage: pipeline-ctl.mjs <install|init|status|check-scope|verify-readonly|lint> [args...]'
    );
    process.exit(1);
}
