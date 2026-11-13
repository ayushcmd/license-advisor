/**
 * GitHub License Advisor — Client UI Coordinator
 *
 * Modular ES6 controller for static HTML5 pages. Uses safe DOM element
 * construction (never interpolating untrusted inputs into innerHTML).
 */

import { LICENSE_CATALOG, getLicenseById } from './catalog-data.js';
import {
  RECOMMENDATION_CRITERIA_SCHEMA,
  checkCompatibility,
  compareLicenses,
  explainLicense,
  recommendLicenses,
  resolveLicense
} from './engine.js';
import { generateLicensePackage } from './generator.js';
import { licenseReadmeSnippets } from './readme.js';
import { analyzePublicRepository, parseRepoInput } from './analyzer.js';

const CATEGORY_BADGE_CLASS = Object.freeze({
  permissive: 'badge-permissive',
  'weak-copyleft': 'badge-weak-copyleft',
  'strong-copyleft': 'badge-strong-copyleft',
  'network-copyleft': 'badge-network-copyleft',
  'public-domain': 'badge-public-domain'
});

const CATEGORY_NAMES = Object.freeze({
  permissive: 'Permissive',
  'weak-copyleft': 'Weak Copyleft',
  'strong-copyleft': 'Strong Copyleft',
  'network-copyleft': 'Network Copyleft',
  'public-domain': 'Public Domain'
});

const COMPAT_BADGE_MAP = Object.freeze({
  compatible: { className: 'badge-success', label: 'Compatible' },
  conditional: { className: 'badge-warning', label: 'Conditional' },
  incompatible: { className: 'badge-danger', label: 'Incompatible' },
  unknown: { className: 'badge-neutral', label: 'Manual Review' }
});

/**
 * Create a DOM element safely using text nodes rather than raw HTML interpolation.
 */
function el(tag, attrs = {}, children = []) {
  const node = document.createElement(tag);

  for (const [key, value] of Object.entries(attrs || {})) {
    if (value === null || value === undefined || value === false) continue;
    if (key === 'className') {
      node.className = String(value);
    } else if (key === 'dataset' && typeof value === 'object') {
      for (const [dKey, dVal] of Object.entries(value)) {
        if (dVal !== undefined && dVal !== null) {
          node.dataset[dKey] = String(dVal);
        }
      }
    } else if (key.startsWith('on') && typeof value === 'function') {
      node.addEventListener(key.slice(2).toLowerCase(), value);
    } else if (value === true) {
      node.setAttribute(key, '');
    } else {
      node.setAttribute(key, String(value));
    }
  }

  const list = Array.isArray(children) ? children : [children];
  for (const child of list) {
    if (child === null || child === undefined || child === false) continue;
    if (typeof child === 'string' || typeof child === 'number') {
      node.appendChild(document.createTextNode(String(child)));
    } else {
      node.appendChild(child);
    }
  }
  return node;
}

function disclosure(label, content) {
  return el('details', { className: 'disclosure' }, [
    el('summary', {}, label), el('div', { className: 'disclosure-body stack-md' }, content)
  ]);
}

const SHORT_SUMMARIES = {
  MIT: 'Simple terms: allow reuse and keep the copyright notice.',
  'Apache-2.0': 'Permissive reuse with explicit patent terms and change notices.',
  'GPL-3.0-only': 'Shared versions and derivative works must keep their source open.'
};

const QUESTION_TITLES = {
  copyleftPreference: 'Should people share their changes?',
  allowProprietaryUse: 'Can your code be used in closed-source products?',
  patentProtection: 'Do you want explicit patent protection?',
  networkUseTrigger: 'Should hosted services share modified source code?',
  requireNoticeAttribution: 'Should others keep your copyright notice?',
  requireChangeDocumentation: 'Should others document their changes?',
  restrictEndorsement: 'Do you want explicit name and trademark limits?',
  isLibrary: 'Are you building a library or an application?',
  simplicityPreference: 'How important is a short license?'
};

function brief(text) {
  return text.match(/^.*?[.!?](?:\s|$)/)?.[0]?.trim() || text;
}

function clearNode(node) {
  while (node && node.firstChild) {
    node.removeChild(node.firstChild);
  }
}

function isSafeHttpUrl(url) {
  if (typeof url !== 'string') return false;
  try {
    const parsed = new URL(url);
    return parsed.protocol === 'https:' || parsed.protocol === 'http:';
  } catch {
    return false;
  }
}

function downloadTextFile(filename, content) {
  const blob = new Blob([content], { type: 'text/plain;charset=utf-8' });
  const objectUrl = URL.createObjectURL(blob);
  const link = el('a', { href: objectUrl, download: filename });
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(objectUrl), 1000);
}

async function copyTextWithFeedback(button, text) {
  const originalLabel = button.textContent;
  try {
    if (navigator.clipboard && typeof navigator.clipboard.writeText === 'function') {
      await navigator.clipboard.writeText(text);
    } else {
      const area = el('textarea', { className: 'sr-only' }, text);
      document.body.appendChild(area);
      area.select();
      document.execCommand('copy');
      area.remove();
    }
    button.textContent = 'Copied';
  } catch {
    button.textContent = 'Copy failed';
  }
  setTimeout(() => {
    button.textContent = originalLabel;
  }, 1800);
}

function createCategoryBadge(category) {
  return el('span', { className: `badge ${CATEGORY_BADGE_CLASS[category] || 'badge-neutral'}` }, CATEGORY_NAMES[category] || category);
}

function createRuleColumn(title, items, dotClass, emptyText) {
  const list = el('ul', { className: 'rule-list' });
  if (!items || items.length === 0) {
    list.appendChild(el('li', { className: 'text-muted' }, emptyText));
  } else {
    for (const item of items) {
      list.appendChild(
        el('li', { title: item.description }, [
          el('span', { className: `rule-dot ${dotClass}`, 'aria-hidden': 'true' }),
          item.label
        ])
      );
    }
  }
  return el('div', { className: 'rule-panel' }, [el('h4', {}, title), list]);
}

