/**
 * Deterministic Open-Source License Recommendation & Compatibility Engine
 *
 * Evaluates repository licensing goals strictly through policy dimensions:
 * permissions, distribution requirements, copyleft obligations, patent clauses,
 * non-endorsement/trademark limits, and network-use triggers.
 *
 * Programming languages are NEVER used as a decision factor.
 */

import { LICENSE_CATALOG, RULE_GLOSSARY, getLicenseById } from './catalog-data.js';

const LEGACY_SPDX_ALIASES = Object.freeze({
  'gpl-2.0': 'GPL-2.0-only',
  'gpl-3.0': 'GPL-3.0-only',
  'lgpl-3.0': 'LGPL-3.0-only',
  'agpl-3.0': 'AGPL-3.0-only'
});

const CATEGORY_LABELS = Object.freeze({
  permissive: 'Permissive',
  'weak-copyleft': 'Weak Copyleft',
  'strong-copyleft': 'Strong Copyleft',
  'network-copyleft': 'Network Copyleft',
  'public-domain': 'Public Domain Dedication'
});

const COPYLEFT_SCOPE_DESCRIPTIONS = Object.freeze({
  none: 'No copyleft obligation; derivative works may be relicensed under permissive or proprietary terms.',
  file: 'File-level copyleft; modifications to existing covered files must stay under this license, while separate files may use other licenses.',
  module: 'Module-level copyleft; changes to covered modules must remain under this license, while separate modules may be licensed differently.',
  library: 'Library-level copyleft; modifications to the library stay under LGPL, while applications dynamically or relinkably linked to it may use other terms.',
  work: 'Whole-work strong copyleft; any distributed derivative or combined work must be licensed under the same terms with complete source access.',
  network: 'Network-triggered strong copyleft; both distribution and remote network operation (e.g., SaaS) require sharing complete Corresponding Source.'
});

/**
 * Deterministic tie-breaker ranking when two eligible licenses receive equal policy scores.
 * Reflects broad legal recognition and clarity without any language bias.
 */
const DEFAULT_PREFERENCE_ORDER = Object.freeze([
  'MIT',
  'Apache-2.0',
  'BSD-3-Clause',
  'BSD-2-Clause',
  'ISC',
  'MPL-2.0',
  'LGPL-3.0-only',
  'EPL-2.0',
  'GPL-3.0-only',
  'GPL-2.0-only',
  'AGPL-3.0-only',
  'Unlicense'
]);

/**
 * Declarative policy questionnaire definition consumed by UI and validation layers.
 */
