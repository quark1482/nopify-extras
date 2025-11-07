const sourceInEUR       = !!PropertiesService.getScriptProperties().getProperty('sourceInEUR');
const paymentOnNext1st  = !!PropertiesService.getScriptProperties().getProperty('paymentOnNext1st');
const enableChatterAuto = !!PropertiesService.getScriptProperties().getProperty('enableChatterAuto');
const namesLeadingText  = PropertiesService.getScriptProperties().getProperty('namesLeadingText');

function onOpen() {
  const ui = SpreadsheetApp.getUi();
  var mn = ui.createMenu('Report tools');
  mn.addItem('Generate payments sheet', 'showPeriodDialog').addToUi();
  mn.addItem('Validate model sheets', 'showValidateDialog').addToUi();
  mn.addItem('Clear N/A chatter cells', 'clearNAChatterCells').addToUi();
  if (enableChatterAuto) {
    mn.addItem('Set chatter %', 'showPercentageDialog').addToUi();
  }
  mn.addItem('Create JSON accounts setup', 'showCreateJSONDialog').addToUi();
}

function showPercentageDialog() {
  var html = HtmlService.createHtmlOutputFromFile('PercentageDialog').setWidth(250).setHeight(50);
  SpreadsheetApp.getUi().showModalDialog(html, 'Select Percentage');
}

function setPercentage(percentage) {
  const ui = SpreadsheetApp.getUi();
  if (ui.Button.YES == ui.alert('Warning!', 'Overwrite chatters data?', ui.ButtonSet.YES_NO)) {
    var spread = SpreadsheetApp.getActiveSpreadsheet();
    var sheets = spread.getSheets();
    var dialog = HtmlService.createHtmlOutput('<h2>Wait...</h2>').setWidth(150).setHeight(50);
    SpreadsheetApp.getUi().showModalDialog(dialog,'Updating sheets');
    for (var i = 2; i < sheets.length; i++) {
      var sheet = sheets[i];
      var data = sheet.getDataRange().getValues();
      for (var row = 0; row < data.length; row++) {
        var cellValue = data[row][0];
        if (isDate(cellValue)) {
          var cellB = sheet.getRange(row + 1, 2);
          var cellC = sheet.getRange(row + 1, 3);
          cellB.setValue('auto');
          cellC.setValue((percentage + '%'));
        }
      }
    }
    dialog.setContent('<h2>Done</h2><script>google.script.host.close();</script>').setWidth(150).setHeight(50);
    SpreadsheetApp.getUi().showModalDialog(dialog,'Updating sheets');
  }
}

function clearNAChatterCells() {
  const ss     = SpreadsheetApp.getActiveSpreadsheet();
  const sheets = ss.getSheets();
  sheets.forEach(
    function(s) {
      if (isModelSheet(s)) {
        const range  = s.getRange(`B1:B${s.getLastRow()}`);
        const values = range.getValues();
        values.forEach(
          function(row, indexRow) {
            row.forEach(
              function(v, indexCol) {
                if (v.trim() === '/' || v.trim().toUpperCase() === 'N/A') {
                  var cell = range.getCell(indexRow + 1, indexCol + 1);
                  cell.clearContent();
                }
              }
            );
          }
        );
      }
    }
  );
}

function showPeriodDialog() {
  const ui   = SpreadsheetApp.getUi();
  const html = HtmlService.createHtmlOutputFromFile('PeriodDialog').setWidth(250).setHeight(100);
  ui.showModalDialog(html, 'Select Period');
}

