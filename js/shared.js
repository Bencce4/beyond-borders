
// Basic app state exposed for debugging
window.bb = {
  ready: false,
  flows: [],
  factors: {},
  _mapData: null,
  map: null,
  dump() {
    return {
      mapType: this._mapData?.type || null,
      features: this._mapData?.features?.length || 0,
      flows: this.flows.length,
      factors: Object.keys(this.factors).length
    };
  }
};

// Demographic minis: always render all four categories
const getActiveFactors = () => ['women', 'children', 'men', 'elderly'];

const getBoxMode = () =>
  (document.querySelector('input[name=boxmode]:checked')?.value === 'side'
    ? 'side'
    : 'stack');

function loadScript(src) {
  return new Promise((res, rej) => {
    const s = document.createElement('script');
    s.src = src;
    s.async = true;
    s.onload = res;
    s.onerror = rej;
    document.head.appendChild(s);
  });
}

function safe(fn, tag) {
  try { return fn(); }
  catch (e) { console.error(tag || '[safe]', e); }
}

async function ensureLibs() {
  if (!window.L) throw new Error('Leaflet missing');
  if (!window.d3) {
    await loadScript('https://cdn.jsdelivr.net/npm/d3@7/dist/d3.min.js');
  }
  if (!window.d3) throw new Error('d3 failed');
  if (!window.topojson) {
    try {
      await loadScript('https://cdn.jsdelivr.net/npm/topojson-client@3/dist/topojson-client.min.js');
    } catch (_) {}
  }
}

const formatCount = v =>
  !Number.isFinite(v) ? '—' : d3.format(',.0f')(Math.round(v));

// Shared mutable state
const comparePins = [];
let selectedCountries = new Set();
let countryNames = Object.create(null);
let flows = [];
let factors = {};
let totals = {};
let totalScale = null;
let countryFeatures = new Map();
let selectionLayer = null;
let initialSelectionDone = false;
let renderCompare = () => {};
let flowEngine = null;
let compareSort = { key: 'total_refugees', dir: 'desc' };
let refitForViewport = () => {};
let uiScale = 1;
let countryIds = [];
let countryPickerBuilt = false;
let countryLayer = null;
const countryLabels = new Map();
let mapData = null;
const destLL = Object.create(null);
const centroidLL = Object.create(null);
let detailHideTimer = null;

const BASE_VIEWPORT = { width: 1710, height: 985 }; // fixed baseline viewport
const computeUiScale = () => {
  const baseW = BASE_VIEWPORT.width;
  const baseH = BASE_VIEWPORT.height;
  const vw = Math.max(320, window.innerWidth || baseW);
  const vh = Math.max(480, window.innerHeight || baseH);
  const raw = Math.min(vw / baseW, vh / baseH);
  return Math.max(0.75, Math.min(1.4, raw));
};
const applyUiScale = () => {
  uiScale = computeUiScale();
  document.documentElement.style.setProperty('--ui-scale', uiScale.toFixed(3));
};

function showDetail(html, opts = {}) {
  if (detailHideTimer) {
    clearTimeout(detailHideTimer);
    detailHideTimer = null;
  }
  const { skipRefit = false } = opts;
  const panel = document.getElementById('detailPanel');
  const body  = document.getElementById('detail-body');
  if (!panel || !body) return;
  if (html != null) body.innerHTML = html;
  panel.style.display = 'block';
  requestAnimationFrame(() => panel.classList.add('open'));
  const arrowBtn = document.getElementById('detailToggleArrow');
  if (arrowBtn) {
    arrowBtn.textContent = '→';
    arrowBtn.style.display = 'inline-flex';
  }
  const toggleBtn = document.getElementById('detailToggle');
  if (toggleBtn) toggleBtn.style.display = 'none';
  if (toggleBtn) toggleBtn.setAttribute('aria-expanded', 'true');
  document.body.classList.add('panel-open');
  if (!skipRefit) refitForViewport?.();
}

