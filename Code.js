var SHEET_NAME = 'Inversión';
var SPREADSHEET_ID = '';

var HEADERS = [
  'IDInversión',
  'Fecha',
  'Hora',
  'Cuanto tenía la ultima vez',
  'Porcentaje de incremento',
  'Cuanto tengo hoy',
  'Ganancia',
  'Plata que Agregué',
  'Mes'
];

function doGet(e) {
  var params = e && e.parameter ? e.parameter : {};
  var callback = params.callback || '';

  try {
    var action = params.action || 'ping';
    var payload;

    if (action === 'ping') {
      payload = { ok: true, timestamp: new Date().toISOString() };
    } else if (action === 'list') {
      payload = { ok: true, records: recalculateAndRead_() };
    } else if (action === 'create') {
      payload = createRecord_(params);
    } else if (action === 'delete') {
      payload = deleteRecord_(params);
    } else if (action === 'recalculate') {
      payload = { ok: true, records: recalculateAndRead_() };
    } else {
      payload = { ok: false, error: 'Acción desconocida: ' + action };
    }

    return returnJson_(payload, callback);
  } catch (error) {
    return returnJson_({
      ok: false,
      error: error && error.message ? error.message : String(error)
    }, callback);
  }
}

function createRecord_(params) {
  if (!params.payload) {
    throw new Error('Falta payload.');
  }

  var payload = JSON.parse(params.payload);
  var sheet = getInvestmentSheet_();
  var id = nextInvestmentId_(sheet);
  var rowObject = emptyRecord_();

  rowObject['IDInversión'] = id;
  rowObject['Fecha'] = normalizeDateValue_(payload['Fecha']);
  rowObject['Hora'] = normalizeTimeValue_(payload['Hora']);
  var uniqueDateTime = ensureUniqueDateTime_(sheet, rowObject['Fecha'], rowObject['Hora']);
  rowObject['Fecha'] = uniqueDateTime.date;
  rowObject['Hora'] = uniqueDateTime.time;
  rowObject['Cuanto tengo hoy'] = toNumber_(payload['Cuanto tengo hoy']);
  rowObject['Plata que Agregué'] = isBlank_(payload['Plata que Agregué'])
    ? ''
    : toNumber_(payload['Plata que Agregué']);

  sheet.appendRow(HEADERS.map(function(header) {
    return rowObject[header];
  }));

  return { ok: true, id: id, records: recalculateAndRead_() };
}

function deleteRecord_(params) {
  if (!params.id) {
    throw new Error('Falta id.');
  }

  var sheet = getInvestmentSheet_();
  var values = sheet.getDataRange().getValues();
  var idIndex = HEADERS.indexOf('IDInversión');
  var rowToDelete = -1;

  for (var i = 1; i < values.length; i++) {
    if (String(values[i][idIndex]) === String(params.id)) {
      rowToDelete = i + 1;
      break;
    }
  }

  if (rowToDelete > -1) {
    sheet.deleteRow(rowToDelete);
  }

  return { ok: true, records: recalculateAndRead_() };
}

function recalculateAndRead_() {
  var sheet = getInvestmentSheet_();
  var values = sheet.getDataRange().getValues();
  if (values.length <= 1) {
    return [];
  }

  var rows = values.slice(1)
    .filter(function(row) {
      return row.some(function(cell) {
        return cell !== '' && cell !== null;
      });
    })
    .map(function(row, index) {
      var record = rowToObject_(row);
      record._timestamp = getDateTimeValue_(record);
      record._originalIndex = index;
      return record;
    });

  rows.forEach(function(record) {
    var previousRecord = findPreviousRecord_(rows, record);
    var previous = previousRecord ? toNumber_(previousRecord['Cuanto tengo hoy']) : 0;
    var addedForCalc = toNumber_(record['Plata que Agregué']);
    var current = toNumber_(record['Cuanto tengo hoy']);
    var base = previous + addedForCalc;
    var gain = current - base;

    record['Cuanto tenía la ultima vez'] = round2_(previous);
    record['Cuanto tengo hoy'] = round2_(current);
    record['Ganancia'] = round2_(gain);
    record['Porcentaje de incremento'] = base === 0 ? 0 : gain / base;
    record['Mes'] = monthFromDate_(record['Fecha']);
  });

  rows.sort(function(a, b) {
    var timeDiff = a._timestamp - b._timestamp;
    if (timeDiff !== 0) return timeDiff;
    return String(a['IDInversión']).localeCompare(String(b['IDInversión']));
  });

  rows.forEach(function(record) {
    delete record._timestamp;
    delete record._originalIndex;
  });

  rewriteSheet_(sheet, rows);
  return rows;
}

