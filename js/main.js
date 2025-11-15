/* build v41: minis (stack/side), clickable country contours, no basemap, labels restored */
(function () {
  "use strict";

  window.bb = {
    ready: false, flows: [], factors: {}, _mapData: null, map: null,
    dump() {
      return {
        mapType: this._mapData?.type || null,
        features: this._mapData?.features?.length || 0,
        flows: this.flows.length,
        factors: Object.keys(this.factors).length
      };
    }
  };

  const getActiveFactors = () =>
    Array.from(document.querySelectorAll(".controls input[type=checkbox]:checked")).map(e => e.value);
  const getBoxMode = () =>
    (document.querySelector('input[name=boxmode]:checked')?.value === "side" ? "side" : "stack");

  function loadScript(src) {
    return new Promise((res, rej) => {
      const s = document.createElement("script");
      s.src = src; s.async = true; s.onload = res; s.onerror = rej;
      document.head.appendChild(s);
    });
  }
  function safe(fn, tag) { try { return fn(); } catch (e) { console.error(tag || "[safe]", e); } }

  async function ensureLibs() {
    if (!window.L) throw new Error("Leaflet missing");
    if (!window.d3) { await loadScript("https://cdn.jsdelivr.net/npm/d3@7/dist/d3.min.js"); }
    if (!window.d3) throw new Error("d3 failed");
    if (!window.topojson) {
      try { await loadScript("https://cdn.jsdelivr.net/npm/topojson-client@3/dist/topojson-client.min.js"); }
      catch (_) {}
    }
  }
  const formatCount = v => !Number.isFinite(v) ? "—" : d3.format("~s")(Math.round(v));

  function killLegacyFrames() {
    if (!bb.map) return;
    bb.map.eachLayer(l => {
      const isRect = (window.L && l instanceof L.Rectangle);
      const inBoxesPane = (l?.options?.pane === "boxesPane");
      const legacyClass = (l?.options?.className || "").includes("country-box");
      if (isRect || inBoxesPane || legacyClass) {
        try { bb.map.removeLayer(l); } catch (_) {}
      }
    });
    try {
      const p = bb.map.getPane("boxesPane");
      if (p) { p.remove(); delete bb.map._panes["boxesPane"]; }
    } catch (_) {}
  }

  (async function boot () {
    try { await ensureLibs(); }
    catch (e) { console.error("[boot] libs", e); window.bb.ready = true; return; }

    document.querySelectorAll(".country-box-group,.country-box,.boxes-root").forEach(n => n.remove());

    // Map
    const EUROPE_BOUNDS = L.latLngBounds([34, -10], [71.5, 45]);
    const map = L.map("map", {
      zoomControl: true, attributionControl: false,
      minZoom: 4, maxZoom: 8,
      maxBounds: EUROPE_BOUNDS, maxBoundsViscosity: 1.0
    });
    window.bb.map = map;
    map.fitBounds(EUROPE_BOUNDS, { animate: false });
    map.setView([52, 20], 5, { animate: false });

    // No basemap (clean)
    // (keep empty background; outlines + our layers only)

    // Panes
    map.createPane("countries"); map.getPane("countries").style.zIndex = 420;
    map.createPane("labels");    map.getPane("labels").style.zIndex   = 430;
    map.createPane("arrows");    map.getPane("arrows").style.zIndex   = 440;
    map.createPane("minis");     map.getPane("minis").style.zIndex    = 450;

    const arrowsGroup = L.layerGroup({ pane: "arrows" }).addTo(map);
    const labelLayer  = L.layerGroup({ pane: "labels" }).addTo(map);
    let countryLayer = null;

    killLegacyFrames();

    // D3 layer for minis (never capture pointer events)
    const svgMini = L.svg({ pane: "minis", padding: 0.5 }).addTo(map);
    const miniRoot = d3
      .select(svgMini._rootGroup || svgMini._container.querySelector("svg"))
      .append("g")
      .attr("class", "mini-root leaflet-zoom-hide")
      .style("pointer-events", "none");

    // Helpers + aliases
    const FLOW_KEYS   = { dest_iso3: ["dest_iso3","iso3","ISO3","country_code","code"], lat: ["lat","latitude"], lon: ["lon","lng","longitude"], tot: ["total_refugees","refugees","count","n"] };
    const COLOR_KEYS  = { kids: ["pct_children","children_pct"], women: ["pct_women","women_pct"], old: ["pct_elderly","elderly_pct"] };
    const FACTOR_KEYS = { iso: ["dest_iso3","iso3","ISO3","country_code","code"], gdp: ["gdp_pc","gdp_per_capita"], aid: ["aid_per_refugee"], un: ["unemployment","unemployment_rate"] };
    const gf = (o, a, d = 0) => { for (const k of a) { const v = o?.[k]; if (v !== "" && v != null && Number.isFinite(+v)) return +v; } return d; };
    const gs = (o, a) => { for (const k of a) { const v = o?.[k]; if (v !== "" && v != null) return String(v); } return ""; };
    const iso = (p) => String(p?.ISO_A3 || p?.ADM0_A3 || p?.iso_a3 || p?.WB_A3 || p?.ISO3 || "").toUpperCase();
    const nm  = (p) => p?.NAME_EN || p?.NAME_LONG || p?.ADMIN || p?.NAME || p?.BRK_NAME || iso(p) || "—";

    let flows = [], factors = {}, mapData = null;

    // Scales
    const widthScale = d3.scaleSqrt().range([1, 12]);
    const arrowColor = d3.scaleSequential(d3.interpolatePlasma).domain([0, 1]).clamp(true);

    // Mini boxes
    const VARS    = ["gdp_pc","aid_per_refugee","unemployment"];
    const COLORS  = { gdp_pc: "#60a5fa", aid_per_refugee: "#34d399", unemployment: "#fb923c" };
    const STROKES = { gdp_pc: "#1e3a8a", aid_per_refugee: "#065f46", unemployment: "#7c2d12" };
    const BOX_MIN = 8, BOX_MAX = 22;
    let miniScale = {}; // per-var

    const XFORM = {
      gdp_pc: d => Math.log1p(Math.max(0, d)),
      aid_per_refugee: d => Math.log1p(Math.max(0, d)),
      unemployment: d => Math.log1p(Math.max(0, (d > 1 ? d / 100 : d) * 100))
    };
    function buildMiniScales() {
      miniScale = {};
      for (const v of VARS) {
        const vals = Object.values(factors).map(r => XFORM[v](+r[v] || 0)).filter(Number.isFinite);
        const lo = d3.min(vals) ?? 0, hi = d3.max(vals) ?? 1;
        const dom = (lo === hi) ? [0, hi || 1] : [Math.max(0, lo), hi];
        miniScale[v] = d3.scaleSqrt().domain(dom).range([BOX_MIN, BOX_MAX]).clamp(true);
      }
    }

    const fmtNum = v => (v == null || isNaN(v)) ? "—" : d3.format(",")(Math.round(+v));
    const fmtPct = v => {
      if (v == null || isNaN(v)) return "—";
      const x = (+v > 1 ? +v / 100 : +v);
      return d3.format(".0%")(Math.max(0, Math.min(1, x)));
    };

    // Per-country centroid for mini placement
    const centroidLL = Object.create(null);

    // Load data
    try {
      const [mf, flowRaw, factorRows] = await Promise.all([
        d3.json("data/europe.geo.json").catch(() => d3.json("data/europe.topo.json").catch(() => null)),
        d3.json("data/flows_ua_agg.json").catch(() => []),
        d3.csv("data/country_factors.csv", d3.autoType).catch(() => [])
      ]);
      mapData = mf;

      flows = (Array.isArray(flowRaw) ? flowRaw : []).map(r => ({
        dest_iso3: gs(r, FLOW_KEYS.dest_iso3).toUpperCase(),
        lat: gf(r, FLOW_KEYS.lat),
        lon: gf(r, FLOW_KEYS.lon),
        total_refugees: gf(r, FLOW_KEYS.tot),
        pct_children: gf(r, COLOR_KEYS.kids),
        pct_women: gf(r, COLOR_KEYS.women),
        pct_elderly: gf(r, COLOR_KEYS.old)
      })).filter(r => Number.isFinite(r.lat) && Number.isFinite(r.lon));

      factors = {};
      for (const r of factorRows) {
        const k = gs(r, FACTOR_KEYS.iso).toUpperCase(); if (!k) continue;
        let un = gf(r, FACTOR_KEYS.un); if (un > 1) un /= 100;
        factors[k] = { gdp_pc: gf(r, FACTOR_KEYS.gdp), aid_per_refugee: gf(r, FACTOR_KEYS.aid), unemployment: un };
      }

      window.bb.flows = flows; window.bb.factors = factors; window.bb._mapData = mapData;

      if (flows.length) {
        const vals = flows.map(d => +d.total_refugees || 0).filter(Number.isFinite);
        const lo = d3.min(vals) ?? 1, hi = d3.max(vals) ?? 1;
        widthScale.domain(lo === hi ? [1, hi + 1] : [Math.max(1, lo), Math.max(1, hi)]);
      }
      buildMiniScales();

      // Countries (clickable contours + labels)
      function drawCountries() {
        let geo = null;
        if (!mapData) { console.warn("no mapData"); return; }
        if (mapData.type === "FeatureCollection") geo = mapData;
        else if (mapData.type === "Feature") geo = { type: "FeatureCollection", features: [mapData] };
        else if (mapData.type === "Topology") {
          if (!window.topojson || !topojson.feature) { console.warn("topojson-client missing"); return; }
          const objs = Object.values(mapData.objects || {}); if (!objs.length) return;
          geo = topojson.feature(mapData, objs[0]);
        }
        if (countryLayer) map.removeLayer(countryLayer);
        labelLayer.clearLayers();

        countryLayer = L.geoJSON(geo, {
          pane: "countries",
          style: () => ({ color: "#334155", weight: 1.1, opacity: 0.9, fill: true, fillOpacity: 0.10, fillColor: "#e7edf4" }),
          interactive: true,
          smoothFactor: 1.0,
          tolerance: 4,
          bubblingMouseEvents: false,
          onEachFeature: (feat, layer) => {
            const props = feat?.properties || {};
            const id = iso(props);
            const name = nm(props);

            const c = layer.getBounds().getCenter();
            centroidLL[id] = [c.lat, c.lng];

            // country label (non-interactive)
            L.marker(c, {
              pane: "labels",
              interactive: false,
              icon: L.divIcon({ className: "country-label", html: "<span>" + name + "</span>", iconSize: [0,0] })
            }).addTo(labelLayer);

            layer.on({
              mouseover: e => { e?.target?.setStyle?.({ weight: 1.8, opacity: 1, fillOpacity: 0.14 }); },
              mouseout:  e => { countryLayer?.resetStyle?.(e.target); },
              click: () => {
                const f = factors[id] || {};
                const ref = flows.find(x => x.dest_iso3 === id) || {};
                const panel = document.getElementById("info-body");
                if (panel) {
                  panel.innerHTML =
                    "<div><b>" + name + "</b> (" + (id || "—") + ")</div>" +
                    "<div>GDP pc: <b>" + fmtNum(f.gdp_pc) + "</b></div>" +
                    "<div>Aid / refugee: <b>" + fmtNum(f.aid_per_refugee) + "</b></div>" +
                    "<div>Unemployment: <b>" + fmtPct(f.unemployment) + "</b></div>" +
                    "<div style='margin-top:6px'>Children: <b>" + fmtPct(ref.pct_children) +
                    "</b> · Women: <b>" + fmtPct(ref.pct_women) +
                    "</b> · Elderly: <b>" + fmtPct(ref.pct_elderly) + "</b></div>";
                }
              }
            });
          }
        }).addTo(map);
      }

      // Arrows
      function getArrowColorValue(d) {
        const sel = document.getElementById("arrowColorVar");
        const key = sel?.value || "pct_children";
        let v = d[key]; if (!Number.isFinite(v)) v = 0; if (v > 1) v /= 100;
        return Math.max(0, Math.min(1, v));
      }
      function bez(a, c, b, n = 40) {
        const pts = [];
        for (let i = 0; i <= n; i++) {
          const t = i / n, u = 1 - t;
          pts.push([u*u*a.lat + 2*u*t*c.lat + t*t*b.lat, u*u*a.lng + 2*u*t*c.lng + t*t*b.lng]);
        }
        return pts;
      }
      function drawArrows() {
        arrowsGroup.clearLayers(); if (!flows.length) return;
        const origin = L.latLng(49.0, 32.0);
        for (const d of flows) {
          const dest = L.latLng(+d.lat, +d.lon);
          const ctrl = L.latLng((origin.lat + dest.lat) / 2 + 6, (origin.lng + dest.lng) / 2);
          L.polyline(bez(origin, ctrl, dest, 40), {
            pane: "arrows",
            color: arrowColor(getArrowColorValue(d)),
            weight: Math.max(1, widthScale(+d.total_refugees || 1)),
            opacity: 0.9, lineCap: "round", lineJoin: "round", interactive: false
          }).addTo(arrowsGroup);
        }
      }

      // Minis
      function project(lat, lon) { const p = map.latLngToLayerPoint([lat, lon]); return [p.x, p.y]; }
      function drawMinis() {
        const active = getActiveFactors();
        const mode = getBoxMode();
        const ids = Object.keys(factors);

        const data = ids.map(id => {
          const ll = centroidLL[id]; if (!ll) return null;
          const rec = factors[id] || {};
          const sizes = active.map(v => {
            const x = XFORM[v](+rec[v] || 0);
            const s = Math.max(BOX_MIN, Math.min(BOX_MAX, miniScale[v](x)));
            return { varName: v, s };
          });
          return { id, ll, sizes };
        }).filter(Boolean);

        const groups = miniRoot.selectAll("g.mini").data(data, d => d.id);
        const enter = groups.enter().append("g").attr("class", "mini");
        const merged = groups.merge(enter)
          .attr("transform", d => { const p = project(d.ll[0], d.ll[1]); return "translate(" + p[0] + "," + p[1] + ")"; });

        const rects = merged.selectAll("rect").data(d => d.sizes, s => s.varName);
        rects.enter().append("rect")
          .attr("rx", 2).attr("ry", 2).attr("stroke-width", 1)
          .merge(rects)
          .attr("fill", s => COLORS[s.varName] || "#9ca3af")
          .attr("stroke", s => STROKES[s.varName] || "#374151")
          .attr("x", function (s, i) {
            const d = this.parentNode.__data__;
            if (mode === "side") {
              const total = d3.sum(d.sizes, e => e.s) + (d.sizes.length - 1) * 2;
              const left = -total / 2 + d3.sum(d.sizes.slice(0, i), e => e.s) + i * 2;
              return left;
            } else {
              const maxS = d3.max(d.sizes, e => e.s);
              return -maxS / 2;
            }
          })
          .attr("y", function (s, i) {
            const d = this.parentNode.__data__;
            if (mode === "side") {
              const maxS = d3.max(d.sizes, e => e.s);
              return -maxS / 2;
            } else {
              const total = d3.sum(d.sizes, e => e.s) + (d.sizes.length - 1) * 2;
              const top = -total / 2 + d3.sum(d.sizes.slice(0, i), e => e.s) + i * 2;
              return top;
            }
          })
          .attr("width", function (s) {
            const d = this.parentNode.__data__;
            return (mode === "side") ? s.s : d3.max(d.sizes, e => e.s);
          })
          .attr("height", function (s) {
            const d = this.parentNode.__data__;
            return (mode === "side") ? d3.max(d.sizes, e => e.s) : s.s;
          });

        rects.exit().remove();
        groups.exit().remove();
      }

      // Legends
      function renderArrowLegend() {
        const root = d3.select("#legend-arrows"); root.selectAll("*").remove();
        const labelEl = document.getElementById("arrowColorVar");
        const label = labelEl?.selectedOptions?.[0]?.text || "Children %";
        const W = 240, H = 120, P = { t: 8, r: 14, b: 10, l: 14 }, gradH = 12;
        const svg = root.append("svg").attr("class", "legend").attr("width", W).attr("height", H);
        svg.append("text").attr("x", P.l).attr("y", P.t + 12).attr("class", "legend-title").text("Arrow color — " + label);
        const defs = svg.append("defs");
        const grad = defs.append("linearGradient").attr("id", "arrowGrad").attr("x1", "0%").attr("x2", "100%");
        d3.range(0, 1.001, 0.05).forEach(t => grad.append("stop").attr("offset", String(Math.round(t * 100)) + "%").attr("stop-color", arrowColor(t)));
        const gradW = W - P.l - P.r, g = svg.append("g").attr("transform", "translate(" + P.l + "," + (P.t + 18) + ")");
        g.append("rect").attr("width", gradW).attr("height", gradH).attr("fill", "url(#arrowGrad)").attr("stroke", "#ddd");
        const axis = d3.scaleLinear().domain([0, 100]).range([0, gradW]); const ticks = [0, 25, 50, 75, 100];
        const gt = g.append("g").attr("transform", "translate(0," + gradH + ")");
        gt.selectAll("g.tick").data(ticks).enter().append("g").attr("class", "tick")
          .attr("transform", d => "translate(" + axis(d) + ",0)")
          .each(function (d) {
            d3.select(this).append("line").attr("y1", 0).attr("y2", 6).attr("stroke", "#9ca3af");
            d3.select(this).append("text").attr("y", 18).attr("text-anchor", "middle").attr("class", "legend-tick").text(String(d) + "%");
          });
        const dom = widthScale.domain(), lo = dom[0], hi = dom[1], mid = (lo + hi) / 2;
        const samples = [lo, mid, hi].map(v => ({ label: formatCount(v), w: Math.max(1, widthScale(v)) }));
        const rows = svg.append("g").attr("transform", "translate(" + P.l + "," + (P.t + 18 + gradH + 38) + ")");
        rows.selectAll("g.row").data(samples).enter().append("g").attr("class", "row")
          .attr("transform", (_, i) => "translate(0," + (i * 18) + ")")
          .each(function (d) {
            d3.select(this).append("line").attr("x1", 0).attr("x2", 64).attr("y1", 0).attr("y2", 0)
              .attr("stroke", "#6b7280").attr("stroke-linecap", "round").attr("stroke-width", d.w);
            d3.select(this).append("text").attr("x", 72).attr("y", 4).attr("class", "legend-tick").text(d.label);
          });
      }
      function renderBoxLegend() {
        const root = d3.select("#legend-boxes"); root.selectAll("*").remove();
        const active = getActiveFactors(); if (!active.length) return;
        const W = 240, ROWH = 16, H = 10 + active.length * (ROWH + 8) + 6;
        const svg = root.append("svg").attr("class", "legend").attr("width", W).attr("height", H);
        svg.append("text").attr("x", 12).attr("y", 14).attr("class", "legend-title").text("Country minis — factors");
        const rows = svg.selectAll(".row").data(active).enter().append("g").attr("class", "row").attr("transform", (_, i) => "translate(12," + (22 + i * (ROWH + 8)) + ")");
        rows.append("rect").attr("width", ROWH).attr("height", ROWH).attr("rx", 3).attr("ry", 3)
          .attr("fill", d => COLORS[d] || "#9ca3af").attr("stroke", d => STROKES[d] || "#374151");
        rows.append("text").attr("x", ROWH + 8).attr("y", ROWH - 4).attr("class", "legend-tick")
          .text(d => ({ gdp_pc: "GDP per capita", aid_per_refugee: "Aid per refugee", unemployment: "Unemployment" }[d] || d));
      }

      // Initial draw
      safe(drawCountries, "[init:countries]");
      safe(drawArrows, "[init:arrows]");
      safe(drawMinis, "[init:minis]");
      safe(renderArrowLegend, "[legend:arrows]");
      safe(renderBoxLegend, "[legend:boxes]");

      map.on("moveend zoomend", () => safe(drawMinis, "[event:minis]"));

      document.querySelectorAll(".controls input, .controls select").forEach(el => {
        el.addEventListener("change", () => {
          buildMiniScales();
          safe(drawArrows, "[ui:arrows]");
          safe(drawMinis, "[ui:minis]");
          safe(renderArrowLegend, "[ui:legend-arrows]");
          safe(renderBoxLegend, "[ui:legend-boxes]");
        });
      });

      document.getElementById("resetBtn")?.addEventListener("click", () => {
        document.querySelectorAll('.controls input[type=checkbox]').forEach(el => el.checked = false);
        const sel = document.getElementById("arrowColorVar"); if (sel) sel.value = "pct_children";
        const radio = document.querySelector('input[name=boxmode][value="stack"]'); if (radio) radio.checked = true;
        buildMiniScales();
        safe(drawArrows, "[reset:arrows]");
        safe(drawMinis, "[reset:minis]");
        safe(renderArrowLegend, "[reset:legend-arrows]");
        safe(renderBoxLegend, "[reset:legend-boxes]");
      });

    } catch (e) { console.error("[load error]", e); }
    finally { window.bb.ready = true; window.dispatchEvent(new Event("bb:ready")); }
  })();
})();
