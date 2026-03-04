// src/renderer/renderer.js

// Set PROJECT_URL to a local file:// path in dev mode, or the remote repo in production.
// In dev mode, scripts and manifest are loaded from the local ./src folder (no commit needed).
let PROJECT_URL  = 'file://C:/Users/DEN/Documents/projects/js/node/nopify/docs/repos/extras/nsm/src';
//let PROJECT_URL  = 'https://raw.githubusercontent.com/quark1482/nopify-extras/main/nsm/src';
let MANIFEST_URL = PROJECT_URL + '/catalog/manifest.json';
let SCRIPTS_BASE = PROJECT_URL + '/scripts/';
let WRAPPER_URL  = SCRIPTS_BASE + 'Invoke-Remote-Action.ps1';

async function initProjectUrls() {
    const dev = await window.api.isDev();
    if (dev) {
        const srcPath = await window.api.getSrcPath();
        PROJECT_URL  = srcPath;
        MANIFEST_URL = srcPath + '/catalog/manifest.json';
        SCRIPTS_BASE = srcPath + '/scripts/';
        WRAPPER_URL  = srcPath + '/scripts/Invoke-Remote-Action.ps1';
    }
}

let cachedManifest = null;

async function loadManifest() {
    if (cachedManifest) {
        return cachedManifest;
    }
    try {
        const response = await fetch(MANIFEST_URL);
        if (!response.ok) {
            throw new Error('Failed to fetch manifest');
        }
        const data    = await response.json();
        const actions = data.actions || [];
        validateManifest(actions);
        cachedManifest = actions;
        return cachedManifest;
    }
    catch (err) {
        console.error('Manifest load error:', err);
        window.api.error('Could not load actions menu. Check internet or repo URL.');
        return [];
    }
}

function getActionsForContext(contextType) {
    return cachedManifest.filter(a => a.appliesTo === contextType);
}

function validateManifest(actions) {
    const typeofForParamType = {
        string  : 'string',
        integer : 'number',
        boolean : 'boolean'
    };
    for (const action of actions) {
        for (const p of (action.extraParams || [])) {
            const loc = `action "${action.id}", param "${p.id}"`;
            if (p.internal) {
                if (p.required !== true) {
                    throw new Error(`Manifest error: internal param must have required:true — ${loc}`);
                }
                if ('default' in p) {
                    throw new Error(`Manifest error: internal param must not have a default — ${loc}`);
                }
            }
            else {
                if (p.required !== true && !('default' in p)) {
                    throw new Error(`Manifest error: non-internal param must have required:true or a default — ${loc}`);
                }
                if ('default' in p) {
                    const expectedJsType = typeofForParamType[p.type];
                    if (!expectedJsType) {
                        throw new Error(`Manifest error: unknown param type "${p.type}" — ${loc}`);
                    }
                    if (typeof p.default !== expectedJsType) {
                        throw new Error(`Manifest error: default value type mismatch (expected ${p.type}) — ${loc}`);
                    }
                    if (p.type === 'integer' && !Number.isInteger(p.default)) {
                        throw new Error(`Manifest error: default value must be an integer — ${loc}`);
                    }
                }
            }
        }
    }
}

let tabCounter = 0;
let activeTabId = 'servers';

// Each result tab stores: { contextType, rows, action, schema }
const resultTabs = {};

function getTabBar() {
    return document.getElementById('tab-bar');
}

function getTabPanels() {
    return document.getElementById('tab-panels');
}

function createServersTab() {
    const bar = getTabBar();
    const tab = document.createElement('div');
    tab.className     = 'tab active';
    tab.id            = 'tab-servers';
    tab.dataset.tabId = 'servers';
    tab.textContent   = 'Servers';
    tab.addEventListener('click', () => switchTab('servers'));
    bar.appendChild(tab);
}

function createResultTab(tabId, title, contextType, rows, action) {
    resultTabs[tabId] = {
        contextType,
        rows,
        action,
        schema   : action.outputSchema,
        sortCol  : null,
        sortDir  : 1,
        sortKeys : null
    };
    // Tab header
    const bar = getTabBar();
    const tab = document.createElement('div');
    tab.className     = 'tab';
    tab.id            = `tab-${tabId}`;
    tab.dataset.tabId = tabId;
    const label = document.createElement('span');
    label.textContent = `${title} results`;
    tab.appendChild(label);
    const closeBtn = document.createElement('span');
    closeBtn.className   = 'tab-close';
    closeBtn.textContent = '×';
    closeBtn.title       = 'Close tab';
    closeBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        closeResultTab(tabId);
    });
    tab.appendChild(closeBtn);
    tab.addEventListener('click', () => switchTab(tabId));
    bar.appendChild(tab);
    // Panel
    const panels = getTabPanels();
    const panel  = document.createElement('div');
    panel.className = 'tab-panel';
    panel.id        = `panel-${tabId}`;
    // Grid container
    const gridWrap = document.createElement('div');
    gridWrap.className = 'result-grid-wrap';
    gridWrap.id        = `gridwrap-${tabId}`;
    panel.appendChild(gridWrap);
    panels.appendChild(panel);
    renderResultGrid(tabId, rows, action.outputSchema);
    switchTab(tabId);
}

function getInitialSort(schema) {
    // Sort by "sorted" fields first, then fall back to first visible column
    const visibleCols  = schema.filter(c => c.visible);
    const sortedFields = schema.filter(c => c.sorted);
    if (sortedFields.length > 0) {
        return sortedFields.map(c => ({
            id   : c.id,
            type : c.type || 'string'
        }));
    }
    if (visibleCols.length > 0) {
        return [{
            id   : visibleCols[0].id,
            type : visibleCols[0].type || 'string'
        }];
    }
    return [];
}

function sortResultRows(rows, sortKeys) {
    if (!sortKeys || sortKeys.length === 0) {
        return rows;
    }
    return [...rows].sort((a, b) => {
        for (const key of sortKeys) {
            const cmp = compareValues(a[key.id], b[key.id], key.type);
            if (cmp !== 0) {
                return cmp;
            }
        }
        return 0;
    });
}