function createPlainBreakdownBox(explanation) {
  const wrapper = el('div', { className: 'stack-md' });

  wrapper.appendChild(
    el('div', { className: 'rule-columns' }, [
      createRuleColumn('Allowed', explanation.canDo, 'rule-dot-green', 'Standard copyright applies'),
      createRuleColumn('Required', explanation.mustDo, 'rule-dot-blue', 'No additional conditions'),
      createRuleColumn('Limitations', explanation.cannotDo, 'rule-dot-red', 'No explicit limitations listed')
    ])
  );

  const policyTable = el('div', { className: 'table-scroll' }, [
    el('table', { className: 'data-table' }, [
      el('tbody', {}, [
        el('tr', {}, [el('th', { scope: 'row' }, 'Copyleft Obligation'), el('td', {}, explanation.policyHighlights.copyleftObligation)]),
        el('tr', {}, [el('th', { scope: 'row' }, 'Patent Clause'), el('td', {}, explanation.policyHighlights.patentClause)]),
        el('tr', {}, [el('th', { scope: 'row' }, 'Network-Use Trigger'), el('td', {}, explanation.policyHighlights.networkUseTrigger)]),
        el('tr', {}, [el('th', { scope: 'row' }, 'Distribution Rules'), el('td', {}, explanation.policyHighlights.distributionRequirements)])
      ])
    ])
  ]);
  wrapper.appendChild(disclosure('Detailed license terms', policyTable));

  return wrapper;
}

function buildGeneratorWidget(licenseId, defaults = {}) {
  const container = el('div', { className: 'box' });
  const yearId = `gen-year-${Math.random().toString(36).slice(2, 7)}`;
  const holderId = `gen-holder-${Math.random().toString(36).slice(2, 7)}`;
  const modeId = `gen-mode-${Math.random().toString(36).slice(2, 7)}`;

  const yearInput = el('input', {
    id: yearId,
    type: 'text',
    className: 'input',
    value: defaults.year || String(new Date().getFullYear()),
    placeholder: '2026 or 2024-2026'
  });

  const holderInput = el('input', {
    id: holderId,
    type: 'text',
    className: 'input',
    value: defaults.holder || '',
    placeholder: 'Your Name or Organization'
  });

  const modeSelect = el('select', { id: modeId, className: 'select' }, [
    el('option', { value: 'license' }, 'Full LICENSE File Text'),
    el('option', { value: 'header' }, 'Per-File Source Header (SPDX)')
  ]);

  const statusBanner = el('div', { className: 'flash flash-warning', hidden: true });
  const pre = el('pre', { className: 'license-preview' });
  const copyBtn = el('button', { type: 'button', className: 'btn btn-secondary btn-sm' }, 'Copy Text');
  const downloadBtn = el('button', { type: 'button', className: 'btn btn-primary btn-sm' }, 'Download LICENSE');

  let currentText = '';

  function refreshPreview() {
    try {
      statusBanner.hidden = true;
      const pkg = generateLicensePackage(licenseId, {
        year: yearInput.value,
        holder: holderInput.value,
        strict: false
      });
      currentText = modeSelect.value === 'header' ? pkg.sourceHeader : pkg.content;
      pre.textContent = currentText;

      if (!pkg.copyrightAppliedInLicense && modeSelect.value === 'license') {
        statusBanner.className = 'flash flash-info';
        statusBanner.textContent = `${pkg.spdxId} is a public-domain dedication and does not include a copyright notice.`;
        statusBanner.hidden = false;
      }
    } catch (err) {
      statusBanner.className = 'flash flash-error';
      statusBanner.textContent = err.message;
      statusBanner.hidden = false;
    }
  }

  yearInput.addEventListener('input', refreshPreview);
  holderInput.addEventListener('input', refreshPreview);
  modeSelect.addEventListener('change', refreshPreview);

  copyBtn.addEventListener('click', () => copyTextWithFeedback(copyBtn, currentText));
  downloadBtn.addEventListener('click', () => {
    try {
      const pkg = generateLicensePackage(licenseId, {
        year: yearInput.value,
        holder: holderInput.value,
        strict: true
      });
      const text = modeSelect.value === 'header' ? pkg.sourceHeader : pkg.content;
      const filename = modeSelect.value === 'header' ? 'LICENSE-HEADER.txt' : 'LICENSE';
      downloadTextFile(filename, text);
      statusBanner.hidden = true;
    } catch (err) {
      statusBanner.className = 'flash flash-error';
      statusBanner.textContent = err.message;
      statusBanner.hidden = false;
      holderInput.focus();
    }
  });

  container.appendChild(
    el('div', { className: 'box-header' }, [
      el('h3', { className: 'box-title' }, `Customize & Generate ${licenseId}`),
      el('div', { className: 'cluster' }, [copyBtn, downloadBtn])
    ])
  );

  container.appendChild(
    el('div', { className: 'box-body stack-md' }, [
      el('div', { className: 'grid-3' }, [
        el('div', { className: 'form-group' }, [
          el('label', { className: 'form-label', for: yearId }, 'Copyright Year'),
          yearInput
        ]),
        el('div', { className: 'form-group' }, [
          el('label', { className: 'form-label', for: holderId }, 'Copyright Holder'),
          holderInput
        ]),
        el('div', { className: 'form-group' }, [
          el('label', { className: 'form-label', for: modeId }, 'Output Format'),
          modeSelect
        ])
      ]),
      statusBanner,
      pre
    ])
  );

  refreshPreview();
  return container;
}

function markActiveNav() {
  const path = window.location.pathname.split('/').pop() || 'index.html';
  document.querySelectorAll('.site-nav .nav-link').forEach((link) => {
    const href = link.getAttribute('href');
    if (href === path) {
      link.setAttribute('aria-current', 'page');
    } else {
      link.removeAttribute('aria-current');
    }
  });
}

/* ==========================================================================
   Page 1: Overview (index.html)
   ========================================================================== */
function initHomePage() {
  const quickGrid = document.getElementById('home-catalog-preview');
  if (!quickGrid) return;

  const spotlightIds = ['MIT', 'Apache-2.0', 'GPL-3.0-only'];
  clearNode(quickGrid);
  for (const id of spotlightIds) {
    const lic = getLicenseById(id);
    if (!lic) continue;
    quickGrid.appendChild(
      el('article', { className: 'card' }, [
        el('div', { className: 'cluster-between' }, [
          el('strong', { className: 'text-mono' }, lic.id),
          createCategoryBadge(lic.category)
        ]),
        el('p', { className: 'text-small text-muted' }, (SHORT_SUMMARIES[lic.id] || brief(lic.summary))),
        el('div', { className: 'cluster' }, [
          el('a', { className: 'btn btn-secondary btn-sm', href: `explorer.html?license=${encodeURIComponent(lic.id)}` }, 'Inspect & Generate'),
          el('a', { className: 'text-small', href: `compare.html?licenses=${lic.id === 'MIT' ? 'Apache-2.0' : 'MIT'},${encodeURIComponent(lic.id)}` }, lic.id === 'MIT' ? 'Compare with Apache' : 'Compare with MIT')
        ])
      ])
    );
  }
}

