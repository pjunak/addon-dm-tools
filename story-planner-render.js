import {
  BRANCH_TYPES,
  CONSEQUENCE_KINDS,
  CORE_REFERENCE_COLLECTIONS,
  EVENT_TYPES,
  FLOW_KINDS,
  PLANNING_KINDS,
  REFERENCE_RELATIONS,
} from './planning-contract.js';
import { itemAncestors, orthogonalPath, records } from './story-planner-model.js';
import { STORY_PLANNER_STYLES } from './story-planner-styles.js';

function option(value, selected, label) {
  return `<option value="${value}"${value === selected ? ' selected' : ''}>${label}</option>`;
}

function itemTypeKey(item) {
  if (item.kind === 'event') return `planner.eventType.${item.eventType}`;
  if (item.kind === 'branch') return `planner.branchType.${item.branchType}`;
  return `planner.kind.${item.kind}`;
}

function itemTypeLabel(item, t) {
  return t(itemTypeKey(item));
}

function itemPathLabel(item, items) {
  const ancestors = itemAncestors(item.id, items);
  return (ancestors.length ? ancestors : [item]).map(value => value.title).join(' / ');
}

function coreData(host) {
  return {
    characters: records(host.store.getCharacters()),
    factions: records(host.store.getFactions()),
    locations: records(host.store.getLocations()),
    mysteries: records(host.store.getMysteries()),
    artifacts: records(host.store.getCollection('artifacts')),
    events: records(host.store.getEvents()),
  };
}

function targetLabel(target, data, host) {
  if (target?.scope === 'planning') {
    return data.items.find(item => item.id === target.itemId)?.title || target.itemId;
  }
  if (target?.scope === 'core') {
    const record = data.core[target.collection]?.find(value => value.id === target.id);
    return record?.name || record?.title || target.id;
  }
  return target?.label || target?.id || host.i18n.t('planner.reference.missing');
}

function validationHtml(errors, esc, t) {
  if (!errors.length) return '';
  return `<section class="codex-warnings" role="alert">
    <strong>${esc(t('planner.validation.title'))}</strong>
    <ul>${errors.slice(0, 8).map(error => `<li>${esc(error.display || t('planner.validation.field'))}</li>`).join('')}</ul>
  </section>`;
}

function itemForm({ host, item, data, formId, isNew = false }) {
  const { esc, dataAction, dataOn } = host.h;
  const t = (key, params) => host.i18n.t(key, params);
  const unavailableParents = new Set([item.id]);
  let changed = true;
  while (changed) {
    changed = false;
    for (const candidate of data.items) {
      if (candidate.parentId && unavailableParents.has(candidate.parentId)
          && !unavailableParents.has(candidate.id)) {
        unavailableParents.add(candidate.id);
        changed = true;
      }
    }
  }
  const parentOptions = data.items
    .filter(value => (
      (value.kind === 'plotline' || value.kind === 'quest')
      && value.id !== item.id
      && !unavailableParents.has(value.id)
    ))
    .sort((left, right) => left.title.localeCompare(right.title))
    .map(value => option(value.id, item.parentId, esc(value.title)))
    .join('');
  return `<form class="dmt-planner-form" id="${esc(formId)}"${dataOn('submit', host.action('plannerSaveItem'), '$ev')}>
    <input type="hidden" name="id" value="${esc(item.id)}">
    <div class="dmt-planner-form-row">
      <label>${esc(t('planner.item.kind'))}
        <select class="edit-input" name="kind">
          ${PLANNING_KINDS.map(value => option(
            value,
            item.kind,
            esc(t(`planner.kind.${value}`)),
          )).join('')}
        </select>
      </label>
      <label>${esc(t('planner.item.parent'))}
        <select class="edit-input" name="parentId">
          ${option('', item.parentId || '', esc(t('planner.campaign')))}
          ${parentOptions}
        </select>
      </label>
    </div>
    ${item.kind === 'event' ? `<label>${esc(t('planner.item.eventType'))}
      <select class="edit-input" name="eventType">
        ${EVENT_TYPES.map(value => option(
          value,
          item.eventType || 'story',
          esc(t(`planner.eventType.${value}`)),
        )).join('')}
      </select>
    </label>` : ''}
    ${item.kind === 'branch' ? `<label>${esc(t('planner.item.branchType'))}
      <select class="edit-input" name="branchType">
        ${BRANCH_TYPES.map(value => option(
          value,
          item.branchType || 'decision',
          esc(t(`planner.branchType.${value}`)),
        )).join('')}
      </select>
    </label>` : ''}
    <label>${esc(t('planner.item.title'))}
      <input class="edit-input" name="title" required maxlength="160" value="${esc(item.title || '')}">
    </label>
    <label>${esc(t('planner.item.summary'))}
      <textarea class="edit-input" name="summary" maxlength="2000" rows="3">${esc(item.summary || '')}</textarea>
    </label>
    <label>${esc(t('planner.item.objective'))}
      <textarea class="edit-input" name="objective" maxlength="10000" rows="3">${esc(item.objective || '')}</textarea>
    </label>
    <label>${esc(t('planner.item.body'))}
      <textarea class="edit-input" name="body" maxlength="80000" rows="8">${esc(item.body || '')}</textarea>
    </label>
    <div class="dmt-planner-form-row">
      <label>${esc(t('planner.item.setup'))}
        <textarea class="edit-input" name="setup" maxlength="30000" rows="5">${esc(item.setup || '')}</textarea>
      </label>
      <label>${esc(t('planner.item.resolution'))}
        <textarea class="edit-input" name="resolution" maxlength="30000" rows="5">${esc(item.resolution || '')}</textarea>
      </label>
    </div>
    <label>${esc(t('planner.item.tags'))}
      <input class="edit-input" name="tags" maxlength="2400" value="${esc((item.tags || []).join(', '))}">
    </label>
    <div class="dmt-planner-form-actions">
      ${!isNew ? `<button class="edit-delete-btn" type="button"${dataAction(host.action('plannerDeleteItem'), item.id)}>${esc(t('planner.action.delete'))}</button>` : ''}
    </div>
  </form>`;
}

