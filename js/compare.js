// Compare panel rendering and tooltips

const metricTooltip = (() => {
  const el = document.createElement('div');
  el.className = 'info-tooltip';
  el.style.position = 'fixed';
  el.style.pointerEvents = 'none';
  el.style.zIndex = '9999';
  el.style.display = 'none';
  document.body.appendChild(el);
  let activeBtn = null;
  let tooltipHover = false;
  el.addEventListener('mouseenter', () => { tooltipHover = true; });
  el.addEventListener('mouseleave', () => { tooltipHover = false; clearActive(); });
  const show = (html, rect) => {
    el.innerHTML = html;
    el.style.display = 'block';
    el.style.pointerEvents = 'auto';
    const padding = 10;
    const x = Math.min(window.innerWidth - 220, Math.max(padding, rect.left));
    const y = Math.max(padding, rect.bottom + 6);
    el.style.left = `${x}px`;
    el.style.top = `${y}px`;
  };
  const hide = (force = false) => {
    if (!force && activeBtn) return;
    el.style.display = 'none';
    el.style.pointerEvents = 'none';
  };
  const setActive = (btn, html, rect) => {
    activeBtn?.classList?.remove('active');
    activeBtn = btn;
    activeBtn?.classList?.add('active');
    show(html, rect);
  };
  const clearActive = () => {
    if (activeBtn) activeBtn._metricPinned = false;
    activeBtn?.classList?.remove('active');
    activeBtn = null;
    hide(true);
  };
  const isActive = btn => activeBtn === btn;
  const hasActive = () => !!activeBtn;
  const isTooltipHovered = () => tooltipHover;
  return { el, show, hide, setActive, clearActive, isActive, hasActive, isTooltipHovered };
})();

let infoOutsideHooked = false;