function renderResultGrid(tabId, rows, schema) {
    const wrap = document.getElementById(`gridwrap-${tabId}`);
    if (!wrap) {
        return;
    }
    wrap.innerHTML = '';
    const visibleCols = schema.filter(c => c.visible);
    // Per-tab sort state
    const tabState = resultTabs[tabId];
    if (!tabState.sortCol) {
        const initialSort = getInitialSort(schema);
        tabState.sortCol  = initialSort.length > 0 ? initialSort[0].id : (visibleCols[0]?.id || '');
        tabState.sortDir  = 1;
        tabState.sortKeys = initialSort;
    }
    // Apply current sort
    const sortedRows = tabState.sortKeys && tabState.sortKeys.length > 0
        ? [...rows].sort((a, b) => {
            for (const key of tabState.sortKeys) {
                const cmp = compareValues(a[key.id], b[key.id], key.type) * tabState.sortDir;
                if (cmp !== 0) {
                    return cmp;
                }
            }
            return 0;
          })
        : rows;
    const table       = document.createElement('table');
    const thead       = document.createElement('thead');
    const headerRow   = document.createElement('tr');
    const cbTh        = document.createElement('th');
    const selectAllCb = document.createElement('input');
    table.className   = 'result-table';
    table.id          = `result-table-${tabId}`;
    cbTh.className    = 'checkbox-cell';
    selectAllCb.type  = 'checkbox';
    selectAllCb.id    = `selectAll-${tabId}`;
    cbTh.appendChild(selectAllCb);
    cbTh.addEventListener('click', (e) => {
        if (e.target === selectAllCb) {
            return;
        }
        selectAllCb.checked = !selectAllCb.checked;
        selectAllCb.dispatchEvent(new Event('change', { bubbles: true }));
    });
    headerRow.appendChild(cbTh);
    visibleCols.forEach(col => {
        const th = document.createElement('th');
        th.style.cursor = 'pointer';
        th.dataset.col  = col.id;
        th.dataset.type = col.type || 'string';
        if (col.type === 'integer') {
            th.style.textAlign = 'right';
        }
        const labelSpan = document.createElement('span');
        const indicator = document.createElement('span');
        indicator.className   = 'sort-indicator';
        labelSpan.textContent = col.title;
        th.appendChild(labelSpan);
        // Show initial sort indicator
        if (col.id === tabState.sortCol) {
            indicator.textContent = tabState.sortDir === 1 ? ' ▲' : ' ▼';
        }
        th.appendChild(indicator);
        th.addEventListener('click', () => {
            if (tabState.sortCol === col.id) {
                tabState.sortDir = -tabState.sortDir;
            }
            else {
                tabState.sortCol  = col.id;
                tabState.sortDir  = 1;
                tabState.sortKeys = [{ id: col.id, type: col.type || 'string' }];
            }
            renderResultGrid(tabId, tabState.rows, schema);
        });
        headerRow.appendChild(th);
    });
    thead.appendChild(headerRow);
    table.appendChild(thead);
    const tbody = document.createElement('tbody');
    sortedRows.forEach(row => {
        const tr   = document.createElement('tr');
        const cbTd = document.createElement('td');
        const cb   = document.createElement('input');
        cbTd.className    = 'checkbox-cell';
        cb.type           = 'checkbox';
        cb.dataset.server = row.server ?? '';
        schema.filter(c => c.key).forEach(c => {
            cb.dataset[c.id] = row[c.id] ?? '';
        });
        cbTd.appendChild(cb);
        cbTd.addEventListener('click', (e) => {
            if (e.target === cb) {
                return;
            }
            cb.checked = !cb.checked;
            cb.dispatchEvent(new Event('change', { bubbles: true }));
        });
        tr.appendChild(cbTd);
        visibleCols.forEach((col, colIdx) => {
            const td  = document.createElement('td');
            const val = row[col.id];
            td.textContent = (val === null || val === undefined) ? '' : String(val);
            if (col.type === 'integer') {
                td.style.textAlign = 'right';
            }
            if (colIdx === 0) {
                td.className          = 'result-first-col';
                td.style.position     = 'relative';
                td.style.paddingRight = '28px';
            }
            tr.appendChild(td);
        });
        tbody.appendChild(tr);
    });
    table.appendChild(tbody);
    wrap.appendChild(table);
    selectAllCb.addEventListener('change', () => {
        tbody.querySelectorAll('input[type="checkbox"]').forEach(cb => {
            cb.checked = selectAllCb.checked;
        });
        updateResultExecBtn(tabId);
    });
    tbody.addEventListener('change', (e) => {
        if (e.target.type === 'checkbox') {
            const all = [...tbody.querySelectorAll('input[type="checkbox"]')];
            selectAllCb.checked = all.length > 0 && all.every(c => c.checked);
            updateResultExecBtn(tabId);
        }
    });
    updateResultExecBtn(tabId);
}

function updateResultExecBtn(tabId) {
    const btn     = document.getElementById('result-executeBtn');
    if (!btn || activeTabId !== tabId) {
        return;
    }
    const panel   = document.getElementById(`panel-${tabId}`);
    if (!panel) {
        return;
    }
    const anySel  = [...panel.querySelectorAll('tbody input[type="checkbox"]')].some(c => c.checked);
    const tab     = resultTabs[tabId];
    if (!tab) {
        return;
    }
    const actions = cachedManifest ? getActionsForContext(tab.contextType) : [];
    btn.disabled  = !anySel || actions.length === 0;
}

function getSelectedResultRows(tabId) {
    const selected = [];
    const panel    = document.getElementById(`panel-${tabId}`);
    if (!panel) {
        return [];
    }
    panel.querySelectorAll('tbody tr').forEach(tr => {
        const cb = tr.querySelector('input[type="checkbox"]');
        if (cb && cb.checked) {
            selected.push({ keyData: { ...cb.dataset } });
        }
    });
    return selected;
}

// Look up the current live tr for a result row by its keyData.
// Needed because renderResultGrid rebuilds DOM on sort, invalidating old tr refs.
function findResultTr(tabId, keyData) {
    const panel = document.getElementById(`panel-${tabId}`);
    if (!panel) {
        return null;
    }
    for (const tr of panel.querySelectorAll('tbody tr')) {
        const cb = tr.querySelector('input[type="checkbox"]');
        if (!cb) {
            continue;
        }
        // Match on server + all key fields present in keyData
        const match = Object.keys(keyData).every(k => cb.dataset[k] === keyData[k]);
        if (match) {
            return tr;
        }
    }
    return null;
}

function switchTab(tabId) {
    activeTabId = tabId;
    // Tab headers
    document.querySelectorAll('.tab').forEach(t => {
        t.classList.toggle('active', t.dataset.tabId === tabId);
    });
    // Panels
    document.querySelectorAll('.tab-panel').forEach(p => {
        p.classList.toggle('active', p.id === `panel-${tabId}`);
    });
    // Show servers toolbar buttons or result toolbar buttons
    const serversButtons = document.getElementById('toolbar-buttons');
    const resultButtons  = document.getElementById('result-toolbar-buttons');
    if (tabId === 'servers') {
        serversButtons.style.display = '';
        resultButtons.style.display  = 'none';
    }
    else {
        serversButtons.style.display = 'none';
        resultButtons.style.display  = '';
        updateResultExecBtn(tabId);
    }
}

function closeResultTab(tabId) {
    delete resultTabs[tabId];
    const tab   = document.getElementById(`tab-${tabId}`);
    const panel = document.getElementById(`panel-${tabId}`);
    if (tab) {
        tab.remove();
    }
    if (panel) {
        panel.remove();
    }
    if (activeTabId === tabId) {
        switchTab('servers');
    }
}

