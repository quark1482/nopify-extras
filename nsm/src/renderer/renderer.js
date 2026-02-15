// src/renderer/renderer.js
const tbody = document.querySelector('#grid tbody');
const selectAll = document.getElementById('selectAll');

// Make the entire header checkbox cell toggle the select-all checkbox
const headerCheckboxCell = document.querySelector('th.checkbox-cell');
if (headerCheckboxCell) {
    headerCheckboxCell.addEventListener('click', (e) => {
        if (shouldDisableCheckboxes()) return;
        // Prevent double-toggle if user clicked directly on the checkbox itself
        if (e.target === selectAll) return;
        selectAll.checked = !selectAll.checked;
        selectAll.dispatchEvent(new Event('change', {
            bubbles: true
        }));
    });
}

const newBtn = document.getElementById('newBtn');
const saveBtn = document.getElementById('saveBtn');
const cancelBtn = document.getElementById('cancelBtn');
const deleteBtn = document.getElementById('deleteBtn');
const executeBtn = document.getElementById('executeBtn');
const themeToggle = document.getElementById('themeToggle');
const themeIcon = document.getElementById('themeIcon');

let isDark = window.matchMedia('(prefers-color-scheme: dark)').matches;

function applyTheme(dark) {
    document.documentElement.classList.toggle('dark', dark);
    document.body.classList.toggle('dark', dark);
    themeIcon.src = dark ? '../assets/sun.svg' : '../assets/moon.svg';
    window.api.updateCurrentTheme(dark ? 'dark' : 'light');
}

// Receive initial theme from main (saved or null)
window.api.onSetInitialTheme((theme) => {
    if (theme === 'light') {
        isDark = false;
    }
    else if (theme === 'dark') {
        isDark = true;
    }
    applyTheme(isDark);
});

// System change listener (only if no saved preference)
window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', e => {
    if (!window.api.getCurrentTheme) {
        isDark = e.matches;
        applyTheme(isDark);
    }
});

// Click to toggle
themeToggle.onclick = () => {
    isDark = !isDark;
    applyTheme(isDark);
};
let dbData = [];
let gridData = [];
let dirty = false;
let sortCol = 'hostname';
let sortDir = 1;

function setDirty(state) {
    dirty = state;
    saveBtn.disabled = !dirty;
    cancelBtn.disabled = !dirty;
    toggleCheckboxes();
    toggleSorting(!dirty);
    location.hash = dirty ? '#dirty' : '';
    updateActionButtons();
}

function toggleCheckboxes() {
    const disable = shouldDisableCheckboxes();
    document.querySelectorAll('.checkbox-cell').forEach(td => {
        td.classList.toggle('disabled', disable);
    });
    document.querySelectorAll('input[type="checkbox"]').forEach(cb => {
        cb.disabled = disable;
    });
    selectAll.disabled = disable;
}

function shouldDisableCheckboxes() {
    return dirty || gridData.length === 0;
}

function toggleSorting(enabled) {
    document.querySelectorAll('th[data-col]').forEach(th => {
        th.style.pointerEvents = enabled ? 'auto' : 'none';
    });
}

function load() {
    window.api.loadServers().then(rows => {
        dbData = rows.map(r => ({
            nickname: r.nickname,
            hostname: r.hostname,
            username: r.username,
            password: r.password,
            originalNickname: r.nickname,
            originalHostname: r.hostname,
            originalUsername: r.username,
            originalPassword: r.password
        }));
        gridData = structuredClone(dbData);
        sortAndRender();
        setDirty(false);
    });
}

function sortAndRender() {
    gridData.sort((a, b) =>
        a[sortCol].localeCompare(b[sortCol]) * sortDir
    );
    render();
    updateSortIndicators();
}

function updateSortIndicators() {
    document.querySelectorAll('.sort-indicator').forEach(s => s.textContent = '');
    const th = document.querySelector(`th[data-col="${sortCol}"]`);
    if (th) {
        th.querySelector('.sort-indicator').textContent =
            sortDir === 1 ? '▲' : '▼';
    }
}

function hasEmptyRow() {
    return gridData.some(row =>
        !row.nickname.trim() &&
        !row.hostname.trim() &&
        !row.username.trim() &&
        !row.password.trim()
    );
}