function hideDetail() {
  const force = arguments.length ? !!arguments[0] : false;
  const opts = arguments.length > 1 ? arguments[1] || {} : {};
  const skipRefit = !!opts.skipRefit;
  if (!force && selectedCountries.size >= 2) return;
  const panel = document.getElementById('detailPanel');
  if (panel) {
    if (detailHideTimer) {
      clearTimeout(detailHideTimer);
      detailHideTimer = null;
    }
    panel.classList.remove('open');
    detailHideTimer = setTimeout(() => {
      panel.style.display = 'none';
      detailHideTimer = null;
    }, 1050);
    const arrowBtn = document.getElementById('detailToggleArrow');
    if (arrowBtn) {
      arrowBtn.textContent = '←';
      arrowBtn.style.display = 'inline-flex';
    }
    const toggleBtn = document.getElementById('detailToggle');
    if (toggleBtn) {
      toggleBtn.style.display = 'flex';
      toggleBtn.setAttribute('aria-expanded', 'false');
    }
    document.body.classList.remove('panel-open');
    updateCompareToggle();
    if (!skipRefit) refitForViewport?.();
  }
}

function updateCompareToggle() {
  const wrap = document.querySelector('.detail-toggle-wrap');
  if (wrap) wrap.style.display = 'none';
}

function redrawSelectionOutline() {
  selectionLayer?.clearLayers();
  if (!selectedCountries.size) return;
  selectedCountries.forEach(id => {
    const feat = countryFeatures.get(id);
    if (!feat) return;
    L.geoJSON(feat, {
      pane: 'selection',
      style: {
        color: '#ffffff',
        weight: 2,
        opacity: 1,
        fill: false,
        lineJoin: 'round',
        lineCap: 'round'
      },
      interactive: false
    }).addTo(selectionLayer);
  });
  selectionLayer?.eachLayer(l => l.bringToFront?.());
}

const fmtNum = v =>
  (v == null || isNaN(v)) ? '—' : d3.format(',')(Math.round(+v));

const fmtPct = v => {
  if (v == null || isNaN(v)) return '—';
  const x = +v > 1 ? +v / 100 : +v;
  const out = d3.format('.1%')(Math.max(0, Math.min(1, x)));
  return out.endsWith('.0%') ? out.replace('.0%', '%') : out;
};

const resetCompareSort = () => {
  compareSort = { key: 'total_refugees', dir: 'desc' };
};

// Metric metadata and colors
const METRIC_COLORS = {
  gdp_pc: '#60a5fa',
  unemployment: '#fb923c',
  alloc_pct_gdp: '#eab308',
  mipex: '#8b5cf6',
  opinion: '#14b8a6',
  ua_pop_2021: '#a3e635'
};

const METRIC_INFO = {
  gdp_pc: {
    title: 'GDP per capita',
    desc: 'Latest GDP per capita (USD) for each country.',
    source: { label: 'eurostat/GDP_PC', href: 'https://ec.europa.eu/eurostat/databrowser/view/sdg_08_10/default/table?lang=en' }
  },
  unemployment: {
    title: 'Unemployment rate',
    desc: 'Most recent unemployment rate (share of labor force).',
    source: { label: 'eurostat/unemployment', href: 'https://ec.europa.eu/eurostat/databrowser/view/tps00203/default/table' }
  },
  alloc_pct_gdp: {
    title: 'Support for Ukraine (% GDP)',
    desc: 'Share of GDP spent on Ukraine support (2021).',
    source: { label: 'allocations per gdp', href: 'https://www.kielinstitut.de/publications/ukraine-support-tracker-data-6453/' }
  },
  mipex: {
    title: 'MIPEX score (0–100)',
    desc: 'The Migrant Integration Policy Index evaluates the legal framework for societal inclusion. A higher score indicates more favorable policies.',
    source: { label: 'mipex.eu', href: 'https://www.mipex.eu/play/' }
  },
  opinion: {
    title: 'Public opinion on Ukrainian refugees',
    desc: 'Percentage of citizens who agree with welcoming people fleeing the war in Ukraine.',
    source: { label: 'eurostat/public opinion', href: 'https://europa.eu/eurobarometer/surveys/detail/3372' }
  },
  ua_pop_2021: {
    title: 'Pre-war Ukrainian population (2021)',
    desc: 'Registered Ukrainian citizens residing in the country in 2021, before Russia’s full-scale invasion.',
    source: { label: 'residence permits (Eurostat)', href: 'data/migr_resvalid__custom_19375420_linear_2_0.csv' }
  },
  total_refugees: {
    title: 'Total refugees',
    desc: 'Aggregated count of refugees hosted by destination country.',
    source: { label: 'eurostat.total_refugees', href: 'https://ec.europa.eu/eurostat/databrowser/view/migr_asytpsm__custom_19168926/default/table' }
  }
};

const metricColorFor = (key, val) => {
  if (key === 'arrow' && typeof arrowColor !== 'undefined') {
    return arrowColor(val || 0);
  }
  return METRIC_COLORS[key] || '#94a3b8';
};
