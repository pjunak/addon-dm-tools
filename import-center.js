const PROVIDER_ID = 'scenario-json';
const TERMINAL = new Set(['completed', 'failed', 'cancelled', 'expired', 'revision-conflict']);
const DIAGNOSTIC_KEYS = {
  SCENARIO_CREATE: 'diagnostic.create',
  SCENARIO_UPDATE: 'diagnostic.update',
  SCENARIO_SKIP: 'diagnostic.skip',
  SCENARIO_CONFLICT: 'diagnostic.conflict',
  SCENARIO_DOCUMENT_TYPE: 'diagnostic.documentType',
  SCENARIO_FORMAT_UNSUPPORTED: 'diagnostic.format',
  SCENARIO_SCHEMA_UNSUPPORTED: 'diagnostic.schema',
  SCENARIO_RECORDS_TYPE: 'diagnostic.recordsType',
  SCENARIO_RECORD_TYPE: 'diagnostic.recordType',
  SCENARIO_UNKNOWN_FIELD: 'diagnostic.unknownField',
  SCENARIO_FIELD_TYPE: 'diagnostic.fieldType',
  SCENARIO_FIELD_LENGTH: 'diagnostic.fieldLength',
  SCENARIO_TIMESTAMP_INVALID: 'diagnostic.timestamp',
  SCENARIO_ID_INVALID: 'diagnostic.id',
  SCENARIO_ID_DUPLICATE: 'diagnostic.duplicateId',
  SCENARIO_OPERATION_INVALID: 'diagnostic.operation',
  SCENARIO_STATUS_INVALID: 'diagnostic.status',
  SCENARIO_TAGS_INVALID: 'diagnostic.tags',
  SCENARIO_TAG_DUPLICATE: 'diagnostic.duplicateTag',
  SCENARIO_LOCAL_INVALID: 'diagnostic.localInvalid',
};

function initialState() {
  return {
    step: 'select-input',
    providerStatus: 'loading',
    file: null,
    fileName: '',
    jobId: '',
    previewToken: '',
    plan: null,
    committable: false,
    confirmed: false,
    ambiguous: false,
    errorCode: '',
    errorMessage: '',
    result: null,
  };
}

function counts(plan) {
  const result = { creates: 0, updates: 0, skips: 0, conflicts: 0, warnings: 0, errors: 0 };
  for (const item of plan?.diagnostics || []) {
    if (item.code === 'SCENARIO_CREATE') result.creates++;
    else if (item.code === 'SCENARIO_UPDATE') result.updates++;
    else if (item.code === 'SCENARIO_SKIP') result.skips++;
    else if (item.code === 'SCENARIO_CONFLICT') result.conflicts++;
    if (item.severity === 'warning') result.warnings++;
    if (item.severity === 'error') result.errors++;
  }
  return result;
}

function pathText(path) {
  if (!Array.isArray(path) || !path.length) return '';
  return path.reduce((value, part) => (
    typeof part === 'number' ? `${value}[${part}]` : (value ? `${value}.${part}` : part)
  ), '');
}

