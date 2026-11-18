/* ============================================================================
 * pour-results-column-filters.js —— 铜皮结果表头 Excel 风格列筛选
 * ========================================================================== */
(function (root) {
  'use strict';
  if (typeof document === 'undefined') return;

  var LABELS = {
    category: '检查分类', target: '目标对象', layer: '涉及层别',
    status: '判定', problem: '问题点', review: '复核状态'
  };
  var OPTION_KEYS = { category: true, layer: true, status: true, review: true };
  var activeKey = '';

  function filters() {
    var State = root.State;
    if (!State.resultColumnFilters) {
      State.resultColumnFilters = { category: [], target: '', layer: [], status: [], problem: '', review: [] };
    }
    return State.resultColumnFilters;
  }

  function itemKey(record, index) {
    return record.groupKey || record._rawKey ||
      (record.checkCategory + '_' + (record.viaId || record.traceId || record.shapeId) + '_' + record.layer + '_' + index);
  }

  function cellValue(record, key, index) {
    if (key === 'category') return String(record.checkCategoryName || '未分类');
    if (key === 'target') return root.formatPourResultTarget ? root.formatPourResultTarget(record) : String(record.targetLabel || '');
    if (key === 'layer') return String(record.layerListStr || record.layer || record.refLayer || '-');
    if (key === 'status') return record.pass ? '符合' : '不符合';
    if (key === 'problem') return root.formatPourResultProblem ? root.formatPourResultProblem(record) : String(record.message || '');
    if (key === 'review') return root.State.reviewedItems.has(itemKey(record, index)) ? '已复核' : '待复核';
    return '';
  }

  function isActive(key) {
    var value = filters()[key];
    return Array.isArray(value) ? value.length > 0 : !!String(value || '').trim();
  }

  function refreshResultColumnFilterButtons() {
    document.querySelectorAll('[data-result-column-filter]').forEach(function (button) {
      var key = button.getAttribute('data-result-column-filter');
      button.classList.toggle('active', isActive(key));
      button.setAttribute('aria-pressed', isActive(key) ? 'true' : 'false');
    });
  }

  function filterPourResultsByColumns(list) {
    var current = filters();
    var result = (list || []).filter(function (record, index) {
      return Object.keys(LABELS).every(function (key) {
        var selected = current[key];
        var value = cellValue(record, key, index);
        if (Array.isArray(selected)) return !selected.length || selected.indexOf(value) >= 0;
        var query = String(selected || '').trim().toLowerCase();
        return !query || value.toLowerCase().indexOf(query) >= 0;
      });
    });
    refreshResultColumnFilterButtons();
    return result;
  }

  function esc(value) {
    return String(value == null ? '' : value).replace(/&/g, '&amp;').replace(/</g, '&lt;')
      .replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  function sourceValues(key) {
    var State = root.State;
    var source = State.viewMode === 'grouped' ? (State.groupedResults || []) : (State.rawResults || []);
    return Array.from(new Set(source.map(function (record, index) { return cellValue(record, key, index); })))
      .sort(function (a, b) { return a.localeCompare(b, 'zh-CN', { numeric: true }); });
  }

  function menu() {
    var el = document.getElementById('pourColumnFilterMenu');
    if (el) return el;
    el = document.createElement('div');
    el.id = 'pourColumnFilterMenu';
    el.className = 'pour-column-filter-menu';
    el.hidden = true;
    document.body.appendChild(el);
    return el;
  }

  function closeResultColumnFilter() {
    var el = menu();
    el.hidden = true;
    activeKey = '';
  }

  function applyMenuValue() {
    var el = menu();
    if (!activeKey) return;
    if (OPTION_KEYS[activeKey]) {
      var values = Array.from(el.querySelectorAll('input[type="checkbox"]:checked')).map(function (input) { return input.value; });
      var allCount = el.querySelectorAll('input[type="checkbox"]').length;
      filters()[activeKey] = values.length === allCount ? [] : (values.length ? values : ['__NO_RESULT__']);
    } else {
      var input = el.querySelector('input[type="search"]');
      filters()[activeKey] = input ? input.value.trim() : '';
    }
    closeResultColumnFilter();
    if (typeof root.applyFilters === 'function') root.applyFilters();
  }

  function toggleResultColumnFilter(key, button) {
    if (!LABELS[key]) return;
    var el = menu();
    if (!el.hidden && activeKey === key) { closeResultColumnFilter(); return; }
    activeKey = key;
    var current = filters()[key];
    var body = '';
    if (OPTION_KEYS[key]) {
      var values = sourceValues(key);
      body = '<div class="pour-column-filter-actions">' +
        '<button type="button" data-filter-action="all">全选</button><button type="button" data-filter-action="none">清空</button></div>' +
        '<div class="pour-column-filter-options">' + values.map(function (value) {
          var checked = !current.length || current.indexOf(value) >= 0;
          return '<label><input type="checkbox" value="' + esc(value) + '" ' + (checked ? 'checked' : '') + ' data-no-persist><span>' + esc(value) + '</span></label>';
        }).join('') + '</div>';
    } else {
      body = '<input type="search" class="pour-column-filter-search" value="' + esc(current) +
        '" placeholder="输入关键词筛选" data-no-persist>';
    }
    el.innerHTML = '<div class="pour-column-filter-title">筛选：' + esc(LABELS[key]) + '</div>' + body +
      '<div class="pour-column-filter-footer"><button type="button" data-filter-action="reset">重置</button>' +
      '<button type="button" class="apply" data-filter-action="apply">应用</button></div>';
    el.hidden = false;
    var rect = button.getBoundingClientRect();
    el.style.left = Math.max(8, Math.min(rect.left, root.innerWidth - 270)) + 'px';
    el.style.top = (rect.bottom + 4) + 'px';
    var search = el.querySelector('input[type="search"]');
    if (search) { search.focus(); search.select(); }
  }

  function setResultColumnFilter(key, value) {
    if (!LABELS[key]) return;
    filters()[key] = OPTION_KEYS[key] ? (Array.isArray(value) ? value.slice() : []) : String(value || '');
    if (typeof root.applyFilters === 'function') root.applyFilters();
  }

  document.addEventListener('click', function (event) {
    var action = event.target && event.target.getAttribute('data-filter-action');
    if (action === 'all' || action === 'none') {
      menu().querySelectorAll('input[type="checkbox"]').forEach(function (input) { input.checked = action === 'all'; });
    } else if (action === 'reset') {
      filters()[activeKey] = OPTION_KEYS[activeKey] ? [] : '';
      closeResultColumnFilter();
      if (typeof root.applyFilters === 'function') root.applyFilters();
    } else if (action === 'apply') {
      applyMenuValue();
    } else if (!menu().hidden && !menu().contains(event.target) && !event.target.closest('[data-result-column-filter]')) {
      closeResultColumnFilter();
    }
  });
  document.addEventListener('keydown', function (event) {
    if (event.key === 'Escape') closeResultColumnFilter();
    if (event.key === 'Enter' && !menu().hidden) applyMenuValue();
  });

  root.filterPourResultsByColumns = filterPourResultsByColumns;
  root.refreshResultColumnFilterButtons = refreshResultColumnFilterButtons;
  root.toggleResultColumnFilter = toggleResultColumnFilter;
  root.closeResultColumnFilter = closeResultColumnFilter;
  root.setResultColumnFilter = setResultColumnFilter;
})(typeof window !== 'undefined' ? window : globalThis);