function referenceForms(item, data, host) {
  const { esc, dataOn } = host.h;
  const t = key => host.i18n.t(key);
  const entityOptions = CORE_REFERENCE_COLLECTIONS.flatMap(collection => (
    data.core[collection].map(entity => ({
      value: `${collection}:${entity.id}`,
      label: `${t(`planner.core.${collection}`)} — ${entity.name || entity.title || entity.id}`,
    }))
  )).sort((left, right) => left.label.localeCompare(right.label));
  const relationOptions = REFERENCE_RELATIONS.map(value => option(
    value,
    'involves',
    esc(t(`planner.relation.${value}`)),
  )).join('');
  const planningOptions = data.items
    .filter(value => value.id !== item.id)
    .map(value => ({ value: value.id, label: itemPathLabel(value, data.items) }))
    .sort((left, right) => left.label.localeCompare(right.label));
  return `${planningOptions.length ? `<details class="dmt-inline-details">
    <summary>${esc(t('planner.reference.addPlanning'))}</summary>
    <form class="dmt-planner-form"${dataOn('submit', host.action('plannerSavePlanningReference'), '$ev', item.id)}>
      <label>${esc(t('planner.reference.planningItem'))}
        <select class="edit-input" name="targetId" required>
          <option value="">${esc(t('planner.reference.choose'))}</option>
          ${planningOptions.map(value => option(value.value, '', esc(value.label))).join('')}
        </select>
      </label>
      <label>${esc(t('planner.reference.name'))}<input class="edit-input" name="name" required maxlength="200"></label>
      <div class="dmt-planner-form-row">
        <label>${esc(t('planner.reference.relation'))}<select class="edit-input" name="relation">${relationOptions}</select></label>
        <label>${esc(t('planner.reference.quantity'))}<input class="edit-input" type="number" name="quantity" min="1" max="1000" value="1"></label>
      </div>
      <label>${esc(t('planner.reference.notes'))}<textarea class="edit-input" name="notes" maxlength="2000" rows="3"></textarea></label>
      <button class="inline-create-btn" type="submit">${esc(t('planner.action.add'))}</button>
    </form>
  </details>` : ''}
  <details class="dmt-inline-details">
    <summary>${esc(t('planner.reference.addCore'))}</summary>
    <form class="dmt-planner-form"${dataOn('submit', host.action('plannerSaveCoreReference'), '$ev', item.id)}>
      <label>${esc(t('planner.reference.entity'))}
        <select class="edit-input" name="target" required>
          <option value="">${esc(t('planner.reference.choose'))}</option>
          ${entityOptions.map(value => option(esc(value.value), '', esc(value.label))).join('')}
        </select>
      </label>
      <label>${esc(t('planner.reference.name'))}<input class="edit-input" name="name" required maxlength="200"></label>
      <div class="dmt-planner-form-row">
        <label>${esc(t('planner.reference.relation'))}<select class="edit-input" name="relation">${relationOptions}</select></label>
        <label>${esc(t('planner.reference.quantity'))}<input class="edit-input" type="number" name="quantity" min="1" max="1000" value="1"></label>
      </div>
      <label>${esc(t('planner.reference.notes'))}<textarea class="edit-input" name="notes" maxlength="2000" rows="3"></textarea></label>
      <button class="inline-create-btn" type="submit">${esc(t('planner.action.add'))}</button>
    </form>
  </details>
  <details class="dmt-inline-details">
    <summary>${esc(t('planner.reference.addExternal'))}</summary>
    <form class="dmt-planner-form"${dataOn('submit', host.action('plannerSaveExternalReference'), '$ev', item.id)}>
      <div class="dmt-planner-form-row">
        <label>${esc(t('planner.reference.addonId'))}<input class="edit-input" name="addonId" required maxlength="39"></label>
        <label>${esc(t('planner.reference.kind'))}<input class="edit-input" name="kind" required maxlength="80"></label>
      </div>
      <div class="dmt-planner-form-row">
        <label>${esc(t('planner.reference.recordId'))}<input class="edit-input" name="recordId" required maxlength="120"></label>
        <label>${esc(t('planner.reference.label'))}<input class="edit-input" name="label" required maxlength="200"></label>
      </div>
      <label>${esc(t('planner.reference.name'))}<input class="edit-input" name="name" required maxlength="200"></label>
      <div class="dmt-planner-form-row">
        <label>${esc(t('planner.reference.relation'))}<select class="edit-input" name="relation">${relationOptions}</select></label>
        <label>${esc(t('planner.reference.quantity'))}<input class="edit-input" type="number" name="quantity" min="1" max="1000" value="1"></label>
      </div>
      <label>${esc(t('planner.reference.notes'))}<textarea class="edit-input" name="notes" maxlength="2000" rows="3"></textarea></label>
      <button class="inline-create-btn" type="submit">${esc(t('planner.action.add'))}</button>
    </form>
  </details>`;
}