function findPreviousRecord_(records, currentRecord) {
  var currentTs = currentRecord._timestamp;
  var previous = null;

  records.forEach(function(candidate) {
    if (candidate === currentRecord) return;
    if (candidate._timestamp >= currentTs) return;
    if (!previous || candidate._timestamp > previous._timestamp) {
      previous = candidate;
    }
  });

  return previous;
}

function getInvestmentSheet_() {
  var ss = getSpreadsheet_();
  if (!ss) {
    throw new Error('No hay Spreadsheet activo. Vinculá el script a una planilla o completá SPREADSHEET_ID.');
  }

  var sheet = ss.getSheetByName(SHEET_NAME);
  if (!sheet) {
    sheet = ss.insertSheet(SHEET_NAME);
  }

  ensureHeaders_(sheet);
  return sheet;
}

function getSpreadsheet_() {
  if (SPREADSHEET_ID) {
    return SpreadsheetApp.openById(SPREADSHEET_ID);
  }

  return SpreadsheetApp.getActiveSpreadsheet();
}

function ensureHeaders_(sheet) {
  var lastColumn = Math.max(sheet.getLastColumn(), 1);
  var currentHeaders = sheet.getRange(1, 1, 1, lastColumn).getValues()[0];
  var changed = false;

  if (currentHeaders.length === 1 && currentHeaders[0] === '') {
    currentHeaders = [];
    changed = true;
  }

  HEADERS.forEach(function(header) {
    if (currentHeaders.indexOf(header) === -1) {
      currentHeaders.push(header);
      changed = true;
    }
  });

  if (changed) {
    sheet.getRange(1, 1, 1, currentHeaders.length).setValues([currentHeaders]);
  }

  reorderHeaders_(sheet);
}

function reorderHeaders_(sheet) {
  var values = sheet.getDataRange().getValues();
  var existingHeaders = values[0] || [];
  var extraHeaders = existingHeaders.filter(function(header) {
    return header && HEADERS.indexOf(header) === -1;
  });
  var finalHeaders = HEADERS.concat(extraHeaders);

  if (values.length <= 1) {
    sheet.clearContents();
    sheet.getRange(1, 1, 1, finalHeaders.length).setValues([finalHeaders]);
    return;
  }

  var rows = values.slice(1).map(function(row) {
    var object = {};
    existingHeaders.forEach(function(header, index) {
      object[header] = row[index];
    });
    return finalHeaders.map(function(header) {
      return object[header] === undefined ? '' : object[header];
    });
  });

  sheet.clearContents();
  sheet.getRange(1, 1, 1, finalHeaders.length).setValues([finalHeaders]);
  sheet.getRange(2, 1, rows.length, finalHeaders.length).setValues(rows);
}

function rewriteSheet_(sheet, records) {
  var values = [HEADERS].concat(records.map(function(record) {
    return HEADERS.map(function(header) {
      return record[header] === undefined || record[header] === null ? '' : record[header];
    });
  }));

  sheet.clearContents();
  sheet.getRange(1, 1, values.length, HEADERS.length).setValues(values);
}

function rowToObject_(row) {
  var object = {};
  HEADERS.forEach(function(header, index) {
    object[header] = normalizeCellForJson_(header, row[index]);
  });
  return object;
}

function normalizeCellForJson_(header, value) {
  if (header === 'Fecha') {
    return normalizeDateValue_(value);
  }

  if (header === 'Hora') {
    return normalizeTimeValue_(value);
  }

  return value === null || value === undefined ? '' : value;
}

function emptyRecord_() {
  var record = {};
  HEADERS.forEach(function(header) {
    record[header] = '';
  });
  return record;
}

function nextInvestmentId_(sheet) {
  var values = sheet.getDataRange().getValues();
  var idIndex = HEADERS.indexOf('IDInversión');
  var maxNumber = 0;

  for (var i = 1; i < values.length; i++) {
    var id = String(values[i][idIndex] || '');
    var match = id.match(/^Inv(\d+)$/);
    if (match) {
      maxNumber = Math.max(maxNumber, Number(match[1]));
    }
  }

  return 'Inv' + String(maxNumber + 1).padStart(4, '0');
}

