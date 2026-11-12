/**
 * License File & Source Header Text Formatting Utility
 *
 * Formats official SPDX license templates with validated copyright year and holder
 * metadata while preserving legal fidelity for non-parameterized licenses.
 */

import { resolveLicense } from './engine.js';

const YEAR_PATTERN = /^\d{4}(?:\s*-\s*\d{4})?$/;

function sanitizeSingleLine(value) {
  if (typeof value !== 'string') return '';
  return value.replace(/[\r\n\t]+/g, ' ').replace(/\s{2,}/g, ' ').trim();
}

/**
 * Validate and normalize license generation parameters.
 *
 * @param {object} [options]
 * @param {string|number} [options.year] - 4-digit year or range (e.g., "2026" or "2024-2026").
 * @param {string} [options.holder] - Copyright holder name or organization.
 * @param {string} [options.programName] - Optional program name for GPL/AGPL headers.
 * @param {string} [options.programDescription] - Optional short description for GPL/AGPL headers.
 * @param {boolean} [options.strict=false] - Throw when required copyright holder is missing.
 * @returns {object} Normalized options.
 */
export function normalizeGeneratorOptions(options = {}) {
  const input = options && typeof options === 'object' ? options : {};
  const strict = Boolean(input.strict);

  const rawYear = input.year === undefined || input.year === null || input.year === ''
    ? String(new Date().getFullYear())
    : String(input.year).trim();

  if (!YEAR_PATTERN.test(rawYear)) {
    throw new Error(`Invalid copyright year "${rawYear}". Expected YYYY or YYYY-YYYY.`);
  }

  const normalizedYear = rawYear.replace(/\s*-\s*/, '-');
  const holder = sanitizeSingleLine(input.holder || '');

  if (strict && !holder) {
    throw new Error('Copyright holder name is required when generating a final LICENSE file.');
  }

  return {
    year: normalizedYear,
    holder: holder || '<copyright holders>',
    hasExplicitHolder: Boolean(holder),
    programName: sanitizeSingleLine(input.programName || ''),
    programDescription: sanitizeSingleLine(input.programDescription || ''),
    strict
  };
}

/**
 * Generate the full LICENSE file text for a verified SPDX license identifier.
 *
 * For licenses whose official SPDX text embeds a copyright line (MIT, ISC,
 * BSD-2-Clause, BSD-3-Clause), placeholders are populated with `year` and `holder`.
 * For full-body licenses (Apache-2.0, MPL-2.0, EPL-2.0, GPL*, LGPL*, AGPL*, Unlicense),
 * the verbatim SPDX license text is preserved so automated license detectors recognize it.
 *
 * @param {string} licenseId
 * @param {object} [options]
 * @returns {string}
 */
export function generateLicenseText(licenseId, options = {}) {
  const license = resolveLicense(licenseId);
  if (!license) {
    throw new Error(`Unknown or unsupported SPDX license identifier: "${licenseId}".`);
  }

  const normalized = normalizeGeneratorOptions({
    ...options,
    // Strict holder enforcement only applies when the LICENSE body uses a copyright holder
    strict: Boolean(options?.strict && license.templateInfo.copyrightInLicenseText)
  });

  if (!license.templateInfo.copyrightInLicenseText) {
    return license.licenseText;
  }

  let output = license.licenseText;
  output = output.replaceAll('<year>', normalized.year);
  output = output.replaceAll('<copyright holders>', normalized.holder);
  output = output.replaceAll('<owner>', normalized.holder);

  return output;
}

/**
 * Generate a standard per-file copyright/SPDX header notice for source files.
 *
 * @param {string} licenseId
 * @param {object} [options]
 * @returns {string}
 */
export function generateFileHeader(licenseId, options = {}) {
  const license = resolveLicense(licenseId);
  if (!license) {
    throw new Error(`Unknown or unsupported SPDX license identifier: "${licenseId}".`);
  }

  const normalized = normalizeGeneratorOptions(options);
  const { standardLicenseHeader } = license.templateInfo;

  if (!standardLicenseHeader) {
    if (license.id === 'Unlicense') {
      return [
        'This is free and unencumbered software released into the public domain.',
        `SPDX-License-Identifier: ${license.id}`
      ].join('\n');
    }
    return [
      `Copyright (c) ${normalized.year} ${normalized.holder}`,
      `SPDX-License-Identifier: ${license.id}`
    ].join('\n');
  }

  let header = standardLicenseHeader
    .replaceAll('[yyyy]', normalized.year)
    .replaceAll('[year]', normalized.year)
    .replaceAll('<year>', normalized.year)
    .replace(/\byyyy\b/g, normalized.year)
    .replaceAll('[name of copyright owner]', normalized.holder)
    .replaceAll('[name of author]', normalized.holder)
    .replaceAll('<name of author>', normalized.holder)
    .replace(/\bname of author\b/g, normalized.holder);

  if (normalized.programName || normalized.programDescription) {
    const summaryLine = [normalized.programName, normalized.programDescription]
      .filter(Boolean)
      .join(' - ');
    header = `${summaryLine}\n${header}`;
  }

  return header.trimEnd();
}

/**
 * Generate a complete LICENSE payload ready for preview, download, or GitHub PR creation.
 *
 * @param {string} licenseId
 * @param {object} [options]
 * @returns {object}
 */
export function generateLicensePackage(licenseId, options = {}) {
  const license = resolveLicense(licenseId);
  if (!license) {
    throw new Error(`Unknown or unsupported SPDX license identifier: "${licenseId}".`);
  }

  const normalized = normalizeGeneratorOptions({
    ...options,
    strict: Boolean(options?.strict && license.templateInfo.copyrightInLicenseText)
  });

  const content = generateLicenseText(license.id, options);
  const sourceHeader = generateFileHeader(license.id, options);

  return {
    spdxId: license.id,
    name: license.name,
    filename: license.templateInfo.recommendedFilename,
    content,
    sourceHeader,
    copyrightAppliedInLicense: license.templateInfo.copyrightInLicenseText,
    noticeRecommended: license.templateInfo.noticeFileRecommended,
    metadata: {
      year: normalized.year,
      holder: normalized.hasExplicitHolder ? normalized.holder : null
    }
  };
}

