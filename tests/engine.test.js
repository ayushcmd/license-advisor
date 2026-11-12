import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  LICENSE_CATALOG,
  LICENSE_BY_ID,
  SPDX_DATA_VERSION,
  getLicenseById
} from '../public/js/catalog-data.js';
import {
  RECOMMENDATION_CRITERIA_SCHEMA,
  auditCompatibility,
  checkCompatibility,
  compareLicenses,
  explainLicense,
  recommendLicenses,
  resolveLicense
} from '../public/js/engine.js';
import {
  generateFileHeader,
  generateLicensePackage,
  generateLicenseText
} from '../public/js/generator.js';

describe('SPDX License Catalog Integrity', () => {
  it('contains all 12 verified OSI-approved SPDX licenses with complete metadata and official texts', () => {
    const expectedIds = [
      'MIT',
      'ISC',
      'BSD-2-Clause',
      'BSD-3-Clause',
      'Apache-2.0',
      'MPL-2.0',
      'EPL-2.0',
      'LGPL-3.0-only',
      'GPL-2.0-only',
      'GPL-3.0-only',
      'AGPL-3.0-only',
      'Unlicense'
    ];

    assert.ok(SPDX_DATA_VERSION.length > 0);
    assert.equal(LICENSE_CATALOG.length, 12);
    assert.deepEqual(
      LICENSE_CATALOG.map((item) => item.id),
      expectedIds
    );

    for (const license of LICENSE_CATALOG) {
      assert.equal(LICENSE_BY_ID[license.id], license);
      assert.equal(license.osiApproved, true, `${license.id} should be OSI approved`);
      assert.equal(license.fsfLibre, true, `${license.id} should be FSF libre`);
      assert.ok(license.licenseText.length > 500, `${license.id} licenseText must be complete`);
      assert.ok(license.sourceUrls.spdx.startsWith('https://spdx.org/licenses/'));
      assert.ok(license.sourceUrls.official.startsWith('https://'));
      assert.ok(Array.isArray(license.permissions) && license.permissions.length > 0);
      assert.ok(Array.isArray(license.conditions));
      assert.ok(Array.isArray(license.limitations) && license.limitations.length > 0);
      assert.equal(typeof license.flags.networkUseTrigger, 'boolean');
      assert.ok(['explicit', 'none'].includes(license.flags.patentGrant));
    }
  });

  it('resolves exact, case-insensitive, and legacy GitHub SPDX identifiers safely', () => {
    assert.equal(getLicenseById('mit')?.id, 'MIT');
    assert.equal(getLicenseById('apache-2.0')?.id, 'Apache-2.0');
    assert.equal(getLicenseById('non-existent'), null);
    assert.equal(getLicenseById(null), null);

    assert.equal(resolveLicense('GPL-3.0')?.id, 'GPL-3.0-only');
    assert.equal(resolveLicense('GPL-2.0')?.id, 'GPL-2.0-only');
    assert.equal(resolveLicense('LGPL-3.0')?.id, 'LGPL-3.0-only');
    assert.equal(resolveLicense('AGPL-3.0')?.id, 'AGPL-3.0-only');
  });
});