function ensureUniqueDateTime_(sheet, dateText, timeText) {
  var values = sheet.getDataRange().getValues();
  var dateIndex = HEADERS.indexOf('Fecha');
  var timeIndex = HEADERS.indexOf('Hora');
  var used = {};

  for (var i = 1; i < values.length; i++) {
    var existingDate = normalizeDateValue_(values[i][dateIndex]);
    var existingTime = normalizeTimeValue_(values[i][timeIndex]);
    used[existingDate + 'T' + existingTime] = true;
  }

  var currentDate = normalizeDateValue_(dateText);
  var currentTime = normalizeTimeValue_(timeText);
  var dt = dateTimeFromParts_(currentDate, currentTime);

  while (used[currentDate + 'T' + currentTime]) {
    dt = new Date(dt.getTime() + 1000);
    currentDate = Utilities.formatDate(dt, Session.getScriptTimeZone(), 'yyyy-MM-dd');
    currentTime = Utilities.formatDate(dt, Session.getScriptTimeZone(), 'HH:mm:ss');
  }

  return { date: currentDate, time: currentTime };
}

function getDateTimeValue_(record) {
  var dateText = normalizeDateValue_(record['Fecha']);
  var timeText = normalizeTimeValue_(record['Hora']);
  var parts = dateText.split('-');
  var timeParts = timeText.split(':');

  if (parts.length < 3) {
    return 0;
  }

  return dateTimeFromParts_(dateText, timeText).getTime();
}

function dateTimeFromParts_(dateText, timeText) {
  var parts = dateText.split('-');
  var timeParts = timeText.split(':');

  if (parts.length < 3) {
    return new Date(0);
  }

  return new Date(
    Number(parts[0]),
    Number(parts[1]) - 1,
    Number(parts[2]),
    Number(timeParts[0]) || 0,
    Number(timeParts[1]) || 0,
    Number(timeParts[2]) || 0
  );
}

function normalizeDateValue_(value) {
  if (Object.prototype.toString.call(value) === '[object Date]' && !isNaN(value.getTime())) {
    return Utilities.formatDate(value, Session.getScriptTimeZone(), 'yyyy-MM-dd');
  }

  var text = String(value || '').trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(text)) {
    return text;
  }

  var match = text.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (match) {
    return match[3] + '-' + pad2_(match[2]) + '-' + pad2_(match[1]);
  }

  return text;
}

function normalizeTimeValue_(value) {
  if (Object.prototype.toString.call(value) === '[object Date]' && !isNaN(value.getTime())) {
    return Utilities.formatDate(value, Session.getScriptTimeZone(), 'HH:mm:ss');
  }

  var text = String(value || '00:00:00').trim();
  var parts = text.split(':');
  return [
    pad2_(parts[0] || '00'),
    pad2_(parts[1] || '00'),
    pad2_(parts[2] || '00')
  ].join(':');
}

function monthFromDate_(dateValue) {
  var text = normalizeDateValue_(dateValue);
  var parts = text.split('-');
  if (parts.length < 3) {
    return '';
  }
  return parts[1] + '/' + parts[0];
}

function toNumber_(value) {
  if (typeof value === 'number') {
    return isFinite(value) ? value : 0;
  }

  var text = String(value || '').trim();
  if (!text) {
    return 0;
  }

  text = text.replace(/\s/g, '').replace(/\$/g, '');
  if (text.indexOf(',') >= 0) {
    text = text.replace(/\./g, '').replace(',', '.');
  }

  var number = Number(text);
  return isFinite(number) ? number : 0;
}

function isBlank_(value) {
  return value === null || value === undefined || String(value).trim() === '';
}

function round2_(value) {
  return Math.round((Number(value) || 0) * 100) / 100;
}

function pad2_(value) {
  return String(value).padStart(2, '0');
}

function returnJson_(payload, callback) {
  var json = JSON.stringify(payload);
  if (callback) {
    return ContentService
      .createTextOutput(callback + '(' + json + ');')
      .setMimeType(ContentService.MimeType.JAVASCRIPT);
  }

  return ContentService
    .createTextOutput(json)
    .setMimeType(ContentService.MimeType.JSON);
}
