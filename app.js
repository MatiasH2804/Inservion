(function () {
  "use strict";

  var WEB_APP_URL = "https://script.google.com/macros/s/AKfycbwHcwxZu8lPjQUEaxa6tKD42v9p9ilntX9Dh3bGD3kMDcD4ZE5DIs843ulDeeV-kbaZog/exec";
  var CACHE_KEY = "auditor_inversion_cache_v1";
  var JSONP_TIMEOUT_MS = 15000;
  var ANALYTICS_GAIN_LIMIT = 1000000;

  /*
    Validacion mental obligatoria del motor contable:
    Inv0001 current=2897204.08 added=vacio => baseline, no cuenta como ganancia real.
    Inv0002 previous=2897204.08 added=89000 current=2992815.46 => gain=6611.38.
    Inv0003 previous=2992815.46 added=89000 current=3081815.46 => gain=0.
    Inv0004 previous=3081815.46 added=vacio current=3082653.26 => gain=837.80.
    Inv0005 previous=3082653.26 added=vacio current=3081714.96 => gain=-938.30.
    Inv0006 previous=3081714.96 added=-81714.96 current=3000000.00 => gain=0.
    Inv0007 previous=3000000.00 added=vacio current=3003351.52 => gain=3351.52.
    Ganancia real total esperada: 9862.40.
    Movimiento de capital neto esperado: 96285.04.
    Aportes positivos esperados: 178000.00.
    Retiros negativos esperados: -81714.96.
    Si todos son el mismo dia, promedio diario de ganancia real esperado: 9862.40.
  */

  var FIELD = {
    id: "IDInversión",
    date: "Fecha",
    time: "Hora",
    previous: "Cuanto tenía la ultima vez",
    percent: "Porcentaje de incremento",
    current: "Cuanto tengo hoy",
    gain: "Ganancia",
    added: "Plata que Agregué",
    month: "Mes"
  };

  var LEGACY_FIELD_ALIASES = {
    "IDInversiÃ³n": FIELD.id,
    "Cuanto tenÃ­a la ultima vez": FIELD.previous,
    "Plata que AgreguÃ©": FIELD.added
  };

  var defaultCache = {
    records: [],
    pendingQueue: [],
    lastSyncAt: null,
    serverOnline: false
  };

  var cache = loadCache();
  var syncRunning = false;
  var currentInputTouched = false;
  var analyticsDebugLogged = false;
  var activeModalChartType = null;
  var activeModalZoom = 1;
  var els = {};

  document.addEventListener("DOMContentLoaded", init);

  function init() {
    els = {
      statusBanner: document.getElementById("statusBanner"),
      lastSyncText: document.getElementById("lastSyncText"),
      messageArea: document.getElementById("messageArea"),
      mobileNewRecordToggle: document.getElementById("mobileNewRecordToggle"),
      newRecordPanel: document.getElementById("newRecordPanel"),
      form: document.getElementById("recordForm"),
      dateInput: document.getElementById("dateInput"),
      timeInput: document.getElementById("timeInput"),
      previousInput: document.getElementById("previousInput"),
      percentInput: document.getElementById("percentInput"),
      currentInput: document.getElementById("currentInput"),
      gainInput: document.getElementById("gainInput"),
      addedInput: document.getElementById("addedInput"),
      monthInput: document.getElementById("monthInput"),
      refreshButton: document.getElementById("refreshButton"),
      syncButton: document.getElementById("syncButton"),
      recalculateButton: document.getElementById("recalculateButton"),
      recalculateLocalButton: document.getElementById("recalculateLocalButton"),
      clearCacheButton: document.getElementById("clearCacheButton"),
      recordsBody: document.getElementById("recordsBody"),
      emptyState: document.getElementById("emptyState"),
      summaryCurrent: document.getElementById("summaryCurrent"),
      summaryGain: document.getElementById("summaryGain"),
      summaryPercent: document.getElementById("summaryPercent"),
      summaryAdded: document.getElementById("summaryAdded"),
      summaryCount: document.getElementById("summaryCount"),
      summaryPositiveAdded: document.getElementById("summaryPositiveAdded"),
      summaryNegativeAdded: document.getElementById("summaryNegativeAdded"),
      summaryFilteredGain: document.getElementById("summaryFilteredGain"),
      summaryDailyAvg: document.getElementById("summaryDailyAvg"),
      summaryBestDay: document.getElementById("summaryBestDay"),
      summaryWorstDay: document.getElementById("summaryWorstDay"),
      summaryMonthlyPercent: document.getElementById("summaryMonthlyPercent"),
      gainByDayChart: document.getElementById("gainByDayChart"),
      percentByDayChart: document.getElementById("percentByDayChart"),
      balanceEvolutionChart: document.getElementById("balanceEvolutionChart"),
      cumulativeGainChart: document.getElementById("cumulativeGainChart"),
      capitalByMonthChart: document.getElementById("capitalByMonthChart"),
      monthlyGainChart: document.getElementById("monthlyGainChart"),
      dayDistributionChart: document.getElementById("dayDistributionChart"),
      gainByMonthBody: document.getElementById("gainByMonthBody"),
      addedByMonthBody: document.getElementById("addedByMonthBody"),
      percentByMonthBody: document.getElementById("percentByMonthBody"),
      toggleAuditButton: document.getElementById("toggleAuditButton"),
      auditPanel: document.getElementById("auditPanel"),
      auditBody: document.getElementById("auditBody"),
      mobileColumnsToggle: document.getElementById("mobileColumnsToggle"),
      mobileColumnsPanel: document.getElementById("mobileColumnsPanel"),
      mobileColumnsClose: document.getElementById("mobileColumnsClose"),
      chartModal: document.getElementById("chartModal"),
      chartModalTitle: document.getElementById("chartModalTitle"),
      chartModalBody: document.getElementById("chartModalBody"),
      chartModalClose: document.getElementById("chartModalClose"),
      chartZoomIn: document.getElementById("chartZoomIn"),
      chartZoomOut: document.getElementById("chartZoomOut"),
      chartZoomReset: document.getElementById("chartZoomReset"),
      chartZoomLabel: document.getElementById("chartZoomLabel")
    };

    setDefaultDateTime();
    bindEvents();
    cache.records = recalculateRecords(cache.records);
    saveCache();
    updateLiveForm(true);
    render();
    refreshFromServer({ silent: true });
    syncQueue(false);
  }

  function bindEvents() {
    els.form.addEventListener("submit", handleSubmit);
    els.dateInput.addEventListener("change", function () { updateLiveForm(false); });
    els.timeInput.addEventListener("input", function () { updateLiveForm(false); });
    els.currentInput.addEventListener("input", function () {
      currentInputTouched = true;
      updateLiveForm(false);
    });
    els.addedInput.addEventListener("input", function () { updateLiveForm(false); });
    els.refreshButton.addEventListener("click", function () { refreshFromServer({ silent: false }); });
    els.syncButton.addEventListener("click", function () { syncQueue(true); });
    els.recalculateButton.addEventListener("click", recalculateFromServer);
    els.recalculateLocalButton.addEventListener("click", recalculateLocalCache);
    els.clearCacheButton.addEventListener("click", clearLocalCache);
    els.toggleAuditButton.addEventListener("click", function () {
      els.auditPanel.classList.toggle("is-hidden");
    });
    document.addEventListener("click", function (event) {
      var expandButton = event.target.closest("[data-chart-expand]");
      if (expandButton) {
        openChartModal(expandButton.getAttribute("data-chart-expand"));
      }
    });
    els.chartModalClose.addEventListener("click", closeChartModal);
    els.chartZoomIn.addEventListener("click", function () { setChartZoom(0.25); });
    els.chartZoomOut.addEventListener("click", function () { setChartZoom(-0.25); });
    els.chartZoomReset.addEventListener("click", resetChartZoom);
    els.chartModal.addEventListener("click", function (event) {
      if (event.target.hasAttribute("data-close-chart-modal")) closeChartModal();
    });
    document.addEventListener("keydown", function (event) {
      if (event.key === "Escape") closeChartModal();
    });
    els.recordsBody.addEventListener("click", function (event) {
      var button = event.target.closest("[data-delete-id]");
      if (button) deleteRecord(button.getAttribute("data-delete-id"));
    });
    bindMobileUiEvents();
    bindDesktopNavigation();
  }

  function bindDesktopNavigation() {
    document.querySelectorAll("[data-view-target]").forEach(function (button) {
      button.addEventListener("click", function () {
        setDesktopView(button.getAttribute("data-view-target"));
      });
    });
  }

  function setDesktopView(viewName) {
    if (!viewName) return;

    document.querySelectorAll("[data-view-target]").forEach(function (button) {
      button.classList.toggle("is-active", button.getAttribute("data-view-target") === viewName);
    });

    document.querySelectorAll("[data-desktop-view]").forEach(function (view) {
      view.classList.toggle("is-active", view.getAttribute("data-desktop-view") === viewName);
    });
  }

  function bindMobileUiEvents() {
    if (els.mobileNewRecordToggle && els.newRecordPanel) {
      els.mobileNewRecordToggle.addEventListener("click", function () {
        els.newRecordPanel.classList.toggle("is-mobile-open");
      });
    }

    if (els.mobileColumnsToggle && els.mobileColumnsPanel) {
      els.mobileColumnsToggle.addEventListener("click", openMobileColumnsPanel);
    }

    if (els.mobileColumnsClose) {
      els.mobileColumnsClose.addEventListener("click", closeMobileColumnsPanel);
    }

    document.querySelectorAll("[data-mobile-column]").forEach(function (checkbox) {
      checkbox.addEventListener("change", applyMobileColumnVisibility);
    });
  }

  function isMobileViewport() {
    return window.matchMedia("(max-width: 680px)").matches;
  }

  function closeMobileRecordPanelAfterSubmit() {
    if (isMobileViewport() && els.newRecordPanel) {
      els.newRecordPanel.classList.remove("is-mobile-open");
    }
  }

  function openMobileColumnsPanel() {
    if (els.mobileColumnsPanel) {
      els.mobileColumnsPanel.classList.add("is-open");
    }
  }

  function closeMobileColumnsPanel() {
    if (els.mobileColumnsPanel) {
      els.mobileColumnsPanel.classList.remove("is-open");
    }
  }

  function applyMobileColumnVisibility() {
    document.querySelectorAll("[data-mobile-column]").forEach(function (checkbox) {
      var column = checkbox.getAttribute("data-mobile-column");
      var visible = checkbox.checked;
      document.querySelectorAll(
        ".table-panel table th:nth-child(" + column + "), .table-panel table td:nth-child(" + column + ")"
      ).forEach(function (cell) {
        cell.classList.toggle("mobile-col-hidden", !visible);
      });
    });
  }

  function handleSubmit(event) {
    event.preventDefault();

    var current = parseNumber(els.currentInput.value);
    if (!Number.isFinite(current)) {
      showMessage("Ingresa un valor valido en Cuanto tengo hoy.", "error");
      return;
    }

    var fecha = normalizeDate(els.dateInput.value);
    var hora = normalizeTime(els.timeInput.value);
    if (!fecha || !hora) {
      showMessage("Completa fecha y hora.", "error");
      return;
    }

    var uniqueDateTime = ensureUniqueDateTime(fecha, hora);
    fecha = uniqueDateTime.date;
    hora = uniqueDateTime.time;
    if (uniqueDateTime.adjusted) {
      els.dateInput.value = fecha;
      els.timeInput.value = hora;
      showMessage("La hora ya existía. Se ajustó automáticamente un segundo para conservar el orden cronológico.", "info");
    }

    var addedText = els.addedInput.value.trim();
    var addedParsed = parseNumber(addedText);
    if (addedText && !Number.isFinite(addedParsed)) {
      showMessage("Ingresa un valor valido en Plata que Agregué.", "error");
      return;
    }

    var tempId = "TEMP-" + uuid();
    var payload = {};
    payload[FIELD.date] = fecha;
    payload[FIELD.time] = hora;
    payload[FIELD.current] = current;
    payload[FIELD.added] = addedText === "" ? null : addedParsed;

    var localRecord = Object.assign({}, payload);
    localRecord[FIELD.id] = tempId;
    localRecord._status = "pending";
    localRecord._tempId = tempId;

    cache.records.push(localRecord);
    cache.records = recalculateRecords(cache.records);
    cache.pendingQueue.push({
      opId: "OP-" + uuid(),
      type: "create",
      tempId: tempId,
      payload: payload,
      status: "pending",
      createdAt: new Date().toISOString()
    });

    saveCache();
    render();
    els.form.reset();
    currentInputTouched = false;
    setDefaultDateTime();
    updateLiveForm(true);
    closeMobileRecordPanelAfterSubmit();
    showMessage("Registro agregado localmente. Sincronizando en segundo plano.", "info");
    syncQueue(false);
  }

  function deleteRecord(id) {
    if (isTempId(id)) {
      cache.records = cache.records.filter(function (record) { return getRecordId(record) !== id; });
      cache.pendingQueue = cache.pendingQueue.filter(function (op) { return op.tempId !== id; });
    } else {
      cache.records = cache.records.filter(function (record) { return getRecordId(record) !== id; });
      cache.pendingQueue.push({
        opId: "OP-" + uuid(),
        type: "delete",
        id: id,
        status: "pending",
        createdAt: new Date().toISOString()
      });
    }

    cache.records = recalculateRecords(cache.records);
    saveCache();
    updateLiveForm(false);
    render();
    syncQueue(false);
  }

  function refreshFromServer(options) {
    var silent = options && options.silent;
    return jsonpRequest({ action: "list" })
      .then(function (response) {
        if (!response.ok) throw new Error(response.error || "No se pudo listar desde el servidor.");
        cache.serverOnline = true;
        cache.lastSyncAt = new Date().toISOString();
        mergeServerRecords(response.records || []);
        updateLiveForm(false);
        if (!silent) showMessage("Datos actualizados desde el servidor.", "info");
      })
      .catch(function (error) {
        cache.serverOnline = false;
        saveCache();
        render();
        if (!silent) showMessage(error.message, "error");
      });
  }

  function recalculateFromServer() {
    return jsonpRequest({ action: "recalculate" })
      .then(function (response) {
        if (!response.ok) throw new Error(response.error || "No se pudo recalcular.");
        cache.serverOnline = true;
        cache.lastSyncAt = new Date().toISOString();
        mergeServerRecords(response.records || []);
        updateLiveForm(false);
        showMessage("Recalculo completado.", "info");
      })
      .catch(function (error) {
        cache.serverOnline = false;
        saveCache();
        render();
        showMessage(error.message, "error");
      });
  }

  function recalculateLocalCache() {
    cache.records = recalculateRecords(cache.records);
    saveCache();
    updateLiveForm(false);
    render();
    showMessage("Cache local recalculado sin consultar el servidor.", "info");
  }

  function syncQueue(retryErrors) {
    if (syncRunning) return Promise.resolve();

    if (retryErrors) {
      cache.pendingQueue.forEach(function (op) {
        if (op.status === "error") op.status = "pending";
      });
      cache.records.forEach(function (record) {
        if (record._status === "error") record._status = "pending";
      });
      saveCache();
      render();
    }

    if (!cache.pendingQueue.some(function (op) { return op.status === "pending"; })) {
      render();
      return Promise.resolve();
    }

    syncRunning = true;
    return processQueue().finally(function () {
      syncRunning = false;
      saveCache();
      render();
    });
  }

  function processQueue() {
    var op = cache.pendingQueue.find(function (item) { return item.status === "pending"; });
    if (!op) return Promise.resolve();

    op.status = "syncing";
    syncRecordStatus(op, "syncing");
    saveCache();
    render();

    return sendOperation(op)
      .then(function (response) {
        if (!response.ok) throw new Error(response.error || "Fallo la sincronizacion.");
        cache.serverOnline = true;
        cache.lastSyncAt = new Date().toISOString();
        cache.pendingQueue = cache.pendingQueue.filter(function (item) { return item.opId !== op.opId; });
        mergeServerRecords(response.records || [], { skipRender: true });
        return processQueue();
      })
      .catch(function (error) {
        op.status = "error";
        op.error = error.message;
        cache.serverOnline = false;
        syncRecordStatus(op, "error", error.message);
        showMessage("Error de sincronizacion: " + error.message, "error");
        saveCache();
        render();
      });
  }

  function sendOperation(op) {
    if (op.type === "create") {
      return jsonpRequest({ action: "create", payload: JSON.stringify(op.payload) });
    }
    if (op.type === "delete") {
      return jsonpRequest({ action: "delete", id: op.id });
    }
    return Promise.reject(new Error("Operacion desconocida: " + op.type));
  }

  function syncRecordStatus(op, status, error) {
    if (op.type !== "create") return;
    cache.records.forEach(function (record) {
      if (record._tempId === op.tempId || getRecordId(record) === op.tempId) {
        record._status = status;
        if (error) record._error = error;
      }
    });
  }

  function mergeServerRecords(serverRecords, options) {
    var pendingCreates = cache.pendingQueue
      .filter(function (op) { return op.type === "create"; })
      .map(function (op) {
        var existing = cache.records.find(function (record) {
          return record._tempId === op.tempId || getRecordId(record) === op.tempId;
        });
        var record = Object.assign({}, existing || op.payload);
        record[FIELD.id] = op.tempId;
        record._tempId = op.tempId;
        record._status = op.status === "error" ? "error" : (op.status === "syncing" ? "syncing" : "pending");
        return record;
      });

    var pendingDeleteIds = cache.pendingQueue
      .filter(function (op) { return op.type === "delete"; })
      .map(function (op) { return op.id; });

    var official = serverRecords
      .map(normalizeServerRecord)
      .filter(function (record) { return pendingDeleteIds.indexOf(getRecordId(record)) === -1; });

    cache.records = recalculateRecords(official.concat(pendingCreates));
    saveCache();
    if (!options || !options.skipRender) render();
  }

  function recalculateRecords(records) {
    return buildLedger(records).rows.map(ledgerRowToRecord);
  }

  function updateLiveForm(forceInitialCurrent) {
    var fecha = normalizeDate(els.dateInput.value);
    var hora = normalizeTime(els.timeInput.value);
    var previous = findPreviousAmountForDateTime(fecha, hora);
    var added = toNumber(els.addedInput.value);

    els.previousInput.value = formatMoney(previous);
    els.monthInput.value = getMonth(fecha);

    if (forceInitialCurrent || !currentInputTouched) {
      els.currentInput.value = formatPlainNumber(previous);
    }

    var current = parseNumber(els.currentInput.value);
    var currentForCalc = Number.isFinite(current) ? current : previous;
    var base = previous + added;
    var gain = currentForCalc - base;
    var percent = base === 0 ? 0 : gain / base;

    els.gainInput.value = formatMoney(gain);
    els.percentInput.value = formatPercent(percent);
  }

  function findPreviousAmountForDateTime(fecha, hora) {
    var targetTs = getDateTimeValueFromParts(normalizeDate(fecha), normalizeTime(hora));
    var previous = null;
    buildLedger(cache.records).rows.forEach(function (row) {
      var rowTs = getDateTimeValueFromParts(row.date, row.time);
      if (rowTs >= targetTs) return;
      if (!previous || rowTs > getDateTimeValueFromParts(previous.date, previous.time)) previous = row;
    });
    return previous ? previous.currentBalance : 0;
  }

  function render() {
    var ledger = buildLedger(cache.records);
    renderStatus();
    renderSummary(ledger);
    renderReports(ledger);
    renderTable(ledger);
    renderAudit(ledger);
    renderLastSync();
  }

  function renderStatus() {
    var hasErrors = cache.pendingQueue.some(function (op) { return op.status === "error"; });
    var hasPending = cache.pendingQueue.length > 0;

    els.statusBanner.className = "status-banner";
    if (hasErrors) {
      els.statusBanner.classList.add("status-error");
      els.statusBanner.textContent = "Error de sincronizacion";
    } else if (hasPending) {
      els.statusBanner.classList.add("status-pending");
      els.statusBanner.textContent = cache.serverOnline ? "Cambios pendientes" : "Modo local / cambios pendientes";
    } else if (cache.serverOnline) {
      els.statusBanner.classList.add("status-online");
      els.statusBanner.textContent = "Online / sincronizado";
    } else {
      els.statusBanner.classList.add("status-pending");
      els.statusBanner.textContent = "Modo local";
    }
  }

  function renderSummary(ledger) {
    var summary = ledger.summary;

    els.summaryCurrent.textContent = formatMoney(summary.currentBalance);
    els.summaryGain.textContent = formatMoney(summary.lastPerformanceGain);
    els.summaryPercent.textContent = formatPercent(summary.lastPerformancePercent);
    els.summaryAdded.textContent = formatMoney(summary.netCapitalMovement);
    els.summaryCount.textContent = String(summary.recordCount);
    els.summaryPositiveAdded.textContent = formatMoney(summary.positiveCapitalMovement);
    els.summaryNegativeAdded.textContent = formatMoney(summary.negativeCapitalMovement);
    els.summaryFilteredGain.textContent = formatMoney(summary.totalPerformanceGain);
    els.summaryDailyAvg.textContent = formatMoney(summary.dailyPerformanceAverage);
    els.summaryBestDay.textContent = summary.bestDay ? formatDate(summary.bestDay.date) + " " + formatMoney(summary.bestDay.dailyGain) : "-";
    els.summaryWorstDay.textContent = summary.worstDay ? formatDate(summary.worstDay.date) + " " + formatMoney(summary.worstDay.dailyGain) : "-";
    els.summaryMonthlyPercent.textContent = formatPercent(summary.monthlyPercentAverage);
    setValueTone(els.summaryGain, summary.lastPerformanceGain);
    setValueTone(els.summaryFilteredGain, summary.totalPerformanceGain);
    setValueTone(els.summaryDailyAvg, summary.dailyPerformanceAverage);
    setValueTone(els.summaryAdded, summary.netCapitalMovement);
    setValueTone(els.summaryPositiveAdded, summary.positiveCapitalMovement);
    setValueTone(els.summaryNegativeAdded, summary.negativeCapitalMovement);
  }

  function renderReports(ledger) {
    renderBarChart(els.gainByDayChart, ledger.dailyPerformance, "gain", formatMoney, { title: "Ganancia por dia" });
    renderBarChart(els.percentByDayChart, ledger.dailyPercentPerformance, "percent", formatPercent, { title: "Porcentaje por dia" });
    renderLineChart(els.balanceEvolutionChart, getBalanceEvolutionData(ledger), {
      valueClass: "balance",
      formatter: formatMoney
    }, { title: "Evolución del valor actual" });
    renderLineChart(els.cumulativeGainChart, getCumulativeGainData(ledger), {
      valueClass: "cumulative",
      formatter: formatMoney
    }, { title: "Ganancia real acumulada" });
    renderGroupedBarChart(els.capitalByMonthChart, getMonthlyCapitalChartData(ledger), {
      formatter: formatMoney
    }, { title: "Movimiento de capital por mes" });
    renderBarChart(els.monthlyGainChart, getMonthlyGainChartData(ledger), "monthlyGain", formatMoney, { title: "Ganancia real por mes" });
    renderDistributionChart(els.dayDistributionChart, getDayDistributionData(ledger), {}, { title: "Balance de días" });
    renderGainByMonth(ledger.monthlyPerformance);
    renderAddedByMonth(ledger.monthlyCapital);
    renderPercentByMonth(ledger.monthlyPercentPerformance);
    if (!analyticsDebugLogged) {
      debugAnalytics(ledger);
      analyticsDebugLogged = true;
    }
  }

  function setValueTone(element, value) {
    var card = element.closest(".summary-card");
    if (!card) return;
    card.classList.remove("is-positive", "is-negative", "is-neutral");
    if (toNumber(value) > 0) {
      card.classList.add("is-positive");
    } else if (toNumber(value) < 0) {
      card.classList.add("is-negative");
    } else {
      card.classList.add("is-neutral");
    }
  }

  function openChartModal(chartType) {
    if (!els.chartModal) {
      console.error("No se encontró #chartModal para abrir el gráfico ampliado.");
      return;
    }
    if (!els.chartModalBody) {
      console.error("No se encontró #chartModalBody para renderizar el gráfico ampliado.");
      return;
    }
    activeModalChartType = chartType;
    activeModalZoom = 1;
    renderActiveModalChart();
    els.chartModal.classList.remove("is-hidden");
  }

  function closeChartModal() {
    if (!els.chartModal) return;
    els.chartModal.classList.add("is-hidden");
    els.chartModalBody.innerHTML = "";
    activeModalChartType = null;
    activeModalZoom = 1;
    updateChartZoomLabel();
  }

  function setChartZoom(delta) {
    if (!activeModalChartType) return;
    activeModalZoom = Math.max(1, Math.min(5, activeModalZoom + delta));
    renderActiveModalChart();
  }

  function resetChartZoom() {
    if (!activeModalChartType) return;
    activeModalZoom = 1;
    renderActiveModalChart();
  }

  function renderActiveModalChart() {
    if (!activeModalChartType) return;
    if (!els.chartModalBody) {
      console.error("No se encontró #chartModalBody para renderizar el gráfico ampliado.");
      return;
    }
    var ledger = buildLedger(cache.records);
    var modalChart = document.createElement("div");
    modalChart.className = "chart";
    els.chartModalBody.innerHTML = "";
    els.chartModalBody.appendChild(modalChart);
    updateChartZoomLabel();

    var config = getChartRenderConfig(activeModalChartType, ledger);
    els.chartModalTitle.textContent = config.title;
    config.render(modalChart, { expanded: true, zoom: activeModalZoom, title: config.title });
  }

  function updateChartZoomLabel() {
    if (els.chartZoomLabel) els.chartZoomLabel.textContent = "Zoom " + activeModalZoom.toFixed(2).replace(".00", ".0") + "x";
  }

  function getChartRenderConfig(chartType, ledger) {
    if (chartType === "percent") {
      return {
        title: "Porcentaje de incremento por dia",
        render: function (container, options) {
          renderBarChart(container, ledger.dailyPercentPerformance, "percent", formatPercent, options);
        }
      };
    }
    if (chartType === "balance") {
      return {
        title: "Evolución del valor actual",
        render: function (container, options) {
          renderLineChart(container, getBalanceEvolutionData(ledger), { valueClass: "balance", formatter: formatMoney }, options);
        }
      };
    }
    if (chartType === "cumulative") {
      return {
        title: "Ganancia real acumulada",
        render: function (container, options) {
          renderLineChart(container, getCumulativeGainData(ledger), { valueClass: "cumulative", formatter: formatMoney }, options);
        }
      };
    }
    if (chartType === "capital") {
      return {
        title: "Movimiento de capital por mes",
        render: function (container, options) {
          renderGroupedBarChart(container, getMonthlyCapitalChartData(ledger), { formatter: formatMoney }, options);
        }
      };
    }
    if (chartType === "monthlyGain") {
      return {
        title: "Ganancia real por mes",
        render: function (container, options) {
          renderBarChart(container, getMonthlyGainChartData(ledger), "monthlyGain", formatMoney, options);
        }
      };
    }
    if (chartType === "distribution") {
      return {
        title: "Balance de días",
        render: function (container, options) {
          renderDistributionChart(container, getDayDistributionData(ledger), {}, options);
        }
      };
    }
    return {
      title: "Ganancia por dia",
      render: function (container, options) {
        renderBarChart(container, ledger.dailyPerformance, "gain", formatMoney, options);
      }
    };
  }

  function buildLedger(records) {
    var sourceRows = records.map(function (record) {
      var normalized = normalizeLegacyFields(record);
      var date = normalizeDate(normalized[FIELD.date]);
      var time = normalizeTime(normalized[FIELD.time]);
      return {
        source: normalized,
        id: getRecordId(normalized),
        date: date,
        time: time,
        month: getMonth(date),
        currentBalance: toNumber(normalized[FIELD.current]),
        currentIsValid: Number.isFinite(parseNumber(normalized[FIELD.current])),
        capitalMovement: toNumber(normalized[FIELD.added]),
        status: normalized._status || "synced",
        tempId: normalized._tempId || "",
        timestamp: getDateTimeValueFromParts(date, time)
      };
    });

    sourceRows.sort(function (a, b) {
      var timeDiff = a.timestamp - b.timestamp;
      if (timeDiff !== 0) return timeDiff;
      return String(a.id).localeCompare(String(b.id));
    });

    var rows = sourceRows.map(function (row) {
      var previousRow = findPreviousLedgerSourceRow(sourceRows, row);
      var previousBalance = previousRow ? previousRow.currentBalance : 0;
      var expectedBalance = previousBalance + row.capitalMovement;
      var performanceGain = row.currentBalance - expectedBalance;
      var performancePercent = expectedBalance === 0 ? 0 : performanceGain / expectedBalance;
      var hasPrevious = Boolean(previousRow);

      return {
        id: row.id,
        date: row.date,
        time: row.time,
        month: row.month,
        previousBalance: round2(previousBalance),
        capitalMovement: round2(row.capitalMovement),
        expectedBalance: round2(expectedBalance),
        currentBalance: round2(row.currentBalance),
        currentIsValid: row.currentIsValid,
        performanceGain: round2(performanceGain),
        performancePercent: performancePercent,
        hasPrevious: hasPrevious,
        isBaseline: !hasPrevious,
        status: row.status,
        tempId: row.tempId,
        source: row.source,
        includedInAnalytics: false
      };
    });

    var validPerformanceRows = rows.filter(isValidLedgerPerformanceRow);
    validPerformanceRows.forEach(function (row) {
      row.includedInAnalytics = true;
    });

    var dailyPerformance = buildDailyPerformance(validPerformanceRows);
    var dailyPercentPerformance = buildDailyPercentPerformance(validPerformanceRows);
    var monthlyPerformance = buildMonthlyPerformance(validPerformanceRows);
    var monthlyPercentPerformance = buildMonthlyPercentPerformance(validPerformanceRows);
    var monthlyCapital = buildMonthlyCapital(rows);
    var summary = buildLedgerSummary(rows, validPerformanceRows, dailyPerformance, monthlyPercentPerformance);

    return {
      rows: rows,
      validPerformanceRows: validPerformanceRows,
      dailyPerformance: dailyPerformance,
      dailyPercentPerformance: dailyPercentPerformance,
      monthlyPerformance: monthlyPerformance,
      monthlyPercentPerformance: monthlyPercentPerformance,
      monthlyCapital: monthlyCapital,
      summary: summary
    };
  }

  function ledgerRowToRecord(row) {
    var record = Object.assign({}, row.source || {});
    record[FIELD.id] = row.id;
    record[FIELD.date] = row.date;
    record[FIELD.time] = row.time;
    record[FIELD.previous] = row.previousBalance;
    record[FIELD.percent] = row.performancePercent;
    record[FIELD.current] = row.currentBalance;
    record[FIELD.gain] = row.performanceGain;
    record[FIELD.added] = isBlankValue(record[FIELD.added]) ? record[FIELD.added] : row.capitalMovement;
    record[FIELD.month] = row.month;
    record._status = row.status;
    record._hasPrevious = row.hasPrevious;
    record._isBaseline = row.isBaseline;
    record._expectedBalance = row.expectedBalance;
    if (row.tempId) record._tempId = row.tempId;
    return record;
  }

  function findPreviousLedgerSourceRow(rows, currentRow) {
    var previous = null;
    rows.forEach(function (candidate) {
      if (candidate === currentRow) return;
      if (candidate.timestamp >= currentRow.timestamp) return;
      if (!previous || candidate.timestamp > previous.timestamp) previous = candidate;
    });
    return previous;
  }

  function isValidLedgerPerformanceRow(row) {
    return row.hasPrevious
      && !row.isBaseline
      && isValidLedgerDateTime(row)
      && Number.isFinite(row.performanceGain)
      && row.performanceGain < ANALYTICS_GAIN_LIMIT
      && row.currentIsValid;
  }

  function isValidLedgerDateTime(row) {
    return Boolean(row.date) && Boolean(row.time) && getDateTimeValueFromParts(row.date, row.time) > 0;
  }

  function buildDailyPerformance(rows) {
    var map = {};
    rows.forEach(function (row) {
      if (!map[row.date]) map[row.date] = { date: row.date, dailyGain: 0, value: 0, count: 0 };
      map[row.date].dailyGain += row.performanceGain;
      map[row.date].value += row.performanceGain;
      map[row.date].count += 1;
    });
    return sortByDate(Object.keys(map).map(function (key) {
      map[key].dailyGain = round2(map[key].dailyGain);
      map[key].value = round2(map[key].value);
      return map[key];
    }));
  }

  function buildDailyPercentPerformance(rows) {
    var map = {};
    rows.filter(function (row) { return row.expectedBalance !== 0; }).forEach(function (row) {
      if (!map[row.date]) map[row.date] = { date: row.date, percentSum: 0, count: 0, value: 0 };
      map[row.date].percentSum += row.performancePercent;
      map[row.date].count += 1;
      map[row.date].value = map[row.date].percentSum / map[row.date].count;
    });
    return sortByDate(Object.keys(map).map(function (key) { return map[key]; }));
  }

  function buildMonthlyPerformance(rows) {
    var map = {};
    rows.forEach(function (row) {
      if (!map[row.month]) map[row.month] = { month: row.month, gain: 0, count: 0 };
      map[row.month].gain += row.performanceGain;
      map[row.month].count += 1;
    });
    return sortByMonth(Object.keys(map).map(function (key) {
      map[key].gain = round2(map[key].gain);
      return map[key];
    }));
  }

  function buildMonthlyPercentPerformance(rows) {
    var map = {};
    rows.filter(function (row) { return row.expectedBalance !== 0; }).forEach(function (row) {
      if (!map[row.month]) map[row.month] = { month: row.month, percentSum: 0, count: 0, average: 0 };
      map[row.month].percentSum += row.performancePercent;
      map[row.month].count += 1;
      map[row.month].average = map[row.month].percentSum / map[row.month].count;
    });
    return sortByMonth(Object.keys(map).map(function (key) { return map[key]; }));
  }

  function buildMonthlyCapital(rows) {
    var map = {};
    rows.forEach(function (row) {
      if (!isValidLedgerDateTime(row)) return;
      if (!map[row.month]) map[row.month] = { month: row.month, positive: 0, negative: 0, total: 0 };
      if (row.capitalMovement > 0) map[row.month].positive += row.capitalMovement;
      if (row.capitalMovement < 0) map[row.month].negative += row.capitalMovement;
      map[row.month].total += row.capitalMovement;
    });
    return sortByMonth(Object.keys(map).map(function (key) {
      map[key].positive = round2(map[key].positive);
      map[key].negative = round2(map[key].negative);
      map[key].total = round2(map[key].total);
      return map[key];
    }));
  }

  function buildLedgerSummary(rows, validPerformanceRows, dailyPerformance, monthlyPercentPerformance) {
    var lastRow = rows.length ? rows[rows.length - 1] : null;
    var lastPerformanceRow = rows.slice().reverse().find(function (row) { return row.hasPrevious; });
    var netCapitalMovement = rows.reduce(function (sum, row) { return sum + row.capitalMovement; }, 0);
    var positiveCapitalMovement = rows.reduce(function (sum, row) {
      return row.capitalMovement > 0 ? sum + row.capitalMovement : sum;
    }, 0);
    var negativeCapitalMovement = rows.reduce(function (sum, row) {
      return row.capitalMovement < 0 ? sum + row.capitalMovement : sum;
    }, 0);
    var totalPerformanceGain = validPerformanceRows.reduce(function (sum, row) {
      return sum + row.performanceGain;
    }, 0);
    var bestDay = dailyPerformance.length ? dailyPerformance.reduce(function (best, item) {
      return item.dailyGain > best.dailyGain ? item : best;
    }, dailyPerformance[0]) : null;
    var worstDay = dailyPerformance.length ? dailyPerformance.reduce(function (worst, item) {
      return item.dailyGain < worst.dailyGain ? item : worst;
    }, dailyPerformance[0]) : null;
    var monthlyPercentAverage = monthlyPercentPerformance.length
      ? monthlyPercentPerformance.reduce(function (sum, item) { return sum + item.average; }, 0) / monthlyPercentPerformance.length
      : 0;

    return {
      currentBalance: lastRow ? lastRow.currentBalance : 0,
      lastPerformanceGain: lastPerformanceRow ? lastPerformanceRow.performanceGain : 0,
      lastPerformancePercent: lastPerformanceRow ? lastPerformanceRow.performancePercent : 0,
      netCapitalMovement: round2(netCapitalMovement),
      positiveCapitalMovement: round2(positiveCapitalMovement),
      negativeCapitalMovement: round2(negativeCapitalMovement),
      recordCount: rows.length,
      totalPerformanceGain: round2(totalPerformanceGain),
      dailyPerformanceAverage: dailyPerformance.length ? round2(totalPerformanceGain / dailyPerformance.length) : 0,
      bestDay: bestDay,
      worstDay: worstDay,
      monthlyPercentAverage: monthlyPercentAverage
    };
  }

  function debugAnalytics(ledger) {
    console.log("Auditoría de cálculo - Auditor de Inversión");
    console.table(ledger.rows.map(auditRowForDisplay));
  }

  function getBalanceEvolutionData(ledger) {
    return ledger.rows.map(function (row) {
      return {
        date: row.date,
        label: formatDate(row.date) + " " + normalizeTime(row.time),
        value: row.currentBalance
      };
    });
  }

  function getCumulativeGainData(ledger) {
    var acc = 0;
    return ledger.validPerformanceRows.map(function (row) {
      acc += row.performanceGain;
      return {
        date: row.date,
        label: formatDate(row.date) + " " + normalizeTime(row.time),
        value: round2(acc)
      };
    });
  }

  function getMonthlyCapitalChartData(ledger) {
    return ledger.monthlyCapital.map(function (row) {
      return {
        month: row.month,
        label: row.month,
        positive: row.positive,
        negative: row.negative,
        total: row.total
      };
    });
  }

  function getMonthlyGainChartData(ledger) {
    return ledger.monthlyPerformance.map(function (row) {
      return {
        date: monthToSortableDate(row.month),
        label: row.month,
        value: row.gain
      };
    });
  }

  function getDayDistributionData(ledger) {
    var positive = 0;
    var negative = 0;
    var neutral = 0;
    ledger.dailyPerformance.forEach(function (row) {
      if (row.dailyGain > 0) positive += 1;
      else if (row.dailyGain < 0) negative += 1;
      else neutral += 1;
    });
    return [
      { label: "Positivos", value: positive, className: "distribution-positive" },
      { label: "Negativos", value: negative, className: "distribution-negative" },
      { label: "Neutros", value: neutral, className: "distribution-neutral" }
    ];
  }

  function renderBarChart(container, data, type, formatter, options) {
    options = options || {};
    container.innerHTML = "";
    if (!data.length) {
      container.textContent = "Sin datos.";
      return;
    }

    var expanded = Boolean(options.expanded);
    var zoom = options.zoom || 1;
    var width = Math.max(expanded ? 900 : 540, data.length * (expanded ? 84 : 72) * zoom);
    var height = expanded ? 540 : 360;
    var padding = expanded
      ? { top: 48, right: 34, bottom: 70, left: 78 }
      : { top: 38, right: 24, bottom: 62, left: 64 };
    var values = data.map(function (item) { return item.value; });
    var minValue = Math.min(0, Math.min.apply(null, values));
    var maxValue = Math.max(0, Math.max.apply(null, values));
    if (minValue === maxValue) maxValue = minValue + 1;
    var plotHeight = height - padding.top - padding.bottom;
    var zeroY = scaleValue(0, minValue, maxValue, padding.top, plotHeight);
    var barWidth = Math.min(expanded ? 64 : 42, Math.max(expanded ? 24 : 18, (width - padding.left - padding.right) / data.length * 0.54));

    var svg = createSvg("svg");
    svg.setAttribute("viewBox", "0 0 " + width + " " + height);
    svg.setAttribute("role", "img");
    svg.style.width = width + "px";
    svg.style.maxWidth = "none";

    var defs = createSvg("defs");
    defs.appendChild(createBarGradient("barPositiveGradient", "#12b957", "#7df55b"));
    defs.appendChild(createBarGradient("barNegativeGradient", "#e93268", "#ff8eb0"));
    defs.appendChild(createBarGradient("barPercentGradient", "#7167ff", "#00b7ff"));
    svg.appendChild(defs);

    var gridLines = expanded ? 5 : 4;
    for (var gridIndex = 0; gridIndex <= gridLines; gridIndex++) {
      var gridValue = minValue + (maxValue - minValue) * (gridIndex / gridLines);
      var gridY = scaleValue(gridValue, minValue, maxValue, padding.top, plotHeight);
      var grid = createSvg("line");
      grid.setAttribute("x1", padding.left);
      grid.setAttribute("x2", width - padding.right);
      grid.setAttribute("y1", gridY);
      grid.setAttribute("y2", gridY);
      grid.setAttribute("class", "chart-grid");
      svg.appendChild(grid);
    }

    var axis = createSvg("line");
    axis.setAttribute("x1", padding.left);
    axis.setAttribute("x2", width - padding.right);
    axis.setAttribute("y1", zeroY);
    axis.setAttribute("y2", zeroY);
    axis.setAttribute("class", "chart-axis");
    svg.appendChild(axis);

    data.forEach(function (item, index) {
      var slot = (width - padding.left - padding.right) / data.length;
      var x = padding.left + index * slot + (slot - barWidth) / 2;
      var y = scaleValue(item.value, minValue, maxValue, padding.top, plotHeight);
      var rectY = Math.min(y, zeroY);
      var rectHeight = Math.max(2, Math.abs(zeroY - y));

      var rect = createSvg("rect");
      rect.setAttribute("x", x);
      rect.setAttribute("y", rectY);
      rect.setAttribute("width", barWidth);
      rect.setAttribute("height", rectHeight);
      rect.setAttribute("rx", expanded ? 8 : 6);
      rect.setAttribute("class", getChartBarClass(type, item.value));
      var title = createSvg("title");
      title.textContent = (item.label || formatDate(item.date)) + ": " + formatter(item.value);
      rect.appendChild(title);
      svg.appendChild(rect);

      var label = createSvg("text");
      label.setAttribute("x", x + barWidth / 2);
      label.setAttribute("y", height - (expanded ? 24 : 20));
      label.setAttribute("text-anchor", "middle");
      label.setAttribute("class", "chart-label");
      label.textContent = item.label || shortDate(item.date);
      svg.appendChild(label);

      if (data.length <= (expanded ? Math.floor(12 * zoom) : 9)) {
        var valueLabel = createSvg("text");
        valueLabel.setAttribute("x", x + barWidth / 2);
        valueLabel.setAttribute("y", rectY - 9 < 16 ? rectY + rectHeight + 18 : rectY - 9);
        valueLabel.setAttribute("text-anchor", "middle");
        valueLabel.setAttribute("class", "chart-value");
        valueLabel.textContent = type === "percent" ? formatter(item.value) : compactMoney(item.value);
        svg.appendChild(valueLabel);
      }
    });

    container.appendChild(svg);
  }

  function createBarGradient(id, startColor, endColor) {
    var gradient = createSvg("linearGradient");
    gradient.setAttribute("id", id);
    gradient.setAttribute("x1", "0");
    gradient.setAttribute("x2", "0");
    gradient.setAttribute("y1", "0");
    gradient.setAttribute("y2", "1");

    var start = createSvg("stop");
    start.setAttribute("offset", "0%");
    start.setAttribute("stop-color", startColor);
    var end = createSvg("stop");
    end.setAttribute("offset", "100%");
    end.setAttribute("stop-color", endColor);
    gradient.appendChild(start);
    gradient.appendChild(end);
    return gradient;
  }

  function getChartBarClass(type, value) {
    if (value < 0) return "chart-bar negative";
    if (type === "percent") return "chart-bar percent";
    if (type === "monthlyGain") return "chart-bar monthly-positive";
    return "chart-bar";
  }

  function renderLineChart(container, data, config, options) {
    options = options || {};
    config = config || {};
    container.innerHTML = "";
    if (!data.length) {
      container.textContent = "Sin datos.";
      return;
    }

    var expanded = Boolean(options.expanded);
    var zoom = options.zoom || 1;
    var width = Math.max(expanded ? 900 : 540, data.length * (expanded ? 86 : 68) * zoom);
    var height = expanded ? 540 : 360;
    var padding = expanded
      ? { top: 42, right: 38, bottom: 72, left: 86 }
      : { top: 34, right: 28, bottom: 62, left: 72 };
    var values = data.map(function (item) { return item.value; });
    var minValue = Math.min.apply(null, values);
    var maxValue = Math.max.apply(null, values);
    if (minValue === maxValue) {
      minValue -= 1;
      maxValue += 1;
    }
    var plotHeight = height - padding.top - padding.bottom;
    var plotWidth = width - padding.left - padding.right;
    var svg = createSvg("svg");
    svg.setAttribute("viewBox", "0 0 " + width + " " + height);
    svg.style.width = width + "px";
    svg.style.maxWidth = "none";

    appendChartGrid(svg, padding, width, minValue, maxValue, plotHeight, expanded ? 5 : 4);

    var points = data.map(function (item, index) {
      var x = padding.left + (data.length === 1 ? plotWidth / 2 : index * (plotWidth / (data.length - 1)));
      var y = scaleValue(item.value, minValue, maxValue, padding.top, plotHeight);
      return { x: x, y: y, item: item };
    });

    var area = createSvg("path");
    area.setAttribute("class", "chart-area " + (config.valueClass || ""));
    area.setAttribute("d", buildAreaPath(points, height - padding.bottom));
    svg.appendChild(area);

    var line = createSvg("polyline");
    line.setAttribute("class", "chart-line " + (config.valueClass || ""));
    line.setAttribute("points", points.map(function (point) { return point.x + "," + point.y; }).join(" "));
    svg.appendChild(line);

    points.forEach(function (point, index) {
      var circle = createSvg("circle");
      circle.setAttribute("cx", point.x);
      circle.setAttribute("cy", point.y);
      circle.setAttribute("r", expanded && zoom > 1.5 ? 4.5 : 3.5);
      circle.setAttribute("class", "chart-point " + (point.item.value < 0 ? "negative" : ""));
      var title = createSvg("title");
      title.textContent = (point.item.label || formatDate(point.item.date)) + ": " + (config.formatter || formatMoney)(point.item.value);
      circle.appendChild(title);
      svg.appendChild(circle);

      if (data.length <= (expanded ? Math.floor(10 * zoom) : 7)) {
        var label = createSvg("text");
        label.setAttribute("x", point.x);
        label.setAttribute("y", height - 22);
        label.setAttribute("text-anchor", "middle");
        label.setAttribute("class", "chart-label");
        label.textContent = point.item.label ? point.item.label.split(" ")[0] : shortDate(point.item.date);
        svg.appendChild(label);
      }
    });

    container.appendChild(svg);
  }

  function renderGroupedBarChart(container, data, config, options) {
    options = options || {};
    config = config || {};
    container.innerHTML = "";
    if (!data.length) {
      container.textContent = "Sin datos.";
      return;
    }

    var expanded = Boolean(options.expanded);
    var zoom = options.zoom || 1;
    var width = Math.max(expanded ? 900 : 540, data.length * (expanded ? 112 : 86) * zoom);
    var height = expanded ? 540 : 360;
    var padding = expanded
      ? { top: 44, right: 36, bottom: 78, left: 84 }
      : { top: 36, right: 26, bottom: 64, left: 70 };
    var values = [];
    data.forEach(function (item) {
      values.push(item.positive || 0, item.negative || 0);
    });
    var minValue = Math.min(0, Math.min.apply(null, values));
    var maxValue = Math.max(0, Math.max.apply(null, values));
    if (minValue === maxValue) maxValue = minValue + 1;
    var plotHeight = height - padding.top - padding.bottom;
    var zeroY = scaleValue(0, minValue, maxValue, padding.top, plotHeight);
    var slot = (width - padding.left - padding.right) / data.length;
    var barWidth = Math.min(34, Math.max(16, slot * 0.22));

    var svg = createSvg("svg");
    svg.setAttribute("viewBox", "0 0 " + width + " " + height);
    svg.style.width = width + "px";
    svg.style.maxWidth = "none";
    appendChartDefs(svg);
    appendChartGrid(svg, padding, width, minValue, maxValue, plotHeight, expanded ? 5 : 4);
    appendZeroAxis(svg, padding, width, zeroY);

    data.forEach(function (item, index) {
      var center = padding.left + index * slot + slot / 2;
      appendCapitalBar(svg, center - barWidth - 3, barWidth, item.positive || 0, zeroY, minValue, maxValue, padding, plotHeight, "chart-bar capital-positive", config.formatter);
      appendCapitalBar(svg, center + 3, barWidth, item.negative || 0, zeroY, minValue, maxValue, padding, plotHeight, "chart-bar capital-negative", config.formatter);

      var label = createSvg("text");
      label.setAttribute("x", center);
      label.setAttribute("y", height - 22);
      label.setAttribute("text-anchor", "middle");
      label.setAttribute("class", "chart-label");
      label.textContent = item.label || item.month;
      svg.appendChild(label);
    });

    container.appendChild(svg);
  }

  function renderDistributionChart(container, data, config, options) {
    options = options || {};
    container.innerHTML = "";
    var total = data.reduce(function (sum, item) { return sum + item.value; }, 0);
    if (!total) {
      container.textContent = "Sin datos.";
      return;
    }
    var expanded = Boolean(options.expanded);
    var zoom = options.zoom || 1;
    var width = Math.max(expanded ? 900 : 540, 540 * zoom);
    var height = expanded ? 420 : 320;
    var padding = { top: 54, right: 38, bottom: 54, left: 160 };
    var barArea = width - padding.left - padding.right;
    var rowHeight = expanded ? 76 : 58;
    var svg = createSvg("svg");
    svg.setAttribute("viewBox", "0 0 " + width + " " + height);
    svg.style.width = width + "px";
    svg.style.maxWidth = "none";

    data.forEach(function (item, index) {
      var y = padding.top + index * rowHeight;
      var barWidth = total ? barArea * (item.value / total) : 0;
      var label = createSvg("text");
      label.setAttribute("x", padding.left - 16);
      label.setAttribute("y", y + 22);
      label.setAttribute("text-anchor", "end");
      label.setAttribute("class", "chart-label distribution-label");
      label.textContent = item.label;
      svg.appendChild(label);

      var rect = createSvg("rect");
      rect.setAttribute("x", padding.left);
      rect.setAttribute("y", y);
      rect.setAttribute("width", Math.max(2, barWidth));
      rect.setAttribute("height", 28);
      rect.setAttribute("rx", 10);
      rect.setAttribute("class", "distribution-bar " + item.className);
      svg.appendChild(rect);

      var value = createSvg("text");
      value.setAttribute("x", padding.left + barWidth + 12);
      value.setAttribute("y", y + 20);
      value.setAttribute("class", "chart-value");
      value.textContent = item.value + " días";
      svg.appendChild(value);
    });

    container.appendChild(svg);
  }

  function appendChartDefs(svg) {
    var defs = createSvg("defs");
    defs.appendChild(createBarGradient("barPositiveGradient", "#12b957", "#7df55b"));
    defs.appendChild(createBarGradient("barNegativeGradient", "#e93268", "#ff8eb0"));
    defs.appendChild(createBarGradient("barPercentGradient", "#7167ff", "#00b7ff"));
    defs.appendChild(createBarGradient("barAmberGradient", "#ffb300", "#ffd95e"));
    svg.appendChild(defs);
  }

  function appendChartGrid(svg, padding, width, minValue, maxValue, plotHeight, gridLines) {
    for (var gridIndex = 0; gridIndex <= gridLines; gridIndex++) {
      var gridValue = minValue + (maxValue - minValue) * (gridIndex / gridLines);
      var gridY = scaleValue(gridValue, minValue, maxValue, padding.top, plotHeight);
      var grid = createSvg("line");
      grid.setAttribute("x1", padding.left);
      grid.setAttribute("x2", width - padding.right);
      grid.setAttribute("y1", gridY);
      grid.setAttribute("y2", gridY);
      grid.setAttribute("class", "chart-grid");
      svg.appendChild(grid);
    }
  }

  function appendZeroAxis(svg, padding, width, zeroY) {
    var axis = createSvg("line");
    axis.setAttribute("x1", padding.left);
    axis.setAttribute("x2", width - padding.right);
    axis.setAttribute("y1", zeroY);
    axis.setAttribute("y2", zeroY);
    axis.setAttribute("class", "chart-axis");
    svg.appendChild(axis);
  }

  function appendCapitalBar(svg, x, width, value, zeroY, minValue, maxValue, padding, plotHeight, className, formatter) {
    var y = scaleValue(value, minValue, maxValue, padding.top, plotHeight);
    var rectY = Math.min(y, zeroY);
    var rectHeight = Math.max(2, Math.abs(zeroY - y));
    var rect = createSvg("rect");
    rect.setAttribute("x", x);
    rect.setAttribute("y", rectY);
    rect.setAttribute("width", width);
    rect.setAttribute("height", rectHeight);
    rect.setAttribute("rx", 7);
    rect.setAttribute("class", className);
    var title = createSvg("title");
    title.textContent = formatter ? formatter(value) : String(value);
    rect.appendChild(title);
    svg.appendChild(rect);
  }

  function buildAreaPath(points, baselineY) {
    if (!points.length) return "";
    var path = "M " + points[0].x + " " + baselineY + " L " + points[0].x + " " + points[0].y;
    points.slice(1).forEach(function (point) {
      path += " L " + point.x + " " + point.y;
    });
    path += " L " + points[points.length - 1].x + " " + baselineY + " Z";
    return path;
  }

  function scaleValue(value, minValue, maxValue, top, plotHeight) {
    return top + (maxValue - value) / (maxValue - minValue) * plotHeight;
  }

  function renderGainByMonth(rows) {
    renderRows(els.gainByMonthBody, rows, function (row) {
      return [row.month, formatMoney(row.gain), String(row.count), formatMoney(row.count ? row.gain / row.count : 0)];
    }, 4);
  }

  function renderAddedByMonth(rows) {
    renderRows(els.addedByMonthBody, rows, function (row) {
      return [row.month, formatMoney(row.positive), formatMoney(row.negative), formatMoney(row.total)];
    }, 4);
  }

  function renderPercentByMonth(rows) {
    renderRows(els.percentByMonthBody, rows, function (row) {
      return [row.month, formatPercent(row.average), String(row.count)];
    }, 3);
  }

  function renderRows(tbody, rows, mapper, colCount) {
    tbody.innerHTML = "";
    if (!rows.length) {
      var empty = document.createElement("tr");
      var td = document.createElement("td");
      td.colSpan = colCount;
      td.textContent = "Sin datos.";
      empty.appendChild(td);
      tbody.appendChild(empty);
      return;
    }
    rows.forEach(function (row) {
      var tr = document.createElement("tr");
      mapper(row).forEach(function (text) { tr.appendChild(cellText(text)); });
      tbody.appendChild(tr);
    });
  }

  function renderAudit(ledger) {
    els.auditBody.innerHTML = "";
    if (!ledger.rows.length) {
      var empty = document.createElement("tr");
      var td = document.createElement("td");
      td.colSpan = 11;
      td.textContent = "Sin datos.";
      empty.appendChild(td);
      els.auditBody.appendChild(empty);
      return;
    }

    ledger.rows.forEach(function (row) {
      var audit = auditRowForDisplay(row);
      var tr = document.createElement("tr");
      [
        audit.ID,
        formatDate(audit.Fecha),
        audit.Hora,
        formatMoney(audit.Previous),
        formatMoney(audit["Movimiento capital"]),
        formatMoney(audit["Base esperada"]),
        formatMoney(audit.Actual),
        formatMoney(audit["Ganancia real"]),
        formatPercent(audit["%"]),
        audit.Baseline ? "Si" : "No",
        audit["Incluido en reportes"] ? "Si" : "No"
      ].forEach(function (text) {
        tr.appendChild(cellText(text));
      });
      els.auditBody.appendChild(tr);
    });
  }

  function auditRowForDisplay(row) {
    return {
      ID: row.id,
      Fecha: row.date,
      Hora: row.time,
      Previous: row.previousBalance,
      "Movimiento capital": row.capitalMovement,
      "Base esperada": row.expectedBalance,
      Actual: row.currentBalance,
      "Ganancia real": row.performanceGain,
      "%": row.performancePercent,
      Baseline: row.isBaseline,
      "Incluido en reportes": row.includedInAnalytics
    };
  }

  function renderTable(ledger) {
    els.recordsBody.innerHTML = "";
    els.emptyState.classList.toggle("is-hidden", ledger.rows.length > 0);

    ledger.rows.slice().reverse().forEach(function (row) {
      var tr = document.createElement("tr");
      var status = row.status || "synced";
      if (status === "pending" || status === "syncing") tr.classList.add("pending");
      if (status === "error") tr.classList.add("error");

      tr.appendChild(cell(statusPill(status)));
      tr.appendChild(cellText(row.id));
      tr.appendChild(cellText(formatDate(row.date)));
      tr.appendChild(cellText(normalizeTime(row.time)));
      tr.appendChild(cellText(formatMoney(row.previousBalance)));
      tr.appendChild(cellText(formatMoney(row.capitalMovement)));
      tr.appendChild(cellText(formatMoney(row.currentBalance)));
      tr.appendChild(cellText(formatMoney(row.performanceGain)));
      tr.appendChild(cellText(formatPercent(row.performancePercent)));
      tr.appendChild(cellText(row.month || ""));

      var deleteButton = document.createElement("button");
      deleteButton.type = "button";
      deleteButton.className = "delete-row-button";
      deleteButton.textContent = "Borrar";
      deleteButton.setAttribute("data-delete-id", row.id);
      tr.appendChild(cell(deleteButton));

      els.recordsBody.appendChild(tr);
    });

    applyMobileColumnVisibility();
  }

  function renderLastSync() {
    els.lastSyncText.textContent = cache.lastSyncAt
      ? "Ultima sincronizacion: " + new Date(cache.lastSyncAt).toLocaleString("es-AR")
      : "Sin sincronizaciones todavia";
  }

  function statusPill(status) {
    var span = document.createElement("span");
    span.className = "state-pill";
    if (status === "error") {
      span.classList.add("state-error");
      span.textContent = "Error";
    } else if (status === "syncing") {
      span.classList.add("state-pending");
      span.textContent = "Sincronizando";
    } else if (status === "pending") {
      span.classList.add("state-pending");
      span.textContent = "Pendiente";
    } else {
      span.classList.add("state-synced");
      span.textContent = "Sincronizado";
    }
    return span;
  }

  function cell(child) {
    var td = document.createElement("td");
    td.appendChild(child);
    return td;
  }

  function cellText(text) {
    var td = document.createElement("td");
    td.textContent = text;
    return td;
  }

  function showMessage(text, type) {
    var div = document.createElement("div");
    div.className = "message " + (type || "info");
    div.textContent = text;
    els.messageArea.prepend(div);
    setTimeout(function () { div.remove(); }, 7000);
  }

  function clearLocalCache() {
    if (!window.confirm("Seguro que queres limpiar el cache local? Se perderan cambios pendientes no sincronizados.")) return;
    localStorage.removeItem(CACHE_KEY);
    cache = loadCache();
    cache.records = recalculateRecords(cache.records);
    saveCache();
    currentInputTouched = false;
    setDefaultDateTime();
    updateLiveForm(true);
    render();
    showMessage("Cache local limpiado.", "info");
  }

  function jsonpRequest(params) {
    return new Promise(function (resolve, reject) {
      var callbackName = "__auditorJsonp_" + Date.now() + "_" + Math.random().toString(36).slice(2);
      var script = document.createElement("script");
      var done = false;
      var timeoutId;
      params = Object.assign({}, params, { callback: callbackName });

      window[callbackName] = function (payload) {
        cleanup();
        resolve(payload);
      };

      function cleanup() {
        if (done) return;
        done = true;
        window.clearTimeout(timeoutId);
        delete window[callbackName];
        if (script.parentNode) script.parentNode.removeChild(script);
      }

      timeoutId = window.setTimeout(function () {
        cleanup();
        reject(new Error("Timeout consultando Google Apps Script."));
      }, JSONP_TIMEOUT_MS);

      script.onerror = function () {
        cleanup();
        reject(new Error("No se pudo contactar el Web App."));
      };

      script.src = WEB_APP_URL + "?" + toQueryString(params);
      document.head.appendChild(script);
    });
  }

  function toQueryString(params) {
    return Object.keys(params)
      .filter(function (key) { return params[key] !== undefined && params[key] !== null; })
      .map(function (key) { return encodeURIComponent(key) + "=" + encodeURIComponent(params[key]); })
      .join("&");
  }

  function loadCache() {
    try {
      var raw = localStorage.getItem(CACHE_KEY);
      if (!raw) return cloneDefaultCache();
      var parsed = JSON.parse(raw);
      return Object.assign(cloneDefaultCache(), parsed, {
        records: Array.isArray(parsed.records) ? parsed.records : [],
        pendingQueue: Array.isArray(parsed.pendingQueue) ? parsed.pendingQueue : []
      });
    } catch (error) {
      console.log("Error leyendo cache", error);
      return cloneDefaultCache();
    }
  }

  function saveCache() {
    localStorage.setItem(CACHE_KEY, JSON.stringify(cache));
  }

  function cloneDefaultCache() {
    return Object.assign({}, defaultCache, { records: [], pendingQueue: [] });
  }

  function normalizeServerRecord(record) {
    var normalized = normalizeLegacyFields(record);
    normalized[FIELD.date] = normalizeDate(normalized[FIELD.date]);
    normalized[FIELD.time] = normalizeTime(normalized[FIELD.time]);
    normalized[FIELD.previous] = toNumber(normalized[FIELD.previous]);
    normalized[FIELD.percent] = toNumber(normalized[FIELD.percent]);
    normalized[FIELD.current] = toNumber(normalized[FIELD.current]);
    normalized[FIELD.gain] = toNumber(normalized[FIELD.gain]);
    if (normalized[FIELD.added] !== "" && normalized[FIELD.added] !== null && normalized[FIELD.added] !== undefined) {
      normalized[FIELD.added] = toNumber(normalized[FIELD.added]);
    }
    normalized._status = "synced";
    return normalized;
  }

  function normalizeLegacyFields(record) {
    var normalized = Object.assign({}, record);
    Object.keys(LEGACY_FIELD_ALIASES).forEach(function (legacyKey) {
      var currentKey = LEGACY_FIELD_ALIASES[legacyKey];
      if (normalized[currentKey] === undefined && normalized[legacyKey] !== undefined) {
        normalized[currentKey] = normalized[legacyKey];
      }
      delete normalized[legacyKey];
    });
    return normalized;
  }

  function getRecordId(record) {
    return String(record[FIELD.id] || record._tempId || "");
  }

  function isTempId(id) {
    return String(id).indexOf("TEMP-") === 0;
  }

  function getDateTimeValue(record) {
    var date = normalizeDate(record[FIELD.date]);
    var time = normalizeTime(record[FIELD.time] || "00:00:00");
    return getDateTimeValueFromParts(date, time);
  }

  function getDateTimeValueFromParts(date, time) {
    var parsed = new Date(date + "T" + time);
    var value = parsed.getTime();
    return Number.isFinite(value) ? value : 0;
  }

  function ensureUniqueDateTime(date, time) {
    var used = {};
    cache.records.forEach(function (record) {
      var key = normalizeDate(record[FIELD.date]) + "T" + normalizeTime(record[FIELD.time]);
      used[key] = true;
    });

    var adjustedDate = normalizeDate(date);
    var adjustedTime = normalizeTime(time);
    var adjusted = false;
    var next = new Date(adjustedDate + "T" + adjustedTime);

    while (used[adjustedDate + "T" + adjustedTime]) {
      next = new Date(next.getTime() + 1000);
      adjustedDate = toInputDate(next);
      adjustedTime = toInputTime(next);
      adjusted = true;
    }

    return { date: adjustedDate, time: adjustedTime, adjusted: adjusted };
  }

  function setDefaultDateTime() {
    var now = new Date();
    els.dateInput.value = toInputDate(now);
    els.timeInput.value = toInputTime(now);
  }

  function toInputDate(date) {
    return [date.getFullYear(), pad2(date.getMonth() + 1), pad2(date.getDate())].join("-");
  }

  function toInputTime(date) {
    return [pad2(date.getHours()), pad2(date.getMinutes()), pad2(date.getSeconds())].join(":");
  }

  function normalizeDate(value) {
    var text = String(value || "").trim();
    if (/^\d{4}-\d{2}-\d{2}$/.test(text)) return text;
    var match = text.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
    if (match) return match[3] + "-" + pad2(match[2]) + "-" + pad2(match[1]);
    return text;
  }

  function normalizeTime(value) {
    var parts = String(value || "00:00:00").split(":");
    return [parts[0] || "00", parts[1] || "00", parts[2] || "00"].map(function (part) {
      return pad2(Number(part) || 0);
    }).join(":");
  }

  function getMonth(dateValue) {
    var parts = normalizeDate(dateValue).split("-");
    if (parts.length < 3) return "";
    return parts[1] + "/" + parts[0];
  }

  function formatDate(dateValue) {
    var parts = normalizeDate(dateValue).split("-");
    if (parts.length < 3) return String(dateValue || "");
    return parts[2] + "/" + parts[1] + "/" + parts[0];
  }

  function shortDate(dateValue) {
    var parts = normalizeDate(dateValue).split("-");
    if (parts.length < 3) return String(dateValue || "");
    return parts[2] + "/" + parts[1];
  }

  function formatMoney(value) {
    return "$ " + formatPlainNumber(value);
  }

  function compactMoney(value) {
    var number = toNumber(value);
    if (Math.abs(number) >= 1000000) return "$ " + (number / 1000000).toLocaleString("es-AR", { maximumFractionDigits: 1 }) + " M";
    if (Math.abs(number) >= 1000) return "$ " + (number / 1000).toLocaleString("es-AR", { maximumFractionDigits: 0 }) + " k";
    return formatMoney(number);
  }

  function formatPlainNumber(value) {
    return toNumber(value).toLocaleString("es-AR", {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2
    });
  }

  function formatPercent(value) {
    return (toNumber(value) * 100).toLocaleString("es-AR", {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2
    }) + "%";
  }

  function parseNumber(value) {
    if (typeof value === "number") return value;
    var text = String(value === null || value === undefined ? "" : value).trim();
    if (!text) return NaN;
    text = text.replace(/\s/g, "").replace(/\$/g, "");
    if (text.indexOf(",") >= 0) text = text.replace(/\./g, "").replace(",", ".");
    return Number(text);
  }

  function isBlankValue(value) {
    return value === null || value === undefined || String(value).trim() === "";
  }

  function toNumber(value) {
    var parsed = parseNumber(value);
    return Number.isFinite(parsed) ? parsed : 0;
  }

  function round2(value) {
    return Math.round((Number(value) || 0) * 100) / 100;
  }

  function pad2(value) {
    return String(value).padStart(2, "0");
  }

  function sortByDate(rows) {
    return rows.sort(function (a, b) { return String(a.date).localeCompare(String(b.date)); });
  }

  function sortByMonth(rows) {
    return rows.sort(function (a, b) {
      return monthSortValue(a.month) - monthSortValue(b.month);
    });
  }

  function monthSortValue(month) {
    var parts = String(month || "").split("/");
    return parts.length === 2 ? Number(parts[1]) * 100 + Number(parts[0]) : 0;
  }

  function monthToSortableDate(month) {
    var parts = String(month || "").split("/");
    if (parts.length !== 2) return "";
    return parts[1] + "-" + pad2(parts[0]) + "-01";
  }

  function createSvg(tag) {
    return document.createElementNS("http://www.w3.org/2000/svg", tag);
  }

  function uuid() {
    if (window.crypto && window.crypto.randomUUID) return window.crypto.randomUUID();
    return Math.random().toString(36).slice(2) + Date.now().toString(36);
  }
})();
