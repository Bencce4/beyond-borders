(async function boot() {
  try { await ensureLibs(); }
  catch (e) {
    console.error('[boot] libs', e);
    window.bb.ready = true;
    return;
  }
  applyUiScale();

  // Map 
  const EUROPE_BOUNDS = L.latLngBounds([32, -20], [72, 70]);
  const computePadding = () => {
    const panelOpen = document.body.classList.contains('panel-open');
    const panelEl = document.getElementById('detailPanel');
    const panelW = panelOpen && panelEl ? panelEl.offsetWidth || 0 : 0;
    const rightPad = Math.max(60, panelW + (panelOpen ? 40 : 20));
    const actionsH = document.getElementById('country-actions')?.offsetHeight || 0;
    const legendEl = document.getElementById('demoLegend');
    const legendH = legendEl?.classList?.contains('show') ? legendEl.offsetHeight : 0;
    const bottomPad = Math.max(90, actionsH + legendH + 60);
    return {
      topLeft: [30, 20],
      bottomRight: [rightPad, bottomPad]
    };
  };
  const MIN_COMFORT_ZOOM = 3;
  refitForViewport = (animate = false) => {
    const pads = computePadding();
    map.fitBounds(EUROPE_BOUNDS, {
      paddingTopLeft: L.point(pads.topLeft[0], pads.topLeft[1]),
      paddingBottomRight: L.point(pads.bottomRight[0], pads.bottomRight[1]),
      animate
    });
    const desired = Math.min(MIN_COMFORT_ZOOM, map.getMaxZoom());
    if (map.getZoom() < desired) {
      map.setView(map.getCenter(), desired, { animate });
    }
  };
  const map = L.map('map', {
    zoomControl: true,
    attributionControl: false,
    minZoom: 3.75,
    maxZoom: 7.5,
    zoomSnap: 0.25,
    zoomDelta: 0.25,
    wheelPxPerZoomLevel: 45,
    wheelDebounceTime: 0,
    zoomAnimation: true,
    fadeAnimation: true,
    markerZoomAnimation: true,
    zoomAnimationThreshold: 12,
    maxBounds: EUROPE_BOUNDS,
    maxBoundsViscosity: 1.0
  });
  window.bb.map = map;
  map.fitBounds(EUROPE_BOUNDS, { animate: false });
  map.setView([52, 20], MIN_COMFORT_ZOOM, { animate: false });
  refitForViewport(false);

  // objects
  map.createPane('countries'); map.getPane('countries').style.zIndex = 420;
  map.createPane('labels');    map.getPane('labels').style.zIndex   = 460; // labels above borders
  map.createPane('arrows');    map.getPane('arrows').style.zIndex   = 440;
  map.createPane('selection'); map.getPane('selection').style.zIndex= 450;
  map.createPane('minis');     map.getPane('minis').style.zIndex    = 470; // minis above borders/selection/labels
  const arrowsGroup = L.layerGroup({ pane: 'arrows' }).addTo(map);
  const labelLayer  = L.layerGroup({ pane: 'labels' }).addTo(map);
  selectionLayer = L.layerGroup({ pane: 'selection' }).addTo(map);
  countryLayer  = null;
  countryNames = Object.create(null);
  countryFeatures = new Map();

  // D3 overlay for minis and arrows
  const svgMini = L.svg({ pane: 'minis', padding: 0.5, interactive: true }).addTo(map);
  const miniRoot = d3
    .select(svgMini._rootGroup || svgMini._container.querySelector('svg'))
    .append('g')
    .attr('class', 'mini-root leaflet-zoom-animated')
    .style('pointer-events', 'visiblePainted');
const miniTooltip = (() => {
  const el = document.createElement('div');
  el.className = 'mini-tooltip';
  el.style.position = 'fixed';
  el.style.pointerEvents = 'none';
  el.style.zIndex = '9999';
  el.style.display = 'none';
  document.body.appendChild(el);
  return el;
})();

  // Helpers 
  const FLOW_KEYS = {
    dest_iso3: ['dest_iso3', 'iso3', 'ISO3', 'country_code', 'code'],
    lat:       ['lat', 'latitude'],
    lon:       ['lon', 'lng', 'longitude'],
    tot:       ['total_refugees', 'refugees', 'count', 'n']
  };
  const COLOR_KEYS = {
    kids:        ['pct_children', 'children_pct'],
    women_adult: ['pct_women_adult'],
    men_adult:   ['pct_men_adult'],
    old:         ['pct_elderly', 'elderly_pct']
  };

  const gf = (o, a, d = 0) => {
    for (const k of a) {
      const v = o?.[k];
      if (v !== '' && v != null && Number.isFinite(+v)) return +v;
    }
    return d;
  };

  const gs = (o, a) => {
    for (const k of a) {
      const v = o?.[k];
      if (v !== '' && v != null) return String(v);
    }
    return '';
  };

  const cleanKeys = obj => {
    const out = {};
    Object.entries(obj || {}).forEach(([k, v]) => { out[String(k).trim()] = v; });
    return out;
  };

  function blankFactor() {
    return {
      gdp_pc: NaN,
      unemployment: NaN,
      ua_perm_delta: NaN,
      ua_perm_per_refugee: NaN,
      alloc_pct_gdp: NaN,
      mipex: NaN,
      opinion: NaN,
      ua_pop_2021: NaN,
      women: NaN,
      children: NaN,
      men: NaN,
      elderly: NaN
    };
  }

  function ensureFactor(id) {
    if (!factors[id]) factors[id] = blankFactor();
    return factors[id];
  }

  const iso = p =>
    String(
      p?.ISO_A3 ||
      p?.ADM0_A3 ||
      p?.iso_a3 ||
      p?.WB_A3 ||
      p?.ISO3 ||
      ''
    ).toUpperCase();

  const nm = p =>
    p?.NAME_EN ||
    p?.NAME_LONG ||
    p?.ADMIN ||
    p?.NAME ||
    p?.BRK_NAME ||
    iso(p) ||
    '—';

  // Only draw these countries
  const ALLOWED_ISO3 = new Set([
    'AUT','BEL','BGR','HRV','CYP','CZE','DEU','DNK','EST','ESP','FIN','FRA',
    'GRC','HUN','IRL','ITA','LTU','LUX','LVA','MLT','NLD','POL','PRT','ROU',
    'SVK','SVN','SWE'
  ]);

  const NAME_TO_ISO3 = {
    'austria':'AUT','belgium':'BEL','bulgaria':'BGR','croatia':'HRV','cyprus':'CYP',
    'czechia':'CZE','denmark':'DNK','estonia':'EST','finland':'FIN','france':'FRA',
    'germany':'DEU','greece':'GRC','hungary':'HUN','ireland':'IRL','italy':'ITA',
    'latvia':'LVA','lithuania':'LTU','luxembourg':'LUX','malta':'MLT',
    'netherlands':'NLD','poland':'POL','portugal':'PRT','romania':'ROU',
    'slovakia':'SVK','slovenia':'SVN','spain':'ESP','sweden':'SWE'
  };

  // Arrow origin (Ukraine-ish)
  const ARROW_ORIGIN = [49.0, 32.0];

  flows   = [];
  factors = {};
  let mapData = null;



const isCountryVisible = id =>
  selectedCountries.size ? selectedCountries.has(id) : false;

const getCountryStyle = id => {
  const isSel = selectedCountries.has(id);
  const totalVal = Number.isFinite(totals[id]) ? totals[id] : 0;
  const isAllowed = ALLOWED_ISO3.has(id) || id === 'UKR';
  const hasData = totalVal > 0 || id === 'UKR';
  const GRAY_NON_EU = new Set(['GBR', 'SRB', 'BIH', 'ALB', 'MKD', 'MNE', 'XKX']);
  if (id === 'NOR' || id === 'CHE' || id === 'ISL') {
    return {
      color: isSel ? '#ffffff' : '#000000',
      weight: isSel ? 1.4 : 1.0,
      opacity: 1,
      fill: true,
      fillOpacity: 0.55,
      fillColor: '#8ea2c5ff'
    };
  }
  if (GRAY_NON_EU.has(id)) {
    return {
      color: isSel ? '#ffffff' : '#000000',
      weight: isSel ? 1.4 : 1.0,
      opacity: 1,
      fill: true,
      fillOpacity: 0.55,
      fillColor: '#8ea2c5ff'
    };
  }
  if (id === 'UKR') {
    return {
      color: isSel ? '#ffffff' : '#000000',
      weight: isSel ? 1.4 : 1.0,
      opacity: 1,
      fill: true,
      fillOpacity: 0.7,
      fillColor: 'url(#ukraine-flag)'
    };
  }
  if (!isAllowed) {
    return {
      color: isSel ? '#ffffff' : '#0f172a',
      weight: isSel ? 1.4 : 1.0,
      opacity: 1,
      fill: true,
      fillOpacity: 0.6,
      fillColor: '#214a86ff'
    };
  }
  const fill = hasData && totalScale ? totalScale(totalVal) : '#9ca3af';
  return {
    color: isSel ? '#ffffff' : '#000000',
    weight: isSel ? 1.4 : 1.0,
    opacity: 1,
    fill: true,
    fillOpacity: 0.55,
    fillColor: fill
  };
};

  // Scales
  const widthScale = d3.scaleSqrt().range([1, 12]);
  const arrowColor = d3.scaleSequential(d3.interpolatePlasma).domain([0, 1]).clamp(true);
  const PEOPLE_PER_PARTICLE = 10000; // target people represented by one dot (denser for visibility)
  const DEMO_CATS = [
    { key: 'women',    color: '#ec4899' }, // vivid pink
    { key: 'children', color: '#22c55e' }, // bright green
    { key: 'men',      color: '#3b82f6' }, // bright blue
    { key: 'elderly',  color: '#f59e0b' }  // strong amber
  ];
  const DEMO_LABELS = {
    men: 'Men (18-64)',
    women: 'Women (18-64)',
    children: 'Children (<18)',
    elderly: 'Elderly (65+)'
  };
  const DEMO_NOTES = {
    men: 'Share of adult men among displaced people',
    women: 'Share of adult women among displaced people',
    children: 'Share of displaced children',
    elderly: 'Share of displaced elderly adults'
  };
  const ensureDemoLegendRoot = () => {
    let el = document.getElementById('demoLegend');
    if (el) return el;
    el = document.createElement('div');
    el.id = 'demoLegend';
    el.className = 'compare-table-wrapper demo-legend';
    el.setAttribute('role', 'region');
    el.setAttribute('aria-label', 'Demographic bars legend');
    (document.getElementById('app') || document.body).appendChild(el);
    return el;
  };

  const positionDemoLegend = () => {
    const legend = document.getElementById('demoLegend');
    const actions = document.getElementById('country-actions');
    if (!legend || legend.style.display === 'none' || !actions) return;
    const rect = actions.getBoundingClientRect();
    const styles = window.getComputedStyle(actions);
    const gap = 10;
    const bottomPx = parseFloat(styles.bottom) || Math.max(0, window.innerHeight - rect.bottom);
    const leftPx = parseFloat(styles.left) || rect.left || 0;
    const width = Math.max(rect.width, 240);
    legend.style.left = `${leftPx}px`;
    legend.style.bottom = `${bottomPx + rect.height + gap}px`;
    legend.style.width = `${width}px`;
  };

  const renderDemoLegend = () => {
    const hasSelection = selectedCountries.size > 0;
    const legend = hasSelection ? ensureDemoLegendRoot() : document.getElementById('demoLegend');
    if (!legend) return;

    if (!hasSelection) {
      legend.classList.remove('show');
      legend.style.pointerEvents = 'none';
      setTimeout(() => {
        if (!legend.classList.contains('show')) {
          legend.style.display = 'none';
        }
      }, 260);
      return;
    }

    const rows = DEMO_CATS.map(cat => `
      <tr>
        <td><span class="legend-chip" style="background:${cat.color}"></span></td>
        <td>${DEMO_LABELS[cat.key] || cat.key}</td>
      </tr>
    `).join('');

    legend.innerHTML = `
      <div class="compare-legend-heading">
        Demographic bars composition
        <span class="compare-legend-sub">Each color shows that demographic group’s percentage of the country’s total refugees</span>
      </div>
      <table class="compare-table compare-legend-table">
        <thead>
          <tr>
            <th scope="col">Color</th>
            <th scope="col">Group</th>
          </tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>
    `;
    legend.style.display = 'block';
    legend.style.pointerEvents = 'none';
    positionDemoLegend();
    requestAnimationFrame(() => {
      legend.classList.add('show');
      legend.style.pointerEvents = 'auto';
    });
  };
  // Minis config
const VARS = ['women', 'children', 'men', 'elderly']; // demographic minis

const COLORS = {
  women: '#ec4899',
  children: '#22c55e',
  men: '#3b82f6',
  elderly: '#f59e0b'
};

const STROKES = {
  women: '#9d174d',
  children: '#166534',
  men: '#1d4ed8',
  elderly: '#92400e'
};

function ensureUkraineGradient(renderer) {
  let svg = renderer?._container || renderer?._rootGroup?.ownerSVGElement;
  if (!svg) {
    // fallback: global defs
    svg = document.getElementById('flag-defs');
    if (!svg) {
      svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
      svg.setAttribute('id', 'flag-defs');
      svg.setAttribute('width', '0');
      svg.setAttribute('height', '0');
      svg.style.position = 'absolute';
      svg.style.left = '-9999px';
      document.body.appendChild(svg);
    }
  }
  let defs = svg.querySelector('defs');
  if (!defs) {
    defs = document.createElementNS('http://www.w3.org/2000/svg', 'defs');
    svg.insertBefore(defs, svg.firstChild);
  }
  let grad = defs.querySelector('#ukraine-flag');
  if (!grad) {
    grad = document.createElementNS('http://www.w3.org/2000/svg', 'linearGradient');
    grad.setAttribute('id', 'ukraine-flag');
    grad.setAttribute('x1', '0%');
    grad.setAttribute('x2', '0%');
    grad.setAttribute('y1', '0%');
    grad.setAttribute('y2', '100%');
    const stops = [
      ['0%', '#0057b7'],
      ['50%', '#0057b7'],
      ['50%', '#ffd700'],
      ['100%', '#ffd700']
    ];
    stops.forEach(([offset, color]) => {
      const s = document.createElementNS('http://www.w3.org/2000/svg', 'stop');
      s.setAttribute('offset', offset);
      s.setAttribute('stop-color', color);
      grad.appendChild(s);
    });
    defs.appendChild(grad);
  }
}

const BOX_MIN = 6, BOX_MAX = 24;
let miniScale = {};

const XFORM = {
  women: d => Math.max(0, d),
  children: d => Math.max(0, d),
  men: d => Math.max(0, d),
  elderly: d => Math.max(0, d)
};

const INVERTED_VARS = new Set(); // none for demographics

function syncCompareFromSelection(openPanel = false, resetSort = true) {
  comparePins.length = 0;
  selectedCountries.forEach(id => comparePins.push(id));
  if (resetSort) resetCompareSort();
  renderCompare(false, { resetSort: false });
}

  function buildMiniScales() {
    miniScale = {};
    for (const v of VARS) {
      miniScale[v] = d3.scaleLinear()
        .domain([0, 1]) 
        .range([BOX_MIN, BOX_MAX])
        .clamp(true);
    }
  }

  function updateCountrySummary() {
    const summary = document.getElementById('countryPickerSummary');
    if (!summary || !countryIds.length) return;

    if (selectedCountries.size === 0) {
      summary.textContent = 'None';
      return;
    }
    if (selectedCountries.size === countryIds.length) {
      summary.textContent = 'All countries';
      return;
    }

    const names = countryIds
      .filter(id => selectedCountries.has(id))
      .map(id => countryNames[id])
      .filter(Boolean);

    const label = names.slice(0, 3).join(', ');
    const extra = selectedCountries.size - Math.min(3, names.length);
    summary.textContent = extra > 0 ? `${label} +${extra}` : label || 'None';
  }

  function syncCountryCheckboxes() {
    const list = document.getElementById('countryPickerList');
    if (!list) return;
    list.querySelectorAll('input[type=checkbox]').forEach(input => {
      input.checked = selectedCountries.has(input.value);
    });
  }

  function refreshVisibleCountries() {
    updateCountrySummary();
    if (countryLayer) countryLayer.setStyle(feat => getCountryStyle(iso(feat.properties)));
    safe(drawArrows, '[country-filter:arrows]');
    safe(drawMinis, '[country-filter:minis]');
    safe(redrawSelectionOutline, '[country-filter:outline]');
    safe(renderDemoLegend, '[country-filter:legend]');
    safe(enforceComparePanel, '[country-filter:compare]');
  }

  function buildCountryPicker(options) {
    if (countryPickerBuilt) return;
    const list    = document.getElementById('countryPickerList');
    countryPickerBuilt = true;
    const sorted = options
      .filter(d => d && d.id)
      .sort((a, b) => a.name.localeCompare(b.name));

    countryIds = sorted.map(d => d.id);
    selectedCountries = new Set(); // start with none selected

    if (list) {
      list.innerHTML = '';
      for (const { id, name } of sorted) {
        const label = document.createElement('label');
        label.dataset.name = name.toLowerCase();
        label.innerHTML =
          `<input type="checkbox" value="${id}"> ${name}`;
        list.appendChild(label);
      }
      list.addEventListener('change', e => {
        if (e.target?.matches('input[type=checkbox]')) {
          const val = e.target.value;
          if (e.target.checked) selectedCountries.add(val);
          else selectedCountries.delete(val);
          refreshVisibleCountries();
          syncCompareFromSelection(false, true);
          updateCompareToggle();
        }
      });
    }

    document.getElementById('countrySelectAll')?.addEventListener('click', () => {
      selectedCountries = new Set(countryIds);
      syncCountryCheckboxes();
      refreshVisibleCountries();
      syncCompareFromSelection(false, true);
      updateCompareToggle();
      enforceComparePanel();
    });

    document.getElementById('countrySelectNone')?.addEventListener('click', () => {
      selectedCountries.clear();
      syncCountryCheckboxes();
      refreshVisibleCountries();
      syncCompareFromSelection(false, true);
      updateCompareToggle();
      enforceComparePanel();
    });

    updateCountrySummary();
  }

  try {
  const [
    mf,
    flowRaw,
    factorRows,
    summaryRows,
    unemploymentRows,
    mipexRowsRaw,
    opinionRowsRaw,
    uaPopRowsRaw
  ] = await Promise.all([
    d3.json('data/europe.geo.json')
      .catch(() => d3.json('data/europe.topo.json').catch(() => null)),
    d3.json('data/flows_ua_agg.json').catch(() => []),
    d3.csv('data/country_factors.csv', d3.autoType).catch(() => []),
    d3.csv('data/country_summary_clean.csv', d3.autoType).catch(() => []),
    d3.csv('data/unemployment_clean.csv', d3.autoType).catch(() => []),
    d3.csv('data/mipex.CSV', d3.autoType).catch(() => []),
    d3.csv('data/publicopinion.csv', d3.autoType).catch(() => []),
    d3.csv('data/ua_population_2021_respermits.csv', d3.autoType).catch(() => [])
  ]);
  const mipexRows = Array.isArray(mipexRowsRaw) ? mipexRowsRaw.map(cleanKeys) : [];
  const opinionRows = Array.isArray(opinionRowsRaw) ? opinionRowsRaw.map(cleanKeys) : [];
  const uaPopRows = Array.isArray(uaPopRowsRaw) ? uaPopRowsRaw.map(cleanKeys) : [];

    mapData = mf;

    // Flows
    flows = (Array.isArray(flowRaw) ? flowRaw : []).map(r => ({
      dest_iso3: gs(r, FLOW_KEYS.dest_iso3).toUpperCase(),
      lat:       gf(r, FLOW_KEYS.lat),
      lon:       gf(r, FLOW_KEYS.lon),
      total_refugees: gf(r, FLOW_KEYS.tot),
      pct_children:     gf(r, COLOR_KEYS.kids),
      pct_elderly:      gf(r, COLOR_KEYS.old),
      pct_women_adult:  gf(r, COLOR_KEYS.women_adult),
      pct_men_adult:    gf(r, COLOR_KEYS.men_adult)
    })).map(r => {
      const bumpN = { DEU: 1.2, PRT: 1.2 };
      const b = bumpN[r.dest_iso3];
      if (b) {
        r.lat += b;
      }
      return r;
    }).filter(r => Number.isFinite(r.lat) && Number.isFinite(r.lon));

    // Build destLL from flows
    for (const d of flows) {
      if (d.dest_iso3 && Number.isFinite(d.lat) && Number.isFinite(d.lon)) {
        destLL[d.dest_iso3] = [d.lat, d.lon];
      }
    }

    factors = {};
    for (const r of factorRows) {
      const id = String(
        r.dest_iso3 ||
        r.iso3     ||
        r.ISO3     ||
        r.country_code ||
        r.code     ||
        ''
      ).toUpperCase();
      if (!id) continue;

      let un = +r.unemployment;
      if (un > 1) un /= 100;

      const gdp  = +r.gdp_pc;
      const dP   = +r.ua_perm_delta;
      const rat  = +r.ua_perm_per_refugee;

      const f = ensureFactor(id);
      f.gdp_pc              = Number.isFinite(gdp) ? gdp : NaN;
      f.unemployment        = Number.isFinite(un) ? un  : NaN;
      f.ua_perm_delta       = Number.isFinite(dP)  ? dP  : NaN;
      f.ua_perm_per_refugee = Number.isFinite(rat) ? rat : NaN;
    }

    // Merge allocations % GDP from country_summary_clean.csv
    if (Array.isArray(summaryRows)) {
      for (const row of summaryRows) {
        const name = String(row.Country || '').trim().toLowerCase();
        const iso = NAME_TO_ISO3[name];
        if (!iso) continue;
        const raw = +row['Allocations % GDP 2021'];
        if (!Number.isFinite(raw)) continue;
        const v = raw > 1 ? raw / 100 : raw / 100; // convert percent to share
        const f = ensureFactor(iso);
        f.alloc_pct_gdp = v;
      }
    }

    // Override unemployment from Eurostat annual file (latest year)
    if (Array.isArray(unemploymentRows)) {
      for (const r of unemploymentRows) {
        const id = String(r.dest_iso3 || '').toUpperCase();
        if (!id || !ALLOWED_ISO3.has(id)) continue;
        const val = +r.unemployment;
        if (!Number.isFinite(val)) continue;
        const f = ensureFactor(id);
        f.unemployment = val; // already fraction
      }
    }

    // MIPEX scores (0–100)
    if (Array.isArray(mipexRows)) {
    for (const r of mipexRows) {
      const id = String(r.dest_iso3 || r.iso3 || '').toUpperCase();
      if (!id || !ALLOWED_ISO3.has(id)) continue;
      const val = +r.mipex;
      if (!Number.isFinite(val)) continue;
        const f = ensureFactor(id);
        f.mipex = val;
      }
    }

    // Public opinion on welcoming refugees (%)
    if (Array.isArray(opinionRows)) {
      for (const r of opinionRows) {
        const id = String(r.dest_iso3 || r.iso3 || '').toUpperCase();
        if (!id || !ALLOWED_ISO3.has(id)) continue;
        const raw = +r.opinion;
        if (!Number.isFinite(raw)) continue;
        const f = ensureFactor(id);
        f.opinion = raw > 1 ? raw / 100 : raw;
      }
    }

    // Ukrainian resident population pre-invasion (2021)
    if (Array.isArray(uaPopRows)) {
      for (const r of uaPopRows) {
        const id = String(r.dest_iso3 || r.iso3 || '').toUpperCase();
        if (!id || !ALLOWED_ISO3.has(id)) continue;
        const raw = +r.ua_population_2021;
        if (!Number.isFinite(raw)) continue;
        const f = ensureFactor(id);
        f.ua_pop_2021 = raw;
      }
    }

    // Inject demographic percentages from flows into factors for minis
    for (const f of flows) {
      const id = f.dest_iso3;
      if (!id) continue;
      const rec = ensureFactor(id);
      const frac = v => {
        if (!Number.isFinite(v)) return NaN;
        return v > 1 ? v / 100 : v;
      };
      rec.women = frac(f.pct_women_adult);
      rec.men = frac(f.pct_men_adult);
      rec.children = frac(f.pct_children);
      rec.elderly = frac(f.pct_elderly);
    }

    window.bb.flows   = flows;
    window.bb.factors = factors;
    window.bb._mapData = mapData;

    if (flows.length) {
      const vals = flows
        .map(d => +d.total_refugees || 0)
        .filter(Number.isFinite);
      const lo = d3.min(vals) ?? 1;
      const hi = d3.max(vals) ?? 1;
      totals = flows.reduce((acc, d) => {
        acc[d.dest_iso3] = (acc[d.dest_iso3] || 0) + (+d.total_refugees || 0);
        return acc;
      }, {});
      // Ensure every allowed country has an entry (so all get a fill color)
      ALLOWED_ISO3.forEach(id => {
        if (!Object.prototype.hasOwnProperty.call(totals, id)) totals[id] = 0;
      });
      widthScale.domain(
        lo === hi
          ? [1, hi + 1]
          : [Math.max(1, lo), Math.max(1, hi)]
      );
      const tHi = 1_200_000;
      const colors = [
        '#fff7ed',
        '#f9c385ff',
        '#fb923c',
        '#f97316',
        '#ff4d00ff'
      ];
      const domainPoints = [10_000, 50_000, 100_000, 500_000, tHi];

      totalScale = d3.scaleLog()
        .domain(domainPoints)
        .range(colors)
        .interpolate(d3.interpolateRgb)
        .clamp(true);
    }
    buildMiniScales();

    // Countries + labels
  function drawCountries() {
    let geo = null;
    if (!mapData) return;
      if (mapData.type === 'FeatureCollection')      geo = mapData;
      else if (mapData.type === 'Feature')           geo = { type: 'FeatureCollection', features: [mapData] };
      else if (mapData.type === 'Topology') {
        if (!window.topojson || !topojson.feature) return;
        const objs = Object.values(mapData.objects || {});
        if (!objs.length) return;
        geo = topojson.feature(mapData, objs[0]);
      }

    if (countryLayer) map.removeLayer(countryLayer);
    labelLayer.clearLayers();
    countryLabels.clear();
    ensureUkraineGradient(map._renderer || countryLayer?._renderer);

      const pickerOptions = [];
      const seenOptions = new Set();

    countryLayer = L.geoJSON(geo, {
        pane: 'countries',
        style: feat => getCountryStyle(iso(feat?.properties || {})),
        interactive: true,
        smoothFactor: 2.0,
        tolerance: 2,
        bubblingMouseEvents: false,
        onEachFeature: (feat, layer) => {
        const props = feat?.properties || {};
        const id    = iso(props);
        if (!ALLOWED_ISO3.has(id)) return;
        countryFeatures.set(id, feat);

          const name  = nm(props);
          countryNames[id] = name;
          if (!seenOptions.has(id)) {
            seenOptions.add(id);
            pickerOptions.push({ id, name });
          }
          const polyCenter = layer.getBounds().getCenter();
          const hasFlow = !!destLL[id];

          // Base position for minis = arrow destination if we have it; else polygon center
          let base = hasFlow
            ? destLL[id]
            : [polyCenter.lat, polyCenter.lng];
          if (id === 'SWE') {
            base = [base[0], base[1] - 3.0]; // move sweden minis left
          }
          if (id === 'PRT') {
            base = [base[0] - 0.8, base[1]]; // move Portugal minis down 
          }
          if (id === 'ESP') {
            base = [base[0] + 0.4, base[1] + 0.6]; // move Spain minis up and right
          }

          // Minis live at base
          centroidLL[id] = [base[0], base[1]];

          // Label: at arrow destination; otherwise polygon center
          let labelLL;
          if (hasFlow) {
            labelLL = L.latLng(base[0], base[1]);
          } else {
            labelLL = polyCenter;
          }

          L.marker(labelLL, {
            pane: 'labels',
            interactive: false,
            icon: L.divIcon({
              className: 'country-label',
              html: `<span>${name}</span>`,
              iconSize: [0, 0]
            })
          }).addTo(labelLayer);
          const lastMarker = labelLayer.getLayers()[labelLayer.getLayers().length - 1];
          if (lastMarker) countryLabels.set(id, lastMarker);

          layer.bindTooltip(
            `<div><b>${name}</b></div><div><b>Total refugees:</b> ${formatCount(totals[id] || 0)}</div>`,
            {
              direction: 'auto',
              opacity: 0.95,
              className: 'arrow-tip',
              sticky: true,
              offset: [0, -6]
            }
          );

          layer.on({
            mouseover: e => {
              const base = getCountryStyle(id);
              const hoverFill = Math.max(0, (base.fillOpacity ?? 0) - 0.03);
              e.target.setStyle({
                color: base.color,
                weight: base.weight,
                opacity: base.opacity,
                fillOpacity: hoverFill
              });
            },
            mouseout: e => {
              countryLayer.resetStyle(e.target);
            },
            click: () => {
              const f   = factors[id] || {};
              const ref = flows.find(x => x.dest_iso3 === id) || {};
              if (selectedCountries.has(id)) selectedCountries.delete(id);
              else selectedCountries.add(id);
              syncCountryCheckboxes();
              refreshVisibleCountries();
              syncCompareFromSelection(false, true);
              updateCompareToggle();
              const permDelta = Number.isFinite(f.ua_perm_delta) ? f.ua_perm_delta : null;
              const permRatio = Number.isFinite(f.ua_perm_per_refugee) ? f.ua_perm_per_refugee : null;

              const permDeltaText = permDelta != null ? fmtNum(permDelta)        : '—';
              const permRatioText = permRatio != null ? permRatio.toFixed(3) : '—';
            }
          });
        }
      }).addTo(map);

    if (pickerOptions.length) {
      buildCountryPicker(pickerOptions);
      if (!initialSelectionDone && countryIds.length) {
        const picks = countryIds
          .slice()
          .sort(() => Math.random() - 0.5)
          .slice(0, Math.min(5, countryIds.length));
        selectedCountries = new Set(picks);
        syncCountryCheckboxes();
        refreshVisibleCountries();
        syncCompareFromSelection(false, true);
        initialSelectionDone = true;
      }
      updateCompareToggle();
    }
  }

    // Arrows
    function getArrowColorValue(d) {
      const sel = document.getElementById('arrowColorVar');
      const key = sel?.value || 'pct_children';
      const val = Number.isFinite(d[key]) ? d[key] : 0;
      return Math.max(0, Math.min(1, val));
    }

    const getArrowLabel = () =>
      document.getElementById('arrowColorVar')?.selectedOptions?.[0]?.text || 'Arrow metric';

    function bez(a, c, b, n = 40) {
      const pts = [];
      for (let i = 0; i <= n; i++) {
        const t = i / n, u = 1 - t;
        pts.push([
          u*u*a.lat + 2*u*t*c.lat + t*t*b.lat,
          u*u*a.lng + 2*u*t*c.lng + t*t*b.lng
        ]);
      }
      return pts;
    }

    function enforceComparePanel() {
      const needOpen = selectedCountries.size >= 2;
      if (needOpen) {
        safe(() => renderCompare(true, { resetSort: false }), '[enforce:compare-open]');
        showDetail(null, { skipRefit: true });
      } else {
        hideDetail(true, { skipRefit: true });
      }
    }

  function drawArrows() {
    arrowsGroup.clearLayers();
    if (!flows.length) {
      flowEngine?.setFlows([]);
      return;
      }
      if (!flowEngine) {
        flowEngine = new FlowParticleEngine(map, 'arrows');
    }
    const origin = L.latLng(ARROW_ORIGIN[0], ARROW_ORIGIN[1]);

    const jitterPath = (from, to) => [from, to]; // straight path, no wiggle

    const visibleFlows = flows.filter(d => isCountryVisible(d.dest_iso3));
    const flowData = [];
    visibleFlows.forEach(d => {
      const dest = L.latLng(+d.lat, +d.lon);
      const anchorLL = centroidLL[d.dest_iso3] ? L.latLng(centroidLL[d.dest_iso3][0], centroidLL[d.dest_iso3][1]) : dest;
      const samples = jitterPath(origin, anchorLL);
      const distKm = origin.distanceTo(dest) / 1000;
      const duration = Math.min(12, Math.max(5, distKm / 350)); // longer routes take a bit longer
      const intensity = Math.max(0.2, Math.min(1.2, (widthScale(+d.total_refugees || 1) || 1) / 10));
      const dots = Math.max(0, (+d.total_refugees || 0) / PEOPLE_PER_PARTICLE);
      const spawnRate = dots > 0 ? Math.min(40, Math.max(2, dots / duration)) : 0; // dots per second
      const demoRaw = {
        men:      +d.pct_men_adult,
        women:    +d.pct_women_adult,
        children: +d.pct_children,
        elderly:  +d.pct_elderly
      };
      let sumDemo = 0;
      DEMO_CATS.forEach(cat => { sumDemo += Math.max(0, demoRaw[cat.key] || 0); });
      const normDemo = DEMO_CATS.map(cat => {
        const v = Math.max(0, demoRaw[cat.key] || 0);
        return { key: cat.key, color: cat.color, p: sumDemo > 0 ? v / sumDemo : 1 / DEMO_CATS.length };
      });
      // ensure sum to 1
      const totalP = normDemo.reduce((a, b) => a + b.p, 0);
      normDemo.forEach(d => { d.p = d.p / (totalP || 1); });

      const labelMap = {
        men: 'Men',
        women: 'Women',
        children: 'Children',
        elderly: 'Elderly'
      };
      const compLines = normDemo.map(cat => {
        return `<span style="color:${cat.color}">${labelMap[cat.key] || cat.key}: ${fmtPct(cat.p)}</span>`;
      }).join('<br>');

      // split into per-category flows so particles target the matching bar
      const BAR_W = 10, BAR_GAP = 6;
      const totalW = VARS.length * BAR_W + (VARS.length - 1) * BAR_GAP;
      const anchorPt = map.latLngToLayerPoint(anchorLL);

      normDemo.forEach((cat) => {
        const pShare = cat.p;
        if (pShare <= 0) return;
        const idx = Math.max(0, VARS.indexOf(cat.key));
        const shiftX = -totalW / 2 + idx * (BAR_W + BAR_GAP) + BAR_W / 2;
        const barTarget = map.layerPointToLatLng(anchorPt.add([shiftX, 0]));
        const path = jitterPath(samples[0], barTarget);
        flowData.push({
          id: d.dest_iso3,
          latlngs: path,
          duration,
          intensity,
          spawnRate: (spawnRate * pShare),
          color: '#ffffff',
          distro: [{ color: '#ffffff', p: 1 }],
          spread: 1 + intensity * 2.8,
          total: d.total_refugees || 0,
          tooltip: `<div><b>${labelMap[cat.key] || cat.key}</b></div><div>${fmtPct(cat.p)}</div><div style="margin-top:6px;"><b>Total refugees:</b> ${formatCount(d.total_refugees)}</div>`
        });
      });
    });

      flowEngine.setFlows(flowData);


    }

    // Minis
  function project(lat, lon) {
    const p = map.latLngToLayerPoint([lat, lon]);
    return [p.x, p.y];
  }

  function drawMinis() {
    const active = getActiveFactors();
    const mode   = getBoxMode();
    const ids    = Object.keys(factors).filter(isCountryVisible);
    const shouldTransition = (mode !== drawMinis._lastMode);
    const zoom = map?.getZoom ? map.getZoom() : MIN_COMFORT_ZOOM;
    const baseZoom = map?.getMinZoom ? map.getMinZoom() : MIN_COMFORT_ZOOM;
    const zoomScale = map?.getZoomScale ? map.getZoomScale(zoom, baseZoom) : Math.pow(2, zoom - baseZoom);
    const zoomFactor = Math.max(1.0, Math.min(3.5, zoomScale * uiScale)); // minis grow as you zoom in, tied to UI scale

    const activeVars = active.filter(v =>
      typeof XFORM[v] === 'function' && miniScale[v]
    );

      if (!activeVars.length) {
        countryLabels.forEach(marker => {
          const el = marker.getElement && marker.getElement();
          if (el) el.style.opacity = '1';
        });
        miniRoot.selectAll('g.mini').remove();
        return;
      }

      const data = ids.map(id => {
        const ll = centroidLL[id];
        if (!ll) return null;
        const rec = factors[id] || {};

        const sizes = active.map(v => {
          const transform = XFORM[v] || (x => x);
          const x = transform(+rec[v] || 0);
          const scale = miniScale[v] || (x => BOX_MIN);
          let s = Math.max(BOX_MIN, Math.min(BOX_MAX, scale(x)));
          if (INVERTED_VARS.has(v)) {
            s = BOX_MIN + (BOX_MAX - s); // invert scale 
          }
          const scaledMin = BOX_MIN * zoomFactor;
          const scaledMax = BOX_MAX * zoomFactor;
          s = Math.max(scaledMin, Math.min(scaledMax, s * zoomFactor));
          return { varName: v, s, value: +rec[v] || 0 };
        });

        return { id, ll, sizes };
      }).filter(Boolean);

      // Hide labels for countries with minis 
      countryLabels.forEach((marker, iso3) => {
        const el = marker.getElement && marker.getElement();
        if (!el) return;
        const hasMini = ids.includes(iso3);
        el.style.opacity = hasMini ? '0' : '1';
      });

      const groups = miniRoot.selectAll('g.mini').data(data, d => d.id);
      const enter  = groups.enter()
        .append('g')
        .attr('class', 'mini')
        .style('opacity', 0);

      const merged = groups.merge(enter)
        .attr('transform', d => {
          const [x, y] = project(d.ll[0], d.ll[1]);
          return `translate(${x},${y})`;
        });

      const rects = merged.selectAll('rect').data(d => d.sizes, s => s.varName);

      const rectsEnter = rects.enter()
        .append('rect')
        .attr('rx', 2.5)
        .attr('ry', 2.5)
        .attr('stroke-width', 1)
        .style('opacity', 0)
        .style('pointer-events', 'all')
        .attr('height', 0)
        .attr('y', 0);

      const rectsMerged = rectsEnter.merge(rects)
        .attr('fill',   s => COLORS[s.varName]   || '#9ca3af')
        .attr('stroke', s => STROKES[s.varName]  || '#374151');

      rectsEnter.append('title');
      const labelMap = { women: 'Women', children: 'Children', men: 'Men', elderly: 'Elderly' };
      rectsMerged.select('title').text(function (s) {
        const label = labelMap[s.varName] || s.varName;
        return `${label}: ${fmtPct(s.value)}`;
      });

      rectsMerged
        .on('mouseenter', function (event, s) {
          const label = labelMap[s.varName] || s.varName;
          miniTooltip.textContent = `${label}: ${fmtPct(s.value)}`;
          miniTooltip.style.display = 'block';
          miniTooltip.style.left = `${event.clientX + 8}px`;
          miniTooltip.style.top = `${event.clientY + 8}px`;
        })
        .on('mousemove', function (event) {
          miniTooltip.style.left = `${event.clientX + 8}px`;
          miniTooltip.style.top = `${event.clientY + 8}px`;
        })
        .on('mouseleave', function () {
          miniTooltip.style.display = 'none';
        });

      const widthScale = Math.max(0.9, Math.min(2.0, zoomFactor * uiScale));
      const baseW = 12 * widthScale;
      const baseGap = 7 * widthScale;

      const applyPos = sel => sel
        .attr('x', function (s, i) {
          const d = this.parentNode.__data__;
          const totalW = d.sizes.length * baseW + (d.sizes.length - 1) * baseGap;
          return -totalW / 2 + i * (baseW + baseGap);
        })
        .attr('y', s => -s.s)
        .attr('width', baseW)
        .attr('height', s => s.s);

      applyPos(rectsMerged);
      rectsMerged.style('opacity', 1);

      // Grow-in animation for newly entered bars
      rectsEnter
        .transition()
        .duration(260)
        .ease(d3.easeCubicOut)
        .style('opacity', 1)
        .attr('y', s => -s.s)
        .attr('height', s => s.s);

      rects.exit()
        .transition()
        .duration(180)
        .style('opacity', 0)
        .remove();

      merged.style('opacity', 1);
      groups.exit()
        .transition()
        .duration(180)
        .style('opacity', 0)
        .remove();
      drawMinis._lastMode = mode;
    }

    // Legends
    function renderArrowLegend() {
      const root = d3.select('#legend-arrows');
      root.selectAll('*').remove();
      if (!flows.length) return;

      const W = 240;
      const ROWH = 16;
      const H = 10 + DEMO_CATS.length * (ROWH + 8) + 6;
      const svg = root
        .append('svg')
        .attr('class', 'legend')
        .attr('width', W)
        .attr('height', H);

      svg
        .append('text')
        .attr('x', 12)
        .attr('y', 14)
        .attr('class', 'legend-title')
        .text('Particle color — demographic');

      const labels = DEMO_LABELS;

      const rows = svg
        .selectAll('.row')
        .data(DEMO_CATS)
        .enter()
        .append('g')
        .attr('class', 'row')
        .attr('transform', (_, i) => `translate(12,${22 + i * (ROWH + 8)})`);

      rows
        .append('rect')
        .attr('width', ROWH)
        .attr('height', ROWH)
        .attr('rx', 3)
        .attr('ry', 3)
        .attr('fill', d => d.color)
        .attr('stroke', '#111827');

      rows
        .append('text')
        .attr('x', ROWH + 8)
        .attr('y', ROWH - 4)
        .attr('class', 'legend-tick')
        .text(d => labels[d.key] || d.key);
    }

    function renderBoxLegend() {
      const root = d3.select('#legend-boxes');
      root.selectAll('*').remove();

      const active = getActiveFactors();
      if (!active.length) return;

      const W = 240;
      const ROWH = 16;
      const H = 10 + active.length * (ROWH + 8) + 6;
      const svg = root
        .append('svg')
        .attr('class', 'legend')
        .attr('width', W)
        .attr('height', H);

      svg
        .append('text')
        .attr('x', 12)
        .attr('y', 14)
        .attr('class', 'legend-title')
        .text('Country minis — demographics');

      const labels = DEMO_LABELS;

      const rows = svg
        .selectAll('.row')
        .data(active)
        .enter()
        .append('g')
        .attr('class', 'row')
        .attr('transform', (_, i) => `translate(12,${22 + i * (ROWH + 8)})`);

      rows
        .append('rect')
        .attr('width', ROWH)
        .attr('height', ROWH)
        .attr('rx', 3)
        .attr('ry', 3)
        .attr('fill', d => COLORS[d] || '#9ca3af')
        .attr('stroke', d => STROKES[d] || '#374151');

      rows
        .append('text')
        .attr('x', ROWH + 8)
        .attr('y', ROWH - 4)
        .attr('class', 'legend-tick')
        .text(d => labels[d] || d);
    }

    function renderTotalLegend() {
      const root = d3.select('#legend-total');
      root.selectAll('*').remove();
      if (!totalScale) return;

      const containerW = root.node()?.clientWidth || 680;
      const W = Math.max(120, containerW);
      const H = 60;
      const P = { l: 16, r: 16, t: 12, b: 12 };
      const gradId = 'totalGrad';

      const domainPts = totalScale.domain();
      const lo = Math.max(1, domainPts[0] || 1);
      const hi = Math.max(lo * 1.01, domainPts[domainPts.length - 1] || lo * 10);

      const svg = root
        .append('svg')
        .attr('class', 'legend')
        .attr('width', '100%')
        .attr('height', H)
        .attr('viewBox', `0 0 ${W} ${H}`);

      svg
        .append('text')
        .attr('x', P.l)
        .attr('y', P.t)
        .attr('class', 'legend-title')
        .text('Total refugees per country');

      const defs = svg.append('defs');
      const grad = defs
        .append('linearGradient')
        .attr('id', gradId)
        .attr('x1', '0%')
        .attr('x2', '100%');

      const logSpan = Math.log(hi / lo);
      for (let i = 0; i <= 40; i++) {
        const t = i / 40;
        const v = lo * Math.exp(logSpan * t);
        grad
          .append('stop')
          .attr('offset', `${t * 100}%`)
          .attr('stop-color', totalScale(v));
      }

      const gradW = Math.max(80, W - P.l - P.r);
      const g = svg
        .append('g')
        .attr('transform', `translate(${P.l},${P.t + 8})`);

      g.append('rect')
        .attr('width', gradW)
        .attr('height', 10)
        .attr('fill', `url(#${gradId})`);

      const axis = d3.scaleLog().domain([lo, hi]).range([0, gradW]);
      const ticks = [10_000, 50_000, 100_000, 500_000, 1_200_000].filter(v => v >= lo && v <= hi);
      const fmtLegend = v => {
        if (v >= 1_000_000) return `${Math.round(v / 1_000_000)}M`;
        if (v >= 1_000) return `${Math.round(v / 1_000)}k`;
        return formatCount(v);
      };
      g
        .selectAll('g.tick')
        .data(ticks)
        .enter()
        .append('g')
        .attr('class', 'tick')
        .attr('transform', d => `translate(${axis(d)}, 12)`)
        .each(function (d) {
          d3.select(this)
            .append('line')
            .attr('y1', 0)
            .attr('y2', 6)
            .attr('stroke', '#9ca3af');
          d3.select(this)
            .append('text')
            .attr('y', 18)
            .attr('text-anchor', 'middle')
            .attr('class', 'legend-tick')
            .text(fmtLegend(d));
        });
    }

    // Initial draw
    safe(drawCountries, '[init:countries]');
    safe(drawArrows,    '[init:arrows]');
    safe(drawMinis,     '[init:minis]');
    safe(renderArrowLegend, '[legend:arrows]');
    safe(renderBoxLegend,   '[legend:boxes]');
    safe(renderTotalLegend, '[legend:total]');

    // Reposition minis on pan/zoom
  map.on('moveend zoomend', () => {
    safe(drawMinis, '[event:minis]');
    safe(redrawSelectionOutline, '[event:outline]');
  });
  map.on('zoomend', () => {
    if (flowEngine) flowEngine.dirty = true;
  });
  window.addEventListener('resize', () => {
    map.invalidateSize();
    refitForViewport(false);
    if (flowEngine) flowEngine.dirty = true;
    safe(positionDemoLegend, '[resize:legend]');
    applyUiScale();
    if (selectedCountries.size) {
      const isOpen = document.getElementById('detailPanel')?.classList.contains('open');
      safe(() => renderCompare(isOpen, { resetSort: false }), '[resize:compare]');
    }
  });

    // UI
    document.querySelectorAll('.controls .factor-toggle, .controls select').forEach(el => {
      el.addEventListener('change', () => {
        buildMiniScales();
        safe(drawArrows, '[ui:arrows]');
        safe(drawMinis,  '[ui:minis]');
        safe(renderArrowLegend, '[ui:legend-arrows]');
        safe(renderBoxLegend,   '[ui:legend-boxes]');
        safe(() => renderCompare(false), '[ui:compare]');
      });
    });

    document.querySelectorAll('input[name=boxmode]').forEach(el => {
      el.addEventListener('change', () => {
        safe(drawMinis, '[ui:minis:boxmode]');
        safe(renderBoxLegend, '[ui:legend-boxes]');
      });
    });

    const toggleBtn = document.getElementById('detailToggle');
    const toggleArrow = document.getElementById('detailToggleArrow');
    const toggleWrap = document.querySelector('.detail-toggle-wrap');
    if (toggleBtn) toggleBtn.style.display = 'none';
    if (toggleArrow) toggleArrow.style.display = 'none';
    if (toggleWrap) toggleWrap.style.display = 'none';

    const updateToggleVisibility = () => {
      updateCompareToggle();
    };
    updateToggleVisibility();
    document.getElementById('detail-body')?.addEventListener('click', e => {
      const btn = e.target.closest('.compare-remove');
      if (btn) {
        const id = btn.dataset.id;
        if (id) {
          selectedCountries.delete(id);
          syncCountryCheckboxes();
          refreshVisibleCountries();
          syncCompareFromSelection(false, true);
          updateCompareToggle();
          enforceComparePanel();
        }
      }
    });
    const clearBtn = document.getElementById('detailClear');
    if (clearBtn) {
      clearBtn.addEventListener('click', () => {
        selectedCountries.clear();
        comparePins.length = 0;
        syncCountryCheckboxes();
        refreshVisibleCountries();
        renderCompare(false);
        hideDetail();
        updateCompareToggle();
        enforceComparePanel();
      });
    }

  } catch (e) {
    console.error('[load error]', e);
  } finally {
    hideDetail();
    window.bb.ready = true;
    window.dispatchEvent(new Event('bb:ready'));
  }
})();