async function showResultExecuteMenu(execBtn) {
    const tabId = activeTabId;
    const tab   = resultTabs[tabId];
    if (!tab) {
        return;
    }
    await loadManifest();
    const actions = getActionsForContext(tab.contextType);
    if (actions.length === 0) {
        window.api.error('No actions available for this context.');
        return;
    }
    const existingMenu = document.querySelector('.execute-menu');
    if (existingMenu) {
        existingMenu.remove();
    }
    const menu = buildExecuteMenu(actions, (action) => {
        const selectedRows = getSelectedResultRows(tabId);
        if (!selectedRows.length) {
            return;
        }
        const internalParamDefs = action.extraParams ? action.extraParams.filter(p => p.internal) : [];
        const userParams        = action.extraParams ? action.extraParams.filter(p => !p.internal) : [];
        disableAllButtonsAndGrid();
        const runIt = (userExtraParams) => {
            setStatus('Wait...');
            executeResultAction(action, tabId, selectedRows, userExtraParams).finally(() => {
                enableAllButtonsAndGrid();
                setStatus('Ready');
            });
        };
        if (userParams.length > 0) {
            showParamDialog(userParams[0], action, (value) => {
                if (value === null) {
                    enableAllButtonsAndGrid(); setStatus('Ready');
                    return;
                }
                runIt({ [userParams[0].variable]: value });
            });
        }
        else {
            setStatus('Wait...');
            runIt({});
        }
    });
    positionMenuBelow(execBtn, menu);
    document.body.appendChild(menu);
}

async function executeResultAction(action, sourceTabId, selectedRows, userExtraParams) {
    const wrapperText = await fetchText(WRAPPER_URL);
    if (!wrapperText) {
        return;
    }
    const scriptText  = await fetchText(SCRIPTS_BASE + action.file);
    if (!scriptText) {
        return;
    }
    const internalParamDefs = action.extraParams ? action.extraParams.filter(p => p.internal) : [];
    const allResults        = [];
    const allErrors         = [];
    const panel = document.getElementById(`panel-${sourceTabId}`);
    if (panel) {
        panel.querySelectorAll('.row-status-icon').forEach(icon => icon.remove());
    }
    await Promise.allSettled(selectedRows.map(async ({ keyData }) => {
        const getLiveTr  = () => findResultTr(sourceTabId, keyData);
        const serverNick = keyData.server || '';
        const serverRow  = gridData.find(r => r.nickname === serverNick);
        setRowStatusIcon(getLiveTr(), 'wait');
        if (!serverRow) {
            setRowStatusIcon(getLiveTr(), 'failure', `Server credentials not found for "${serverNick}"`);
            allErrors.push({ server: serverNick || '?', error: 'Server credentials not found' });
            return;
        }
        const rowExtraParams = { ...userExtraParams };
        internalParamDefs.forEach(p => {
            // Try exact match first, then case-insensitive fallback
            // (schema ids may differ in case between extraParams and outputSchema,
            // e.g. extraParam "runId" vs outputSchema key field "runID").
            let val = keyData[p.id];
            if (val === undefined) {
                const lowerKey = p.id.toLowerCase();
                const found    = Object.keys(keyData).find(k => k.toLowerCase() === lowerKey);
                if (found !== undefined) {
                    val = keyData[found];
                }
            }
            if (val !== undefined) {
                rowExtraParams[p.variable] = val;
            }
        });
        try {
            const parsed = await runRemoteAction(action, serverRow, rowExtraParams, wrapperText, scriptText);
            if (!parsed || parsed.success === false) {
                const errMsg = parsed?.error || 'Unknown error';
                setRowStatusIcon(getLiveTr(), 'failure', errMsg);
                allErrors.push({ server: serverNick, error: errMsg });
            }
            else {
                setRowStatusIcon(getLiveTr(), 'success');
                const rows = normalizeResults(parsed);
                allResults.push(...rows);
            }
        }
        catch (err) {
            setRowStatusIcon(getLiveTr(), 'failure', err.message);
            allErrors.push({ server: serverNick, error: err.message });
        }
    }));
    if (allResults.length > 0) {
        tabCounter++;
        const tabId = `result-${tabCounter}`;
        createResultTab(tabId, action.title, action.produces, allResults, action);
    }
    else if (allResults.length === 0 && allErrors.length === 0) {
        window.api.error('Action returned no results.');
    }
}

function setRowStatusIcon(tr, type, errorMessage) {
    const td = tr.querySelector('.result-first-col');
    if (!td) {
        return;
    }
    const existing = td.querySelector('.row-status-icon');
    if (existing) {
        existing.remove();
    }
    const icon = document.createElement('img');
    icon.src              = `../assets/${type}.svg`;
    icon.className        = `row-status-icon${type === 'wait' ? ' wait' : ''}`;
    icon.style.userSelect = 'none';
    if (type === 'failure' && errorMessage) {
        icon.style.cursor = 'pointer';
        icon.title        = errorMessage;
        icon.addEventListener('click', () => window.api.error(errorMessage));
    }
    td.appendChild(icon);
}

