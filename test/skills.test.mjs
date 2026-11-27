import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { createSkillManager, isValidSkillName, readSkillDescription } from '../src/skills.mjs';
import { tempHome } from './helpers.mjs';

function makeEnv(t) {
  const root = tempHome();
  const builtinDir = path.join(root, 'builtin');
  const skillsDir = path.join(builtinDir, 'skills');
  const backupDir = path.join(root, 'skills-backup');
  fs.mkdirSync(skillsDir, { recursive: true });
  fs.writeFileSync(path.join(builtinDir, '.checksum'), 'abc123\n');
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const writeSkill = (name, desc = `Skill ${name}`, extra = 'v1') => {
    const dir = path.join(skillsDir, name);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(
      path.join(dir, 'SKILL.md'),
      `---\nname: ${name}\ndescription: ${desc}\n---\n\n# ${name}\n${extra}\n`
    );
  };
  return { root, builtinDir, skillsDir, backupDir, writeSkill };
}

test('skill name validation accepts plain folder names and rejects traversal or hidden files', () => {
  assert.ok(isValidSkillName('antigravity_guide'));
  assert.ok(isValidSkillName('agy-customizations'));
  assert.ok(isValidSkillName('skill.v1'));
  for (const bad of ['', '.', '..', '.checksum', '.hidden', '../escape', 'a/b', 'a\\b', 'bad name', 'x'.repeat(121), null, 42]) {
    assert.ok(!isValidSkillName(bad), String(bad));
  }
});

test('readSkillDescription reads frontmatter description and trims quotes', (t) => {
  const { skillsDir, writeSkill } = makeEnv(t);
  writeSkill('custom_one', '"Manage custom workflows and checks."');
  assert.equal(readSkillDescription(path.join(skillsDir, 'custom_one')), 'Manage custom workflows and checks.');
  assert.equal(readSkillDescription(path.join(skillsDir, 'missing')), '');
});

test('disabling moves skill folders to backup while keeping .checksum and other skills intact', (t) => {
  const { builtinDir, skillsDir, backupDir, writeSkill } = makeEnv(t);
  writeSkill('antigravity_guide');
  writeSkill('automation');
  const logs = [];
  const manager = createSkillManager({ builtinDir, backupDir, log: (m) => logs.push(m) });

  let view = manager.status([]);
  assert.equal(view.available, true);
  assert.equal(view.checksumPresent, true);
  assert.deepEqual(
    view.items.map((s) => [s.name, s.enabled, s.present, s.backedUp]),
    [
      ['antigravity_guide', true, true, false],
      ['automation', true, true, false],
    ]
  );

  const out = manager.reconcile(['antigravity_guide']);
  assert.deepEqual(out, { moved: ['antigravity_guide'], restored: [] });
  assert.equal(fs.existsSync(path.join(skillsDir, 'antigravity_guide')), false);
  assert.equal(fs.existsSync(path.join(backupDir, 'antigravity_guide', 'SKILL.md')), true);
  assert.equal(fs.existsSync(path.join(skillsDir, 'automation', 'SKILL.md')), true);
  assert.equal(fs.readFileSync(path.join(builtinDir, '.checksum'), 'utf8'), 'abc123\n');

  view = manager.status(['antigravity_guide']);
  assert.deepEqual(
    view.items.map((s) => [s.name, s.enabled, s.present, s.backedUp]),
    [
      ['antigravity_guide', false, false, true],
      ['automation', true, true, false],
    ]
  );

  // Re-enabling restores from backup and removes the backup copy.
  const back = manager.reconcile([]);
  assert.deepEqual(back, { moved: [], restored: ['antigravity_guide'] });
  assert.equal(fs.existsSync(path.join(skillsDir, 'antigravity_guide', 'SKILL.md')), true);
  assert.equal(fs.existsSync(path.join(backupDir, 'antigravity_guide')), false);
  assert.equal(logs.length, 2);
});

test('an app update that unpacks a disabled skill refreshes the backup with the new version', (t) => {
  const { builtinDir, skillsDir, backupDir, writeSkill } = makeEnv(t);
  writeSkill('antigravity_guide', 'Guide', 'version-1');
  const manager = createSkillManager({ builtinDir, backupDir });
  manager.reconcile(['antigravity_guide']);

  // Simulate an app update unpacking version-2 into builtin/skills.
  writeSkill('antigravity_guide', 'Guide', 'version-2');
  manager.reconcile(['antigravity_guide']);
  assert.equal(fs.existsSync(path.join(skillsDir, 'antigravity_guide')), false);

  // Restoring brings back version-2, not version-1.
  manager.restoreAll();
  assert.match(fs.readFileSync(path.join(skillsDir, 'antigravity_guide', 'SKILL.md'), 'utf8'), /version-2/);
  assert.equal(fs.existsSync(backupDir), false);
});

test('missing .checksum is reported, and symlinks are never followed', (t) => {
  const { root, builtinDir, skillsDir, backupDir, writeSkill } = makeEnv(t);
  fs.rmSync(path.join(builtinDir, '.checksum'));
  writeSkill('real_skill', 'Custom description from frontmatter.');
  const outside = path.join(root, 'outside');
  fs.mkdirSync(outside);
  fs.writeFileSync(path.join(outside, 'SKILL.md'), 'keep');
  fs.symlinkSync(outside, path.join(skillsDir, 'linked_skill'));

  const manager = createSkillManager({ builtinDir, backupDir });
  const out = manager.reconcile(['linked_skill']);
  assert.deepEqual(out, { moved: [], restored: [] });
  assert.equal(fs.existsSync(path.join(outside, 'SKILL.md')), true);

  const view = manager.status(['real_skill']);
  assert.equal(view.checksumPresent, false);
  assert.deepEqual(view.items.map((s) => s.name), ['real_skill']);
  assert.equal(view.items[0].description.en, 'Custom description from frontmatter.');
});