function flowSection(item, data, host) {
  const { esc, dataAction, dataOn } = host.h;
  const t = key => host.i18n.t(key);
  const related = data.flowLinks.filter(flow => (
    flow.sourceId === item.id || flow.targetId === item.id
  ));
  const targets = data.items
    .filter(value => value.id !== item.id && value.parentId === item.parentId)
    .sort((left, right) => left.title.localeCompare(right.title));
  return `<section class="dmt-inspector-section">
    <h3>${esc(t('planner.flow.title'))}</h3>
    <div class="dmt-flow-list">
      ${related.length ? related.map(flow => {
        const source = data.items.find(value => value.id === flow.sourceId);
        const target = data.items.find(value => value.id === flow.targetId);
        return `<div class="dmt-flow-row">
          <div><strong>${esc(flow.label || t(`planner.flow.${flow.kind}`))}</strong><br>
            <small>${esc(source?.title || flow.sourceId)} → ${esc(target?.title || flow.targetId)}</small>
            <details class="dmt-inline-details">
              <summary>${esc(t('planner.action.edit'))}</summary>
              <form class="dmt-planner-form"${dataOn('submit', host.action('plannerUpdateFlow'), '$ev', flow.id)}>
                <label>${esc(t('planner.flow.kind'))}<select class="edit-input" name="kind">
                  ${FLOW_KINDS.map(value => option(value, flow.kind, esc(t(`planner.flow.${value}`)))).join('')}
                </select></label>
                <label>${esc(t('planner.flow.label'))}<input class="edit-input" name="label" maxlength="200" value="${esc(flow.label || '')}"></label>
                <button class="inline-create-btn" type="submit">${esc(t('planner.action.save'))}</button>
              </form>
            </details>
          </div>
          <button class="edit-delete-btn" type="button" aria-label="${esc(t('planner.flow.delete'))}"${dataAction(host.action('plannerDeleteFlow'), flow.id)}>×</button>
        </div>`;
      }).join('') : `<p class="settings-hint">${esc(t('planner.flow.empty'))}</p>`}
    </div>
    ${targets.length ? `<details class="dmt-inline-details">
      <summary>${esc(t('planner.flow.add'))}</summary>
      <form class="dmt-planner-form"${dataOn('submit', host.action('plannerSaveFlow'), '$ev', item.id)}>
        <label>${esc(t('planner.flow.target'))}
          <select class="edit-input" name="targetId" required>
            ${targets.map(value => option(value.id, '', esc(value.title))).join('')}
          </select>
        </label>
        <div class="dmt-planner-form-row">
          <label>${esc(t('planner.flow.kind'))}
            <select class="edit-input" name="kind">
              ${FLOW_KINDS.map(value => option(value, item.kind === 'branch' ? 'option' : 'continues', esc(t(`planner.flow.${value}`)))).join('')}
            </select>
          </label>
          <label>${esc(t('planner.flow.label'))}<input class="edit-input" name="label" maxlength="200"></label>
        </div>
        <button class="inline-create-btn" type="submit">${esc(t('planner.action.add'))}</button>
      </form>
    </details>` : ''}
  </section>`;
}

function referencesSection(item, data, host) {
  const { esc, dataAction } = host.h;
  const t = key => host.i18n.t(key);
  const references = data.references.filter(reference => reference.itemId === item.id);
  return `<section class="dmt-inspector-section">
    <h3>${esc(t('planner.reference.title'))}</h3>
    <div class="dmt-inspector-list">
      ${references.length ? references.map(reference => `<article class="dmt-inspector-card">
        <header>
          <strong>${esc(reference.name)}</strong>
          <button class="edit-delete-btn" type="button" aria-label="${esc(t('planner.reference.delete'))}"${dataAction(host.action('plannerDeleteReference'), reference.id)}>×</button>
        </header>
        <p>${esc(t(`planner.relation.${reference.relation}`))}: ${esc(targetLabel(reference.target, data, host))}${reference.quantity > 1 ? ` ×${esc(String(reference.quantity))}` : ''}</p>
        ${reference.notes ? `<p>${esc(reference.notes)}</p>` : ''}
        <details class="dmt-inline-details">
          <summary>${esc(t('planner.action.edit'))}</summary>
          <form class="dmt-planner-form"${host.h.dataOn('submit', host.action('plannerUpdateReference'), '$ev', reference.id)}>
            <label>${esc(t('planner.reference.name'))}<input class="edit-input" name="name" required maxlength="200" value="${esc(reference.name)}"></label>
            <div class="dmt-planner-form-row">
              <label>${esc(t('planner.reference.relation'))}<select class="edit-input" name="relation">
                ${REFERENCE_RELATIONS.map(value => option(value, reference.relation, esc(t(`planner.relation.${value}`)))).join('')}
              </select></label>
              <label>${esc(t('planner.reference.quantity'))}<input class="edit-input" type="number" name="quantity" min="1" max="1000" value="${reference.quantity}"></label>
            </div>
            <label>${esc(t('planner.reference.notes'))}<textarea class="edit-input" name="notes" maxlength="2000" rows="3">${esc(reference.notes || '')}</textarea></label>
            <button class="inline-create-btn" type="submit">${esc(t('planner.action.save'))}</button>
          </form>
        </details>
      </article>`).join('') : `<p class="settings-hint">${esc(t('planner.reference.empty'))}</p>`}
    </div>
    ${referenceForms(item, data, host)}
  </section>`;
}