async function fetchText(url) {
    // In dev mode, file:// fetches are unreliable on Windows.
    // Route them through the main process fs.readFile instead.
    if (url.startsWith('file:///')) {
        try {
            const base = await window.api.getSrcPath();
            const rel  = url.slice(base.length).replace(/^\//, '');
            return await window.api.readLocalFile(rel);
        }
        catch (err) {
            console.error('readLocalFile error:', url, err);
            window.api.error(`Failed to load local file: ${url}`);
            return null;
        }
    }
    try {
        const r = await fetch(url);
        if (!r.ok) {
            throw new Error(`HTTP ${r.status}`);
        }
        return r.text();
    }
    catch (err) {
        console.error('fetchText error:', url, err);
        window.api.error(`Failed to load: ${url}`);
        return null;
    }
}

async function runRemoteAction(action, serverRow, extraParams, wrapperText, scriptText) {
    let fullScript = wrapperText;
    fullScript = fullScript.replace('<#REMOTE_SCRIPT_BODY#>', () => scriptText);
    // <#EXTRA_PARAMS_DECL#> expands inside the function's param() block: , [string]$ActorId
    // <#EXTRA_ARGUMENT_LIST#> expands to: -ArgumentList $ActorId
    // When no extra params, both replace with empty string (no-op).
    // Use manifest param order to ensure -ArgumentList matches the script's param() declaration.
    const allParamDefs   = action.extraParams || [];
    const orderedKeys    = allParamDefs.map(p => p.variable).filter(v => v in extraParams);
    let extraDecl        = '';
    let extraArgList     = '';
    if (orderedKeys.length > 0) {
        orderedKeys.forEach(key => {
            const pd      = allParamDefs.find(p => p.variable === key);
            const psType  = (pd && pd.type === 'boolean') ? 'bool' : 'string';
            extraDecl    += `, [${psType}]$${key}`;
        });
        extraArgList = '-ArgumentList ' + orderedKeys.map(k => `$${k}`).join(', ');
    }
    fullScript = fullScript.replace('<#EXTRA_PARAMS_DECL#>', () => extraDecl);
    fullScript = fullScript.replace('<#EXTRA_ARGUMENT_LIST#>', () => extraArgList);
    // Named-param flags for the Invoke-Remote-Action call at the bottom.
    // Values are assigned via here-strings so newlines and embedded quotes are safe.
    let paramAssignments = '';
    let namedParamFlags  = '';
    orderedKeys.forEach(key => {
        const val     = extraParams[key];
        const paramDef = allParamDefs.find(p => p.variable === key);
        if (paramDef && paramDef.type === 'boolean') {
            // Emit $true / $false directly — here-strings coerce to string,
            // and PS string-to-bool of "false" is $true (non-empty string).
            paramAssignments += `$__param_${key} = $` + (val ? 'true' : 'false') + '\n';
        }
        else {
            // PS here-string: @' must be followed by a real newline, '@ must be on its own line
            paramAssignments += `$__param_${key} = @'
` + String(val) + `
'@
`;
        }
        namedParamFlags += ` -${key} $__param_${key}`;
    });
    // Build pwshCode with plain string concatenation - NOT a template literal.
    // fullScript contains PS variables ($x), backticks, and regex patterns that
    // would be misinterpreted as JS template expressions if put inside backticks.
    const pwshCode =
        "\n" +
        "$ServerNick = '" + serverRow.nickname.replace(/'/g, "''") + "'\n" +
        "$ServerName = '" + serverRow.hostname.replace(/'/g, "''") + "'\n" +
        "$UserName   = '" + serverRow.username.replace(/'/g, "''") + "'\n" +
        "$Password   = '" + serverRow.password.replace(/'/g, "''") + "'\n" +
        paramAssignments +
        fullScript + "\n" +
        "$__result = Invoke-Remote-Action -ServerNick $ServerNick -ServerName $ServerName -UserName $UserName -Password $Password" + namedParamFlags + "\n" +
        "if ($__result.results -ne $null) {\n" +
        "    $__result.results = @($__result.results)\n" +
        "}\n" +
        "$__result | ConvertTo-Json -Depth 10\n";
    console.log('=== GENERATED PWSH ===\n' + pwshCode + '\n=== END PWSH ===');
    const result = await window.api.spawnPwsh(pwshCode);
    return parseActionOutput(result.output);
}

// Handle PS collapsing single-item arrays into objects
function normalizeResults(parsed) {
    if (!parsed) {
        return [];
    }
    if (parsed.results !== undefined) {
        if (Array.isArray(parsed.results)) {
            return parsed.results;
        }
        if (parsed.results !== null) {
            return [parsed.results];
        }
        return [];
    }
    // No results wrapper - single row result (e.g. reboot, test-server summary)
    return [parsed];
}

function parseActionOutput(raw) {
    if (!raw || !raw.trim()) {
        return null;
    }
    const text = raw.trim();
    try {
        return JSON.parse(text);
    }
    catch {
        // Extract JSON block from mixed output
        const match = text.match(/(\{[\s\S]*\}|\[[\s\S]*\])/);
        if (match) {
            try {
                return JSON.parse(match[1]);
            }
            catch {}
        }
        return null;
    }
}

// Servers grid

const tbody       = document.querySelector('#grid tbody');
const selectAll   = document.getElementById('selectAll');
const newBtn      = document.getElementById('newBtn');
const saveBtn     = document.getElementById('saveBtn');
const cancelBtn   = document.getElementById('cancelBtn');
const deleteBtn   = document.getElementById('deleteBtn');
const executeBtn  = document.getElementById('executeBtn');
const themeToggle = document.getElementById('themeToggle');
const themeIcon   = document.getElementById('themeIcon');

let isDark   = window.matchMedia('(prefers-color-scheme: dark)').matches;
let dbData   = [];
let gridData = [];
let dirty    = false;
let sortCol  = 'hostname';
let sortDir  = 1;

function setStatus(msg) {
    const bar = document.getElementById('status-bar');
    if (bar) {
        bar.textContent = msg;
    }
}

function applyTheme(dark) {
    document.documentElement.classList.toggle('dark', dark);
    document.body.classList.toggle('dark', dark);
    themeIcon.src = dark ? '../assets/sun.svg' : '../assets/moon.svg';
    window.api.updateCurrentTheme(dark ? 'dark' : 'light');
}

window.api.onSetInitialTheme((theme) => {
    if (theme === 'light') {
        isDark = false;
    }
    else if (theme === 'dark') {
        isDark = true;
    }
    applyTheme(isDark);
});

window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', e => {
    if (!window.api.getCurrentTheme) {
        isDark = e.matches;
        applyTheme(isDark);
    }
});

themeToggle.onclick = () => {
    isDark = !isDark;
    applyTheme(isDark);
};

const headerCheckboxCell = document.querySelector('th.checkbox-cell');
if (headerCheckboxCell) {
    headerCheckboxCell.addEventListener('click', (e) => {
        if (shouldDisableCheckboxes()) {
            return;
        }
        if (e.target === selectAll) {
            return;
        }
        selectAll.checked = !selectAll.checked;
        selectAll.dispatchEvent(new Event('change', { bubbles: true }));
    });
}

function setDirty(state) {
    dirty = state;
    saveBtn.disabled   = !dirty;
    cancelBtn.disabled = !dirty;
    toggleCheckboxes();
    toggleSorting(!dirty);
    location.hash = dirty ? '#dirty' : '';
    updateActionButtons();
}

function toggleCheckboxes() {
    const disable = shouldDisableCheckboxes();
    document.querySelectorAll('#grid .checkbox-cell').forEach(td => {
        td.classList.toggle('disabled', disable);
    });
    document.querySelectorAll('#grid input[type="checkbox"]').forEach(cb => {
        cb.disabled = disable;
    });
    selectAll.disabled = disable;
}

function shouldDisableCheckboxes() {
    return dirty || gridData.length === 0;
}

function toggleSorting(enabled) {
    document.querySelectorAll('#grid th[data-col]').forEach(th => {
        th.style.pointerEvents = enabled ? 'auto' : 'none';
    });
}

function load() {
    window.api.loadServers().then(rows => {
        dbData = rows.map(r => ({
            nickname         : r.nickname,
            hostname         : r.hostname,
            username         : r.username,
            password         : r.password,
            originalNickname : r.nickname,
            originalHostname : r.hostname,
            originalUsername : r.username,
            originalPassword : r.password
        }));
        gridData = structuredClone(dbData);
        sortAndRender();
        setDirty(false);
    });
}

function compareValues(a, b, type) {
    if (type === 'integer') {
        return (Number(a) - Number(b));
    }
    const sa = (a === null || a === undefined) ? '' : String(a);
    const sb = (b === null || b === undefined) ? '' : String(b);
    return sa.localeCompare(sb);
}

function sortAndRender() {
    gridData.sort((a, b) => compareValues(a[sortCol], b[sortCol], 'string') * sortDir);
    render();
    updateSortIndicators();
}

function updateSortIndicators() {
    document.querySelectorAll('#grid .sort-indicator').forEach(s => s.textContent = '');
    const th = document.querySelector(`#grid th[data-col="${sortCol}"]`);
    if (th) {
        th.querySelector('.sort-indicator').textContent = sortDir === 1 ? '▲' : '▼';
    }
}

function hasEmptyRow() {
    return gridData.some(row =>
        !row.nickname.trim() && !row.hostname.trim() &&
        !row.username.trim() && !row.password.trim()
    );
}

function render() {
    tbody.innerHTML = '';
    gridData.forEach((row, idx) => {
        const tr   = document.createElement('tr');
        const cbTd = document.createElement('td');
        const cb   = document.createElement('input');
        cbTd.className      = 'checkbox-cell';
        cb.type             = 'checkbox';
        cb.dataset.hostname = row.hostname;
        cbTd.appendChild(cb);
        cbTd.addEventListener('click', (e) => {
            if (dirty) {
                return;
            }
            if (e.target === cb) {
                return;
            }
            cb.checked = !cb.checked;
            cb.dispatchEvent(new Event('change', { bubbles: true }));
        });
        tr.appendChild(cbTd);
        ['nickname', 'hostname', 'username'].forEach(field => {
            const td = document.createElement('td');
            td.className = field === 'nickname' ? 'nickname-cell' : '';
            if (field === 'nickname') {
                td.style.position     = 'relative';
                td.style.paddingRight = '32px';
            }
            td.contentEditable  = true;
            td.textContent      = row[field];
            td.dataset.field    = field;
            td.dataset.rowIndex = idx;
            td.oninput          = () => {
                row[field] = td.textContent;
                setDirty(true);
            };
            td.addEventListener('keydown', (e) => {
                if (e.key === 'Enter') {
                    e.preventDefault();
                    moveFocusToNextCell(td);
                }
            });
            tr.appendChild(td);
        });
        const pwdTd = document.createElement('td');
        const input = document.createElement('input');
        pwdTd.className        = 'password-cell';
        input.type             = 'password';
        input.value            = row.password || '';
        input.autocomplete     = 'off';
        input.style.cssText    = 'width:100%;border:none;background:transparent;outline:none;font:inherit;color:inherit;padding:0;';
        input.dataset.field    = 'password';
        input.dataset.rowIndex = idx;
        input.oninput          = () => {
            row.password = input.value.trim();
            setDirty(true);
        };
        input.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') {
                e.preventDefault(); moveFocusToNextCell(input);
            }
        });
        const eye = document.createElement('img');
        eye.src              = '../assets/eye.svg';
        eye.className        = 'eye';
        eye.style.userSelect = 'none';
        let isHolding = false;
        eye.addEventListener('mousedown', (e) => {
            e.preventDefault();
            e.stopPropagation();
            isHolding = true;
            input.type = 'text';
            eye.style.opacity = '1';
        });
        const releaseEye = () => {
            if (isHolding) {
                isHolding  = false;
                input.type = 'password';
                eye.style.opacity = '0.6';
            }
        };
        eye.addEventListener('mouseup', (e) => {
            e.preventDefault();
            e.stopPropagation();
            releaseEye();
        });
        eye.addEventListener('mouseleave', releaseEye);
        pwdTd.addEventListener('mouseleave', releaseEye);
        pwdTd.appendChild(input);
        pwdTd.appendChild(eye);
        tr.appendChild(pwdTd);
        tbody.appendChild(tr);
    });
    updateSelectAllState();
    updateActionButtons();
    attachFocusSelectListeners();
}