export const RECOMMENDATION_CRITERIA_SCHEMA = Object.freeze([
  {
    key: 'copyleftPreference',
    label: 'Reciprocity & Copyleft Posture',
    description: 'How should downstream modifiers be required to share their changes?',
    defaultValue: 'any',
    options: [
      { value: 'any', label: 'Evaluate all postures based on the policy answers below' },
      { value: 'permissive', label: 'Permissive (allow proprietary & commercial derivatives)' },
      { value: 'weak-copyleft', label: 'Weak copyleft (modified files/modules/libraries stay open)' },
      { value: 'strong-copyleft', label: 'Strong copyleft (entire distributed derivative must stay open)' },
      { value: 'network-copyleft', label: 'Network copyleft (SaaS / network usage triggers source sharing)' },
      { value: 'public-domain', label: 'Public domain dedication (waive copyright & attribution requirements)' }
    ]
  },
  {
    key: 'allowProprietaryUse',
    label: 'Proprietary Derivative Reuse',
    description: 'Should companies or third parties be allowed to incorporate your code into closed-source products?',
    defaultValue: 'either',
    options: [
      { value: 'either', label: 'No strict preference' },
      { value: 'yes', label: 'Yes — permit closed-source / proprietary derivatives' },
      { value: 'no', label: 'No — require distributed derivatives to remain open source' }
    ]
  },
  {
    key: 'patentProtection',
    label: 'Explicit Patent Grant & Retaliation',
    description: 'Do you want contributors to grant explicit patent rights that terminate upon patent litigation?',
    defaultValue: 'preferred',
    options: [
      { value: 'required', label: 'Required — must include explicit patent grant and retaliation clause' },
      { value: 'preferred', label: 'Preferred — favor explicit patent terms when compatible with other goals' },
      { value: 'not-needed', label: 'Not needed — prioritize simplicity over explicit patent clauses' }
    ]
  },
  {
    key: 'networkUseTrigger',
    label: 'Network / SaaS Disclosure Trigger',
    description: 'Should running modified software remotely over a network require providing source code to users?',
    defaultValue: 'avoid',
    options: [
      { value: 'avoid', label: 'Avoid — distribution triggers disclosure, not remote hosting alone' },
      { value: 'required', label: 'Required — network / SaaS interaction must trigger source disclosure' },
      { value: 'either', label: 'Neutral — open to either behavior' }
    ]
  },
  {
    key: 'requireNoticeAttribution',
    label: 'Copyright & Attribution Notice',
    description: 'Must downstream redistributions preserve your copyright and license notice?',
    defaultValue: 'required',
    options: [
      { value: 'required', label: 'Required — preserve copyright & license notices' },
      { value: 'either', label: 'Optional — attribution acceptable or not required' },
      { value: 'none', label: 'None — dedicate to the public domain without notice conditions' }
    ]
  },
  {
    key: 'requireChangeDocumentation',
    label: 'State Changes on Distribution',
    description: 'Should redistributors who alter files be explicitly required to document their modifications?',
    defaultValue: 'not-needed',
    options: [
      { value: 'not-needed', label: 'Not needed — keeping notice intact is sufficient' },
      { value: 'preferred', label: 'Preferred — favor licenses requiring change documentation' },
      { value: 'required', label: 'Required — must require documenting modifications' }
    ]
  },
  {
    key: 'restrictEndorsement',
    label: 'Non-Endorsement / Trademark Guard',
    description: 'Do you want explicit clauses forbidding unauthorized endorsement using your name or trademarks?',
    defaultValue: 'not-needed',
    options: [
      { value: 'not-needed', label: 'Not needed' },
      { value: 'preferred', label: 'Preferred — favor non-endorsement or trademark limits' },
      { value: 'required', label: 'Required — must explicitly restrict endorsement or trademark use' }
    ]
  },
  {
    key: 'isLibrary',
    label: 'Distribution Role (Library vs Application)',
    description: 'Affects weak-copyleft scoping (e.g., library linking boundaries) — independent of programming language.',
    defaultValue: 'either',
    options: [
      { value: 'either', label: 'General software / either' },
      { value: 'yes', label: 'Reusable library or SDK linked by other applications' },
      { value: 'no', label: 'Standalone application, service, or modular tool' }
    ]
  },
  {
    key: 'simplicityPreference',
    label: 'License Text Length & Formality',
    description: 'Prefer concise, plain-text licenses or comprehensive legal precision?',
    defaultValue: 'balanced',
    options: [
      { value: 'minimal', label: 'Minimal — shortest readable text where policy allows' },
      { value: 'balanced', label: 'Balanced — standard clarity vs legal detail' },
      { value: 'comprehensive', label: 'Comprehensive — detailed definitions and explicit legal clauses' }
    ]
  }
]);

/**
 * Resolve a catalog license by SPDX ID or common legacy GitHub SPDX alias.
 * @param {string} id
 * @returns {object|null}
 */
export function resolveLicense(id) {
  if (typeof id !== 'string') return null;
  const direct = getLicenseById(id);
  if (direct) return direct;
  const normalized = LEGACY_SPDX_ALIASES[id.trim().toLowerCase()];
  return normalized ? getLicenseById(normalized) : null;
}

/**
 * Normalize raw questionnaire inputs with safe defaults while ignoring any programming language hints.
 * @param {object} [rawCriteria]
 * @returns {object}
 */
export function normalizeCriteria(rawCriteria = {}) {
  const input = rawCriteria && typeof rawCriteria === 'object' ? rawCriteria : {};
  const deps = Array.isArray(input.dependencyLicenses)
    ? input.dependencyLicenses.map((d) => String(d).trim()).filter(Boolean)
    : [];

  return {
    copyleftPreference: input.copyleftPreference || 'any',
    allowProprietaryUse: input.allowProprietaryUse || 'either',
    patentProtection: input.patentProtection || 'preferred',
    networkUseTrigger: input.networkUseTrigger || 'avoid',
    requireNoticeAttribution: input.requireNoticeAttribution || 'required',
    requireChangeDocumentation: input.requireChangeDocumentation || 'not-needed',
    restrictEndorsement: input.restrictEndorsement || 'not-needed',
    isLibrary: input.isLibrary || 'either',
    simplicityPreference: input.simplicityPreference || 'balanced',
    dependencyLicenses: [...new Set(deps)]
  };
}

/**
 * Check whether an inbound dependency license can be incorporated into a project
 * distributed under an outbound target license.
 *
 * @param {string} projectLicenseId - Proposed outbound license for the repository.
 * @param {string} dependencyLicenseId - Inbound license of an existing dependency/snippet.
 * @returns {object} Compatibility assessment with status, reason, and requiredActions.
 */