/* ==========================================================================
   Page 2: License Explorer (explorer.html)
   ========================================================================== */
function initExplorerPage() {
  const listEl = document.getElementById('explorer-list');
  const detailEl = document.getElementById('explorer-detail');
  const searchEl = document.getElementById('explorer-search');
  const categoryEl = document.getElementById('explorer-category');
  const patentEl = document.getElementById('explorer-patent');
  const countEl = document.getElementById('explorer-count');
  if (!listEl || !detailEl) return;

  const params = new URLSearchParams(window.location.search);
  let selectedId = resolveLicense(params.get('license') || 'MIT')?.id || 'MIT';

  function renderDetail(id) {
    const lic = getLicenseById(id);
    const explanation = explainLicense(id);
    if (!lic || !explanation) return;

    clearNode(detailEl);

    const headerActions = el('div', { className: 'cluster' }, [
      el('a', { className: 'btn btn-secondary btn-sm', href: `compare.html?licenses=${encodeURIComponent(lic.id)},${lic.id === 'MIT' ? 'Apache-2.0' : 'MIT'}` }, 'Compare'),
      el('a', { className: 'btn btn-primary btn-sm', href: `app-install.html?license=${encodeURIComponent(lic.id)}` }, 'Create PR')
    ]);

    const summaryBox = el('div', { className: 'box' }, [
      el('div', { className: 'box-header' }, [
        el('div', { className: 'cluster' }, [
          el('h2', { className: 'box-title' }, `${lic.name} (${lic.id})`),
          createCategoryBadge(lic.category),
          lic.osiApproved ? el('span', { className: 'badge badge-neutral' }, 'OSI Approved') : null
        ]),
        headerActions
      ]),
      el('div', { className: 'box-body stack-md' }, [
        el('p', {}, explanation.plainSummary),
        disclosure('When to choose this license', el('ul', {}, lic.whenToUse.map((tip) => el('li', {}, tip)))),
        createPlainBreakdownBox(explanation),
        el('div', { className: 'cluster text-small' }, [
          el('span', { className: 'text-muted' }, 'Official References:'),
          isSafeHttpUrl(lic.sourceUrls.spdx)
            ? el('a', { href: lic.sourceUrls.spdx, target: '_blank', rel: 'noopener noreferrer' }, 'SPDX Specification')
            : null,
          isSafeHttpUrl(lic.sourceUrls.official)
            ? el('a', { href: lic.sourceUrls.official, target: '_blank', rel: 'noopener noreferrer' }, 'Authority Source')
            : null
        ])
      ])
    ]);

    detailEl.appendChild(summaryBox);
    detailEl.appendChild(disclosure('Generate license file or source header', buildGeneratorWidget(lic.id)));
  }

  function renderList() {
    const query = (searchEl?.value || '').trim().toLowerCase();
    const category = categoryEl?.value || 'all';
    const patentOnly = Boolean(patentEl?.checked);

    const filtered = LICENSE_CATALOG.filter((lic) => {
      if (category !== 'all' && lic.category !== category) return false;
      if (patentOnly && lic.flags.patentGrant !== 'explicit') return false;
      if (query) {
        const hay = `${lic.id} ${lic.name} ${lic.shortName} ${lic.summary}`.toLowerCase();
        if (!hay.includes(query)) return false;
      }
      return true;
    });

    if (countEl) {
      countEl.textContent = `Showing ${filtered.length} of ${LICENSE_CATALOG.length} verified SPDX licenses`;
    }

    clearNode(listEl);

    if (filtered.length === 0) {
      clearNode(detailEl);
      listEl.appendChild(el('div', { className: 'flash flash-warning' }, 'No matching licenses. Try another search or clear a filter.'));
      return;
    }

    if (!filtered.some((item) => item.id === selectedId)) {
      selectedId = filtered[0].id;
    }

    for (const lic of filtered) {
      const isSelected = lic.id === selectedId;
      const card = el('article', { className: `card ${isSelected ? 'card-selected' : ''}` }, [
        el('div', { className: 'cluster-between' }, [
          el('span', { className: 'text-mono' }, lic.id),
          createCategoryBadge(lic.category)
        ]),
        el('h3', { style: 'margin:0;' }, lic.name),
        el('div', { className: 'cluster' }, [
          lic.flags.patentGrant === 'explicit' ? el('span', { className: 'badge badge-info' }, 'Explicit Patent Grant') : null,
          lic.flags.networkUseTrigger ? el('span', { className: 'badge badge-danger' }, 'Network Trigger') : null,
          el(
            'button',
            {
              type: 'button',
              className: 'btn btn-sm btn-secondary',
              'aria-pressed': isSelected ? 'true' : 'false',
              onClick: () => {
                selectedId = lic.id;
                const url = new URL(window.location.href);
                url.searchParams.set('license', lic.id);
                window.history.replaceState({}, '', url);
                renderList();
                renderDetail(lic.id);
              }
            },
            isSelected ? 'Selected' : 'View license'
          )
        ])
      ]);
      listEl.appendChild(card);
    }

    renderDetail(selectedId);
  }

  searchEl?.addEventListener('input', renderList);
  categoryEl?.addEventListener('change', renderList);
  patentEl?.addEventListener('change', renderList);
  renderList();
}

/* ==========================================================================
   Page 3: Policy Questionnaire Wizard (questionnaire.html)
   ========================================================================== */
