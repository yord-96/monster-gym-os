"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toPng } from "html-to-image";
import QRCode from "qrcode";

type View = "inicio" | "clientes" | "planes" | "fidelidad" | "asistencias" | "reportes";
type ScanStep = "camera" | "found" | "success" | "missing";

type ClientRecord = {
  id: string;
  token: string;
  name: string;
  phone: string;
  plan: string;
  photo: string;
  createdAt: string;
  expiresAt: string;
  visits: number;
  stamps: number;
  lastVisit?: string;
  visitHistory?: string[];
};

type ActivityRecord = {
  id: string;
  clientId: string;
  clientName: string;
  type: "registro" | "visita" | "premio";
  description: string;
  createdAt: string;
};

const MEMBER_QUERY_KEY = "checkin";
const plans = [
  { name: "Plan Fuerza · Mensual", duration: 30, price: "Bs 180", tone: "purple" },
  { name: "Plan Elite · Trimestral", duration: 90, price: "Bs 480", tone: "lime" },
  { name: "Plan Monster · Anual", duration: 365, price: "Bs 1.650", tone: "coral" },
];

const initials = (name: string) => name.split(" ").filter(Boolean).map((word) => word[0]).join("").slice(0, 2).toUpperCase() || "MG";
const formatDate = (value: string) => new Intl.DateTimeFormat("es-BO", { day: "2-digit", month: "short", year: "numeric" }).format(new Date(value));
const formatStampDateTime = (value: string) => new Intl.DateTimeFormat("es-BO", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" }).format(new Date(value));
const isToday = (value: string) => new Date(value).toDateString() === new Date().toDateString();
const memberQrValue = (token: string) => `MONSTER-GYM:${token}`;
const tokenFromQr = (value: string) => {
  const decoded = value.trim();
  if (/^MONSTER-GYM:/i.test(decoded)) return decoded.replace(/^MONSTER-GYM:/i, "");
  if (decoded.includes("monster-gym://member/")) return decoded.split("monster-gym://member/")[1] ?? "";
  try {
    const url = new URL(decoded);
    return url.searchParams.get(MEMBER_QUERY_KEY) ?? decoded;
  } catch {
    return decoded.replace(/^ID\s*/i, "");
  }
};
const clientVisitHistory = (client: ClientRecord) => client.visitHistory ?? (client.lastVisit ? [client.lastVisit] : []);

const planExpiryInput = (planName: string) => {
  const plan = plans.find((item) => item.name === planName) ?? plans[0];
  const value = new Date();
  value.setDate(value.getDate() + plan.duration);
  return value.toISOString().slice(0, 10);
};
const expiryIsoFromInput = (value: string) => new Date(`${value}T23:59:59`).toISOString();

async function apiJson<T>(url: string, options?: RequestInit): Promise<T> {
  const response = await fetch(url, {
    ...options,
    headers: { "Content-Type": "application/json", ...(options?.headers ?? {}) },
    cache: "no-store",
  });
  const payload = await response.json().catch(() => ({})) as { error?: string } & T;
  if (!response.ok) throw new Error(payload.error || `Error ${response.status}`);
  return payload;
}

const Icon = ({ children }: { children: React.ReactNode }) => <span className="nav-icon" aria-hidden="true">{children}</span>;

function LoyaltyGalleryCard({ client, onOpen, onVisit }: { client: ClientRecord; onOpen: (client: ClientRecord) => void; onVisit: (client: ClientRecord) => void }) {
  const [qr, setQr] = useState("");

  useEffect(() => {
    let active = true;
    QRCode.toDataURL(memberQrValue(client.token), {
      errorCorrectionLevel: "M",
      width: 640,
      margin: 4,
      color: { dark: "#17141f", light: "#ffffff" },
    }).then((value) => { if (active) setQr(value); });
    return () => { active = false; };
  }, [client.token]);

  const valid = new Date(client.expiresAt) >= new Date();

  return <article className="loyalty-gallery-card">
    <div className="loyalty-card-visual">
      <div className="gallery-card-top">
        <div className="mini-brand"><b>M</b><span>MONSTER<br/><small>GYM OS</small></span></div>
        <span className={`gallery-status ${valid ? "active" : "expired"}`}>{valid ? "ACTIVO" : "VENCIDO"}</span>
      </div>
      <div className="gallery-card-member">
        {client.photo ? <img src={client.photo} alt={`Foto de ${client.name}`}/> : <span>{initials(client.name)}</span>}
        <div><small>MIEMBRO</small><strong>{client.name}</strong><p>{client.plan}</p><code>ID {client.token.slice(0,8).toUpperCase()}</code></div>
      </div>
      <div className="gallery-card-bottom">
        <div className="gallery-loyalty">
          <div><small>FIDELIDAD</small><strong>{client.stamps}/10 sellos</strong></div>
          <div className="gallery-stamps">{Array.from({ length: 10 }, (_, index) => { const visit = clientVisitHistory(client)[index]; return <i className={index < client.stamps ? "filled" : ""} key={index} title={visit ? `Sello ${index + 1}: ${formatStampDateTime(visit)}` : `Sello ${index + 1} pendiente`} aria-label={visit ? `Sello ${index + 1}, ${formatStampDateTime(visit)}` : `Sello ${index + 1} pendiente`}>{index < client.stamps ? "M" : ""}</i>; })}</div>
          {client.lastVisit && <span className="gallery-last-stamp">Último sello · {formatStampDateTime(client.lastVisit)}</span>}
        </div>
        <div className="gallery-qr">{qr ? <img src={qr} alt={`QR único de ${client.name}`}/> : <span>QR</span>}</div>
      </div>
    </div>
    <div className="gallery-card-info"><div><strong>{client.visits} visita{client.visits === 1 ? "" : "s"}</strong><span>{client.stamps === 10 ? "Recompensa disponible" : `Faltan ${10-client.stamps} sellos`}</span></div><div className="gallery-card-actions"><button onClick={() => onOpen(client)}>Ver tarjeta</button><button onClick={() => onVisit(client)}>＋ Visita</button></div></div>
  </article>;
}

export default function Home() {
  const [view, setView] = useState<View>("inicio");
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [hydrated, setHydrated] = useState(false);
  const [centralLoaded, setCentralLoaded] = useState(false);
  const [centralError, setCentralError] = useState("");
  const [clients, setClients] = useState<ClientRecord[]>([]);
  const [activities, setActivities] = useState<ActivityRecord[]>([]);
  const [search, setSearch] = useState("");

  const [clientOpen, setClientOpen] = useState(false);
  const [editingClient, setEditingClient] = useState<ClientRecord | null>(null);
  const [deletingClient, setDeletingClient] = useState<ClientRecord | null>(null);
  const [clientForm, setClientForm] = useState({ name: "", phone: "", plan: plans[0].name, expiresAt: planExpiryInput(plans[0].name) });
  const [photoUrl, setPhotoUrl] = useState("");
  const [formError, setFormError] = useState("");
  const [clientSaving, setClientSaving] = useState(false);

  const [cardOpen, setCardOpen] = useState(false);
  const [cardClient, setCardClient] = useState<ClientRecord | null>(null);
  const [qrDataUrl, setQrDataUrl] = useState("");
  const [downloadStatus, setDownloadStatus] = useState<"idle" | "working" | "done" | "error">("idle");
  const cardRef = useRef<HTMLDivElement>(null);

  const [scannerOpen, setScannerOpen] = useState(false);
  const [scanStep, setScanStep] = useState<ScanStep>("camera");
  const [scannedClient, setScannedClient] = useState<ClientRecord | null>(null);
  const [scanError, setScanError] = useState("");
  const [manualCode, setManualCode] = useState("");
  const scannerRef = useRef<{ stop: () => Promise<void>; clear: () => void | Promise<void> } | null>(null);
  const checkInHandledRef = useRef(false);
  const scanHandledRef = useRef(false);
  const visitSubmittingRef = useRef(false);

  const loadCentralState = useCallback(async (silent = false) => {
    try {
      const data = await apiJson<{ clients: ClientRecord[]; activities: ActivityRecord[] }>("/api/state");
      setClients((data.clients ?? []).map((client) => ({ ...client, visitHistory: clientVisitHistory(client) })));
      setActivities(data.activities ?? []);
      setCentralLoaded(true);
      setCentralError("");
    } catch (error) {
      if (!silent) setCentralError(error instanceof Error ? error.message : "No se pudo conectar con la base central.");
    }
  }, []);

  const registerVisitForClient = useCallback(async (client: ClientRecord) => {
    if (visitSubmittingRef.current) return;
    visitSubmittingRef.current = true;
    try {
      const result = await apiJson<{ client: ClientRecord; activity: ActivityRecord }>(`/api/clients/${encodeURIComponent(client.id)}/visit`, { method: "POST" });
      setClients((current) => current.map((item) => item.id === result.client.id ? result.client : item));
      setActivities((current) => [result.activity, ...current]);
      setScannedClient(result.client);
      setScanStep("success");
      setCentralError("");
    } catch (error) {
      visitSubmittingRef.current = false;
      setScanError(error instanceof Error ? error.message : "No se pudo registrar la visita.");
    }
  }, []);

  useEffect(() => {
    const updateView = () => {
      const next = location.hash.replace("#", "") as View;
      setView(["inicio", "clientes", "planes", "fidelidad", "asistencias", "reportes"].includes(next) ? next : "inicio");
    };
    updateView();
    addEventListener("hashchange", updateView);
    // This one-time hydration flag intentionally initializes client-side state after mount.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setHydrated(true);
    return () => removeEventListener("hashchange", updateView);
  }, []);

  useEffect(() => {
    if (!hydrated) return;
    // Initial synchronization intentionally loads the central server state after hydration.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void loadCentralState();
    const refresh = () => { if (document.visibilityState === "visible") void loadCentralState(true); };
    const timer = window.setInterval(() => { if (document.visibilityState === "visible") void loadCentralState(true); }, 5000);
    document.addEventListener("visibilitychange", refresh);
    return () => { window.clearInterval(timer); document.removeEventListener("visibilitychange", refresh); };
  }, [hydrated, loadCentralState]);

  useEffect(() => {
    if (!centralLoaded || checkInHandledRef.current) return;
    const token = new URLSearchParams(location.search).get(MEMBER_QUERY_KEY);
    if (!token) return;
    checkInHandledRef.current = true;
    const found = clients.find((item) => item.token === token || item.token.startsWith(token));
    history.replaceState({}, "", `${location.pathname}${location.hash}`);
    // Legacy URL check-in intentionally opens the scanner result from the URL state.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setScannedClient(found ?? null);
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setScanStep(found ? "found" : "missing");
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setScannerOpen(true);
  }, [clients, centralLoaded]);

  useEffect(() => {
    if (!scannerOpen || scanStep !== "camera") return;
    let cancelled = false;
    const start = async () => {
      try {
        const { Html5Qrcode, Html5QrcodeSupportedFormats } = await import("html5-qrcode");
        if (cancelled || !document.getElementById("qr-reader")) return;
        const instance = new Html5Qrcode("qr-reader", {
          formatsToSupport: [Html5QrcodeSupportedFormats.QR_CODE],
          useBarCodeDetectorIfSupported: true,
        });
        scannerRef.current = instance;
        await instance.start(
          { facingMode: "environment" },
          {
            fps: 15,
            aspectRatio: 1,
            qrbox: (viewfinderWidth, viewfinderHeight) => {
              const size = Math.floor(Math.min(viewfinderWidth, viewfinderHeight) * 0.78);
              return { width: size, height: size };
            },
          },
          async (decoded) => {
            if (scanHandledRef.current) return;
            const token = tokenFromQr(decoded);
            const found = clients.find((item) => item.token === token || item.token.startsWith(token.replace(/^ID\s*/i, "")));
            if (!found) { setScanError("El QR no pertenece a un cliente registrado en Monster Gym."); return; }
            scanHandledRef.current = true;
            try { await instance.stop(); await instance.clear(); } catch { /* already stopped */ }
            registerVisitForClient(found);
          },
          () => undefined,
        );
      } catch {
        if (!cancelled) setScanError("No se pudo iniciar la cámara. Puedes ingresar el código manualmente.");
      }
    };
    const timer = window.setTimeout(start, 100);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
      const active = scannerRef.current;
      scannerRef.current = null;
      if (active) {
        void (async () => {
          try { await active.stop(); } catch { /* already stopped */ }
          try { await active.clear(); } catch { /* already cleared */ }
        })();
      }
    };
  }, [scannerOpen, scanStep, clients, registerVisitForClient]);

  const go = (next: View) => {
    location.hash = next;
    setView(next);
    setSidebarOpen(false);
  };

  const openNewClient = () => {
    setEditingClient(null);
    setClientForm({ name: "", phone: "", plan: plans[0].name, expiresAt: planExpiryInput(plans[0].name) });
    setPhotoUrl("");
    setFormError("");
    setClientOpen(true);
  };

  const openEditClient = (client: ClientRecord) => {
    setEditingClient(client);
    setClientForm({ name: client.name, phone: client.phone, plan: client.plan, expiresAt: client.expiresAt.slice(0, 10) });
    setPhotoUrl(client.photo);
    setFormError("");
    setClientOpen(true);
  };

  const handlePhoto = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    if (file.size > 5 * 1024 * 1024) { setFormError("La fotografía no puede superar 5 MB."); return; }
    const reader = new FileReader();
    reader.onload = () => {
      const image = new Image();
      image.onload = () => {
        const size = 420;
        const canvas = document.createElement("canvas");
        canvas.width = size; canvas.height = size;
        const context = canvas.getContext("2d");
        if (!context) return;
        const scale = Math.max(size / image.width, size / image.height);
        context.drawImage(image, (size - image.width * scale) / 2, (size - image.height * scale) / 2, image.width * scale, image.height * scale);
        setPhotoUrl(canvas.toDataURL("image/jpeg", 0.82));
        setFormError("");
      };
      image.src = String(reader.result);
    };
    reader.readAsDataURL(file);
  };

  const showCard = async (record: ClientRecord) => {
    const qr = await QRCode.toDataURL(memberQrValue(record.token), { errorCorrectionLevel: "M", width: 1024, margin: 4, color: { dark: "#17141f", light: "#ffffff" } });
    setCardClient(record);
    setQrDataUrl(qr);
    setDownloadStatus("idle");
    setCardOpen(true);
  };

  const saveClient = async (event: React.FormEvent) => {
    event.preventDefault();
    const name = clientForm.name.trim();
    const phone = clientForm.phone.trim();
    if (!name || !phone || !clientForm.expiresAt) { setFormError("Completa nombre, WhatsApp y vencimiento."); return; }
    setClientSaving(true);
    setFormError("");
    try {
      const body = JSON.stringify({ name, phone, plan: clientForm.plan, photo: photoUrl, expiresAt: expiryIsoFromInput(clientForm.expiresAt) });
      if (editingClient) {
        const result = await apiJson<{ client: ClientRecord }>(`/api/clients/${encodeURIComponent(editingClient.id)}`, { method: "PUT", body });
        setClients((current) => current.map((item) => item.id === result.client.id ? result.client : item));
        setCardClient((current) => current?.id === result.client.id ? result.client : current);
        setClientOpen(false);
      } else {
        const result = await apiJson<{ client: ClientRecord; activity: ActivityRecord }>("/api/clients", { method: "POST", body });
        setClients((current) => [result.client, ...current]);
        setActivities((current) => [result.activity, ...current]);
        setClientOpen(false);
        await showCard(result.client);
      }
      setCentralError("");
    } catch (error) {
      setFormError(error instanceof Error ? error.message : "No se pudo guardar el cliente.");
    } finally {
      setClientSaving(false);
    }
  };

  const deleteClientRecord = async () => {
    if (!deletingClient) return;
    const target = deletingClient;
    try {
      await apiJson<{ ok: boolean }>(`/api/clients/${encodeURIComponent(target.id)}`, { method: "DELETE" });
      setClients((current) => current.filter((item) => item.id !== target.id));
      setActivities((current) => current.filter((item) => item.clientId !== target.id));
      if (cardClient?.id === target.id) setCardOpen(false);
      setDeletingClient(null);
      setCentralError("");
    } catch (error) {
      setCentralError(error instanceof Error ? error.message : "No se pudo eliminar el cliente.");
    }
  };

  const openScanner = () => {
    scanHandledRef.current = false;
    visitSubmittingRef.current = false;
    setScanStep("camera"); setScannedClient(null); setScanError(""); setManualCode(""); setScannerOpen(true);
  };

  const closeScanner = () => {
    scanHandledRef.current = false;
    visitSubmittingRef.current = false;
    setScannerOpen(false); setScannedClient(null); setScanError("");
  };

  const findManualClient = (event: React.FormEvent) => {
    event.preventDefault();
    const code = tokenFromQr(manualCode);
    if (!code) { setScanError("Ingresa el código corto o el teléfono del cliente."); return; }
    const found = clients.find((item) => item.token === code || item.token.startsWith(code) || item.phone.includes(code));
    if (!found) { setScanError("No encontramos un cliente con ese código o teléfono."); return; }
    visitSubmittingRef.current = false;
    setScannedClient(found); setScanStep("found"); setScanError("");
  };

  const confirmVisit = () => {
    if (!scannedClient) return;
    registerVisitForClient(scannedClient);
  };

  const downloadCard = async () => {
    if (!cardRef.current || !cardClient || !qrDataUrl) return;
    setDownloadStatus("working");
    try {
      await document.fonts.ready;
      const width = cardRef.current.offsetWidth; const height = cardRef.current.offsetHeight;
      const image = await toPng(cardRef.current, { width, height, pixelRatio: 3, cacheBust: true, style: { width: `${width}px`, height: `${height}px`, margin: "0", transform: "none" } });
      const link = document.createElement("a");
      const safeName = cardClient.name.toLowerCase().replace(/[^a-z0-9áéíóúñ]+/gi, "-").replace(/^-|-$/g, "");
      link.download = `tarjeta-monster-${safeName}.png`; link.href = image; link.click(); setDownloadStatus("done");
    } catch { setDownloadStatus("error"); }
  };

  const todayVisits = activities.filter((item) => (item.type === "visita" || item.type === "premio") && isToday(item.createdAt)).length;
  const activeClients = clients.filter((item) => new Date(item.expiresAt) >= new Date()).length;
  const totalStamps = clients.reduce((sum, item) => sum + item.stamps, 0);
  const nearReward = clients.filter((item) => item.stamps >= 7 && item.stamps < 10).length;
  const filteredClients = useMemo(() => clients.filter((item) => `${item.name} ${item.phone} ${item.plan}`.toLowerCase().includes(search.toLowerCase())), [clients, search]);

  const dashboardView = <>
    <section className="scanner-card">
      <div className="scanner-copy"><span className="live-pill"><i /> ESCÁNER LISTO</span><h2>Registra una visita<br />en segundos.</h2><p>Escanea la tarjeta digital de un cliente registrado para sumar asistencia y fidelidad.</p><button className="scan-button" onClick={openScanner}><span className="scan-symbol">⌗</span> Abrir escáner QR <b>→</b></button><small>{clients.length ? `${clients.length} cliente${clients.length === 1 ? "" : "s"} disponible${clients.length === 1 ? "" : "s"}` : "Primero registra un cliente"}</small></div>
      <div className="scanner-visual" aria-hidden="true"><div className="glow-orb"/><div className="qr-frame"><i className="c1"/><i className="c2"/><i className="c3"/><i className="c4"/><div className="qr-grid">▦</div><span className="scan-line"/></div>{clients[0] && <div className="floating-card member-float"><span className="avatar avatar-photo">{initials(clients[0].name)}</span><div><small>ÚLTIMO REGISTRO</small><strong>{clients[0].name}</strong></div><b>✓</b></div>}<div className="floating-card stamp-float"><span>✦</span><div><strong>+1 sello</strong><small>Por cada visita</small></div></div></div>
    </section>
    <section className="metrics-grid">
      <article className="metric-card"><div className="metric-icon purple">↙</div><div className="metric-top"><span>Visitas hoy</span><small>{todayVisits ? "Actualizado" : "Sin actividad"}</small></div><strong>{todayVisits}</strong><p>{todayVisits ? "Ingresos confirmados hoy" : "Aún no se registraron ingresos"}</p><div className="empty-chart"><i/><i/><i/><i/><i/><i/><i/></div></article>
      <article className="metric-card"><div className="metric-icon lime">♙</div><div className="metric-top"><span>Miembros activos</span><small>{clients.length} total</small></div><strong>{activeClients}</strong><p>{activeClients ? "Con membresía vigente" : "Registra tu primer cliente"}</p><div className="progress"><i style={{ width: clients.length ? `${Math.round(activeClients / clients.length * 100)}%` : "0%" }}/></div></article>
      <article className="metric-card"><div className="metric-icon coral">✦</div><div className="metric-top"><span>Sellos entregados</span><small>Acumulado</small></div><strong>{totalStamps}</strong><p>{nearReward} cliente{nearReward === 1 ? "" : "s"} cerca de premio</p><div className="metric-empty">Base central sincronizada</div></article>
    </section>
    <section className="bottom-grid">
      <article className="panel activity-panel"><div className="panel-head"><div><h3>Actividad reciente</h3><p>Movimientos registrados en recepción</p></div><button onClick={() => go("asistencias")}>Ver todo →</button></div>{activities.length ? <div className="activity-list">{activities.slice(0,4).map((item) => <div className="activity" key={item.id}><span className="avatar violet">{initials(item.clientName)}</span><div><strong>{item.clientName}</strong><p>{item.description}</p></div><time>{formatDate(item.createdAt)}</time></div>)}</div> : <div className="activity-empty"><span>⌁</span><div><strong>Tu historial está listo</strong><p>Las visitas, sellos y registros aparecerán aquí.</p></div><button onClick={openNewClient}>Registrar primer cliente</button></div>}</article>
      <article className="panel loyalty-panel"><div className="panel-head"><div><h3>Fidelidad en movimiento</h3><p>Progreso general de tus clientes</p></div></div><div className={`loyalty-ring ${clients.length ? "" : "loyalty-empty"}`} style={clients.length ? { background: `conic-gradient(var(--purple) 0 ${Math.min(100, totalStamps / (clients.length * 10) * 100)}%, #eeecf1 0)` } : undefined}><div><strong>{clients.length ? Math.round(totalStamps / (clients.length * 10) * 100) : 0}%</strong><span>participación</span></div></div><div className="loyalty-stats"><div><span><i className="dot-lime"/>Tarjetas activas</span><strong>{clients.length}</strong></div><div><span><i className="dot-purple"/>Cerca de premio</span><strong>{nearReward}</strong></div></div></article>
    </section>
  </>;

  const clientsView = <section className="view-page"><div className="view-heading"><div><span className="view-kicker">GESTIÓN DE MIEMBROS</span><h1>Clientes</h1><p>{clients.length} cliente{clients.length === 1 ? " registrado" : "s registrados"} en este equipo.</p></div><button className="primary-button page-action" onClick={openNewClient}>＋ Nuevo cliente</button></div><div className="list-toolbar"><div className="search-box">⌕<input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Buscar por nombre, teléfono o plan"/></div><span>{filteredClients.length} resultado{filteredClients.length === 1 ? "" : "s"}</span></div>{filteredClients.length ? <div className="clients-table"><div className="client-row table-head"><span>Cliente</span><span>Plan</span><span>Fidelidad</span><span>Estado</span><span/></div>{filteredClients.map((item) => <div className="client-row" key={item.id}><div className="client-identity">{item.photo ? <img src={item.photo} alt=""/> : <span className="avatar violet">{initials(item.name)}</span>}<div><strong>{item.name}</strong><small>{item.phone}</small></div></div><div><strong>{item.plan.split(" · ")[0]}</strong><small>Vence {formatDate(item.expiresAt)}</small></div><div><strong>{item.stamps}/10 sellos</strong><div className="row-progress"><i style={{width:`${item.stamps * 10}%`}}/></div></div><span className={`status-badge ${new Date(item.expiresAt) >= new Date() ? "active" : "expired"}`}>{new Date(item.expiresAt) >= new Date() ? "Activo" : "Vencido"}</span><div className="row-actions"><button onClick={() => showCard(item)}>Tarjeta</button><button onClick={() => openEditClient(item)}>Editar</button><button className="danger-action" onClick={() => setDeletingClient(item)}>Eliminar</button><button onClick={() => { visitSubmittingRef.current=false; setScannedClient(item); setScanStep("found"); setScannerOpen(true); }}>＋ Visita</button></div></div>)}</div> : <div className="big-empty"><span>♙</span><h2>No hay clientes todavía</h2><p>Registra al primero y aparecerá aquí inmediatamente.</p><button onClick={openNewClient}>Registrar cliente</button></div>}</section>;

  const plansView = <section className="view-page"><div className="view-heading"><div><span className="view-kicker">MEMBRESÍAS</span><h1>Planes</h1><p>Opciones disponibles para asignar a tus clientes.</p></div></div><div className="plan-grid">{plans.map((plan) => <article className="plan-card" key={plan.name}><span className={`plan-symbol ${plan.tone}`}>◇</span><small>{plan.duration} DÍAS</small><h2>{plan.name.split(" · ")[0]}</h2><strong>{plan.price}</strong><p>{clients.filter((item) => item.plan === plan.name).length} miembros asignados</p><button onClick={openNewClient}>Asignar a un cliente →</button></article>)}</div></section>;

  const loyaltyView = <section className="view-page loyalty-page"><div className="view-heading"><div><span className="view-kicker">GALERÍA DE TARJETAS</span><h1>Fidelidad</h1><p>Visualiza el QR y los sellos de cada cliente en su tarjeta digital.</p></div><button className="primary-button page-action" onClick={openNewClient}>＋ Nuevo cliente</button></div>{clients.length ? <><div className="list-toolbar loyalty-toolbar"><div className="search-box">⌕<input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Buscar una tarjeta por cliente, teléfono o plan"/></div><span>{filteredClients.length} tarjeta{filteredClients.length === 1 ? "" : "s"}</span></div>{filteredClients.length ? <div className="loyalty-gallery">{filteredClients.map((item) => <LoyaltyGalleryCard client={item} key={item.id} onOpen={showCard} onVisit={(client) => { visitSubmittingRef.current=false; setScannedClient(client); setScanStep("found"); setScannerOpen(true); }}/>)}</div> : <div className="big-empty"><span>⌕</span><h2>No encontramos esa tarjeta</h2><p>Prueba buscando por otro nombre, teléfono o plan.</p></div>}</> : <div className="big-empty"><span>✦</span><h2>Sin tarjetas activas</h2><p>Las tarjetas aparecerán al registrar clientes.</p><button onClick={openNewClient}>Registrar cliente</button></div>}</section>;

  const attendanceView = <section className="view-page"><div className="view-heading"><div><span className="view-kicker">OPERACIÓN</span><h1>Asistencias</h1><p>Historial central de registros y visitas.</p></div><button className="primary-button page-action" onClick={openScanner}>⌗ Escanear QR</button></div>{activities.length ? <div className="history-list">{activities.map((item) => <article key={item.id}><span className={`history-icon ${item.type}`}>{item.type === "registro" ? "＋" : item.type === "premio" ? "✦" : "✓"}</span><div><strong>{item.clientName}</strong><p>{item.description}</p></div><time>{new Date(item.createdAt).toLocaleString("es-BO")}</time></article>)}</div> : <div className="big-empty"><span>✓</span><h2>Aún no hay movimientos</h2><p>Registra un cliente o escanea una tarjeta.</p></div>}</section>;

  const reportsView = <section className="view-page"><div className="view-heading"><div><span className="view-kicker">RESUMEN LOCAL</span><h1>Reportes</h1><p>Indicadores calculados desde la base central de Monster Gym.</p></div></div><div className="report-grid"><article><span>Clientes registrados</span><strong>{clients.length}</strong><p>{activeClients} membresías vigentes</p></article><article><span>Visitas acumuladas</span><strong>{clients.reduce((sum,item)=>sum+item.visits,0)}</strong><p>{todayVisits} registradas hoy</p></article><article><span>Sellos entregados</span><strong>{totalStamps}</strong><p>{nearReward} cerca de recompensa</p></article></div></section>;

  const content: Record<View, React.ReactNode> = { inicio: dashboardView, clientes: clientsView, planes: plansView, fidelidad: loyaltyView, asistencias: attendanceView, reportes: reportsView };

  return <main className="app-shell">
    <aside className={`sidebar ${sidebarOpen ? "open" : ""}`}><div className="brand"><div className="brand-mark"><span>M</span></div><div><strong>MONSTER</strong><small>GYM OS</small></div></div><nav aria-label="Navegación principal"><p className="nav-label">GESTIÓN</p><button className={`nav-item ${view === "inicio" ? "active" : ""}`} onClick={() => go("inicio")}><Icon>⌂</Icon> Inicio</button><button className={`nav-item ${view === "clientes" ? "active" : ""}`} onClick={() => go("clientes")}><Icon>♙</Icon> Clientes <span className="nav-count">{clients.length}</span></button><button className={`nav-item ${view === "planes" ? "active" : ""}`} onClick={() => go("planes")}><Icon>◇</Icon> Planes</button><button className={`nav-item ${view === "fidelidad" ? "active" : ""}`} onClick={() => go("fidelidad")}><Icon>✦</Icon> Fidelidad</button><p className="nav-label secondary">OPERACIÓN</p><button className={`nav-item ${view === "asistencias" ? "active" : ""}`} onClick={() => go("asistencias")}><Icon>✓</Icon> Asistencias</button><button className={`nav-item ${view === "reportes" ? "active" : ""}`} onClick={() => go("reportes")}><Icon>↗</Icon> Reportes</button></nav><div className="sidebar-footer"><div className="storage-mini"><span className="status-dot"/><div><strong>BASE CENTRAL</strong><small>Sincronizada entre dispositivos</small></div></div><button className="profile-button"><span className="avatar avatar-small">MO</span><span><strong>Milton Ortiz</strong><small>Administrador</small></span></button></div></aside>
    {sidebarOpen && <button className="backdrop" aria-label="Cerrar menú" onClick={() => setSidebarOpen(false)}/>}<section className="main-content"><header className="topbar"><button className="menu-button" aria-label="Abrir menú" onClick={() => setSidebarOpen(true)}>☰</button><div className="gym-status"><span className="status-dot"/> Monster Gym — Sucursal Central</div><div className="top-actions"><button className="icon-button" aria-label="Buscar clientes" onClick={() => go("clientes")}>⌕</button><button className="primary-button" onClick={openNewClient}><span>＋</span> Nuevo cliente</button></div></header><div className="dashboard">{centralError && <div className="central-error"><strong>Sin conexión con la base central.</strong><span>{centralError}</span><button onClick={() => void loadCentralState()}>Reintentar</button></div>}{!centralLoaded && !centralError && <div className="central-loading">Sincronizando datos…</div>}{content[view]}</div></section>

    {clientOpen && <div className="modal-layer" role="dialog" aria-modal="true" aria-label={editingClient ? "Editar cliente" : "Registrar nuevo cliente"}><button className="modal-scrim" aria-label="Cerrar" onClick={() => setClientOpen(false)}/><section className="client-modal"><header><div><span className="modal-kicker">{editingClient ? "EDITAR MIEMBRO" : "NUEVO MIEMBRO"}</span><h2>{editingClient ? "Editar cliente" : "Registra un cliente"}</h2><p>{editingClient ? "Los cambios se sincronizarán en todos los dispositivos." : "Se guardará en la base central y tendrá un QR único."}</p></div><button className="close-button" onClick={() => setClientOpen(false)}>×</button></header><form onSubmit={saveClient}><label className={`photo-input ${photoUrl ? "has-photo" : ""}`}>{photoUrl ? <img src={photoUrl} alt="Vista previa"/> : <span>＋</span>}<strong>{photoUrl ? "Foto cargada" : "Añadir foto"}</strong><small>{photoUrl ? "Pulsa para cambiarla" : "JPG o PNG · máx. 5 MB"}</small><input type="file" accept="image/png,image/jpeg,image/webp" onChange={handlePhoto}/></label><div className="field-grid"><label><span>Nombre completo</span><input required value={clientForm.name} onChange={(event) => setClientForm({...clientForm,name:event.target.value})} placeholder="Ej. Carlos Mendoza"/></label><label><span>WhatsApp</span><input required value={clientForm.phone} onChange={(event) => setClientForm({...clientForm,phone:event.target.value})} placeholder="+591 700 000 00"/></label></div><div className="field-grid"><label className="full-field compact-field"><span>Plan de membresía</span><select value={clientForm.plan} onChange={(event) => { const plan = event.target.value; setClientForm({...clientForm,plan,expiresAt: editingClient ? clientForm.expiresAt : planExpiryInput(plan)}); }}>{plans.map((plan)=><option key={plan.name}>{plan.name}</option>)}</select></label><label className="full-field compact-field"><span>Vigente hasta</span><input type="date" required value={clientForm.expiresAt} onChange={(event) => setClientForm({...clientForm,expiresAt:event.target.value})}/></label></div>{formError && <p className="form-error">{formError}</p>}<div className="form-note"><span>✦</span><p><strong>{editingClient ? "Identidad y QR preservados" : "Tarjeta de fidelidad incluida"}</strong><br/>{editingClient ? "Editar el cliente no borra sus visitas, sellos ni código QR." : "Generaremos un identificador y QR irrepetibles."}</p></div><div className="form-actions"><button type="button" onClick={() => setClientOpen(false)}>Cancelar</button><button type="submit" disabled={clientSaving}>{clientSaving ? "Guardando…" : editingClient ? "Guardar cambios" : "Crear cliente y tarjeta"} <span>→</span></button></div></form></section></div>}

    {deletingClient && <div className="modal-layer" role="dialog" aria-modal="true" aria-label="Eliminar cliente"><button className="modal-scrim" aria-label="Cancelar" onClick={() => setDeletingClient(null)}/><section className="delete-modal"><div className="delete-symbol">!</div><span className="modal-kicker">ELIMINAR CLIENTE</span><h2>¿Eliminar a {deletingClient.name}?</h2><p>Se eliminarán también sus asistencias y actividad. Esta acción no se puede deshacer.</p><div><button onClick={() => setDeletingClient(null)}>Cancelar</button><button className="delete-confirm" onClick={deleteClientRecord}>Eliminar definitivamente</button></div></section></div>}

    {cardOpen && cardClient && <div className="modal-layer" role="dialog" aria-modal="true" aria-label="Tarjeta digital"><button className="modal-scrim" aria-label="Cerrar" onClick={() => setCardOpen(false)}/><section className="card-modal"><header><div><span className="modal-kicker">TARJETA DIGITAL</span><h2>{cardClient.name}</h2></div><button className="close-button" onClick={() => setCardOpen(false)}>×</button></header><div className="digital-card" ref={cardRef}><div className="card-top"><div className="mini-brand"><b>M</b><span>MONSTER<br/><small>GYM OS</small></span></div><span className="card-tier">MEMBER</span></div><div className="card-person">{cardClient.photo ? <img className="card-photo card-photo-image" src={cardClient.photo} alt=""/> : <span className="card-photo">{initials(cardClient.name)}</span>}<div><small>MIEMBRO</small><strong>{cardClient.name}</strong><p>{cardClient.plan}</p><code>ID {cardClient.token.slice(0,8).toUpperCase()}</code></div></div><div className="card-bottom"><div className="card-loyalty"><small>FIDELIDAD · {cardClient.stamps}/10 SELLOS</small><div className="mini-stamps">{Array.from({length:10},(_,index)=>{ const visit = clientVisitHistory(cardClient)[index]; return <i key={index} className={index < cardClient.stamps ? "on" : ""} title={visit ? formatStampDateTime(visit) : "Pendiente"}>{index < cardClient.stamps ? "M" : ""}</i>; })}</div>{cardClient.lastVisit && <span className="card-last-stamp">Último sello · {formatStampDateTime(cardClient.lastVisit)}</span>}</div><div className="qr-code">{qrDataUrl && <img src={qrDataUrl} alt={`QR único de ${cardClient.name}`}/>}</div></div></div><p className="card-help">Escanea este QR desde el sistema para registrar una visita automáticamente. ID <strong>{cardClient.token.slice(0,8).toUpperCase()}</strong>.</p><div className="share-actions"><button className="download-button" onClick={downloadCard} disabled={downloadStatus === "working"}>{downloadStatus === "working" ? "Generando PNG…" : downloadStatus === "done" ? "✓ PNG descargado" : downloadStatus === "error" ? "Reintentar" : "↓ Descargar PNG"}</button><a className="whatsapp-button" target="_blank" rel="noreferrer" href={`https://wa.me/${cardClient.phone.replace(/\D/g,"")}?text=${encodeURIComponent(`Hola ${cardClient.name}, tu tarjeta digital de Monster Gym está lista. Te enviaré la imagen a continuación.`)}`}>Abrir WhatsApp ↗</a></div></section></div>}

    {scannerOpen && <div className="modal-layer" role="dialog" aria-modal="true" aria-label="Escáner QR"><button className="modal-scrim" aria-label="Cerrar" onClick={closeScanner}/><section className="scanner-modal"><header><div><span className="modal-kicker">RECEPCIÓN</span><h2>{scanStep === "success" ? "¡Visita registrada!" : scanStep === "found" ? "Cliente identificado" : scanStep === "missing" ? "Tarjeta no encontrada" : "Escanear tarjeta"}</h2></div><button className="close-button" onClick={closeScanner}>×</button></header>{scanStep === "camera" && <div className="camera-content"><div className="camera-view real-camera"><div id="qr-reader"/><div className="camera-tip">Centra el QR dentro del marco</div></div>{scanError && <p className="scan-error">{scanError}</p>}<form className="manual-scan" onSubmit={findManualClient}><input value={manualCode} onChange={(event) => setManualCode(event.target.value)} placeholder="Código corto o teléfono"/><button>Buscar</button></form><p className="privacy-note">La cámara solo funciona mientras esta ventana está abierta.</p></div>}{scanStep === "missing" && <div className="missing-state"><div className="missing-symbol">!</div><h3>Cliente no encontrado en la base central</h3><p>Verifica que el QR corresponda a un cliente activo registrado en Monster Gym.</p><button className="confirm-visit" onClick={closeScanner}>Entendido</button></div>}{scanStep === "found" && scannedClient && <div className="found-client"><div className="member-hero">{scannedClient.photo ? <img className="avatar found-avatar" src={scannedClient.photo} alt=""/> : <span className="avatar found-avatar">{initials(scannedClient.name)}</span>}<span className="verified">✓</span></div><span className="found-label">CLIENTE IDENTIFICADO</span><h3>{scannedClient.name}</h3><p>{scannedClient.plan} · Vigente hasta {formatDate(scannedClient.expiresAt)}</p><div className="stamp-progress"><div className="stamp-copy"><span>Tarjeta de fidelidad</span><strong>{scannedClient.stamps} de 10 sellos</strong></div><div className="stamps">{Array.from({length:10},(_,index)=>{ const visit = clientVisitHistory(scannedClient)[index]; return <i className={index < scannedClient.stamps ? "filled" : ""} key={index} title={visit ? formatStampDateTime(visit) : "Pendiente"}>{index < scannedClient.stamps ? "M" : ""}</i>; })}</div>{scannedClient.lastVisit && <small className="scan-last-stamp">Último sello · {formatStampDateTime(scannedClient.lastVisit)}</small>}</div><button className="confirm-visit" onClick={confirmVisit}>Confirmar visita <span>+1 sello</span></button><button className="text-action" onClick={() => {scanHandledRef.current=false;visitSubmittingRef.current=false;setScanStep("camera");setScannedClient(null);}}>Escanear otro código</button></div>}{scanStep === "success" && scannedClient && <div className="success-state"><div className="success-burst">✓</div><h3>{scannedClient.name} suma una visita</h3><p>Ahora tiene <strong>{scannedClient.stamps} de 10 sellos.</strong><br/><span className="success-time">Sello registrado: {formatStampDateTime(scannedClient.lastVisit ?? new Date().toISOString())}</span><br/>{scannedClient.stamps === 10 ? "¡Recompensa desbloqueada!" : `Le faltan ${10-scannedClient.stamps} para su recompensa.`}</p><div className="reward-chip"><span>✦</span><div><small>PRÓXIMA RECOMPENSA</small><strong>1 batido proteico gratis</strong></div></div><button className="confirm-visit" onClick={closeScanner}>Listo, continuar</button></div>}</section></div>}
  </main>;
}