function showValidateDialog() {
  const rowModelStart = 5;
  const ss            = SpreadsheetApp.getActiveSpreadsheet();
  const ui            = SpreadsheetApp.getUi();
  const dialog        = HtmlService.createHtmlOutput('<h2>Wait...</h2>').setWidth(400).setHeight(50);
  const titleDialog1  = 'Validating model sheets';
  const titleDialog2  = 'Validation results';
  const styleLog      = 'white-space: nowrap; resize: none; width: 95vw; height: 95vh;';
  const sheets        = ss.getSheets();
  const models        = [];
  const logLines      = [];
  ui.showModalDialog(dialog, titleDialog1);
  for (let indexSheet = 0; indexSheet < sheets.length; indexSheet++) {
    if (isModelSheet(sheets[indexSheet])) {
      const nameModelSheet  = sheets[indexSheet].getName();
      const valueModelName  = sheets[indexSheet].getRange('B1').getValue();
      const dataSheetValues = sheets[indexSheet].getDataRange().getValues();
      const logHeader       = `'${nameModelSheet}' (${valueModelName})`;
      const foundModel      = models.find(
        function (m) {
          return m.model == valueModelName;
        }
      );
      if (foundModel) {
        const logError = `duplicated model sheet ('${foundModel.sheet}')`;
        logLines.push(`${logHeader} --> ${logError}`);
      }
      else {
        models.push({ model: valueModelName, sheet: nameModelSheet });
      }
      for (let indexRow = rowModelStart - 1; indexRow < dataSheetValues.length; indexRow++) {
        const valueDate         = dataSheetValues[indexRow][0];
        const valueChatterName  = normalizeName(dataSheetValues[indexRow][1]);
        const valueChatterShare = parseFloat(dataSheetValues[indexRow][2]);
        if (isDate(valueDate)) {
          if (valueChatterName) {
            if (isNaN(valueChatterShare)) {
              const logError = `chatter was set ('${valueChatterName}'), but share wasn't`;
              logLines.push(`${logHeader} C${indexRow + 1} --> ${logError}`);
            }
            else if (valueChatterShare <= 0 || valueChatterShare >= 1) {
              const logError = `chatter was set ('${valueChatterName}'), but share is invalid`;
              logLines.push(`${logHeader} C${indexRow + 1} --> ${logError}`);
            }
          }
          else if (!isNaN(valueChatterShare)) {
            const logError = `share was set (${valueChatterShare}), but chatter wasn't`;
            logLines.push(`${logHeader} B${indexRow + 1} --> ${logError}`);
          }
        }
        else {
          if (valueChatterName) {
            const logError = `chatter was set ('${valueChatterName}'), but date is wrong`;
            logLines.push(`${logHeader} A${indexRow + 1} --> ${logError}`);
          }
          else if (valueChatterShare) {
            const logError = `share was set (${valueChatterShare}), but date is wrong`;
            logLines.push(`${logHeader} A${indexRow + 1} --> ${logError}`);
          }
        }
      }
    }
  }
  if (!logLines.length) {
    logLines.push('no problems were found');
  }
  dialog.setContent(`<textarea style='${styleLog}'>${logLines.join('\n')}</textarea>`).setWidth(600).setHeight(600);
  ui.showModalDialog(dialog, titleDialog2);
}