export function checkCompatibility(projectLicenseId, dependencyLicenseId) {
  const project = resolveLicense(projectLicenseId);
  const dependency = resolveLicense(dependencyLicenseId);

  if (!project || !dependency) {
    return {
      status: 'unknown',
      projectLicense: project ? project.id : String(projectLicenseId || ''),
      dependencyLicense: dependency ? dependency.id : String(dependencyLicenseId || ''),
      reason: !project && !dependency
        ? 'Neither license identifier exists in the verified catalog.'
        : `License "${!project ? projectLicenseId : dependencyLicenseId}" is outside the verified 12-license SPDX catalog; verify manually against SPDX legal terms.`,
      requiredActions: ['Review the full SPDX license text and consult legal counsel before combining.']
    };
  }

  if (project.id === dependency.id) {
    return {
      status: 'compatible',
      projectLicense: project.id,
      dependencyLicense: dependency.id,
      reason: `Both project and dependency use ${project.id}, so rights and obligations align directly.`,
      requiredActions: project.flags.requiresNoticeRetention
        ? ['Retain upstream copyright and license notices alongside your repository LICENSE.']
        : []
    };
  }

  const depId = dependency.id;
  const projId = project.id;

  // Inbound simple permissive / public-domain dependencies
  if (['MIT', 'ISC', 'BSD-2-Clause', 'BSD-3-Clause', 'Unlicense'].includes(depId)) {
    if (projId === 'Unlicense' && dependency.flags.requiresNoticeRetention) {
      return {
        status: 'conditional',
        projectLicense: projId,
        dependencyLicense: depId,
        reason: `Your original code can be dedicated via ${projId}, but ${depId} requires retaining its copyright and permission notice for that dependency.`,
        requiredActions: [`Preserve the ${depId} copyright and license notice in THIRD_PARTY_NOTICES or dependency headers.`]
      };
    }

    return {
      status: 'compatible',
      projectLicense: projId,
      dependencyLicense: depId,
      reason: `${depId} places minimal conditions that are satisfied within a ${projId} project.`,
      requiredActions: dependency.flags.requiresNoticeRetention
        ? [`Keep the ${depId} copyright notice and license text intact when redistributing.`]
        : []
    };
  }

  // Inbound Apache-2.0
  if (depId === 'Apache-2.0') {
    if (['GPL-3.0-only', 'LGPL-3.0-only', 'AGPL-3.0-only'].includes(projId)) {
      return {
        status: 'compatible',
        projectLicense: projId,
        dependencyLicense: depId,
        reason: `FSF confirms ${depId} is one-way compatible with ${projId}; the combined work is distributed under ${projId}.`,
        requiredActions: ['Preserve Apache-2.0 notices and any upstream NOTICE file entries.']
      };
    }
    if (projId === 'GPL-2.0-only') {
      return {
        status: 'incompatible',
        projectLicense: projId,
        dependencyLicense: depId,
        reason: `${depId} patent termination and indemnification terms conflict with ${projId} ("no further restrictions").`,
        requiredActions: [`Upgrade target license to GPL-3.0-only or replace the ${depId} dependency.`]
      };
    }
    return {
      status: 'conditional',
      projectLicense: projId,
      dependencyLicense: depId,
      reason: `${depId} can coexist in a ${projId} project, but the Apache-2.0 component cannot be stripped to ${projId} terms alone.`,
      requiredActions: [
        'Retain Apache-2.0 license text and NOTICE file attributions for the dependency.',
        'Document modifications made to Apache-2.0 files.'
      ]
    };
  }

  // Inbound MPL-2.0 (file-level weak copyleft with Secondary Licenses Sec 3.3)
  if (depId === 'MPL-2.0') {
    if (['GPL-2.0-only', 'GPL-3.0-only', 'LGPL-3.0-only', 'AGPL-3.0-only'].includes(projId)) {
      return {
        status: 'compatible',
        projectLicense: projId,
        dependencyLicense: depId,
        reason: `MPL-2.0 Section 3.3 permits combining into a Larger Work under ${projId} (unless marked Incompatible With Secondary Licenses).`,
        requiredActions: ['Verify the upstream dependency does not include Exhibit B ("Incompatible With Secondary Licenses").']
      };
    }
    return {
      status: 'conditional',
      projectLicense: projId,
      dependencyLicense: depId,
      reason: `MPL-2.0 allows combining in a Larger Work under ${projId}, provided modified MPL-2.0 files stay under MPL-2.0.`,
      requiredActions: [
        'Keep modifications to MPL-2.0 files under MPL-2.0 and disclose their source code.',
        'Keep your own separate files clearly delineated under your project license.'
      ]
    };
  }

  // Inbound EPL-2.0 (module-level weak copyleft; incompatible with GPL without Exhibit A)
  if (depId === 'EPL-2.0') {
    if (['GPL-2.0-only', 'GPL-3.0-only', 'LGPL-3.0-only', 'AGPL-3.0-only'].includes(projId)) {
      return {
        status: 'incompatible',
        projectLicense: projId,
        dependencyLicense: depId,
        reason: `${depId} is incompatible with ${projId} by default unless the upstream author explicitly granted Exhibit A Secondary License terms.`,
        requiredActions: ['Check upstream for EPL-2.0 Exhibit A (GPL compatibility) or choose a non-GPL license.']
      };
    }
    return {
      status: 'conditional',
      projectLicense: projId,
      dependencyLicense: depId,
      reason: `${depId} permits separate modules in a ${projId} project, while modified EPL-2.0 modules remain under EPL-2.0.`,
      requiredActions: ['Isolate EPL-2.0 modules cleanly and provide source access for any modified EPL-2.0 modules.']
    };
  }

  // Inbound LGPL-3.0-only
  if (depId === 'LGPL-3.0-only') {
    if (['GPL-3.0-only', 'AGPL-3.0-only'].includes(projId)) {
      return {
        status: 'compatible',
        projectLicense: projId,
        dependencyLicense: depId,
        reason: `${depId} explicitly permits conversion and distribution inside a ${projId} work.`,
        requiredActions: ['Comply with GPLv3/AGPLv3 source disclosure for the combined work.']
      };
    }
    if (projId === 'GPL-2.0-only') {
      return {
        status: 'incompatible',
        projectLicense: projId,
        dependencyLicense: depId,
        reason: `${depId} contains GPLv3 terms that cannot be incorporated into a strict ${projId} codebase.`,
        requiredActions: ['Upgrade target license to GPL-3.0-only or avoid LGPL-3.0-only dependencies.']
      };
    }
    return {
      status: 'conditional',
      projectLicense: projId,
      dependencyLicense: depId,
      reason: `${depId} allows linking from a ${projId} project only if users can modify and relink the LGPL library.`,
      requiredActions: [
        'Use dynamic linking (or provide object files/relinking tools) and preserve LGPL-3.0 notices.',
        'Disclose source code for the LGPL-3.0 library and any modifications to it.'
      ]
    };
  }

  // Inbound GPL-2.0-only
  if (depId === 'GPL-2.0-only') {
    return {
      status: 'incompatible',
      projectLicense: projId,
      dependencyLicense: depId,
      reason: `${depId} is strong copyleft requiring the entire combined work to be distributed strictly under GPL-2.0-only, conflicting with ${projId}.`,
      requiredActions: ['License the combined repository under GPL-2.0-only or remove the GPL-2.0-only dependency.']
    };
  }

  // Inbound GPL-3.0-only
  if (depId === 'GPL-3.0-only') {
    if (projId === 'AGPL-3.0-only') {
      return {
        status: 'compatible',
        projectLicense: projId,
        dependencyLicense: depId,
        reason: 'GPL-3.0-only code can be linked or combined with AGPL-3.0-only code into an AGPL-3.0-only work (Section 13).',
        requiredActions: ['Distribute the combined work under AGPL-3.0-only with Corresponding Source access.']
      };
    }
    return {
      status: 'incompatible',
      projectLicense: projId,
      dependencyLicense: depId,
      reason: `${depId} requires the entire distributed derivative work to be licensed under GPL-3.0-only (or AGPL-3.0-only), conflicting with ${projId}.`,
      requiredActions: ['Adopt GPL-3.0-only (or AGPL-3.0-only) for the combined work, or replace the GPL-3.0-only dependency.']
    };
  }

  // Inbound AGPL-3.0-only (all non-identical projIds)
  return {
    status: 'incompatible',
    projectLicense: projId,
    dependencyLicense: depId,
    reason: `${depId} imposes network-use source disclosure across the entire combined work and cannot be weakened to ${projId}.`,
    requiredActions: ['Adopt AGPL-3.0-only for the combined project or remove the AGPL-3.0-only dependency.']
  };
}