function initQuestionnairePage() {
  const formEl = document.getElementById('wizard-form');
  const questionsMount = document.getElementById('wizard-questions');
  const depsMount = document.getElementById('wizard-dependencies');
  const resultsMount = document.getElementById('wizard-results');
  const resetBtn = document.getElementById('wizard-reset');
  if (!formEl || !questionsMount || !resultsMount) return;

  const state = Object.fromEntries(RECOMMENDATION_CRITERIA_SCHEMA.map((q) => [q.key, q.defaultValue]));
  const selectedDeps = new Set();
  let step = 0;
  const dependencyStep = depsMount?.closest('fieldset');
  const progress = el('p', { className: 'eyebrow', 'aria-live': 'polite' });
  const back = el('button', { type: 'button', className: 'btn btn-secondary', onClick: () => { step--; showStep(true); } }, 'Back');
  const next = el('button', { type: 'button', className: 'btn btn-primary', onClick: () => {
    if (step < RECOMMENDATION_CRITERIA_SCHEMA.length) { step++; showStep(true); }
    else { resultsMount.hidden = false; resultsMount.setAttribute('tabindex', '-1'); resultsMount.focus(); }
  } }, 'Next');
  formEl.prepend(progress);
  formEl.appendChild(el('div', { className: 'cluster-between wizard-navigation' }, [back, next]));
  formEl.addEventListener('submit', (event) => event.preventDefault());
  function showStep(focus = false) {
    const count = RECOMMENDATION_CRITERIA_SCHEMA.length;
    [...questionsMount.children].forEach((field, index) => { field.hidden = index !== step; });
    if (dependencyStep) dependencyStep.hidden = step !== count;
    progress.textContent = `Step ${step + 1} of ${count + 1} · ${step === count ? 'Dependencies (optional)' : 'Your preferences'}`;
    back.disabled = step === 0;
    next.textContent = step === count ? 'See recommendation' : 'Next';
    if (focus) {
      const target = step === count ? dependencyStep : questionsMount.children[step];
      target?.setAttribute('tabindex', '-1');
      target?.focus();
    }
  }


  function renderQuestions() {
    clearNode(questionsMount);
    for (const q of RECOMMENDATION_CRITERIA_SCHEMA) {
      const fieldset = el('fieldset', { className: 'question-fieldset' }, [
        el('legend', {}, QUESTION_TITLES[q.key] || q.label),
        disclosure('What does this mean?', el('p', { className: 'text-muted' }, q.description))
      ]);
      const list = el('div', { className: 'radio-list' });
      for (const opt of q.options) {
        const input = el('input', {
          type: 'radio',
          name: q.key,
          value: opt.value,
          checked: state[q.key] === opt.value,
          onChange: () => {
            state[q.key] = opt.value;
            evaluateAndRender();
          }
        });
        list.appendChild(el('label', { className: 'option-row' }, [input, el('span', {}, q.key === 'copyleftPreference' && opt.value === 'any' ? 'Help me decide' : opt.label)]));
      }
      fieldset.appendChild(list);
      questionsMount.appendChild(fieldset);
    }

    if (depsMount) {
      clearNode(depsMount);
      for (const lic of LICENSE_CATALOG) {
        const checkbox = el('input', {
          type: 'checkbox',
          value: lic.id,
          checked: selectedDeps.has(lic.id),
          onChange: () => {
            if (checkbox.checked) selectedDeps.add(lic.id);
            else selectedDeps.delete(lic.id);
            evaluateAndRender();
          }
        });
        depsMount.appendChild(
          el('label', { className: 'option-row' }, [
            checkbox,
            el('span', { className: 'text-mono text-small' }, lic.id)
          ])
        );
      }
    }
  }

  function evaluateAndRender() {
    const result = recommendLicenses({
      ...state,
      dependencyLicenses: [...selectedDeps]
    });

    clearNode(resultsMount);

    resultsMount.appendChild(el('p', { className: 'eyebrow' }, 'Current match · updates as you answer'));

    if (result.conflicts.length > 0) {
      resultsMount.appendChild(
        el('div', { className: 'flash flash-error' }, [
          el('strong', {}, 'Conflicting Policy Requirements Detected: '),
          el('ul', { style: 'margin-top:6px;margin-bottom:0;' }, result.conflicts.map((c) => el('li', {}, c)))
        ])
      );
    }

    if (result.topRecommendation) {
      const top = result.topRecommendation;
      const topBox = el('div', { className: 'box' }, [
        el('div', { className: 'box-header' }, [
          el('div', { className: 'cluster' }, [
            el('span', { className: 'badge badge-success' }, 'Top Match'),
            el('h2', { className: 'box-title' }, `${top.name} (${top.id})`)
          ]),
          el('strong', { className: 'text-mono' }, `${top.score} / 100`)
        ]),
        el('div', { className: 'box-body stack-md' }, [
          el('div', { className: 'score-meter', role: 'progressbar', 'aria-valuenow': top.score, 'aria-valuemin': 0, 'aria-valuemax': 100 }, [
            el('div', { className: 'score-fill', style: `width: ${top.score}%;` })
          ]),
          el('p', {}, (SHORT_SUMMARIES[top.id] || brief(top.license.summary))),
          top.reasons.length > 0
            ? el('div', {}, [
                el('h4', {}, 'Why it fits'),
                el('ul', {}, top.reasons.map((r) => el('li', {}, r)))
              ])
            : null,
          top.tradeoffs.length > 0
            ? el('div', { className: 'flash flash-warning' }, [
                el('strong', {}, 'Keep in mind: '),
                el('ul', { style: 'margin-top:6px;margin-bottom:0;' }, top.tradeoffs.map((t) => el('li', {}, t)))
              ])
            : null,
          el('div', { className: 'cluster' }, [
            el('a', { className: 'btn btn-primary btn-sm', href: `app-install.html?license=${encodeURIComponent(top.id)}` }, 'Create PR'),
            el('a', { className: 'btn btn-secondary btn-sm', href: `explorer.html?license=${encodeURIComponent(top.id)}` }, 'License details'),
            result.recommendations.length > 1
              ? el(
                  'a',
                  {
                    className: 'btn btn-secondary btn-sm',
                    href: `compare.html?licenses=${result.recommendations.slice(0, 3).map((r) => encodeURIComponent(r.id)).join(',')}`
                  },
                  'Compare matches'
                )
              : null
          ])
        ])
      ]);
      resultsMount.appendChild(topBox);
      resultsMount.appendChild(disclosure('Generate license file', buildGeneratorWidget(top.id)));
    }

    if (result.recommendations.length > 1) {
      const runnersUp = el('div', { className: 'box' }, [
        el('div', { className: 'box-header' }, [el('h3', { className: 'box-title' }, 'Other Eligible Licenses')]),
        el('div', { className: 'box-body stack-sm' }, result.recommendations.slice(1).map((item) =>
          el('div', { className: 'cluster-between', style: 'padding:6px 0;border-bottom:1px solid #e5eaee;' }, [
            el('div', { className: 'cluster' }, [
              el('a', { href: `explorer.html?license=${encodeURIComponent(item.id)}`, className: 'text-mono' }, item.id),
              createCategoryBadge(item.category),
              el('span', { className: 'text-small text-muted' }, item.name)
            ]),
            el('span', { className: 'text-mono text-small' }, `${item.score}/100`)
          ])
        ))
      ]);
      resultsMount.appendChild(disclosure('Other matches', runnersUp));
    }

    if (result.disqualified.length > 0) {
      const details = el('details', { className: 'disclosure' }, [
        el('summary', {}, `Disqualified Licenses (${result.disqualified.length}) — View Policy Exclusions`),
        el('div', { className: 'disclosure-body stack-sm' }, result.disqualified.map((d) =>
          el('div', { style: 'padding-bottom:8px;border-bottom:1px solid #e5eaee;' }, [
            el('strong', { className: 'text-mono' }, d.id),
            el('ul', { className: 'text-small text-muted', style: 'margin-top:4px;margin-bottom:0;' }, d.disqualifiers.map((msg) => el('li', {}, msg)))
          ])
        ))
      ]);
      resultsMount.appendChild(details);
    }
  }

  resetBtn?.addEventListener('click', () => {
    for (const q of RECOMMENDATION_CRITERIA_SCHEMA) {
      state[q.key] = q.defaultValue;
    }
    selectedDeps.clear();
    step = 0;
    renderQuestions();
    showStep();
    evaluateAndRender();
  });

  renderQuestions();
  showStep();
  evaluateAndRender();
}