function finishPayments(sheet, year, month, data, rowFrom) {
  const arrayChatters = Object.keys(data);
  const rowDataEnd    = rowFrom + arrayChatters.length - 1;
  const rangeData     = sheet.getRange(`A${rowFrom}:E${rowDataEnd}`);
  const rangeValues   = [];
  const rangePayInUSD = sheet.getRange(`D${rowFrom}:D${rowDataEnd}`);
  const rangePayInEUR = sheet.getRange(`E${rowFrom}:E${rowDataEnd}`);
  const rangeFormulas = [];
  const cellRate      = sheet.getRange(sourceInEUR ? 'D2' : 'E2');
  const cellFallig    = sheet.getRange('B3');
  const cellGesamtUSD = sheet.getRange('D3');
  const cellGesamtEUR = sheet.getRange('E3');
  let dateNext;
  if (paymentOnNext1st) {
    dateNext = month < 12 ? new Date(year, month, 1) : new Date(year + 1, month - 12, 1);
  }
  else {
    dateNext = month < 11 ? new Date(year, month + 1, 1): new Date(year + 1, month - 11, 1);
    dateNext.setDate(dateNext.getDate() - 1);
  }
  const r = sourceInEUR ? getBestRate(dateNext, 'EUR', 'USD') : getBestRate(dateNext, 'USD', 'EUR');
  cellRate.setNote(r.note);
  cellRate.setNumberFormat(sourceInEUR ? '0.000000 "$/€"' : '0.000000 "€/$"');
  cellRate.setValue(r.rate);
  cellFallig.setValue(dateNext.toLocaleDateString('de-DE'));
  if (arrayChatters.length) {
    rangeData.setHorizontalAlignment('center');
    rangeData.setVerticalAlignment('middle');
    rangeData.setWrap(true);
    rangePayInUSD.setNumberFormat('$#,##0.00');
    rangePayInEUR.setNumberFormat('€#,##0.00');
    for (let indexChatter = 0; indexChatter < arrayChatters.length; indexChatter++) {
      const valueChatterName = arrayChatters[indexChatter];
      const valueModelsList  = data[valueChatterName].models.join('\n');
      if (sourceInEUR) {
        rangeValues.push([
          valueChatterName,
          valueModelsList,
          '',
          0,
          data[valueChatterName].payment
        ]);
        rangeFormulas.push([`=E${rowFrom + indexChatter}*D2`]);
      }
      else {
        rangeValues.push([
          valueChatterName,
          valueModelsList,
          '',
          data[valueChatterName].payment,
          0
        ]);
        rangeFormulas.push([`=D${rowFrom + indexChatter}*E2`]);
      }
    }
    rangeData.setValues(rangeValues);
    rangeData.sort({column: 1, ascending: true});
    if (sourceInEUR) {
      rangePayInUSD.setFormulas(rangeFormulas);
    }
    else {
      rangePayInEUR.setFormulas(rangeFormulas);
    }
    cellGesamtUSD.setFormula(`=SUM(D${rowFrom}:D${rowDataEnd})`);
    cellGesamtUSD.setNumberFormat('$#,##0.00');
    cellGesamtEUR.setFormula(`=SUM(E${rowFrom}:E${rowDataEnd})`);
    cellGesamtEUR.setNumberFormat('€#,##0.00');
    const rowLast = sheet.getLastRow() == sheet.getFrozenRows() ? sheet.getLastRow() + 1: sheet.getLastRow();
    sheet.deleteRows(rowLast + 1, sheet.getMaxRows() - rowLast);
  }
  const columnLast = sheet.getLastColumn();
  sheet.deleteColumns(columnLast + 1, sheet.getMaxColumns() - columnLast);
}