/**
 * Audit a target outbound license against an array of dependency license identifiers.
 * @param {string} projectLicenseId
 * @param {string[]} dependencyLicenseIds
 * @returns {object}
 */
export function auditCompatibility(projectLicenseId, dependencyLicenseIds = []) {
  const uniqueDeps = [...new Set((dependencyLicenseIds || []).map((id) => String(id).trim()).filter(Boolean))];
  const checks = uniqueDeps.map((depId) => checkCompatibility(projectLicenseId, depId));

  const incompatible = checks.filter((c) => c.status === 'incompatible');
  const conditional = checks.filter((c) => c.status === 'conditional');
  const unknown = checks.filter((c) => c.status === 'unknown');

  let overallStatus = 'compatible';
  if (incompatible.length > 0) {
    overallStatus = 'incompatible';
  } else if (unknown.length > 0) {
    overallStatus = 'unknown';
  } else if (conditional.length > 0) {
    overallStatus = 'conditional';
  }

  return {
    projectLicense: resolveLicense(projectLicenseId)?.id || projectLicenseId,
    overallStatus,
    checks,
    incompatibleCount: incompatible.length,
    conditionalCount: conditional.length,
    unknownCount: unknown.length
  };
}

function detectCriteriaConflicts(criteria) {
  const conflicts = [];

  if (criteria.copyleftPreference === 'permissive' && criteria.allowProprietaryUse === 'no') {
    conflicts.push('Permissive licenses inherently allow proprietary derivatives, conflicting with forbidding proprietary reuse.');
  }
  if (criteria.copyleftPreference === 'public-domain' && criteria.requireNoticeAttribution === 'required') {
    conflicts.push('Public domain dedications (The Unlicense) waive notice conditions, conflicting with requiring attribution.');
  }
  if (criteria.allowProprietaryUse === 'yes' && criteria.networkUseTrigger === 'required') {
    conflicts.push('No license permits proprietary derivatives while simultaneously mandating network-use source disclosure.');
  }
  if (criteria.copyleftPreference === 'network-copyleft' && criteria.networkUseTrigger === 'avoid') {
    conflicts.push('Network copyleft (AGPL-3.0-only) cannot simultaneously avoid network-use disclosure triggers.');
  }
  if (criteria.copyleftPreference === 'permissive' && criteria.networkUseTrigger === 'required') {
    conflicts.push('Permissive licenses do not enforce network-use source disclosure.');
  }
  if (criteria.requireNoticeAttribution === 'none' && criteria.patentProtection === 'required') {
    conflicts.push('Public domain dedications without notices do not include explicit contributor patent grants.');
  }

  return conflicts;
}