function consequenceTargetFields(value, data, host) {
  const { esc } = host.h;
  const t = key => host.i18n.t(key);
  const selected = value?.target?.scope === 'planning'
    ? `planning:${value.target.itemId}`
    : value?.target?.scope === 'core'
      ? `core:${value.target.collection}:${value.target.id}`
      : '';
  const planningOptions = data.items.map(item => ({
    value: `planning:${item.id}`,
    label: `${t('planner.reference.planningItem')} — ${itemPathLabel(item, data.items)}`,
  }));
  const coreOptions = CORE_REFERENCE_COLLECTIONS.flatMap(collection => (
    data.core[collection].map(entity => ({
      value: `core:${collection}:${entity.id}`,
      label: `${t(`planner.core.${collection}`)} — ${entity.name || entity.title || entity.id}`,
    }))
  ));
  const options = [...planningOptions, ...coreOptions]
    .sort((left, right) => left.label.localeCompare(right.label));
  const external = value?.target?.scope === 'external' ? value.target : {};
  return `<details class="dmt-inline-details">
    <summary>${esc(t('planner.consequence.target'))}</summary>
    <label>${esc(t('planner.consequence.target'))}
      <select class="edit-input" name="target">
        ${option('', selected, esc(t('planner.consequence.targetNone')))}
        ${options.map(entry => option(entry.value, selected, esc(entry.label))).join('')}
      </select>
    </label>
    <p class="settings-hint">${esc(t('planner.consequence.targetExternalHelp'))}</p>
    <div class="dmt-planner-form-row">
      <label>${esc(t('planner.reference.addonId'))}<input class="edit-input" name="targetAddonId" maxlength="39" value="${esc(external.addonId || '')}"></label>
      <label>${esc(t('planner.reference.kind'))}<input class="edit-input" name="targetKind" maxlength="80" value="${esc(external.kind || '')}"></label>
    </div>
    <div class="dmt-planner-form-row">
      <label>${esc(t('planner.reference.recordId'))}<input class="edit-input" name="targetRecordId" maxlength="120" value="${esc(external.id || '')}"></label>
      <label>${esc(t('planner.reference.label'))}<input class="edit-input" name="targetLabel" maxlength="200" value="${esc(external.label || '')}"></label>
    </div>
  </details>`;
}

function consequenceSection(item, data, host) {
  const { esc, dataAction, dataOn } = host.h;
  const t = key => host.i18n.t(key);
  const relatedFlows = data.flowLinks.filter(flow => (
    flow.sourceId === item.id || flow.targetId === item.id
  ));
  const consequences = data.consequences.filter(value => (
    (value.anchor?.scope === 'item' && value.anchor.itemId === item.id)
    || (value.anchor?.scope === 'flow' && relatedFlows.some(flow => flow.id === value.anchor.flowId))
  ));
  return `<section class="dmt-inspector-section">
    <h3>${esc(t('planner.consequence.title'))}</h3>
    <div class="dmt-inspector-list">
      ${consequences.length ? consequences.map(value => `<article class="dmt-inspector-card">
        <header>
          <span><span class="codex-badge">${esc(t(`planner.consequence.${value.kind}`))}</span> <strong>${esc(value.title)}</strong></span>
          <button class="edit-delete-btn" type="button" aria-label="${esc(t('planner.consequence.delete'))}"${dataAction(host.action('plannerDeleteConsequence'), value.id)}>×</button>
        </header>
        ${value.body ? `<p>${esc(value.body)}</p>` : ''}
        ${value.target ? `<p><strong>${esc(t('planner.consequence.target'))}:</strong> ${esc(targetLabel(value.target, data, host))}</p>` : ''}
        <details class="dmt-inline-details">
          <summary>${esc(t('planner.action.edit'))}</summary>
          <form class="dmt-planner-form"${dataOn('submit', host.action('plannerUpdateConsequence'), '$ev', value.id)}>
            <label>${esc(t('planner.consequence.kind'))}<select class="edit-input" name="kind">
              ${CONSEQUENCE_KINDS.map(kind => option(kind, value.kind, esc(t(`planner.consequence.${kind}`)))).join('')}
            </select></label>
            <label>${esc(t('planner.consequence.name'))}<input class="edit-input" name="title" required maxlength="200" value="${esc(value.title)}"></label>
            <label>${esc(t('planner.consequence.body'))}<textarea class="edit-input" name="body" maxlength="10000" rows="3">${esc(value.body || '')}</textarea></label>
            ${consequenceTargetFields(value, data, host)}
            <button class="inline-create-btn" type="submit">${esc(t('planner.action.save'))}</button>
          </form>
        </details>
      </article>`).join('') : `<p class="settings-hint">${esc(t('planner.consequence.empty'))}</p>`}
    </div>
    <details class="dmt-inline-details">
      <summary>${esc(t('planner.consequence.add'))}</summary>
      <form class="dmt-planner-form"${dataOn('submit', host.action('plannerSaveConsequence'), '$ev', item.id)}>
        <div class="dmt-planner-form-row">
          <label>${esc(t('planner.consequence.anchor'))}
            <select class="edit-input" name="anchor">
              ${option(`item:${item.id}`, '', esc(t('planner.consequence.wholeItem')))}
              ${relatedFlows.map(flow => option(`flow:${flow.id}`, '', esc(flow.label || t(`planner.flow.${flow.kind}`)))).join('')}
            </select>
          </label>
          <label>${esc(t('planner.consequence.kind'))}
            <select class="edit-input" name="kind">
              ${CONSEQUENCE_KINDS.map(value => option(value, 'world', esc(t(`planner.consequence.${value}`)))).join('')}
            </select>
          </label>
        </div>
        <label>${esc(t('planner.consequence.name'))}<input class="edit-input" name="title" required maxlength="200"></label>
        <label>${esc(t('planner.consequence.body'))}<textarea class="edit-input" name="body" maxlength="10000" rows="3"></textarea></label>
        ${consequenceTargetFields(null, data, host)}
        <button class="inline-create-btn" type="submit">${esc(t('planner.action.add'))}</button>
      </form>
    </details>
  </section>`;
}