function generatePayments(p) {
  const colorRed      = '#ffbfbf';
  const colorGreen    = '#bfffbf';
  const colorBlue     = '#bfffff';
  const rowModelStart = 5;
  const rowDataStart  = 6;  
  const ss            = SpreadsheetApp.getActiveSpreadsheet();
  const ui            = SpreadsheetApp.getUi();
  const dialog        = HtmlService.createHtmlOutput('<h2>Wait...</h2>').setWidth(400).setHeight(50);
  const titleDialog   = 'Generating payments sheet';
  ui.showModalDialog(dialog, titleDialog);
  let rangeStatus;
  try {
    const period        = p.split('-');
    const year          = parseInt(period[0]);
    const month         = parseInt(period[1]);
    const doirep        = `.${String(month).padStart(2,'0')}.${year}`;
    const sheetPayments = preparePayments(ss);
    const sheets        = ss.getSheets();
    const dataReport    = {};
    ss.setActiveSheet(sheetPayments);
    rangeStatus = sheetPayments.getRange('A1:E1');
    rangeStatus.setBackground(colorBlue);
    for (let indexSheet = 0; indexSheet < sheets.length; indexSheet++) {
      rangeStatus.setValue(`Creating report... ${Math.round((indexSheet + 1) / sheets.length * 100)} %`);
      if (isModelSheet(sheets[indexSheet])) {
        const valueModelName  = sheets[indexSheet].getRange('B1').getValue();
        const dataSheetValues = sheets[indexSheet].getDataRange().getValues();
        for (let indexRow = rowModelStart - 1; indexRow < dataSheetValues.length; indexRow++) {
          const valueDate         = dataSheetValues[indexRow][0];
          const valueChatterName  = normalizeName(dataSheetValues[indexRow][1]);
          const valueChatterTotal = parseFloat(dataSheetValues[indexRow][4]);
          if (valueDate.endsWith(doirep) && valueChatterName && valueChatterTotal) {
            if (!dataReport[valueChatterName]) {
              dataReport[valueChatterName] = { models: [], payment: 0 };
            }
            if (!dataReport[valueChatterName].models.find(
              function (m) {
                return m == valueModelName;
              }
            )) {
              dataReport[valueChatterName].models.push(valueModelName);
            }
            dataReport[valueChatterName].payment += valueChatterTotal;
          }
        }
      }
    }
    finishPayments(sheetPayments, year, month, dataReport, rowDataStart);
    rangeStatus.setBackground(colorGreen);
    rangeStatus.setValue(`Finished at ${new Date().toUTCString()}`);
  }
  catch (err) {
    if (rangeStatus) {
      rangeStatus.setBackground(colorRed);
      rangeStatus.setValue(err.stack);
    }
  }
  finally {
    dialog.setContent('<h2>Done</h2><script>google.script.host.close();</script>').setWidth(400).setHeight(50);
    ui.showModalDialog(dialog, titleDialog);
  }
}

function getBestRate(date, from, to) {
  const ret = {
    rate    : 0.0,
    note    : ''
  };
  const res = xeAPIGetRates(from, to);
  if (!res.status) {
    ret.note = `getBestRate(${date.toUTCString()}) failed: ${res.message}`;
  }
  else {
    for (let i = res.rates.length - 1; i >= 0; i--) {
      if (res.rates[i].date <= date) {
        ret.rate = res.rates[i].rate;
        ret.note = `best rate for ${res.rates[i].date.toUTCString()}`;
        break;
      }
    }
    if (!ret.rate) {
      ret.note = `getBestRate(${date.toUTCString()}) failed: rate not found`;
    }
  }
  return ret;
}

function isDate(value) {
  if (typeof value !== 'string') {
    return false;
  }
  var regex = /^(\d{1,2})\.(\d{1,2})\.(\d{4})$/;
  var match = value.match(regex);
  if (!match) {
    return false;
  }
  var day = parseInt(match[1]);
  var month = parseInt(match[2]);
  var year = parseInt(match[3]);
  if (year < 1900 || year > 2100 || month < 1 || month > 12) {
    return false;
  }
  var daysInMonth = new Date(year, month, 0).getDate();
  return day <= daysInMonth;
}

function isModelSheet(s) {
    const valueModel   = s.getRange('B1').getValue()
    const valuePercent = parseFloat(s.getRange('D1').getValue());
    if (!isNaN(valuePercent)) {
      const name = valuePercent ? `${valueModel} -${valuePercent * 100}` : valueModel;
      return s.getName() == name;
    }
    return false;
}

function normalizeName(n) {
  const words = n.replace(/\s+/g, ' ').trim().toLowerCase().split(' ');
  for (let k  = 0; k < words.length; k++) {
    words[k]  = words[k].charAt(0).toUpperCase() + words[k].slice(1);
  }
  return words.join(' ');
}