/* ==========================================================================
   Page 4: Side-by-Side Comparison & Compatibility Checker (compare.html)
   ========================================================================== */
function initComparePage() {
  const slotsMount = document.getElementById('compare-slots');
  const tableMount = document.getElementById('compare-matrix');
  const presetBar = document.getElementById('compare-presets');
  const projSelect = document.getElementById('compat-project');
  const depSelect = document.getElementById('compat-dependency');
  const compatResultMount = document.getElementById('compat-result');
  if (!slotsMount || !tableMount) return;

  const params = new URLSearchParams(window.location.search);
  const initialParam = params.get('licenses');
  const initialIds = initialParam
    ? [...new Set(initialParam.split(',').map((s) => resolveLicense(s)?.id).filter(Boolean))].slice(0, 4)
    : ['MIT', 'Apache-2.0'];

  while (initialIds.length < 2) {
    const next = LICENSE_CATALOG.find((l) => !initialIds.includes(l.id))?.id || 'MIT';
    initialIds.push(next);
  }

  let selectedSlots = [...initialIds]; // Up to 4 slots (4th optional)
  if (selectedSlots.length > 4) selectedSlots = selectedSlots.slice(0, 4);

  function renderSlots() {
    clearNode(slotsMount);
    selectedSlots.forEach((currentId, index) => {
      const selectId = `compare-slot-${index}`;
      const select = el('select', {
        id: selectId,
        className: 'select',
        onChange: () => {
          selectedSlots[index] = select.value;
          renderMatrix();
        }
      });

      if (index >= 2) {
        select.appendChild(el('option', { value: '', selected: currentId === '' }, '— None —'));
      }
      for (const lic of LICENSE_CATALOG) {
        select.appendChild(
          el('option', { value: lic.id, selected: lic.id === currentId }, `${lic.id} (${lic.shortName})`)
        );
      }

      slotsMount.appendChild(
        el('div', { className: 'form-group' }, [
          el('label', { className: 'form-label', for: selectId }, `License ${index + 1}`),
          select
        ])
      );
    });
    if (selectedSlots.length < 4) slotsMount.appendChild(el('button', {
      type: 'button', className: 'btn btn-secondary add-column', onClick: () => {
        selectedSlots.push(''); renderSlots();
      }
    }, 'Add another license'));
  }

  function renderMatrix() {
    const chosen = selectedSlots.filter(Boolean);
    const matrix = compareLicenses(chosen);

    clearNode(tableMount);
    if (matrix.licenses.length < 2) {
      tableMount.appendChild(el('div', { className: 'flash flash-warning' }, 'Select at least 2 distinct licenses to compare side-by-side.'));
      return;
    }

    const theadRow = el('tr', {}, [
      el('th', { scope: 'col' }, 'Policy Dimension'),
      ...matrix.licenses.map((lic) =>
        el('th', { scope: 'col' }, [
          el('div', { className: 'stack-sm' }, [
            el('a', { href: `explorer.html?license=${encodeURIComponent(lic.id)}`, className: 'text-mono' }, lic.id),
            el('span', { className: 'text-small text-muted', style: 'font-weight:400;' }, lic.name)
          ])
        ])
      )
    ]);

    const differencesOnly = document.getElementById('compare-differences')?.checked;
    const rows = matrix.rows.filter((row) => !differencesOnly || new Set(row.values).size > 1);
    const tbody = el('tbody', {}, rows.map((row) =>
      el('tr', { className: new Set(row.values).size > 1 ? 'comparison-difference' : '' }, [
        el('th', { scope: 'row' }, row.label),
        ...row.values.map((val) => el('td', {}, val))
      ])
    ));

    tableMount.appendChild(
      el('div', { className: 'table-scroll' }, [
        el('table', { className: 'data-table' }, [el('thead', {}, theadRow), tbody])
      ])
    );
  }

  if (presetBar) {
    const presets = [
      { label: 'Permissive Trio', ids: ['MIT', 'BSD-3-Clause', 'Apache-2.0', ''] },
      { label: 'Copyleft Spectrum', ids: ['MPL-2.0', 'LGPL-3.0-only', 'GPL-3.0-only', 'AGPL-3.0-only'] },
      { label: 'GPLv2 vs GPLv3 vs Apache', ids: ['GPL-2.0-only', 'GPL-3.0-only', 'Apache-2.0', ''] }
    ];
    for (const preset of presets) {
      presetBar.appendChild(
        el(
          'button',
          {
            type: 'button',
            className: 'btn btn-secondary btn-sm',
            onClick: () => {
              selectedSlots = [...preset.ids];
              renderSlots();
              renderMatrix();
            }
          },
          preset.label
        )
      );
    }
  }

  // Inbound Dependency Compatibility Checker
  if (projSelect && depSelect && compatResultMount) {
    for (const lic of LICENSE_CATALOG) {
      projSelect.appendChild(el('option', { value: lic.id, selected: lic.id === 'GPL-2.0-only' }, `${lic.id} — ${lic.name}`));
      depSelect.appendChild(el('option', { value: lic.id, selected: lic.id === 'Apache-2.0' }, `${lic.id} — ${lic.name}`));
    }

    function renderCompat() {
      const assessment = checkCompatibility(projSelect.value, depSelect.value);
      const badgeInfo = COMPAT_BADGE_MAP[assessment.status] || COMPAT_BADGE_MAP.unknown;
      const flashClass =
        assessment.status === 'compatible'
          ? 'flash-success'
          : assessment.status === 'conditional'
            ? 'flash-warning'
            : assessment.status === 'incompatible'
              ? 'flash-error'
              : 'flash-info';

      clearNode(compatResultMount);
      compatResultMount.appendChild(
        el('div', { className: `flash ${flashClass} stack-sm` }, [
          el('div', { className: 'cluster' }, [
            el('span', { className: `badge ${badgeInfo.className}` }, badgeInfo.label),
            el('strong', {}, `Incorporating ${assessment.dependencyLicense} into a ${assessment.projectLicense} project`)
          ]),
          el('p', {}, assessment.reason),
          assessment.requiredActions.length > 0
            ? el('ul', {}, assessment.requiredActions.map((act) => el('li', {}, act)))
            : null
        ])
      );
    }

    projSelect.addEventListener('change', renderCompat);
    depSelect.addEventListener('change', renderCompat);
    renderCompat();
  }

  document.getElementById('compare-differences')?.addEventListener('change', renderMatrix);
  renderSlots();
  renderMatrix();
}