function notesSection(item, data, host) {
  const { esc, dataAction, dataOn } = host.h;
  const t = key => host.i18n.t(key);
  const notes = data.notes.filter(note => note.anchorIds.includes(item.id));
  const anchors = data.items
    .slice()
    .sort((left, right) => left.title.localeCompare(right.title));
  return `<section class="dmt-inspector-section dmt-marginalia">
    <h3>✎ ${esc(t('planner.notes.title'))}</h3>
    <div class="dmt-inspector-list">
      ${notes.length ? notes.map(note => `<article class="dmt-inspector-card">
        <header>
          <strong>${esc(note.title)}</strong>
          <button class="edit-delete-btn" type="button" aria-label="${esc(t('planner.notes.delete'))}"${dataAction(host.action('plannerDeleteNote'), note.id)}>×</button>
        </header>
        ${note.body ? `<div>${host.h.renderMarkdown(note.body)}</div>` : ''}
        <details class="dmt-inline-details">
          <summary>${esc(t('planner.action.edit'))}</summary>
          <form class="dmt-planner-form"${dataOn('submit', host.action('plannerUpdateNote'), '$ev', note.id)}>
            <label>${esc(t('planner.notes.name'))}<input class="edit-input" name="title" required maxlength="200" value="${esc(note.title)}"></label>
            <label>${esc(t('planner.notes.body'))}<textarea class="edit-input" name="body" maxlength="30000" rows="5">${esc(note.body || '')}</textarea></label>
            <label>${esc(t('planner.notes.links'))}
              <select class="edit-input" name="anchorIds" multiple size="5">
                ${data.items.slice().sort((left, right) => left.title.localeCompare(right.title)).map(value => option(
                  value.id,
                  note.anchorIds.includes(value.id) ? value.id : '',
                  esc(value.title),
                )).join('')}
              </select>
            </label>
            <button class="inline-create-btn" type="submit">${esc(t('planner.action.save'))}</button>
          </form>
        </details>
      </article>`).join('') : `<p class="settings-hint">${esc(t('planner.notes.empty'))}</p>`}
    </div>
    <details class="dmt-inline-details">
      <summary>${esc(t('planner.notes.add'))}</summary>
      <form class="dmt-planner-form"${dataOn('submit', host.action('plannerSaveNote'), '$ev', item.id)}>
        <label>${esc(t('planner.notes.name'))}<input class="edit-input" name="title" required maxlength="200"></label>
        <label>${esc(t('planner.notes.body'))}<textarea class="edit-input" name="body" maxlength="30000" rows="5"></textarea></label>
        <label>${esc(t('planner.notes.links'))}
          <select class="edit-input" name="anchorIds" multiple size="5">
            ${anchors.map(value => option(value.id, value.id === item.id ? item.id : '', esc(value.title))).join('')}
          </select>
        </label>
        <button class="inline-create-btn" type="submit">${esc(t('planner.action.add'))}</button>
      </form>
    </details>
  </section>`;
}

export function renderPlannerDialog({
  host,
  data,
  draft,
  errors,
  dialogTab = 'details',
}) {
  const { esc, dataAction } = host.h;
  const t = (key, params) => host.i18n.t(key, params);
  if (!draft) return '';
  const item = draft.item;
  const tabs = [
    ['details', 'planner.dialog.details'],
    ['links', 'planner.dialog.links'],
    ['notes', 'planner.dialog.notes'],
  ];
  const savedOnly = !draft.isNew;
  const formId = 'dmt-planner-item-form';
  return `<div class="dmt-planner-modal" data-dmt-modal role="presentation">
    <button class="dmt-planner-modal-backdrop" type="button" data-dmt-modal-close tabindex="-1" aria-label="${esc(t('planner.action.cancel'))}"></button>
    <section class="dmt-planner-dialog" role="dialog" aria-modal="true" aria-labelledby="dmt-planner-dialog-title">
      <header class="dmt-planner-dialog-header">
        <div class="dmt-planner-dialog-heading">
          <p class="dmt-inspector-eyebrow">${esc(t(draft.isNew ? 'planner.item.new' : 'planner.item.edit'))}</p>
          <h2 id="dmt-planner-dialog-title">${esc(item.title || t('planner.item.untitled'))}</h2>
        </div>
        <div class="dmt-planner-dialog-actions">
          <button class="inline-create-btn" type="button"${dataAction(host.action('plannerCancelEdit'))}>${esc(t('planner.action.cancel'))}</button>
          <button class="edit-save-btn" type="submit" form="${formId}">${esc(t('planner.action.save'))}</button>
        </div>
      </header>
      <div class="dmt-dialog-tabs" role="tablist" aria-label="${esc(t('planner.dialog.tabs'))}">
        ${tabs.map(([id, key]) => `<button type="button" role="tab" data-dmt-dialog-tab="${id}"
          aria-selected="${dialogTab === id}"${!savedOnly && id !== 'details' ? ' disabled' : ''}>${esc(t(key))}</button>`).join('')}
      </div>
      <div class="dmt-planner-dialog-body">
        ${validationHtml(errors, esc, t)}
        <section role="tabpanel" data-dmt-dialog-panel="details"${dialogTab === 'details' ? '' : ' hidden'}>
          ${itemForm({ host, item, data, formId, isNew: draft.isNew })}
        </section>
        <section role="tabpanel" data-dmt-dialog-panel="links"${dialogTab === 'links' ? '' : ' hidden'}>
          ${savedOnly ? `${flowSection(item, data, host)}${referencesSection(item, data, host)}${consequenceSection(item, data, host)}` : `<p class="settings-hint">${esc(t('planner.dialog.saveFirst'))}</p>`}
        </section>
        <section role="tabpanel" data-dmt-dialog-panel="notes"${dialogTab === 'notes' ? '' : ' hidden'}>
          ${savedOnly ? notesSection(item, data, host) : `<p class="settings-hint">${esc(t('planner.dialog.saveFirst'))}</p>`}
        </section>
      </div>
    </section>
  </div>`;
}