function preparePayments(spread) {
  const sheetName     = 'Zahlungen';
  const sheetIndex    = 2;
  const frozenRows    = 5;
  const sh            = spread.getSheetByName(sheetName);
  if (sh) {
    spread.deleteSheet(sh);
  }
  const sp            = spread.insertSheet(sheetName, sheetIndex);
  const rangeStatus   = sp.getRange('A1:E1');
  const rangeTotals   = sp.getRange('A3:E3');
  const cellRate      = sp.getRange('D2:E2');
  const valueTotals   = [['Zahlung fällig', '', 'Gesamt', '', '']];
  const rangeTitle    = sp.getRange('A4:E4');
  const valueTitle    = 'Chatters';
  const rangeSubtitle = sp.getRange('A5:E5');
  const valueSubtitle = [['Chatter', 'Model', 'Notes', 'Payment (USD)', 'Payment (EUR)']];
  rangeStatus.merge();
  rangeStatus.setHorizontalAlignment('center');
  cellRate.setFontStyle('italic');
  cellRate.setFontWeight('bold');
  cellRate.setHorizontalAlignment('center');
  rangeTotals.setBackground('black');
  rangeTotals.setFontColor('white');
  rangeTotals.setFontWeight('bold');
  rangeTotals.setHorizontalAlignment('center');
  rangeTotals.setValues(valueTotals,);
  rangeTitle.merge();
  rangeTitle.setFontWeight('bold');
  rangeTitle.setHorizontalAlignment('center');
  rangeTitle.setValue(valueTitle);
  rangeSubtitle.setBorder(true, true, true, true, true, true);
  rangeSubtitle.setFontWeight('bold');
  rangeSubtitle.setHorizontalAlignment('center');
  rangeSubtitle.setValues(valueSubtitle);
  sp.setFrozenRows(frozenRows);
  return sp;
}

function xeAPIGetRates(from, to) {
  const ret  = {
    rates    : [],
    status   : false,
    message  : ''
  };
  const url  = `https://www.xe.com/api/protected/charting-rates/?`+
               `fromCurrency=${from.toUpperCase()}&toCurrency=${to.toUpperCase()}&isExtended=true`;
  const user = 'lodestar';
  const pass = 'pugsnax';
  const auth = Utilities.base64Encode(`${user}:${pass}`);
  const opt  = {
    method             : 'get',
    headers            : { Authorization : `Basic ${auth}` },
    muteHttpExceptions : true
  };
  try {
    const res  = UrlFetchApp.fetch(url, opt);
    const code = res.getResponseCode();
    const json = res.getContentText();
    const type = res.getHeaders()['Content-Type'];
    if(200 != code) {
      ret.message = `Unexpected response: ${code}`;
    }
    else if (!type.startsWith('application/json')) {
      ret.message = `Unexpected content type: ${type}`;
    }
    else {
      ret.rates   = xeAPIParseRates(JSON.parse(json));
      ret.status  = true;
    }
  }
  catch (err) {
    ret.message = err.message;
  }
  return ret;
}

function xeAPIParseRates(rawRates) {
  let n = 1e3 * Math.floor(Date.now() / 1e3),
      r = n - 31536e7;
  let a = rawRates.batchList,
      i = [],
      o = [],
      c = Number.POSITIVE_INFINITY,
      l = Number.NEGATIVE_INFINITY;
  a.forEach(e => {
    let {
      startTime : n,
      interval  : a,
      rates     : [s, ...m]
    } = e;
    m.forEach((e, m) => {
      let u = Math.round((e - s + Number.EPSILON) * 1e10) / 1e10;
      t = u;
      let d = {
        timestamp : n + m * a,
        rate      : u
      };
      d.timestamp >= r && (i.push(d), c = Math.min(c, u), l = Math.max(l, u)), o.push(d)
    });
  });
  const parsedRates = [];
  for (const r of o) {
    if (r.timestamp % 86400000 == 0) {
      const date = new Date(r.timestamp);
      const rate = r.rate;
      parsedRates.push({ date, rate });
    }
  }
  return parsedRates;
}

/////////////////////////////////////////////////////////////////////////////////////////
// Code added on April 2025 to handle the new menu option 'Create JSON accounts setup' //
// Requires two new files: CreateJSONDialog.html and ViewCreatedJSON.html for running. //
/////////////////////////////////////////////////////////////////////////////////////////