function moveFocusToNextCell(currentElement) {
    const allEditables = Array.from(document.querySelectorAll(
        'td[contenteditable="true"], .password-cell input'
    ));
    const currentIndex = allEditables.indexOf(currentElement);
    if (currentIndex === -1) {
        return;
    }
    const next         = allEditables[(currentIndex + 1) % allEditables.length];
    if (next) {
        focusAndSelectAll(next.tagName === 'INPUT' ? next.parentElement : next);
    }
}

function attachFocusSelectListeners() {
    document.querySelectorAll('.auto-select-on-focus').forEach(el => {
        el.classList.remove('auto-select-on-focus');
    });
    document.querySelectorAll('td[contenteditable="true"]').forEach(td => {
        td.classList.add('auto-select-on-focus');
        td.addEventListener('focus', () => focusAndSelectAll(td));
    });
    document.querySelectorAll('.password-cell input').forEach(input => {
        input.classList.add('auto-select-on-focus');
        input.addEventListener('focus', () => focusAndSelectAll(input.parentElement));
    });
}

function updateSelectAllState() {
    const allCheckboxes = document.querySelectorAll('#grid tbody input[type="checkbox"]');
    selectAll.indeterminate = false;
    selectAll.checked       = allCheckboxes.length > 0 && [...allCheckboxes].every(cb => cb.checked);
}

function hasAnySelection() {
    return [...document.querySelectorAll('#grid tbody input[type="checkbox"]')].some(cb => cb.checked);
}

function updateActionButtons() {
    const anySelected = hasAnySelection();
    deleteBtn.disabled  = dirty || !anySelected;
    executeBtn.disabled = dirty || !anySelected;
}

function isOnlyUntouchedEmptyNewRows() {
    if (!dirty) {
        return false;
    }
    if (gridData.length !== dbData.length) {
        const originalHostnames = new Set(dbData.map(r => r.hostname));
        const addedRows         = gridData.filter(row => !originalHostnames.has(row.hostname));
        return addedRows.length > 0 &&
            addedRows.every(row =>
                !row.nickname.trim() && !row.hostname.trim() &&
                !row.username.trim() && !row.password.trim()
            ) &&
            gridData.every(row => {
                if (originalHostnames.has(row.hostname)) {
                    const orig = dbData.find(o => o.hostname === row.hostname);
                    return row.nickname.trim().toLowerCase() === orig.nickname &&
                        row.hostname.trim().toLowerCase() === orig.hostname &&
                        row.username.trim().toLowerCase() === orig.username &&
                        row.password.trim() === orig.password;
                }
                return true;
            });
    }
    return false;
}

function focusAndSelectAll(cell) {
    if (!cell) {
        return;
    }
    const editable = cell.querySelector('input, [contenteditable="true"]') || cell;
    editable.focus();
    if (editable.tagName === 'INPUT') {
        editable.select();
    }
    else if (editable.isContentEditable) {
        const sel      = window.getSelection();
        sel.removeAllRanges();
        const range    = document.createRange();
        const textNode = editable.firstChild && editable.firstChild.nodeType === 3
            ? editable.firstChild
            : editable;
        range.selectNodeContents(textNode);
        sel.addRange(range);
    }
    editable.addEventListener('blur', () => {
        if (document.activeElement !== editable) {
            window.getSelection().removeAllRanges();
        }
    }, { once: true });
}