describe('Deterministic Recommendation Engine (Policy-Driven, Language-Agnostic)', () => {
  it('exposes complete policy questionnaire schema', () => {
    assert.ok(RECOMMENDATION_CRITERIA_SCHEMA.length >= 8);
    assert.ok(RECOMMENDATION_CRITERIA_SCHEMA.every((q) => q.key && Array.isArray(q.options)));
  });

  it('never alters recommendations based on programming language', () => {
    const baseCriteria = {
      copyleftPreference: 'permissive',
      allowProprietaryUse: 'yes',
      patentProtection: 'preferred',
      simplicityPreference: 'balanced'
    };

    const pythonRun = recommendLicenses({ ...baseCriteria, language: 'Python' });
    const rustRun = recommendLicenses({ ...baseCriteria, language: 'Rust' });
    const jsRun = recommendLicenses({ ...baseCriteria, language: 'JavaScript' });

    assert.equal(pythonRun.languageIgnored, true);
    assert.deepEqual(
      pythonRun.recommendations.map((r) => ({ id: r.id, score: r.score })),
      rustRun.recommendations.map((r) => ({ id: r.id, score: r.score }))
    );
    assert.deepEqual(
      pythonRun.recommendations.map((r) => ({ id: r.id, score: r.score })),
      jsRun.recommendations.map((r) => ({ id: r.id, score: r.score }))
    );
  });

  it('recommends MIT first for minimal permissive goals without patent requirements', () => {
    const result = recommendLicenses({
      copyleftPreference: 'permissive',
      allowProprietaryUse: 'yes',
      patentProtection: 'not-needed',
      simplicityPreference: 'minimal',
      requireNoticeAttribution: 'required'
    });

    assert.equal(result.topRecommendation?.id, 'MIT');
    assert.ok(result.recommendations.every((r) => r.category === 'permissive'));
  });

  it('selects Apache-2.0 exclusively when permissive posture requires explicit patent grant', () => {
    const result = recommendLicenses({
      copyleftPreference: 'permissive',
      allowProprietaryUse: 'yes',
      patentProtection: 'required'
    });

    assert.equal(result.topRecommendation?.id, 'Apache-2.0');
    assert.deepEqual(
      result.recommendations.map((r) => r.id),
      ['Apache-2.0']
    );
    const mitDisqualified = result.disqualified.find((d) => d.id === 'MIT');
    assert.ok(mitDisqualified);
    assert.ok(mitDisqualified.disqualifiers.some((msg) => msg.toLowerCase().includes('patent')));
  });

  it('selects BSD-3-Clause when permissive non-endorsement is required without explicit patents', () => {
    const result = recommendLicenses({
      copyleftPreference: 'permissive',
      allowProprietaryUse: 'yes',
      restrictEndorsement: 'required',
      patentProtection: 'not-needed',
      simplicityPreference: 'minimal'
    });

    assert.equal(result.topRecommendation?.id, 'BSD-3-Clause');
    assert.deepEqual(
      result.recommendations.map((r) => r.id),
      ['BSD-3-Clause', 'Apache-2.0']
    );
  });

  it('distinguishes library vs standalone application under weak copyleft', () => {
    const libraryResult = recommendLicenses({
      copyleftPreference: 'weak-copyleft',
      isLibrary: 'yes',
      patentProtection: 'required'
    });
    assert.equal(libraryResult.topRecommendation?.id, 'LGPL-3.0-only');

    const appResult = recommendLicenses({
      copyleftPreference: 'weak-copyleft',
      isLibrary: 'no',
      patentProtection: 'required'
    });
    assert.equal(appResult.topRecommendation?.id, 'MPL-2.0');
  });

  it('selects GPL-3.0-only over GPL-2.0-only for strong copyleft when avoiding network triggers', () => {
    const result = recommendLicenses({
      copyleftPreference: 'strong-copyleft',
      allowProprietaryUse: 'no',
      networkUseTrigger: 'avoid',
      patentProtection: 'preferred'
    });

    assert.equal(result.topRecommendation?.id, 'GPL-3.0-only');
    assert.ok(result.disqualified.some((d) => d.id === 'AGPL-3.0-only'));
  });

  it('selects AGPL-3.0-only exclusively when network-use source trigger is required', () => {
    const result = recommendLicenses({
      copyleftPreference: 'any',
      allowProprietaryUse: 'no',
      networkUseTrigger: 'required'
    });

    assert.equal(result.topRecommendation?.id, 'AGPL-3.0-only');
    assert.deepEqual(
      result.recommendations.map((r) => r.id),
      ['AGPL-3.0-only']
    );
  });

  it('selects The Unlicense when notice retention is waived', () => {
    const result = recommendLicenses({
      copyleftPreference: 'any',
      requireNoticeAttribution: 'none',
      patentProtection: 'not-needed'
    });

    assert.equal(result.topRecommendation?.id, 'Unlicense');
    assert.deepEqual(
      result.recommendations.map((r) => r.id),
      ['Unlicense']
    );
  });

  it('detects contradictory policy constraints cleanly without falling back silently', () => {
    const result = recommendLicenses({
      copyleftPreference: 'permissive',
      allowProprietaryUse: 'yes',
      networkUseTrigger: 'required'
    });

    assert.equal(result.topRecommendation, null);
    assert.equal(result.recommendations.length, 0);
    assert.ok(result.conflicts.length > 0);
    assert.match(result.summary, /No single license/i);
  });
});