function showCreateJSONDialog() {
  const ss    = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName('Performance');
  if (!sheet) {
    SpreadsheetApp.getUi().alert('Sheet "Performance" not found.');
    return;
  }
  const data = sheet.getDataRange().getValues();
  if (data.length < 2) {
    SpreadsheetApp.getUi().alert('No data found in "Performance" sheet.');
    return;
  }
  const header = data[0].map(h => h.toString().trim().toLowerCase());
  const requiredColumns = ['account', 'chatter', 'von', 'email', 'passwort'];
  for (const col of requiredColumns) {
    if (!header.includes(col)) {
      SpreadsheetApp.getUi().alert(`"${col}" column not found in Performance sheet.`);
      return;
    }
  }
  const colIndices  = requiredColumns.map(col => header.indexOf(col));
  const hasValidRow = data.slice(1).some(row =>
    colIndices.every(i => row[i] && row[i].toString().trim() !== '')
  );
  if (!hasValidRow) {
    SpreadsheetApp.getUi().alert('No single account with complete details was found.');
    return;
  }
  const html = HtmlService.createHtmlOutputFromFile('CreateJSONDialog').setWidth(800).setHeight(600);
  SpreadsheetApp.getUi().showModalDialog(html, 'Accounts setup options');
}

function getCreateJSONDialogInitialData() {
  const ss               = SpreadsheetApp.getActiveSpreadsheet();
  const sheet            = ss.getSheetByName('Performance');
  const data             = sheet.getDataRange().getValues();
  const header           = data[0].map(h => h.toString().trim().toLowerCase());
  const accountCol       = header.indexOf('account');
  const vonCol           = header.indexOf('von');
  const selectedAccounts = [];
  const ignoredChatters  = ['nicht besetzen', 'gelöscht', 'deleted'];
  const selection        = sheet.getActiveRangeList();
  if (selection) {
    const selectedRanges = selection.getRanges();
    const selectedRows   = new Set();
    selectedRanges.forEach(range => {
      const startRow = range.getRow();
      const numRows  = range.getNumRows();
      const startCol = range.getColumn();
      const numCols  = range.getNumColumns();
      for (let r = 0; r < numRows; r++) {
        const rowIndex = startRow + r - 1;
        if (rowIndex === 0) {
          continue;
        }
        selectedRows.add(rowIndex);
      }
    });
    selectedRows.forEach(rowIndex => {
      const accountCell = data[rowIndex] && data[rowIndex][accountCol];
      if (accountCell) {
        const acc = accountCell.toString().trim().toLowerCase().split(' ')[0];
        if (acc) {
          selectedAccounts.push(acc);
        }
      }
    });
  }
  const vonValues = new Set();
  data.slice(1).forEach(row => {
    const von = row[vonCol];
    if (von) {
      const val = von.toString().trim();
      if (val) {
        const pascal = val.replace(/\w\S*/g, w => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase());
        vonValues.add(pascal);
      }
    }
  });
  return {
    selectedAccounts : Array.from(new Set(selectedAccounts)),
    ignoredChatters,
    namesLeadingText,
    vonOptions       : Array.from(vonValues)
  };
}

function alertCreateJSONCopy(groupNumber) {
  SpreadsheetApp.getUi().alert(`Group #${groupNumber} copied`);
}

function removeLeadingText(list, text) {
  if (text) {
    return list.map(i => i.toLowerCase().startsWith(text.toLowerCase()) ? i.slice(text.length) : i);
  }
  else {
    return list;
  }
}


