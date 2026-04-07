"use client";
import React, {
  useEffect,
  useRef,
  useState,
  useCallback,
  useMemo,
} from "react";
import type { ElementDefinition } from "cytoscape";
import { X, RefreshCw, Info, Sun, Moon } from "lucide-react";

// ─── TYPES ────────────────────────────────────────────────────────────────────
interface GözEntity {
  type: string;
  label: string;
}

interface GözEvent {
  id: string;
  type: string;
  timestamp: number;
  title: string;
  summary: string;
  link: string;
  entities: GözEntity[];
  isAnomaly: boolean;
  anomalyReason?: string;
  mag?: number;
}

interface EntityNode {
  id: string;
  label: string;
  type: string;
  count: number;
}

interface ToastMsg {
  id: string;
  title: string;
  message: string;
  kind: "warning" | "info" | "error";
}

interface DetailPanel {
  kind: "event" | "entity";
  eventId?: string;
  entityId?: string;
}

// ─── CONSTANTS ────────────────────────────────────────────────────────────────
const RSS_FEEDS = [
  "https://feeds.feedburner.com/TheHackersNews",
  "https://www.cisa.gov/cybersecurity-advisories/all.xml",
  "https://www.gdacs.org/xml/rss.xml",
  "https://reliefweb.int/updates/rss.xml",
  "https://cert.gov.ua/api/rss",
];
const USGS_API =
  "https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/4.5_week.geojson";
const OPENSKY_API =
  "https://opensky-network.org/api/states/all?lamin=34&lomin=25&lamax=42&lomax=45";
const NOAA_API = "https://services.swpc.noaa.gov/products/alerts.json";
const STORAGE_KEY = "gozcu-events-v1";

