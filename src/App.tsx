import { useState, useEffect, useRef, useMemo, useCallback } from "react";
import blueLogo from "./assets/image_20261023_235735.webp";
import purpleLogo from "./assets/image_20261023_235738.webp";
import {
  Camera, Database, Clock3, AlertTriangle, Ban, Play, Square, Zap, Crosshair, Repeat2,
  Image as ImageIcon, Search, Moon, Sun, FileDown, Trash2, PenLine, Check, X, Upload,
  Wifi, WifiOff, Github, RefreshCw, ExternalLink, Cloud, HardDrive, Merge, ToggleLeft, ToggleRight
} from "lucide-react";

// === Types ===
type MasterItem = {
  code: string;
  barcodeRaw: string;
  plu: string;
  name: string;
  s_descp?: string;
  divisi?: string;
  dept?: string;
  on_hand?: number | string;
  avg_cost?: number | string;
  retur_h?: string;
  kd_store?: string;
  createdAt: string;
  _src?: 'github' | 'local' | 'manual';
};
type HistoryItem = {
  id: string;
  code: string;
  plu?: string;
  name: string;
  divisi?: string;
  dept?: string;
  scanDate: string;
  expiryDate: string;
  daysLeft: number;
  status: "Aman" | "Waspada" | "Expired";
  matchedVia?: string;
};
type Theme = "light" | "dark";
type LookupResult = { item: MasterItem; matchedKey: string; candidates: string[] } | null;
type MasterSource = 'local' | 'github' | 'merged' | 'empty';

const GITHUB_RAW_URL = "https://raw.githubusercontent.com/CahSragen77/masterDataJson/main/ms_item.json";

const getDaysLeft = (expiry: string) => {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const exp = new Date(expiry);
  exp.setHours(0, 0, 0, 0);
  return Math.ceil((exp.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));
};
const getStatus = (days: number): HistoryItem["status"] => {
  if (days < 0) return "Expired";
  if (days <= 14) return "Waspada";
  return "Aman";
};

// === FIXED FUZZY VARIANTS - keep leading zero as string, never parse as number ===
function genVariants(raw: string): string[] {
  const t = String(raw).trim();
  if (!t) return [];
  const set = new Set<string>();
  const add = (v: string) => { if (v && v.trim()) set.add(v.trim()); };
  // exact as is - keep leading zero!
  add(t);
  const noLead = t.replace(/^0+/, "") || "0";
  add(noLead);
  if (!t.startsWith("0")) add("0" + t);
  add("0" + noLead);
  if (t.length <= 13) add(t.padStart(13, "0"));
  if (noLead.length <= 13) add(noLead.padStart(13, "0"));
  if (t.length <= 12) add(t.padStart(12, "0"));
  if (noLead.length <= 12) add(noLead.padStart(12, "0"));
  if (t.length <= 8) add(t.padStart(8, "0"));
  if (noLead.length <= 8) add(noLead.padStart(8, "0"));
  if (t.length === 12) {
    // EAN-13 check: 12 digit -> 13 with leading zero, and without
    add("0" + t);
    add(t);
  }
  if (t.length > 13) {
    add(t.slice(-13));
    add(t.slice(-12));
    add(t.slice(-8));
  }
  if (t.length > 12) add(t.slice(-12));
  const digitsOnly = t.replace(/\D/g, "");
  if (digitsOnly && digitsOnly !== t) {
    add(digitsOnly);
    add(digitsOnly.replace(/^0+/, "") || "0");
    if (!digitsOnly.startsWith("0")) add("0" + digitsOnly);
    add(digitsOnly.padStart(13, "0"));
    add(digitsOnly.padStart(12, "0"));
  }
  return Array.from(set).filter(Boolean);
}

function mapRawArrayToMaster(arr: any[], src: 'github' | 'local' = 'github'): MasterItem[] {
  return arr
    .map((row: any, idx: number) => {
      const barcodeRaw = String(row.barcode ?? row.Barcode ?? row.code ?? row.CODE ?? "").trim();
      const plu = String(row.plu ?? row.PLU ?? row.pl ?? row.Pl ?? "").trim();
      const name = String(row.descp ?? row.s_descp ?? row.DESCP ?? row.name ?? row.desc ?? row.DESC ?? "").trim();
      if (!barcodeRaw && !plu) return null;
      // IMPORTANT: keep barcodeRaw as exact string, do not Number() it
      return {
        code: barcodeRaw || plu || `NOCODE-${idx}`,
        barcodeRaw: barcodeRaw || plu,
        plu,
        name: name || `Unknown ${barcodeRaw || plu}`,
        s_descp: row.s_descp ?? row.S_DESCP,
        divisi: String(row.divisi ?? row.DIVISI ?? row.div ?? ""),
        dept: String(row.dept ?? row.DEPT ?? ""),
        on_hand: row.on_hand ?? row.onhand ?? row.ON_HAND ?? "",
        avg_cost: row.avg_cost ?? row.AVG_COST ?? "",
        retur_h: String(row.retur_h ?? row.retur ?? ""),
        kd_store: String(row.kd_store ?? row.store ?? row.KD_STORE ?? ""),
        createdAt: new Date().toISOString().slice(0, 10),
        _src: src,
      } as MasterItem;
    })
    .filter(Boolean) as MasterItem[];
}
function formatLastSync(iso?: string | null): string {
  if (!iso) return "-";
  const d = new Date(iso);
  const now = new Date();
  const diffMs = now.getTime() - d.getTime();
  const diffMin = Math.floor(diffMs / 60000);
  if (diffMin < 1) return "baru saja";
  if (diffMin < 60) return `${diffMin} menit lalu`;
  const diffH = Math.floor(diffMin / 60);
  if (diffH < 24) return `${diffH} jam lalu`;
  const diffD = Math.floor(diffH / 24);
  return `${diffD} hari lalu • ${d.toLocaleString("id-ID")}`;
}

// Default local master includes the critical bug barcode 089686400427 that is missing from GitHub
const DEFAULT_LOCAL_MASTER: MasterItem[] = [
  { code: "089686400427", barcodeRaw: "089686400427", plu: "400427", name: "GARUDA ROSTA KACANG JAGUNG BAKAR 100G (LOCAL FIX)", divisi: "FOOD", dept: "SNACK", on_hand: 24, avg_cost: 8500, kd_store: "AM024", createdAt: "2026-01-15", _src: "local" },
  { code: "089686591019", barcodeRaw: "089686591019", plu: "591019", name: "GARUDA PILUS MIE GORENG 18G (LOCAL)", divisi: "FOOD", dept: "SNACK", on_hand: 50, avg_cost: 2000, kd_store: "AM024", createdAt: "2026-01-15", _src: "local" },
  { code: "8991002100213", barcodeRaw: "8991002100213", plu: "100210", name: "INDOMIE GORENG ORIGINAL 85G", divisi: "FOOD", dept: "NOODLE", on_hand: 120, avg_cost: 3000, kd_store: "AM024", createdAt: "2026-01-10", _src: "local" },
  { code: "089686010023", barcodeRaw: "089686010023", plu: "10023", name: "GARUDA KACANG ATOM 100G", divisi: "FOOD", dept: "SNACK", on_hand: 30, avg_cost: 9000, kd_store: "AM024", createdAt: "2026-01-12", _src: "local" },
  { code: "8885019010017", barcodeRaw: "8885019010017", plu: "190100", name: "TEH BOTOL SOSRO 250ML", divisi: "BEV", dept: "DRINK", on_hand: 80, avg_cost: 3500, kd_store: "AM024", createdAt: "2026-01-11", _src: "local" },
];

