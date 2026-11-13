const form = document.getElementById('community-form');
const select = document.getElementById('community-template');
const fields = document.getElementById('community-fields');
const preview = document.getElementById('community-preview');
const status = document.getElementById('community-status');
const copy = document.getElementById('community-copy');
const download = document.getElementById('community-download');
const generate = document.getElementById('community-generate');
let templates = [];
let output = null;
let revision = 0;
const drafts = new Map();

function invalidate() {
  revision += 1; output = null; preview.textContent = 'Generate a document to preview its Markdown source.';
  copy.disabled = download.disabled = true;
  status.textContent = '';
}
function renderFields() {
  invalidate(); fields.replaceChildren();
  const template = templates.find((item) => item.id === select.value);
  for (const field of template.fields) {
    const group = document.createElement('div'); group.className = 'form-group';
    const label = document.createElement('label'); label.className = 'form-label'; label.htmlFor = `community-${field.id}`; label.textContent = field.label + (field.required ? ' *' : '');
    const input = document.createElement(field.type === 'textarea' ? 'textarea' : 'input');
    if (field.type !== 'textarea') input.type = field.type === 'url' ? 'url' : 'text';
    else input.rows = 3;
    input.className = 'input'; input.name = field.id; input.id = label.htmlFor;
    input.maxLength = field.maxLength; input.required = field.required;
    input.value = drafts.get(template.id)?.[field.id] ?? field.defaultValue;
    group.append(label, input); fields.append(group);
  }
  document.getElementById('community-filename').textContent = template.filename;
  document.getElementById('community-warning').hidden = template.id !== 'code-of-conduct';
}
form.addEventListener('input', () => {
  drafts.set(select.value, Object.fromEntries(new FormData(form)));
  invalidate();
});
select.addEventListener('change', renderFields);
form.addEventListener('submit', async (event) => {
  event.preventDefault(); invalidate();
  const requestRevision = revision;
  generate.disabled = true; status.textContent = 'Generating document…';
  try {
    const response = await fetch('/api/community/generate', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ templateId: select.value, options: Object.fromEntries(new FormData(form)) }) });
    const data = await response.json();
    if (revision !== requestRevision) return;
    if (!response.ok) throw new Error(data.error || 'Generation failed.');
    output = data; preview.textContent = data.content;
    copy.disabled = download.disabled = false; status.textContent = 'Ready. Review the document before using it.';
    preview.focus();
  } catch (error) { if (revision === requestRevision) status.textContent = error.message; }
  finally { generate.disabled = false; }
});
copy.addEventListener('click', async () => {
  if (!output) return;
  try { await navigator.clipboard.writeText(output.content); status.textContent = 'Markdown copied.'; }
  catch { status.textContent = 'Clipboard unavailable. Select and copy the preview, or download the file.'; }
});
download.addEventListener('click', () => {
  if (!output) return;
  const url = URL.createObjectURL(new Blob([output.content], { type: 'text/markdown;charset=utf-8' }));
  const link = document.createElement('a'); link.href = url; link.download = output.filename;
  document.body.append(link); link.click(); link.remove(); setTimeout(() => URL.revokeObjectURL(url), 1000);
  status.textContent = 'Download started.';
});
try {
  const response = await fetch('/api/community/templates');
  if (!response.ok) throw new Error('Could not load templates. Refresh to try again.');
  templates = (await response.json()).templates;
  for (const template of templates) {
    const option = document.createElement('option'); option.value = template.id; option.textContent = `${template.name} — ${template.filename}`; select.append(option);
  }
  renderFields(); select.disabled = generate.disabled = false;
} catch (error) { status.textContent = error.message; }