/* ==========================================================================
   Page 5: Public Repository Analyzer (analyzer.html)
   ========================================================================== */
function initAnalyzerPage() {
  const form = document.getElementById('analyzer-form');
  const input = document.getElementById('repo-input');
  const submitBtn = document.getElementById('analyzer-submit');
  const resultMount = document.getElementById('analyzer-results');
  const examplesMount = document.getElementById('analyzer-examples');
  if (!form || !input || !resultMount) return;

  async function runAnalysis(targetRepo) {
    clearNode(resultMount);
    resultMount.appendChild(el('div', { className: 'flash flash-info' }, `Inspecting ${targetRepo}...`));
    if (submitBtn) submitBtn.disabled = true;

    try {
      let report = null;
      if (window.location.protocol.startsWith('http')) {
        try {
          const apiRes = await fetch('/api/analyze', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ repo: targetRepo })
          });
          const contentType = apiRes.headers.get('content-type') || '';
          if (contentType.includes('application/json')) {
            const payload = await apiRes.json();
            if (!apiRes.ok) {
              throw new Error(payload.error || `Repository analysis failed (${apiRes.status})`);
            }
            report = payload;
          }
        } catch (backendErr) {
          if (backendErr instanceof TypeError) {
            // Network unreachable when static-only; fall through to browser API call
          } else {
            throw backendErr;
          }
        }
      }

      if (!report) {
        report = await analyzePublicRepository(targetRepo);
      }

      clearNode(resultMount);

      const repo = report.repository;
      const statusBadge =
        report.licenseStatus === 'licensed'
          ? el('span', { className: 'badge badge-success' }, `Licensed (${report.detectedLicense.spdxId})`)
          : report.licenseStatus === 'unrecognized'
            ? el('span', { className: 'badge badge-warning' }, 'Unrecognized License File')
            : el('span', { className: 'badge badge-danger' }, 'No LICENSE Detected');

      const repoBox = el('div', { className: 'box' }, [
        el('div', { className: 'box-header' }, [
          el('div', { className: 'cluster' }, [
            el('h2', { className: 'box-title text-mono' }, repo.fullName),
            statusBadge
          ]),
          isSafeHttpUrl(repo.htmlUrl)
            ? el('a', { className: 'btn btn-secondary btn-sm', href: repo.htmlUrl, target: '_blank', rel: 'noopener noreferrer' }, 'View on GitHub')
            : null
        ]),
        disclosure('Repository details', [
          repo.description ? el('p', {}, repo.description) : el('p', { className: 'text-muted' }, 'No repository description provided.'),
          el('div', { className: 'cluster text-small text-muted' }, [
            el('span', {}, `Default branch: ${repo.defaultBranch}`),
            el('span', {}, `Visibility: ${repo.visibility}`),
            el('span', {}, `Stars: ${repo.stars}`),
            repo.fork ? el('span', { className: 'badge badge-warning' }, 'Fork') : null,
            repo.archived ? el('span', { className: 'badge badge-neutral' }, 'Archived') : null
          ])
        ])
      ]);
      resultMount.appendChild(repoBox);

      // Findings list
      const findingsStack = el('div', { className: 'stack-sm' });
      for (const finding of report.findings) {
        const cls =
          finding.severity === 'success'
            ? 'flash-success'
            : finding.severity === 'danger'
              ? 'flash-error'
              : finding.severity === 'warning'
                ? 'flash-warning'
                : 'flash-info';
        findingsStack.appendChild(
          el('div', { className: `flash ${cls}` }, [
            el('strong', {}, `${finding.title}: `),
            finding.detail
          ])
        );
      }
      resultMount.appendChild(disclosure('Findings and checks', findingsStack));

      // Root Files & Manifests Observed
      const rootObs = report.rootObservations;
      resultMount.appendChild(
        el('div', { className: 'box' }, [
          el('div', { className: 'box-header' }, [el('h3', { className: 'box-title' }, 'Root Directory Audit')]),
          el('div', { className: 'box-body grid-3 text-small' }, [
            el('div', {}, [
              el('strong', {}, 'License Files Found'),
              rootObs.licenseFiles.length > 0
                ? el('ul', {}, rootObs.licenseFiles.map((f) => el('li', { className: 'text-mono' }, f.path)))
                : el('p', { className: 'text-muted' }, 'None in repository root')
            ]),
            el('div', {}, [
              el('strong', {}, 'Notice / Patent Files'),
              rootObs.noticeFiles.length > 0
                ? el('ul', {}, rootObs.noticeFiles.map((f) => el('li', { className: 'text-mono' }, f.path)))
                : el('p', { className: 'text-muted' }, 'None detected')
            ]),
            el('div', {}, [
              el('strong', {}, 'Dependency Manifests'),
              rootObs.dependencyManifests.length > 0
                ? el('ul', {}, rootObs.dependencyManifests.map((m) => el('li', {}, `${m.name} (${m.description})`)))
                : el('p', { className: 'text-muted' }, 'None in root directory')
            ])
          ])
        ])
      );

      if (report.detectedLicense.explanation) {
        resultMount.appendChild(
          el('div', { className: 'box' }, [
            el('div', { className: 'box-header' }, [
              el('h3', { className: 'box-title' }, `Detected License Breakdown (${report.detectedLicense.catalogId})`)
            ]),
            el('div', { className: 'box-body stack-md' }, [
              el('p', {}, report.detectedLicense.explanation.plainSummary),
              createPlainBreakdownBox(report.detectedLicense.explanation)
            ])
          ])
        );
      }

      // Action bar
      const actionBar = el('div', { className: 'box' }, [
        el('div', { className: 'box-header' }, [el('h3', { className: 'box-title' }, 'Recommended Next Steps')]),
        el('div', { className: 'box-body cluster' }, [
          el('a', { className: 'btn btn-primary btn-sm', href: `questionnaire.html` }, 'Find a license'),
          el('a', { className: 'btn btn-secondary btn-sm', href: `app-install.html?repo=${encodeURIComponent(repo.fullName)}` }, 'Add or replace license'),
          report.detectedLicense.catalogId
            ? el('a', { className: 'btn btn-secondary btn-sm', href: `explorer.html?license=${encodeURIComponent(report.detectedLicense.catalogId)}` }, 'Customize LICENSE Text')
            : null
        ])
      ]);
      repoBox.after(actionBar);

      if (report.rateLimit && report.rateLimit.remaining === 0) {
        const resetHint = report.rateLimit.resetAt
          ? ` Resets at ${new Date(report.rateLimit.resetAt).toLocaleTimeString()}.`
          : '';
        resultMount.appendChild(
          el('div', { className: 'flash flash-warning' }, `GitHub API rate limit reached (0 / ${report.rateLimit.limit || 60} requests remaining).${resetHint}`)
        );
      }
    } catch (err) {
      clearNode(resultMount);
      resultMount.appendChild(el('div', { className: 'flash flash-error' }, err.message));
    } finally {
      if (submitBtn) submitBtn.disabled = false;
    }
  }

  form.addEventListener('submit', (event) => {
    event.preventDefault();
    const target = input.value.trim();
    const url = new URL(window.location.href);
    if (target) url.searchParams.set('repo', target);
    window.history.replaceState({}, '', url);
    runAnalysis(target);
  });

  if (examplesMount) {
    const samples = ['expressjs/express', 'ayushcmd/license-advisor', 'facebook/react'];
    for (const sample of samples) {
      examplesMount.appendChild(
        el(
          'button',
          {
            type: 'button',
            className: 'btn btn-secondary btn-sm',
            onClick: () => {
              input.value = sample;
              runAnalysis(sample);
            }
          },
          sample
        )
      );
    }
  }

  const initialRepo = new URLSearchParams(window.location.search).get('repo');
  if (initialRepo) {
    input.value = initialRepo;
    runAnalysis(initialRepo);
  }
}