function render() {
    tbody.innerHTML = '';
    gridData.forEach((row, idx) => {
        const tr = document.createElement('tr');
        const cbTd = document.createElement('td');
        cbTd.className = 'checkbox-cell';
        const cb = document.createElement('input');
        cb.type = 'checkbox';
        cb.dataset.hostname = row.hostname;
        cbTd.appendChild(cb);
        cbTd.addEventListener('click', (e) => {
            if (dirty) return;
            if (e.target === cb) return;
            cb.checked = !cb.checked;
            cb.dispatchEvent(new Event('change', {
                bubbles: true
            }));
        });
        tr.appendChild(cbTd);
        ['nickname', 'hostname', 'username'].forEach(field => {
            const td = document.createElement('td');
            td.contentEditable = true;
            td.textContent = row[field];
            td.dataset.field = field;
            td.dataset.rowIndex = idx;
            td.oninput = () => {
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
        pwdTd.className = 'password-cell';
        const input = document.createElement('input');
        input.type = 'password';
        input.value = row.password || '';
        input.autocomplete = 'off';
        input.style.width = '100%';
        input.style.border = 'none';
        input.style.background = 'transparent';
        input.style.outline = 'none';
        input.style.font = 'inherit';
        input.style.color = 'inherit';
        input.style.padding = '0';
        input.dataset.field = 'password';
        input.dataset.rowIndex = idx;
        input.oninput = () => {
            row.password = input.value.trim();
            setDirty(true);
        };
        input.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') {
                e.preventDefault();
                moveFocusToNextCell(input);
            }
        });
        const eye = document.createElement('img');
        eye.src = '../assets/eye.svg';
        eye.className = 'eye';
        eye.style.userSelect = 'none';
        let isHolding = false;
        eye.addEventListener('mousedown', (e) => {
            e.preventDefault();
            e.stopPropagation();
            isHolding = true;
            input.type = 'text';
            eye.style.opacity = '1';
        });
        eye.addEventListener('mouseup', (e) => {
            e.preventDefault();
            e.stopPropagation();
            if (isHolding) {
                isHolding = false;
                input.type = 'password';
                eye.style.opacity = '0.6';
            }
        });
        eye.addEventListener('mouseleave', () => {
            if (isHolding) {
                isHolding = false;
                input.type = 'password';
                eye.style.opacity = '0.6';
            }
        });
        pwdTd.addEventListener('mouseleave', () => {
            if (isHolding) {
                isHolding = false;
                input.type = 'password';
                eye.style.opacity = '0.6';
            }
        });
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
    const currentIndex = allEditables.indexOf(currentElement.tagName === 'INPUT' ? currentElement : currentElement);
    if (currentIndex === -1) return;
    let nextIndex = currentIndex + 1;
    if (nextIndex >= allEditables.length) {
        nextIndex = 0;
    }
    const next = allEditables[nextIndex];
    if (next) {
        const cell = next.tagName === 'INPUT' ? next.parentElement : next;
        focusAndSelectAll(cell);
    }
}

// Auto-select-all text on focus for all editable cells
function attachFocusSelectListeners() {
    document.querySelectorAll('.auto-select-on-focus').forEach(el => {
        el.classList.remove('auto-select-on-focus');
    });
    document.querySelectorAll('td[contenteditable="true"]').forEach(td => {
        td.classList.add('auto-select-on-focus');
        td.addEventListener('focus', () => {
            focusAndSelectAll(td);
        });
    });
    document.querySelectorAll('.password-cell input').forEach(input => {
        input.classList.add('auto-select-on-focus');
        input.addEventListener('focus', () => {
            focusAndSelectAll(input.parentElement);
        });
    });
}

// Sync select-all checkbox with row checkboxes
function updateSelectAllState() {
    const allCheckboxes = document.querySelectorAll('tbody input[type="checkbox"]');
    const allChecked = allCheckboxes.length > 0 && [...allCheckboxes].every(cb => cb.checked);
    selectAll.indeterminate = false;
    if (gridData.length === 0) {
        selectAll.checked = false;
    }
    selectAll.checked = allChecked;
}

function hasAnySelection() {
    const rowCheckboxes = document.querySelectorAll('tbody input[type="checkbox"]');
    return [...rowCheckboxes].some(cb => cb.checked);
}

function updateActionButtons() {
    const anySelected = hasAnySelection();
    deleteBtn.disabled = dirty || !anySelected;
    executeBtn.disabled = dirty || !anySelected;
}

function syncRowCheckboxesFromSelectAll() {
    const rowCheckboxes = document.querySelectorAll('tbody input[type="checkbox"]');
    rowCheckboxes.forEach(cb => {
        cb.checked = selectAll.checked;
    });
}

function isOnlyUntouchedEmptyNewRows() {
    if (!dirty) return false;
    // Compare current gridData with original dbData
    if (gridData.length !== dbData.length) {
        const originalHostnames = new Set(dbData.map(r => r.hostname));
        const addedRows = gridData.filter(row => !originalHostnames.has(row.hostname));
        // All added rows must be empty
        return addedRows.length > 0 &&
            addedRows.every(row =>
                !row.nickname.trim() &&
                !row.hostname.trim() &&
                !row.username.trim() &&
                !row.password.trim()
            ) &&
            // No other changes in existing rows
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
    if (!cell) return;
    const editable = cell.querySelector('input, [contenteditable="true"]') || cell;
    editable.focus();
    if (editable.tagName === 'INPUT') {
        editable.select();
    }
    else if (editable.isContentEditable) {
        const range = document.createRange();
        range.selectNodeContents(editable);
        const sel = window.getSelection();
        sel.removeAllRanges();
        sel.addRange(range);
    }
    const removeSelectionOnBlur = () => {
        if (document.activeElement !== editable) {
            window.getSelection().removeAllRanges();
        }
    };
    editable.addEventListener('blur', removeSelectionOnBlur, {
        once: true
    });
}

selectAll.addEventListener('change', () => {
    if (dirty) return;
    const rowCheckboxes = document.querySelectorAll('tbody input[type="checkbox"]');
    if (rowCheckboxes.length === 0) {
        selectAll.checked = false;
        return;
    }
    syncRowCheckboxesFromSelectAll();
    updateActionButtons();
});

// Make sure row checkbox changes update select-all state
tbody.addEventListener('change', (e) => {
    if (e.target.type === 'checkbox' && !dirty) {
        updateSelectAllState();
        updateActionButtons();
    }
});

document.querySelectorAll('th[data-col]').forEach(th => {
    th.onclick = () => {
        if (dirty) return;
        const col = th.dataset.col;
        sortDir = col === sortCol ? -sortDir : 1;
        sortCol = col;
        sortAndRender();
    };
});

// New row - always empty, but block if there's already an empty row
newBtn.onclick = () => {
    if (hasEmptyRow()) {
        window.api.error('Please fill or remove the existing empty row before adding another one.');
        return;
    }
    const row = {
        nickname: '',
        hostname: '',
        username: '',
        password: ''
    };
    gridData.unshift(row);
    render();
    setDirty(true);
    const firstCell = tbody.querySelector('tr td:nth-child(2)');
    firstCell.focus();
    document.execCommand('selectAll');
};

saveBtn.onclick = async () => {
    try {
        // Clear ALL previous error highlights
        document.querySelectorAll('.error, .error-cell').forEach(el => {
            el.classList.remove('error', 'error-cell');
        });
        const processed = gridData.map((r, index) => {
            const obj = {
                nickname: r.nickname.trim().toLowerCase(),
                hostname: r.hostname.trim().toLowerCase(),
                username: r.username.trim().toLowerCase(),
                password: r.password.trim()
            };
            if (!obj.nickname) throw new Error(`Empty nickname|${index}|nickname`);
            if (!obj.hostname) throw new Error(`Empty hostname|${index}|hostname`);
            if (!obj.username) throw new Error(`Empty username|${index}|username`);
            if (!obj.password) throw new Error(`Empty password|${index}|password`);
            return obj;
        });
        // Client-side: check for duplicate nicknames/hostnames in current grid
        const seen = {
            nickname: [],
            hostname: []
        };
        for (let i = 0; i < processed.length; i++) {
            const row = processed[i];
            seen.nickname.push({
                value: row.nickname,
                index: i
            });
            seen.hostname.push({
                value: row.hostname,
                index: i
            });
        }
        // Group by value and check for dupes
        function checkDupes(field) {
            const groups = seen[field].reduce((acc, {
                value,
                index
            }) => {
                if (!acc[value]) acc[value] = [];
                acc[value].push(index);
                return acc;
            }, {});
            for (const value in groups) {
                if (groups[value].length > 1) {
                    // Find the "offender" index: the one where current != original (or no original = new row)
                    let offenderIndex = -1;
                    for (const idx of groups[value]) {
                        const originalKey = `original${field.charAt(0).toUpperCase() + field.slice(1)}`;
                        const originalValue = gridData[idx][originalKey];
                        if (originalValue === undefined || gridData[idx][field].trim().toLowerCase() !== originalValue.trim().toLowerCase()) {
                            offenderIndex = idx;
                            break;
                        }
                    }
                    if (offenderIndex === -1) offenderIndex = groups[value][groups[value].length - 1];
                    // Highlight offender cell
                    const tr = tbody.querySelector(`tr:nth-child(${offenderIndex + 1})`);
                    if (tr) {
                        const cellIndex = field === 'nickname' ? 1 : 2;
                        const td = tr.children[cellIndex];
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
        const message = e.message;
        const clientMatch = message.match(/^(.+?)\|(\d+)\|(.+?)$/);
        if (clientMatch) {
            const [_, errMsg, rowIndexStr, field] = clientMatch;
            const rowIndex = parseInt(rowIndexStr, 10);
            const tr = tbody.querySelector(`tr:nth-child(${rowIndex + 1})`);
            if (tr) {
                const cellIndex = ['nickname', 'hostname', 'username', 'password'].indexOf(field) + 1;
                const td = tr.children[cellIndex];
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
        // DB-level errors
        let friendlyMsg = message;
        let field = null;
        let offendingValue = null;
        const lowerMsg = message.toLowerCase();
        if (lowerMsg.includes('unique')) {
            if (lowerMsg.includes('hostname')) {
                field = 'hostname';
                friendlyMsg = 'Hostname already exists.';
            }
            else if (lowerMsg.includes('nickname')) {
                field = 'nickname';
                friendlyMsg = 'Nickname already exists.';
            }
            // Try to extract value from msg (if present, e.g. ": 'value'")
            const valueMatch = message.match(/:\s*['"]?([^'"]+)['"]?/);
            if (valueMatch) offendingValue = valueMatch[1].toLowerCase();
        }
        if (field && offendingValue) {
            // Find all rows with this value
            const matchingIndices = [];
            for (let i = 0; i < gridData.length; i++) {
                if (gridData[i][field].trim().toLowerCase() === offendingValue) {
                    matchingIndices.push(i);
                }
            }
            if (matchingIndices.length > 1) {
                // Among matches, find the "offender": changed or new
                let offenderIndex = -1;
                for (const idx of matchingIndices) {
                    const originalKey = `original${field.charAt(0).toUpperCase() + field.slice(1)}`;
                    const originalValue = gridData[idx][originalKey];
                    if (originalValue === undefined || gridData[idx][field].trim().toLowerCase() !== originalValue.trim().toLowerCase()) {
                        offenderIndex = idx;
                        break;
                    }
                }
                if (offenderIndex === -1) offenderIndex = matchingIndices[matchingIndices.length - 1];
                const tr = tbody.querySelector(`tr:nth-child(${offenderIndex + 1})`);
                if (tr) {
                    const cellIndex = field === 'nickname' ? 1 : 2;
                    const td = tr.children[cellIndex];
                    td?.classList.add('error-cell');
                    focusAndSelectAll(td);
                }
            }
        }
        else {
            // No highlight, just dialog
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
    if (ok) load();
};

deleteBtn.onclick = async () => {
    const checkedHostnames = [];
    document.querySelectorAll('tbody input[type="checkbox"]:checked').forEach(cb => {
        if (cb.dataset.hostname) {
            checkedHostnames.push(cb.dataset.hostname);
        }
    });
    if (!checkedHostnames.length) return;
    const ok = await window.api.confirm(`Delete ${checkedHostnames.length} selected server(s)?`);
    if (!ok) return;
    await window.api.deleteServers(checkedHostnames);
    load();
};

load();