selectAll.addEventListener('change', () => {
    if (dirty) {
        return;
    }
    const rowCheckboxes = document.querySelectorAll('#grid tbody input[type="checkbox"]');
    if (rowCheckboxes.length === 0) {
        selectAll.checked = false;
        return;
    }
    rowCheckboxes.forEach(cb => { cb.checked = selectAll.checked; });
    updateActionButtons();
});

tbody.addEventListener('change', (e) => {
    if (e.target.type === 'checkbox' && !dirty) {
        updateSelectAllState();
        updateActionButtons();
    }
});

document.querySelectorAll('#grid th[data-col]').forEach(th => {
    th.style.cursor = 'pointer';
    th.onclick      = () => {
        if (dirty) {
            return;
        }
        const col = th.dataset.col;
        sortDir = col === sortCol ? -sortDir : 1;
        sortCol = col;
        sortAndRender();
    };
});

newBtn.onclick = () => {
    if (hasEmptyRow()) {
        window.api.error('Please fill or remove the existing empty row before adding another one.');
        return;
    }
    gridData.unshift({
        nickname : '',
        hostname : '',
        username : '',
        password : ''
    });
    render();
    setDirty(true);
    const firstCell = tbody.querySelector('tr td:nth-child(2)');
    firstCell.focus();
    document.execCommand('selectAll');
};

saveBtn.onclick = async () => {
    try {
        document.querySelectorAll('.error, .error-cell').forEach(el => {
            el.classList.remove('error', 'error-cell');
        });
        const processed = gridData.map((r, index) => {
            const obj = {
                nickname : r.nickname.trim().toLowerCase(),
                hostname : r.hostname.trim().toLowerCase(),
                username : r.username.trim().toLowerCase(),
                password : r.password.trim()
            };
            if (!obj.nickname) {
                throw new Error(`Empty nickname|${index}|nickname`);
            }
            if (!obj.hostname) {
                throw new Error(`Empty hostname|${index}|hostname`);
            }
            if (!obj.username) {
                throw new Error(`Empty username|${index}|username`);
            }
            if (!obj.password) {
                throw new Error(`Empty password|${index}|password`);
            }
            return obj;
        });
        const seen = {
            nickname : [],
            hostname : []
        };
        for (let i = 0; i < processed.length; i++) {
            seen.nickname.push({
                value : processed[i].nickname,
                index : i
            });
            seen.hostname.push({
                value : processed[i].hostname,
                index: i
            });
        }
        function checkDupes(field) {
            const groups = seen[field].reduce((acc, { value, index }) => {
                if (!acc[value]) {
                    acc[value] = [];
                }
                acc[value].push(index);
                return acc;
            }, {});
            for (const value in groups) {
                if (groups[value].length > 1) {
                    let offenderIndex = -1;
                    for (const idx of groups[value]) {
                        const originalKey   = `original${field.charAt(0).toUpperCase() + field.slice(1)}`;
                        const originalValue = gridData[idx][originalKey];
                        if (originalValue === undefined || gridData[idx][field].trim().toLowerCase() !== originalValue.trim().toLowerCase()) {
                            offenderIndex = idx;
                            break;
                        }
                    }
                    if (offenderIndex === -1) {
                        offenderIndex = groups[value][groups[value].length - 1];
                    }
                    const tr = tbody.querySelector(`tr:nth-child(${offenderIndex + 1})`);
                    if (tr) {
                        const td = tr.children[field === 'nickname' ? 1 : 2];
                        td?.classList.add('error-cell');
                        focusAndSelectAll(td);
                    }
                    throw new Error(`Duplicate ${field} "${value}"`);
                }
            }
        }
        checkDupes('nickname');
        checkDupes('hostname');
        await window.api.saveServers(processed);
        load();
    }
    catch (e) {
        const message     = e.message;
        const clientMatch = message.match(/^(.+?)\|(\d+)\|(.+?)$/);
        if (clientMatch) {
            const [_, errMsg, rowIndexStr, field] = clientMatch;
            const rowIndex = parseInt(rowIndexStr, 10);
            const tr       = tbody.querySelector(`tr:nth-child(${rowIndex + 1})`);
            if (tr) {
                const cellIndex = ['nickname', 'hostname', 'username', 'password'].indexOf(field) + 1;
                const td        = tr.children[cellIndex];
                if (td) {
                    td.classList.add('error-cell');
                    focusAndSelectAll(td);
                }
                else {
                    tr.classList.add('error');
                }
            }
            window.api.error(errMsg);
            return;
        }
        let friendlyMsg    = message;
        let field          = null;
        let offendingValue = null;
        const lowerMsg = message.toLowerCase();
        if (lowerMsg.includes('unique')) {
            if (lowerMsg.includes('hostname')) {
                field       = 'hostname';
                friendlyMsg = 'Hostname already exists.';
            }
            else if (lowerMsg.includes('nickname')) {
                field       = 'nickname';
                friendlyMsg = 'Nickname already exists.';
            }
            const valueMatch = message.match(/:\s*['"]?([^'"]+)['"]?/);
            if (valueMatch) {
                offendingValue = valueMatch[1].toLowerCase();
            }
        }
        if (field && offendingValue) {
            const matchingIndices = gridData.reduce((acc, row, i) => {
                if (row[field].trim().toLowerCase() === offendingValue) {
                    acc.push(i);
                }
                return acc;
            }, []);
            if (matchingIndices.length > 1) {
                let offenderIndex = matchingIndices[matchingIndices.length - 1];
                for (const idx of matchingIndices) {
                    const originalKey = `original${field.charAt(0).toUpperCase() + field.slice(1)}`;
                    if (gridData[idx][originalKey] === undefined ||
                        gridData[idx][field].trim().toLowerCase() !== gridData[idx][originalKey].trim().toLowerCase()) {
                        offenderIndex = idx;
                        break;
                    }
                }
                const tr = tbody.querySelector(`tr:nth-child(${offenderIndex + 1})`);
                if (tr) {
                    const td = tr.children[field === 'nickname' ? 1 : 2];
                    td?.classList.add('error-cell');
                    focusAndSelectAll(td);
                }
            }
        }
        window.api.error(friendlyMsg);
    }
};

cancelBtn.onclick = async () => {
    if (isOnlyUntouchedEmptyNewRows()) {
        load();
        return;
    }
    const ok = await window.api.confirm('Discard all changes?');
    if (ok) {
        load();
    }
};

deleteBtn.onclick = async () => {
    const checkedHostnames = [];
    document.querySelectorAll('#grid tbody input[type="checkbox"]:checked').forEach(cb => {
        if (cb.dataset.hostname) {
            checkedHostnames.push(cb.dataset.hostname);
        }
    });
    if (!checkedHostnames.length) {
        return;
    }
    const ok = await window.api.confirm(`Delete ${checkedHostnames.length} selected server(s)?`);
    if (!ok) {
        return;
    }
    await window.api.deleteServers(checkedHostnames);
    load();
};