/* ==========================================================================
   Page 6: GitHub App & Automated PR Preview (app-install.html)
   ========================================================================== */
function initAppInstallPage() {
  const repoInput = document.getElementById('pr-repo');
  const licenseSelect = document.getElementById('pr-license');
  const holderInput = document.getElementById('pr-holder');
  const yearInput = document.getElementById('pr-year');
  const actionSelect = document.getElementById('pr-action');
  const readmeSelect = document.getElementById('pr-readme');
  const previewBranch = document.getElementById('pr-branch-preview');
  const previewTitle = document.getElementById('pr-title-preview');
  const previewBody = document.getElementById('pr-body-preview');
  const serverStatusEl = document.getElementById('server-status-banner');
  const installAppLink = document.getElementById('install-app-link');
  const triggerBtn = document.getElementById('pr-trigger-btn');
  const triggerStatus = document.getElementById('pr-trigger-status');

  if (!licenseSelect) return;

  const params = new URLSearchParams(window.location.search);
  const initialLicense = resolveLicense(params.get('license') || 'MIT')?.id || 'MIT';
  const initialRepo = params.get('repo') || '';

  for (const lic of LICENSE_CATALOG) {
    licenseSelect.appendChild(
      el('option', { value: lic.id, selected: lic.id === initialLicense }, `${lic.id} — ${lic.name}`)
    );
  }
  if (repoInput && initialRepo) repoInput.value = initialRepo;
  if (yearInput && !yearInput.value) yearInput.value = String(new Date().getFullYear());

  function updatePrPreview() {
    const readmePlacement = readmeSelect?.value || 'none';
    const selectedLicense = getLicenseById(licenseSelect.value);
    const readmePreview = document.getElementById('pr-readme-preview');
    if (readmePreview && selectedLicense) {
      const snippets = licenseReadmeSnippets(selectedLicense);
      readmePreview.textContent = readmePlacement === 'none' ? 'README will not be changed.'
        : readmePlacement === 'both' ? `${snippets.top}\n\n… existing README …\n\n${snippets.bottom}` : snippets[readmePlacement];
    }
    const copyrightPreview = document.getElementById('pr-copyright-preview');
    if (copyrightPreview) copyrightPreview.textContent = licenseSelect.value === 'Unlicense'
      ? 'Public-domain dedication · no copyright notice'
      : `Copyright (c) ${yearInput?.value || new Date().getFullYear()} ${holderInput?.value.trim() || 'Enter your name or organization'}`;
    const action = actionSelect?.value === 'replace' ? 'replace' : 'add';
    const licenseId = licenseSelect.value;
    const explanation = explainLicense(licenseId);
    const branchSlug = licenseId.toLowerCase().replace(/[^a-z0-9.-]+/g, '-').replace(/^-+|-+$/g, '');
    if (previewBranch) previewBranch.textContent = `chore/${action}-license-${branchSlug}`;
    if (previewTitle) previewTitle.textContent = `chore: ${action} ${licenseId} LICENSE`;
    if (previewBody && explanation) {
      const canLines = explanation.canDo.map((i) => `- ${i.label}: ${i.description}`).join('\n');
      const mustLines = explanation.mustDo.length
        ? explanation.mustDo.map((i) => `- ${i.label}: ${i.description}`).join('\n')
        : '- No additional redistribution conditions';
      const limitLines = explanation.cannotDo.map((i) => `- ${i.label}: ${i.description}`).join('\n');
      previewBody.textContent = [
        `## Summary`,
        action === 'replace'
          ? `This automated pull request replaces the existing license with **${explanation.name} (\`${explanation.id}\`)**. Review the license diff before merging.`
          : `This automated pull request adds a \`LICENSE\` file under **${explanation.name} (\`${explanation.id}\`)**.`,
        readmePlacement === 'none' ? 'README will not be changed.' : `Also adds a license mention to the repository README (${readmePlacement}). Existing license wording is preserved for review.`,
        ``,
        explanation.plainSummary,
        ``,
        `### Key Policy Highlights`,
        `- **Copyleft Obligation:** ${explanation.policyHighlights.copyleftObligation}`,
        `- **Patent Clause:** ${explanation.policyHighlights.patentClause}`,
        `- **Network-Use Trigger:** ${explanation.policyHighlights.networkUseTrigger}`,
        `- **Distribution Rules:** ${explanation.policyHighlights.distributionRequirements}`,
        ``,
        `### Permissions`,
        canLines,
        ``,
        `### Conditions`,
        mustLines,
        ``,
        `### Limitations`,
        limitLines,
        ``,
        `### Reference`,
        `- SPDX Specification: ${explanation.sourceUrls.spdx}`
      ].join('\n');
    }
  }

  licenseSelect.addEventListener('change', updatePrPreview);
  actionSelect?.addEventListener('change', updatePrPreview);
  readmeSelect?.addEventListener('change', updatePrPreview);
  holderInput?.addEventListener('input', updatePrPreview);
  yearInput?.addEventListener('input', updatePrPreview);
  updatePrPreview();

  // Check backend availability quietly; surface errors only on actual failure or user action
  let backendReady = false;
  let appConfigured = false;
  let statusProbe = Promise.resolve();
  if (window.location.protocol.startsWith('http')) {
    statusProbe = Promise.all([
      fetch('/api/health')
        .then(async (res) => (res.ok ? { ok: true, data: await res.json().catch(() => null) } : { ok: false, status: res.status }))
        .catch((err) => ({ ok: false, networkError: err })),
      fetch('/api/config')
        .then((res) => (res.ok ? res.json().catch(() => null) : null))
        .catch(() => null)
    ]).then(([healthResult, config]) => {
      if (healthResult.ok && healthResult.data?.status === 'ok') {
        backendReady = true;
        appConfigured = Boolean(healthResult.data.githubAppConfigured);
        if (serverStatusEl) {
          serverStatusEl.hidden = true;
          serverStatusEl.textContent = '';
        }
      } else if (serverStatusEl && (healthResult.networkError || (healthResult.status && healthResult.status >= 500))) {
        serverStatusEl.className = 'flash flash-error';
        serverStatusEl.textContent = 'Unable to reach the automated PR backend service. Please try again shortly.';
        serverStatusEl.hidden = false;
      }

      if (installAppLink && config && isSafeHttpUrl(config.installUrl)) {
        installAppLink.setAttribute('href', config.installUrl);
        installAppLink.setAttribute('target', '_blank');
        installAppLink.setAttribute('rel', 'noopener noreferrer');
        installAppLink.hidden = false;
      }
    });
  }

  if (triggerBtn && triggerStatus) {
    triggerBtn.addEventListener('click', async () => {
      await statusProbe;

      if (!backendReady || !appConfigured) {
        triggerStatus.className = 'flash flash-warning';
        triggerStatus.textContent = backendReady
          ? 'Automated Pull Requests require GitHub App credentials configured on the server.'
          : 'Automated PR creation requires the Express server with configured GitHub App credentials.';
        triggerStatus.hidden = false;
        return;
      }

      try {
        parseRepoInput(repoInput?.value || '');
        generateLicensePackage(licenseSelect.value, {
          year: yearInput?.value || '',
          holder: holderInput?.value || '',
          strict: true
        });
      } catch (validationErr) {
        triggerStatus.className = 'flash flash-error';
        triggerStatus.textContent = validationErr.message;
        triggerStatus.hidden = false;
        return;
      }

      triggerBtn.disabled = true;
      triggerStatus.className = 'flash flash-info';
      triggerStatus.textContent = 'Creating feature branch and opening Pull Request via GitHub App...';
      triggerStatus.hidden = false;

      try {
        const tokenInput = document.getElementById('pr-user-token');
        const token = tokenInput.value.trim();
        tokenInput.value = '';
        if (!token) throw new Error('Enter a GitHub user access token to verify repository write access.');
        const res = await fetch('/api/trigger-pr', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
          body: JSON.stringify({
            repo: repoInput?.value || '',
            licenseId: licenseSelect.value,
            year: yearInput?.value || '',
            holder: holderInput?.value || '',
            replaceExisting: actionSelect?.value === 'replace',
            readmePlacement: readmeSelect?.value || 'none'
          })
        });
        const payload = await res.json().catch(() => ({}));
        if (!res.ok) {
          throw new Error(payload.error || `Request failed (${res.status})`);
        }
        clearNode(triggerStatus);
        triggerStatus.className = 'flash flash-success';
        triggerStatus.appendChild(
          document.createTextNode(
            `Pull request #${payload.pullNumber} opened on branch ${payload.branch} -> ${payload.baseBranch}: `
          )
        );
        if (isSafeHttpUrl(payload.pullUrl)) {
          triggerStatus.appendChild(
            el('a', { href: payload.pullUrl, target: '_blank', rel: 'noopener noreferrer' }, payload.pullUrl)
          );
        }
      } catch (err) {
        triggerStatus.className = 'flash flash-error';
        triggerStatus.textContent = err.message;
      } finally {
        triggerBtn.disabled = false;
      }
    });
  }
}

/* ==========================================================================
   Bootstrap
   ========================================================================== */
document.addEventListener('DOMContentLoaded', () => {
  markActiveNav();
  const page = document.body.dataset.page;
  if (page === 'home') initHomePage();
  else if (page === 'explorer') initExplorerPage();
  else if (page === 'questionnaire') initQuestionnairePage();
  else if (page === 'compare') initComparePage();
  else if (page === 'analyzer') initAnalyzerPage();
  else if (page === 'app-install') initAppInstallPage();
});