function createJSONAccountsSetup(params) {
  const ss               = SpreadsheetApp.getActiveSpreadsheet();
  const sheet            = ss.getSheetByName('Performance');
  const data             = sheet.getDataRange().getValues();
  const header           = data[0].map(h => h.toString().trim().toLowerCase());
  const accountCol       = header.indexOf('account');
  const chatterCol       = header.indexOf('chatter');
  const vonCol           = header.indexOf('von');
  const emailCol         = header.indexOf('email');
  const passCol          = header.indexOf('passwort');
  const results          = [];
  const modeCaster       = params.creationMode === 'Caster';
  const modeHarvester    = params.creationMode === 'Harvester';
  const modeLists        = params.creationMode === 'Lists';
  const modeStats        = params.creationMode === 'Stats';
  const proxies          = JSON.parse(params.proxyDetails);
  const leadingText      = params.namesLeadingText;
  const selectedAccounts = removeLeadingText(params.processAccounts, leadingText);
  const ignoreAccounts   = removeLeadingText(params.ignoreAccounts, leadingText);
  const ignoreChatters   = params.ignoreChatters;
  const onlyVon          = modeStats ? '' : params.onlyVon;
  const startNow         = params.startNow;
  const restartPolicy    = params.restartPolicy.toLowerCase();
  const splitCount       = modeStats ? 0 : params.splitCount;
  const defaultBg        = '#ffffff';
  for (let i = 1; i < data.length; i++) {
    const row         = data[i];
    const accountCell = row[accountCol] || '';
    const chatterCell = row[chatterCol] || '';
    const accountStr  = accountCell.toString().trim().toLowerCase();
    const account     = accountStr.split(' ')[0];
    const share       = parseFloat(
      accountStr.split(' ').slice(1).join(' ').trim().replaceAll('-','')
    ) || 0;
    const chatter     = chatterCell.toString().trim().toLowerCase();
    if (!account) {
      continue;
    }
    if (selectedAccounts.length && !selectedAccounts.includes(account)) {
      continue;
    }
    if (ignoreAccounts.includes(account)) {
      continue;
    }
    if (ignoreChatters.some(i => chatter.includes(i))) {
      continue;
    }
    if (params.ignoreColored) {
      const bg = sheet.getRange(i + 1, accountCol + 1).getBackground();
      if (bg !== defaultBg) {
        continue;
      }
    }
    const vonCell = row[vonCol];
    if (!vonCell) {
      continue;
    }
    if (onlyVon) {
      const von = vonCell.toString().trim().replace(/\w\S*/g, w => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase());
      if (von !== onlyVon) {
        continue;
      }
    }
    const identifier = (row[emailCol] || '').toString().trim();
    const password   = (row[passCol]  || '').toString();
    if (!identifier || !password) {
      continue;
    }
    const adv_proxy_usage = [];
    proxies.forEach(p => {
      if (!p.accounts.length) {
        adv_proxy_usage.push(p.proxy);
      }
      else if (p.accounts.includes(account)) {
        adv_proxy_usage.push(p.proxy);
      }
    });
    if (modeLists) {
      results.push({
        account,
        identifier,
        password
      });
    }
    else if (modeStats) {
      results.push({
        account,
        identifier,
        password,
        share
      });
    }
    else {
      results.push({
        run_name        : leadingText + account,
        start_now       : startNow,
        restart_policy  : restartPolicy,
        auth_identifier : identifier,
        auth_password   : password,
        adv_proxy_usage
      });
    }
  }
  const output = [];
  if (splitCount > 0) {
    for (let i = 0; i < results.length; i += splitCount) {
      output.push(JSON.stringify(results.slice(i, i + splitCount), null, 4));
    }
  }
  else {
    output.push(JSON.stringify(results, null, 4));
  }
  const html    = HtmlService.createHtmlOutputFromFile('ViewCreatedJSON').setWidth(800).setHeight(600);
  const summary = `Processed: ${data.length - 1}, Included: ${results.length}`;
  const chunks  = output.map(chunk => chunk.replace(/\\/g, '\\\\').replace(/`/g, '\\`'));
  html.append(
    `<script>` +
    `window.onload = function() {` +
    `  renderChunks(\`${summary}\`, ${JSON.stringify(chunks)});` +
    `};` +
    `</script>`
  );
  SpreadsheetApp.getUi().showModalDialog(html, 'Generated JSON');
}