executeBtn.onclick = async () => {
    if (!hasAnySelection()) {
        return;
    }
    await loadManifest();
    const actions      = getActionsForContext('servers');
    if (actions.length === 0) {
        window.api.error('No actions available.');
        return;
    }
    const existingMenu = document.querySelector('.execute-menu');
    if (existingMenu) {
        existingMenu.remove();
    }
    const menu         = buildExecuteMenu(actions, async (action) => {
        document.querySelectorAll('.nickname-icon').forEach(icon => icon.remove());
        const selectedRows = [...document.querySelectorAll('#grid tbody tr')].filter(tr =>
            tr.querySelector('input[type="checkbox"]')?.checked
        );
        const userParams   = action.extraParams ? action.extraParams.filter(p => !p.internal) : [];
        disableAllButtonsAndGrid();
        const runIt        = (extraParams) => {
            setStatus('Wait...');
            executeAction(action, selectedRows, extraParams).finally(() => {
                enableAllButtonsAndGrid();
                setStatus('Ready');
            });
        };
        if (userParams.length > 0) {
            showParamDialog(userParams[0], action, (value) => {
                if (value === null) {
                    enableAllButtonsAndGrid();
                    setStatus('Ready');
                    return;
                }
                runIt({ [userParams[0].variable]: value });
            });
        }
        else {
            runIt({});
        }
    });
    positionMenuBelow(executeBtn, menu);
    document.body.appendChild(menu);
};

async function executeAction(action, selectedRows, extraParams) {
    const wrapperText = await fetchText(WRAPPER_URL);
    if (!wrapperText) {
        selectedRows.forEach(tr => replaceNicknameIcon(tr.querySelector('.nickname-cell'), 'failure'));
        return;
    }
    const scriptText  = await fetchText(SCRIPTS_BASE + action.file);
    if (!scriptText) {
        selectedRows.forEach(tr => replaceNicknameIcon(tr.querySelector('.nickname-cell'), 'failure'));
        return;
    }
    const allResults  = [];
    const allErrors   = [];
    await Promise.allSettled(selectedRows.map(async (tr) => {
        const td       = tr.querySelector('.nickname-cell');
        const hostname = tr.querySelector('input[type="checkbox"]').dataset.hostname;
        const row      = gridData.find(r => r.hostname === hostname);
        if (!row) {
            return;
        }
        replaceNicknameIcon(td, 'wait');
        try {
            const parsed = await runRemoteAction(action, row, extraParams, wrapperText, scriptText);
            if (!parsed || parsed.success === false) {
                const errMsg = parsed?.error || 'Unknown error';
                replaceNicknameIconClickable(td, errMsg);
                allErrors.push({ server: row.nickname, error: errMsg });
            }
            else {
                replaceNicknameIcon(td, 'success');
                const rows = normalizeResults(parsed);
                allResults.push(...rows);
            }
        }
        catch (err) {
            replaceNicknameIconClickable(td, err.message);
            allErrors.push({ server: row.nickname, error: err.message });
        }
    }));
    if (allResults.length > 0) {
        tabCounter++;
        const tabId = `result-${tabCounter}`;
        createResultTab(tabId, action.title, action.produces, allResults, action);
    }
}

function replaceNicknameIcon(td, type) {
    if (!td) {
        return;
    }
    const existing = td.querySelector('.nickname-icon');
    if (existing) {
        existing.remove();
    }
    const icon     = document.createElement('img');
    icon.src              = `../assets/${type}.svg`;
    icon.className        = `nickname-icon${type === 'wait' ? ' wait' : ''}`;
    icon.style.userSelect = 'none';
    td.appendChild(icon);
}

function replaceNicknameIconClickable(td, errorMessage) {
    if (!td) {
        return;
    }
    const existing = td.querySelector('.nickname-icon');
    if (existing) {
        existing.remove();
    }
    const icon     = document.createElement('img');
    icon.src              = '../assets/failure.svg';
    icon.className        = 'nickname-icon';
    icon.style.userSelect = 'none';
    icon.style.cursor     = 'pointer';
    icon.title            = errorMessage;
    icon.addEventListener('click', () => window.api.error(errorMessage));
    td.appendChild(icon);
}

// Shared execute menu builder
function buildExecuteMenu(actions, onSelect) {
    const menu = document.createElement('div');
    menu.className = 'execute-menu';
    actions.forEach(action => {
        const item  = document.createElement('div');
        const label = document.createElement('span');
        item.dataset.actionId = action.id;
        item.style.cssText    = 'cursor:default;display:flex;align-items:center;justify-content:space-between;gap:8px;';
        label.textContent     = action.title;
        item.appendChild(label);
        if (action.warning) {
            const warnIcon = document.createElement('img');
            warnIcon.src           = '../assets/warning.svg';
            warnIcon.className     = 'menu-warning-icon';
            warnIcon.style.cssText = 'width:19px;height:19px;flex-shrink:0;';
            item.appendChild(warnIcon);
        }
        item.onmouseover = () => {
            item.style.background = 'var(--button-hover)';
            setStatus(action.description || 'No description');
        };
        item.onmouseout = () => {
            item.style.background = '';
            setStatus('Ready');
        };
        item.onclick = async () => {
            menu.remove();
            document.removeEventListener('keydown', escListener);
            document.removeEventListener('click', closeOnClick, true);
            setStatus('Ready');
            if (action.warning) {
                const ok = await window.api.warnConfirm(
                    `"${action.title}" is a potentially dangerous action.\n\nAre you sure you want to proceed?`
                );
                if (!ok) {
                    return;
                }
            }
            onSelect(action);
        };
        menu.appendChild(item);
    });
    const closeOnClick = (e) => {
        if (menu && !menu.contains(e.target) && e.target !== executeBtn &&
            e.target !== document.getElementById('result-executeBtn')) {
            menu.remove();
            document.removeEventListener('click', closeOnClick, true);
            document.removeEventListener('keydown', escListener);
            setStatus('Ready');
        }
    };
    document.addEventListener('click', closeOnClick, { capture: true });
    const escListener = (e) => {
        if (e.key === 'Escape') {
            if (menu) {
                menu.remove();
            }
            document.removeEventListener('keydown', escListener);
            document.removeEventListener('click', closeOnClick, true);
            setStatus('Ready');
        }
    };
    document.addEventListener('keydown', escListener);
    return menu;
}

function positionMenuBelow(btn, menu) {
    const rect = btn.getBoundingClientRect();
    Object.assign(menu.style, {
        position     : 'absolute',
        top          : `${rect.bottom + window.scrollY + 4}px`,
        left         : `${rect.left + window.scrollX}px`,
        background   : 'var(--bg)',
        border       : '1px solid var(--border)',
        borderRadius : '4px',
        padding      : '0',
        boxShadow    : '0 4px 12px rgba(0,0,0,0.2)',
        zIndex       : '1000',
        minWidth     : '220px',
        overflow     : 'hidden'
    });
}

