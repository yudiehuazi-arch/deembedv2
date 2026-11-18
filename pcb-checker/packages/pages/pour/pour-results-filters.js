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
    if (typeof root.applyFilters === 'function') root.applyFilters();
  }

  root.setResultStatusFilter = setResultStatusFilter;
  root.setCategoryFilter = setCategoryFilter;
})(typeof window !== 'undefined' ? window : globalThis);