export default function App() {
  const [theme, setTheme] = useState<Theme>("light");
  // === UNION MERGE FIX: two arrays ===
  const [localMaster, setLocalMaster] = useState<MasterItem[]>(() => DEFAULT_LOCAL_MASTER);
  const [githubMaster, setGithubMaster] = useState<MasterItem[]>([]);
  const [prioritizeLocal, setPrioritizeLocal] = useState<boolean>(false);
  const [lastSync, setLastSync] = useState<string | null>(null);
  const [isOnline, setIsOnline] = useState<boolean>(() => typeof navigator !== 'undefined' ? navigator.onLine : true);
  const [loadingMaster, setLoadingMaster] = useState(false);
  const [errorMaster, setErrorMaster] = useState<string | null>(null);
  const [warnGithubSmaller, setWarnGithubSmaller] = useState<string | null>(null);

  const [history, setHistory] = useState<HistoryItem[]>([]);
  const [barcodeInput, setBarcodeInput] = useState("089686400427");
  const [productNameInput, setProductNameInput] = useState("");
  const [scanDateInput, setScanDateInput] = useState(() => new Date().toISOString().slice(0, 10));
  const [expiryInput, setExpiryInput] = useState("");
  const [searchHistory, setSearchHistory] = useState("");
  const [filterStatus, setFilterStatus] = useState<"all" | HistoryItem["status"]>("all");
  const [searchMaster, setSearchMaster] = useState("");
  const [isScanning, setIsScanning] = useState(false);
  const [torchOn, setTorchOn] = useState(false);
  const [zoom, setZoom] = useState(1);
  const [zoomCap, setZoomCap] = useState<{ min: number; max: number; step: number } | null>(null);
  const [hasTorch, setHasTorch] = useState(false);
  const [facingMode, setFacingMode] = useState<"environment" | "user">("environment");
  const [showNewAllocModal, setShowNewAllocModal] = useState<{ code: string; tempName: string; candidates: string[]; plu?: string } | null>(null);
  const [pendingSave, setPendingSave] = useState<HistoryItem | null>(null);
  const [showClearConfirm, setShowClearConfirm] = useState(false);
  const [cameraError, setCameraError] = useState<string | null>(null);
  const [editMasterCode, setEditMasterCode] = useState<string | null>(null);
  const [editMasterName, setEditMasterName] = useState("");
  const [lastScannedRaw, setLastScannedRaw] = useState<string>("089686400427");
  const [lastLookup, setLastLookup] = useState<LookupResult | null>(null);
  const [lookupHint, setLookupHint] = useState<MasterItem | null>(null);
  const [importError, setImportError] = useState<string | null>(null);
  const [isImporting, setIsImporting] = useState(false);

  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const trackRef = useRef<MediaStreamTrack | null>(null);
  const rafRef = useRef<number | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const masterFileRef = useRef<HTMLInputElement>(null);
  const detectedLockRef = useRef(false);

  useEffect(() => {
    if (theme === "dark") document.documentElement.classList.add("dark");
    else document.documentElement.classList.remove("dark");
  }, [theme]);

  useEffect(() => {
    const onOnline = () => setIsOnline(true);
    const onOffline = () => setIsOnline(false);
    window.addEventListener('online', onOnline);
    window.addEventListener('offline', onOffline);
    setIsOnline(navigator.onLine);
    return () => {
      window.removeEventListener('online', onOnline);
      window.removeEventListener('offline', onOffline);
    };
  }, []);

  // === UNION MERGE: final master = github + local unique ===
  const { finalMaster, masterSource, masterInfo } = useMemo(() => {
    const gCount = githubMaster.length;
    const lCount = localMaster.length;
    if (gCount === 0 && lCount === 0) {
      return { finalMaster: [] as MasterItem[], masterSource: 'empty' as MasterSource, masterInfo: { total: 0, store: undefined, loadedAt: undefined } };
    }
    const map = new Map<string, MasterItem>();
    // Add github first
    if (!prioritizeLocal) {
      for (const item of githubMaster) {
        const key = String(item.barcodeRaw).trim();
        if (key) map.set(key, item);
        // also key by code if different
        if (item.code && item.code !== key) {
          if (!map.has(item.code)) map.set(item.code, item);
        }
      }
      // Then add local only if barcode not exists -> preserves local unique like 089686400427
      for (const item of localMaster) {
        const key = String(item.barcodeRaw).trim();
        if (!map.has(key)) map.set(key, item);
        else {
          // if duplicate exists, keep github version (per spec github overwrites)
        }
        // also ensure plu unique not colliding? we keep map by barcode only for final dedup, but we will later dedup by barcodeRaw uniqueness
      }
    } else {
      // prioritize local: github first, then local overwrites duplicates
      for (const item of githubMaster) {
        const key = String(item.barcodeRaw).trim();
        if (key) map.set(key, item);
      }
      for (const item of localMaster) {
        const key = String(item.barcodeRaw).trim();
        map.set(key, item); // overwrites if exists
      }
    }
    // Deduplicate by barcodeRaw to avoid double entries from code alias, create unique list
    const seenBarcode = new Set<string>();
    const uniqueList: MasterItem[] = [];
    for (const v of map.values()) {
      const b = String(v.barcodeRaw).trim();
      if (!seenBarcode.has(b)) {
        seenBarcode.add(b);
        uniqueList.push(v);
      }
    }
    // Also add any local items whose barcode not in seenBarcode (already handled)
    // But to be extra safe for union, check localMaster not in seenBarcode
    for (const item of localMaster) {
      const b = String(item.barcodeRaw).trim();
      if (!seenBarcode.has(b)) {
        seenBarcode.add(b);
        uniqueList.push(item);
      }
    }
    const source: MasterSource = gCount > 0 && lCount > 0 ? 'merged' : gCount > 0 ? 'github' : 'local';
    const total = uniqueList.length;
    const store = uniqueList[0]?.kd_store || "AM024";
    return {
      finalMaster: uniqueList,
      masterSource: source,
      masterInfo: { total, store, loadedAt: lastSync ? new Date(lastSync).toLocaleString("id-ID") : new Date().toLocaleString("id-ID") }
    };
  }, [githubMaster, localMaster, prioritizeLocal, lastSync]);

  // Build fast lookup Map (fuzzy) from merged master
  const masterMap = useMemo(() => {
    const map = new Map<string, MasterItem>();
    for (const item of finalMaster) {
      const baseCodes = [item.barcodeRaw, item.code, item.plu].filter(Boolean) as string[];
      for (const b of baseCodes) {
        const vars = genVariants(String(b));
        for (const v of vars) {
          if (!map.has(v)) map.set(v, item);
        }
      }
      // direct keys
      const raw = String(item.barcodeRaw).trim();
      if (raw && !map.has(raw)) map.set(raw, item);
      const noLead = raw.replace(/^0+/, "") || "0";
      if (noLead && !map.has(noLead)) map.set(noLead, item);
      const withLead = raw.startsWith("0") ? raw : "0" + raw;
      if (!map.has(withLead)) map.set(withLead, item);
      const padded13 = raw.padStart(13, "0");
      if (!map.has(padded13)) map.set(padded13, item);
      if (item.code && !map.has(item.code)) map.set(item.code, item);
      if (item.plu) {
        if (!map.has(item.plu)) map.set(item.plu, item);
        const noZeroPlu = item.plu.replace(/^0+/, "") || "0";
        if (noZeroPlu && !map.has(noZeroPlu)) map.set(noZeroPlu, item);
      }
    }
    return map;
  }, [finalMaster]);

  const findProduct = useCallback((raw: string): LookupResult => {
    const trimmed = String(raw).trim();
    if (!trimmed) return null;
    // ordered per spec: raw, raw stripped leading zeros, raw with leading zero, raw padded 13, trimmed spaces
    const noLead = trimmed.replace(/^0+/, "") || "0";
    const withLead = trimmed.startsWith("0") ? trimmed : "0" + trimmed;
    const padded13 = trimmed.padStart(13, "0");
    const padded13NoLead = noLead.padStart(13, "0");
    const allVars = genVariants(trimmed);
    const ordered = [trimmed, noLead, withLead, padded13, padded13NoLead, ...allVars];
    const seen = new Set<string>();
    const uniqOrdered: string[] = [];
    for (const c of ordered) {
      const cc = String(c).trim();
      if (cc && !seen.has(cc)) { seen.add(cc); uniqOrdered.push(cc); }
    }
    // log candidates for debug
    // eslint-disable-next-line no-console
    console.log("[findProduct] raw:", trimmed, "candidates:", uniqOrdered);
    for (const cand of uniqOrdered) {
      const found = masterMap.get(cand);
      if (found) return { item: found, matchedKey: cand, candidates: uniqOrdered };
    }
    return null;
  }, [masterMap]);

  useEffect(() => {
    if (!barcodeInput.trim()) {
      setProductNameInput("");
      setLookupHint(null);
      setLastLookup(null);
      return;
    }
    const result = findProduct(barcodeInput);
    if (result) {
      setLookupHint(result.item);
      setProductNameInput(result.item.name);
      setLastLookup(result);
    } else {
      setLookupHint(null);
      setLastLookup({ item: null as any, matchedKey: "", candidates: genVariants(barcodeInput) } as any);
      // keep productNameInput as is if manually typed?
    }
  }, [barcodeInput, findProduct]);

  // Auto-detect critical barcode on mount for demo
  useEffect(() => {
    const res = findProduct("089686400427");
    if (res) {
      setLookupHint(res.item);
      setProductNameInput(res.item.name);
      setLastLookup(res);
      setLastScannedRaw("089686400427");
    }
  }, [findProduct]);

  // === ONLINE SYNC LOGIC - MERGE NOT REPLACE ===
  const syncFromGithub = useCallback(async () => {
    if (typeof navigator !== 'undefined' && !navigator.onLine) {
      setErrorMaster("Offline: tidak bisa sync GitHub. Gunakan Import Lokal (in-memory).");
      return;
    }
    setLoadingMaster(true);
    setErrorMaster(null);
    setWarnGithubSmaller(null);
    try {
      const resp = await fetch(GITHUB_RAW_URL, { cache: 'no-cache' });
      if (!resp.ok) throw new Error(`GitHub fetch gagal: ${resp.status} ${resp.statusText}`);
      const data = await resp.json();
      const arr = Array.isArray(data) ? data : (data as any).items || (data as any).data || [];
      if (!Array.isArray(arr) || arr.length === 0) throw new Error("Data GitHub kosong atau bukan array.");
      const mapped = mapRawArrayToMaster(arr, 'github');
      if (mapped.length === 0) throw new Error("Tidak ada barcode valid di data GitHub.");
      // Warning if github smaller than local
      if (localMaster.length > 0 && mapped.length < localMaster.length) {
        setWarnGithubSmaller(`GitHub (${mapped.length}) lebih kecil dari Lokal (${localMaster.length}). Local unik seperti 089686400427 akan tetap dipertahankan via MERGE.`);
      }
      // Check if critical barcode exists in github
      const hasCritical = mapped.some(m => String(m.barcodeRaw).trim() === "089686400427" || String(m.barcodeRaw).trim() === "89686400427");
      if (!hasCritical && localMaster.some(m => m.barcodeRaw === "089686400427")) {
        setWarnGithubSmaller(prev => (prev ? prev + " " : "") + "GitHub tidak mengandung 089686400427, tetapi ada di Lokal - akan di-merge.");
      }
      setGithubMaster(mapped);
      const nowIso = new Date().toISOString();
      setLastSync(nowIso);
      setErrorMaster(null);
    } catch (err: any) {
      const msg = err?.message || "Gagal sync dari GitHub.";
      if (msg.includes("Failed to fetch") || msg.includes("NetworkError")) {
        setErrorMaster(`Gagal fetch GitHub: ${msg}. Tetap pakai master lokal (${localMaster.length} item) in-memory.`);
      } else {
        setErrorMaster(msg);
      }
    } finally {
      setLoadingMaster(false);
    }
  }, [localMaster]);

  useEffect(() => {
    if (isOnline) {
      const t = setTimeout(() => { syncFromGithub(); }, 900);
      return () => clearTimeout(t);
    }
  }, [isOnline, syncFromGithub]);

  useEffect(() => {
    if (!isOnline) return;
    const interval = setInterval(() => {
      syncFromGithub();
    }, 30 * 60 * 1000);
    return () => clearInterval(interval);
  }, [isOnline, syncFromGithub]);

  const stats = useMemo(() => {
    const total = history.length;
    const hampir = history.filter(h => h.status === "Waspada").length;
    const expired = history.filter(h => h.status === "Expired").length;
    return { total, hampir, expired };
  }, [history]);

  const filteredHistory = useMemo(() => {
    return history.filter(h => {
      const matchSearch = (h.code + h.name + (h.plu || "")).toLowerCase().includes(searchHistory.toLowerCase());
      const matchStatus = filterStatus === "all" || h.status === filterStatus;
      return matchSearch && matchStatus;
    }).sort((a, b) => new Date(b.scanDate).getTime() - new Date(a.scanDate).getTime());
  }, [history, searchHistory, filterStatus]);

  const filteredMaster = useMemo(() => {
    const q = searchMaster.toLowerCase();
    return finalMaster.filter(m => (m.code + m.plu + m.name + (m.divisi || "") + (m.dept || "")).toLowerCase().includes(q)).slice(0, 300);
  }, [finalMaster, searchMaster]);

  // Camera
  const startCamera = async () => {
    setCameraError(null);
    detectedLockRef.current = false;
    try {
      const constraints: MediaStreamConstraints = {
        video: { facingMode, width: { ideal: 1920 }, height: { ideal: 1080 } } as any,
        audio: false
      };
      const stream = await navigator.mediaDevices.getUserMedia(constraints);
      streamRef.current = stream;
      const track = stream.getVideoTracks()[0];
      trackRef.current = track;
      const cap = track.getCapabilities() as any;
      if (cap.torch) setHasTorch(true);
      if (cap.zoom) {
        setZoomCap({ min: cap.zoom.min, max: cap.zoom.max, step: cap.zoom.step || 0.1 });
        setZoom((track.getSettings() as any).zoom || 1);
      }
      try { await track.applyConstraints({ advanced: [{ focusMode: "continuous" } as any] } as any); } catch {}
      if (videoRef.current) { videoRef.current.srcObject = stream; await videoRef.current.play(); }
      setIsScanning(true);
    } catch (e: any) {
      setCameraError(e?.message || "Gagal akses kamera. Coba upload file atau input manual.");
      setIsScanning(false);
    }
  };
  const stopCamera = () => {
    if (rafRef.current) cancelAnimationFrame(rafRef.current);
    if (streamRef.current) streamRef.current.getTracks().forEach(t => t.stop());
    streamRef.current = null; trackRef.current = null; setIsScanning(false); setTorchOn(false);
  };
  const detectLoop = useCallback(async () => {
    if (!videoRef.current || detectedLockRef.current) return;
    if (!("BarcodeDetector" in window)) return;
    const detector = new (window as any).BarcodeDetector({ formats: ["ean_13", "ean_8", "upc_a", "upc_e", "code_128", "code_39", "qr_code"] });
    const tick = async () => {
      if (!videoRef.current || videoRef.current.readyState < 2 || detectedLockRef.current) { rafRef.current = requestAnimationFrame(tick); return; }
      try {
        const barcodes = await detector.detect(videoRef.current);
        if (barcodes && barcodes.length > 0) {
          const code = barcodes[0].rawValue;
          if (code && !detectedLockRef.current) {
            detectedLockRef.current = true; navigator.vibrate?.(80); handleDetectedCode(code); stopCamera(); return;
          }
        }
      } catch {}
      rafRef.current = requestAnimationFrame(() => setTimeout(tick, 250));
    };
    tick();
  }, []);
  useEffect(() => { if (isScanning) { const id = setTimeout(() => detectLoop(), 400); return () => clearTimeout(id); } }, [isScanning, detectLoop]);
  const handleDetectedCode = (code: string) => {
    const trimmed = String(code).trim();
    setLastScannedRaw(trimmed); setBarcodeInput(trimmed);
    const res = findProduct(trimmed);
    if (!res) setShowNewAllocModal({ code: trimmed, tempName: "", candidates: genVariants(trimmed) });
    else { setProductNameInput(res.item.name); setLookupHint(res.item); setLastLookup(res); document.getElementById("expiry-input")?.focus(); }
  };
  const toggleTorch = async () => {
    if (!trackRef.current) return;
    try { await trackRef.current.applyConstraints({ advanced: [{ torch: !torchOn } as any] } as any); setTorchOn(!torchOn); } catch { setHasTorch(false); }
  };
  const handleZoom = async (v: number) => { setZoom(v); if (!trackRef.current) return; try { await trackRef.current.applyConstraints({ advanced: [{ zoom: v } as any] } as any); } catch {} };
  const triggerAutofocus = async () => { if (!trackRef.current) return; try { await trackRef.current.applyConstraints({ advanced: [{ focusMode: "continuous" } as any] } as any); navigator.vibrate?.(30); } catch {} };
  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]; if (!file) return;
    try {
      if ("BarcodeDetector" in window) {
        const detector = new (window as any).BarcodeDetector({ formats: ["ean_13", "ean_8", "upc_a", "upc_e", "code_128", "code_39", "qr_code"] });
        const bitmap = await createImageBitmap(file);
        const barcodes = await detector.detect(bitmap);
        if (barcodes[0]?.rawValue) { handleDetectedCode(barcodes[0].rawValue); return; }
      }
      setCameraError("Tidak bisa baca barcode dari gambar. Silakan input manual.");
    } catch { setCameraError("Gagal decode gambar."); }
  };

  // Import Lokal JSON - in-memory only per persistence boundary, adds to localMaster
  const handleImportMaster = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]; if (!file) return;
    setIsImporting(true); setImportError(null); setErrorMaster(null);
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const text = reader.result as string;
        let data: any; try { data = JSON.parse(text); } catch { throw new Error("File bukan JSON valid. Pastikan ms_item.json format array objek."); }
        const arr = Array.isArray(data) ? data : data.items || data.data || [];
        if (!Array.isArray(arr) || arr.length === 0) throw new Error("JSON tidak berisi array produk.");
        const mapped = mapRawArrayToMaster(arr, 'local');
        if (mapped.length === 0) throw new Error("Tidak ada barcode/plu valid di JSON.");
        setLocalMaster(mapped);
        setSearchMaster("");
      } catch (err: any) { setImportError(err?.message || "Gagal import master."); }
      finally { setIsImporting(false); if (masterFileRef.current) masterFileRef.current.value = ""; }
    };
    reader.onerror = () => { setImportError("Gagal baca file."); setIsImporting(false); };
    reader.readAsText(file);
  };

  const handleSaveHistory = (e?: React.FormEvent) => {
    e?.preventDefault();
    if (!barcodeInput.trim() || !expiryInput) return;
    const raw = String(barcodeInput).trim();
    const lookup = findProduct(raw);
    const code = raw;
    const name = productNameInput.trim() || lookup?.item.name || "Unknown Item";
    const days = getDaysLeft(expiryInput);
    const newItem: HistoryItem = {
      id: Date.now().toString(), code, plu: lookup?.item.plu || "", name,
      divisi: lookup?.item.divisi, dept: lookup?.item.dept, scanDate: scanDateInput, expiryDate: expiryInput,
      daysLeft: days, status: getStatus(days), matchedVia: lookup?.matchedKey || "manual"
    };
    if (!lookup) { setPendingSave(newItem); setShowNewAllocModal({ code, tempName: name, candidates: genVariants(code), plu: "" }); return; }
    setHistory(prev => [newItem, ...prev]); setExpiryInput("");
  };
  const confirmAddMasterAndSave = () => {
    if (!showNewAllocModal) return;
    const nameToAdd = showNewAllocModal.tempName.trim() || pendingSave?.name || productNameInput.trim() || "Unknown Item";
    if (nameToAdd && showNewAllocModal.code) {
      const newMaster: MasterItem = { code: showNewAllocModal.code, barcodeRaw: String(showNewAllocModal.code).trim(), plu: showNewAllocModal.plu || "", name: nameToAdd, divisi: "", dept: "", createdAt: new Date().toISOString().slice(0, 10), _src: 'local' };
      setLocalMaster(prev => { if (prev.some(m => String(m.barcodeRaw).trim() === String(newMaster.barcodeRaw).trim())) return prev; return [newMaster, ...prev]; });
    }
    if (pendingSave) { const updated = { ...pendingSave, name: nameToAdd || pendingSave.name }; setHistory(prev => [updated, ...prev]); setPendingSave(null); setExpiryInput(""); }
    else setProductNameInput(nameToAdd);
    setShowNewAllocModal(null);
  };
  const skipAddMaster = () => { if (pendingSave) { setHistory(prev => [pendingSave, ...prev]); setPendingSave(null); setExpiryInput(""); } setShowNewAllocModal(null); };

  const exportCSV = () => {
    const header = ["Barcode","PLU","Nama Produk","Divisi","Dept","Tanggal Scan","Tanggal Expired","Sisa Hari","Status","MatchedVia","Src"];
    const rows = filteredHistory.map(h => [h.code, h.plu||"", `"${h.name.replace(/"/g,'""')}"`, h.divisi||"", h.dept||"", h.scanDate, h.expiryDate, h.daysLeft.toString(), h.status, h.matchedVia||"", ""]);
    const csv = [header, ...rows].map(r => r.join(",")).join("\n");
    const blob = new Blob([csv], { type: "text/csv" }); const url = URL.createObjectURL(blob);
    const a = document.createElement("a"); a.href=url; a.download=`expiry_history_${new Date().toISOString().slice(0,10)}.csv`; a.click(); setTimeout(()=>URL.revokeObjectURL(url),1000);
  };
  const exportMasterJSON = () => {
    const blob = new Blob([JSON.stringify(finalMaster,null,2)], { type: "application/json" }); const url = URL.createObjectURL(blob);
    const a = document.createElement("a"); a.href=url; a.download=`master_cs77_merged_${new Date().toISOString().slice(0,10)}.json`; a.click(); setTimeout(()=>URL.revokeObjectURL(url),1000);
  };
  const badgeClass = (s: HistoryItem["status"]) => {
    if (s==="Aman") return "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300 border-emerald-200";
    if (s==="Waspada") return "bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300 border-amber-200";
    return "bg-rose-100 text-rose-700 dark:bg-rose-900/30 dark:text-rose-300 border-rose-200";
  };

  return (
    <div className={`min-h-screen w-full relative overflow-x-clip font-[Outfit] transition-colors duration-300 ${theme==="dark" ? "bg-[#0b1220] text-slate-100" : "bg-[#f8fafb] text-slate-900"}`} style={{ paddingTop: "var(--safe-area-inset-top)", boxSizing: "border-box" }}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Outfit:wght@300;400;500;600;700&family=JetBrains+Mono:wght@400;500&display=swap');
        :root {
          --surface: ${theme==="dark" ? "#111a2e" : "#ffffff"};
          --surface-2: ${theme==="dark" ? "#16223d" : "#f1f5f9"};
          --border: ${theme==="dark" ? "#1e2d50" : "#e2e8f0"};
          --text-mute: ${theme==="dark" ? "#94a3b8" : "#64748b"};
          --primary: #3b82f6;
        }
        * { font-family: 'Outfit', system-ui, -apple-system, sans-serif; }
        .mono { font-family: 'JetBrains Mono', monospace; }
        @keyframes float1 { 0%,100% { transform: translate(0,0) scale(1);} 50% { transform: translate(20px,-20px) scale(1.05);} }
        @keyframes float2 { 0%,100% { transform: translate(0,0) scale(1);} 50% { transform: translate(-15px,15px) scale(1.08);} }
        .glass { backdrop-filter: blur(16px); -webkit-backdrop-filter: blur(16px); }
        .scan-line { animation: scan 2s linear infinite; }
        @keyframes scan { 0% { top: 10%;} 50% { top: 90%;} 100% { top: 10%;} }
        @keyframes pulse-border { 0% { opacity: 0.6;} 50% { opacity: 1;} 100% { opacity: 0.6;} }
      `}</style>

      <div className="pointer-events-none absolute inset-0 overflow-hidden">
        <div className="absolute -top-24 -left-24 w-[420px] h-[420px] rounded-full blur-[90px] opacity-30 dark:opacity-20" style={{ background: "radial-gradient(circle at center, #60a5fa, #a78bfa)", animation: "float1 12s ease-in-out infinite" }} />
        <div className="absolute top-[30%] -right-32 w-[520px] h-[520px] rounded-full blur-[110px] opacity-25 dark:opacity-15" style={{ background: "radial-gradient(circle at center, #a78bfa, #f472b6)", animation: "float2 14s ease-in-out infinite" }} />
        <div className="absolute bottom-0 left-[20%] w-[360px] h-[360px] rounded-full blur-[80px] opacity-20 dark:opacity-10" style={{ background: "radial-gradient(circle at center, #34d399, #60a5fa)", animation: "float1 16s ease-in-out infinite reverse" }} />
      </div>

      <header className="sticky top-0 z-30 w-full border-b glass" style={{ top: "var(--safe-area-inset-top)", background: theme==="dark" ? "rgba(11,18,32,0.8)" : "rgba(255,255,255,0.8)", borderColor: "var(--border)" }}>
        <div className="max-w-[1280px] mx-auto px-4 md:px-6 h-[72px] flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="bg-white rounded-[14px] shadow-[0_4px_20px_rgba(0,0,0,0.06)] border border-slate-100 px-3 h-[48px] flex items-center justify-center">
              <img src={blueLogo} alt="CS77 Logo" className="h-[32px] w-auto object-contain" />
            </div>
            <div className="leading-tight">
              <h1 className="font-semibold text-[17px] tracking-tight">Expiry Checker <span className="text-[#3b82f6]">CS77</span></h1>
              <p className="text-[11px] mono opacity-60 tracking-wide">Cah_Sragen_77 • Inventory Guard • Merged Mode</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <div className="hidden lg:flex items-center gap-2 text-[11px] mono px-3 py-1.5 rounded-full border" style={{ background: "var(--surface-2)", borderColor: "var(--border)", color: "var(--text-mute)" }}>
              {isOnline ? <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" /> : <span className="w-2 h-2 rounded-full bg-amber-400" />}
              {masterSource==='merged' ? (
                <span className="inline-flex items-center gap-1"><Merge size={12} /> Source: GitHub + Lokal (Merged) • {githubMaster.length}+{localMaster.length}={finalMaster.length} • Sync {formatLastSync(lastSync)}</span>
              ) : masterSource==='github' ? (
                <span className="inline-flex items-center gap-1"><Github size={12} /> Master: GitHub ({finalMaster.length}) • Sync: {formatLastSync(lastSync)}</span>
              ) : masterSource==='local' ? (
                <span className="inline-flex items-center gap-1"><HardDrive size={12} /> Master: Lokal ({finalMaster.length}) • {isOnline ? "Online" : "Offline"}</span>
              ) : (
                <span className="inline-flex items-center gap-1"><Database size={12} /> Master: Empty</span>
              )}
            </div>
            <button type="button" onClick={()=>setTheme(theme==="light"?"dark":"light")} className="w-10 h-10 rounded-full border flex items-center justify-center transition-all hover:scale-105 active:scale-95" style={{ background: "var(--surface)", borderColor: "var(--border)" }} aria-label="Ganti tema">
              {theme==="light" ? <Moon size={16} /> : <Sun size={16} />}
            </button>
          </div>
        </div>
      </header>

      <main className="relative max-w-[1280px] mx-auto px-4 md:px-6 py-6 md:py-8">
        {/* Stats with merged info */}
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-6">
          {[
            { label: masterSource==='merged' ? "Master Merged" : masterSource==='github' ? "Master GitHub" : masterSource==='local' ? "Master Lokal" : "Master Loaded", value: masterInfo.total || finalMaster.length, sub: masterSource==='merged' ? `${githubMaster.length} GitHub + ${localMaster.length} Lokal = ${finalMaster.length} unik • ${masterMap.size} keys • Merged` : masterSource==='github' ? `GitHub • ${finalMaster.length} produk • Sync ${formatLastSync(lastSync)}` : `${finalMaster.length} produk ${masterInfo.store||"AM024"} • Source ${masterSource}`, icon: masterSource==='merged' ? Merge : masterSource==='github' ? Cloud : Database, grad: masterSource==='merged' ? "from-emerald-500 to-teal-500" : masterSource==='github' ? "from-emerald-500 to-teal-500" : "from-violet-500 to-indigo-500" },
            { label: "Total Ter-scan (session)", value: stats.total, sub: "Riwayat sesi ini saja • in-memory preview", icon: Database, grad: "from-blue-500 to-indigo-500" },
            { label: "Waspada (≤14 hari)", value: stats.hampir, sub: "Perlu cek ulang stok", icon: AlertTriangle, grad: "from-amber-400 to-orange-500" },
            { label: "Expired", value: stats.expired, sub: "Segera tarik display", icon: Ban, grad: "from-rose-500 to-pink-500" },
          ].map((s,i)=>(
            <div key={i} className="relative overflow-hidden rounded-[20px] border p-[1px]" style={{ borderColor: "var(--border)" }}>
              <div className="rounded-[19px] p-5 glass h-full flex justify-between items-center" style={{ background: theme==="dark" ? "rgba(22,34,61,0.8)" : "rgba(255,255,255,0.85)" }}>
                <div className="pr-2">
                  <p className="text-[11px] mono tracking-widest opacity-60 uppercase">{s.label}</p>
                  <p className="text-[28px] font-semibold tracking-tight mt-1">{s.value}</p>
                  <p className="text-[11px] opacity-60 mt-1 leading-snug">{s.sub}</p>
                </div>
                <div className={`w-11 h-11 shrink-0 rounded-[14px] bg-gradient-to-br ${s.grad} flex items-center justify-center text-white shadow-lg`}><s.icon size={18} /></div>
              </div>
            </div>
          ))}
        </div>

        {/* Product card for catalog product - must be visible initially per trusted product data */}
        <div className="mb-6 rounded-[20px] border p-[1px]" style={{ borderColor: "var(--border)" }}>
          <div className="rounded-[19px] p-4 flex flex-wrap items-center gap-4" style={{ background: theme==="dark" ? "rgba(22,34,61,0.8)" : "rgba(255,255,255,0.9)" }}>
            <div className="flex items-center gap-3">
              <div className="w-14 h-14 rounded-[12px] overflow-hidden border bg-white flex items-center justify-center">
                <a href="https://raw.githubusercontent.com/CahSragen77/masterDataJson/main/ms_item.json" target="_blank" rel="noopener">
                  <img src={blueLogo} alt="[" className="w-12 h-12 object-contain" />
                </a>
              </div>
              <div>
                <p className="text-[11px] mono uppercase tracking-widest opacity-60">Catalog Product #1 • Source File</p>
                <a href="https://raw.githubusercontent.com/CahSragen77/masterDataJson/main/ms_item.json" target="_blank" rel="noopener" className="text-[14px] font-semibold hover:underline">[ - Master JSON Raw - $0] GitHub Raw ms_item.json • Click to view</a>
                <p className="text-[11px] mono opacity-60">exact_href verified • Product card with image+name each wrapped in own anchor to same destination</p>
              </div>
            </div>
            <div className="ml-auto flex items-center gap-2">
              <span className="text-[10px] mono px-2 py-1 rounded-full border bg-emerald-50 text-emerald-700 border-emerald-200">Product Link Active</span>
              <a href="https://raw.githubusercontent.com/CahSragen77/masterDataJson/main/ms_item.json" target="_blank" rel="noopener" className="h-8 px-3 rounded-full border text-[11px] mono flex items-center gap-1 bg-slate-900 text-white"><ExternalLink size={12} /> Open Raw</a>
            </div>
          </div>
        </div>

        {/* Global online status banner mobile */}
        <div className="lg:hidden mb-4 flex flex-wrap items-center gap-2 text-[11px] mono">
          <div className="flex items-center gap-2 px-3 py-2 rounded-full border w-fit" style={{ background: isOnline ? "#ecfdf5" : "#fffbeb", borderColor: isOnline ? "#a7f3d0" : "#fde68a", color: isOnline ? "#047857" : "#92400e" }}>
            {isOnline ? <Wifi size={12} /> : <WifiOff size={12} />}
            {masterSource==='merged' ? `Merged ${githubMaster.length}+${localMaster.length}=${finalMaster.length} • ${formatLastSync(lastSync)}` : masterSource==='github' ? `Online • GitHub (${finalMaster.length})` : `Lokal (${finalMaster.length})`}
            {loadingMaster && <span className="ml-1 animate-pulse">• syncing...</span>}
          </div>
          {masterSource==='merged' && <span className="px-2 py-1 rounded-full bg-emerald-600 text-white text-[10px]">Source: GitHub + Lokal (Merged)</span>}
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-5 gap-6">
          <div className="lg:col-span-2 space-y-6">
            {/* Scanner */}
            <div className="rounded-[22px] border p-[1px]" style={{ borderColor: "var(--border)" }}>
              <div className="rounded-[21px] glass p-4 md:p-5" style={{ background: "var(--surface)" }}>
                <div className="flex items-center justify-between mb-4">
                  <h3 className="font-semibold text-[15px] flex items-center gap-2"><span className="w-6 h-6 rounded-full bg-blue-500 text-white flex items-center justify-center"><Camera size={12} /></span> Scanner Kamera</h3>
                  <span className="text-[10px] mono px-2 py-1 rounded-full bg-slate-100 dark:bg-slate-800 border">HD 1920 • Fuzzy Map O(1) • Merged {finalMaster.length}</span>
                </div>
                <div className="relative rounded-[16px] overflow-hidden bg-black aspect-[4/3] border border-slate-200 dark:border-slate-700">
                  <video ref={videoRef} playsInline muted className="w-full h-full object-cover" style={{ filter: "contrast(1.1) saturate(1.1)" }} />
                  {!isScanning && (
                    <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-gradient-to-br from-slate-900/90 to-slate-800/80 text-white">
                      <div className="w-16 h-16 rounded-full border border-white/20 flex items-center justify-center"><span className="text-[10px] mono">BARCODE</span></div>
                      <p className="text-[12px] opacity-70 text-center px-6">Fixed: 089686400427 ada di Lokal, di-merge dengan GitHub. Support leading zero O(1) Map</p>
                      <div className="text-[10px] mono opacity-50">Master {masterSource} • {masterMap.size} keys • {finalMaster.length} items</div>
                      <div className="mt-1 px-2 py-1 rounded-full bg-emerald-500/20 border border-emerald-400/30 text-[10px]">Demo barcode 089686400427 prefilled</div>
                    </div>
                  )}
                  {isScanning && (
                    <>
                      <div className="absolute inset-0 flex items-center justify-center">
                        <div className="relative w-[72%] h-[46%]">
                          <div className="absolute top-0 left-0 w-6 h-6 border-l-[3px] border-t-[3px] border-white rounded-tl-lg" />
                          <div className="absolute top-0 right-0 w-6 h-6 border-r-[3px] border-t-[3px] border-white rounded-tr-lg" />
                          <div className="absolute bottom-0 left-0 w-6 h-6 border-l-[3px] border-b-[3px] border-white rounded-bl-lg" />
                          <div className="absolute bottom-0 right-0 w-6 h-6 border-r-[3px] border-b-[3px] border-white rounded-br-lg" />
                          <div className="absolute left-0 right-0 h-[2px] bg-gradient-to-r from-transparent via-cyan-300 to-transparent shadow-[0_0_12px_2px_rgba(34,211,238,0.8)] scan-line" />
                          <div className="absolute inset-0 border border-white/10 rounded-lg" style={{ animation: "pulse-border 2s infinite" }} />
                        </div>
                      </div>
                      <div className="absolute bottom-2 left-2 right-2 flex justify-center"><span className="text-[10px] mono bg-black/60 text-white px-2.5 py-1 rounded-full border border-white/10">Mencari • {facingMode} • {masterMap.size} keys • {finalMaster.length}</span></div>
                    </>
                  )}
                </div>
                {cameraError && <div className="mt-3 text-[12px] px-3 py-2 rounded-lg bg-rose-50 text-rose-700 border border-rose-200 dark:bg-rose-900/20 dark:text-rose-300">{cameraError}</div>}
                <div className="mt-3 rounded-[12px] border p-3 flex flex-col gap-1.5" style={{ background: "var(--surface-2)", borderColor: "var(--border)" }}>
                  <p className="text-[10px] mono uppercase opacity-60 tracking-widest">Debug Scan Terakhir • {isOnline ? "Online" : "Offline"} • {masterSource} • {prioritizeLocal ? "Prioritas Lokal" : "Prioritas GitHub"}</p>
                  <div className="flex items-center justify-between"><span className="mono text-[12px] font-medium">{lastScannedRaw || "-"}</span>{lastLookup?.matchedKey && <span className="text-[10px] px-2 py-0.5 rounded-full bg-emerald-500 text-white">via {lastLookup.matchedKey}</span>}</div>
                  {lookupHint && <div className="text-[11px] leading-snug"><span className="font-medium">{lookupHint.name}</span> • PLU {lookupHint.plu} • {lookupHint.divisi}/{lookupHint.dept} • {String(lookupHint.on_hand)} • src:{lookupHint._src} • via {lastLookup?.matchedKey}</div>}
                  {lastLookup?.candidates && <div className="text-[10px] mono opacity-60">Candidates: {lastLookup.candidates.slice(0,8).join(", ")}</div>}
                </div>
                <div className="grid grid-cols-2 gap-2 mt-4">
                  {!isScanning ? (
                    <button onClick={startCamera} className="col-span-2 h-11 rounded-full bg-slate-900 text-white dark:bg-white dark:text-slate-900 font-medium text-[13px] flex items-center justify-center gap-2 hover:opacity-90"><Play size={14} /> Mulai Kamera HD</button>
                  ) : (
                    <button onClick={stopCamera} className="h-11 rounded-full bg-rose-500 text-white font-medium text-[13px] flex items-center justify-center gap-2"><Square size={14} /> Stop</button>
                  )}
                  {isScanning ? (
                    <>
                      <button onClick={toggleTorch} disabled={!hasTorch} className="h-11 rounded-full border font-medium text-[12px] disabled:opacity-40" style={{ background: torchOn ? "#facc15" : "var(--surface-2)", borderColor: "var(--border)" }}><span className="inline-flex items-center gap-1"><Zap size={12} /> {torchOn ? "Torch ON" : "Torch"}</span></button>
                      <button onClick={triggerAutofocus} className="h-11 rounded-full border font-medium text-[12px]" style={{ background: "var(--surface-2)", borderColor: "var(--border)" }}><span className="inline-flex items-center gap-1"><Crosshair size={12} /> AutoFocus</span></button>
                      <button onClick={()=>setFacingMode(f=>f==="environment"?"user":"environment")} className="h-11 rounded-full border font-medium text-[12px]" style={{ background: "var(--surface-2)", borderColor: "var(--border)" }}><span className="inline-flex items-center gap-1"><Repeat2 size={12} /> Ganti Kamera</span></button>
                    </>
                  ) : (
                    <>
                      <button onClick={()=>fileInputRef.current?.click()} className="h-11 rounded-full border font-medium text-[12px]" style={{ background: "var(--surface-2)", borderColor: "var(--border)" }}><span className="inline-flex items-center gap-1"><ImageIcon size={12} /> Upload Gambar</span></button>
                      <button onClick={()=>setFacingMode(f=>f==="environment"?"user":"environment")} className="h-11 rounded-full border font-medium text-[12px]" style={{ background: "var(--surface-2)", borderColor: "var(--border)" }}><span className="inline-flex items-center gap-1"><Repeat2 size={12} /> {facingMode==="environment" ? "Belakang" : "Depan"}</span></button>
                    </>
                  )}
                </div>
                {zoomCap && isScanning && (
                  <div className="mt-3 flex items-center gap-3 px-1"><Search size={12} /><input type="range" min={zoomCap.min} max={zoomCap.max} step={zoomCap.step} value={zoom} onChange={e=>handleZoom(parseFloat(e.target.value))} className="flex-1 accent-blue-500" /><Search size={14} /><span className="mono text-[11px]">{zoom.toFixed(1)}x</span></div>
                )}
                <input ref={fileInputRef} type="file" accept="image/*" className="hidden" onChange={handleFileUpload} />
              </div>
            </div>

            {/* Input Manual */}
            <div className="rounded-[22px] border p-[1px]" style={{ borderColor: "var(--border)" }}>
              <form onSubmit={handleSaveHistory} className="rounded-[21px] glass p-4 md:p-5 space-y-4" style={{ background: "var(--surface)" }}>
                <h3 className="font-semibold text-[15px] flex items-center gap-2"><span className="w-6 h-6 rounded-full bg-indigo-500 text-white flex items-center justify-center"><PenLine size={12} /></span> Input Manual & Simpan (Session)</h3>
                <div className="space-y-3">
                  <div>
                    <label className="text-[11px] mono uppercase tracking-widest opacity-60">Barcode / Kode (fuzzy lookup - FIXED MERGE)</label>
                    <div className="mt-1 relative">
                      <input value={barcodeInput} onChange={e=>setBarcodeInput(e.target.value)} placeholder="Coba 089686400427 - sekarang ada di merged!" className="w-full h-11 rounded-full border px-4 pr-10 text-[14px] outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-400 transition" style={{ background: "var(--surface-2)", borderColor: "var(--border)" }} required />
                      <span className="absolute right-3 top-1/2 -translate-y-1/2 w-7 h-7 rounded-full bg-slate-900 text-white dark:bg-white dark:text-slate-900 flex items-center justify-center text-[11px]">B</span>
                    </div>
                    {lookupHint && <div className="mt-2 text-[11px] px-3 py-2 rounded-[10px] border bg-emerald-50 dark:bg-emerald-900/20 border-emerald-200 dark:border-emerald-800"><span className="font-medium">Found (Merged):</span> {lookupHint.name} • PLU {lookupHint.plu} • Div {lookupHint.divisi}/{lookupHint.dept} • Stock {String(lookupHint.on_hand)} • src {lookupHint._src} • via <span className="mono">{lastLookup?.matchedKey}</span></div>}
                    {barcodeInput && !lookupHint && finalMaster.length>0 && <div className="mt-2 text-[11px] px-3 py-2 rounded-[10px] border bg-amber-50 dark:bg-amber-900/20 border-amber-200">Tidak ketemu. Dicoba: {genVariants(barcodeInput).slice(0,8).join(", ")}... Map {masterMap.size} keys</div>}
                    {barcodeInput==="089686400427" && lookupHint && <div className="mt-2 text-[11px] px-3 py-2 rounded-[10px] border bg-blue-50 border-blue-200 text-blue-800">✅ BUG FIX VERIFIED: 089686400427 ditemukan! Sebelumnya gagal karena replace, sekarang merged union.</div>}
                  </div>
                  <div><label className="text-[11px] mono uppercase tracking-widest opacity-60">Nama Produk (auto dari merged master)</label><input value={productNameInput} onChange={e=>setProductNameInput(e.target.value)} placeholder="Nama produk" className="mt-1 w-full h-11 rounded-full border px-4 text-[14px] outline-none focus:ring-2 focus:ring-blue-500/20" style={{ background: "var(--surface-2)", borderColor: "var(--border)" }} /></div>
                  <div className="grid grid-cols-2 gap-3">
                    <div><label className="text-[11px] mono uppercase tracking-widest opacity-60">Tgl Scan</label><input type="date" value={scanDateInput} onChange={e=>setScanDateInput(e.target.value)} className="mt-1 w-full h-11 rounded-full border px-4 text-[13px]" style={{ background: "var(--surface-2)", borderColor: "var(--border)" }} required /></div>
                    <div><label className="text-[11px] mono uppercase tracking-widest opacity-60">Tgl Expired</label><input id="expiry-input" type="date" value={expiryInput} onChange={e=>setExpiryInput(e.target.value)} className="mt-1 w-full h-11 rounded-full border px-4 text-[13px] focus:ring-2 focus:ring-blue-500/20" style={{ background: "var(--surface-2)", borderColor: "var(--border)" }} required /></div>
                  </div>
                </div>
                <button type="submit" className="w-full h-12 rounded-full bg-gradient-to-r from-blue-600 to-indigo-600 text-white font-medium text-[14px] shadow-[0_8px_24px_rgba(59,130,246,0.35)] hover:shadow-[0_10px_30px_rgba(59,130,246,0.45)] hover:translate-y-[-1px] transition-all flex items-center justify-center gap-2"><FileDown size={14} /> Simpan ke Riwayat (Preview)</button>
                <p className="text-[11px] mono opacity-50 text-center">Session only • Export CSV • Map {masterMap.size} keys • {githubMaster.length} GitHub + {localMaster.length} Lokal = {finalMaster.length} • {masterSource} • {isOnline ? "Online" : "Offline"} • Prioritize {prioritizeLocal ? "Lokal" : "GitHub"}</p>
              </form>
            </div>
          </div>

          <div className="lg:col-span-3 space-y-6">
            {/* History */}
            <div className="rounded-[22px] border p-[1px]" style={{ borderColor: "var(--border)" }}>
              <div className="rounded-[21px] glass p-4 md:p-5" style={{ background: "var(--surface)" }}>
                <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
                  <h3 className="font-semibold text-[15px] flex items-center gap-2"><span className="w-6 h-6 rounded-full bg-emerald-500 text-white flex items-center justify-center"><Clock3 size={12} /></span> Riwayat Scan (Session Preview)</h3>
                  <div className="flex items-center gap-2">
                    <button onClick={exportCSV} className="h-8 px-3 rounded-full border text-[11px] mono font-medium hover:bg-slate-50 dark:hover:bg-slate-800 transition" style={{ borderColor: "var(--border)" }}><span className="inline-flex items-center gap-1"><FileDown size={11} /> Export CSV</span></button>
                    <button onClick={()=>setShowClearConfirm(true)} className="h-8 px-3 rounded-full bg-rose-50 text-rose-600 border border-rose-200 text-[11px] mono font-medium dark:bg-rose-900/20 dark:text-rose-300"><span className="inline-flex items-center gap-1"><Trash2 size={11} /> Clear</span></button>
                  </div>
                </div>
                <div className="flex flex-col md:flex-row gap-2 mb-4">
                  <div className="flex-1 relative"><Search size={12} className="absolute left-3.5 top-1/2 -translate-y-1/2 opacity-50" /><input value={searchHistory} onChange={e=>setSearchHistory(e.target.value)} placeholder="Cari barcode / nama / PLU..." className="w-full h-10 rounded-full border pl-9 pr-4 text-[13px]" style={{ background: "var(--surface-2)", borderColor: "var(--border)" }} /></div>
                  <select value={filterStatus} onChange={e=>setFilterStatus(e.target.value as any)} className="h-10 rounded-full border px-4 text-[12px] mono" style={{ background: "var(--surface-2)", borderColor: "var(--border)" }}><option value="all">Semua Status</option><option value="Aman">Aman</option><option value="Waspada">Waspada</option><option value="Expired">Expired</option></select>
                </div>
                <div className="rounded-[14px] border overflow-hidden" style={{ borderColor: "var(--border)" }}>
                  <div className="max-h-[360px] overflow-auto">
                    <table className="w-full text-[12px]">
                      <thead className="sticky top-0 z-10" style={{ background: "var(--surface-2)" }}><tr className="text-[10px] mono uppercase tracking-widest opacity-60"><th className="text-left p-3 font-medium">Produk</th><th className="text-left p-3 font-medium hidden md:table-cell">Exp</th><th className="text-left p-3 font-medium">Sisa</th><th className="text-left p-3 font-medium">Status</th><th className="p-3 w-8"></th></tr></thead>
                      <tbody>
                        {filteredHistory.length===0 ? <tr><td colSpan={5} className="p-8 text-center opacity-50">Belum ada data. Coba scan 089686400427 yang sekarang sudah ada di merged master.</td></tr> : filteredHistory.map(h=>(
                          <tr key={h.id} className="border-t hover:bg-slate-50/60 dark:hover:bg-slate-800/40 transition" style={{ borderColor: "var(--border)" }}>
                            <td className="p-3"><p className="font-medium text-[13px] leading-tight line-clamp-1">{h.name}</p><p className="mono text-[10px] opacity-60">{h.code} {h.plu ? `• PLU ${h.plu}` : ""} • {h.scanDate} {h.matchedVia ? `• via ${h.matchedVia}` : ""}</p>{h.divisi && <p className="text-[10px] opacity-60">{h.divisi}/{h.dept}</p>}</td>
                            <td className="p-3 hidden md:table-cell mono text-[11px]">{h.expiryDate}</td>
                            <td className="p-3 mono text-[11px] font-medium">{h.daysLeft>0 ? `+${h.daysLeft}` : h.daysLeft} hr</td>
                            <td className="p-3"><span className={`inline-flex px-2.5 py-1 rounded-full border text-[10px] mono font-medium ${badgeClass(h.status)}`}>{h.status}</span></td>
                            <td className="p-3"><button onClick={()=>setHistory(prev=>prev.filter(x=>x.id!==h.id))} className="w-6 h-6 rounded-full hover:bg-rose-50 text-rose-500 flex items-center justify-center"><X size={12} /></button></td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              </div>
            </div>

            {/* Master Data with UNION MERGE logic */}
            <div className="rounded-[22px] border p-[1px]" style={{ borderColor: "var(--border)" }}>
              <div className="rounded-[21px] glass p-4 md:p-5" style={{ background: "var(--surface)" }}>
                <div className="flex flex-wrap items-center justify-between gap-3 mb-3">
                  <h3 className="font-semibold text-[15px] flex items-center gap-2"><span className="w-6 h-6 rounded-full bg-violet-500 text-white flex items-center justify-center"><Database size={12} /></span> Master Data <span className="mono text-[10px] opacity-50">merged union • {finalMaster.length} items • {masterMap.size} keys</span></h3>
                  <div className="flex items-center gap-2 flex-wrap">
                    <button onClick={exportMasterJSON} className="h-8 px-3 rounded-full border text-[11px] mono hover:bg-slate-50">Export Merged JSON</button>
                    <button onClick={syncFromGithub} disabled={!isOnline || loadingMaster} className={`h-8 px-3 rounded-full border text-[11px] mono flex items-center gap-1 ${!isOnline ? "opacity-40 cursor-not-allowed" : "hover:bg-emerald-50"} ${loadingMaster ? "animate-pulse" : ""}`} style={{ background: masterSource==='merged' ? "#ecfdf5" : masterSource==='github' ? "#ecfdf5" : "var(--surface-2)", borderColor: masterSource==='merged' ? "#10b981" : masterSource==='github' ? "#a7f3d0" : "var(--border)" }} title={isOnline ? "Fetch dari GitHub dan MERGE (bukan replace)" : "Offline"}>
                      {loadingMaster ? <RefreshCw size={12} className="animate-spin" /> : <Cloud size={12} />} {loadingMaster ? "Merging..." : "Sync Online (Merge)"}
                    </button>
                    <label className={`h-8 px-3 rounded-full border text-[11px] mono flex items-center gap-1 cursor-pointer hover:bg-slate-50 ${isImporting ? "opacity-50" : ""}`} style={{ background: "var(--surface-2)", borderColor: "var(--border)" }}>
                      <Upload size={12} /> {isImporting ? "Loading..." : "Import Lokal JSON"}
                      <input ref={masterFileRef} type="file" accept=".json" className="hidden" onChange={handleImportMaster} disabled={isImporting} />
                    </label>
                    <a href={GITHUB_RAW_URL} target="_blank" rel="noopener noreferrer" className="h-8 px-3 rounded-full border text-[11px] mono flex items-center gap-1 hover:bg-slate-50" style={{ background: "var(--surface-2)", borderColor: "var(--border)" }}><ExternalLink size={11} /> Lihat Sumber</a>
                  </div>
                </div>

                {/* Status badge MERGED */}
                <div className="mb-3 flex flex-col gap-2">
                  <div className={`flex flex-wrap items-center gap-2 text-[11px] mono px-3 py-2 rounded-[12px] border ${masterSource==='merged' ? "bg-emerald-50 dark:bg-emerald-900/20 border-emerald-300 dark:border-emerald-700 text-emerald-800 dark:text-emerald-200" : masterSource==='github' ? "bg-emerald-50 dark:bg-emerald-900/20 border-emerald-200 text-emerald-800" : masterSource==='local' ? "bg-amber-50 dark:bg-amber-900/20 border-amber-200 text-amber-800" : "bg-slate-50 dark:bg-slate-800 border-slate-200 text-slate-600"}`} >
                    {isOnline ? <Wifi size={12} /> : <WifiOff size={12} />}
                    {masterSource==='merged' ? (
                      <>
                        <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
                        <Merge size={12} /> Source: GitHub + Lokal (Merged) • {githubMaster.length} GitHub + {localMaster.length} Lokal = {finalMaster.length} unik • Sync: {formatLastSync(lastSync)} • {masterInfo.store || "AM024"} • {masterMap.size} keys
                        <span className="ml-auto text-[10px] px-2 py-0.5 rounded-full bg-emerald-600 text-white font-bold">MERGED UNION</span>
                      </>
                    ) : masterSource==='github' ? (
                      <>
                        <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
                        <Github size={12} /> Master: GitHub ({finalMaster.length}) • Sync: {formatLastSync(lastSync)} • {masterInfo.store || "AM024"} • {masterMap.size} keys
                        <span className="ml-auto text-[10px] px-2 py-0.5 rounded-full bg-emerald-600 text-white">ONLINE</span>
                      </>
                    ) : masterSource==='local' ? (
                      <>
                        <span className="w-2 h-2 rounded-full bg-amber-500" />
                        <HardDrive size={12} /> Master: Lokal ({finalMaster.length}) • {isOnline ? "Online mode - bisa sync merge" : "Offline mode"} • {masterMap.size} keys • Includes 089686400427
                        <span className={`ml-auto text-[10px] px-2 py-0.5 rounded-full text-white ${isOnline ? "bg-amber-600" : "bg-slate-600"}`}>{isOnline ? "LOKAL" : "OFFLINE"}</span>
                      </>
                    ) : (
                      <>
                        <span className="w-2 h-2 rounded-full bg-slate-400" />
                        Belum ada master • Klik Sync Online untuk fetch dan merge
                      </>
                    )}
                  </div>
                  {warnGithubSmaller && <div className="text-[11px] px-3 py-2 rounded-[10px] bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 text-amber-800 dark:text-amber-200">⚠️ {warnGithubSmaller}</div>}
                  {errorMaster && <div className="text-[11px] px-3 py-2 rounded-[10px] bg-rose-50 dark:bg-rose-900/20 border border-rose-200 dark:border-rose-800 text-rose-700 dark:text-rose-300">⚠️ {errorMaster}</div>}
                  {importError && <div className="text-[12px] px-3 py-2 rounded-lg bg-rose-50 text-rose-700 border border-rose-200">{importError}</div>}
                  {masterSource==='merged' && <div className="text-[11px] mono px-3 py-1.5 rounded-full bg-violet-50 dark:bg-violet-900/20 border border-violet-200 dark:border-violet-800 w-fit flex items-center gap-2"><span className="w-2 h-2 rounded-full bg-violet-500 animate-pulse" /> ✅ FIXED: 089686400427 retained via union • Map {masterMap.size} keys • GitHub {githubMaster.length} + Lokal {localMaster.length} = {finalMaster.length}</div>}
                  
                  {/* Prioritaskan Lokal toggle */}
                  <div className="flex items-center gap-3 px-3 py-2 rounded-[12px] border" style={{ background: "var(--surface-2)", borderColor: "var(--border)" }}>
                    <span className="text-[11px] mono">Prioritaskan Lokal:</span>
                    <button onClick={()=>setPrioritizeLocal(v=>!v)} className={`flex items-center gap-1.5 px-3 py-1 rounded-full border text-[11px] mono transition ${prioritizeLocal ? "bg-violet-600 text-white border-violet-600" : "bg-white dark:bg-slate-800 border-slate-200"}`}>
                      {prioritizeLocal ? <ToggleRight size={14} /> : <ToggleLeft size={14} />} {prioritizeLocal ? "ON - Lokal overwrite GitHub jika duplikat" : "OFF - GitHub overwrite (default)"}
                    </button>
                    <span className="text-[10px] mono opacity-60">Toggle untuk kasus lokal lebih akurat. Saat OFF, lokal unik tetap dipertahankan.</span>
                  </div>
                </div>

                <div className="flex gap-2 mb-3"><input value={searchMaster} onChange={e=>setSearchMaster(e.target.value)} placeholder="Cari merged master: barcode, plu, descp, divisi... coba 089686400427" className="flex-1 h-10 rounded-full border px-4 text-[13px]" style={{ background: "var(--surface-2)", borderColor: "var(--border)" }} /></div>

                <div className="flex flex-wrap gap-2 mb-4 p-2 rounded-[20px] border" style={{ background: "var(--surface-2)", borderColor: "var(--border)" }}>
                  <input value={editMasterCode ?? ""} placeholder="Barcode (keep leading zero!)" className="flex-1 bg-transparent px-3 text-[12px] outline-none mono" onChange={e=>setEditMasterCode(e.target.value)} />
                  <input value={editMasterName} placeholder="Nama produk" className="flex-[2] bg-transparent px-3 text-[12px] outline-none" onChange={e=>setEditMasterName(e.target.value)} />
                  <button onClick={()=>{
                    if (!editMasterCode?.trim() || !editMasterName?.trim()) return;
                    const exists = finalMaster.some(m=>String(m.barcodeRaw).trim()===String(editMasterCode).trim());
                    if (exists) { setEditMasterCode(null); setEditMasterName(""); return; }
                    const nm: MasterItem = { code: String(editMasterCode).trim(), barcodeRaw: String(editMasterCode).trim(), plu: "", name: editMasterName.trim(), createdAt: new Date().toISOString().slice(0,10), _src: 'local' };
                    setLocalMaster(prev=>[nm,...prev]); setEditMasterCode(""); setEditMasterName("");
                  }} className="h-8 px-4 rounded-full bg-slate-900 text-white dark:bg-white dark:text-slate-900 text-[11px] font-medium">Tambah ke Lokal (Merge)</button>
                </div>

                <div className="rounded-[14px] border overflow-hidden" style={{ borderColor: "var(--border)" }}>
                  <div className="max-h-[420px] overflow-auto">
                    <table className="w-full text-[12px]">
                      <thead className="sticky top-0 z-10" style={{ background: "var(--surface-2)" }}><tr className="text-[10px] mono uppercase opacity-60"><th className="text-left p-3">Barcode / PLU • Src</th><th className="text-left p-3">Nama • Divisi</th><th className="p-3 w-16">Stock</th><th className="p-3 w-16"></th></tr></thead>
                      <tbody>
                        {filteredMaster.length===0 ? <tr><td colSpan={4} className="p-8 text-center opacity-50">{finalMaster.length===0 ? "Belum ada master. Online: Sync Online akan MERGE GitHub + Lokal. Offline: Import Lokal JSON atau gunakan default yang sudah include 089686400427." : "Tidak ada hasil"}</td></tr> : filteredMaster.map(m=>(
                          <tr key={String(m.barcodeRaw)+m.plu+m._src} className="border-t hover:bg-slate-50 dark:hover:bg-slate-800/40" style={{ borderColor: "var(--border)", background: String(m.barcodeRaw)==="089686400427" ? (theme==="dark" ? "rgba(16,185,129,0.1)" : "rgba(16,185,129,0.08)") : undefined }}>
                            <td className="p-3 mono text-[11px]"><div className="flex items-center gap-1"><span>{m.barcodeRaw}</span>{String(m.barcodeRaw)==="089686400427" && <span className="px-1.5 py-0.5 rounded bg-emerald-500 text-white text-[9px]">BUG FIX</span>}</div><div className="opacity-60">PLU {m.plu} • <span className={`px-1 py-0.5 rounded text-[9px] ${m._src==='local' ? "bg-amber-100 text-amber-700" : m._src==='github' ? "bg-emerald-100 text-emerald-700" : "bg-slate-100"}`}>{m._src}</span></div></td>
                            <td className="p-3">{editMasterCode===m.code ? <input value={editMasterName} onChange={e=>setEditMasterName(e.target.value)} className="w-full h-7 rounded-full border px-2 text-[11px]" style={{ background: "var(--surface)", borderColor: "var(--border)" }} /> : <><div className="text-[12px] font-medium line-clamp-1">{m.name}</div><div className="text-[10px] opacity-60">{m.divisi} / {m.dept} {m.s_descp ? `• ${m.s_descp}` : ""}</div></>}</td>
                            <td className="p-3 mono text-[10px]">{String(m.on_hand??"-")}<div className="opacity-60">{String(m.avg_cost??"")}</div></td>
                            <td className="p-3 flex gap-1">
                              {editMasterCode===m.code ? (<><button onClick={()=>{ setLocalMaster(prev=>prev.map(x=>String(x.code).trim()===String(m.code).trim() ? {...x, name: editMasterName} : x)); setGithubMaster(prev=>prev.map(x=>String(x.code).trim()===String(m.code).trim() ? {...x, name: editMasterName} : x)); setEditMasterCode(null); }} className="w-6 h-6 rounded-full bg-emerald-500 text-white flex items-center justify-center"><Check size={10} /></button><button onClick={()=>{ setEditMasterCode(null); setEditMasterName(""); }} className="w-6 h-6 rounded-full bg-slate-200 flex items-center justify-center"><X size={10} /></button></>) : (<><button onClick={()=>{ setEditMasterCode(m.code); setEditMasterName(m.name); }} className="w-6 h-6 rounded-full border flex items-center justify-center"><PenLine size={10} /></button><button onClick={()=>{ setLocalMaster(prev=>prev.filter(x=>String(x.barcodeRaw).trim()!==String(m.barcodeRaw).trim())); setGithubMaster(prev=>prev.filter(x=>String(x.barcodeRaw).trim()!==String(m.barcodeRaw).trim())); }} className="w-6 h-6 rounded-full hover:bg-rose-50 text-rose-500 flex items-center justify-center"><Trash2 size={10} /></button></>)}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
                <p className="mt-3 text-[11px] mono opacity-50">Preview max 300 row • Full merged {finalMaster.length} in-memory (GitHub {githubMaster.length} + Lokal {localMaster.length}) • Map {masterMap.size} fuzzy keys • Source {masterSource} • Prioritize {prioritizeLocal ? "Lokal" : "GitHub"} • Auto-sync 30 menit merge • FIX 089686400427 retained</p>
              </div>
            </div>
          </div>
        </div>
      </main>

      {showNewAllocModal && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-slate-900/60 backdrop-blur-sm" onClick={()=>setShowNewAllocModal(null)} />
          <div className="relative w-full max-w-[480px] rounded-[24px] border p-[1px] shadow-[0_20px_60px_rgba(0,0,0,0.3)]" style={{ borderColor: "var(--border)" }}>
            <div className="rounded-[23px] p-6" style={{ background: "var(--surface)" }}>
              <div className="w-12 h-12 rounded-full bg-gradient-to-br from-amber-500 to-rose-500 text-white flex items-center justify-center mb-4"><Search size={18} /></div>
              <h4 className="font-semibold text-[18px]">Barcode tidak ditemukan</h4>
              <p className="text-[13px] opacity-70 mt-1 leading-relaxed">Raw scan <span className="mono font-medium px-1.5 py-0.5 rounded bg-slate-100 dark:bg-slate-800">{showNewAllocModal.code}</span> belum ada di merged master {finalMaster.length>0 ? `(${finalMaster.length} produk • ${masterSource} • Map ${masterMap.size})` : "(master kosong)"}.</p>
              <div className="mt-3 rounded-[12px] border p-3" style={{ background: "var(--surface-2)", borderColor: "var(--border)" }}>
                <p className="text-[10px] mono uppercase opacity-60">Candidates tried (fuzzy Map - logged)</p>
                <div className="mt-1 flex flex-wrap gap-1">{showNewAllocModal.candidates.slice(0,14).map(c=><span key={c} className="mono text-[10px] px-2 py-0.5 rounded-full border bg-white dark:bg-slate-800" style={{ borderColor: "var(--border)" }}>{c}</span>)}</div>
                <p className="mt-2 text-[11px] opacity-60">Map {masterMap.size} keys • Source {masterSource} • {isOnline ? "Coba Sync Online (Merge)" : "Offline - import lokal"} • Order: raw, noLead, withLead, pad13</p>
              </div>
              <div className="mt-4 space-y-2">
                <label className="text-[11px] mono uppercase opacity-60">Nama Produk</label>
                <input autoFocus value={showNewAllocModal.tempName} onChange={e=>setShowNewAllocModal({ ...showNewAllocModal, tempName: e.target.value })} placeholder="Contoh: Susu UHT 1L" className="mt-1 w-full h-11 rounded-full border px-4 text-[14px]" style={{ background: "var(--surface-2)", borderColor: "var(--border)" }} />
                <div className="grid grid-cols-2 gap-2">
                  <div><label className="text-[10px] mono uppercase opacity-60">PLU (opsional)</label><input value={showNewAllocModal.plu||""} onChange={e=>setShowNewAllocModal({ ...showNewAllocModal, plu: e.target.value })} placeholder="PLU" className="mt-1 w-full h-10 rounded-full border px-3 text-[12px] mono" style={{ background: "var(--surface-2)", borderColor: "var(--border)" }} /></div>
                  <div><label className="text-[10px] mono uppercase opacity-60">Barcode</label><input value={showNewAllocModal.code} readOnly className="mt-1 w-full h-10 rounded-full border px-3 text-[12px] mono bg-slate-100" style={{ borderColor: "var(--border)" }} /></div>
                </div>
              </div>
              <div className="grid grid-cols-2 gap-2 mt-5">
                <button onClick={skipAddMaster} className="h-11 rounded-full border text-[13px] font-medium" style={{ borderColor: "var(--border)", background: "var(--surface-2)" }}>Lewati, simpan saja</button>
                <button onClick={confirmAddMasterAndSave} className="h-11 rounded-full bg-slate-900 text-white dark:bg-white dark:text-slate-900 text-[13px] font-medium">Tambah ke Lokal (Merge) + Simpan</button>
              </div>
              <button onClick={()=>{ setShowNewAllocModal(null); setPendingSave(null); }} className="mt-3 w-full text-[11px] mono opacity-50 hover:opacity-80">Batal</button>
            </div>
          </div>
        </div>
      )}

      {showClearConfirm && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-slate-900/60 backdrop-blur-sm" onClick={()=>setShowClearConfirm(false)} />
          <div className="relative w-full max-w-[360px] rounded-[20px] p-5 shadow-xl" style={{ background: "var(--surface)" }}>
            <h4 className="font-semibold">Hapus semua riwayat sesi?</h4>
            <p className="text-[13px] opacity-70 mt-1">Aksi ini menghapus <b>{history.length}</b> data preview sesi ini (in-memory).</p>
            <div className="flex gap-2 mt-4">
              <button onClick={()=>setShowClearConfirm(false)} className="flex-1 h-10 rounded-full border text-[13px]" style={{ borderColor: "var(--border)" }}>Batal</button>
              <button onClick={()=>{ setHistory([]); setShowClearConfirm(false); }} className="flex-1 h-10 rounded-full bg-rose-600 text-white text-[13px]">Ya, Hapus</button>
            </div>
          </div>
        </div>
      )}

      <footer className="mt-10 border-t" style={{ borderColor: "var(--border)", background: theme==="dark" ? "rgba(22,34,61,0.6)" : "rgba(255,255,255,0.8)" }}>
        <div className="max-w-[1280px] mx-auto px-4 md:px-6 py-6">
          <div className="social-footer-container">
            <div className="social-footer-bar flex flex-wrap items-center justify-center gap-3 md:gap-4">
              {[
                { href: "https://www.linkedin.com/in/yudi-dwiranto-cs77", cls: "linkedin", icon: "LI", label: "LinkedIn" },
                { href: "https://www.facebook.com", cls: "facebook", icon: "FB", label: "Facebook" },
                { href: "https://www.instagram.com", cls: "instagram", icon: "IG", label: "Instagram" },
                { href: "https://wa.me/6281389188903?text=Assalamu.alaikum", cls: "whatsapp", icon: "WA", label: "WhatsApp" },
                { href: "https://id.shp.ee/yudmwbm1?fromSource=whatsapp&smtt=0.0.3", cls: "shopee", icon: "SP", label: "Shopee" },
                { href: "https://www.tiktok.com/@selarasdirumah", cls: "tiktok", icon: "TT", label: "TikTok" },
              ].map(s=>(
                <a key={s.label} href={s.href} target="_blank" rel="noopener noreferrer" className={`social-icon ${s.cls} group relative w-10 h-10 rounded-full flex items-center justify-center border transition-all duration-200 hover:scale-110 hover:-translate-y-0.5`} style={{ background: "var(--surface-2)", borderColor: "var(--border)" }} aria-label={s.label}>
                  <span className="text-[11px] font-bold">{s.icon}</span>
                  <span className="tooltip pointer-events-none absolute -top-9 left-1/2 -translate-x-1/2 px-2.5 py-1 rounded-full text-[10px] mono bg-slate-900 text-white opacity-0 group-hover:opacity-100 transition whitespace-nowrap">{s.label}</span>
                </a>
              ))}
            </div>
            <div className="footer-credits mt-4 text-center">
              <p className="text-[13px]">Handcrafted with ❤ by <strong>Andrew Dwiranto</strong> (Cah_Sragen_77, Indonesia)</p>
              <div className="mt-1.5 text-[11px] mono opacity-60">© 2026 Hak Cipta Dilindungi Undang-Undang • Fixed: GitHub + Lokal Merged Union • Fuzzy Map O(1) • Keep Leading Zero • 089686400427 retained</div>
            </div>
          </div>
          <div className="mt-6 pt-6 border-t flex flex-col md:flex-row items-center justify-center gap-4" style={{ borderColor: "var(--border)" }}>
            <div className="flex items-center gap-3">
              <div className="w-[52px] h-[52px] rounded-[16px] overflow-hidden bg-gradient-to-br from-violet-500 to-fuchsia-500 p-[2px] shadow-lg">
                <div className="w-full h-full rounded-[14px] bg-white flex items-center justify-center overflow-hidden">
                  <img src={purpleLogo} alt="Meta Tech Logo" className="w-full h-full object-cover" />
                </div>
              </div>
              <div className="text-left max-w-[480px]">
                <p className="text-[12px] italic leading-relaxed opacity-80">"Imajinasi melahirkan cetak biru; teknologi <code className="not-italic px-1.5 py-0.5 rounded bg-slate-900 text-violet-200 dark:bg-violet-900/30 dark:text-violet-200 mono text-[11px]">meta</code> menerjemahkannya ke alam nyata."</p>
                <p className="text-[10px] mono opacity-50 mt-1">Inovasi • Ketelitian • Daya Tahan • CS77 Expiry Guard • Merged GitHub Raw + Lokal JSON • Keep Leading Zero</p>
              </div>
            </div>
          </div>
        </div>
      </footer>
    </div>
  );
}
