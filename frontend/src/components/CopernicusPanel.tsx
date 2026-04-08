"use client";
import React from "react";
import { motion, AnimatePresence } from "framer-motion";

// ── Sentinel-2 presets ────────────────────────────────────────────────────
const PRESETS = [
  { id: "swir",        label: "SWIR",          desc: "Fires · Burn Scars",     layerId: "2_SWIR",                                color: "#ff6600" },
  { id: "false_color", label: "FALSE COLOR",   desc: "Vegetation · Crops",     layerId: "3_FALSE_COLOR",                         color: "#44ff88" },
  { id: "ndvi",        label: "NDVI",          desc: "Vegetation Stress",      layerId: "3_NDVI",                                color: "#00dd66" },
  { id: "true_color",  label: "NATURAL",       desc: "True Colour",            layerId: "1_TRUE_COLOR",                          color: "#88ccff" },
  { id: "highlight",   label: "SMOKE/HAZE",    desc: "Aerosol · Atmosphere",   layerId: "2_HIGHLIGHT-OPTIMIZED-NATURAL-COLOR",   color: "#aaaacc" },
];

// ── URL builder ───────────────────────────────────────────────────────────
export function copernicusUrl(lat: number, lng: number, layerId: string, zoom = 11): string {
  const z = Math.min(Math.max(Math.round(zoom), 7), 14);
  return (
    `https://browser.dataspace.copernicus.eu/` +
    `?zoom=${z}` +
    `&lat=${lat.toFixed(5)}` +
    `&lng=${lng.toFixed(5)}` +
    `&themeId=DEFAULT` +
    `&datasetId=S2_L2A_CDAS` +
    `&layerId=${layerId}` +
    `&demSource3D=MAPZEN` +
    `&cloudCoverage=30`
  );
}

// Convenience: Copernicus link for a named preset
export function copernicusByPreset(lat: number, lng: number, presetId: string, zoom = 11): string {
  const p = PRESETS.find((x) => x.id === presetId);
  return copernicusUrl(lat, lng, p?.layerId ?? "1_TRUE_COLOR", zoom);
}

// ── Component ─────────────────────────────────────────────────────────────
interface CopernicusPanelProps {
  isOpen: boolean;
  onClose: () => void;
  mapCenter?: { lat: number; lng: number } | null;
  mapZoom?: number;
}

export default function CopernicusPanel({ isOpen, onClose, mapCenter, mapZoom }: CopernicusPanelProps) {
  const lat = mapCenter?.lat ?? 30;
  const lng = mapCenter?.lng ?? 0;
  const zoom = mapZoom ?? 10;

  return (
    <AnimatePresence>
      {isOpen && (
        <motion.div
          initial={{ opacity: 0, y: 16, scale: 0.97 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, y: 16, scale: 0.97 }}
          transition={{ duration: 0.2 }}
          className="absolute bottom-28 left-6 z-[300] w-72 pointer-events-auto"
        >
          <div className="bg-[var(--bg-primary)]/90 backdrop-blur-md border border-blue-500/30 rounded-xl shadow-[0_8px_40px_rgba(59,130,246,0.18)] overflow-hidden">

            {/* ── Header ── */}
            <div className="flex items-center justify-between px-4 py-3 border-b border-blue-500/20 bg-blue-950/20">
              <div className="flex items-center gap-2">
                {/* satellite icon */}
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#60a5fa" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M13 7 9 3 5 7l4 4"/>
                  <path d="m17 11 4 4-4 4-4-4"/>
                  <path d="m8 12 4 4 6-6-4-4Z"/>
                  <path d="m16 8 3-3"/>
                  <path d="M9 21a6 6 0 0 0-6-6"/>
                </svg>
                <span className="text-[10px] font-mono tracking-widest text-blue-400 font-bold">COPERNICUS BROWSER</span>
              </div>
              <button onClick={onClose} className="text-[var(--text-muted)] hover:text-[var(--text-primary)] transition-colors text-xs leading-none">✕</button>
            </div>

            {/* ── Target coordinates ── */}
            <div className="px-4 py-2.5 border-b border-[var(--border-primary)]/50">
              <div className="text-[8px] text-[var(--text-muted)] font-mono tracking-widest mb-0.5">TARGET</div>
              <div className="text-[11px] text-blue-300 font-mono font-bold">
                {lat.toFixed(4)},&nbsp;{lng.toFixed(4)}
              </div>
            </div>

            {/* ── Presets ── */}
            <div className="p-3 flex flex-col gap-1.5">
              <div className="text-[8px] text-[var(--text-muted)] font-mono tracking-widest mb-1">SENTINEL-2 L2A PRESET</div>
              {PRESETS.map((preset) => (
                <a
                  key={preset.id}
                  href={copernicusUrl(lat, lng, preset.layerId, zoom)}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center justify-between px-3 py-2 rounded-lg border border-[var(--border-primary)] hover:border-blue-500/50 hover:bg-blue-950/20 transition-all group"
                >
                  <div className="flex items-center gap-2">
                    <div className="w-2 h-2 rounded-full flex-shrink-0" style={{ backgroundColor: preset.color }} />
                    <span className="text-[9px] font-mono font-bold tracking-wider text-[var(--text-primary)]">{preset.label}</span>
                    <span className="text-[8px] text-[var(--text-muted)]">{preset.desc}</span>
                  </div>
                  {/* external link icon */}
                  <svg className="text-blue-400/40 group-hover:text-blue-400 transition-colors flex-shrink-0" width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/>
                    <polyline points="15 3 21 3 21 9"/>
                    <line x1="10" y1="14" x2="21" y2="3"/>
                  </svg>
                </a>
              ))}
            </div>

            {/* ── Footer ── */}
            <div className="px-4 pb-3 text-[7px] text-[var(--text-muted)] font-mono leading-relaxed">
              Opens Copernicus Data Space in new tab · Sentinel-2 L2A · Free account may be required for recent imagery
            </div>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
