/* ============================================================================
 * pour-results-filters.js —— 铜皮结果判定状态与五类检查的组合筛选控件
 * ========================================================================== */
(function (root) {
  'use strict';
  if (typeof document === 'undefined') return;

  function refreshFilterButtons(buttons, activeKey) {
    Object.keys(buttons).forEach(function (key) {
      var button = document.getElementById(buttons[key]);
      if (button) button.className = 'btn small ' + (key === activeKey ? 'pri' : 'sec');
    });
  }

  function setResultStatusFilter(statusKey) {
    var State = root.State;
    State.resultStatusFilter = ['defects', 'pass'].indexOf(statusKey) >= 0 ? statusKey : 'all';
    refreshFilterButtons({ all: 'btnFilterAll', defects: 'btnFilterDefects', pass: 'btnFilterPass' }, State.resultStatusFilter);
    if (typeof root.applyFilters === 'function') root.applyFilters();
  }

  function setCategoryFilter(categoryKey) {
    if (categoryKey === 'defects' || categoryKey === 'pass') {
      setResultStatusFilter(categoryKey);
      return;
    }
    var State = root.State;
    var buttons = {
      all: 'btnFilterCategoryAll',
      via_coverage: 'btnFilterCov',
      special_shape: 'btnFilterSpecial',
      trace_ref_margin: 'btnFilterMargin',
      isolated_copper: 'btnFilterSmall',
      arc_radius: 'btnFilterArc'
    };
    State.categoryFilter = buttons[categoryKey] ? categoryKey : 'all';
    refreshFilterButtons(buttons, State.categoryFilter);
    var targetHeader = document.getElementById('lblResultTargetHeader');
    if (targetHeader) targetHeader.textContent = State.categoryFilter === 'special_shape'
      ? 'Padstack / 网络 / 差分孔中心距 / 目标对象' : 'Padstack / 网络 / 目标对象';
    if (typeof root.applyFilters === 'function') root.applyFilters();
  }

  var ANALYSIS_CATEGORIES = {
    via_coverage: { buttonId: 'btnAnalysisCov', countId: 'cntAnalysisCov', label: '孔经过层铺铜覆盖检查' },
    special_shape: { buttonId: 'btnAnalysisSpecial', countId: 'cntAnalysisSpecial', label: '特定异型铜皮比对检查' },
    trace_ref_margin: { buttonId: 'btnAnalysisMargin', countId: 'cntAnalysisMargin', label: '走线参考层投影覆盖与两侧邻近铜' },
    isolated_copper: { buttonId: 'btnAnalysisSmall', countId: 'cntAnalysisSmall', label: '孤立小铜皮检查' },
    arc_radius: { buttonId: 'btnAnalysisArc', countId: 'cntAnalysisArc', label: '铜皮最小圆弧半径检查' }
  };

  function analysisDefectCounts() {
    var counts = { via_coverage: 0, special_shape: 0, trace_ref_margin: 0, isolated_copper: 0, arc_radius: 0 };
    ((root.State && root.State.rawResults) || []).forEach(function (record) {
      if (!record || record.pass || !Object.prototype.hasOwnProperty.call(counts, record.checkCategory)) return;
      counts[record.checkCategory]++;
    });
    return counts;
  }

  function syncAnalysisCategoryButtons() {
    var State = root.State;
    if (!State) return;
    var selected = ANALYSIS_CATEGORIES[State.analysisCategoryFilter] ? State.analysisCategoryFilter : 'via_coverage';
    State.analysisCategoryFilter = selected;
    var counts = analysisDefectCounts();
    Object.keys(ANALYSIS_CATEGORIES).forEach(function (key) {
      var config = ANALYSIS_CATEGORIES[key];
      var button = document.getElementById(config.buttonId);
      var count = document.getElementById(config.countId);
      if (button) {
        button.classList.toggle('active', key === selected);
        button.setAttribute('aria-pressed', key === selected ? 'true' : 'false');
      }
      if (count) count.textContent = String(counts[key] || 0);
    });
    var status = document.getElementById('lblAnalysisFilterStatus');
    if (status) status.textContent = '当前显示：' + ANALYSIS_CATEGORIES[selected].label;
  }

  function applyAnalysisCategoryVisibility(container) {
    var selected = root.State && root.State.analysisCategoryFilter || 'via_coverage';
    if (!container) return;
    container.querySelectorAll('[data-analysis-category]').forEach(function (card) {
      card.hidden = card.getAttribute('data-analysis-category') !== selected;
    });
  }

  function setAnalysisCategoryFilter(categoryKey) {
    var State = root.State;
    if (!State) return;
    State.analysisCategoryFilter = ANALYSIS_CATEGORIES[categoryKey] ? categoryKey : 'via_coverage';
    syncAnalysisCategoryButtons();
    if (typeof root.renderAnalysisTab === 'function') root.renderAnalysisTab();
  }

  root.setResultStatusFilter = setResultStatusFilter;
  root.setCategoryFilter = setCategoryFilter;
  root.setAnalysisCategoryFilter = setAnalysisCategoryFilter;
  root.syncAnalysisCategoryButtons = syncAnalysisCategoryButtons;
  root.applyAnalysisCategoryVisibility = applyAnalysisCategoryVisibility;
})(typeof window !== 'undefined' ? window : globalThis);
