"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createScannerLifecycle } from "./scanner-lifecycle.mjs";
import type { Html5Qrcode } from "html5-qrcode";
import { MembershipCard } from "./membership-card";
import { AttendanceView } from "./attendance";
import { BillingView, StoreView, DailyReports, VoucherPicker } from "./commerce";

type View = "inicio" | "clientes" | "planes" | "fidelidad" | "asistencias" | "cobros" | "reportes" | "tienda";
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
  cardVariant?: number;
  gender?: "male" | "female" | null;
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
const memberQrUrl = (id: string) => `/api/clients/${encodeURIComponent(id)}/qr`;
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

function MobileIcon({ name }: { name: "home" | "users" | "check" | "money" | "more" | "search" | "bell" | "qr" | "plans" | "star" }) {
  const paths = { home:"M3 10 12 3l9 7M5 9v12h5v-7h4v7h5V9", users:"M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2M16 4a4 4 0 0 1 0 8M22 21v-2a4 4 0 0 0-3-3.87M13 7a4 4 0 1 1-8 0 4 4 0 0 1 8 0", check:"M5 3h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2M7 12l3 3 7-7", money:"M12 2v20M17 5H9a4 4 0 0 0 0 8h6a3 3 0 0 1 0 6H6", more:"M4 12h.01M12 12h.01M20 12h.01", search:"M21 21l-5-5M18 10a8 8 0 1 1-16 0 8 8 0 0 1 16 0", bell:"M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9M10 21h4", qr:"M3 8V3h5M16 3h5v5M21 16v5h-5M8 21H3v-5M8 8h2v2H8zM15 8h2v2h-2zM8 15h2v2H8zM15 15h2v2h-2z", plans:"M3 9v6M7 5v14M7 12h10M17 5v14M21 9v6", star:"m12 3 2.8 5.7 6.2.9-4.5 4.4 1.1 6.2-5.6-3-5.6 3 1.1-6.2L3 9.6l6.2-.9Z" };
  return <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={name === "more" ? 4 : 1.8} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={paths[name]}/></svg>;
}

function ClientAvatar({ client, className = "" }: { client: ClientRecord; className?: string }) {
  return client.photo
    ? <img className={className} src={client.photo} alt={`Foto de ${client.name}`}/>
    : <span className={`avatar violet ${className}`}>{initials(client.name)}</span>;
}

function LoyaltyGalleryCard({ client, onOpen, onVisit }: { client: ClientRecord; onOpen: (client: ClientRecord) => void; onVisit: (client: ClientRecord) => void }) {
  return <article className="loyalty-gallery-card">
    <MembershipCard client={client} qr={memberQrUrl(client.id)}/>
    <div className="gallery-card-info">
      <div><strong>{client.visits} visita{client.visits === 1 ? "" : "s"}</strong><span>{client.sessionLimit ? `${client.sessionsUsed}/${client.sessionLimit} sesiones` : "Visitas registradas"}</span></div>
      <div className="gallery-card-actions"><button onClick={() => onOpen(client)}>Ver tarjeta</button><button onClick={() => onVisit(client)} disabled={client.accessStatus !== "active"}>＋ Visita</button></div>
    </div>
  </article>;
}