function breadcrumbs(host, data, scopeId, detailItem = null) {
  const t = key => host.i18n.t(key);
  const values = [
    { label: t('breadcrumb.tools'), href: '#/dm' },
    { label: t('planner.page.title'), href: '#/dm-plans' },
  ];
  const ancestors = itemAncestors(detailItem?.parentId || scopeId, data.items);
  ancestors.forEach((item, index) => {
    const last = index === ancestors.length - 1;
    values.push({
      label: item.title,
      ...(!last || detailItem ? { href: `#/dm-plans/${encodeURIComponent(item.id)}` } : {}),
    });
  });
  if (detailItem) values.push({ label: itemTypeLabel(detailItem, t) });
  if (!scopeId && !detailItem) values[values.length - 1] = { label: t('planner.page.title') };
  return host.h.breadcrumb(values);
}

function nodeHtml(node, selectedItemIds, host) {
  const { esc } = host.h;
  const t = key => host.i18n.t(key);
  const item = node.item;
  const needsDetails = ![
    item.summary,
    item.objective,
    item.body,
    item.setup,
    item.resolution,
  ].some(value => String(value || '').trim())
    && !(item.tags || []).length
    && !node.childCount
    && !node.referenceCount
    && !node.consequenceCount
    && !node.noteCount;
  return `<article class="dmt-story-node${selectedItemIds.has(item.id) ? ' is-selected' : ''}"
      data-dmt-node="${esc(item.id)}" data-kind="${esc(item.kind)}"
      data-needs-details="${needsDetails}"
      ${item.eventType ? `data-event-type="${esc(item.eventType)}"` : ''}
      tabindex="0" role="button" aria-label="${esc(t('planner.node.label', {
        kind: itemTypeLabel(item, t),
        title: item.title,
      }))}"
      style="left:${node.position.x}px;top:${node.position.y}px">
    <div class="dmt-node-header">
      <span class="dmt-node-kind">${esc(itemTypeLabel(item, t))}</span>
      ${node.noteCount ? `<span class="dmt-node-marginalia" title="${esc(t('planner.notes.count', { n: node.noteCount }))}" aria-label="${esc(t('planner.notes.count', { n: node.noteCount }))}">✎</span>` : ''}
    </div>
    <h3>${esc(item.title)}</h3>
    <p>${esc(item.summary || item.objective || t('planner.item.noSummary'))}</p>
    <div class="dmt-node-meta">
      ${needsDetails ? `<span class="dmt-node-incomplete">${esc(t('planner.item.needsDetails'))}</span>` : ''}
      ${node.childCount ? `<span class="codex-badge">${esc(t('planner.node.children', { n: node.childCount }))}</span>` : ''}
      ${node.referenceCount ? `<span class="codex-badge">${esc(t('planner.node.references', { n: node.referenceCount }))}</span>` : ''}
      ${node.consequenceCount ? `<span class="codex-badge">${esc(t('planner.node.consequences', { n: node.consequenceCount }))}</span>` : ''}
    </div>
    <button class="dmt-node-port" type="button" aria-label="${esc(t('planner.flow.dragFrom', { title: item.title }))}">+</button>
  </article>`;
}

export function renderStoryCanvas(projection, selectedItemIds, selectedFlowIds, host) {
  const { esc } = host.h;
  const t = key => host.i18n.t(key);
  const byId = new Map(projection.nodes.map(node => [node.item.id, node]));
  return `<div class="dmt-story-viewport">
    <div class="dmt-story-canvas" tabindex="0" aria-label="${esc(t('planner.canvas.label'))}" style="width:${projection.width}px;height:${projection.height}px">
      <svg class="dmt-story-edges" width="${projection.width}" height="${projection.height}" role="group" aria-label="${esc(t('planner.flow.title'))}">
        <defs>
          <marker id="dmt-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
            <path d="M 0 0 L 10 5 L 0 10 z" fill="context-stroke"></path>
          </marker>
        </defs>
        ${projection.flowLinks.map(flow => {
          const source = byId.get(flow.sourceId);
          const target = byId.get(flow.targetId);
          const sourceBox = { ...source.position, width: 240, height: 116 };
          const targetBox = { ...target.position, width: 240, height: 116 };
          const labelX = (sourceBox.x + sourceBox.width + targetBox.x) / 2;
          const labelY = (sourceBox.y + targetBox.y) / 2
            + ((sourceBox.height + targetBox.height) / 4);
          const label = flow.label || t(`planner.flow.${flow.kind}`);
          return `<g class="dmt-story-edge-group${selectedFlowIds.has(flow.id) ? ' is-selected' : ''}" data-dmt-edge-group="${esc(flow.id)}">
              <path class="dmt-story-edge" data-dmt-edge="${esc(flow.id)}" data-source="${esc(flow.sourceId)}" data-target="${esc(flow.targetId)}" data-kind="${esc(flow.kind)}" d="${orthogonalPath(sourceBox, targetBox)}"></path>
              <path class="dmt-story-edge-hit" data-dmt-edge-hit="${esc(flow.id)}" data-source="${esc(flow.sourceId)}" data-target="${esc(flow.targetId)}" tabindex="0" role="button" aria-label="${esc(label)}" d="${orthogonalPath(sourceBox, targetBox)}"></path>
              ${flow.label ? `<text class="dmt-story-edge-label" data-dmt-edge-label="${esc(flow.id)}" x="${labelX}" y="${labelY}" text-anchor="middle">${esc(flow.label)}</text>` : ''}
            </g>`;
        }).join('')}
        <path class="dmt-story-preview" data-dmt-preview hidden></path>
      </svg>
      <div class="dmt-selection-hull" data-dmt-selection-hull hidden></div>
      <div class="dmt-selection-marquee" data-dmt-marquee hidden></div>
      ${projection.nodes.map(node => nodeHtml(node, selectedItemIds, host)).join('')}
    </div>
  </div>
  ${projection.nodes.length ? '' : `<div class="dmt-empty-canvas"><strong>${esc(t('planner.canvas.emptyTitle'))}</strong><p>${esc(t('planner.canvas.emptyBody'))}</p></div>`}`;
}