function evaluateHardConstraints(license, criteria, compatibilityAudit) {
  const disqualifiers = [];
  const { flags } = license;

  if (criteria.copyleftPreference !== 'any' && license.category !== criteria.copyleftPreference) {
    disqualifiers.push(
      `Category "${CATEGORY_LABELS[license.category]}" does not match requested "${CATEGORY_LABELS[criteria.copyleftPreference]}" posture.`
    );
  }

  if (criteria.allowProprietaryUse === 'yes' && !flags.allowsProprietaryDerivatives) {
    disqualifiers.push('Strong/network copyleft forbids incorporating derivatives into proprietary products.');
  }

  if (criteria.allowProprietaryUse === 'no' && flags.allowsProprietaryDerivatives) {
    disqualifiers.push('Permits proprietary derivatives or closed-source larger works.');
  }

  if (criteria.patentProtection === 'required' && flags.patentGrant !== 'explicit') {
    disqualifiers.push('Lacks an explicit contributor patent grant and patent retaliation clause.');
  }

  if (criteria.networkUseTrigger === 'required' && !flags.networkUseTrigger) {
    disqualifiers.push('Does not trigger source code disclosure on remote network/SaaS interaction alone.');
  }

  if (criteria.networkUseTrigger === 'avoid' && flags.networkUseTrigger) {
    disqualifiers.push('Triggers network-use source disclosure (AGPL Section 13), which you asked to avoid.');
  }

  if (criteria.requireNoticeAttribution === 'required' && !flags.requiresNoticeRetention) {
    disqualifiers.push('Does not require preserving copyright or attribution notices.');
  }

  if (criteria.requireNoticeAttribution === 'none' && flags.requiresNoticeRetention) {
    disqualifiers.push('Requires retaining copyright and license notices rather than waiving conditions.');
  }

  if (criteria.requireChangeDocumentation === 'required' && !flags.requiresChangeLog) {
    disqualifiers.push('Does not require contributors/redistributors to document file modifications.');
  }

  if (criteria.restrictEndorsement === 'required' && !flags.nonEndorsementClause) {
    disqualifiers.push('Does not include an explicit non-endorsement clause restricting use of contributor names.');
  }

  if (compatibilityAudit && compatibilityAudit.incompatibleCount > 0) {
    const blocking = compatibilityAudit.checks
      .filter((c) => c.status === 'incompatible')
      .map((c) => `${c.dependencyLicense} (${c.reason})`)
      .join('; ');
    disqualifiers.push(`Incompatible with declared dependency license(s): ${blocking}`);
  }

  return disqualifiers;
}

