// Manages the builtin skill folders Antigravity materializes under ~/.gemini/antigravity/builtin/skills.
//
// Antigravity compares builtin/.checksum on startup before unpacking its builtin folders.
// Moving an unwanted skill folder into our backup folder while leaving builtin/.checksum
// untouched keeps that skill out of prompts without affecting the remaining builtin skills.
// When Antigravity updates, its checksum changes and it unpacks every folder again; the
// periodic reconcile refreshes the backup copy from the newly unpacked folder and moves it
// aside again. Turning agy-plus off or uninstalling restores every backed-up folder.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export const DEFAULT_SKILL_TARGETS = Object.freeze(['antigravity_guide']);

const SKILL_NAME_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,119}$/;

/** Concise descriptions for known builtin skills; unknown ones fall back to SKILL.md. */
const KNOWN_DESCRIPTIONS = Object.freeze({
  'agy-customizations': {
    zh: 'Antigravity 自定义体系（Skills、Rules、Plugins、Hooks、MCP）的说明与编写指南。',
    en: 'Reference guide for creating Skills, Rules, Plugins, Hooks, and MCP servers.',
  },
  antigravity_guide: {
    zh: 'Antigravity 桌面端、CLI、IDE 与 SDK 的使用说明与文档索引（体积较大）。',
    en: 'Product guide and documentation sitemap for Antigravity, CLI, IDE, and SDK.',
  },
  automation: {
    zh: '引导创建定时后台任务（/automation）的说明。',
    en: 'Interactive guide for creating scheduled background automations.',
  },
  conversations: {
    zh: '通过本地接口列出、重命名、归档或创建对话的说明。',
    en: 'Programmatic management of local Antigravity conversations.',
  },
  generative_ui: {
    zh: '在对话或工件中生成可交互 HTML 小部件的说明。',
    en: 'Instructions for rendering interactive HTML widgets inline or as artifacts.',
  },
  'mcp-app-development': {
    zh: '开发、打包与调试带交互界面的 MCP App 的说明。',
    en: 'Guide for building, packaging, and debugging interactive MCP Apps.',
  },
  'migrate-agent-settings': {
    zh: '从 Claude Code、Codex、Cursor、Gemini CLI 迁移配置的说明。',
    en: 'Migrates settings, skills, and MCP servers from other coding agents.',
  },
  'migrate-workflows': {
    zh: '将旧版 workflows 迁移为新版 SKILL.md 的说明。',
    en: 'Migrates legacy workflow files to modern SKILL.md skills.',
  },
  plugin: {
    zh: '管理与创建 Antigravity 插件包（/plugin）的说明。',
    en: 'Guide for managing and authoring Antigravity plugins.',
  },
  'run-workflow': {
    zh: '使用 run_workflow 编写多代理编排脚本的说明。',
    en: 'Reference for writing Python multi-agent orchestration workflows.',
  },
  swarm_monitor: {
    zh: '供 /swarm 监控子代理使用的巡检说明。',
    en: 'Instructions for the monitor worker in an active /swarm session.',
  },
  swarm_pane: {
    zh: '供 /swarm 协调代理维护概览面板的说明。',
    en: 'Instructions for the coordinator of an active /swarm session.',
  },
  'ui-plugin-navigation': {
    zh: '在对话中提供一键打开侧栏 UI 插件面板按钮的说明。',
    en: 'Surfaces quick-open pills in chat for installed UI plugin panels.',
  },
});

export function isValidSkillName(name) {
  return typeof name === 'string' && SKILL_NAME_RE.test(name) && !name.includes('..');
}

/** AGY_BUILTIN_DIR overrides the location (matching skills-toggle.sh and tests). */
export function defaultBuiltinDir() {
  if (process.env.AGY_BUILTIN_DIR) return process.env.AGY_BUILTIN_DIR;
  return path.join(os.homedir(), '.gemini', 'antigravity', 'builtin');
}

function isRealDirectory(dir) {
  try {
    return fs.lstatSync(dir).isDirectory();
  } catch {
    return false;
  }
}

function listSkillDirs(parent) {
  if (!isRealDirectory(parent)) return [];
  try {
    return fs
      .readdirSync(parent)
      .filter((name) => isValidSkillName(name) && isRealDirectory(path.join(parent, name)))
      .sort();
  } catch {
    return [];
  }
}