function atlasDock(host) {
  const { esc } = host.h;
  const t = key => host.i18n.t(key);
  const actions = [
    ['structure', 'plotline', '', 'planner.kind.plotline'],
    ['structure', 'quest', '', 'planner.kind.quest'],
    ['events', 'event', 'story', 'planner.eventType.story'],
    ['events', 'event', 'encounter', 'planner.eventType.encounter'],
    ['events', 'event', 'puzzle', 'planner.eventType.puzzle'],
    ['branches', 'branch', 'decision', 'planner.branchType.decision'],
    ['branches', 'branch', 'condition', 'planner.branchType.condition'],
    ['branches', 'branch', 'random', 'planner.branchType.random'],
  ];
  return `<aside class="dmt-atlas-dock" aria-label="${esc(t('planner.toolbar.label'))}">
    <div class="dmt-atlas-title"><span>✦</span><strong>${esc(t('planner.dock.title'))}</strong></div>
    ${['structure', 'events', 'branches'].map(group => `<section class="dmt-atlas-group">
      <h2>${esc(t(`planner.dock.${group}`))}</h2>
      <div class="dmt-atlas-tools">
        ${actions.filter(action => action[0] === group).map(([, kind, subtype, key]) => `<button class="dmt-atlas-tool" type="button" draggable="true"
          data-dmt-create-kind="${kind}" data-dmt-create-subtype="${subtype}" data-kind="${kind}"
          ${kind === 'event' ? `data-event-type="${subtype}"` : ''}${kind === 'branch' ? ` data-branch-type="${subtype}"` : ''}>
          <span aria-hidden="true">+</span>${esc(t(key))}
        </button>`).join('')}
      </div>
    </section>`).join('')}
    <p class="dmt-atlas-hint">${esc(t('planner.dock.hint'))}</p>
  </aside>`;
}

export function renderSelectionToolbar(host, data, selectedItemIds, selectedFlowIds) {
  const { esc } = host.h;
  const t = (key, params) => host.i18n.t(key, params);
  const count = selectedItemIds.size + selectedFlowIds.size;
  if (!count) return '';
  const selectedItem = selectedItemIds.size === 1 && !selectedFlowIds.size
    ? data.items.find(item => selectedItemIds.has(item.id))
    : null;
  const canOpen = selectedItem && (
    selectedItem.kind === 'plotline' || selectedItem.kind === 'quest'
    || (selectedItem.kind === 'event' && ['encounter', 'puzzle'].includes(selectedItem.eventType))
  );
  return `<div class="dmt-selection-toolbar" role="toolbar" aria-label="${esc(t('planner.selection.actions'))}">
    <span>${esc(t('planner.selection.count', { n: count }))}</span>
    ${selectedItem ? `<button type="button" data-dmt-command="edit">${esc(t('planner.action.edit'))}</button>` : ''}
    ${canOpen ? `<button type="button" data-dmt-command="open">${esc(t(selectedItem.kind === 'plotline' || selectedItem.kind === 'quest' ? 'planner.action.enter' : 'planner.action.open'))}</button>` : ''}
    ${selectedItem ? `<button type="button" data-dmt-command="connect">${esc(t('planner.action.connect'))}</button>` : ''}
    <button class="is-danger" type="button" data-dmt-command="delete">${esc(t('planner.action.delete'))}</button>
  </div>`;
}