renderCompare = function renderCompare(openPanel = false, opts = {}) {
  const { resetSort = false } = opts;
  const panel = document.getElementById('detailPanel');
  const body = document.getElementById('detail-body');
  if (!panel || !body) return;
  if (detailHideTimer) {
    clearTimeout(detailHideTimer);
    detailHideTimer = null;
  }
  const preserveScroll = panel.classList.contains('open');
  const prevScroll = preserveScroll ? panel.scrollTop : 0;
  // keep comparePins in sync with selectedCountries
  comparePins.length = 0;
  selectedCountries.forEach(id => comparePins.push(id));
  if (resetSort) resetCompareSort();
  if (!comparePins.length) {
    body.innerHTML = 'Click countries to add them to the comparison table.';
    hideDetail();
    return;
  }

  const rows = comparePins.map(id => {
    const name = countryNames[id] || id;
    const f = factors[id] || {};
    const ref = flows.find(x => x.dest_iso3 === id) || {};
    return { id, name, f, ref };
  });

  const getSortValue = (row, key) => {
    switch (key) {
      case 'country':       return row.name || row.id;
      case 'gdp_pc':        return row.f.gdp_pc;
      case 'unemployment':  return row.f.unemployment;
      case 'alloc_pct_gdp': return row.f.alloc_pct_gdp;
      case 'mipex':         return row.f.mipex;
      case 'opinion':       return row.f.opinion;
      case 'ua_pop_2021':   return row.f.ua_pop_2021;
      case 'total_refugees':return row.ref.total_refugees;
      default:              return row.name || row.id;
    }
  };

  const allowedSortKeys = new Set(['country', 'gdp_pc', 'unemployment', 'alloc_pct_gdp', 'mipex', 'opinion', 'ua_pop_2021', 'total_refugees']);
  if (!allowedSortKeys.has(compareSort.key)) {
    compareSort = { key: 'total_refugees', dir: 'desc' };
  }

  const sortDir = compareSort.dir === 'asc' ? 1 : -1;
  const sortedRows = rows.slice().sort((a, b) => {
    if (compareSort.key === 'country') {
      return (a.name || a.id).localeCompare(b.name || b.id) * sortDir;
    }
    const va = getSortValue(a, compareSort.key);
    const vb = getSortValue(b, compareSort.key);
    const na = Number.isFinite(+va) ? +va : -Infinity;
    const nb = Number.isFinite(+vb) ? +vb : -Infinity;
    if (na === nb) return (a.name || '').localeCompare(b.name || '') * sortDir;
    return na < nb ? -1 * sortDir : 1 * sortDir;
  });

  const columns = [
    {
      id: 'country',
      label: 'Country',
      align: 'left',
      render: row =>
        `<div class="compare-country">
          <div class="name">${row.name}</div>
          <div class="code">${row.id}</div>
        </div>`
    },
    {
      id: 'gdp_pc',
      label: 'GDP per capita',
      align: 'right',
      render: row => fmtNum(row.f.gdp_pc),
      color: metricColorFor('gdp_pc'),
      info: METRIC_INFO.gdp_pc
    },
    {
      id: 'unemployment',
      label: 'Unemployment rate',
      align: 'right',
      render: row => fmtPct(row.f.unemployment),
      color: metricColorFor('unemployment'),
      info: METRIC_INFO.unemployment
    },
    {
      id: 'alloc_pct_gdp',
      label: 'Support for Ukraine % GDP',
      align: 'right',
      render: row => fmtPct(row.f.alloc_pct_gdp),
      color: metricColorFor('alloc_pct_gdp'),
      info: METRIC_INFO.alloc_pct_gdp
    },
    {
      id: 'mipex',
      label: 'MIPEX score (0–100)',
      align: 'right',
      render: row => fmtNum(row.f.mipex),
      color: metricColorFor('mipex'),
      info: METRIC_INFO.mipex
    },
    {
      id: 'opinion',
      label: 'Public opinion on Ukrainian refugees',
      align: 'right',
      render: row => fmtPct(row.f.opinion),
      color: metricColorFor('opinion'),
      info: METRIC_INFO.opinion
    },
    {
      id: 'ua_pop_2021',
      label: 'Pre-war Ukrainian population (2021)',
      align: 'right',
      render: row => fmtNum(row.f.ua_pop_2021),
      color: metricColorFor('ua_pop_2021'),
      info: METRIC_INFO.ua_pop_2021
    },
    {
      id: 'total_refugees',
      label: 'Total refugees',
      align: 'right',
      render: row => formatCount(row.ref.total_refugees),
      color: '#cbd5e1',
      info: METRIC_INFO.total_refugees
    }
  ];

  const headerCells = columns.map(col => {
    const style = [];
    if (col.align) style.push(`text-align:${col.align}`);
    if (col.color) style.push(`color:${col.color}`);
    const isSortable = col.id !== 'country';
    const isActive = isSortable && compareSort.key === col.id;
    const indicator = isSortable
      ? `<span class="sort-indicator ${isActive ? 'active' : 'inactive'}">${isActive ? (compareSort.dir === 'asc' ? '▲' : '▼') : '⇅'}</span>`
      : '';
    const sortableClass = isSortable ? 'sortable' : '';
    const activeClass = isActive ? 'active-sort' : '';
    const ariaSort = isSortable
      ? (isActive ? (compareSort.dir === 'asc' ? 'ascending' : 'descending') : 'none')
      : 'none';
    const title = isSortable ? 'Click to sort' : '';
    const dataKeyAttr = isSortable ? `data-key="${col.id}"` : '';
    return `<th ${dataKeyAttr} class="${sortableClass} ${activeClass}" style="${style.join(';')}" aria-sort="${ariaSort}" title="${title}">${col.label}${indicator}</th>`;
  }).join('');

  const bodyRows = sortedRows.map(row => {
    const cells = columns.map(col => {
      if (col.id === 'country') {
        return `
          <td class="country-cell">
            <div class="compare-country">
              <div class="name">${row.name}</div>
            </div>
            <button class="compare-remove" data-id="${row.id}" aria-label="Remove ${row.name}">×</button>
          </td>
        `;
      }
      const val = typeof col.render === 'function' ? col.render(row) : '';
      const style = [];
      const color = typeof col.getColor === 'function' ? col.getColor(row) : col.color;
      if (col.align) style.push(`text-align:${col.align}`);
      if (color) style.push(`color:${color}`);
      return `<td style="${style.join(';')}">${val}</td>`;
    }).join('');
    return `<tr>${cells}</tr>`;
  }).join('');

  body.innerHTML = `
    <div class="compare-charts"></div>
    <div class="compare-table-wrapper">
      <div class="compare-hint">Click any metric header to sort</div>
      <table class="compare-table">
        <thead><tr>${headerCells}</tr></thead>
        <tbody>${bodyRows}</tbody>
      </table>
    </div>
  `;
  const needOpen = selectedCountries.size >= 2;
  const shouldOpen = openPanel || needOpen || panel.classList.contains('open');
  if (shouldOpen) {
    const wasOpen = panel.classList.contains('open');
    panel.style.display = 'block';
    if (!wasOpen) {
      panel.classList.remove('open');
      requestAnimationFrame(() => panel.classList.add('open'));
    } else {
      panel.classList.add('open');
    }
    panel.focus?.();
  } else {
    panel.classList.remove('open');
    // allow CSS transition to finish before hiding
    detailHideTimer = setTimeout(() => {
      panel.style.display = 'none';
      detailHideTimer = null;
    }, 1050);
  }
  if (preserveScroll) {
    requestAnimationFrame(() => {
      panel.scrollTop = prevScroll;
    });
  }

  function renderCharts() {
    const rootEl = body.querySelector('.compare-charts');
    if (!rootEl || typeof d3 === 'undefined') return;
    const root = d3.select(rootEl);
    root.selectAll('*').remove();

    const metricCols = columns.filter(c => c.id !== 'country');
    metricCols.sort((a, b) => (a.id === 'total_refugees' ? -1 : b.id === 'total_refugees' ? 1 : 0));
    const formatVal = (col, row) => {
      switch (col.id) {
        case 'gdp_pc': return fmtNum(row.f.gdp_pc);
        case 'unemployment': return fmtPct(row.f.unemployment);
        case 'alloc_pct_gdp': return fmtPct(row.f.alloc_pct_gdp);
        case 'mipex': return fmtNum(row.f.mipex);
        case 'opinion': return fmtPct(row.f.opinion);
        case 'ua_pop_2021': return fmtNum(row.f.ua_pop_2021);
        case 'total_refugees': return formatCount(row.ref.total_refugees);
        default: return '';
      }
    };

    metricCols.forEach(col => {
      const values = sortedRows.map(row => ({
        row,
        name: row.name || row.id,
        id: row.id,
        val: getSortValue(row, col.id)
      })).filter(d => Number.isFinite(+d.val));

      if (!values.length) return;

      const card = root.append('div').attr('class', 'chart-card');
      const title = card.append('div')
        .attr('class', 'chart-title chart-title-row')
        .html(() => {
          const info = col.info
            ? `<button type="button" class="info-icon" data-key="${col.id}" aria-label="About ${col.label}" data-title="${col.info.title || col.label}" data-body="${col.info.desc || ''}" data-source-label="${col.info.source?.label || ''}" data-source-href="${col.info.source?.href || ''}">i</button>`
            : '';
          const sortLabel = (() => {
            if (col.id === 'alloc_pct_gdp') return 'Sort by Support for Ukraine';
            if (col.id === 'opinion') return 'Sort by Public opinion';
            if (col.id === 'mipex') return 'Sort by MIPEX score';
            if (col.id === 'ua_pop_2021') return 'Sort by Pre-war population';
            return `Sort by ${col.label}`;
          })();
          const sortBtn = col.id !== 'country'
            ? `<button type="button" class="chart-sort-btn" data-key="${col.id}">${sortLabel}</button>`
            : '';
          return `
            <span class="chart-title-text"><span class="chart-title-label">${col.label}</span>${info}</span>
            <span class="chart-title-actions">
              ${sortBtn}
            </span>`;
        });

      const marginBase = { t: 18, r: 32, b: 8, l: 60 };
      const ROWH = 30;
      const gap = 8;
      const barH = 18;
      const scale = Math.max(0.9, Math.min(1.4, uiScale));
      const margin = {
        t: Math.max(14 * scale, marginBase.t * scale * 0.85),
        r: Math.max(20 * scale, marginBase.r * scale * 0.9),
        b: Math.max(8 * scale, marginBase.b * scale * 0.85),
        l: Math.max(22 * scale, marginBase.l * scale * 0.9) // keep labels close to the bubble
      };
      const containerW = Math.max(320, Math.min((card.node()?.clientWidth || 400), 540));
      const usable = containerW * 0.86;
      const width = usable;
      const height = values.length * (barH + gap) + margin.t + margin.b - gap;

      const maxVal = d3.max(values, d => +d.val) || 1;
      const x = d3.scaleLinear()
        .domain([0, maxVal])
        .range([0, width - margin.l - margin.r]);

      const svg = card.append('svg')
        .attr('class', 'bar-chart')
        .attr('width', '100%')
        .attr('height', height)
        .attr('viewBox', `0 0 ${width} ${height}`);

      const g = svg.append('g').attr('transform', `translate(${margin.l},${margin.t})`);

      const colorFor = row =>
        (typeof col.getColor === 'function' ? col.getColor(row) : col.color) || '#38bdf8';

      g.selectAll('rect')
        .data(values)
        .enter()
        .append('rect')
        .attr('x', 0)
        .attr('y', (_, i) => i * (barH + gap))
        .attr('width', d => x(Math.max(0, +d.val)))
        .attr('height', barH)
        .attr('rx', 4)
        .attr('ry', 4)
        .attr('fill', d => colorFor(d.row));

      g.selectAll('text.name')
        .data(values)
        .enter()
        .append('text')
        .attr('class', 'bar-label')
        .attr('x', -6)
        .attr('y', (_, i) => i * (barH + gap) + barH * 0.7)
        .attr('text-anchor', 'end')
        .text(d => `${d.name}`);

      g.selectAll('text.val')
        .data(values)
        .enter()
        .append('text')
        .attr('class', 'bar-value')
        .attr('x', d => x(Math.max(0, +d.val)) + 4)
        .attr('y', (_, i) => i * (barH + gap) + barH * 0.7)
        .text(d => formatVal(col, d.row));
    });
  }

  renderCharts();

  body.querySelectorAll('.compare-table th.sortable').forEach(th => {
    th.addEventListener('click', () => {
      const key = th.dataset.key;
      if (!key || key === 'country') return;
      if (compareSort.key === key) {
        compareSort.dir = compareSort.dir === 'asc' ? 'desc' : 'asc';
      } else {
        compareSort = { key, dir: 'desc' };
      }
      renderCompare(panel.classList.contains('open'), { resetSort: false });
    });
  });

  const infoIcons = body.querySelectorAll('.info-icon');
  infoIcons.forEach(btn => {
    let hideTimer = null;
    btn._metricPinned = btn._metricPinned || false;
    const clearHideTimer = () => {
      if (hideTimer) {
        clearTimeout(hideTimer);
        hideTimer = null;
      }
    };
    const scheduleHide = () => {
      clearHideTimer();
      if (btn._metricPinned) return;
      hideTimer = setTimeout(() => {
        const hoveringIcon = btn.matches(':hover');
        const hoveringTip = metricTooltip.isTooltipHovered();
        if (hoveringIcon || hoveringTip) return;
        if (metricTooltip.isActive(btn)) metricTooltip.clearActive();
      }, 120);
    };
    const showTip = () => {
      const title = btn.dataset.title || '';
      const desc = btn.dataset.body || '';
      const srcLabel = btn.dataset.sourceLabel || '';
      const srcHref = btn.dataset.sourceHref || '';
      const sourceHtml = srcHref
        ? `<div class="info-source">Source: <a href="${srcHref}" target="_blank" rel="noopener">${srcLabel || srcHref}</a></div>`
        : '';
      const html = `
        <div class="info-title">${title}</div>
        <div class="info-desc">${desc}</div>
        ${sourceHtml}
      `;
      const rect = btn.getBoundingClientRect();
      metricTooltip.setActive(btn, html, rect);
      btn._metricPinned = false;
    };
    btn.addEventListener('mouseenter', e => {
      e.stopPropagation();
      if (metricTooltip.isActive(btn)) return;
      clearHideTimer();
      showTip();
    });
    btn.addEventListener('mouseleave', () => {
      scheduleHide();
    });
    btn.addEventListener('focus', () => {
      if (metricTooltip.isActive(btn)) return;
      clearHideTimer();
      showTip();
    });
    btn.addEventListener('blur', () => {
      scheduleHide();
    });
    btn.addEventListener('click', e => {
      e.stopPropagation();
      if (metricTooltip.isActive(btn)) {
        btn._metricPinned = false;
        metricTooltip.clearActive();
      } else {
        metricTooltip.clearActive();
        clearHideTimer();
        showTip();
        btn._metricPinned = true;
      }
    });
  });

  const chartSortBtns = body.querySelectorAll('.chart-sort-btn');
  chartSortBtns.forEach(btn => {
    btn.addEventListener('click', e => {
      e.stopPropagation();
      const key = btn.dataset.key;
      if (!key || key === 'country') return;
      if (compareSort.key === key) {
        compareSort.dir = compareSort.dir === 'asc' ? 'desc' : 'asc';
      } else {
        compareSort = { key, dir: 'desc' };
      }
      renderCompare(panel.classList.contains('open'), { resetSort: false });
    });
  });

  if (!infoOutsideHooked) {
    document.addEventListener('click', e => {
      if (!metricTooltip.hasActive()) return;
      const target = e.target;
      const insideTooltip = metricTooltip.el?.contains(target);
      const isIcon = target?.closest?.('.info-icon');
      if (!insideTooltip && !isIcon) metricTooltip.clearActive();
    });
    infoOutsideHooked = true;
  }
};