describe('License Compatibility Matrix & Dependency-Aware Filtering', () => {
  it('verifies known FSF/SPDX compatibility boundaries accurately', () => {
    assert.equal(checkCompatibility('GPL-3.0-only', 'Apache-2.0').status, 'compatible');
    assert.equal(checkCompatibility('GPL-2.0-only', 'Apache-2.0').status, 'incompatible');
    assert.equal(checkCompatibility('MIT', 'Apache-2.0').status, 'conditional');

    assert.equal(checkCompatibility('AGPL-3.0-only', 'GPL-3.0-only').status, 'compatible');
    assert.equal(checkCompatibility('GPL-2.0-only', 'GPL-3.0-only').status, 'incompatible');
    assert.equal(checkCompatibility('MIT', 'GPL-3.0-only').status, 'incompatible');

    assert.equal(checkCompatibility('GPL-3.0-only', 'MPL-2.0').status, 'compatible');
    assert.equal(checkCompatibility('MIT', 'MPL-2.0').status, 'conditional');

    assert.equal(checkCompatibility('GPL-3.0-only', 'EPL-2.0').status, 'incompatible');
    assert.equal(checkCompatibility('MIT', 'EPL-2.0').status, 'conditional');

    assert.equal(checkCompatibility('MIT', 'LGPL-3.0-only').status, 'conditional');
    assert.equal(checkCompatibility('GPL-3.0-only', 'LGPL-3.0-only').status, 'compatible');
    assert.equal(checkCompatibility('GPL-2.0-only', 'LGPL-3.0-only').status, 'incompatible');

    assert.equal(checkCompatibility('MIT', 'CUSTOM-LICENSE').status, 'unknown');
  });

  it('disqualifies GPL-2.0-only when project declares an Apache-2.0 dependency', () => {
    const result = recommendLicenses({
      copyleftPreference: 'strong-copyleft',
      patentProtection: 'not-needed',
      dependencyLicenses: ['Apache-2.0']
    });

    assert.equal(result.topRecommendation?.id, 'GPL-3.0-only');
    assert.deepEqual(
      result.recommendations.map((r) => r.id),
      ['GPL-3.0-only']
    );
    const gpl2Disq = result.disqualified.find((d) => d.id === 'GPL-2.0-only');
    assert.ok(gpl2Disq);
    assert.ok(gpl2Disq.disqualifiers.some((m) => m.includes('Apache-2.0')));
  });

  it('audits multiple dependency licenses and aggregates worst status', () => {
    const auditOk = auditCompatibility('GPL-3.0-only', ['MIT', 'Apache-2.0', 'MPL-2.0']);
    assert.equal(auditOk.overallStatus, 'compatible');

    const auditConditional = auditCompatibility('MIT', ['ISC', 'LGPL-3.0-only']);
    assert.equal(auditConditional.overallStatus, 'conditional');
    assert.equal(auditConditional.conditionalCount, 1);

    const auditBlocked = auditCompatibility('MIT', ['ISC', 'GPL-3.0-only']);
    assert.equal(auditBlocked.overallStatus, 'incompatible');
    assert.equal(auditBlocked.incompatibleCount, 1);
  });
});

describe('Plain-Language Explanations & Side-by-Side Comparison', () => {
  it('explains permissions, conditions, limitations, and network triggers clearly', () => {
    const agpl = explainLicense('AGPL-3.0-only');
    assert.ok(agpl);
    assert.equal(agpl.id, 'AGPL-3.0-only');
    assert.ok(agpl.canDo.some((item) => item.key === 'patent-use'));
    assert.ok(agpl.mustDo.some((item) => item.key === 'network-use-disclose'));
    assert.match(agpl.policyHighlights.networkUseTrigger, /Yes/);
    assert.equal(explainLicense('UNKNOWN-ID'), null);
  });

  it('builds a side-by-side comparison matrix preserving valid licenses and reporting unknown IDs', () => {
    const matrix = compareLicenses(['MIT', 'Apache-2.0', 'GPL-3.0-only', 'AGPL-3.0-only', 'FAKE']);
    assert.equal(matrix.licenses.length, 4);
    assert.deepEqual(matrix.unknownIds, ['FAKE']);
    assert.ok(matrix.rows.length >= 10);
    for (const row of matrix.rows) {
      assert.equal(row.values.length, 4);
    }
  });
});