function scoreLicenseFit(license, criteria, compatibilityAudit) {
  const { flags } = license;
  const reasons = [];
  const tradeoffs = [];
  let score = 50; // Neutral baseline before policy evaluation

  // 1. Patent grant & retaliation evaluation
  if (criteria.patentProtection === 'required') {
    score += 18;
    reasons.push('Provides an explicit contributor patent grant with retaliation termination.');
  } else if (criteria.patentProtection === 'preferred') {
    if (flags.patentGrant === 'explicit') {
      score += 14;
      reasons.push('Includes explicit patent license and litigation termination protections.');
    } else {
      score -= 4;
      tradeoffs.push('No explicit patent grant clause (relies on implied rights only).');
    }
  } else if (flags.patentGrant === 'none') {
    score += 4;
  }

  // 2. Copyleft & distribution obligations
  if (criteria.allowProprietaryUse === 'yes' && flags.copyleftStrength === 'none') {
    score += 10;
    reasons.push('Allows frictionless commercial and closed-source derivative use.');
  } else if (criteria.allowProprietaryUse === 'yes' && flags.copyleftStrength === 'weak') {
    score += 2;
    tradeoffs.push('Weak copyleft requires disclosing source for modifications to covered files/modules/libraries.');
  } else if (criteria.allowProprietaryUse === 'no') {
    score += 12;
    reasons.push(COPYLEFT_SCOPE_DESCRIPTIONS[flags.copyleftScope]);
  }

  // 3. Network-use trigger clarity
  if (criteria.networkUseTrigger === 'avoid' && !flags.networkUseTrigger) {
    score += 5;
  } else if (criteria.networkUseTrigger === 'required' && flags.networkUseTrigger) {
    score += 20;
    reasons.push('Enforces Section 13 network-use Corresponding Source disclosure for SaaS deployments.');
  }

  // 4. Distribution change-documentation rules
  if (criteria.requireChangeDocumentation === 'required' && flags.requiresChangeLog) {
    score += 8;
    reasons.push('Requires redistributors to document modifications clearly.');
  } else if (criteria.requireChangeDocumentation === 'preferred') {
    if (flags.requiresChangeLog) {
      score += 8;
      reasons.push('Requires stating changes in modified distributed files.');
    } else {
      score -= 2;
    }
  } else if (criteria.requireChangeDocumentation === 'not-needed' && !flags.requiresChangeLog) {
    score += 3;
  }

  // 5. Non-endorsement / trademark protection
  if (criteria.restrictEndorsement === 'required' && flags.nonEndorsementClause) {
    score += 8;
    reasons.push('Explicitly bars unauthorized endorsement using contributor names.');
  } else if (criteria.restrictEndorsement === 'preferred') {
    if (flags.nonEndorsementClause) {
      score += 8;
      reasons.push('Protects contributors against unauthorized product endorsement.');
    } else if (flags.trademarkRestriction) {
      score += 4;
      reasons.push('Clarifies that trademark rights are not granted.');
    }
  }

  // 6. Library vs application boundary (weak copyleft distinction, non-language-based)
  if (license.category === 'weak-copyleft') {
    if (criteria.isLibrary === 'yes') {
      if (license.id === 'LGPL-3.0-only') {
        score += 12;
        reasons.push('Designed specifically for reusable libraries linked by proprietary or open applications.');
      } else if (license.id === 'MPL-2.0') {
        score += 6;
        reasons.push('File-level boundary works cleanly for mixed-license libraries.');
      }
    } else if (criteria.isLibrary === 'no') {
      if (license.id === 'MPL-2.0') {
        score += 10;
        reasons.push('File-level reciprocity avoids dynamic-relinking complexity for standalone tools.');
      } else if (license.id === 'EPL-2.0') {
        score += 6;
        reasons.push('Module-level boundary suits extensible applications and plugins.');
      } else if (license.id === 'LGPL-3.0-only') {
        score -= 4;
        tradeoffs.push('LGPL relinking obligations are primarily tailored for libraries rather than standalone apps.');
      }
    } else if (license.id === 'MPL-2.0') {
      score += 6;
    }
  }

  // 7. License simplicity vs legal comprehensiveness
  if (criteria.simplicityPreference === 'minimal') {
    if (flags.textComplexity === 'minimal') {
      score += 12;
      reasons.push('Short, plain-language text that developers can read in under a minute.');
    } else if (flags.textComplexity === 'short') {
      score += 7;
      reasons.push('Concise license text without multi-page legal boilerplate.');
    } else {
      score -= 6;
      tradeoffs.push('Longer legal document compared to minimal permissive licenses.');
    }
  } else if (criteria.simplicityPreference === 'balanced') {
    if (flags.textComplexity === 'minimal') score += 5;
    if (flags.textComplexity === 'short') score += 4;
    if (flags.textComplexity === 'comprehensive') score += 3;
  } else if (criteria.simplicityPreference === 'comprehensive') {
    if (flags.textComplexity === 'comprehensive') {
      score += 10;
      reasons.push('Comprehensive legal wording addressing definitions, patents, and liability explicitly.');
    } else {
      score -= 3;
    }
  }

  // 8. Dependency compatibility bonus/warning
  if (compatibilityAudit && compatibilityAudit.checks.length > 0) {
    if (compatibilityAudit.overallStatus === 'compatible') {
      score += 8;
      reasons.push('Fully compatible with all specified project dependencies.');
    } else if (compatibilityAudit.overallStatus === 'conditional') {
      score -= 5;
      const condDeps = compatibilityAudit.checks
        .filter((c) => c.status === 'conditional')
        .map((c) => c.dependencyLicense)
        .join(', ');
      tradeoffs.push(`Conditional compatibility with ${condDeps}; preserve isolation/notice obligations.`);
    } else if (compatibilityAudit.overallStatus === 'unknown') {
      score -= 4;
      tradeoffs.push('One or more dependency licenses are outside the 12-license SPDX catalog and need manual review.');
    }
  }

  // 9. Standard policy reminders
  if (flags.requiresSourceDisclosure && !reasons.some((r) => r.includes('source'))) {
    tradeoffs.push('Requires making covered source code available upon distribution.');
  }
  if (!flags.requiresNoticeRetention) {
    tradeoffs.push('Waives copyright notice requirements entirely.');
  }

  return {
    score: Math.max(0, Math.min(100, Math.round(score))),
    reasons,
    tradeoffs
  };
}

