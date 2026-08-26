"use client";

import { useState } from "react";

const Icon = ({ children }: { children: React.ReactNode }) => (
  <span className="nav-icon" aria-hidden="true">{children}</span>
);

export default function Home() {
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [scannerOpen, setScannerOpen] = useState(false);
  const [scanStep, setScanStep] = useState<"camera" | "found" | "success">("camera");
  const [clientOpen, setClientOpen] = useState(false);
  const [cardOpen, setCardOpen] = useState(false);
  const [client, setClient] = useState({ name: "", phone: "", plan: "Plan Fuerza · Mensual" });

  const openScanner = () => { setScanStep("camera"); setScannerOpen(true); };
  const registerClient = (event: React.FormEvent) => {
    event.preventDefault();
    if (!client.name.trim() || !client.phone.trim()) return;
    setClientOpen(false);
    setCardOpen(true);
  };

  return (
    <main className="app-shell">
      <aside className={`sidebar ${sidebarOpen ? "open" : ""}`}>
        <div className="brand"><div className="brand-mark"><span>M</span></div><div><strong>MONSTER</strong><small>GYM OS</small></div></div>
        <nav aria-label="Navegación principal">
          <p className="nav-label">GESTIÓN</p>
          <a className="nav-item active" href="#inicio"><Icon>⌂</Icon> Inicio</a>
          <a className="nav-item" href="#clientes"><Icon>♙</Icon> Clientes <span className="nav-count">248</span></a>
          <a className="nav-item" href="#planes"><Icon>◇</Icon> Planes</a>
          <a className="nav-item" href="#fidelidad"><Icon>✦</Icon> Fidelidad</a>
          <p className="nav-label secondary">OPERACIÓN</p>
          <a className="nav-item" href="#asistencias"><Icon>✓</Icon> Asistencias</a>
          <a className="nav-item" href="#reportes"><Icon>↗</Icon> Reportes</a>
        </nav>
        <div className="sidebar-footer">
          <div className="plan-mini"><span>PLAN PRO</span><strong>22 días restantes</strong><div><i /></div></div>
          <button className="profile-button"><span className="avatar avatar-small">MO</span><span><strong>Milton Ortiz</strong><small>Administrador</small></span><b>•••</b></button>
        </div>
      </aside>
      {sidebarOpen && <button className="backdrop" aria-label="Cerrar menú" onClick={() => setSidebarOpen(false)} />}
      <section className="main-content">
        <header className="topbar">
          <button className="menu-button" aria-label="Abrir menú" onClick={() => setSidebarOpen(true)}>☰</button>
          <div className="gym-status"><span className="status-dot" /> Monster Gym — Sucursal Central <button>⌄</button></div>
          <div className="top-actions"><button className="icon-button" aria-label="Buscar">⌕</button><button className="icon-button notification" aria-label="Notificaciones">♢<i /></button><button className="primary-button" onClick={() => setClientOpen(true)}><span>＋</span> Nuevo cliente</button></div>
        </header>
        <div className="dashboard" id="inicio">
          <div className="welcome-row"><div><p className="eyebrow">MIÉRCOLES, 26 DE AGOSTO</p><h1>Buenos días, Milton <span>👋</span></h1><p>Todo está listo para un gran día en el gimnasio.</p></div><button className="period-button">Últimos 7 días <span>⌄</span></button></div>
          <section className="scanner-card">
            <div className="scanner-copy"><span className="live-pill"><i /> ESCÁNER LISTO</span><h2>Registra una visita<br />en segundos.</h2><p>Escanea la tarjeta digital del cliente para sumar una asistencia o premiar una meta.</p><button className="scan-button" onClick={openScanner}><span className="scan-symbol">⌗</span> Abrir escáner QR <b>→</b></button><small>También puedes buscar por nombre o teléfono</small></div>
            <div className="scanner-visual" aria-hidden="true"><div className="glow-orb" /><div className="qr-frame"><i className="c1"/><i className="c2"/><i className="c3"/><i className="c4"/><div className="qr-grid">▦</div><span className="scan-line" /></div><div className="floating-card member-float"><span className="avatar avatar-photo">AR</span><div><small>CLIENTE DETECTADO</small><strong>Andrea Rojas</strong></div><b>✓</b></div><div className="floating-card stamp-float"><span>✦</span><div><strong>+1 sello</strong><small>Visita registrada</small></div></div></div>
          </section>
          <section className="metrics-grid">
            <article className="metric-card"><div className="metric-icon purple">↙</div><div className="metric-top"><span>Visitas hoy</span><small className="positive">↗ 12%</small></div><strong>86</strong><p>vs. 77 el miércoles pasado</p><div className="spark bars">{[35,50,44,72,62,88,76,100,82,94].map((h,i)=><i key={i} style={{height:`${h}%`}} />)}</div></article>
            <article className="metric-card"><div className="metric-icon lime">♙</div><div className="metric-top"><span>Miembros activos</span><small className="positive">↗ 8 nuevos</small></div><strong>248</strong><p>92% con membresía vigente</p><div className="progress"><i /></div></article>
            <article className="metric-card"><div className="metric-icon coral">✦</div><div className="metric-top"><span>Sellos entregados</span><small>Esta semana</small></div><strong>342</strong><p>41 premios desbloqueados</p><div className="avatar-stack"><span>AR</span><span>JC</span><span>LM</span><span>+38</span></div></article>
          </section>
          <section className="bottom-grid">
            <article className="panel activity-panel"><div className="panel-head"><div><h3>Actividad reciente</h3><p>Movimientos registrados en recepción</p></div><button>Ver todo →</button></div><div className="activity-list">{[{n:"Andrea Rojas",a:"Visita registrada",t:"Hace 2 min",i:"AR",c:"violet"},{n:"Javier Calle",a:"Nuevo sello · Meta de peso",t:"Hace 8 min",i:"JC",c:"orange"},{n:"Lucía Mendoza",a:"Membresía renovada",t:"Hace 21 min",i:"LM",c:"green"}].map(x=><div className="activity" key={x.n}><span className={`avatar ${x.c}`}>{x.i}</span><div><strong>{x.n}</strong><p>{x.a}</p></div><time>{x.t}</time><b>›</b></div>)}</div></article>
            <article className="panel loyalty-panel"><div className="panel-head"><div><h3>Fidelidad en movimiento</h3><p>Progreso general de tus clientes</p></div><button>•••</button></div><div className="loyalty-ring"><div><strong>78%</strong><span>participación</span></div></div><div className="loyalty-stats"><div><span><i className="dot-lime"/>Tarjetas activas</span><strong>194</strong></div><div><span><i className="dot-purple"/>Cerca de premio</span><strong>37</strong></div></div></article>
          </section>
        </div>
      </section>

      {scannerOpen && <div className="modal-layer" role="dialog" aria-modal="true" aria-label="Escáner QR">
        <button className="modal-scrim" aria-label="Cerrar" onClick={() => setScannerOpen(false)} />
        <section className="scanner-modal">
          <header><div><span className="modal-kicker">RECEPCIÓN</span><h2>{scanStep === "success" ? "¡Visita registrada!" : "Escanear tarjeta"}</h2></div><button className="close-button" onClick={() => setScannerOpen(false)}>×</button></header>
          {scanStep === "camera" && <><div className="camera-view"><div className="camera-noise"/><div className="camera-target"><i/><i/><i/><i/><span/></div><div className="camera-tip">Centra el código QR dentro del marco</div></div><button className="demo-scan" onClick={() => setScanStep("found")}>Simular lectura del QR</button><p className="privacy-note">La cámara solo se utiliza durante el escaneo.</p></>}
          {scanStep === "found" && <div className="found-client"><div className="member-hero"><span className="avatar found-avatar">AR</span><span className="verified">✓</span></div><span className="found-label">CLIENTE IDENTIFICADO</span><h3>Andrea Rojas</h3><p>Plan Fuerza · Vigente hasta el 14 sep.</p><div className="stamp-progress"><div className="stamp-copy"><span>Tarjeta de fidelidad</span><strong>7 de 10 sellos</strong></div><div className="stamps">{Array.from({length:10},(_,i)=><i className={i<7?"filled":""} key={i}>{i<7?"M":""}</i>)}</div></div><button className="confirm-visit" onClick={() => setScanStep("success")}>Confirmar visita <span>+1 sello</span></button><button className="text-action" onClick={() => setScanStep("camera")}>Escanear otro código</button></div>}
          {scanStep === "success" && <div className="success-state"><div className="success-burst">✓</div><h3>Andrea suma una nueva visita</h3><p>Su tarjeta ahora tiene <strong>8 de 10 sellos.</strong><br/>Le faltan solo 2 para su recompensa.</p><div className="reward-chip"><span>✦</span><div><small>PRÓXIMA RECOMPENSA</small><strong>1 batido proteico gratis</strong></div></div><button className="confirm-visit" onClick={() => setScannerOpen(false)}>Listo, continuar</button></div>}
        </section>
      </div>}

      {clientOpen && <div className="modal-layer" role="dialog" aria-modal="true" aria-label="Registrar nuevo cliente">
        <button className="modal-scrim" aria-label="Cerrar" onClick={() => setClientOpen(false)} />
        <section className="client-modal"><header><div><span className="modal-kicker">NUEVO MIEMBRO</span><h2>Registra un cliente</h2><p>Su tarjeta digital estará lista al instante.</p></div><button className="close-button" onClick={() => setClientOpen(false)}>×</button></header><form onSubmit={registerClient}>
          <label className="photo-input"><span>＋</span><strong>Añadir foto</strong><small>JPG o PNG · máx. 5 MB</small><input type="file" accept="image/*" aria-label="Fotografía del cliente" /></label>
          <div className="field-grid"><label><span>Nombre completo</span><input required value={client.name} onChange={e=>setClient({...client,name:e.target.value})} placeholder="Ej. Carlos Mendoza" /></label><label><span>WhatsApp</span><input required value={client.phone} onChange={e=>setClient({...client,phone:e.target.value})} placeholder="+591 700 000 00" /></label></div>
          <label className="full-field"><span>Plan de membresía</span><select value={client.plan} onChange={e=>setClient({...client,plan:e.target.value})}><option>Plan Fuerza · Mensual</option><option>Plan Elite · Trimestral</option><option>Plan Monster · Anual</option></select></label>
          <div className="form-note"><span>✦</span><p><strong>Tarjeta de fidelidad incluida</strong><br/>Crearemos un QR único y seguro para este cliente.</p></div>
          <div className="form-actions"><button type="button" onClick={()=>setClientOpen(false)}>Cancelar</button><button type="submit">Crear cliente y tarjeta <span>→</span></button></div>
        </form></section>
      </div>}

      {cardOpen && <div className="modal-layer" role="dialog" aria-modal="true" aria-label="Tarjeta digital creada"><button className="modal-scrim" aria-label="Cerrar" onClick={()=>setCardOpen(false)}/><section className="card-modal"><header><div><span className="modal-kicker">CLIENTE REGISTRADO</span><h2>Su tarjeta está lista</h2></div><button className="close-button" onClick={()=>setCardOpen(false)}>×</button></header><div className="digital-card"><div className="card-top"><div className="mini-brand"><b>M</b><span>MONSTER<br/><small>GYM OS</small></span></div><span className="card-tier">MEMBER</span></div><div className="card-person"><span className="card-photo">{(client.name || "CM").split(" ").map(x=>x[0]).join("").slice(0,2).toUpperCase()}</span><div><small>MIEMBRO</small><strong>{client.name || "Carlos Mendoza"}</strong><p>{client.plan}</p></div></div><div className="card-bottom"><div><small>FIDELIDAD</small><div className="mini-stamps">{Array.from({length:6},(_,i)=><i key={i} className={i===0?"on":""}>{i===0?"M":""}</i>)}</div></div><div className="qr-code">▦</div></div></div><p className="card-help">Puedes descargarla o enviarla directamente al WhatsApp del cliente.</p><div className="share-actions"><button className="download-button" onClick={()=>window.print()}>↓ Descargar PNG</button><a className="whatsapp-button" target="_blank" rel="noreferrer" href={`https://wa.me/${client.phone.replace(/\D/g,"")}?text=${encodeURIComponent(`Hola ${client.name}, aquí tienes tu tarjeta digital de Monster Gym.`)}`}>Enviar por WhatsApp ↗</a></div></section></div>}
    </main>
  );
}