describe('License Text & Source Header Generator', () => {
  it('populates copyright year and holder in MIT, ISC, BSD-2-Clause, and BSD-3-Clause', () => {
    for (const id of ['MIT', 'ISC', 'BSD-2-Clause', 'BSD-3-Clause']) {
      const text = generateLicenseText(id, { year: 2026, holder: 'ayushcmd' });
      assert.ok(text.includes('2026'), `${id} should include year`);
      assert.ok(text.includes('ayushcmd'), `${id} should include holder`);
      assert.equal(text.includes('<year>'), false, `${id} should not leak <year>`);
      assert.equal(text.includes('<copyright holders>'), false, `${id} should not leak <copyright holders>`);
      assert.equal(text.includes('<owner>'), false, `${id} should not leak <owner>`);
    }
  });

  it('supports year ranges and sanitizes multiline control input', () => {
    const text = generateLicenseText('MIT', {
      year: '2024 - 2026',
      holder: 'Ayush\nMaintainers'
    });
    assert.ok(text.includes('Copyright (c) 2024-2026 Ayush Maintainers'));
  });

  it('preserves verbatim official SPDX texts for full-body licenses', () => {
    const apacheText = generateLicenseText('Apache-2.0', { year: '2026', holder: 'ayushcmd' });
    assert.equal(apacheText, getLicenseById('Apache-2.0').licenseText);

    const gpl3Text = generateLicenseText('GPL-3.0-only', { year: '2026', holder: 'ayushcmd' });
    assert.equal(gpl3Text, getLicenseById('GPL-3.0-only').licenseText);
  });

  it('validates strict holder requirement and year format', () => {
    assert.throws(
      () => generateLicenseText('MIT', { year: '2026', holder: '', strict: true }),
      /Copyright holder name is required/
    );
    assert.throws(
      () => generateLicenseText('MIT', { year: 'twenty-six', holder: 'ayushcmd' }),
      /Invalid copyright year/
    );
    assert.throws(
      () => generateLicenseText('UNKNOWN-ID', { year: '2026', holder: 'ayushcmd' }),
      /Unknown or unsupported/
    );

    // Non-copyright-template licenses generate cleanly even with strict: true and empty holder
    assert.doesNotThrow(() => generateLicenseText('Unlicense', { strict: true }));
  });

  it('generates clean source file headers and complete license packages', () => {
    const apacheHeader = generateFileHeader('Apache-2.0', { year: '2026', holder: 'ayushcmd' });
    assert.ok(apacheHeader.includes('Copyright 2026 ayushcmd'));
    assert.equal(apacheHeader.includes('[yyyy]'), false);

    const gplHeader = generateFileHeader('GPL-3.0-only', {
      year: '2026',
      holder: 'ayushcmd',
      programName: 'License Advisor',
      programDescription: 'Open-source license helper'
    });
    assert.ok(gplHeader.includes('License Advisor - Open-source license helper'));
    assert.ok(gplHeader.includes('Copyright (C) 2026 ayushcmd'));

    const mitHeader = generateFileHeader('MIT', { year: '2026', holder: 'ayushcmd' });
    assert.ok(mitHeader.includes('SPDX-License-Identifier: MIT'));

    const pkg = generateLicensePackage('MIT', { year: '2026', holder: 'ayushcmd', strict: true });
    assert.equal(pkg.spdxId, 'MIT');
    assert.equal(pkg.filename, 'LICENSE');
    assert.equal(pkg.copyrightAppliedInLicense, true);
    assert.equal(pkg.metadata.holder, 'ayushcmd');
  });
});