/**
 * Evaluate all 12 SPDX licenses against policy criteria and return deterministic ranked
 * recommendations, disqualified candidates with reasons, and conflict diagnostics.
 *
 * @param {object} [rawCriteria]
 * @returns {object}
 */
export function recommendLicenses(rawCriteria = {}) {
  const criteria = normalizeCriteria(rawCriteria);
  const conflicts = detectCriteriaConflicts(criteria);
  const eligible = [];
  const disqualified = [];

  for (const license of LICENSE_CATALOG) {
    const compatibility = criteria.dependencyLicenses.length > 0
      ? auditCompatibility(license.id, criteria.dependencyLicenses)
      : null;

    const disqualifiers = evaluateHardConstraints(license, criteria, compatibility);
    if (disqualifiers.length > 0) {
      disqualified.push({
        id: license.id,
        name: license.name,
        shortName: license.shortName,
        category: license.category,
        disqualifiers
      });
      continue;
    }

    const evaluation = scoreLicenseFit(license, criteria, compatibility);
    eligible.push({
      id: license.id,
      name: license.name,
      shortName: license.shortName,
      category: license.category,
      categoryLabel: CATEGORY_LABELS[license.category],
      score: evaluation.score,
      reasons: evaluation.reasons,
      tradeoffs: evaluation.tradeoffs,
      compatibility,
      license
    });
  }

  eligible.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    return DEFAULT_PREFERENCE_ORDER.indexOf(a.id) - DEFAULT_PREFERENCE_ORDER.indexOf(b.id);
  });

  const topRecommendation = eligible.length > 0 ? eligible[0] : null;
  let summary;
  if (topRecommendation) {
    summary = `Recommended ${topRecommendation.id} (${topRecommendation.name}) with a ${topRecommendation.score}/100 policy fit score. ${topRecommendation.license.summary}`;
  } else if (conflicts.length > 0) {
    summary = `No single license satisfies all selected constraints simultaneously: ${conflicts[0]}`;
  } else {
    summary = 'No catalog license matched the exact combination of strict constraints. Relax one constraint or review disqualified entries.';
  }

  return {
    criteria,
    languageIgnored: true,
    policyDimensionsEvaluated: [
      'permissions',
      'distribution-requirements',
      'copyleft-obligations',
      'patent-clauses',
      'network-use-triggers',
      'compatibility'
    ],
    conflicts,
    topRecommendation,
    recommendations: eligible,
    disqualified,
    summary
  };
}

/**
 * Generate a plain-language breakdown of permissions, conditions, limitations,
 * and licensing policy flags for any catalog license.
 *
 * @param {string} licenseId
 * @returns {object|null}
 */
