"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toPng } from "html-to-image";
import QRCode from "qrcode";

type View = "inicio" | "clientes" | "planes" | "fidelidad" | "asistencias" | "cobros" | "reportes";
type ScanStep = "camera" | "found" | "success" | "missing" | "blocked";
type PaymentMethod = "cash" | "qr";
type AccessStatus = "active" | "expired" | "debt_suspended" | "manual_suspended" | "sessions_exhausted";
type PaymentStatus = "paid" | "partial" | "due";

type PlanRecord = {
  id: string;
  name: string;
  price: number;
  billingType: "unlimited" | "sessions";
  sessionLimit: number | null;
  durationMonths: number;
  active: boolean;
  sortOrder: number;
};

type ClientRecord = {
  id: string;
  token: string;
  name: string;
  phone: string;
  plan: string;
  planId: string;
  photo: string;
  createdAt: string;
  expiresAt: string;
  visits: number;
  stamps: number;
  lastVisit?: string;
  visitHistory?: string[];
  membershipId: string;
  membershipStartedAt: string;
  membershipPrice: number;
  paidAmount: number;
  balance: number;
  paymentStatus: PaymentStatus;
  graceUntil: string;
  sessionLimit: number | null;
  sessionsUsed: number;
  manualSuspended: boolean;
  accessStatus: AccessStatus;
  accessReason: string;
};

type ActivityRecord = {
  id: string;
  clientId: string;
  clientName: string;
  type: "registro" | "visita" | "premio";
  description: string;
  createdAt: string;
};

type PaymentRecord = {
  id: string;
  clientId: string;
  membershipId: string;
  amount: number;
  method: PaymentMethod;
  voucherUrl: string;
  note: string;
  createdAt: string;
};

type AppSettings = { paymentQrUrl: string };

const MEMBER_QUERY_KEY = "checkin";

const initials = (name: string) => name.split(" ").filter(Boolean).map((word) => word[0]).join("").slice(0, 2).toUpperCase() || "MG";
const money = (value: number) => new Intl.NumberFormat("es-BO", { style: "currency", currency: "BOB", minimumFractionDigits: 0, maximumFractionDigits: 2 }).format(value).replace("BOB", "Bs");
const formatDate = (value: string) => value ? new Intl.DateTimeFormat("es-BO", { day: "2-digit", month: "short", year: "numeric" }).format(new Date(value)) : "—";
const formatDateTime = (value: string) => value ? new Intl.DateTimeFormat("es-BO", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" }).format(new Date(value)) : "—";
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
const todayInput = () => new Date().toISOString().slice(0, 10);

class ApiError extends Error {
  status: number;
  payload: Record<string, unknown>;
  constructor(message: string, status: number, payload: Record<string, unknown>) {
    super(message);
    this.status = status;
    this.payload = payload;
  }
}

async function apiJson<T>(url: string, options?: RequestInit): Promise<T> {
  const response = await fetch(url, {
    ...options,
    headers: { "Content-Type": "application/json", ...(options?.headers ?? {}) },
    cache: "no-store",
    credentials: "same-origin",
  });
  const payload = await response.json().catch(() => ({})) as Record<string, unknown> & T;
  if (!response.ok) throw new ApiError(String(payload.error || `Error ${response.status}`), response.status, payload);
  return payload;
}

async function imageFileToDataUrl(file: File, maxSide = 1600, quality = 0.86, square = false): Promise<string> {
  if (file.size > 8 * 1024 * 1024) throw new Error("La imagen no puede superar 8 MB.");
  const source = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error("No se pudo leer la imagen."));
    reader.readAsDataURL(file);
  });
  const image = await new Promise<HTMLImageElement>((resolve, reject) => {
    const value = new Image();
    value.onload = () => resolve(value);
    value.onerror = () => reject(new Error("La imagen no es válida."));
    value.src = source;
  });
  const canvas = document.createElement("canvas");
  const context = canvas.getContext("2d");
  if (!context) throw new Error("No se pudo procesar la imagen.");

  if (square) {
    const size = Math.min(maxSide, 640);
    canvas.width = size;
    canvas.height = size;
    const scale = Math.max(size / image.width, size / image.height);
    const width = image.width * scale;
    const height = image.height * scale;
    context.drawImage(image, (size - width) / 2, (size - height) / 2, width, height);
  } else {
    const scale = Math.min(1, maxSide / Math.max(image.width, image.height));
    canvas.width = Math.round(image.width * scale);
    canvas.height = Math.round(image.height * scale);
    context.drawImage(image, 0, 0, canvas.width, canvas.height);
  }
  return canvas.toDataURL("image/jpeg", quality);
}

const accessLabel = (client: ClientRecord) => {
  switch (client.accessStatus) {
    case "active": return "ACTIVO";
    case "expired": return "VENCIDO";
    case "debt_suspended": return "SUSPENDIDO POR DEUDA";
    case "manual_suspended": return "SUSPENDIDO";
    case "sessions_exhausted": return "SESIONES AGOTADAS";
  }
};

const paymentLabel = (client: ClientRecord) => client.paymentStatus === "paid" ? "PAGADO" : client.paymentStatus === "partial" ? "PAGO PARCIAL" : "DEBE";

function ClientAvatar({ client, className = "" }: { client: ClientRecord; className?: string }) {
  return client.photo
    ? <img className={className} src={client.photo} alt={`Foto de ${client.name}`}/>
    : <span className={`avatar violet ${className}`}>{initials(client.name)}</span>;
}

function LoyaltyGalleryCard({ client, onOpen, onVisit }: { client: ClientRecord; onOpen: (client: ClientRecord) => void; onVisit: (client: ClientRecord) => void }) {
  const [qr, setQr] = useState("");
  useEffect(() => {
    let active = true;
    QRCode.toDataURL(memberQrValue(client.token), { errorCorrectionLevel: "M", width: 640, margin: 4, color: { dark: "#17141f", light: "#ffffff" } })
      .then((value) => { if (active) setQr(value); });
    return () => { active = false; };
  }, [client.token]);

  return <article className="loyalty-gallery-card">
    <div className="loyalty-card-visual">
      <div className="gallery-card-top">
        <div className="mini-brand"><b>M</b><span>MONSTER<br/><small>GYM OS</small></span></div>
        <span className={`gallery-status ${client.accessStatus === "active" ? "active" : "expired"}`}>{accessLabel(client)}</span>
      </div>
      <div className="gallery-card-member">
        <ClientAvatar client={client}/>
        <div><small>MIEMBRO</small><strong>{client.name}</strong><p>{client.plan}</p><code>ID {client.token.slice(0,8).toUpperCase()}</code></div>
      </div>
      <div className="gallery-card-bottom">
        <div className="gallery-loyalty">
          <div><small>FIDELIDAD</small><strong>{client.stamps}/10 sellos</strong></div>
          <div className="gallery-stamps">{Array.from({ length: 10 }, (_, index) => {
            const visit = clientVisitHistory(client)[index];
            return <i className={index < client.stamps ? "filled" : ""} key={index} title={visit ? `Sello ${index + 1}: ${formatDateTime(visit)}` : `Sello ${index + 1} pendiente`}>{index < client.stamps ? "M" : ""}</i>;
          })}</div>
        </div>
        <div className="gallery-qr">{qr ? <img src={qr} alt={`QR único de ${client.name}`}/> : <span>QR</span>}</div>
      </div>
    </div>
    <div className="gallery-card-info">
      <div><strong>{client.visits} visita{client.visits === 1 ? "" : "s"}</strong><span>{client.sessionLimit ? `${client.sessionsUsed}/${client.sessionLimit} sesiones` : `${client.stamps}/10 sellos`}</span></div>
      <div className="gallery-card-actions"><button onClick={() => onOpen(client)}>Ver tarjeta</button><button onClick={() => onVisit(client)} disabled={client.accessStatus !== "active"}>＋ Visita</button></div>
    </div>
  </article>;
}