export default function Home() {
  const [view, setView] = useState<View>("inicio");
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [mobileMoreOpen, setMobileMoreOpen] = useState(false);
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
  const [clientFilter, setClientFilter] = useState("all");

  const [clientOpen, setClientOpen] = useState(false);
  const [editingClient, setEditingClient] = useState<ClientRecord | null>(null);
  const [deletingClient, setDeletingClient] = useState<ClientRecord | null>(null);
  const [clientForm, setClientForm] = useState({ name: "", phone: "", gender: "", planId: "", startsAt: todayInput(), manualSuspended: false });
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
  const [qrSource, setQrSource] = useState("");
  const [downloadStatus, setDownloadStatus] = useState<"idle" | "working" | "done" | "error">("idle");
  const cardRef = useRef<HTMLDivElement>(null);

  const [scannerOpen, setScannerOpen] = useState(false);
  const [scanStep, setScanStep] = useState<ScanStep>("camera");
  const [scannedClient, setScannedClient] = useState<ClientRecord | null>(null);
  const [scanError, setScanError] = useState("");
  const [manualCode, setManualCode] = useState("");
  const paymentRequestKey = useRef("");
  const paymentSubmitting = useRef(false);
  const cameraLifecycle = useRef(createScannerLifecycle());
  const scannerClients = useRef(clients);
  useEffect(() => { scannerClients.current = clients; }, [clients]);
  const checkInHandledRef = useRef(false);
  const scanHandledRef = useRef(false);
  const visitSubmittingRef = useRef(false);
  const stateLoading = useRef(false);
  const stateEtag = useRef("");

  const activePlans = useMemo(() => plans.filter((plan) => plan.active), [plans]);

  const replaceClient = useCallback((client: ClientRecord) => {
    setClients((current) => current.map((item) => item.id === client.id ? client : item));
    setCardClient((current) => current?.id === client.id ? client : current);
    setPaymentClient((current) => current?.id === client.id ? client : current);
    setScannedClient((current) => current?.id === client.id ? client : current);
  }, []);

  const loadCentralState = useCallback(async (silent = false) => {
    if (stateLoading.current) return;
    stateLoading.current = true;
    try {
      const response = await fetch("/api/state", { credentials:"same-origin", cache:"no-store", signal:AbortSignal.timeout(15000), headers:stateEtag.current ? {"If-None-Match":stateEtag.current} : {} });
      if (response.status === 304) { setCentralError(""); return; }
      const data = await response.json();
      if (!response.ok) throw new ApiError(data.error || `Error ${response.status}`,response.status,data);
      stateEtag.current = response.headers.get("ETag") || "";
      setClients(data.clients ?? []);
      setActivities(data.activities ?? []);
      setPlans(data.plans ?? []);
      setSettings(data.settings ?? { paymentQrUrl: "" });
      setCentralLoaded(true);
      setCentralError("");
    } catch (error) {
      if (error instanceof ApiError && error.status === 401) {
        stateEtag.current = "";
        setAuthState("login");
        return;
      }
      if (!silent) setCentralError(error instanceof Error ? error.message : "No se pudo conectar con la base central.");
    } finally { stateLoading.current = false; }
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
      setView(["inicio", "clientes", "planes", "fidelidad", "asistencias", "cobros", "reportes", "tienda"].includes(next) ? next : "inicio");
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
    if (authState !== "authenticated") { stateEtag.current = ""; return; }
    // Initial synchronization intentionally hydrates central server state after authentication.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void loadCentralState();
    const refresh = () => { if (document.visibilityState === "visible") void loadCentralState(true); };
    const timer = window.setInterval(refresh, 15000);
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
    const dispose = cameraLifecycle.current.open(
      async () => {
        const { Html5Qrcode, Html5QrcodeSupportedFormats } = await import("html5-qrcode");
        return new Html5Qrcode("qr-reader", { verbose:false, formatsToSupport:[Html5QrcodeSupportedFormats.QR_CODE], useBarCodeDetectorIfSupported:true });
      },
      async (instance: Html5Qrcode, isCancelled: () => boolean) => {
        await instance.start(
          { facingMode: { ideal: "environment" } },
          {
            fps:10, disableFlip:true,
            videoConstraints:{ facingMode:{ideal:"environment"}, width:{ideal:1280}, height:{ideal:720}, frameRate:{ideal:30,max:30} },
            qrbox:(width,height) => { const size=Math.max(1,Math.floor(Math.min(width,height)*0.8)); return {width:size,height:size}; },
          },
          (decoded) => {
            if (isCancelled() || scanHandledRef.current) return;
            const token=tokenFromQr(decoded).trim();
            if (!token) return;
            const found=scannerClients.current.find(item=>item.token===token || item.token.startsWith(token.replace(/^ID\s*/i,"")));
            if (!found) {setScanError("El QR no pertenece a un cliente registrado en Monsters Gym.");return;}
            scanHandledRef.current=true;
            setScanError("");setScannedClient(found);
            setScanStep(found.accessStatus==="active"?"found":"blocked");
          },
          () => undefined,
        );
        if (isCancelled()) return;
        // Autofocus is optional; unsupported controls must not interrupt scanning.
        try {
          const capabilities=instance.getRunningTrackCapabilities() as MediaTrackCapabilities & {focusMode?:string[]};
          if (capabilities.focusMode?.includes("continuous")) {
            await instance.applyVideoConstraints({advanced:[{focusMode:"continuous"} as MediaTrackConstraintSet]});
          }
        } catch { /* the camera keeps its native focus mode */ }
      },
      (error: unknown) => {
        const name=error instanceof Error ? error.name : String(error);
        setScanError(/NotAllowed|Permission/.test(name)
          ? "Permite el acceso a la c\u00e1mara en el navegador. Tambi\u00e9n puedes ingresar el c\u00f3digo manualmente."
          : "No se pudo iniciar la c\u00e1mara. Cierra otras aplicaciones que la usen o ingresa el c\u00f3digo manualmente.");
      },
    );
    return () => { void dispose(); };
  }, [scannerOpen, scanStep]);

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
    setMobileMoreOpen(false);
  };

  const openNewClient = () => {
    const first = activePlans[0];
    setEditingClient(null);
    setClientForm({ name: "", phone: "", gender: "", planId: first?.id ?? "", startsAt: todayInput(), manualSuspended: false });
    setPhotoUrl(""); setFormError(""); setClientOpen(true);
  };

  const openEditClient = (client: ClientRecord) => {
    setEditingClient(client);
    setClientForm({ name: client.name, phone: client.phone, gender: client.gender ?? "", planId: client.planId, startsAt: client.membershipStartedAt.slice(0,10), manualSuspended: client.manualSuspended });
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
    if (!clientForm.gender) { setFormError("Selecciona Var\u00f3n o Mujer."); return; }
    setClientSaving(true); setFormError("");
    try {
      if (editingClient) {
        const result = await apiJson<{ client: ClientRecord }>(`/api/clients/${encodeURIComponent(editingClient.id)}`, {
          method: "PUT",
          body: JSON.stringify({ name, phone, gender: clientForm.gender, photo: photoUrl, manualSuspended: clientForm.manualSuspended }),
        });
        replaceClient(result.client);
      } else {
        const result = await apiJson<{ client: ClientRecord; activity: ActivityRecord }>("/api/clients", {
          method: "POST",
          body: JSON.stringify({ name, phone, gender: clientForm.gender, planId: clientForm.planId, startsAt: `${clientForm.startsAt}T12:00:00Z`, photo: photoUrl }),
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
    paymentRequestKey.current = crypto.randomUUID();
    setPaymentClient(client);
    setPaymentForm({ amount: client.balance > 0 ? String(client.balance) : "", method: "qr", note: "" });
    setVoucherImage(""); setPaymentError(""); setPayments([]);
    try {
      const result = await apiJson<{ payments: PaymentRecord[] }>(`/api/clients/${encodeURIComponent(client.id)}/payments`);
      setPayments(result.payments ?? []);
    } catch (error) { setPaymentError(error instanceof Error ? error.message : "No se pudo cargar el historial."); }
  };

  const registerPaymentRecord = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!paymentClient || paymentSubmitting.current) return;
    paymentSubmitting.current = true;
    setPaymentBusy(true); setPaymentError("");
    try {
      const result = await apiJson<{ client: ClientRecord; payment: PaymentRecord }>(`/api/clients/${encodeURIComponent(paymentClient.id)}/payments`, {
        method: "POST",
        body: JSON.stringify({ requestKey:paymentRequestKey.current,membershipId:paymentClient.membershipId,amount: Number(paymentForm.amount), method: paymentForm.method, note: paymentForm.note, voucherImage }),
      });
      replaceClient(result.client);
      setPayments((current) => [result.payment, ...current]);
      paymentRequestKey.current = crypto.randomUUID();
      setPaymentClient(result.client);
      setPaymentForm({ amount: result.client.balance > 0 ? String(result.client.balance) : "", method: "qr", note: "" });
      setVoucherImage("");
    } catch (error) { setPaymentError(error instanceof Error ? error.message : "No se pudo registrar el pago."); }
    finally { setPaymentBusy(false); paymentSubmitting.current=false; }
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
    const qr = memberQrUrl(record.id);
    setCardClient(record); setQrSource(qr); setDownloadStatus("idle"); setCardOpen(true);
  };

  const downloadCard = async () => {
    if (!cardRef.current || !cardClient || !qrSource) return;
    setDownloadStatus("working");
    try {
      await document.fonts.ready;
      await Promise.all(Array.from(cardRef.current.querySelectorAll("img")).map(image => image.decode()));
      const width = cardRef.current.offsetWidth; const height = cardRef.current.offsetHeight;
      const { toPng } = await import("html-to-image");
      const image = await toPng(cardRef.current, { width, height, pixelRatio: 3, cacheBust: true, style: { width: `${width}px`, height: `${height}px`, margin: "0", transform: "none" } });
      const link = document.createElement("a");
      const safeName = cardClient.name.toLowerCase().replace(/[^a-z0-9áéíóúñ]+/gi, "-").replace(/^-|-$/g, "");
      link.download = `tarjeta-monsters-${safeName}.png`; link.href = image; link.click(); setDownloadStatus("done");
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
  const clientFilters = [
    { id:"all", label:"Todos", matches: () => true },
    { id:"active", label:"Activos", matches: (item: ClientRecord) => item.accessStatus === "active" },
    { id:"suspended", label:"Suspendidos", matches: (item: ClientRecord) => ["manual_suspended", "debt_suspended"].includes(item.accessStatus) },
    { id:"expired", label:"Vencidos", matches: (item: ClientRecord) => item.accessStatus === "expired" },
    { id:"sessions", label:"Sin sesiones", matches: (item: ClientRecord) => item.accessStatus === "sessions_exhausted" },
  ];
  const mobileClients = filteredClients.filter(clientFilters.find(filter=>filter.id === clientFilter)?.matches ?? clientFilters[0].matches);

  if (authState !== "authenticated") {
    return <main className="login-shell">
      <section className="login-card">
        <div className="login-brand"><div className="brand-mark"><span>M</span></div><div><strong>MONSTERS</strong><small>GYM OS</small></div></div>
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
    <div className="mobile-home-heading mobile-home-only"><div><h1>Monsters Gym —<br/>Sucursal Central</h1><p><span className="status-dot"/> Sucursal activa <span className="mobile-date">{formatDate(new Date().toISOString())}</span></p></div><button onClick={openNewClient}><MobileIcon name="users"/> Nuevo cliente</button></div>
    <div className="view-heading"><div><span className="view-kicker">RECEPCIÓN</span><h1>Tu gimnasio, al día</h1><p>Control de accesos, miembros y pagos en un solo lugar.</p></div><span className="today-label">{formatDate(new Date().toISOString())}</span></div>
    <section className="scanner-card">
      <div className="scanner-copy"><span className="live-pill"><i/> CONTROL DE ACCESO</span><h2>Registra el próximo ingreso</h2><p>Verifica el plan, el saldo y las sesiones disponibles al escanear.</p><small><span className="mobile-member-stack mobile-home-only" aria-hidden="true">{clients.slice(0,3).map(client=><ClientAvatar key={client.id} client={client}/>)}</span>{clients.length ? `${clients.length} clientes sincronizados` : "Primero registra un cliente"}</small></div>
      <div className="scanner-launch"><div className="mobile-qr-emblem mobile-home-only"><MobileIcon name="qr"/></div><button className="scan-button" onClick={openScanner}><span className="scan-symbol">⌗</span> Abrir escáner QR <b>→</b></button><span>Validación automática de membresía</span></div>
    </section>
    <section className="metrics-grid">
      <article className="metric-card"><div className="metric-icon purple">↙</div><div className="metric-top"><span>Visitas hoy</span><small>{todayVisits ? "Actualizado" : "Sin actividad"}</small></div><strong>{todayVisits}</strong><p>Ingresos confirmados</p></article>
      <article className="metric-card"><div className="metric-icon lime">♙</div><div className="metric-top"><span>Miembros habilitados</span><small>{clients.length} total</small></div><strong>{activeClients}</strong><p>{suspendedClients} suspendidos</p></article>
      <article className="metric-card"><div className="metric-icon coral">$</div><div className="metric-top"><span>Saldo por cobrar</span><small>Actual</small></div><strong>{money(totalDebt)}</strong><p>Deuda en membresías vigentes</p></article>
    </section>
    <div className="mobile-shortcuts mobile-home-only"><button onClick={()=>go("planes")}><span><MobileIcon name="plans"/></span><div><strong>Planes</strong><small>Gestiona membresías</small></div><b>›</b></button><button onClick={()=>go("fidelidad")}><span><MobileIcon name="star"/></span><div><strong>Fidelidad</strong><small>Premia a tus clientes</small></div><b>›</b></button></div>
    <section className="bottom-grid">
      <article className="panel activity-panel"><div className="panel-head"><div><h3>Actividad reciente</h3><p>Movimientos de recepción</p></div><button onClick={() => go("asistencias")}>Ver todo →</button></div>{activities.length ? <div className="activity-list">{activities.slice(0,5).map((item) => <div className="activity" key={item.id}><span className="avatar violet">{initials(item.clientName)}</span><div><strong>{item.clientName}</strong><p>{item.description}</p></div><time>{formatDateTime(item.createdAt)}</time></div>)}</div> : <div className="activity-empty"><span>⌁</span><div><strong>Historial listo</strong><p>Las visitas aparecerán aquí.</p></div></div>}</article>
      <article className="panel debt-panel"><div className="panel-head"><div><h3>Control de pagos</h3><p>Tolerancia máxima de 14 días</p></div><button onClick={() => go("cobros")}>Abrir cobros →</button></div><div className="debt-summary"><strong>{money(totalDebt)}</strong><span>saldo total pendiente</span><div><b>{clients.filter((item)=>item.paymentStatus==="partial").length}</b> parciales · <b>{clients.filter((item)=>item.paymentStatus==="due").length}</b> sin pago</div></div></article>
      <button className="mobile-growth mobile-home-only" onClick={()=>go("reportes")}><MobileIcon name="star"/><strong>Haz crecer tu gimnasio</strong><span>Conoce tus miembros, visitas y pagos.</span><b>Ver reportes →</b></button>
    </section>
  </>;

  const clientsView = <section className="view-page clients-page">
    <div className="view-heading"><div><span className="view-kicker">GESTIÓN DE MIEMBROS</span><h1>Clientes</h1><p><span className="clients-desktop-subtitle">{clients.length} miembros en la base central.</span><span className="clients-mobile-subtitle">Gestiona miembros, planes y pagos.</span></p></div><button className="primary-button page-action" onClick={openNewClient}>＋ Nuevo cliente</button></div>
    <div className="list-toolbar"><div className="search-box">⌕<input value={search} onChange={(event)=>setSearch(event.target.value)} placeholder="Buscar por nombre, teléfono o plan"/></div><span>{filteredClients.length} resultados</span></div>
    <div className="mobile-clients-content">
      <div className="client-filter-tabs" aria-label="Filtrar clientes por estado">{clientFilters.filter(filter=>filter.id!=="sessions" || clients.some(filter.matches)).map(filter=><button key={filter.id} className={`filter-${filter.id}`} aria-pressed={clientFilter===filter.id} onClick={()=>setClientFilter(filter.id)}>{filter.label}<span>{clients.filter(filter.matches).length}</span></button>)}</div>
      <div className="mobile-client-list">{mobileClients.map(item=><article className="member-tile" key={item.id}>
        <header className="member-tile-heading"><ClientAvatar client={item}/><div><h2>{item.name}</h2><a href={`tel:${item.phone.replace(/[^\d+]/g,"")}`}>{item.phone}</a></div><span className={`member-state ${item.accessStatus}`}>{accessLabel(item)}</span><button className="member-open" aria-label={`Ver tarjeta de ${item.name}`} onClick={()=>showCard(item)}>›</button></header>
        <div className="member-facts"><div><p><MobileIcon name="plans"/><span>Plan {item.plan}</span></p><p><MobileIcon name="check"/><span>Vence {formatDate(item.expiresAt)}</span></p></div><div><p><MobileIcon name="users"/><span>{item.sessionLimit ? `${item.sessionsUsed}/${item.sessionLimit} sesiones` : `${item.visits} visita${item.visits===1?"":"s"}`}</span></p><p><MobileIcon name="star"/><span>{item.visits} visita{item.visits === 1 ? "" : "s"} al gym</span></p></div></div>
        <footer className="member-tile-footer"><button className={`member-balance ${item.paymentStatus}`} onClick={()=>openPayment(item)}><strong>{paymentLabel(item)}</strong> {item.balance ? `${money(item.balance)} saldo` : "Sin saldo"}</button><details className="member-options" onBlur={event=>{if(!event.currentTarget.contains(event.relatedTarget))event.currentTarget.open=false;}}><summary aria-label={`Acciones de ${item.name}`} onKeyDown={event=>{if(event.key==="Escape"){const details=event.currentTarget.closest("details");if(details)details.open=false;}}}><MobileIcon name="more"/></summary><div className="member-options-menu"><button onClick={()=>openPayment(item)}>Registrar pago</button><button onClick={()=>{visitSubmittingRef.current=false;setScannedClient(item);setScanStep(item.accessStatus==="active"?"found":"blocked");setScannerOpen(true);}}>Registrar visita</button><button onClick={()=>showCard(item)}>Ver tarjeta</button><button onClick={()=>openRenew(item)}>Renovar plan</button><button onClick={()=>openEditClient(item)}>Editar cliente</button><a target="_blank" rel="noreferrer" href={`https://wa.me/${item.phone.replace(/\D/g,"")}`}>WhatsApp</a><button className="member-delete" onClick={()=>setDeletingClient(item)}>Eliminar cliente</button></div></details></footer>
      </article>)}</div>
      {!mobileClients.length&&<div className="member-empty"><MobileIcon name="users"/><h2>{clients.length ? "Sin coincidencias" : "Todavía no hay clientes"}</h2><p>{clients.length ? "Prueba otro nombre o estado." : "Registra tu primer miembro para comenzar."}</p><button onClick={()=>{if(clients.length){setSearch("");setClientFilter("all");}else openNewClient();}}>{clients.length ? "Mostrar todos" : "Nuevo cliente"}</button></div>}
      <div className="member-list-summary" role="status"><MobileIcon name="users"/><strong>{mobileClients.length === clients.length ? `${clients.length} clientes en la base central` : `${mobileClients.length} de ${clients.length} clientes`}</strong><span>{centralLoaded&&!centralError ? "Miembros actualizados y sincronizados." : "Consulta el estado de sincronización."}</span></div>
    </div>
    {filteredClients.length ? <div className="clients-table desktop-client-list">
      <div className="client-row table-head"><span>Cliente</span><span>Membresía / pago</span><span>Actividad</span><span>Estado</span><span>Acciones</span></div>
      {filteredClients.map((item)=><div className="client-row" key={item.id}>
        <div className="client-identity"><ClientAvatar client={item}/><div><strong>{item.name}</strong><small>{item.phone}</small></div></div>
        <div className="client-plan-cell"><strong>{item.plan}</strong><small>Vence {formatDate(item.expiresAt)}</small><em className={`payment-pill ${item.paymentStatus}`}>{paymentLabel(item)} · {item.balance ? `${money(item.balance)} saldo` : "sin saldo"}</em></div>
        <div className="client-usage"><strong>{item.sessionLimit ? `${item.sessionsUsed}/${item.sessionLimit} sesiones` : `${item.visits} visitas`}</strong><small>{item.visits} visita{item.visits === 1 ? "" : "s"} al gym</small></div>
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
    </div> : <div className="big-empty desktop-client-list"><span>♙</span><h2>No hay clientes</h2><p>Registra el primero para comenzar.</p><button onClick={openNewClient}>Registrar cliente</button></div>}
  </section>;

  const mostPopularPlanId = plans.reduce((bestId, plan) => {
    const count = clients.filter((item)=>item.planId===plan.id).length;
    const bestCount = bestId ? clients.filter((item)=>item.planId===bestId).length : -1;
    return count > bestCount ? plan.id : bestId;
  }, "");

  const plansView = <section className="view-page plans-page">
    <div className="view-heading"><div><span className="view-kicker">MEMBRESÍAS</span><h1>Planes</h1><p className="plans-desktop-subtitle">Los precios y límites se administran aquí. El plan de 12 sesiones queda editable para que definas su precio.</p><p className="plans-mobile-subtitle mobile-home-only">Gestiona precios, sesiones y vigencia.</p></div><button className="primary-button page-action" onClick={openNewPlan}>＋ Nuevo plan</button></div>
    <button className="mobile-plan-summary mobile-home-only" type="button" onClick={()=>document.querySelector('.mobile-plans .plan-grid')?.scrollIntoView({behavior:'smooth',block:'start'})}><span><MobileIcon name="plans"/></span><div><strong>{plans.filter((plan)=>plan.active).length} planes activos</strong><small>Los precios y límites se administran aquí.</small></div><b>›</b></button>
    <div className="plan-grid">{plans.map((plan)=>{const memberCount=clients.filter((item)=>item.planId===plan.id).length; const popular=plan.active&&plan.id===mostPopularPlanId&&memberCount>0; return <article className={`plan-card ${plan.active ? "" : "plan-disabled"} ${popular ? "plan-popular" : ""} ${plan.billingType === "sessions" ? "plan-sessions" : "plan-unlimited"}`} key={plan.id}><span className="plan-symbol purple">◇</span><small>{plan.durationMonths} MES{plan.durationMonths===1?"":"ES"}</small><h2>{plan.name}</h2>{popular&&<span className="mobile-plan-popular mobile-home-only"><MobileIcon name="star"/> Más popular</span>}<strong>{plan.price > 0 ? money(plan.price) : "PRECIO POR DEFINIR"}</strong><p>{plan.billingType==="sessions" ? `${plan.sessionLimit} ingresos por período` : <><span className="plans-desktop-copy">Ingresos ilimitados durante la vigencia</span><span className="plans-mobile-copy mobile-home-only">Ingresos ilimitados</span></>}</p><p>{memberCount} miembros actuales</p><span className="mobile-plan-chevron mobile-home-only">›</span><button onClick={()=>openEditPlan(plan)}>Editar plan →</button></article>})}</div>
  </section>;

  const activeLoyaltyCards = filteredClients.filter((item)=>item.accessStatus==="active").length;
  const loyaltyView = <section className="view-page loyalty-page">
    <div className="view-heading"><div><span className="view-kicker">GALERÍA DE TARJETAS</span><h1>Fidelidad</h1><p>Tarjetas de miembros y control de visitas.</p></div></div>
    <div className="list-toolbar loyalty-toolbar"><div className="search-box"><MobileIcon name="search"/><input value={search} onChange={(event)=>setSearch(event.target.value)} placeholder="Buscar tarjeta"/></div></div>
    {filteredClients.length ? <>
      <div className="loyalty-gallery">{filteredClients.map((item)=><LoyaltyGalleryCard client={item} key={item.id} onOpen={showCard} onVisit={(client)=>{setScannedClient(client);setScanStep(client.accessStatus==="active"?"found":"blocked");setScannerOpen(true);}}/>)}</div>
      <div className="mobile-loyalty-summary mobile-home-only" role="status"><span><MobileIcon name="users"/></span><div><strong>{activeLoyaltyCards} tarjetas activas</strong><small>Miembros con programa de fidelidad</small></div><b>›</b></div>
    </> : <div className="big-empty"><span>✦</span><h2>Sin tarjetas</h2></div>}
  </section>;

  const attendanceView = <AttendanceView activities={activities} clients={clients} onScan={openScanner} onVisit={id=>{const client=clients.find(c=>c.id===id);if(client){scanHandledRef.current=false;visitSubmittingRef.current=false;setScannedClient(client);setScanStep(client.accessStatus==="active"?"found":"blocked");setScannerOpen(true);}}} onCard={id=>{const client=clients.find(c=>c.id===id);if(client)void showCard(client);}} onPay={id=>{const client=clients.find(c=>c.id===id);if(client)void openPayment(client);}} onEdit={id=>{const client=clients.find(c=>c.id===id);if(client)openEditClient(client);}}/>;

  const cobrosView = <BillingView clients={clients} qrUrl={settings.paymentQrUrl} onPay={id=>{const client=clients.find(c=>c.id===id);if(client)void openPayment(client);}} onRenew={id=>{const client=clients.find(c=>c.id===id);if(client)openRenew(client);}} onQrFile={handlePaymentQr} qrSaving={qrSaving} qrError={qrError}/>;
  const reportsView = <DailyReports/>;
  const storeView = <StoreView/>;

  const content: Record<View, React.ReactNode> = { inicio: dashboardView, clientes: clientsView, planes: plansView, fidelidad: loyaltyView, asistencias: attendanceView, cobros: cobrosView, reportes: reportsView, tienda: storeView };

  const moreIsActive = view === "fidelidad" || view === "planes" || view === "reportes" || view === "tienda";

  return <main className={`app-shell ${view === "inicio" ? "mobile-home" : view === "clientes" ? "mobile-home mobile-clients" : view === "planes" ? "mobile-home mobile-plans" : view === "fidelidad" ? "mobile-home mobile-loyalty" : view === "asistencias" ? "mobile-home mobile-attendance" : ["cobros","reportes","tienda"].includes(view) ? "mobile-home mobile-commerce" : ""}`}>
    <header className="mobile-home-topbar mobile-home-only"><div className="mobile-brand"><div className="brand-mark"><span>M</span></div><div><strong>MONSTERS</strong><small>GYM OS</small></div></div><div className="mobile-header-actions"><button aria-label="Buscar clientes" onClick={()=>{go("clientes");requestAnimationFrame(()=>document.querySelector<HTMLInputElement>(".clients-page .search-box input")?.focus());}}><MobileIcon name="search"/></button><button aria-label="Ver actividad reciente" onClick={()=>go("asistencias")}><MobileIcon name="bell"/></button><button className="mobile-profile" aria-label="Abrir opciones" onClick={()=>setMobileMoreOpen(true)}>MO</button></div></header>
    <nav className="mobile-bottom-nav mobile-home-only" aria-label="Navegación móvil">{([{view:"inicio",label:"Inicio",icon:"home"},{view:"clientes",label:"Clientes",icon:"users"},{view:"asistencias",label:"Asistencias",icon:"check"},{view:"cobros",label:"Cobros",icon:"money"}] as const).map((item)=><button key={item.view} aria-current={view===item.view ? "page" : undefined} onClick={()=>go(item.view)}><MobileIcon name={item.icon}/><span>{item.label}</span></button>)}<button aria-current={moreIsActive ? "page" : undefined} onClick={()=>setMobileMoreOpen(true)}><MobileIcon name="more"/><span>Más</span></button></nav>
    {mobileMoreOpen&&<div className="mobile-more-layer mobile-home-only" role="dialog" aria-modal="true" aria-label="Más opciones">
      <button className="mobile-more-scrim" aria-label="Cerrar más opciones" onClick={()=>setMobileMoreOpen(false)}/>
      <section className="mobile-more-sheet">
        <div className="mobile-more-handle"/>
        <header><div><small>MONSTERS GYM OS</small><h2>Más opciones</h2></div><button aria-label="Cerrar" onClick={()=>setMobileMoreOpen(false)}>×</button></header>
        <nav>
          <button className={view==="planes"?"active":""} onClick={()=>go("planes")}><span><MobileIcon name="plans"/></span><div><strong>Planes</strong><small>Membresías y precios</small></div><b>›</b></button>
          <button className={view==="fidelidad"?"active":""} onClick={()=>go("fidelidad")}><span><MobileIcon name="star"/></span><div><strong>Fidelidad</strong><small>Tarjetas, QR y visitas</small></div><b>›</b></button>
          <button className={view==="asistencias"?"active":""} onClick={()=>go("asistencias")}><span><MobileIcon name="check"/></span><div><strong>Asistencias</strong><small>Historial y control de ingresos</small></div><b>›</b></button>
          <button className={view==="reportes"?"active":""} onClick={()=>go("reportes")}><span><MobileIcon name="plans"/></span><div><strong>Reportes</strong><small>Ingresos diarios y vouchers</small></div><b>›</b></button>
          <button className={view==="tienda"?"active":""} onClick={()=>go("tienda")}><span><MobileIcon name="plans"/></span><div><strong>Tienda</strong><small>Artículos y precios</small></div><b>›</b></button>
        </nav>
        <button className="mobile-more-logout" onClick={()=>{setMobileMoreOpen(false);void logout();}}><span className="avatar avatar-small">MO</span><div><strong>Administrador</strong><small>Cerrar sesión</small></div><b>Salir</b></button>
      </section>
    </div>}
    <aside className={`sidebar ${sidebarOpen ? "open" : ""}`}>
      <div className="brand"><div className="brand-mark"><span>M</span></div><div><strong>MONSTERS</strong><small>GYM OS</small></div></div>
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
        <button className={`nav-item ${view==="tienda"?"active":""}`} onClick={()=>go("tienda")}><span className="nav-icon">◇</span> Tienda</button>
      </nav>
      <div className="sidebar-footer"><div className="storage-mini"><span className="status-dot"/><div><strong>BASE CENTRAL</strong><small>SQLite · respaldos de pago</small></div></div><button className="profile-button" onClick={logout}><span className="avatar avatar-small">MO</span><span><strong>Administrador</strong><small>Cerrar sesión</small></span></button></div>
    </aside>
    {sidebarOpen&&<button className="backdrop" aria-label="Cerrar menú" onClick={()=>setSidebarOpen(false)}/>}
    <section className="main-content"><header className="topbar"><button className="menu-button" aria-label="Abrir menú" onClick={()=>setSidebarOpen(true)}>☰</button><div className="gym-status"><span className="status-dot"/> Monsters Gym — Sucursal Central</div><div className="top-actions"><button className="icon-button" onClick={()=>go("clientes")}>⌕</button><button className="primary-button" onClick={openNewClient}><span>＋</span> Nuevo cliente</button></div></header><div className="dashboard">{centralError&&<div className="central-error"><strong>Error de sincronización.</strong><span>{centralError}</span><button onClick={()=>void loadCentralState()}>Reintentar</button></div>}{!centralLoaded&&!centralError&&<div className="central-loading">Sincronizando datos…</div>}{content[view]}</div></section>

    {clientOpen&&<div className="modal-layer" role="dialog" aria-modal="true"><button className="modal-scrim" onClick={()=>setClientOpen(false)}/><section className="client-modal"><header><div><span className="modal-kicker">{editingClient?"EDITAR MIEMBRO":"NUEVO MIEMBRO"}</span><h2>{editingClient?"Editar cliente":"Registrar cliente"}</h2><p>{editingClient?"El plan se renueva desde la acción Renovar.":"La vigencia se calcula de fecha a fecha."}</p></div><button className="close-button" onClick={()=>setClientOpen(false)}>×</button></header><form onSubmit={saveClient}>
      <label className={`photo-input ${photoUrl?"has-photo":""}`}>{photoUrl?<img src={photoUrl} alt="Vista previa"/>:<span>＋</span>}<strong>{photoUrl?"Foto cargada":"Añadir foto"}</strong><small>JPG, PNG o WEBP</small><input type="file" accept="image/png,image/jpeg,image/webp" onChange={handlePhoto}/></label>
      <div className="field-grid"><label><span>Nombre completo</span><input required value={clientForm.name} onChange={(e)=>setClientForm({...clientForm,name:e.target.value})}/></label><label><span>WhatsApp</span><input required value={clientForm.phone} onChange={(e)=>setClientForm({...clientForm,phone:e.target.value})}/></label></div>
      <label className="full-field"><span>Varón / Mujer</span><select required value={clientForm.gender} onChange={e=>setClientForm({...clientForm,gender:e.target.value})}><option value="">Selecciona una opción</option><option value="male">Varón · tarjeta con animal</option><option value="female">Mujer · tarjeta de gimnasio</option></select></label>
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
        {paymentForm.method==="qr"&&<div className="payment-qr-flow">{settings.paymentQrUrl?<img className="owner-qr" src={settings.paymentQrUrl} alt="QR de cobro"/>:<div className="qr-empty">Primero carga el QR del gimnasio en Cobros.</div>}<VoucherPicker value={voucherImage} onChange={setVoucherImage} disabled={paymentBusy}/></div>}
        {paymentForm.method==="cash"&&<VoucherPicker value={voucherImage} onChange={setVoucherImage} disabled={paymentBusy}/>}
        <div className="field-grid"><label><span>Monto</span><input type="number" min="0.01" step="0.01" max={paymentClient.balance} value={paymentForm.amount} onChange={(e)=>setPaymentForm({...paymentForm,amount:e.target.value})}/></label><label><span>Nota opcional</span><input value={paymentForm.note} onChange={(e)=>setPaymentForm({...paymentForm,note:e.target.value})}/></label></div>
        {paymentError&&<p className="form-error">{paymentError}</p>}<button className="confirm-visit" disabled={paymentBusy||paymentForm.method==="qr"&&!voucherImage}>{paymentBusy?"Registrando…":"Registrar pago"}</button>
      </form>:<div className="paid-state">✓ Membresía pagada completamente</div>}
      <div className="payment-history"><h3>Historial de pagos</h3>{payments.length?payments.map((payment)=><article key={payment.id}><div><strong>{money(payment.amount)}</strong><span>{payment.method==="qr"?"QR":"Efectivo"} · {formatDateTime(payment.createdAt)}</span>{payment.note&&<small>{payment.note}</small>}</div>{payment.voucherUrl&&<a target="_blank" rel="noreferrer" href={payment.voucherUrl}>Ver voucher</a>}</article>):<p>Sin pagos registrados para este cliente.</p>}</div>
    </section></div>}

    {planOpen&&<div className="modal-layer" role="dialog" aria-modal="true"><button className="modal-scrim" onClick={()=>setPlanOpen(false)}/><section className="simple-modal"><header><div><span className="modal-kicker">{editingPlan?"EDITAR PLAN":"NUEVO PLAN"}</span><h2>{editingPlan?editingPlan.name:"Crear plan"}</h2><p>Esto permite agregar el cuarto plan cuando el dueño lo defina.</p></div><button className="close-button" onClick={()=>setPlanOpen(false)}>×</button></header><form onSubmit={savePlan}><label><span>Nombre</span><input required value={planForm.name} onChange={(e)=>setPlanForm({...planForm,name:e.target.value})}/></label><div className="field-grid"><label><span>Precio Bs</span><input type="number" min="0" step="0.01" value={planForm.price} onChange={(e)=>setPlanForm({...planForm,price:e.target.value})}/></label><label><span>Duración en meses</span><input type="number" min="1" value={planForm.durationMonths} onChange={(e)=>setPlanForm({...planForm,durationMonths:e.target.value})}/></label></div><label><span>Tipo</span><select value={planForm.billingType} onChange={(e)=>setPlanForm({...planForm,billingType:e.target.value as "unlimited"|"sessions"})}><option value="unlimited">Ingresos ilimitados</option><option value="sessions">Cantidad limitada de sesiones</option></select></label>{planForm.billingType==="sessions"&&<label><span>Sesiones por período</span><input type="number" min="1" value={planForm.sessionLimit} onChange={(e)=>setPlanForm({...planForm,sessionLimit:e.target.value})}/></label>}<div className="switch-field"><input aria-label="Plan disponible" type="checkbox" checked={planForm.active} onChange={(e)=>setPlanForm({...planForm,active:e.target.checked})}/><span><strong>Plan disponible</strong><small>Los planes desactivados conservan el historial.</small></span></div>{planError&&<p className="form-error">{planError}</p>}<div className="form-actions"><button type="button" onClick={()=>setPlanOpen(false)}>Cancelar</button><button disabled={planBusy}>{planBusy?"Guardando…":"Guardar plan"}</button></div></form></section></div>}

    {deletingClient&&<div className="modal-layer" role="dialog" aria-modal="true"><button className="modal-scrim" onClick={()=>setDeletingClient(null)}/><section className="delete-modal"><div className="delete-symbol">!</div><span className="modal-kicker">ELIMINAR CLIENTE</span><h2>¿Eliminar a {deletingClient.name}?</h2><p>Se elimina el cliente y sus membresías. Los cobros y vouchers se conservan en Reportes. Esta acción no se puede deshacer.</p><div><button onClick={()=>setDeletingClient(null)}>Cancelar</button><button className="delete-confirm" onClick={deleteClientRecord}>Eliminar definitivamente</button></div></section></div>}

    {cardOpen&&cardClient&&<div className="modal-layer" role="dialog" aria-modal="true"><button className="modal-scrim" onClick={()=>setCardOpen(false)}/><section className="card-modal"><header><div><span className="modal-kicker">TARJETA DIGITAL</span><h2>Tu acceso al gimnasio</h2></div><button className="close-button" onClick={()=>setCardOpen(false)}>×</button></header><MembershipCard client={cardClient} qr={qrSource} cardRef={cardRef}/><p className="card-help">Conserva tu tarjeta. Tus visitas se registran en recepción.</p>{downloadStatus==="error"&&<p className="card-help" role="alert">No se pudo generar la tarjeta. Intenta descargarla de nuevo.</p>}<div className="share-actions"><button className="download-button" disabled={!qrSource || downloadStatus==="working"} onClick={downloadCard}>{downloadStatus==="working"?"Generando…":"↓ Descargar PNG"}</button><a className="whatsapp-button" target="_blank" rel="noreferrer" href={`https://wa.me/${cardClient.phone.replace(/\D/g,"")}`}>Abrir WhatsApp ↗</a></div><footer className="membership-modal-footer"><strong>MONSTERS CLUB GYM</strong>DISCIPLINA HOY, RESULTADOS SIEMPRE</footer></section></div>}

    {scannerOpen&&<div className="modal-layer" role="dialog" aria-modal="true"><button className="modal-scrim" onClick={closeScanner}/><section className="scanner-modal"><header><div><span className="modal-kicker">RECEPCIÓN</span><h2>{scanStep==="success"?"Ingreso autorizado":scanStep==="blocked"?"Ingreso bloqueado":scanStep==="found"?"Cliente identificado":scanStep==="missing"?"Tarjeta no encontrada":"Escanear tarjeta"}</h2></div><button className="close-button" onClick={closeScanner}>×</button></header>
      {scanStep==="camera"&&<div className="camera-content"><div className="camera-view real-camera"><div id="qr-reader"/><div className="camera-tip">Centra el QR dentro del marco</div></div>{scanError&&<p className="scan-error">{scanError}</p>}<form className="manual-scan" onSubmit={findManualClient}><input value={manualCode} onChange={(e)=>setManualCode(e.target.value)} placeholder="Código o teléfono"/><button>Buscar</button></form></div>}
      {scanStep==="missing"&&<div className="missing-state"><div className="missing-symbol">!</div><h3>Cliente no encontrado</h3><button className="confirm-visit" onClick={closeScanner}>Entendido</button></div>}
      {scanStep==="blocked"&&scannedClient&&<div className="blocked-state"><div className="blocked-symbol">!</div><span className="found-label">INGRESO BLOQUEADO</span><h3>{scannedClient.name}</h3><strong>{accessLabel(scannedClient)}</strong><p>{scannedClient.accessReason}</p>{scannedClient.balance>0&&<div className="block-debt"><span>Saldo pendiente</span><b>{money(scannedClient.balance)}</b><small>Tolerancia hasta {formatDate(scannedClient.graceUntil)}</small></div>}{scannedClient.sessionLimit&&<div className="block-debt"><span>Sesiones</span><b>{scannedClient.sessionsUsed}/{scannedClient.sessionLimit}</b></div>}<button className="confirm-visit" onClick={()=>{closeScanner();void openPayment(scannedClient);}}>Ir a cobro</button><button className="text-action" onClick={closeScanner}>Cerrar</button></div>}
      {scanStep==="found"&&scannedClient&&<div className="found-client"><div className="member-hero"><ClientAvatar client={scannedClient} className="found-avatar"/><span className="verified">✓</span></div><span className="found-label">INGRESO HABILITADO</span><h3>{scannedClient.name}</h3><p>{scannedClient.plan} · Vence {formatDate(scannedClient.expiresAt)}</p><div className="access-facts"><div><span>Pago</span><strong>{paymentLabel(scannedClient)}</strong><small>{scannedClient.balance?`${money(scannedClient.balance)} pendiente`:"Sin saldo"}</small></div><div><span>Uso</span><strong>{scannedClient.sessionLimit?`${scannedClient.sessionsUsed}/${scannedClient.sessionLimit}`:`${scannedClient.visits}`}</strong><small>{scannedClient.sessionLimit?"sesiones":"visitas"}</small></div></div><button className="confirm-visit" onClick={confirmVisit}>Confirmar ingreso <span>＋1 visita</span></button><button className="text-action" onClick={()=>{scanHandledRef.current=false;visitSubmittingRef.current=false;setScanStep("camera");setScannedClient(null);}}>Escanear otro</button></div>}
      {scanStep==="success"&&scannedClient&&<div className="success-state"><div className="success-burst">✓</div><span className="found-label">INGRESO AUTORIZADO</span><h3>{scannedClient.name}</h3><p>Visita registrada correctamente.<br/>{scannedClient.sessionLimit&&<strong>{scannedClient.sessionsUsed}/{scannedClient.sessionLimit} sesiones utilizadas</strong>}</p><div className="reward-chip"><span>✦</span><div><small>FIDELIDAD</small><strong>{scannedClient.visits} visita{scannedClient.visits === 1 ? "" : "s"} al gym</strong></div></div><button className="confirm-visit" onClick={closeScanner}>Listo, continuar</button></div>}
    </section></div>}
  </main>;
}