const preventKeyboard = (e) => {
    // Allow Enter in textareas (needed for multiline input fields)
    if (e.key === 'Enter' && document.activeElement?.tagName === 'TEXTAREA') {
        return;
    }
    if ([' ', 'Enter'].includes(e.key)) {
        e.preventDefault();
        e.stopPropagation();
    }
};

function disableAllButtonsAndGrid() {
    [newBtn, saveBtn, cancelBtn, deleteBtn, executeBtn].forEach(b => b.disabled = true);
    const resExec  = document.getElementById('result-executeBtn');
    const resClose = document.getElementById('result-closeBtn');
    if (resExec) {
        resExec.disabled = true;
    }
    if (resClose) {
        resClose.disabled = true;
    }
    document.querySelectorAll('.checkbox-cell').forEach(cell => cell.classList.add('running'));
    document.getElementById('grid-overlay').style.display = 'block';
    document.addEventListener('keydown', preventKeyboard, true);
    if (document.activeElement) {
        document.activeElement.blur();
    }
}

function enableAllButtonsAndGrid() {
    newBtn.disabled     = false;
    saveBtn.disabled    = !dirty;
    cancelBtn.disabled  = !dirty;
    deleteBtn.disabled  = dirty || !hasAnySelection();
    executeBtn.disabled = dirty || !hasAnySelection();
    const resClose = document.getElementById('result-closeBtn');
    if (resClose) {
        resClose.disabled = false;
    }
    // Re-evaluate result exec btn based on active tab
    if (activeTabId !== 'servers') {
        updateResultExecBtn(activeTabId);
    }
    document.querySelectorAll('.checkbox-cell').forEach(cell => cell.classList.remove('running'));
    document.getElementById('grid-overlay').style.display = 'none';
    document.removeEventListener('keydown', preventKeyboard, true);
}

function showParamDialog(param, action, callback) {
    disableAllButtonsAndGrid();
    const modal = document.createElement('div');
    modal.classList.add('app-modal');
    Object.assign(modal.style, {
        position       : 'fixed',
        inset          : '0',
        background     : 'rgba(0,0,0,0.5)',
        zIndex         : '2000',
        display        : 'flex',
        alignItems     : 'center',
        justifyContent : 'center'
    });
    const box = document.createElement('div');
    Object.assign(box.style, {
        background   : 'var(--bg)',
        border       : '1px solid var(--border)',
        borderRadius : '8px',
        padding      : '20px',
        width        : '400px',
        maxWidth     : '90%',
        boxShadow    : '0 10px 30px rgba(0,0,0,0.3)'
    });
    const title = document.createElement('h3');
    title.textContent     = action.description || 'Enter parameter(s)';
    title.style.marginTop = '0';
    box.appendChild(title);
    const isBoolean   = param.type === 'boolean';
    const isMultiline = param.type === 'string' && param.multiline;
    const hasDefault  = 'default' in param;
    // For booleans: label wraps the checkbox so clicking the text toggles it.
    // For others: label sits above the input as usual.
    const label = document.createElement('label');
    label.style.cssText = isBoolean
        ? 'display:flex;align-items:center;gap:8px;margin:12px 0;cursor:pointer;'
        : 'display:block;margin:12px 0 6px;';
    const input = document.createElement(isMultiline ? 'textarea' : 'input');
    if (isBoolean) {
        input.type    = 'checkbox';
        input.checked = hasDefault ? param.default : false;
        label.appendChild(input);
        const labelText = document.createElement('span');
        labelText.textContent = param.label;
        label.appendChild(labelText);
    }
    else {
        label.textContent = param.label + (param.required ? ' *' : '');
        box.appendChild(label);
        if (!isMultiline) {
            input.type = 'text';
        }
        input.required = !!param.required;
        if (hasDefault) {
            input.value = String(param.default);
        }
        Object.assign(input.style, {
            width        : '100%',
            padding      : '8px 12px',
            border       : '1px solid var(--border)',
            borderRadius : '4px',
            background   : 'var(--bg)',
            boxSizing    : 'border-box',
            color        : 'var(--text)',
            font         : 'inherit',
            resize       : isMultiline ? 'vertical' : 'none'
        });
        if (isMultiline) {
            input.rows = 5;
        }
    }
    box.appendChild(isBoolean ? label : input);
    const buttons = document.createElement('div');
    buttons.style.cssText = 'margin-top:20px;text-align:right;';
    const okBtn = document.createElement('button');
    okBtn.textContent   = 'OK';
    okBtn.disabled      = !isBoolean && param.required && !input.value.trim();
    okBtn.style.cssText = 'padding:8px 16px;width:80px;margin-right:8px;';
    buttons.appendChild(okBtn);
    const dCancelBtn = document.createElement('button');
    dCancelBtn.textContent   = 'Cancel';
    dCancelBtn.style.cssText = 'padding:8px 16px;width:80px;';
    buttons.appendChild(dCancelBtn);
    box.appendChild(buttons);
    modal.appendChild(box);
    document.body.appendChild(modal);
    if (isBoolean) {
        okBtn.focus();
    }
    else {
        input.focus();
    }
    input.oninput = () => { okBtn.disabled = !isBoolean && param.required && !input.value.trim(); };
    const focusTrap = (e) => {
        if (e.key !== 'Tab') {
            return;
        }
        const focusable = [...box.querySelectorAll('button:not([disabled]), input:not([disabled]), textarea:not([disabled])')];
        if (!focusable.length) {
            return;
        }
        if (!box.contains(document.activeElement)) {
            e.preventDefault();
            focusable[0].focus();
            return;
        }
        if (e.shiftKey) {
            if (document.activeElement === focusable[0]) {
                e.preventDefault();
                focusable[focusable.length - 1].focus();
            }
        }
        else {
            if (document.activeElement === focusable[focusable.length - 1]) {
                e.preventDefault();
                focusable[0].focus();
            }
        }
    };
    document.addEventListener('keydown', focusTrap, true);
    const closeModal = () => {
        document.removeEventListener('keydown', focusTrap, true);
        document.removeEventListener('keydown', escHandler);
        document.body.removeChild(modal);
    };
    okBtn.onclick = () => {
        let value;
        if (isBoolean) {
            value = input.checked;
        }
        else {
            value = input.value.trim();
            if (param.required && !value) {
                return;
            }
        }
        closeModal();
        callback(value);
    };
    dCancelBtn.onclick = () => {
        closeModal();
        enableAllButtonsAndGrid();
        callback(null);
    };
    const escHandler = (e) => {
        if (e.key === 'Escape') {
            closeModal();
            enableAllButtonsAndGrid();
            callback(null);
        }
    };
    document.addEventListener('keydown', escHandler);
}

// Init

createServersTab();
initProjectUrls().then(() => {
    loadManifest();
    load();
});

// Wire result tab toolbar buttons (they exist in the DOM from the start)
document.getElementById('result-executeBtn').addEventListener('click', function() {
    showResultExecuteMenu(this);
});
document.getElementById('result-closeBtn').addEventListener('click', function() {
    if (activeTabId !== 'servers') {
        closeResultTab(activeTabId);
    }
});