/** Read a short plain-text description out of SKILL.md frontmatter, if present. */
export function readSkillDescription(dir) {
  const file = path.join(dir, 'SKILL.md');
  let head = '';
  try {
    const fd = fs.openSync(file, 'r');
    try {
      const buf = Buffer.alloc(4096);
      const n = fs.readSync(fd, buf, 0, buf.length, 0);
      head = buf.subarray(0, n).toString('utf8');
    } finally {
      fs.closeSync(fd);
    }
  } catch {
    return '';
  }
  const fm = /^---\r?\n([\s\S]*?)\r?\n---/.exec(head);
  if (!fm) return '';
  const m = /^description:\s*(.+)$/m.exec(fm[1]);
  if (!m) return '';
  const text = m[1].trim().replace(/^(['"])(.*)\1$/, '$2').replace(/\s+/g, ' ').trim();
  return text.length > 180 ? `${text.slice(0, 180)}…` : text;
}

function describeSkill(name, dir) {
  if (Object.hasOwn(KNOWN_DESCRIPTIONS, name)) return KNOWN_DESCRIPTIONS[name];
  const fallback = dir ? readSkillDescription(dir) : '';
  return { zh: fallback, en: fallback };
}

/**
 * Create a manager for builtin skill directories.
 * @param {object} options
 * @param {string} [options.builtinDir]  Antigravity's `builtin` folder.
 * @param {string} options.backupDir     Where disabled skill folders are stored.
 * @param {(msg: string) => void} [options.log]
 */
export function createSkillManager({ builtinDir = defaultBuiltinDir(), backupDir, log = () => {} }) {
  const skillsDir = path.join(builtinDir, 'skills');
  const checksumFile = path.join(builtinDir, '.checksum');

  /**
   * Move every folder in `disabledNames` out of `builtin/skills` into `backupDir`, and
   * restore any backed-up folder that is no longer in `disabledNames`.
   */
  function reconcile(disabledNames = []) {
    const disabled = new Set((Array.isArray(disabledNames) ? disabledNames : []).filter(isValidSkillName));
    const moved = [];
    const restored = [];

    for (const name of disabled) {
      const src = path.join(skillsDir, name);
      if (!isRealDirectory(src)) continue;
      const dst = path.join(backupDir, name);
      const staging = `${dst}.${process.pid}.tmp`;
      try {
        fs.mkdirSync(backupDir, { recursive: true, mode: 0o700 });
        fs.rmSync(staging, { recursive: true, force: true });
        fs.cpSync(src, staging, { recursive: true });
        fs.rmSync(dst, { recursive: true, force: true });
        fs.renameSync(staging, dst);
        if (isRealDirectory(dst)) {
          fs.rmSync(src, { recursive: true, force: true });
          moved.push(name);
        }
      } catch (err) {
        try {
          fs.rmSync(staging, { recursive: true, force: true });
        } catch {
          // ignore cleanup error
        }
        log(`builtin skills: could not move ${name}: ${err?.message || err}`);
      }
    }

    for (const name of listSkillDirs(backupDir)) {
      if (disabled.has(name)) continue;
      if (!isRealDirectory(builtinDir)) continue;
      const src = path.join(backupDir, name);
      const dst = path.join(skillsDir, name);
      try {
        if (!fs.existsSync(dst)) {
          fs.mkdirSync(skillsDir, { recursive: true });
          fs.cpSync(src, dst, { recursive: true });
          restored.push(name);
        }
        if (isRealDirectory(dst)) {
          fs.rmSync(src, { recursive: true, force: true });
        }
      } catch (err) {
        log(`builtin skills: could not restore ${name}: ${err?.message || err}`);
      }
    }

    if (moved.length > 0) log(`builtin skills moved to backup: ${moved.join(', ')}`);
    if (restored.length > 0) log(`builtin skills restored: ${restored.join(', ')}`);
    return { moved, restored };
  }

  /** Restore every backed-up skill folder and remove the backup directory if empty. */
  function restoreAll() {
    const out = reconcile([]);
    try {
      if (isRealDirectory(backupDir) && fs.readdirSync(backupDir).length === 0) {
        fs.rmSync(backupDir, { recursive: true, force: true });
      }
    } catch {
      // best effort
    }
    return out;
  }

  /** Current view of all builtin skills for the settings page and CLI status. */
  function status(disabledNames = []) {
    const disabledList = [...new Set((Array.isArray(disabledNames) ? disabledNames : []).filter(isValidSkillName))];
    const disabled = new Set(disabledList);
    const available = isRealDirectory(builtinDir);
    const checksumPresent = available && fs.existsSync(checksumFile);
    const present = new Set(listSkillDirs(skillsDir));
    const backedUp = new Set(listSkillDirs(backupDir));
    const allNames = [...new Set([...present, ...backedUp, ...(available ? disabledList : [])])].sort();
    const items = allNames.map((name) => {
      const isPresent = present.has(name);
      const isBackedUp = backedUp.has(name);
      const dir = isPresent ? path.join(skillsDir, name) : isBackedUp ? path.join(backupDir, name) : null;
      return {
        name,
        enabled: !disabled.has(name),
        present: isPresent,
        backedUp: isBackedUp,
        description: describeSkill(name, dir),
      };
    });
    return {
      builtinDir,
      available,
      checksumPresent,
      disabled: disabledList,
      items,
    };
  }

  return { reconcile, restoreAll, status };
}
