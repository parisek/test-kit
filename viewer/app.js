import { adaptReport } from '../src/report/model.js';
import { targetClass, targetState, cellClass, cellState, summarize, findingsFor } from '../src/report/classify.js';
import { sameOriginUrl } from '../src/report/safe.js';

const $ = id => document.getElementById(id);
const state = { report: null, source: null, targetId: null, viewportId: null, view: 'detail', sidebarHidden: innerWidth <= 860, theme: 'light', loading: false };
let loadId = 0;
function stored(key) { try { return localStorage.getItem(key); } catch { return null; } }
function persist(key, value) { try { localStorage.setItem(key, value); } catch { /* Storage is optional. */ } }
state.sidebarHidden = stored('test-kit-sidebar') === null ? state.sidebarHidden : stored('test-kit-sidebar') === 'hidden';
state.theme = stored('test-kit-theme') === 'dark' ? 'dark' : 'light';
function element(tag, text, className) {
  const node = document.createElement(tag);
  if (text != null) node.textContent = String(text);
  if (className) node.className = className;
  return node;
}
function badge(text) { return element('span', text, `badge ${text}`); }
function diagnostic(container, value) { if (value != null) container.append(element('pre', typeof value === 'string' ? value : JSON.stringify(value, null, 2))); }
function availability(container, row) {
  for (const side of ['a', 'b']) container.append(badge(`${side.toUpperCase()}: ${row.availability?.[side] ?? 'unknown'}`));
}
function ratio(row) { const value = row.ratio ?? row.artifacts?.screenshot?.diff?.ratio; return Number.isFinite(value) ? `${value.toFixed(3)}%` : 'No ratio'; }
function selectTargetButton(target) {
  const button = element('button', target.title ?? target.id);
  button.append(document.createTextNode(' '), badge(targetClass(state.report, target) ?? 'unclassified'), badge(targetState(target)));
  button.setAttribute('aria-current', String(state.targetId === target.id));
  button.onclick = () => dispatch('target', target.id);
  return button;
}
function render() {
  document.body.classList.toggle('sidebar-hidden', state.sidebarHidden);
  document.documentElement.dataset.theme = state.theme;
  $('sidebar-toggle').setAttribute('aria-expanded', String(!state.sidebarHidden));
  for (const button of document.querySelectorAll('[data-view]')) button.setAttribute('aria-current', String(button.dataset.view === state.view));
  $('sidebar').replaceChildren(); $('content').replaceChildren();
  if (!state.report) return;
  const report = state.report;
  const summary = summarize(report);
  $('sidebar').append(element('h2', 'Targets'));
  for (const target of report.entries) $('sidebar').append(selectTargetButton(target));
  const heading = element('section', null, 'panel');
  heading.append(element('h1', report.meta.title ?? 'Comparison'), element('p', `${report.pair.kind}: ${report.pair.aRunId} → ${report.pair.bRunId}`));
  heading.append(element('p', Object.entries(summary.counts).map(([key, value]) => `${key}: ${value}`).join(' · ')));
  heading.append(element('p', `Noise floor: ${report.meta.noiseFloor == null ? 'unknown; repeatability is not measured' : JSON.stringify(report.meta.noiseFloor)}. Display hint: ${report.meta.matchBelow}%. The ratio is not a verdict.`));
  $('content').append(heading);
  ({ detail: renderDetail, matrix: renderMatrix, findings: renderFindings, timeline: renderTimeline })[state.view]();
}
function renderDetail() {
  const report = state.report;
  const target = report.entries.find(item => item.id === state.targetId);
  if (!target) { $('content').append(element('p', 'No target available.')); return; }
  const panel = element('section', null, 'panel');
  panel.append(element('h2', target.title ?? target.id), element('p', `${target.kind ?? 'target'} · ${target.path ?? ''}`), badge(targetClass(report, target) ?? 'unclassified'), badge(targetState(target)));
  if (target.note) panel.append(element('p', target.note));
  if (Array.isArray(target.composedOf) && target.composedOf.length) panel.append(element('p', `Composed of: ${target.composedOf.map(item => typeof item === 'string' ? item : item?.id).filter(Boolean).join(', ')}`));
  const usedOn = report.entries.filter(item => Array.isArray(item.composedOf) && item.composedOf.some(part => (typeof part === 'string' ? part : part?.id) === target.id));
  if (usedOn.length) panel.append(element('p', `Used on: ${usedOn.map(item => item.title ?? item.id).join(', ')}`));
  const label = element('label', 'Viewport '); const select = element('select'); select.setAttribute('aria-label', 'Viewport');
  for (const row of target.viewports) { const option = element('option', row.id); option.value = row.id; option.selected = row.id === state.viewportId; select.append(option); }
  select.onchange = () => dispatch('viewport', select.value); label.append(select); panel.append(label);
  const row = target.viewports.find(item => item.id === state.viewportId) ?? target.viewports[0];
  if (row) {
    panel.append(element('h3', row.id), badge(cellClass(report, target, row.id) ?? 'unclassified'), badge(cellState(target, row.id)), element('p', `Difference: ${ratio(row)}`));
    availability(panel, row); diagnostic(panel, row.error ?? row.diagnostic);
    const images = element('div', null, 'images');
    for (const [key, title] of [['a', 'A'], ['b', 'B'], ['diff', 'Difference']]) {
      const figure = element('figure'); figure.append(element('figcaption', title));
      const shot = row.artifacts?.screenshot?.[key];
      const url = shot?.src ? sameOriginUrl(shot.src, state.source) : null;
      if (url) { const link = element('a', 'Open full resolution'); link.href = url; const image = element('img'); image.src = url; image.alt = `${title}: ${target.title ?? target.id}, ${row.id}`; image.loading = 'lazy'; image.onerror = () => { image.replaceWith(element('p', 'Image is unavailable.')); }; figure.append(link, image); }
      else figure.append(element('p', 'No image evidence.'));
      images.append(figure);
    }
    panel.append(images);
    diagnostic(panel, row.artifacts?.screenshot?.diff?.regions);
    const provenance = element('details'); provenance.append(element('summary', 'Artifact provenance')); diagnostic(provenance, row.artifacts); panel.append(provenance);
  }
  const findings = findingsFor(report, target.id);
  panel.append(element('h3', `Findings (${findings.length})`));
  for (const finding of findings) diagnostic(panel, finding);
  $('content').append(panel);
}
function renderMatrix() {
  const table = element('table'); const head = element('tr'); head.append(element('th', 'Target'));
  for (const viewport of state.report.meta.viewports) head.append(element('th', viewport.id));
  const thead = element('thead'); thead.append(head); table.append(thead); const body = element('tbody');
  for (const target of state.report.entries) {
    const tr = element('tr'); const title = element('th'); title.append(selectTargetButton(target)); tr.append(title);
    for (const viewport of state.report.meta.viewports) {
      const td = element('td'); const row = target.viewports.find(item => item.id === viewport.id);
      td.append(badge(cellClass(state.report, target, viewport.id) ?? 'unclassified'), badge(cellState(target, viewport.id)));
      if (row) { td.append(element('p', ratio(row))); availability(td, row); }
      tr.append(td);
    }
    body.append(tr);
  }
  table.append(body); const scroll = element('div', null, 'scroll'); scroll.append(table); $('content').append(scroll);
}
function renderFindings() {
  const groups = new Map();
  for (const finding of state.report.findings) { const key = finding.causeId ?? null; if (!groups.has(key)) groups.set(key, []); groups.get(key).push(finding); }
  if (!groups.size) $('content').append(element('p', 'No findings. Check measurement states before drawing a conclusion.'));
  for (const [id, findings] of groups) {
    const cause = state.report.causes.find(item => item.id === id); const panel = element('section', null, 'panel');
    panel.append(element('h2', cause?.title ?? 'Unknown cause'), badge(cause?.known ? 'explained' : 'unexplained'));
    if (cause?.detail) panel.append(element('p', cause.detail));
    for (const finding of findings) {
      const target = state.report.entries.find(item => item.id === finding.targetId);
      if (target) panel.append(selectTargetButton(target)); diagnostic(panel, finding);
    }
    $('content').append(panel);
  }
}
function renderTimeline() {
  for (const run of state.report.runs) {
    const panel = element('section', null, 'panel'); panel.append(element('h2', `${run.label ?? run.id} (${run.id})`), element('p', `${run.side ?? 'Unknown side'} · ${run.at ?? 'Time unknown'} · ${run.state ?? 'State unknown'}`));
    panel.append(element('h3', 'Settle recipe and tools'));
    diagnostic(panel, run.settings?.sides?.[run.side]?.settle ?? run.settle ?? 'Settle recipe unavailable');
    diagnostic(panel, run.tools ?? state.report.meta.tools ?? 'Tool provenance unavailable');
    diagnostic(panel, run.settingsHash); $('content').append(panel);
  }
}
async function load(source) {
  const id = ++loadId;
  const url = sameOriginUrl(source, location.href);
  if (!url) { $('notice').textContent = 'Use a report URL on this origin.'; return; }
  $('notice').textContent = 'Loading report…';
  try {
    const response = await fetch(url);
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const report = adaptReport(await response.json());
    if (id !== loadId) return;
    dispatch('loaded', { report, source: url });
    $('notice').textContent = `Loaded ${report.entries.length} targets.`;
  } catch (error) { if (id === loadId) $('notice').textContent = `Cannot load report: ${error.message}`; }
}
function dispatch(action, value) {
  if (action === 'sidebar') { state.sidebarHidden = !state.sidebarHidden; persist('test-kit-sidebar', state.sidebarHidden ? 'hidden' : 'visible'); }
  else if (action === 'theme') { state.theme = state.theme === 'light' ? 'dark' : 'light'; persist('test-kit-theme', state.theme); }
  else if (action === 'view') state.view = value;
  else if (action === 'target') { state.targetId = value; state.viewportId = state.report.entries.find(item => item.id === value)?.viewports[0]?.id; state.view = 'detail'; if (innerWidth <= 860) state.sidebarHidden = true; }
  else if (action === 'viewport') state.viewportId = value;
  else if (action === 'loaded') { state.report = value.report; state.source = value.source; state.targetId = value.report.entries[0]?.id; state.viewportId = value.report.entries[0]?.viewports[0]?.id; state.view = ['migration', 'deploy', 'update'].includes(value.report.pair.kind) ? 'matrix' : 'detail'; }
  render();
}
$('sidebar-toggle').onclick = () => dispatch('sidebar');
$('theme').onclick = () => dispatch('theme');
for (const button of document.querySelectorAll('[data-view]')) button.onclick = () => dispatch('view', button.dataset.view);
$('source-form').onsubmit = event => { event.preventDefault(); load($('source').value); };
document.addEventListener('keydown', event => { if (event.key === '[' && !['INPUT', 'TEXTAREA', 'SELECT'].includes(event.target.tagName) && !event.ctrlKey && !event.metaKey && !event.altKey) { event.preventDefault(); dispatch('sidebar'); } });
render(); load($('source').value);