export function renderCanvasPage({
  host,
  data,
  projection,
  scopeId,
  selectedItemIds,
  selectedFlowIds,
  draft,
  errors,
  connectionSource,
  dialogTab,
  canUndo,
}) {
  const { esc, dataAction } = host.h;
  const t = (key, params) => host.i18n.t(key, params);
  const title = projection.scope?.title || t('planner.campaign');
  return `<main class="addon-dm-tools dmt-planner-shell">
    ${STORY_PLANNER_STYLES}
    ${breadcrumbs(host, data, scopeId)}
    <div class="dmt-planner-heading">
      <div><h1>${esc(title)}</h1><p class="settings-hint">${esc(t('planner.page.description'))}</p></div>
    </div>
    ${draft ? '' : validationHtml(errors, esc, t)}
    <section class="dmt-planner-workbench">
      ${atlasDock(host)}
      <div class="dmt-planner-stage">
        <div class="dmt-planner-stagebar">
          <span>${esc(connectionSource ? t('planner.canvas.connecting') : t('planner.canvas.hint'))}</span>
          <span>
            ${esc(t('planner.canvas.counts', {
              nodes: projection.nodes.length,
              links: projection.flowLinks.length,
            }))}
            ${canUndo ? `<button class="inline-create-btn" type="button" data-dmt-command="undo">${esc(t('planner.action.undo'))}</button>` : ''}
            <button class="inline-create-btn" type="button"${dataAction(host.action('plannerResetLayout'))}>${esc(t('planner.action.resetLayout'))}</button>
            <button class="inline-create-btn" type="button" data-dmt-command="shortcuts" aria-label="${esc(t('planner.action.shortcuts'))}">?</button>
          </span>
        </div>
        <div class="dmt-stage-canvas-wrap">
          ${renderStoryCanvas(projection, selectedItemIds, selectedFlowIds, host)}
          <div data-dmt-selection-actions>${renderSelectionToolbar(host, data, selectedItemIds, selectedFlowIds)}</div>
        </div>
      </div>
    </section>
    ${renderPlannerDialog({ host, data, draft, errors, dialogTab })}
    <div class="dmt-shortcuts-modal" data-dmt-shortcuts-modal hidden inert aria-hidden="true">
      <button class="dmt-planner-modal-backdrop" type="button" data-dmt-shortcuts-close tabindex="-1" aria-label="${esc(t('planner.action.cancel'))}"></button>
      <section class="dmt-shortcuts-dialog" role="dialog" aria-modal="true" aria-labelledby="dmt-shortcuts-title">
        <header><h2 id="dmt-shortcuts-title">${esc(t('planner.shortcuts.title'))}</h2><button type="button" data-dmt-shortcuts-close aria-label="${esc(t('planner.action.cancel'))}">×</button></header>
        <dl>
          <div><dt><kbd>Enter</kbd></dt><dd>${esc(t('planner.shortcuts.edit'))}</dd></div>
          <div><dt><kbd>Shift</kbd> + <kbd>Enter</kbd></dt><dd>${esc(t('planner.shortcuts.open'))}</dd></div>
          <div><dt><kbd>Shift</kbd> + ${esc(t('planner.shortcuts.click'))}</dt><dd>${esc(t('planner.shortcuts.multi'))}</dd></div>
          <div><dt><kbd>C</kbd></dt><dd>${esc(t('planner.shortcuts.connect'))}</dd></div>
          <div><dt><kbd>Delete</kbd></dt><dd>${esc(t('planner.shortcuts.delete'))}</dd></div>
          <div><dt><kbd>Ctrl</kbd>/<kbd>⌘</kbd> + <kbd>A</kbd></dt><dd>${esc(t('planner.shortcuts.all'))}</dd></div>
          <div><dt><kbd>↑</kbd><kbd>↓</kbd><kbd>←</kbd><kbd>→</kbd></dt><dd>${esc(t('planner.shortcuts.nudge'))}</dd></div>
          <div><dt><kbd>Esc</kbd></dt><dd>${esc(t('planner.shortcuts.escape'))}</dd></div>
        </dl>
      </section>
    </div>
  </main>`;
}

export function renderDetailPage({
  host,
  data,
  item,
  draft,
  errors,
  dialogTab = 'details',
}) {
  const { esc, dataAction } = host.h;
  const t = key => host.i18n.t(key);
  const parentHref = item.parentId
    ? `#/dm-plans/${encodeURIComponent(item.parentId)}`
    : '#/dm-plans';
  return `<main class="addon-dm-tools dmt-planner-shell">
    ${STORY_PLANNER_STYLES}
    ${breadcrumbs(host, data, item.parentId, item)}
    <div class="dmt-planner-heading">
      <div>
        <p class="dmt-inspector-eyebrow">${esc(itemTypeLabel(item, t))}</p>
        <h1>${esc(item.title)}</h1>
        <p class="settings-hint">${esc(item.summary || t('planner.item.noSummary'))}</p>
      </div>
      <a class="back-btn" href="${parentHref}">← ${esc(t('planner.action.backToCanvas'))}</a>
    </div>
    ${draft ? '' : validationHtml(errors, esc, t)}
    <div class="dmt-detail-grid">
      <section class="settings-panel">
        <div class="dmt-inspector-actions">
          <button class="edit-save-btn" type="button"${dataAction(host.action('plannerEditItem'), item.id)}>${esc(t('planner.action.edit'))}</button>
        </div>
        ${item.objective ? `<h2>${esc(t('planner.item.objective'))}</h2><div>${host.h.renderMarkdown(item.objective)}</div>` : ''}
        ${item.body ? `<h2>${esc(t('planner.item.body'))}</h2><div>${host.h.renderMarkdown(item.body)}</div>` : ''}
        ${item.setup ? `<h2>${esc(t(item.eventType === 'encounter' ? 'planner.detail.environment' : 'planner.detail.clues'))}</h2><div>${host.h.renderMarkdown(item.setup)}</div>` : ''}
        ${item.resolution ? `<h2>${esc(t(item.eventType === 'encounter' ? 'planner.detail.outcome' : 'planner.detail.solution'))}</h2><div>${host.h.renderMarkdown(item.resolution)}</div>` : ''}
      </section>
      <aside class="dmt-detail-aside">
        <section class="settings-panel">${referencesSection(item, data, host)}</section>
        <section class="settings-panel">${consequenceSection(item, data, host)}</section>
        <section class="settings-panel">${notesSection(item, data, host)}</section>
      </aside>
    </div>
    ${renderPlannerDialog({ host, data, draft, errors, dialogTab })}
  </main>`;
}

export function buildRenderData(host, source) {
  return { ...source, core: coreData(host) };
}