export default function Home() {
  const [view, setView] = useState<View>("inicio");
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [hydrated, setHydrated] = useState(false);
  const [authState, setAuthState] = useState<"checking" | "login" | "authenticated">("checking");
  const [loginPassword, setLoginPassword] = useState("");
  const [loginError, setLoginError] = useState("");
  const [loginBusy, setLoginBusy] = useState(false);

  const [centralLoaded, setCentralLoaded] = useState(false);
  const [centralError, setCentralError] = useState("");
  const [clients, setClients] = useState<ClientRecord[]>([]);
  const [activities, setActivities] = useState<ActivityRecord[]>([]);
  const [plans, setPlans] = useState<PlanRecord[]>([]);
  const [settings, setSettings] = useState<AppSettings>({ paymentQrUrl: "" });
  const [search, setSearch] = useState("");

  const [clientOpen, setClientOpen] = useState(false);
  const [editingClient, setEditingClient] = useState<ClientRecord | null>(null);
  const [deletingClient, setDeletingClient] = useState<ClientRecord | null>(null);
  const [clientForm, setClientForm] = useState({ name: "", phone: "", planId: "", startsAt: todayInput(), manualSuspended: false });
  const [photoUrl, setPhotoUrl] = useState("");
  const [formError, setFormError] = useState("");
  const [clientSaving, setClientSaving] = useState(false);

  const [renewingClient, setRenewingClient] = useState<ClientRecord | null>(null);
  const [renewForm, setRenewForm] = useState({ planId: "", startsAt: todayInput() });
  const [renewBusy, setRenewBusy] = useState(false);

  const [paymentClient, setPaymentClient] = useState<ClientRecord | null>(null);
  const [paymentForm, setPaymentForm] = useState({ amount: "", method: "qr" as PaymentMethod, note: "" });
  const [voucherImage, setVoucherImage] = useState("");
  const [payments, setPayments] = useState<PaymentRecord[]>([]);
  const [paymentBusy, setPaymentBusy] = useState(false);
  const [paymentError, setPaymentError] = useState("");

  const [planOpen, setPlanOpen] = useState(false);
  const [editingPlan, setEditingPlan] = useState<PlanRecord | null>(null);
  const [planForm, setPlanForm] = useState({ name: "", price: "", billingType: "unlimited" as "unlimited" | "sessions", sessionLimit: "12", durationMonths: "1", active: true });
  const [planError, setPlanError] = useState("");
  const [planBusy, setPlanBusy] = useState(false);

  const [qrSaving, setQrSaving] = useState(false);
  const [qrError, setQrError] = useState("");

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

  const activePlans = useMemo(() => plans.filter((plan) => plan.active), [plans]);

  const replaceClient = useCallback((client: ClientRecord) => {
    setClients((current) => current.map((item) => item.id === client.id ? client : item));
    setCardClient((current) => current?.id === client.id ? client : current);
    setPaymentClient((current) => current?.id === client.id ? client : current);
    setScannedClient((current) => current?.id === client.id ? client : current);
  }, []);

  const loadCentralState = useCallback(async (silent = false) => {
    try {
      const data = await apiJson<{ clients: ClientRecord[]; activities: ActivityRecord[]; plans: PlanRecord[]; settings: AppSettings }>("/api/state");
      setClients(data.clients ?? []);
      setActivities(data.activities ?? []);
      setPlans(data.plans ?? []);
      setSettings(data.settings ?? { paymentQrUrl: "" });
      setCentralLoaded(true);
      setCentralError("");
    } catch (error) {
      if (error instanceof ApiError && error.status === 401) {
        setAuthState("login");
        return;
      }
      if (!silent) setCentralError(error instanceof Error ? error.message : "No se pudo conectar con la base central.");
    }
  }, []);

  const registerVisitForClient = useCallback(async (client: ClientRecord) => {
    if (visitSubmittingRef.current) return;
    visitSubmittingRef.current = true;
    try {
      const result = await apiJson<{ client: ClientRecord; activity: ActivityRecord }>(`/api/clients/${encodeURIComponent(client.id)}/visit`, { method: "POST" });
      replaceClient(result.client);
      setActivities((current) => [result.activity, ...current]);
      setScannedClient(result.client);
      setScanStep("success");
      setScanError("");
    } catch (error) {
      visitSubmittingRef.current = false;
      if (error instanceof ApiError && error.status === 409) {
        const blocked = error.payload.client as ClientRecord | undefined;
        if (blocked) { replaceClient(blocked); setScannedClient(blocked); }
        setScanError(error.message);
        setScanStep("blocked");
        return;
      }
      setScanError(error instanceof Error ? error.message : "No se pudo registrar la visita.");
    }
  }, [replaceClient]);

  useEffect(() => {
    const updateView = () => {
      const next = location.hash.replace("#", "") as View;
      setView(["inicio", "clientes", "planes", "fidelidad", "asistencias", "cobros", "reportes"].includes(next) ? next : "inicio");
    };
    updateView();
    addEventListener("hashchange", updateView);
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setHydrated(true);
    return () => removeEventListener("hashchange", updateView);
  }, []);

  useEffect(() => {
    if (!hydrated) return;
    void apiJson<{ authenticated: boolean }>("/api/auth/me")
      .then((result) => setAuthState(result.authenticated ? "authenticated" : "login"))
      .catch(() => setAuthState("login"));
  }, [hydrated]);

  useEffect(() => {
    if (authState !== "authenticated") return;
    // Initial synchronization intentionally hydrates central server state after authentication.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void loadCentralState();
    const refresh = () => { if (document.visibilityState === "visible") void loadCentralState(true); };
    const timer = window.setInterval(() => { if (document.visibilityState === "visible") void loadCentralState(true); }, 5000);
    document.addEventListener("visibilitychange", refresh);
    return () => { window.clearInterval(timer); document.removeEventListener("visibilitychange", refresh); };
  }, [authState, loadCentralState]);

  useEffect(() => {
    if (!centralLoaded || checkInHandledRef.current) return;
    const token = new URLSearchParams(location.search).get(MEMBER_QUERY_KEY);
    if (!token) return;
    checkInHandledRef.current = true;
    const found = clients.find((item) => item.token === token || item.token.startsWith(token));
    history.replaceState({}, "", `${location.pathname}${location.hash}`);
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setScannedClient(found ?? null);
    setScanStep(found ? (found.accessStatus === "active" ? "found" : "blocked") : "missing");
    setScannerOpen(true);
  }, [clients, centralLoaded]);

  useEffect(() => {
    if (!scannerOpen || scanStep !== "camera") return;
    let cancelled = false;
    const start = async () => {
      try {
        const { Html5Qrcode, Html5QrcodeSupportedFormats } = await import("html5-qrcode");
        if (cancelled || !document.getElementById("qr-reader")) return;
        const instance = new Html5Qrcode("qr-reader", { formatsToSupport: [Html5QrcodeSupportedFormats.QR_CODE], useBarCodeDetectorIfSupported: true });
        scannerRef.current = instance;
        await instance.start(
          { facingMode: "environment" },
          {
            fps: 15, aspectRatio: 1,
            qrbox: (width, height) => { const size = Math.floor(Math.min(width, height) * 0.78); return { width: size, height: size }; },
          },
          async (decoded) => {
            if (scanHandledRef.current) return;
            const token = tokenFromQr(decoded);
            const found = clients.find((item) => item.token === token || item.token.startsWith(token.replace(/^ID\s*/i, "")));
            if (!found) { setScanError("El QR no pertenece a un cliente registrado en Monster Gym."); return; }
            scanHandledRef.current = true;
            try { await instance.stop(); } catch { /* scanner may already be stopped */ }
            try { await instance.clear(); } catch { /* scanner may already be cleared */ }
            setScannedClient(found);
            setScanStep(found.accessStatus === "active" ? "found" : "blocked");
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
      if (active) void (async () => { try { await active.stop(); } catch { /* scanner may already be stopped */ } try { await active.clear(); } catch { /* scanner may already be cleared */ } })();
    };
  }, [scannerOpen, scanStep, clients]);

  const login = async (event: React.FormEvent) => {
    event.preventDefault();
    setLoginBusy(true); setLoginError("");
    try {
      await apiJson("/api/auth/login", { method: "POST", body: JSON.stringify({ password: loginPassword }) });
      setAuthState("authenticated"); setLoginPassword(""); setCentralLoaded(false);
    } catch (error) {
      setLoginError(error instanceof Error ? error.message : "No se pudo iniciar sesión.");
    } finally { setLoginBusy(false); }
  };

  const logout = async () => {
    try { await apiJson("/api/auth/logout", { method: "POST" }); } catch { /* local logout still continues */ }
    setAuthState("login"); setCentralLoaded(false); setClients([]); setActivities([]);
  };

  const go = (next: View) => {
    location.hash = next;
    setView(next);
    setSidebarOpen(false);
  };

  const openNewClient = () => {
    const first = activePlans[0];
    setEditingClient(null);
    setClientForm({ name: "", phone: "", planId: first?.id ?? "", startsAt: todayInput(), manualSuspended: false });
    setPhotoUrl(""); setFormError(""); setClientOpen(true);
  };

  const openEditClient = (client: ClientRecord) => {
    setEditingClient(client);
    setClientForm({ name: client.name, phone: client.phone, planId: client.planId, startsAt: client.membershipStartedAt.slice(0,10), manualSuspended: client.manualSuspended });
    setPhotoUrl(client.photo); setFormError(""); setClientOpen(true);
  };

  const handlePhoto = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    try { setPhotoUrl(await imageFileToDataUrl(file, 640, 0.84, true)); setFormError(""); }
    catch (error) { setFormError(error instanceof Error ? error.message : "No se pudo procesar la foto."); }
  };

  const saveClient = async (event: React.FormEvent) => {
    event.preventDefault();
    const name = clientForm.name.trim();
    const phone = clientForm.phone.trim();
    if (!name || !phone || (!editingClient && !clientForm.planId)) { setFormError("Completa nombre, WhatsApp y plan."); return; }
    setClientSaving(true); setFormError("");
    try {
      if (editingClient) {
        const result = await apiJson<{ client: ClientRecord }>(`/api/clients/${encodeURIComponent(editingClient.id)}`, {
          method: "PUT",
          body: JSON.stringify({ name, phone, photo: photoUrl, manualSuspended: clientForm.manualSuspended }),
        });
        replaceClient(result.client);
      } else {
        const result = await apiJson<{ client: ClientRecord; activity: ActivityRecord }>("/api/clients", {
          method: "POST",
          body: JSON.stringify({ name, phone, planId: clientForm.planId, startsAt: `${clientForm.startsAt}T12:00:00Z`, photo: photoUrl }),
        });
        setClients((current) => [result.client, ...current]);
        setActivities((current) => [result.activity, ...current]);
        await showCard(result.client);
      }
      setClientOpen(false);
    } catch (error) { setFormError(error instanceof Error ? error.message : "No se pudo guardar el cliente."); }
    finally { setClientSaving(false); }
  };

  const deleteClientRecord = async () => {
    if (!deletingClient) return;
    const target = deletingClient;
    try {
      await apiJson(`/api/clients/${encodeURIComponent(target.id)}`, { method: "DELETE" });
      setClients((current) => current.filter((item) => item.id !== target.id));
      setActivities((current) => current.filter((item) => item.clientId !== target.id));
      setDeletingClient(null);
    } catch (error) { setCentralError(error instanceof Error ? error.message : "No se pudo eliminar el cliente."); }
  };

  const openRenew = (client: ClientRecord) => {
    setRenewingClient(client);
    setRenewForm({ planId: client.planId || activePlans[0]?.id || "", startsAt: todayInput() });
  };

  const renewClient = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!renewingClient) return;
    setRenewBusy(true);
    try {
      const result = await apiJson<{ client: ClientRecord }>(`/api/clients/${encodeURIComponent(renewingClient.id)}/renew`, {
        method: "POST",
        body: JSON.stringify({ planId: renewForm.planId, startsAt: `${renewForm.startsAt}T12:00:00Z` }),
      });
      replaceClient(result.client); setRenewingClient(null);
    } catch (error) { setCentralError(error instanceof Error ? error.message : "No se pudo renovar."); }
    finally { setRenewBusy(false); }
  };

  const openPayment = async (client: ClientRecord) => {
    setPaymentClient(client);
    setPaymentForm({ amount: client.balance > 0 ? String(client.balance) : "", method: "qr", note: "" });
    setVoucherImage(""); setPaymentError(""); setPayments([]);
    try {
      const result = await apiJson<{ payments: PaymentRecord[] }>(`/api/clients/${encodeURIComponent(client.id)}/payments`);
      setPayments(result.payments ?? []);
    } catch (error) { setPaymentError(error instanceof Error ? error.message : "No se pudo cargar el historial."); }
  };

  const handleVoucher = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    try { setVoucherImage(await imageFileToDataUrl(file, 1800, 0.88, false)); setPaymentError(""); }
    catch (error) { setPaymentError(error instanceof Error ? error.message : "No se pudo procesar el voucher."); }
  };

  const registerPaymentRecord = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!paymentClient) return;
    setPaymentBusy(true); setPaymentError("");
    try {
      const result = await apiJson<{ client: ClientRecord; payment: PaymentRecord }>(`/api/clients/${encodeURIComponent(paymentClient.id)}/payments`, {
        method: "POST",
        body: JSON.stringify({ amount: Number(paymentForm.amount), method: paymentForm.method, note: paymentForm.note, voucherImage: paymentForm.method === "qr" ? voucherImage : "" }),
      });
      replaceClient(result.client);
      setPayments((current) => [result.payment, ...current]);
      setPaymentClient(result.client);
      setPaymentForm({ amount: result.client.balance > 0 ? String(result.client.balance) : "", method: "qr", note: "" });
      setVoucherImage("");
    } catch (error) { setPaymentError(error instanceof Error ? error.message : "No se pudo registrar el pago."); }
    finally { setPaymentBusy(false); }
  };

  const openNewPlan = () => {
    setEditingPlan(null);
    setPlanForm({ name: "", price: "", billingType: "unlimited", sessionLimit: "12", durationMonths: "1", active: true });
    setPlanError(""); setPlanOpen(true);
  };

  const openEditPlan = (plan: PlanRecord) => {
    setEditingPlan(plan);
    setPlanForm({ name: plan.name, price: String(plan.price), billingType: plan.billingType, sessionLimit: String(plan.sessionLimit ?? 12), durationMonths: String(plan.durationMonths), active: plan.active });
    setPlanError(""); setPlanOpen(true);
  };

  const savePlan = async (event: React.FormEvent) => {
    event.preventDefault();
    setPlanBusy(true); setPlanError("");
    const payload = { name: planForm.name, price: Number(planForm.price || 0), billingType: planForm.billingType, sessionLimit: Number(planForm.sessionLimit || 12), durationMonths: Number(planForm.durationMonths || 1), active: planForm.active };
    try {
      const result = editingPlan
        ? await apiJson<{ plan: PlanRecord }>(`/api/plans/${encodeURIComponent(editingPlan.id)}`, { method: "PUT", body: JSON.stringify(payload) })
        : await apiJson<{ plan: PlanRecord }>("/api/plans", { method: "POST", body: JSON.stringify(payload) });
      setPlans((current) => editingPlan ? current.map((item) => item.id === result.plan.id ? result.plan : item) : [...current, result.plan]);
      setPlanOpen(false);
    } catch (error) { setPlanError(error instanceof Error ? error.message : "No se pudo guardar el plan."); }
    finally { setPlanBusy(false); }
  };

  const handlePaymentQr = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    setQrSaving(true); setQrError("");
    try {
      const image = await imageFileToDataUrl(file, 1600, 0.92, false);
      const result = await apiJson<AppSettings>("/api/settings/payment-qr", { method: "PUT", body: JSON.stringify({ image }) });
      setSettings(result);
    } catch (error) { setQrError(error instanceof Error ? error.message : "No se pudo guardar el QR."); }
    finally { setQrSaving(false); }
  };

  const showCard = async (record: ClientRecord) => {
    const qr = await QRCode.toDataURL(memberQrValue(record.token), { errorCorrectionLevel: "M", width: 1024, margin: 4, color: { dark: "#17141f", light: "#ffffff" } });
    setCardClient(record); setQrDataUrl(qr); setDownloadStatus("idle"); setCardOpen(true);
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

  const openScanner = () => {
    scanHandledRef.current = false; visitSubmittingRef.current = false;
    setScanStep("camera"); setScannedClient(null); setScanError(""); setManualCode(""); setScannerOpen(true);
  };

  const closeScanner = () => {
    scanHandledRef.current = false; visitSubmittingRef.current = false;
    setScannerOpen(false); setScannedClient(null); setScanError("");
  };

  const findManualClient = (event: React.FormEvent) => {
    event.preventDefault();
    const code = tokenFromQr(manualCode);
    if (!code) { setScanError("Ingresa el código corto o el teléfono del cliente."); return; }
    const found = clients.find((item) => item.token === code || item.token.startsWith(code) || item.phone.includes(code));
    if (!found) { setScanError("No encontramos un cliente con ese código o teléfono."); return; }
    setScannedClient(found); setScanStep(found.accessStatus === "active" ? "found" : "blocked"); setScanError("");
  };

  const confirmVisit = () => { if (scannedClient) void registerVisitForClient(scannedClient); };

  const todayVisits = activities.filter((item) => (item.type === "visita" || item.type === "premio") && isToday(item.createdAt)).length;
  const activeClients = clients.filter((item) => item.accessStatus === "active").length;
  const suspendedClients = clients.filter((item) => item.accessStatus === "debt_suspended" || item.accessStatus === "manual_suspended").length;
  const totalDebt = clients.reduce((sum, item) => sum + item.balance, 0);
  const filteredClients = useMemo(() => clients.filter((item) => `${item.name} ${item.phone} ${item.plan}`.toLowerCase().includes(search.toLowerCase())), [clients, search]);

  if (authState !== "authenticated") {
    return <main className="login-shell">
      <section className="login-card">
        <div className="login-brand"><div className="brand-mark"><span>M</span></div><div><strong>MONSTER</strong><small>GYM OS</small></div></div>
        {authState === "checking" ? <div className="login-loading">Verificando sesión…</div> : <form onSubmit={login}>
          <span className="view-kicker">ACCESO DE RECEPCIÓN</span>
          <h1>Control central del gimnasio</h1>
          <p>Clientes, cobros, vouchers y asistencias están protegidos por una sesión privada.</p>
          <label><span>Contraseña</span><input type="password" value={loginPassword} onChange={(event) => setLoginPassword(event.target.value)} placeholder="Contraseña de administrador"/></label>
          {loginError && <div className="form-error">{loginError}</div>}
          <button className="confirm-visit" disabled={loginBusy}>{loginBusy ? "Ingresando…" : "Ingresar"}</button>
        </form>}
      </section>
    </main>;
  }

  const dashboardView = <>
    <div className="view-heading"><div><span className="view-kicker">RECEPCIÓN</span><h1>Tu gimnasio, al día</h1><p>Control de accesos, miembros y pagos en un solo lugar.</p></div><span className="today-label">{formatDate(new Date().toISOString())}</span></div>
    <section className="scanner-card">
      <div className="scanner-copy"><span className="live-pill"><i/> CONTROL DE ACCESO</span><h2>Registra el próximo ingreso</h2><p>Verifica el plan, el saldo y las sesiones disponibles al escanear.</p><small>{clients.length ? `${clients.length} clientes sincronizados` : "Primero registra un cliente"}</small></div>
      <div className="scanner-launch"><button className="scan-button" onClick={openScanner}><span className="scan-symbol">⌗</span> Abrir escáner QR <b>→</b></button><span>Validación automática de membresía</span></div>
    </section>
    <section className="metrics-grid">
      <article className="metric-card"><div className="metric-icon purple">↙</div><div className="metric-top"><span>Visitas hoy</span><small>{todayVisits ? "Actualizado" : "Sin actividad"}</small></div><strong>{todayVisits}</strong><p>Ingresos confirmados</p></article>
      <article className="metric-card"><div className="metric-icon lime">♙</div><div className="metric-top"><span>Miembros habilitados</span><small>{clients.length} total</small></div><strong>{activeClients}</strong><p>{suspendedClients} suspendidos</p></article>
      <article className="metric-card"><div className="metric-icon coral">$</div><div className="metric-top"><span>Saldo por cobrar</span><small>Actual</small></div><strong>{money(totalDebt)}</strong><p>Deuda acumulada en membresías vigentes</p></article>
    </section>
    <section className="bottom-grid">
      <article className="panel activity-panel"><div className="panel-head"><div><h3>Actividad reciente</h3><p>Movimientos de recepción</p></div><button onClick={() => go("asistencias")}>Ver todo →</button></div>{activities.length ? <div className="activity-list">{activities.slice(0,5).map((item) => <div className="activity" key={item.id}><span className="avatar violet">{initials(item.clientName)}</span><div><strong>{item.clientName}</strong><p>{item.description}</p></div><time>{formatDateTime(item.createdAt)}</time></div>)}</div> : <div className="activity-empty"><span>⌁</span><div><strong>Historial listo</strong><p>Las visitas aparecerán aquí.</p></div></div>}</article>
      <article className="panel debt-panel"><div className="panel-head"><div><h3>Control de pagos</h3><p>Tolerancia máxima de 14 días</p></div><button onClick={() => go("cobros")}>Abrir cobros →</button></div><div className="debt-summary"><strong>{money(totalDebt)}</strong><span>saldo total pendiente</span><div><b>{clients.filter((item)=>item.paymentStatus==="partial").length}</b> parciales · <b>{clients.filter((item)=>item.paymentStatus==="due").length}</b> sin pago</div></div></article>
    </section>
  </>;

  const clientsView = <section className="view-page">
    <div className="view-heading"><div><span className="view-kicker">GESTIÓN DE MIEMBROS</span><h1>Clientes</h1><p>{clients.length} miembros en la base central.</p></div><button className="primary-button page-action" onClick={openNewClient}>＋ Nuevo cliente</button></div>
    <div className="list-toolbar"><div className="search-box">⌕<input value={search} onChange={(event)=>setSearch(event.target.value)} placeholder="Buscar por nombre, teléfono o plan"/></div><span>{filteredClients.length} resultados</span></div>
    {filteredClients.length ? <div className="clients-table">
      <div className="client-row table-head"><span>Cliente</span><span>Membresía / pago</span><span>Actividad</span><span>Estado</span><span>Acciones</span></div>
      {filteredClients.map((item)=><div className="client-row" key={item.id}>
        <div className="client-identity"><ClientAvatar client={item}/><div><strong>{item.name}</strong><small>{item.phone}</small></div></div>
        <div className="client-plan-cell"><strong>{item.plan}</strong><small>Vence {formatDate(item.expiresAt)}</small><em className={`payment-pill ${item.paymentStatus}`}>{paymentLabel(item)} · {item.balance ? `${money(item.balance)} saldo` : "sin saldo"}</em></div>
        <div className="client-usage"><strong>{item.sessionLimit ? `${item.sessionsUsed}/${item.sessionLimit} sesiones` : `${item.visits} visitas`}</strong><small>{item.stamps}/10 sellos</small></div>
        <span className={`status-badge ${item.accessStatus}`}>{accessLabel(item)}</span>
        <div className="row-actions">
          <button onClick={()=>openPayment(item)}>Cobrar</button>
          <details className="client-more" onBlur={(event)=>{if(!event.currentTarget.contains(event.relatedTarget)) event.currentTarget.open=false;}}><summary aria-label={`Más acciones para ${item.name}`} onKeyDown={(event)=>{if(event.key==="Escape"){const details=event.currentTarget.closest("details");if(details) details.open=false;}}}>Más <span aria-hidden="true">⌄</span></summary><div className="client-menu">
          <button onClick={()=>showCard(item)}>Tarjeta</button>
          <button onClick={()=>openRenew(item)}>Renovar</button>
          <button onClick={()=>openEditClient(item)}>Editar</button>
          <a className="row-link" target="_blank" rel="noreferrer" href={`https://wa.me/${item.phone.replace(/\D/g,"")}`}>WhatsApp</a>
          <button className="danger-action" onClick={()=>setDeletingClient(item)}>Eliminar</button>
          </div></details>
          <button onClick={()=>{visitSubmittingRef.current=false;setScannedClient(item);setScanStep(item.accessStatus==="active"?"found":"blocked");setScannerOpen(true);}}>＋ Visita</button>
        </div>
      </div>)}
    </div> : <div className="big-empty"><span>♙</span><h2>No hay clientes</h2><p>Registra el primero para comenzar.</p><button onClick={openNewClient}>Registrar cliente</button></div>}
  </section>;

  const plansView = <section className="view-page">
    <div className="view-heading"><div><span className="view-kicker">MEMBRESÍAS</span><h1>Planes</h1><p>Los precios y límites se administran aquí. El plan de 12 sesiones queda editable para que definas su precio.</p></div><button className="primary-button page-action" onClick={openNewPlan}>＋ Nuevo plan</button></div>
    <div className="plan-grid">{plans.map((plan)=><article className={`plan-card ${plan.active ? "" : "plan-disabled"}`} key={plan.id}><span className="plan-symbol purple">◇</span><small>{plan.durationMonths} MES{plan.durationMonths===1?"":"ES"}</small><h2>{plan.name}</h2><strong>{plan.price > 0 ? money(plan.price) : "PRECIO POR DEFINIR"}</strong><p>{plan.billingType==="sessions" ? `${plan.sessionLimit} ingresos por período` : "Ingresos ilimitados durante la vigencia"}</p><p>{clients.filter((item)=>item.planId===plan.id).length} miembros actuales</p><button onClick={()=>openEditPlan(plan)}>Editar plan →</button></article>)}</div>
  </section>;

  const loyaltyView = <section className="view-page loyalty-page"><div className="view-heading"><div><span className="view-kicker">GALERÍA DE TARJETAS</span><h1>Fidelidad</h1><p>QR único y sellos de cada miembro.</p></div></div><div className="list-toolbar loyalty-toolbar"><div className="search-box">⌕<input value={search} onChange={(event)=>setSearch(event.target.value)} placeholder="Buscar tarjeta"/></div></div>{filteredClients.length ? <div className="loyalty-gallery">{filteredClients.map((item)=><LoyaltyGalleryCard client={item} key={item.id} onOpen={showCard} onVisit={(client)=>{setScannedClient(client);setScanStep(client.accessStatus==="active"?"found":"blocked");setScannerOpen(true);}}/>)}</div> : <div className="big-empty"><span>✦</span><h2>Sin tarjetas</h2></div>}</section>;

  const attendanceView = <section className="view-page"><div className="view-heading"><div><span className="view-kicker">OPERACIÓN</span><h1>Asistencias</h1><p>El ingreso se bloquea automáticamente si el plan venció, agotó sesiones o superó los 14 días de tolerancia con deuda.</p></div><button className="primary-button page-action" onClick={openScanner}>⌗ Escanear QR</button></div>{activities.length ? <div className="history-list">{activities.map((item)=><article key={item.id}><span className={`history-icon ${item.type}`}>{item.type==="registro"?"＋":item.type==="premio"?"✦":"✓"}</span><div><strong>{item.clientName}</strong><p>{item.description}</p></div><time>{formatDateTime(item.createdAt)}</time></article>)}</div> : <div className="big-empty"><span>✓</span><h2>Aún no hay movimientos</h2></div>}</section>;

  const cobrosView = <section className="view-page">
    <div className="view-heading"><div><span className="view-kicker">CAJA Y RESPALDOS</span><h1>Cobros</h1><p>QR oficial del gimnasio, saldos y vouchers guardados en el servidor.</p></div></div>
    <div className="billing-grid">
      <article className="panel payment-qr-settings"><div className="panel-head"><div><h3>QR de cobro del gimnasio</h3><p>Esta imagen se mostrará al registrar un pago por QR.</p></div></div>{settings.paymentQrUrl ? <img src={settings.paymentQrUrl} alt="QR de cobro del gimnasio"/> : <div className="qr-empty">Aún no cargaste el QR de cobro</div>}<label className="upload-button">{qrSaving ? "Guardando…" : settings.paymentQrUrl ? "Reemplazar QR" : "Cargar QR"}<input type="file" accept="image/png,image/jpeg,image/webp" onChange={handlePaymentQr} disabled={qrSaving}/></label>{qrError&&<p className="form-error">{qrError}</p>}</article>
      <article className="panel debt-list"><div className="panel-head"><div><h3>Saldos pendientes</h3><p>Clientes con pago incompleto</p></div></div>{clients.filter((item)=>item.balance>0).length ? clients.filter((item)=>item.balance>0).sort((a,b)=>b.balance-a.balance).map((item)=><button className="debt-row" key={item.id} onClick={()=>openPayment(item)}><span><strong>{item.name}</strong><small>{item.plan} · tolerancia hasta {formatDate(item.graceUntil)}</small></span><b>{money(item.balance)}</b></button>) : <div className="big-empty compact"><span>✓</span><h2>Sin saldos pendientes</h2></div>}</article>
    </div>
  </section>;

  const reportsView = <section className="view-page"><div className="view-heading"><div><span className="view-kicker">RESUMEN CENTRAL</span><h1>Reportes</h1><p>Indicadores de membresías, accesos y pagos.</p></div></div><div className="report-grid"><article><span>Clientes</span><strong>{clients.length}</strong><p>{activeClients} habilitados</p></article><article><span>Visitas</span><strong>{clients.reduce((sum,item)=>sum+item.visits,0)}</strong><p>{todayVisits} hoy</p></article><article><span>Por cobrar</span><strong>{money(totalDebt)}</strong><p>{suspendedClients} suspendidos</p></article></div></section>;

  const content: Record<View, React.ReactNode> = { inicio: dashboardView, clientes: clientsView, planes: plansView, fidelidad: loyaltyView, asistencias: attendanceView, cobros: cobrosView, reportes: reportsView };

  return <main className="app-shell">
    <aside className={`sidebar ${sidebarOpen ? "open" : ""}`}>
      <div className="brand"><div className="brand-mark"><span>M</span></div><div><strong>MONSTER</strong><small>GYM OS</small></div></div>
      <nav aria-label="Navegación principal">
        <p className="nav-label">GESTIÓN</p>
        <button className={`nav-item ${view==="inicio"?"active":""}`} onClick={()=>go("inicio")}><span className="nav-icon">⌂</span> Inicio</button>
        <button className={`nav-item ${view==="clientes"?"active":""}`} onClick={()=>go("clientes")}><span className="nav-icon">♙</span> Clientes <span className="nav-count">{clients.length}</span></button>
        <button className={`nav-item ${view==="planes"?"active":""}`} onClick={()=>go("planes")}><span className="nav-icon">◇</span> Planes</button>
        <button className={`nav-item ${view==="fidelidad"?"active":""}`} onClick={()=>go("fidelidad")}><span className="nav-icon">✦</span> Fidelidad</button>
        <p className="nav-label secondary">OPERACIÓN</p>
        <button className={`nav-item ${view==="asistencias"?"active":""}`} onClick={()=>go("asistencias")}><span className="nav-icon">✓</span> Asistencias</button>
        <button className={`nav-item ${view==="cobros"?"active":""}`} onClick={()=>go("cobros")}><span className="nav-icon">$</span> Cobros</button>
        <button className={`nav-item ${view==="reportes"?"active":""}`} onClick={()=>go("reportes")}><span className="nav-icon">↗</span> Reportes</button>
      </nav>
      <div className="sidebar-footer"><div className="storage-mini"><span className="status-dot"/><div><strong>BASE CENTRAL</strong><small>SQLite · respaldos de pago</small></div></div><button className="profile-button" onClick={logout}><span className="avatar avatar-small">MO</span><span><strong>Administrador</strong><small>Cerrar sesión</small></span></button></div>
    </aside>
    {sidebarOpen&&<button className="backdrop" aria-label="Cerrar menú" onClick={()=>setSidebarOpen(false)}/>}
    <section className="main-content"><header className="topbar"><button className="menu-button" aria-label="Abrir menú" onClick={()=>setSidebarOpen(true)}>☰</button><div className="gym-status"><span className="status-dot"/> Monster Gym — Sucursal Central</div><div className="top-actions"><button className="icon-button" onClick={()=>go("clientes")}>⌕</button><button className="primary-button" onClick={openNewClient}><span>＋</span> Nuevo cliente</button></div></header><div className="dashboard">{centralError&&<div className="central-error"><strong>Error de sincronización.</strong><span>{centralError}</span><button onClick={()=>void loadCentralState()}>Reintentar</button></div>}{!centralLoaded&&!centralError&&<div className="central-loading">Sincronizando datos…</div>}{content[view]}</div></section>

    {clientOpen&&<div className="modal-layer" role="dialog" aria-modal="true"><button className="modal-scrim" onClick={()=>setClientOpen(false)}/><section className="client-modal"><header><div><span className="modal-kicker">{editingClient?"EDITAR MIEMBRO":"NUEVO MIEMBRO"}</span><h2>{editingClient?"Editar cliente":"Registrar cliente"}</h2><p>{editingClient?"El plan se renueva desde la acción Renovar.":"La vigencia se calcula de fecha a fecha."}</p></div><button className="close-button" onClick={()=>setClientOpen(false)}>×</button></header><form onSubmit={saveClient}>
      <label className={`photo-input ${photoUrl?"has-photo":""}`}>{photoUrl?<img src={photoUrl} alt="Vista previa"/>:<span>＋</span>}<strong>{photoUrl?"Foto cargada":"Añadir foto"}</strong><small>JPG, PNG o WEBP</small><input type="file" accept="image/png,image/jpeg,image/webp" onChange={handlePhoto}/></label>
      <div className="field-grid"><label><span>Nombre completo</span><input required value={clientForm.name} onChange={(e)=>setClientForm({...clientForm,name:e.target.value})}/></label><label><span>WhatsApp</span><input required value={clientForm.phone} onChange={(e)=>setClientForm({...clientForm,phone:e.target.value})}/></label></div>
      {!editingClient&&<div className="field-grid"><label><span>Plan</span><select value={clientForm.planId} onChange={(e)=>setClientForm({...clientForm,planId:e.target.value})}>{activePlans.map((plan)=><option value={plan.id} key={plan.id}>{plan.name} · {plan.price?money(plan.price):"precio pendiente"}</option>)}</select></label><label><span>Inicio</span><input type="date" value={clientForm.startsAt} onChange={(e)=>setClientForm({...clientForm,startsAt:e.target.value})}/></label></div>}
      {editingClient&&<div className="switch-field"><input aria-label="Suspensión manual" type="checkbox" checked={clientForm.manualSuspended} onChange={(e)=>setClientForm({...clientForm,manualSuspended:e.target.checked})}/><span><strong>Suspensión manual</strong><small>Bloquea el ingreso aunque el plan esté vigente y pagado.</small></span></div>}
      {formError&&<p className="form-error">{formError}</p>}
      <div className="form-actions"><button type="button" onClick={()=>setClientOpen(false)}>Cancelar</button><button type="submit" disabled={clientSaving}>{clientSaving?"Guardando…":editingClient?"Guardar cambios":"Crear cliente"}</button></div>
    </form></section></div>}

    {renewingClient&&<div className="modal-layer" role="dialog" aria-modal="true"><button className="modal-scrim" onClick={()=>setRenewingClient(null)}/><section className="simple-modal"><header><div><span className="modal-kicker">RENOVAR MEMBRESÍA</span><h2>{renewingClient.name}</h2><p>Inicia un período nuevo, reinicia las sesiones del plan y conserva todo el historial anterior.</p></div><button className="close-button" onClick={()=>setRenewingClient(null)}>×</button></header><form onSubmit={renewClient}><label><span>Plan</span><select value={renewForm.planId} onChange={(e)=>setRenewForm({...renewForm,planId:e.target.value})}>{activePlans.map((plan)=><option value={plan.id} key={plan.id}>{plan.name} · {plan.price?money(plan.price):"precio pendiente"}</option>)}</select></label><label><span>Fecha de inicio</span><input type="date" value={renewForm.startsAt} onChange={(e)=>setRenewForm({...renewForm,startsAt:e.target.value})}/></label><div className="form-actions"><button type="button" onClick={()=>setRenewingClient(null)}>Cancelar</button><button disabled={renewBusy}>{renewBusy?"Renovando…":"Renovar plan"}</button></div></form></section></div>}

    {paymentClient&&<div className="modal-layer" role="dialog" aria-modal="true"><button className="modal-scrim" onClick={()=>setPaymentClient(null)}/><section className="payment-modal"><header><div><span className="modal-kicker">REGISTRAR PAGO</span><h2>{paymentClient.name}</h2><p>{paymentClient.plan} · Total {money(paymentClient.membershipPrice)}</p></div><button className="close-button" onClick={()=>setPaymentClient(null)}>×</button></header>
      <div className="payment-summary"><div><span>Plan</span><strong>{money(paymentClient.membershipPrice)}</strong></div><div><span>Pagado</span><strong>{money(paymentClient.paidAmount)}</strong></div><div className="balance"><span>Saldo</span><strong>{money(paymentClient.balance)}</strong></div></div>
      {paymentClient.balance>0?<form onSubmit={registerPaymentRecord}>
        <div className="payment-methods"><button type="button" className={paymentForm.method==="qr"?"selected":""} onClick={()=>setPaymentForm({...paymentForm,method:"qr"})}>▦ QR</button><button type="button" className={paymentForm.method==="cash"?"selected":""} onClick={()=>setPaymentForm({...paymentForm,method:"cash"})}>Bs Efectivo</button></div>
        {paymentForm.method==="qr"&&<div className="payment-qr-flow">{settings.paymentQrUrl?<img className="owner-qr" src={settings.paymentQrUrl} alt="QR de cobro"/>:<div className="qr-empty">Primero carga el QR del gimnasio en Cobros.</div>}<label className={`voucher-capture ${voucherImage?"has-voucher":""}`}>{voucherImage?<img src={voucherImage} alt="Voucher capturado"/>:<><span>📷</span><strong>Tomar foto del voucher</strong><small>También puedes elegir una imagen de la galería</small></>}<input type="file" accept="image/*" capture="environment" onChange={handleVoucher}/></label></div>}
        <div className="field-grid"><label><span>Monto</span><input type="number" min="0.01" step="0.01" max={paymentClient.balance} value={paymentForm.amount} onChange={(e)=>setPaymentForm({...paymentForm,amount:e.target.value})}/></label><label><span>Nota opcional</span><input value={paymentForm.note} onChange={(e)=>setPaymentForm({...paymentForm,note:e.target.value})}/></label></div>
        {paymentError&&<p className="form-error">{paymentError}</p>}<button className="confirm-visit" disabled={paymentBusy||paymentForm.method==="qr"&&!voucherImage}>{paymentBusy?"Registrando…":"Registrar pago"}</button>
      </form>:<div className="paid-state">✓ Membresía pagada completamente</div>}
      <div className="payment-history"><h3>Historial de pagos</h3>{payments.length?payments.map((payment)=><article key={payment.id}><div><strong>{money(payment.amount)}</strong><span>{payment.method==="qr"?"QR":"Efectivo"} · {formatDateTime(payment.createdAt)}</span>{payment.note&&<small>{payment.note}</small>}</div>{payment.voucherUrl&&<a target="_blank" rel="noreferrer" href={payment.voucherUrl}>Ver voucher</a>}</article>):<p>Sin pagos registrados para este cliente.</p>}</div>
    </section></div>}

    {planOpen&&<div className="modal-layer" role="dialog" aria-modal="true"><button className="modal-scrim" onClick={()=>setPlanOpen(false)}/><section className="simple-modal"><header><div><span className="modal-kicker">{editingPlan?"EDITAR PLAN":"NUEVO PLAN"}</span><h2>{editingPlan?editingPlan.name:"Crear plan"}</h2><p>Esto permite agregar el cuarto plan cuando el dueño lo defina.</p></div><button className="close-button" onClick={()=>setPlanOpen(false)}>×</button></header><form onSubmit={savePlan}><label><span>Nombre</span><input required value={planForm.name} onChange={(e)=>setPlanForm({...planForm,name:e.target.value})}/></label><div className="field-grid"><label><span>Precio Bs</span><input type="number" min="0" step="0.01" value={planForm.price} onChange={(e)=>setPlanForm({...planForm,price:e.target.value})}/></label><label><span>Duración en meses</span><input type="number" min="1" value={planForm.durationMonths} onChange={(e)=>setPlanForm({...planForm,durationMonths:e.target.value})}/></label></div><label><span>Tipo</span><select value={planForm.billingType} onChange={(e)=>setPlanForm({...planForm,billingType:e.target.value as "unlimited"|"sessions"})}><option value="unlimited">Ingresos ilimitados</option><option value="sessions">Cantidad limitada de sesiones</option></select></label>{planForm.billingType==="sessions"&&<label><span>Sesiones por período</span><input type="number" min="1" value={planForm.sessionLimit} onChange={(e)=>setPlanForm({...planForm,sessionLimit:e.target.value})}/></label>}<div className="switch-field"><input aria-label="Plan disponible" type="checkbox" checked={planForm.active} onChange={(e)=>setPlanForm({...planForm,active:e.target.checked})}/><span><strong>Plan disponible</strong><small>Los planes desactivados conservan el historial.</small></span></div>{planError&&<p className="form-error">{planError}</p>}<div className="form-actions"><button type="button" onClick={()=>setPlanOpen(false)}>Cancelar</button><button disabled={planBusy}>{planBusy?"Guardando…":"Guardar plan"}</button></div></form></section></div>}

    {deletingClient&&<div className="modal-layer" role="dialog" aria-modal="true"><button className="modal-scrim" onClick={()=>setDeletingClient(null)}/><section className="delete-modal"><div className="delete-symbol">!</div><span className="modal-kicker">ELIMINAR CLIENTE</span><h2>¿Eliminar a {deletingClient.name}?</h2><p>Se eliminarán membresías, pagos y referencias a vouchers. Esta acción no se puede deshacer.</p><div><button onClick={()=>setDeletingClient(null)}>Cancelar</button><button className="delete-confirm" onClick={deleteClientRecord}>Eliminar definitivamente</button></div></section></div>}

    {cardOpen&&cardClient&&<div className="modal-layer" role="dialog" aria-modal="true"><button className="modal-scrim" onClick={()=>setCardOpen(false)}/><section className="card-modal"><header><div><span className="modal-kicker">TARJETA DIGITAL</span><h2>{cardClient.name}</h2></div><button className="close-button" onClick={()=>setCardOpen(false)}>×</button></header><div className="digital-card" ref={cardRef}><div className="card-top"><div className="mini-brand"><b>M</b><span>MONSTER<br/><small>GYM OS</small></span></div><span className="card-tier">{accessLabel(cardClient)}</span></div><div className="card-person"><ClientAvatar client={cardClient} className="card-photo"/><div><small>MIEMBRO</small><strong>{cardClient.name}</strong><p>{cardClient.plan}</p><code>ID {cardClient.token.slice(0,8).toUpperCase()}</code></div></div><div className="card-bottom"><div className="card-loyalty"><small>FIDELIDAD · {cardClient.stamps}/10 SELLOS</small><div className="mini-stamps">{Array.from({length:10},(_,index)=><i key={index} className={index<cardClient.stamps?"on":""}>{index<cardClient.stamps?"M":""}</i>)}</div></div><div className="qr-code">{qrDataUrl&&<img src={qrDataUrl} alt={`QR único de ${cardClient.name}`}/>}</div></div></div><p className="card-help">{cardClient.sessionLimit?`${cardClient.sessionsUsed}/${cardClient.sessionLimit} sesiones utilizadas. `:""}Vigente hasta {formatDate(cardClient.expiresAt)}.</p><div className="share-actions"><button className="download-button" onClick={downloadCard}>{downloadStatus==="working"?"Generando…":"↓ Descargar PNG"}</button><a className="whatsapp-button" target="_blank" rel="noreferrer" href={`https://wa.me/${cardClient.phone.replace(/\D/g,"")}`}>Abrir WhatsApp ↗</a></div></section></div>}

    {scannerOpen&&<div className="modal-layer" role="dialog" aria-modal="true"><button className="modal-scrim" onClick={closeScanner}/><section className="scanner-modal"><header><div><span className="modal-kicker">RECEPCIÓN</span><h2>{scanStep==="success"?"Ingreso autorizado":scanStep==="blocked"?"Ingreso bloqueado":scanStep==="found"?"Cliente identificado":scanStep==="missing"?"Tarjeta no encontrada":"Escanear tarjeta"}</h2></div><button className="close-button" onClick={closeScanner}>×</button></header>
      {scanStep==="camera"&&<div className="camera-content"><div className="camera-view real-camera"><div id="qr-reader"/><div className="camera-tip">Centra el QR dentro del marco</div></div>{scanError&&<p className="scan-error">{scanError}</p>}<form className="manual-scan" onSubmit={findManualClient}><input value={manualCode} onChange={(e)=>setManualCode(e.target.value)} placeholder="Código o teléfono"/><button>Buscar</button></form></div>}
      {scanStep==="missing"&&<div className="missing-state"><div className="missing-symbol">!</div><h3>Cliente no encontrado</h3><button className="confirm-visit" onClick={closeScanner}>Entendido</button></div>}
      {scanStep==="blocked"&&scannedClient&&<div className="blocked-state"><div className="blocked-symbol">!</div><span className="found-label">INGRESO BLOQUEADO</span><h3>{scannedClient.name}</h3><strong>{accessLabel(scannedClient)}</strong><p>{scannedClient.accessReason}</p>{scannedClient.balance>0&&<div className="block-debt"><span>Saldo pendiente</span><b>{money(scannedClient.balance)}</b><small>Tolerancia hasta {formatDate(scannedClient.graceUntil)}</small></div>}{scannedClient.sessionLimit&&<div className="block-debt"><span>Sesiones</span><b>{scannedClient.sessionsUsed}/{scannedClient.sessionLimit}</b></div>}<button className="confirm-visit" onClick={()=>{closeScanner();void openPayment(scannedClient);}}>Ir a cobro</button><button className="text-action" onClick={closeScanner}>Cerrar</button></div>}
      {scanStep==="found"&&scannedClient&&<div className="found-client"><div className="member-hero"><ClientAvatar client={scannedClient} className="found-avatar"/><span className="verified">✓</span></div><span className="found-label">INGRESO HABILITADO</span><h3>{scannedClient.name}</h3><p>{scannedClient.plan} · Vence {formatDate(scannedClient.expiresAt)}</p><div className="access-facts"><div><span>Pago</span><strong>{paymentLabel(scannedClient)}</strong><small>{scannedClient.balance?`${money(scannedClient.balance)} pendiente`:"Sin saldo"}</small></div><div><span>Uso</span><strong>{scannedClient.sessionLimit?`${scannedClient.sessionsUsed}/${scannedClient.sessionLimit}`:`${scannedClient.visits}`}</strong><small>{scannedClient.sessionLimit?"sesiones":"visitas"}</small></div></div><button className="confirm-visit" onClick={confirmVisit}>Confirmar ingreso <span>＋1 visita</span></button><button className="text-action" onClick={()=>{scanHandledRef.current=false;visitSubmittingRef.current=false;setScanStep("camera");setScannedClient(null);}}>Escanear otro</button></div>}
      {scanStep==="success"&&scannedClient&&<div className="success-state"><div className="success-burst">✓</div><span className="found-label">INGRESO AUTORIZADO</span><h3>{scannedClient.name}</h3><p>Visita registrada correctamente.<br/>{scannedClient.sessionLimit&&<strong>{scannedClient.sessionsUsed}/{scannedClient.sessionLimit} sesiones utilizadas</strong>}</p><div className="reward-chip"><span>✦</span><div><small>FIDELIDAD</small><strong>{scannedClient.stamps}/10 sellos</strong></div></div><button className="confirm-visit" onClick={closeScanner}>Listo, continuar</button></div>}
    </section></div>}
  </main>;
}