export function createImportCenter(host, options = {}) {
  const { esc, dataAction, dataOn } = host.h;
  const t = (key, params) => host.i18n.t(key, params);
  const focus = options.focus || (id => {
    if (typeof document === 'undefined') return;
    setTimeout(() => document.getElementById(id)?.focus(), 0);
  });
  let state = initialState();
  let generation = 0;
  let disposed = false;

  function publish(messageKey, focusId) {
    host.ui.rerender();
    if (messageKey) host.ui.announce(t(messageKey));
    if (focusId) focus(focusId);
  }

  function fail(error, fallback = 'failed') {
    state.errorCode = error?.code || 'IMPORT_UNKNOWN';
    state.errorMessage = error?.message || '';
    state.ambiguous = false;
    if (state.errorCode === 'IMPORT_REVISION_CONFLICT') state.step = 'revision-conflict';
    else if (state.errorCode === 'IMPORT_EXPIRED') state.step = 'expired';
    else if (state.errorCode === 'IMPORT_CANCELLED') state.step = 'cancelled';
    else state.step = fallback;
  }

  async function initialize() {
    const current = ++generation;
    try {
      const listed = await host.imports.listProviders();
      if (disposed || current !== generation) return;
      state.providerStatus = listed.providers.some(provider => provider.id === PROVIDER_ID)
        ? 'ready'
        : 'missing';
      if (state.providerStatus === 'missing') {
        fail({ code: 'IMPORT_PROVIDER_NOT_FOUND' });
      }
    } catch (error) {
      if (disposed || current !== generation) return;
      state.providerStatus = 'error';
      fail(error);
    }
    publish('', state.step === 'select-input' ? 'dm-import-file' : 'dm-import-state');
  }

  function selectFile(input) {
    if (disposed || state.step !== 'select-input') return;
    const file = input?.files?.[0] || null;
    state.file = file;
    state.fileName = file && typeof file.name === 'string' ? file.name : '';
    state.errorCode = '';
    state.errorMessage = '';
    publish('announce.fileSelected', file ? 'dm-import-preview' : 'dm-import-file');
  }

  async function requestPreview() {
    if (disposed || state.step !== 'select-input' || !state.file || state.providerStatus !== 'ready') return;
    const current = ++generation;
    state.step = 'validating';
    state.errorCode = '';
    publish('announce.validating', 'dm-import-state');
    try {
      const job = await host.imports.createJob({
        providerId: PROVIDER_ID,
        file: state.file,
        format: 'json',
      });
      if (disposed || current !== generation) return;
      state.jobId = job.id;
      host.ui.rerender();
      const preview = await host.imports.preview(job.id);
      if (disposed || current !== generation) return;
      state.previewToken = preview.previewToken;
      state.plan = preview.plan;
      state.committable = preview.committable === true;
      state.confirmed = false;
      state.step = 'preview';
      publish('announce.previewReady', 'dm-import-preview-heading');
    } catch (error) {
      if (disposed || current !== generation) return;
      fail(error);
      publish('announce.failed', 'dm-import-state');
    }
  }

  function review() {
    if (disposed || state.step !== 'preview') return;
    state.step = 'review';
    publish('announce.review', 'dm-import-review-heading');
  }

  function confirm(checked) {
    if (disposed || state.step !== 'review') return;
    state.confirmed = checked === true;
    host.ui.rerender();
    focus('dm-import-confirm');
  }

  function applyJobStatus(job) {
    if (job?.state === 'completed' && job.result) {
      state.step = 'completed';
      state.result = job.result;
      state.ambiguous = false;
      return true;
    }
    if (job?.state === 'expired') fail(job.error || { code: 'IMPORT_EXPIRED' }, 'expired');
    else if (job?.state === 'cancelled') fail(job.error || { code: 'IMPORT_CANCELLED' }, 'cancelled');
    else if (job?.state === 'failed') fail(job.error || { code: 'IMPORT_COMMIT_FAILED' });
    else return false;
    return true;
  }

  async function recoverStatus() {
    if (disposed || !state.jobId) return;
    const current = generation;
    try {
      const job = await host.imports.getJob(state.jobId);
      if (disposed || current !== generation) return;
      if (!applyJobStatus(job)) {
        state.step = job.state === 'preview-ready' ? 'review' : 'committing';
        state.ambiguous = true;
        state.confirmed = false;
      }
      publish(state.step === 'completed' ? 'announce.completed' : 'announce.statusChecked', 'dm-import-state');
    } catch (error) {
      if (disposed || current !== generation) return;
      fail(error);
      publish('announce.failed', 'dm-import-state');
    }
  }

  async function commit() {
    if (disposed || state.step !== 'review' || !state.confirmed || !state.committable) return;
    const current = ++generation;
    state.step = 'committing';
    state.ambiguous = false;
    publish('announce.committing', 'dm-import-state');
    try {
      state.result = await host.imports.commit(state.jobId, state.previewToken);
      if (disposed || current !== generation) return;
      state.step = 'completed';
      state.previewToken = '';
      publish('announce.completed', 'dm-import-state');
    } catch (error) {
      if (disposed || current !== generation) return;
      if (error?.code === 'IMPORT_NETWORK') {
        state.ambiguous = true;
        await recoverStatus();
        return;
      }
      fail(error);
      state.previewToken = '';
      publish('announce.failed', 'dm-import-state');
    }
  }

  async function cancel() {
    if (disposed || !state.jobId || TERMINAL.has(state.step) || state.step === 'committing') return;
    const jobId = state.jobId;
    const current = ++generation;
    state.step = 'cancelled';
    state.previewToken = '';
    publish('announce.cancelled', 'dm-import-state');
    try {
      await host.imports.cancel(jobId);
    } catch (error) {
      if (disposed || current !== generation || error?.code === 'IMPORT_CANCELLED') return;
      state.errorCode = error?.code || 'IMPORT_CANCEL_FAILED';
    }
  }

  async function reset() {
    const jobId = state.jobId;
    const shouldCancel = jobId && !TERMINAL.has(state.step) && state.step !== 'committing';
    ++generation;
    const providerStatus = state.providerStatus;
    state = initialState();
    state.providerStatus = providerStatus;
    if (shouldCancel) await host.imports.cancel(jobId).catch(() => {});
    if (!disposed) publish('', 'dm-import-file');
  }

  async function leave() {
    if (disposed) return;
    await reset();
  }

  async function dispose() {
    if (disposed) return;
    const jobId = state.jobId;
    const shouldCancel = jobId && !TERMINAL.has(state.step) && state.step !== 'committing';
    disposed = true;
    ++generation;
    state.file = null;
    state.previewToken = '';
    if (shouldCancel) await host.imports.cancel(jobId).catch(() => {});
  }

  function diagnosticText(item) {
    const key = DIAGNOSTIC_KEYS[item.code];
    return key ? t(key) : t('diagnostic.fallback', { message: item.message || item.code });
  }

  function diagnosticsHtml() {
    const items = state.plan?.diagnostics || [];
    if (!items.length) return `<p class="settings-hint">${esc(t('preview.noDiagnostics'))}</p>`;
    return `<ul class="codex-warnings">${items.map(item => {
      const location = pathText(item.path);
      return `<li>
        <strong>${esc(t(`severity.${item.severity}`))}</strong>
        <span>${esc(diagnosticText(item))}</span>
        ${location ? `<code>${esc(location)}</code>` : ''}
        <span class="codex-badge">${esc(item.code)}</span>
      </li>`;
    }).join('')}</ul>`;
  }

  function operationsHtml() {
    const operations = state.plan?.operations || [];
    if (!operations.length) return `<p class="settings-hint">${esc(t('preview.noChanges'))}</p>`;
    return `<div>${operations.map(operation => `
      <article class="codex-link-row">
        <div>
          <strong>${esc(operation.id)}</strong>
          <div>${esc(operation.value?.name || '')}</div>
        </div>
        <span class="codex-badge">${esc(operation.value?.status || '')}</span>
      </article>`).join('')}</div>`;
  }

  function summaryHtml() {
    const value = counts(state.plan);
    return `<dl>
      <div><dt>${esc(t('summary.creates'))}</dt><dd>${esc(host.i18n.formatNumber(value.creates))}</dd></div>
      <div><dt>${esc(t('summary.updates'))}</dt><dd>${esc(host.i18n.formatNumber(value.updates))}</dd></div>
      <div><dt>${esc(t('summary.skips'))}</dt><dd>${esc(host.i18n.formatNumber(value.skips))}</dd></div>
      <div><dt>${esc(t('summary.conflicts'))}</dt><dd>${esc(host.i18n.formatNumber(value.conflicts))}</dd></div>
      <div><dt>${esc(t('summary.warnings'))}</dt><dd>${esc(host.i18n.formatNumber(value.warnings))}</dd></div>
      <div><dt>${esc(t('summary.errors'))}</dt><dd>${esc(host.i18n.formatNumber(value.errors))}</dd></div>
    </dl>`;
  }

  function errorText() {
    const known = {
      IMPORT_NETWORK: 'error.network',
      IMPORT_FORBIDDEN: 'error.forbidden',
      IMPORT_PROVIDER_NOT_FOUND: 'error.providerMissing',
      IMPORT_PROVIDER_CHANGED: 'error.providerChanged',
      IMPORT_REVISION_CONFLICT: 'error.revisionConflict',
      IMPORT_EXPIRED: 'error.expired',
      IMPORT_CANCELLED: 'error.cancelled',
      IMPORT_TIMEOUT: 'error.timeout',
      IMPORT_BUSY: 'error.busy',
      IMPORT_INPUT_LIMIT: 'error.inputLimit',
    };
    return t(known[state.errorCode] || 'error.generic');
  }

  function stepIndicator() {
    const order = ['select-input', 'validating', 'preview', 'review', 'committing', 'completed'];
    const active = order.includes(state.step) ? state.step : '';
    return `<ol class="codex-tab-strip" aria-label="${esc(t('steps.label'))}">
      ${order.map(step => `<li class="codex-tab${step === active ? ' is-active' : ''}"${step === active ? ' aria-current="step"' : ''}>${esc(t(`steps.${step}`))}</li>`).join('')}
    </ol>`;
  }

  function selectHtml() {
    return `<section class="settings-panel" aria-labelledby="dm-import-select-heading">
      <h2 id="dm-import-select-heading">${esc(t('select.title'))}</h2>
      <p class="settings-hint" id="dm-import-help">${esc(t('select.help'))}</p>
      <div class="settings-field">
        <label class="settings-field-label" for="dm-import-file">${esc(t('select.fileLabel'))}</label>
        <input class="edit-input" id="dm-import-file" type="file" accept=".json,application/json"
          aria-describedby="dm-import-help"${dataOn('change', host.action('selectFile'), '$el')}>
      </div>
      ${state.fileName ? `<p>${esc(t('select.chosen', { name: state.fileName }))}</p>` : ''}
      <button class="edit-save-btn" id="dm-import-preview" type="button"
        ${!state.file || state.providerStatus !== 'ready' ? 'disabled' : ''}${dataAction(host.action('preview'))}>${esc(t('action.preview'))}</button>
    </section>`;
  }

  function previewHtml(reviewing = false) {
    const blocked = !state.committable || counts(state.plan).errors > 0;
    return `<section class="settings-panel" aria-labelledby="${reviewing ? 'dm-import-review-heading' : 'dm-import-preview-heading'}">
      <h2 id="${reviewing ? 'dm-import-review-heading' : 'dm-import-preview-heading'}" tabindex="-1">${esc(t(reviewing ? 'review.title' : 'preview.title'))}</h2>
      <p>${esc(t('preview.file', { name: state.fileName }))}</p>
      ${summaryHtml()}
      <h3>${esc(t('preview.operations'))}</h3>
      ${operationsHtml()}
      <h3>${esc(t('preview.diagnostics'))}</h3>
      ${diagnosticsHtml()}
      ${blocked ? `<p role="alert">${esc(t('review.blocked'))}</p>` : ''}
      ${reviewing ? `
        <div class="settings-field">
          <label><input id="dm-import-confirm" type="checkbox" ${state.confirmed ? 'checked' : ''}${dataOn('change', host.action('confirm'), '$checked')}>
            ${esc(t('review.confirm'))}</label>
        </div>
        <button class="edit-save-btn" type="button" ${!state.confirmed || blocked ? 'disabled' : ''}${dataAction(host.action('commit'))}>${esc(t('action.commit'))}</button>
      ` : `<button class="edit-save-btn" type="button"${dataAction(host.action('review'))}>${esc(t('action.review'))}</button>`}
      <button class="inline-create-btn" type="button"${dataAction(host.action('reset'))}>${esc(t('action.chooseAnother'))}</button>
      <button class="edit-delete-btn" type="button"${dataAction(host.action('cancel'))}>${esc(t('action.cancel'))}</button>
    </section>`;
  }

  function stateHtml() {
    if (state.step === 'select-input') return selectHtml();
    if (state.step === 'preview') return previewHtml(false);
    if (state.step === 'review') return previewHtml(true);
    if (state.step === 'validating' || state.step === 'committing') {
      return `<section class="settings-panel" id="dm-import-state" tabindex="-1" aria-busy="true">
        <h2>${esc(t(`state.${state.step}.title`))}</h2>
        <p>${esc(t(`state.${state.step}.body`))}</p>
        ${state.ambiguous ? `<button class="inline-create-btn" type="button"${dataAction(host.action('status'))}>${esc(t('action.checkStatus'))}</button>` : ''}
        ${state.step === 'validating' && state.jobId ? `<button class="edit-delete-btn" type="button"${dataAction(host.action('cancel'))}>${esc(t('action.cancel'))}</button>` : ''}
      </section>`;
    }
    if (state.step === 'completed') {
      return `<section class="settings-panel" id="dm-import-state" tabindex="-1">
        <h2>${esc(t('state.completed.title'))}</h2>
        <p>${esc(host.i18n.plural('state.completed.body', state.result?.operationCount || 0))}</p>
        <p>${esc(t('state.completed.commit', { id: state.result?.commitId || t('state.completed.noCommit') }))}</p>
        <button class="edit-save-btn" type="button"${dataAction(host.action('reset'))}>${esc(t('action.importAnother'))}</button>
      </section>`;
    }
    return `<section class="settings-panel" id="dm-import-state" tabindex="-1" role="alert">
      <h2>${esc(t(`state.${state.step}.title`))}</h2>
      <p>${esc(errorText())}</p>
      ${state.step === 'revision-conflict' ? `<p>${esc(t('state.revision-conflict.body'))}</p>` : ''}
      <button class="edit-save-btn" type="button"${dataAction(host.action('reset'))}>${esc(t('action.newPreview'))}</button>
    </section>`;
  }

  function render() {
    if (!host.role.isDM()) return `<section class="settings-panel" role="alert">${esc(t('error.forbidden'))}</section>`;
    return `<main class="addon-dm-tools">
      ${host.h.breadcrumb([{ label: t('breadcrumb.tools'), href: '#/dm' }, { label: t('page.title') }])}
      <div class="page-header"><h1>${esc(t('page.title'))}</h1></div>
      <p class="settings-hint">${esc(t('page.description'))}</p>
      ${stepIndicator()}
      ${stateHtml()}
    </main>`;
  }

  function getState() {
    return {
      step: state.step,
      providerStatus: state.providerStatus,
      fileName: state.fileName,
      jobId: state.jobId,
      confirmed: state.confirmed,
      committable: state.committable,
      ambiguous: state.ambiguous,
      errorCode: state.errorCode,
      result: state.result ? structuredClone(state.result) : null,
      counts: counts(state.plan),
    };
  }

  return {
    initialize,
    selectFile,
    requestPreview,
    review,
    confirm,
    commit,
    recoverStatus,
    cancel,
    reset,
    leave,
    dispose,
    render,
    getState,
  };
}