// ─── COMPONENT ────────────────────────────────────────────────────────────────
const Gozcu: React.FC<{ onClose: () => void }> = ({ onClose }) => {
  const [events, setEvents] = useState<GözEvent[]>([]);
  const [entitiesMap, setEntitiesMap] = useState<Map<string, EntityNode>>(
    new Map()
  );
  const [isDark, setIsDark] = useState(false);
  const [statusMsg, setStatusMsg] = useState("Sistem Başlatılıyor...");
  const [statusVisible, setStatusVisible] = useState(true);
  const [statusError, setStatusError] = useState(false);
  const [timeRange, setTimeRange] = useState<"24h" | "7d" | "all">("7d");
  const [detail, setDetail] = useState<DetailPanel | null>(null);
  const [toasts, setToasts] = useState<ToastMsg[]>([]);
  const [infoOpen, setInfoOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");

  const cyContainerRef = useRef<HTMLDivElement>(null);
  const cyRef = useRef<any>(null);
  const cyLayoutRef = useRef<any>(null);
  const cyElementsRef = useRef<ElementDefinition[]>([]);
  const eventsRef = useRef<GözEvent[]>([]);

  useEffect(() => {
    eventsRef.current = events;
  }, [events]);

  // ─── TOAST ──────────────────────────────────────────────────────────────────
  const showToast = useCallback(
    (
      title: string,
      message: string,
      kind: "warning" | "info" | "error" = "warning"
    ) => {
      const id = Math.random().toString(36).slice(2);
      setToasts((prev) => [...prev.slice(-2), { id, title, message, kind }]);
      setTimeout(() => setToasts((prev) => prev.filter((t) => t.id !== id)), 5000);
    },
    []
  );

  // ─── UTILS ──────────────────────────────────────────────────────────────────
  const hashString = useCallback(async (str: string): Promise<string> => {
    const buf = await crypto.subtle.digest(
      "SHA-256",
      new TextEncoder().encode(str)
    );
    return Array.from(new Uint8Array(buf))
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("")
      .substring(0, 16);
  }, []);

  const slugify = useCallback(
    (text: string) =>
      text
        .toString()
        .toLowerCase()
        .trim()
        .replace(/[\s\W-]+/g, "-"),
    []
  );

  const parseRawXml = useCallback((xmlString: string) => {
    if (typeof DOMParser === "undefined") return [];
    const parser = new DOMParser();
    const doc = parser.parseFromString(xmlString, "text/xml");
    return Array.from(doc.querySelectorAll("item")).map((item) => ({
      title: item.querySelector("title")?.textContent || "Başlık Yok",
      link: item.querySelector("link")?.textContent || "#",
      pubDate:
        item.querySelector("pubDate")?.textContent ||
        new Date().toISOString(),
      description: item.querySelector("description")?.textContent || "",
      categories: Array.from(item.querySelectorAll("category")).map(
        (c) => c.textContent || ""
      ),
    }));
  }, []);

  // ─── FETCH WITH BACKOFF + PROXY FALLBACK ────────────────────────────────────
  const fetchWithBackoff = useCallback(
    async (
      targetUrl: string,
      isRss = false,
      maxRetries = 3,
      baseDelay = 1000,
      useProxyFirst = false
    ): Promise<any> => {
      const proxies = [
        `https://api.allorigins.win/get?url=${encodeURIComponent(targetUrl)}`,
        `https://corsproxy.io/?${encodeURIComponent(targetUrl)}`,
      ];
      const urls = useProxyFirst
        ? [proxies[0], targetUrl, proxies[1]]
        : [targetUrl, proxies[0], proxies[1]];

      for (const url of urls) {
        for (let r = 0; r < maxRetries; r++) {
          try {
            const resp = await fetch(url, {
              signal: AbortSignal.timeout(12000),
            });
            if (!resp.ok) {
              if (resp.status === 429) {
                const wait =
                  parseInt(resp.headers.get("Retry-After") || "0", 10) *
                    1000 ||
                  baseDelay * 2 ** r;
                await new Promise((res) => setTimeout(res, wait));
                continue;
              }
              break;
            }
            const text = await resp.text();
            let data: any;
            try {
              data = JSON.parse(text);
            } catch {
              data = null;
            }
            // allorigins wraps in `contents`
            if (data && typeof data.contents === "string") {
              if (isRss) return parseRawXml(data.contents);
              try {
                return JSON.parse(data.contents);
              } catch {
                return data.contents;
              }
            }
            if (isRss) return parseRawXml(text);
            return data ?? text;
          } catch {
            if (r < maxRetries - 1)
              await new Promise((res) => setTimeout(res, baseDelay * 2 ** r));
          }
        }
      }
      return isRss ? [] : null;
    },
    [parseRawXml]
  );

  // ─── ENTITY EXTRACTION ──────────────────────────────────────────────────────
  const extractEntities = useCallback(
    (title: string, description: string, _cats: string[]): GözEntity[] => {
      const text = (title || "") + " " + (description || "");
      const entities: GözEntity[] = [];

      const cveRx = /(CVE-\d{4}-\d{4,7})/gi;
      let m: RegExpExecArray | null;
      while ((m = cveRx.exec(text)) !== null)
        entities.push({ type: "cve", label: m[1].toUpperCase() });

      const aptRx =
        /\b(APT\s?\d+|Lazarus|Fancy Bear|Cozy Bear|Turla|Sandworm|Kimsuky)\b/gi;
      while ((m = aptRx.exec(text)) !== null)
        entities.push({ type: "apt", label: m[1].toUpperCase() });

      const locRx =
        /\b(Russia|China|Ukraine|Israel|Iran|USA|NATO|Turkey|Syria|Europe|Middle East)\b/gi;
      while ((m = locRx.exec(text)) !== null)
        entities.push({ type: "location", label: m[1] });

      const disRx = /\b(Earthquake|Flood|Cyclone|Tsunami|Volcano)\b/gi;
      while ((m = disRx.exec(text)) !== null)
        entities.push({ type: "category", label: m[1] });

      const seen = new Set<string>();
      return entities.filter((e) => {
        const k = e.type + "_" + e.label;
        if (seen.has(k)) return false;
        seen.add(k);
        return true;
      });
    },
    []
  );

  // ─── GEMINI AI ANOMALY DETECTION ────────────────────────────────────────────
  const analyzeAnomalies = useCallback(
    async (
      evts: GözEvent[]
    ): Promise<Array<{ id: string; reason: string }>> => {
      const apiKey = ""; // Kendi Gemini API anahtarınızı buraya girin
      if (!apiKey) return [];
      const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-preview-09-2025:generateContent?key=${apiKey}`;
      const payload = {
        contents: [
          {
            parts: [
              {
                text: `Aşağıdaki olayları analiz et ve olağandışı/anormal olanları JSON array olarak döndür. Format: [{"id":"...", "reason":"..."}]\n\nOlaylar:\n${JSON.stringify(
                  evts.map((e) => ({
                    id: e.id,
                    type: e.type,
                    title: e.title,
                    summary: e.summary,
                  }))
                )}`,
              },
            ],
          },
        ],
      };
      const delays = [1000, 2000, 4000, 8000, 16000];
      for (let i = 0; i < delays.length; i++) {
        try {
          const res = await fetch(url, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(payload),
          });
          if (res.status === 429) {
            const wait =
              parseInt(res.headers.get("Retry-After") || "0", 10) * 1000 ||
              delays[i];
            await new Promise((r) => setTimeout(r, wait + Math.random() * 500));
            continue;
          }
          if (!res.ok) return [];
          const data = await res.json();
          const text =
            data.candidates?.[0]?.content?.parts?.[0]?.text || "";
          const jsonMatch = text.match(/\[[\s\S]*\]/);
          if (!jsonMatch) return [];
          return JSON.parse(jsonMatch[0]);
        } catch {
          if (i < delays.length - 1)
            await new Promise((r) => setTimeout(r, delays[i]));
        }
      }
      return [];
    },
    []
  );

  // ─── MAIN DATA SYNC ─────────────────────────────────────────────────────────
  const syncData = useCallback(async () => {
    setStatusMsg("Dış kaynaklardan canlı veriler toplanıyor...");
    setStatusVisible(true);
    setStatusError(false);
    const collected: GözEvent[] = [];

    // RSS feeds
    for (const feedUrl of RSS_FEEDS) {
      try {
        const items = await fetchWithBackoff(feedUrl, true, 3, 1000);
        for (const item of items || []) {
          const ts = new Date(item.pubDate).getTime() || Date.now();
          const id = await hashString("rss" + item.title + ts);
          let type = "osint";
          if (feedUrl.includes("gdacs.org")) type = "disaster";
          if (feedUrl.includes("cert.gov.ua")) type = "regional_threat";
          const fullText = (item.title + " " + item.description).toLowerCase();
          if (
            feedUrl.includes("reliefweb.int") ||
            fullText.includes("sentinel") ||
            fullText.includes("satellite") ||
            fullText.includes("copernicus")
          )
            type = "satellite_monitoring";
          collected.push({
            id,
            type,
            timestamp: ts,
            title: item.title,
            summary: (item.description || "")
              .replace(/(<([^>]+)>)/gi, "")
              .substring(0, 300),
            link: item.link,
            entities: extractEntities(
              item.title,
              item.description,
              item.categories
            ),
            isAnomaly: false,
          });
        }
      } catch { /* devam et */ }
    }

    // USGS earthquakes
    try {
      const eq = await fetchWithBackoff(USGS_API, false, 3, 1000);
      for (const f of eq?.features || []) {
        const p = f.properties;
        const id = await hashString("eq" + f.id);
        const loc = p.place.split(" of ").pop() || "Bilinmeyen";
        collected.push({
          id,
          type: "earthquake",
          timestamp: p.time,
          mag: parseFloat(p.mag),
          title: `Deprem: ${p.title}`,
          summary: `Şiddet: ${p.mag}, Derinlik: ${f.geometry.coordinates[2]}km. Tsunami Uyarısı: ${
            p.tsunami ? "Var" : "Yok"
          }`,
          link: p.url,
          entities: [
            { type: "location", label: loc },
            { type: "category", label: "Sismik Aktivite" },
          ],
          isAnomaly: false,
        });
      }
    } catch { /* devam et */ }

    // NOAA space weather
    try {
      const noaa = await fetchWithBackoff(NOAA_API, false, 3, 1000);
      for (const a of (noaa || []).slice(0, 5)) {
        const id = await hashString("noaa" + a.issue_datetime);
        collected.push({
          id,
          type: "space_weather",
          timestamp: new Date(a.issue_datetime).getTime(),
          title: "NOAA Uyarısı: Güneş/Uydu Aktivitesi",
          summary: a.message.substring(0, 300),
          link: "https://www.swpc.noaa.gov/",
          entities: [{ type: "category", label: "Uzay Hava Durumu" }],
          isAnomaly: false,
        });
      }
    } catch { /* devam et */ }

    // OpenSky flights
    try {
      const flight = await fetchWithBackoff(OPENSKY_API, false, 2, 500, true);
      for (const s of (flight?.states || []).slice(0, 10)) {
        const callsign = (s[1] || "Unknown").trim();
        const id = await hashString("fl" + callsign + s[3]);
        collected.push({
          id,
          type: "flight",
          timestamp: (s[3] || Math.floor(Date.now() / 1000)) * 1000,
          title: `Uçuş Tespiti: ${callsign}`,
          summary: `Kaynak Ülke: ${s[2]}. İrtifa: ${s[7]}m. Hız: ${s[9]}m/s. Konum: [${s[6]}, ${s[5]}]`,
          link: `https://globe.adsbexchange.com/?icao=${s[0]}`,
          entities: [
            { type: "location", label: s[2] },
            { type: "category", label: "Havacılık İzi" },
          ],
          isAnomaly: false,
        });
      }
    } catch { /* devam et */ }

    if (collected.length === 0) {
      setStatusError(true);
      setStatusMsg(
        "Veri mevcut değil. Dış kaynaklara erişim kısıtlı olabilir."
      );
      return;
    }

    // AI anomaly analysis
    setStatusMsg("Yapay Zeka (Gemini) anomalileri analiz ediyor...");
    const anomalies = await analyzeAnomalies(collected);
    const anomalyMap = new Map(anomalies.map((a) => [a.id, a.reason]));

    const finalEvents = collected.map((ev) => {
      if (anomalyMap.has(ev.id)) {
        if (ev.type === "earthquake" && (ev.mag || 0) >= 5.0) {
          showToast(
            "Yüksek Şiddetli Deprem Tespit Edildi",
            ev.title,
            "warning"
          );
        } else if (anomalyMap.has(ev.id)) {
          showToast(
            "Yeni AI Anomalisi",
            anomalyMap.get(ev.id) || ev.title,
            "warning"
          );
        }
        return {
          ...ev,
          isAnomaly: true,
          anomalyReason: anomalyMap.get(ev.id),
          entities: [
            ...ev.entities,
            { type: "anomaly", label: "Yapay Zeka Tespiti" },
          ],
        };
      }
      return ev;
    });

    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(finalEvents));
    } catch { /* quota */ }
    setEvents(finalEvents);
    setStatusVisible(false);
  }, [fetchWithBackoff, hashString, extractEntities, analyzeAnomalies, showToast]);

  // ─── INIT: LOAD FROM LOCALSTORAGE OR FETCH ──────────────────────────────────
  useEffect(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      if (saved) {
        const parsed = JSON.parse(saved) as GözEvent[];
        if (parsed.length > 0) {
          setEvents(parsed);
          setStatusVisible(false);
          return;
        }
      }
    } catch { /* ignore */ }
    syncData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ─── FILTERED EVENTS ────────────────────────────────────────────────────────
  const filteredEvents = useMemo(() => {
    const now = Date.now();
    let cutoff = 0;
    if (timeRange === "24h") cutoff = now - 86400000;
    else if (timeRange === "7d") cutoff = now - 604800000;
    return events
      .filter((e) => e.timestamp >= cutoff)
      .sort((a, b) => b.timestamp - a.timestamp)
      .slice(0, 120);
  }, [events, timeRange]);

  // ─── BUILD GRAPH ELEMENTS ───────────────────────────────────────────────────
  useEffect(() => {
    if (filteredEvents.length === 0) return;

    const map = new Map<string, EntityNode>();
    const elements: ElementDefinition[] = [];
    const addedEdges = new Set<string>();

    filteredEvents.forEach((ev) => {
      elements.push({
        data: {
          id: ev.id,
          label: ev.title,
          nodeType: ev.type,
          isAnomaly: ev.isAnomaly,
          weight: 1,
        },
      });
      ev.entities.forEach((ent) => {
        const entId = `ent_${ent.type}_${slugify(ent.label)}`;
        if (!map.has(entId)) {
          map.set(entId, { id: entId, label: ent.label, type: ent.type, count: 0 });
          elements.push({
            data: { id: entId, label: ent.label, nodeType: ent.type, weight: 1 },
          });
        }
        const edgeId = `edge_${ev.id}_${entId}`;
        if (!addedEdges.has(edgeId)) {
          addedEdges.add(edgeId);
          elements.push({ data: { id: edgeId, source: ev.id, target: entId } });
        }
      });
    });

    // Count references per entity
    map.forEach((entObj, entId) => {
      let count = 0;
      filteredEvents.forEach((ev) => {
        if (
          ev.entities.some(
            (e) => e.label === entObj.label && e.type === entObj.type
          )
        )
          count++;
      });
      entObj.count = count;
      const node = elements.find((e) => e.data.id === entId);
      if (node) node.data.weight = count;
    });

    cyElementsRef.current = elements;
    setEntitiesMap(new Map(map));
    updateCytoscape(elements, isDark);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filteredEvents]);

  // ─── CYTOSCAPE STYLE ────────────────────────────────────────────────────────
  const getCyStyle = useCallback(
    (dark: boolean) => [
      {
        selector: "node",
        style: {
          label: "data(label)",
          "font-size": "8px",
          color: dark ? "#94a3b8" : "#475569",
          "text-valign": "bottom",
          "text-margin-y": 4,
          "text-background-color": dark ? "#020617" : "#ffffff",
          "text-background-opacity": 0.7,
          "text-background-padding": "2px",
          width: (ele: any) =>
            Math.max(12, Math.min(48, 10 + (ele.data("weight") || 1) * 4)),
          height: (ele: any) =>
            Math.max(12, Math.min(48, 10 + (ele.data("weight") || 1) * 4)),
          "background-color": dark ? "#e2e8f0" : "#64748b",
          "border-width": 1,
          "border-color": dark ? "#0f172a" : "#ffffff",
        },
      },
      {
        selector: 'node[nodeType = "osint"]',
        style: { shape: "ellipse", width: 14, height: 14, label: "" },
      },
      {
        selector: 'node[nodeType = "earthquake"]',
        style: {
          shape: "ellipse",
          "background-color": "#f97316",
          "border-color": "#c2410c",
          width: 16,
          height: 16,
          label: "",
        },
      },
      {
        selector: 'node[nodeType = "flight"]',
        style: {
          shape: "ellipse",
          "background-color": "#06b6d4",
          "border-color": "#0e7490",
          width: 14,
          height: 14,
          label: "",
        },
      },
      {
        selector: 'node[nodeType = "disaster"]',
        style: {
          shape: "ellipse",
          "background-color": "#f43f5e",
          "border-color": "#be123c",
          width: 16,
          height: 16,
          label: "",
        },
      },
      {
        selector: 'node[nodeType = "space_weather"]',
        style: {
          shape: "ellipse",
          "background-color": "#facc15",
          "border-color": "#ca8a04",
          width: 18,
          height: 18,
          label: "",
        },
      },
      {
        selector: 'node[nodeType = "satellite_monitoring"]',
        style: {
          shape: "round-rectangle",
          "background-color": "#14b8a6",
          "border-color": "#0f766e",
          width: 16,
          height: 16,
          label: "",
        },
      },
      {
        selector: 'node[nodeType = "regional_threat"]',
        style: {
          shape: "pentagon",
          "background-color": "#f97316",
          "border-color": "#c2410c",
          width: 18,
          height: 18,
          label: "",
        },
      },
      {
        selector: 'node[nodeType = "cve"]',
        style: {
          shape: "diamond",
          "background-color": "#ef4444",
          "border-color": "#991b1b",
        },
      },
      {
        selector: 'node[nodeType = "apt"]',
        style: {
          shape: "hexagon",
          "background-color": "#a855f7",
          "border-color": "#6b21a8",
        },
      },
      {
        selector: 'node[nodeType = "location"]',
        style: {
          shape: "triangle",
          "background-color": "#3b82f6",
          "border-color": "#1e3a8a",
        },
      },
      {
        selector: 'node[nodeType = "category"]',
        style: {
          shape: "round-rectangle",
          "background-color": "#10b981",
          "border-color": "#064e3b",
        },
      },
      {
        selector: "node[?isAnomaly]",
        style: {
          "underlay-color": "#f43f5e",
          "underlay-padding": "8px",
          "underlay-opacity": 0.8,
        },
      },
      {
        selector: 'node[nodeType = "anomaly"]',
        style: {
          shape: "star",
          "background-color": "#e11d48",
          "border-color": "#9f1239",
          width: 28,
          height: 28,
          color: "#f43f5e",
          "font-size": "10px",
        },
      },
      {
        selector: "edge",
        style: {
          width: 1.5,
          "line-color": dark ? "#334155" : "#cbd5e1",
          opacity: 0.6,
          "curve-style": "bezier",
          "target-arrow-shape": "triangle",
          "target-arrow-color": dark ? "#334155" : "#cbd5e1",
          "arrow-scale": 0.8,
        },
      },
      { selector: ":selected", style: { "border-width": 4, "border-color": "#f59e0b" } },
      {
        selector: "node:selected",
        style: {
          width: (ele: any) =>
            Math.max(26, (ele.data("weight") || 1) * 4 + 14),
          height: (ele: any) =>
            Math.max(26, (ele.data("weight") || 1) * 4 + 14),
        },
      },
    ],
    []
  );

  // ─── CYTOSCAPE INIT / UPDATE ─────────────────────────────────────────────────
  const updateCytoscape = useCallback(
    async (elements: ElementDefinition[], dark: boolean) => {
      if (!cyContainerRef.current) return;
      const cytoscape = (await import("cytoscape")).default;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const style = getCyStyle(dark) as any;

      if (!cyRef.current || cyRef.current.destroyed()) {
        cyRef.current = cytoscape({
          container: cyContainerRef.current,
          elements,
          style,
          userZoomingEnabled: true,
          userPanningEnabled: true,
          minZoom: 0.1,
          maxZoom: 4,
        });

        cyRef.current.on("tap", "node", (evt: any) => {
          const node = evt.target;
          cyRef.current.$(':selected').unselect();
          node.select();
          const type = node.data("nodeType");
          const eventTypes = [
            "osint", "earthquake", "flight", "disaster",
            "space_weather", "satellite_monitoring", "regional_threat",
          ];
          if (eventTypes.includes(type)) {
            setDetail({ kind: "event", eventId: node.id() });
          } else {
            setDetail({ kind: "entity", entityId: node.id() });
          }
        });

        cyRef.current.on("tap", (evt: any) => {
          if (evt.target === cyRef.current) {
            setDetail(null);
          }
        });

        window.addEventListener("resize", () => {
          clearTimeout((window as any).__gozuResizeTimer);
          (window as any).__gozuResizeTimer = setTimeout(() => {
            if (cyRef.current && !cyRef.current.destroyed()) {
              cyRef.current.resize();
              cyRef.current.fit(cyRef.current.elements(), 80);
            }
          }, 200);
        });
      } else {
        if (cyLayoutRef.current) cyLayoutRef.current.stop();
        cyRef.current.elements().stop(true, true);
        cyRef.current.batch(() => {
          cyRef.current.elements().remove();
          cyRef.current.add(elements);
        });
        cyRef.current.style().fromJson(style).update();
      }

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      cyLayoutRef.current = cyRef.current.layout({
        name: "cose",
        animate: true,
        idealEdgeLength: 80,
        nodeRepulsion: 7000,
        edgeElasticity: 150,
        gravity: 1.2,
        padding: 40,
      } as any);
      cyLayoutRef.current.run();
      cyLayoutRef.current.promiseOn("layoutstop").then(() => {
        if (cyRef.current && !cyRef.current.destroyed()) {
          cyRef.current.fit(cyRef.current.elements(), 80);
        }
      });
    },
    [getCyStyle]
  );

  // ─── DARK MODE → UPDATE CYTOSCAPE STYLE ─────────────────────────────────────
  useEffect(() => {
    if (cyRef.current && !cyRef.current.destroyed()) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      cyRef.current.style().fromJson(getCyStyle(isDark) as any).update();
    }
  }, [isDark, getCyStyle]);

  // ─── SEARCH → FILTER GRAPH ──────────────────────────────────────────────────
  useEffect(() => {
    if (!cyRef.current || cyRef.current.destroyed()) return;
    if (!searchQuery) {
      cyRef.current.elements().removeClass("faded").style({ opacity: 1 });
      return;
    }
    cyRef.current.elements().addClass("faded").style({ opacity: 0.1 });
    const matching = cyRef.current
      .nodes()
      .filter((n: any) =>
        (n.data("label") || "")
          .toLowerCase()
          .includes(searchQuery.toLowerCase())
      );
    if (matching.length > 0) {
      const connected = matching.union(matching.neighborhood());
      connected.removeClass("faded").style({ opacity: 1 });
    }
  }, [searchQuery]);

  // ─── GRAPH HELPERS ──────────────────────────────────────────────────────────
  const highlightCategory = useCallback((entId: string) => {
    if (!cyRef.current || cyRef.current.destroyed()) return;
    cyRef.current.elements().stop(true, true);
    cyRef.current.elements().addClass("faded").style({ opacity: 0.1 });
    const node = cyRef.current.getElementById(entId);
    if (node.length > 0) {
      const connected = node.closedNeighborhood();
      connected.removeClass("faded").style({ opacity: 1 });
      cyRef.current.animate({ fit: { eles: connected, padding: 40 }, duration: 500 });
    }
  }, []);

  const highlightGroup = useCallback(
    (entIds: string[]) => {
      if (!cyRef.current || cyRef.current.destroyed()) return;
      cyRef.current.elements().stop(true, true);
      cyRef.current.elements().addClass("faded").style({ opacity: 0.1 });
      let coll = cyRef.current.collection();
      entIds.forEach((entId) => {
        const n = cyRef.current.getElementById(entId);
        if (n.length > 0) coll = coll.union(n.closedNeighborhood());
      });
      if (coll.length > 0) {
        coll.removeClass("faded").style({ opacity: 1 });
        setTimeout(
          () =>
            cyRef.current?.animate({
              fit: { eles: coll, padding: 40 },
              duration: 500,
            }),
          50
        );
      } else {
        cyRef.current.elements().removeClass("faded").style({ opacity: 1 });
        cyRef.current.fit();
      }
    },
    []
  );

  const resetGraph = useCallback(() => {
    if (!cyRef.current || cyRef.current.destroyed()) return;
    cyRef.current.elements().stop(true, true);
    cyRef.current.elements().removeClass("faded").style({ opacity: 1 });
    cyRef.current.fit();
  }, []);

  // ─── CATEGORY GROUPING ──────────────────────────────────────────────────────
  const getCategoryGroup = useCallback((entObj: EntityNode) => {
    const { type, label } = entObj;
    if (type === "anomaly") return "🚨 AI Anomalileri";
    const cyberTags = [
      "malware", "cyber", "ransomware", "hack", "breach",
      "phishing", "siber", "zafiyet", "güvenlik",
    ];
    if (
      type === "cve" ||
      type === "apt" ||
      (type === "category" && cyberTags.some((t) => label.toLowerCase().includes(t)))
    )
      return "💻 Siber Güvenlik Olayları";
    const physicalTags = [
      "earthquake", "flood", "tsunami", "volcano", "sismik",
      "uzay hava", "afet", "disaster", "flight", "havacılık", "uydu",
    ];
    if (
      type === "location" ||
      (type === "category" && physicalTags.some((t) => label.toLowerCase().includes(t)))
    )
      return "🌍 Fiziksel Güvenlik Olayları";
    if (type === "category") return "🟢 Etiketler";
    return "📁 Diğer";
  }, []);

  const groupedCategories = useMemo(() => {
    const groups: Record<string, Array<{ entId: string; entObj: EntityNode }>> = {};
    entitiesMap.forEach((entObj, entId) => {
      const g = getCategoryGroup(entObj);
      if (!groups[g]) groups[g] = [];
      groups[g].push({ entId, entObj });
    });
    Object.keys(groups).forEach((g) =>
      groups[g].sort((a, b) => b.entObj.count - a.entObj.count)
    );
    return groups;
  }, [entitiesMap, getCategoryGroup]);

  // ─── DETAIL HELPERS ─────────────────────────────────────────────────────────
  const detailEvent = useMemo(
    () =>
      detail?.kind === "event"
        ? eventsRef.current.find((e) => e.id === detail.eventId) ?? null
        : null,
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [detail, events]
  );
  const detailEntity = useMemo(
    () =>
      detail?.kind === "entity"
        ? entitiesMap.get(detail.entityId!) ?? null
        : null,
    [detail, entitiesMap]
  );

  const getTypeName = (type: string) =>
    ({
      earthquake: "Sismik Olay",
      flight: "Havacılık İzi",
      disaster: "Küresel Afet Uyarısı",
      space_weather: "Uzay Hava Durumu",
      satellite_monitoring: "Uydu Görüntü Analizi",
      regional_threat: "Bölgesel Tehdit İstihbaratı",
    }[type] || "OSINT Raporu");

  const getRelatedAnomalies = (ev: GözEvent) =>
    eventsRef.current
      .filter(
        (e) =>
          e.isAnomaly &&
          e.id !== ev.id &&
          e.entities.some((e1) =>
            ev.entities.some(
              (e2) => e1.label === e2.label && e1.type === e2.type
            )
          )
      )
      .sort((a, b) => b.timestamp - a.timestamp)
      .slice(0, 5);

  const getEntityAnomalies = (ent: EntityNode) =>
    eventsRef.current
      .filter(
        (e) =>
          e.isAnomaly &&
          e.entities.some(
            (eEnt) => eEnt.label === ent.label && eEnt.type === ent.type
          )
      )
      .sort((a, b) => b.timestamp - a.timestamp)
      .slice(0, 10);

  // ─── CLEANUP ────────────────────────────────────────────────────────────────
  useEffect(() => {
    return () => {
      if (cyRef.current && !cyRef.current.destroyed())
        cyRef.current.destroy();
    };
  }, []);

  // ─── RENDER ─────────────────────────────────────────────────────────────────
  const closeDetail = () => {
    setDetail(null);
    if (cyRef.current && !cyRef.current.destroyed())
      cyRef.current.$(':selected').unselect();
  };

  const panelBase = isDark
    ? "bg-slate-950 border-slate-800 text-slate-100"
    : "bg-white border-slate-200 text-slate-900";
  const btnBase = isDark
    ? "border-slate-700 text-slate-300 bg-slate-900 hover:bg-slate-800"
    : "border-slate-300 text-slate-700 bg-white hover:bg-slate-50";
  const inputBase = isDark
    ? "bg-slate-900 border-slate-700 text-slate-100 placeholder:text-slate-500"
    : "bg-white border-slate-300 text-slate-900 placeholder:text-slate-400";

  return (
    <div
      className="fixed inset-0 z-50 flex flex-col"
      style={{ background: isDark ? "#020617" : "#f8fafc" }}
    >
      {/* ── HEADER ──────────────────────────────────────────────────────────── */}
      <header
        className={`flex items-center gap-2 px-3 py-2 border-b shrink-0 shadow-sm ${panelBase}`}
      >
        <span
          className={`font-bold text-sm tracking-widest uppercase ${isDark ? "text-emerald-400" : "text-emerald-600"}`}
        >
          GÖZCÜ
        </span>
        <span
          className={`text-xs hidden sm:inline ${isDark ? "text-slate-500" : "text-slate-400"}`}
        >
          Küresel İstihbarat & Anomali Ağı
        </span>
        <div className="flex-1" />

        {/* Time range */}
        <select
          value={timeRange}
          onChange={(e) => setTimeRange(e.target.value as any)}
          className={`text-xs rounded-lg px-2 py-1.5 border outline-none cursor-pointer ${inputBase}`}
        >
          <option value="24h">Son 24 Saat</option>
          <option value="7d">Son 7 Gün</option>
          <option value="all">Tüm Veriler</option>
        </select>

        {/* Sync */}
        <button
          onClick={syncData}
          title="Yeni Veri Çek"
          className={`inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg border transition shadow-sm ${btnBase} hover:text-emerald-600`}
        >
          <RefreshCw size={12} />
          <span className="hidden sm:inline">Eşitle</span>
        </button>

        {/* Info */}
        <button
          onClick={() => setInfoOpen(true)}
          title="Sistem Kılavuzu"
          className={`p-1.5 rounded-lg border transition ${btnBase}`}
        >
          <Info size={14} />
        </button>

        {/* Theme */}
        <button
          onClick={() => setIsDark((d) => !d)}
          title="Tema"
          className={`p-1.5 rounded-lg border transition ${btnBase}`}
        >
          {isDark ? <Sun size={14} /> : <Moon size={14} />}
        </button>

        {/* Close */}
        <button
          onClick={onClose}
          title="Kapat"
          className={`p-1.5 rounded-lg border transition ${btnBase} hover:text-red-500`}
        >
          <X size={14} />
        </button>
      </header>

      {/* ── BODY ────────────────────────────────────────────────────────────── */}
      <div className="flex flex-1 overflow-hidden">
        {/* Sidebar */}
        <aside
          className={`w-56 shrink-0 hidden md:flex flex-col border-r overflow-y-auto ${panelBase}`}
        >
          <div className="p-2 flex flex-col gap-2 flex-1 overflow-y-auto">
            {/* Reset */}
            <button
              onClick={() => {
                resetGraph();
                setSearchQuery("");
                setDetail(null);
              }}
              className={`w-full py-2 text-xs rounded-lg border font-semibold transition-colors ${btnBase} hover:border-emerald-500`}
            >
              Ağı Sıfırla
            </button>

            {/* Search */}
            <div className="relative">
              <span
                className={`absolute left-2.5 top-1/2 -translate-y-1/2 text-[11px] pointer-events-none ${isDark ? "text-slate-500" : "text-slate-400"}`}
              >
                🔍
              </span>
              <input
                type="text"
                placeholder="Varlık veya olay ara..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className={`w-full text-xs rounded-lg pl-7 pr-3 py-2 border outline-none transition-colors ${inputBase}`}
              />
            </div>

            {/* Category chips */}
            <div className="flex flex-col gap-1.5 overflow-y-auto pb-2">
              {Object.keys(groupedCategories)
                .sort()
                .map((groupName) => (
                  <details
                    key={groupName}
                    open
                    className={`rounded-lg overflow-hidden border shadow-sm ${isDark ? "bg-slate-900 border-slate-800" : "bg-white border-slate-200"}`}
                  >
                    <summary
                      className={`px-3 py-2 text-xs font-semibold cursor-pointer select-none flex justify-between items-center ${isDark ? "text-slate-300 hover:bg-slate-800" : "text-slate-700 hover:bg-slate-50"}`}
                      onClick={(e) => {
                        e.preventDefault();
                        highlightGroup(
                          groupedCategories[groupName].map((i) => i.entId)
                        );
                      }}
                    >
                      <span>{groupName}</span>
                      <span
                        className={`text-[9px] px-1.5 py-0.5 rounded-full border ${isDark ? "text-slate-400 bg-slate-800 border-slate-700" : "text-slate-400 bg-slate-100 border-slate-200"}`}
                      >
                        {groupedCategories[groupName].length}
                      </span>
                    </summary>
                    <div
                      className={`p-2 flex flex-col gap-1 border-t ${isDark ? "border-slate-800 bg-slate-950/60" : "border-slate-100 bg-slate-50"}`}
                    >
                      {groupedCategories[groupName].map(
                        ({ entId, entObj }) => (
                          <button
                            key={entId}
                            onClick={() => {
                              highlightCategory(entId);
                              setDetail({ kind: "entity", entityId: entId });
                            }}
                            className={`inline-flex items-center justify-between px-2 py-1.5 rounded border text-[10px] font-medium cursor-pointer w-full text-left transition-all ${
                              entObj.type === "anomaly"
                                ? isDark
                                  ? "border-rose-600 text-rose-400 bg-slate-800"
                                  : "border-rose-300 text-rose-600 bg-white"
                                : isDark
                                ? "bg-slate-800 border-slate-700 text-slate-300 hover:border-emerald-500"
                                : "bg-white border-slate-200 text-slate-600 hover:border-emerald-400"
                            }`}
                          >
                            <span className="truncate pr-1">{entObj.label}</span>
                            <span
                              className={`px-1.5 py-0.5 rounded text-[9px] font-bold ${isDark ? "bg-slate-900 text-slate-400" : "bg-slate-100 text-slate-500"}`}
                            >
                              {entObj.count}
                            </span>
                          </button>
                        )
                      )}
                    </div>
                  </details>
                ))}
            </div>
          </div>
        </aside>

        {/* Canvas */}
        <div className="flex-1 relative overflow-hidden">
          <div
            ref={cyContainerRef}
            className="w-full h-full"
            style={{
              background: isDark
                ? "radial-gradient(circle at top, #020617 0, #000 100%)"
                : "radial-gradient(circle at top, #f8fafc 0, #e2e8f0 100%)",
            }}
          />

          {/* Status overlay */}
          {statusVisible && (
            <div
              className={`absolute inset-0 z-10 flex flex-col items-center justify-center backdrop-blur-sm ${isDark ? "bg-slate-950/80" : "bg-white/80"}`}
            >
              {!statusError && (
                <div className="animate-spin w-12 h-12 border-4 border-emerald-500 border-t-transparent rounded-full mb-4" />
              )}
              <p
                className={`text-center px-6 ${statusError ? "text-red-500 font-bold text-base" : isDark ? "text-emerald-400 font-medium" : "text-emerald-600 font-medium"}`}
              >
                {statusMsg}
              </p>
              {statusError && (
                <button
                  onClick={syncData}
                  className="mt-4 px-4 py-2 bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-semibold rounded-lg transition"
                >
                  Tekrar Dene
                </button>
              )}
            </div>
          )}

          {/* Legend (compact, bottom-left of canvas) */}
          {!statusVisible && (
            <div
              className={`absolute bottom-3 left-3 z-10 rounded-lg border px-3 py-2 text-[9px] leading-5 space-y-0.5 ${isDark ? "bg-slate-950/80 border-slate-800 text-slate-400" : "bg-white/80 border-slate-200 text-slate-500"} backdrop-blur-sm shadow-md`}
            >
              <div className="font-bold text-[10px] mb-1 uppercase tracking-wide">Düğüm Türleri</div>
              {[
                ["🟠", "Deprem"], ["🔵", "Uçuş"], ["🔴", "Afet"],
                ["🟡", "Uzay Hava"], ["🩵", "Uydu"], ["🟠", "Bölgesel Tehdit"],
                ["🔴", "CVE"], ["🟣", "APT"], ["🔵", "Konum"], ["⭐", "AI Anomali"],
              ].map(([icon, label]) => (
                <div key={label} className="flex items-center gap-1">
                  <span>{icon}</span>
                  <span>{label}</span>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Detail panel backdrop */}
        {detail && (
          <div
            className="fixed inset-0 bg-slate-900/50 backdrop-blur-sm z-40"
            onClick={closeDetail}
          />
        )}

        {/* Detail panel */}
        <aside
          className={`fixed inset-y-0 right-0 z-50 w-full sm:w-[26rem] max-w-[100vw] flex flex-col transition-transform duration-300 border-l shadow-2xl ${panelBase} ${
            detail ? "translate-x-0" : "translate-x-full"
          }`}
        >
          <div
            className={`flex items-center justify-between px-4 pt-4 pb-3 border-b ${isDark ? "border-slate-800" : "border-slate-100"}`}
          >
            <h2 className="text-sm font-semibold">Detay</h2>
            <button
              onClick={closeDetail}
              className={`p-1.5 rounded-lg transition ${isDark ? "text-slate-400 hover:bg-slate-800" : "text-slate-500 hover:bg-slate-100"}`}
            >
              <X size={16} />
            </button>
          </div>
          <div className="flex-1 overflow-y-auto p-4">
            {/* Event detail */}
            {detail?.kind === "event" && detailEvent && (
              <div className="flex flex-col gap-4">
                <div>
                  <span
                    className={`inline-flex items-center px-2 py-0.5 rounded text-[10px] font-semibold uppercase tracking-wide mb-2 ${isDark ? "bg-slate-800 text-slate-400" : "bg-slate-100 text-slate-600"}`}
                  >
                    {getTypeName(detailEvent.type)}
                  </span>
                  <h3
                    className={`text-base font-bold leading-tight ${isDark ? "text-white" : "text-slate-900"}`}
                  >
                    {detailEvent.title}
                  </h3>
                </div>

                {detailEvent.isAnomaly && (
                  <div
                    className={`flex gap-3 p-3 rounded-lg border ${isDark ? "bg-rose-900/20 border-rose-900/50" : "bg-rose-50 border-rose-200"}`}
                  >
                    <span className="text-rose-500 text-lg flex-shrink-0">⚠</span>
                    <p
                      className={`text-xs leading-relaxed font-medium ${isDark ? "text-rose-300" : "text-rose-800"}`}
                    >
                      {detailEvent.anomalyReason}
                    </p>
                  </div>
                )}

                {/* Related anomalies */}
                {(() => {
                  const related = getRelatedAnomalies(detailEvent);
                  if (related.length === 0) return null;
                  return (
                    <div
                      className={`border-t pt-4 ${isDark ? "border-slate-800" : "border-slate-100"}`}
                    >
                      <h4
                        className={`text-xs font-bold mb-2 ${isDark ? "text-slate-300" : "text-slate-700"}`}
                      >
                        İlgili Anomaliler
                      </h4>
                      <ul className="space-y-2">
                        {related.map((a) => (
                          <li
                            key={a.id}
                            className={`p-3 rounded-lg border shadow-sm ${isDark ? "bg-slate-900 border-slate-700" : "bg-white border-slate-200"}`}
                          >
                            <div
                              className={`text-[10px] font-bold mb-1 ${isDark ? "text-rose-400" : "text-rose-500"}`}
                            >
                              {new Date(a.timestamp).toLocaleString("tr-TR")}
                            </div>
                            <div
                              className={`text-xs font-semibold truncate mb-1 ${isDark ? "text-slate-200" : "text-slate-800"}`}
                            >
                              {a.title}
                            </div>
                            <div
                              className={`text-[11px] leading-relaxed line-clamp-2 ${isDark ? "text-slate-400" : "text-slate-500"}`}
                            >
                              {a.anomalyReason}
                            </div>
                          </li>
                        ))}
                      </ul>
                    </div>
                  );
                })()}

                {/* Date */}
                <div
                  className={`border-t pt-4 ${isDark ? "border-slate-800" : "border-slate-100"}`}
                >
                  <p
                    className={`text-[10px] uppercase font-bold tracking-wide mb-1 ${isDark ? "text-slate-500" : "text-slate-400"}`}
                  >
                    Tarih
                  </p>
                  <p
                    className={`text-xs ${isDark ? "text-slate-300" : "text-slate-600"}`}
                  >
                    {new Date(detailEvent.timestamp).toLocaleString("tr-TR")}
                  </p>
                </div>

                {/* Summary */}
                <p
                  className={`text-sm leading-relaxed p-3 rounded-lg border ${isDark ? "bg-slate-900/50 border-slate-800 text-slate-300" : "bg-slate-50 border-slate-100 text-slate-700"}`}
                >
                  {detailEvent.summary}
                </p>

                {/* Entities */}
                {detailEvent.entities.length > 0 && (
                  <div>
                    <p
                      className={`text-[10px] uppercase font-bold tracking-wide mb-2 ${isDark ? "text-slate-500" : "text-slate-400"}`}
                    >
                      Varlıklar
                    </p>
                    <div className="flex flex-wrap gap-1.5">
                      {detailEvent.entities.map((ent, i) => (
                        <span
                          key={i}
                          className={`px-2 py-1 rounded text-[10px] font-bold border ${
                            ent.type === "anomaly"
                              ? isDark
                                ? "bg-rose-900/30 text-rose-300 border-rose-800"
                                : "bg-rose-100 text-rose-800 border-rose-300"
                              : isDark
                              ? "bg-slate-800 text-slate-200 border-slate-700"
                              : "bg-slate-100 text-slate-800 border-slate-200"
                          }`}
                        >
                          {ent.label}
                        </span>
                      ))}
                    </div>
                  </div>
                )}

                <a
                  href={detailEvent.link}
                  target="_blank"
                  rel="noreferrer"
                  className="text-xs text-blue-500 hover:underline"
                >
                  Kaynağa Git ↗
                </a>
              </div>
            )}

            {/* Entity detail */}
            {detail?.kind === "entity" && detailEntity && (
              <div className="flex flex-col gap-4">
                <div>
                  <span
                    className={`inline-flex items-center px-2 py-0.5 rounded text-[10px] font-semibold uppercase tracking-wide mb-2 ${isDark ? "bg-slate-800 text-slate-400" : "bg-slate-100 text-slate-600"}`}
                  >
                    Sistem Varlığı
                  </span>
                  <h3
                    className={`text-base font-bold leading-tight ${isDark ? "text-white" : "text-slate-900"}`}
                  >
                    {detailEntity.label}
                  </h3>
                </div>
                <p
                  className={`text-sm leading-relaxed p-3 rounded-lg border ${isDark ? "bg-slate-900/50 border-slate-800 text-slate-300" : "bg-slate-50 border-slate-100 text-slate-700"}`}
                >
                  Bu varlık sistem tarafından otomatik çıkarılmıştır. Ağı
                  filtrelemek için seçildi.
                </p>

                {(() => {
                  const related = getEntityAnomalies(detailEntity);
                  if (related.length === 0) return null;
                  return (
                    <div
                      className={`border-t pt-4 ${isDark ? "border-slate-800" : "border-slate-100"}`}
                    >
                      <h4
                        className={`text-xs font-bold mb-2 ${isDark ? "text-slate-300" : "text-slate-700"}`}
                      >
                        İlgili Anomaliler
                      </h4>
                      <ul className="space-y-2">
                        {related.map((a) => (
                          <li
                            key={a.id}
                            className={`p-3 rounded-lg border shadow-sm ${isDark ? "bg-slate-900 border-slate-700" : "bg-white border-slate-200"}`}
                          >
                            <div
                              className={`text-[10px] font-bold mb-1 ${isDark ? "text-rose-400" : "text-rose-500"}`}
                            >
                              {new Date(a.timestamp).toLocaleString("tr-TR")}
                            </div>
                            <div
                              className={`text-xs font-semibold truncate mb-1 ${isDark ? "text-slate-200" : "text-slate-800"}`}
                            >
                              {a.title}
                            </div>
                            <div
                              className={`text-[11px] leading-relaxed line-clamp-2 ${isDark ? "text-slate-400" : "text-slate-500"}`}
                            >
                              {a.anomalyReason}
                            </div>
                          </li>
                        ))}
                      </ul>
                    </div>
                  );
                })()}

                {detailEntity.type === "cve" && (
                  <a
                    href={`https://nvd.nist.gov/vuln/detail/${detailEntity.label}`}
                    target="_blank"
                    rel="noreferrer"
                    className="text-xs text-blue-500 hover:underline"
                  >
                    NVD&apos;de Ara ↗
                  </a>
                )}
              </div>
            )}

            {!detail && (
              <p
                className={`text-sm text-center mt-10 ${isDark ? "text-slate-500" : "text-slate-400"}`}
              >
                Detayları görüntülemek için bir düğüme tıklayın.
              </p>
            )}
          </div>
        </aside>
      </div>

      {/* ── TOASTS ──────────────────────────────────────────────────────────── */}
      <div className="fixed top-14 right-4 z-[60] flex flex-col gap-2 pointer-events-none">
        {toasts.map((t) => (
          <div
            key={t.id}
            className={`pointer-events-auto flex gap-3 items-start p-3 rounded-xl border shadow-xl max-w-xs ${isDark ? "bg-slate-900 border-slate-700" : "bg-white border-slate-200"}`}
          >
            <span className="text-base flex-shrink-0">
              {t.kind === "warning" ? "⚠️" : "ℹ️"}
            </span>
            <div>
              <p
                className={`text-xs font-bold mb-0.5 ${isDark ? "text-slate-100" : "text-slate-800"}`}
              >
                {t.title}
              </p>
              <p
                className={`text-[11px] ${isDark ? "text-slate-400" : "text-slate-500"}`}
              >
                {t.message}
              </p>
            </div>
          </div>
        ))}
      </div>

      {/* ── INFO MODAL ──────────────────────────────────────────────────────── */}
      {infoOpen && (
        <div
          className="fixed inset-0 z-[70] bg-slate-900/60 backdrop-blur-sm flex items-center justify-center px-4"
          onClick={() => setInfoOpen(false)}
        >
          <div
            className={`rounded-2xl border shadow-2xl w-full max-w-2xl max-h-[80vh] flex flex-col ${isDark ? "bg-slate-900 border-slate-700" : "bg-white border-slate-200"}`}
            onClick={(e) => e.stopPropagation()}
          >
            <div
              className={`flex items-center justify-between px-6 py-4 border-b ${isDark ? "border-slate-800" : "border-slate-200"}`}
            >
              <h2
                className={`text-sm font-bold ${isDark ? "text-white" : "text-slate-800"}`}
              >
                Sistem Kılavuzu
              </h2>
              <button
                onClick={() => setInfoOpen(false)}
                className={`p-1.5 rounded-lg transition ${isDark ? "text-slate-400 hover:bg-slate-800" : "text-slate-500 hover:bg-slate-100"}`}
              >
                <X size={16} />
              </button>
            </div>
            <div
              className={`overflow-y-auto p-6 text-xs leading-relaxed space-y-4 ${isDark ? "text-slate-300" : "text-slate-600"}`}
            >
              <div>
                <h3
                  className={`font-bold text-sm mb-2 ${isDark ? "text-white" : "text-slate-800"}`}
                >
                  GÖZCÜ Nedir?
                </h3>
                <p>
                  Küresel ölçekte gerçek zamanlı istihbarat ve anomali tespit
                  ağıdır. RSS beslemeleri, deprem veritabanları, uçuş takip
                  sistemleri ve uzay hava durumu verileri anlık olarak analiz
                  edilir. Veriler tarayıcı belleğinde saklanır.
                </p>
              </div>
              <div>
                <h3
                  className={`font-bold mb-1 ${isDark ? "text-white" : "text-slate-800"}`}
                >
                  Veri Kaynakları
                </h3>
                <ul className="list-disc pl-4 space-y-0.5">
                  <li>The Hacker News – Siber güvenlik haberleri</li>
                  <li>CISA – ABD siber güvenlik uyarıları</li>
                  <li>GDACS – Küresel afet uyarıları</li>
                  <li>ReliefWeb – İnsani yardım & uydu izleme</li>
                  <li>CERT Ukrayna – Bölgesel tehdit istihbaratı</li>
                  <li>USGS – 4.5+ büyüklüğündeki depremler</li>
                  <li>OpenSky – TR/Orta Doğu uçuş tespiti</li>
                  <li>NOAA SWPC – Güneş/uzay hava uyarıları</li>
                </ul>
              </div>
              <div>
                <h3
                  className={`font-bold mb-1 ${isDark ? "text-white" : "text-slate-800"}`}
                >
                  AI Anomali Tespiti
                </h3>
                <p>
                  Gemini API anahtarı <code>Gozcu.tsx</code> içindeki{" "}
                  <code>apiKey</code> değişkenine girildiğinde aktif olur. Boş
                  bırakılırsa AI analizi atlanır.
                </p>
              </div>
              <div>
                <h3
                  className={`font-bold mb-1 ${isDark ? "text-white" : "text-slate-800"}`}
                >
                  Veri Saklama
                </h3>
                <p>
                  Çekilen veriler tarayıcı localStorage&apos;ına kaydedilir
                  (anahtar: <code>gozcu-events-v1</code>). Yeni veri almak için
                  &quot;Eşitle&quot; butonuna basın.
                </p>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default Gozcu;