export function explainLicense(licenseId) {
  const license = resolveLicense(licenseId);
  if (!license) return null;

  const mapGlossary = (keys, group) =>
    keys.map((key) => ({
      key,
      label: RULE_GLOSSARY[group][key]?.label || key,
      description: RULE_GLOSSARY[group][key]?.description || ''
    }));

  const { flags } = license;
  return {
    id: license.id,
    name: license.name,
    shortName: license.shortName,
    category: license.category,
    categoryLabel: CATEGORY_LABELS[license.category],
    osiApproved: license.osiApproved,
    fsfLibre: license.fsfLibre,
    plainSummary: license.summary,
    whenToUse: license.whenToUse,
    canDo: mapGlossary(license.permissions, 'permissions'),
    mustDo: mapGlossary(license.conditions, 'conditions'),
    cannotDo: mapGlossary(license.limitations, 'limitations'),
    policyHighlights: {
      copyleftObligation: COPYLEFT_SCOPE_DESCRIPTIONS[flags.copyleftScope],
      patentClause: flags.patentGrant === 'explicit'
        ? 'Includes an explicit contributor patent grant with patent-litigation termination.'
        : 'Does not include an explicit patent grant or retaliation clause.',
      networkUseTrigger: flags.networkUseTrigger
        ? 'Yes — remote network interaction (SaaS) requires offering Corresponding Source.'
        : 'No — remote hosting alone does not trigger source disclosure.',
      distributionRequirements: flags.requiresSourceDisclosure
        ? 'Distributed copies must retain notices and provide source code availability.'
        : flags.requiresNoticeRetention
          ? 'Distributed copies must preserve copyright and license notices (source disclosure is not required).'
          : 'No notice or source disclosure conditions on redistribution.'
    },
    sourceUrls: license.sourceUrls
  };
}

/**
 * Build a structured side-by-side comparison matrix for two or more licenses.
 *
 * @param {string[]} licenseIds
 * @returns {object}
 */
export function compareLicenses(licenseIds = []) {
  const resolved = [];
  const unknownIds = [];

  for (const rawId of licenseIds) {
    const found = resolveLicense(rawId);
    if (!found) {
      unknownIds.push(rawId);
    } else if (!resolved.some((item) => item.id === found.id)) {
      resolved.push(found);
    }
  }

  const rows = [
    {
      key: 'category',
      label: 'License Category',
      values: resolved.map((l) => CATEGORY_LABELS[l.category])
    },
    {
      key: 'commercialUse',
      label: 'Commercial Use',
      values: resolved.map((l) => (l.flags.commercialUse ? 'Allowed' : 'Restricted'))
    },
    {
      key: 'allowsProprietaryDerivatives',
      label: 'Closed-Source Derivatives',
      values: resolved.map((l) => (l.flags.allowsProprietaryDerivatives ? 'Allowed' : 'Not allowed'))
    },
    {
      key: 'copyleftScope',
      label: 'Copyleft Scope',
      values: resolved.map((l) => {
        if (l.flags.copyleftScope === 'none') return 'None';
        return `${l.flags.copyleftStrength} (${l.flags.copyleftScope})`;
      })
    },
    {
      key: 'patentGrant',
      label: 'Explicit Patent Grant',
      values: resolved.map((l) => (l.flags.patentGrant === 'explicit' ? 'Yes (with retaliation)' : 'No explicit clause'))
    },
    {
      key: 'networkUseTrigger',
      label: 'Network / SaaS Source Trigger',
      values: resolved.map((l) => (l.flags.networkUseTrigger ? 'Yes (Section 13)' : 'No'))
    },
    {
      key: 'requiresSourceDisclosure',
      label: 'Source Code Disclosure',
      values: resolved.map((l) => (l.flags.requiresSourceDisclosure ? 'Required on distribution' : 'Not required'))
    },
    {
      key: 'requiresChangeLog',
      label: 'Document Modifications',
      values: resolved.map((l) => (l.flags.requiresChangeLog ? 'Required' : 'Not required'))
    },
    {
      key: 'requiresNoticeRetention',
      label: 'Copyright & License Notice',
      values: resolved.map((l) => (l.flags.requiresNoticeRetention ? 'Required' : 'Waived'))
    },
    {
      key: 'nonEndorsementClause',
      label: 'Non-Endorsement / Trademark Guard',
      values: resolved.map((l) => {
        if (l.flags.nonEndorsementClause && l.flags.trademarkRestriction) return 'Non-endorsement & Trademark';
        if (l.flags.trademarkRestriction) return 'Trademark limit';
        return 'Standard';
      })
    },
    {
      key: 'antiTivoization',
      label: 'Anti-Tivoization',
      values: resolved.map((l) => (l.flags.antiTivoization ? 'Yes' : 'No'))
    },
    {
      key: 'textComplexity',
      label: 'Text Complexity',
      values: resolved.map((l) => l.flags.textComplexity)
    }
  ];

  return {
    licenses: resolved.map((l) => ({
      id: l.id,
      name: l.name,
      shortName: l.shortName,
      category: l.category,
      categoryLabel: CATEGORY_LABELS[l.category],
      osiApproved: l.osiApproved,
      sourceUrls: l.sourceUrls
    })),
    unknownIds,
    rows
  };
}

