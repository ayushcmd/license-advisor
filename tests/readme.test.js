import { it } from 'node:test';
import assert from 'node:assert/strict';
import { LICENSE_CATALOG } from '../public/js/catalog-data.js';
import { updateReadmeLicense } from '../public/js/readme.js';

const apache = LICENSE_CATALOG.find((license) => license.id === 'Apache-2.0');
it('adds top, bottom or both while preserving the existing README and remaining repeatable', () => {
  for (const newline of ['\n', '\r\n']) {
    for (const placement of ['top', 'bottom', 'both']) {
      const original = `# Project${newline}${newline}Existing content with café.\n`.replace(/\r?\n/g, newline);
      const updated = updateReadmeLicense(original, apache, placement, '../LICENSE.md');
      assert.ok(updated.includes(original));
      assert.ok(updated.includes('(../LICENSE.md)'));
      assert.equal(updated.includes('img.shields.io'), placement !== 'bottom');
      assert.equal(updated.includes('## License'), placement !== 'top');
      assert.equal(updateReadmeLicense(updated, apache, placement, '../LICENSE.md'), updated);
      if (newline === '\r\n') assert.doesNotMatch(updated, /(?<!\r)\n/);
    }
  }
});

it('keeps front matter first and replaces previous managed mentions when changing the license or placement', () => {
  const original = '---\ntitle: Demo\n---\n# Demo\n';
  const first = updateReadmeLicense(original, apache, 'both');
  assert.ok(first.startsWith('---\ntitle: Demo\n---\n'));
  const mit = LICENSE_CATALOG.find((license) => license.id === 'MIT');
  const changed = updateReadmeLicense(first, mit, 'bottom');
  assert.doesNotMatch(changed, /Apache|shields/);
  assert.equal((changed.match(/## License/g) || []).length, 1);
  assert.ok(changed.includes('# Demo\n'));
});

it('supports all license names and leaves the README untouched when disabled', () => {
  for (const license of LICENSE_CATALOG) {
    const text = updateReadmeLicense('', license, 'both');
    assert.ok(text.includes(`[${license.name}](LICENSE)`));
    if (license.id === 'Unlicense') assert.match(text, /Released into the public domain/);
  }
  assert.equal(updateReadmeLicense('unchanged', apache, 'none'), 'unchanged');
  assert.throws(() => updateReadmeLicense('', apache, 'invalid'));
});

it('preserves custom license and attribution text rather than deleting it', () => {
  const original = '# Demo\n\n## License & Attribution\n\nKeep upstream notices.\n';
  const updated = updateReadmeLicense(original, apache, 'both');
  assert.ok(updated.includes(original));
});
