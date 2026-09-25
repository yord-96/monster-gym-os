import type { Ref } from "react";

export const cardAnimals = ["bear", "lion", "tiger", "wolf", "gorilla", "bull"] as const;
type Member = { name:string; token:string; photo:string; plan:string; expiresAt:string; accessStatus:string; cardVariant?:number; gender?:"male"|"female"|null };

export function MembershipCard({client, qr, cardRef}: {client:Member; qr:string; cardRef?:Ref<HTMLDivElement>}) {
  const animal = cardAnimals[client.cardVariant ?? 0] ?? cardAnimals[0];
  const hasAnimal = client.gender === "male";
  const active = client.accessStatus === "active";
  const status:Record<string,string> = {active:"MIEMBRO ACTIVO",expired:"PLAN VENCIDO",debt_suspended:"PAGO PENDIENTE",manual_suspended:"SUSPENDIDO",sessions_exhausted:"SESIONES AGOTADAS"};
  const expiry = new Intl.DateTimeFormat("es-BO", {day:"2-digit",month:"short",year:"numeric",timeZone:"America/La_Paz"}).format(new Date(client.expiresAt)).replaceAll(".", "");
  return <div className="membership-card-frame">
    <div className={`membership-card ${hasAnimal ? "membership-animal" : "membership-gym"}`} ref={cardRef} data-animal={hasAnimal ? animal : undefined}>
      <img className="membership-watermark" src={hasAnimal ? `/card-animals/optimized/${animal}-v2.webp` : "/card-backgrounds/gym-lime-v1.webp"} loading={cardRef ? "eager" : "lazy"} decoding="async" width="600" height="600" alt="" aria-hidden="true"/>
      <header className="membership-heading">
        <div className="membership-brand"><b>M</b><span>MONSTERS<small>GYM</small></span></div>
        <p className="membership-motto">DISCIPLINA HOY,<br/>RESULTADOS SIEMPRE</p>
        <span className={`membership-status ${active?"is-active":"is-inactive"}`}><i/>{status[client.accessStatus] ?? "MEMBRESÍA"}</span>
      </header>
      <div className="membership-person">
        {client.photo ? <img className="membership-photo" loading={cardRef ? "eager" : "lazy"} decoding="async" src={client.photo} alt={`Foto de ${client.name}`}/> : <span className="membership-photo membership-initials">{client.name.split(/\s+/).map(n=>n[0]).slice(0,2).join("")}</span>}
        <div><small>MIEMBRO</small><strong>{client.name}</strong><span className="membership-id">♙ ID {client.token.slice(0,8).toUpperCase()}</span></div>
      </div>
      <div className="membership-lower">
        <div className="membership-details">
          <div className="membership-rule"/>
          <p className="membership-slogan">NO EXCUSES<strong>JUST EVOLUTION</strong></p>
          <div className="membership-facts"><div><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true"><path d="M2 9v6m4-10v14M6 12h12m0-7v14m4-10v6"/></svg><p><small>PLAN</small><strong>{client.plan}</strong></p></div><div><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true"><rect x="3" y="5" width="18" height="16" rx="2"/><path d="M7 2v6m10-6v6M3 11h18m-14 4h3m4 0h3"/></svg><p><small>VENCE</small><strong>{expiry}</strong></p></div></div>
          <p className="membership-personal">▣ PERSONAL E INTRANSFERIBLE</p>
        </div>
        <div className="membership-qr-panel"><div className="membership-qr">{qr ? <img src={qr} loading={cardRef ? "eager" : "lazy"} decoding="async" alt={`QR único de ${client.name}`}/> : <span>Preparando QR…</span>}</div><p><span aria-hidden="true">⌗</span>ESCANEA PARA<br/>REGISTRAR INGRESO</p></div>
      </div>
    </div>
  </div>;
}
