"use client";
import { useEffect, useRef, useState } from "react";

type Product = { id:string; name:string; price:number; active:boolean };
type Client = { id:string; name:string; plan:string; balance:number; photo:string; membershipPrice:number; paidAmount:number };
type Receipt = { id:string; kind:string; clientName:string; description:string; amount:number; method:string; voucherUrl:string; note:string; createdAt:string; lines:{name:string;quantity:number;unitPrice:number;total:number}[] };
type Report = { day:string; totals:{total:number;cash:number;qr:number;membership:number;registration:number;sale:number;count:number}; receipts:Receipt[] };
const money = (n:number) => `Bs ${new Intl.NumberFormat("es-BO",{maximumFractionDigits:2}).format(n)}`;
const boliviaDay = () => new Intl.DateTimeFormat("en-CA",{timeZone:"America/La_Paz",year:"numeric",month:"2-digit",day:"2-digit"}).format(new Date());
const kindLabel:Record<string,string> = {membership:"Membresía",registration:"Inscripción",sale:"Tienda"};
async function request<T>(url:string, init?:RequestInit):Promise<T> {
  const response = await fetch(url,{...init,headers:{"Content-Type":"application/json",...init?.headers}});
  const body = await response.json();
  if(!response.ok) throw new Error(body.error || "No se pudo completar la operación.");
  return body;
}
const errorText = (error:unknown) => error instanceof Error ? error.message : "No se pudo completar la operación.";

export function VoucherPicker({value,onChange,disabled=false}:{value:string;onChange:(value:string)=>void;disabled?:boolean}) {
  const [error,setError] = useState("");
  const [loading,setLoading] = useState(false);
  async function read(file?:File) {
    if(!file) return;
    setError(""); setLoading(true);
    const url = URL.createObjectURL(file);
    try {
      if(!["image/jpeg","image/png","image/webp"].includes(file.type)) throw new Error("Elige una imagen JPG, PNG o WEBP.");
      const img = new Image(); img.src=url; await img.decode();
      const scale = Math.min(1,1800/Math.max(img.width,img.height));
      const canvas = document.createElement("canvas"); canvas.width=Math.round(img.width*scale); canvas.height=Math.round(img.height*scale);
      const context = canvas.getContext("2d"); if(!context) throw new Error("No se pudo leer la imagen.");
      context.fillStyle="#fff"; context.fillRect(0,0,canvas.width,canvas.height); context.drawImage(img,0,0,canvas.width,canvas.height);
      onChange(canvas.toDataURL("image/jpeg",.88));
    } catch(error) {setError(errorText(error));} finally { URL.revokeObjectURL(url);setLoading(false); }
  }
  return <div className="cash-voucher"><strong>Voucher del pago</strong>{value&&<img src={value} alt="Voucher seleccionado"/>}<p>{loading?"Procesando imagen…":"Toma una foto o elige una imagen de la galería."}</p><div className="cash-voucher-actions"><label>Tomar foto<input disabled={disabled||loading} type="file" accept="image/jpeg,image/png,image/webp" capture="environment" onChange={e=>{void read(e.target.files?.[0]);e.target.value="";}}/></label><label>Elegir imagen<input disabled={disabled||loading} type="file" accept="image/jpeg,image/png,image/webp" onChange={e=>{void read(e.target.files?.[0]);e.target.value="";}}/></label></div>{value&&<button type="button" disabled={disabled||loading} onClick={()=>onChange("")}>Quitar imagen</button>}{error&&<p role="alert" className="cash-error">{error}</p>}</div>;
}

export function StoreView() {
  const [products,setProducts] = useState<Product[]>([]);
  const [loading,setLoading] = useState(true);
  const [error,setError] = useState("");
  const [form,setForm] = useState<{id?:string;name:string;price:string;active:boolean}|null>(null);
  const [busy,setBusy] = useState(false);
  async function load(){setLoading(true);try{const data=await request<{products:Product[]}>("/api/store/products");setProducts(data.products);setError("");}catch(e){setError(errorText(e));}finally{setLoading(false);}}
  useEffect(()=>{const controller=new AbortController();void request<{products:Product[]}>("/api/store/products",{signal:controller.signal}).then(data=>{if(!controller.signal.aborted)setProducts(data.products);}).catch(e=>{if(!controller.signal.aborted)setError(errorText(e));}).finally(()=>{if(!controller.signal.aborted)setLoading(false);});return()=>controller.abort();},[]);
  async function save(e:React.FormEvent){e.preventDefault();if(!form||busy)return;setBusy(true);setError("");try{const data=await request<{product:Product}>(`/api/store/products${form.id?`/${form.id}`:""}`,{method:form.id?"PUT":"POST",body:JSON.stringify({...form,price:Number(form.price)})});setProducts(old=>[...old.filter(p=>p.id!==data.product.id),data.product]);setForm(null);}catch(e){setError(errorText(e));}finally{setBusy(false);}}
  return <section className="commerce-page"><div className="commerce-heading"><div><h1>Tienda</h1><p>Artículos y precios. Registra las ventas en Cobros.</p></div><button className="cash-primary" onClick={()=>setForm({name:"",price:"",active:true})}>＋ Artículo</button></div>{error&&<p className="cash-error" role="alert">{error}<button onClick={()=>void load()}>Reintentar</button></p>}{form&&<form className="cash-panel cash-product-form" onSubmit={save}><h2>{form.id?"Editar artículo":"Nuevo artículo"}</h2><label>Nombre<input required maxLength={100} value={form.name} onChange={e=>setForm({...form,name:e.target.value})}/></label><label>Precio (Bs)<input required type="number" min="0.01" max="1000000" step="0.01" value={form.price} onChange={e=>setForm({...form,price:e.target.value})}/></label><label className="cash-check"><input type="checkbox" checked={form.active} onChange={e=>setForm({...form,active:e.target.checked})}/>Disponible para vender</label><div className="cash-actions"><button type="button" disabled={busy} onClick={()=>setForm(null)}>Cancelar</button><button className="cash-primary" disabled={busy}>{busy?"Guardando…":"Guardar artículo"}</button></div></form>}{loading?<p>Cargando tienda…</p>:<div className="cash-products">{products.map(p=><article className="cash-panel" key={p.id}><span className={`cash-status ${p.active?"":"inactive"}`}>{p.active?"Disponible":"Inactivo"}</span><h2>{p.name}</h2><strong className="cash-price">{money(p.price)}</strong><button onClick={()=>setForm({id:p.id,name:p.name,price:String(p.price),active:p.active})}>Editar artículo</button></article>)}</div>}{!loading&&!products.length&&<div className="cash-panel cash-empty"><h2>Tu tienda está lista</h2><p>Añade el primer artículo con su precio.</p></div>}</section>;
}

export function BillingView({clients,qrUrl,onPay,onRenew,onQrFile,qrSaving,qrError}:{clients:Client[];qrUrl:string;onPay:(id:string)=>void;onRenew:(id:string)=>void;onQrFile:(event:React.ChangeEvent<HTMLInputElement>)=>void;qrSaving:boolean;qrError:string}) {
  const [tab,setTab] = useState("membership");
  const [query,setQuery] = useState("");
  const [products,setProducts] = useState<Product[]>([]);
  const [cart,setCart] = useState<Record<string,number>>({});
  const [clientId,setClientId] = useState("");
  const [amount,setAmount] = useState("");
  const [method,setMethod] = useState("qr");
  const [voucher,setVoucher] = useState("");
  const [note,setNote] = useState("");
  const [busy,setBusy] = useState(false);
  const [error,setError] = useState("");
  const [success,setSuccess] = useState<Receipt|null>(null);
  const requestKey = useRef("");
  const submitting = useRef(false);
  async function loadProducts(){try{const data=await request<{products:Product[]}>("/api/store/products");setProducts(data.products);setError("");}catch(e){setError(errorText(e));}}
  useEffect(()=>{const controller=new AbortController();void request<{products:Product[]}>("/api/store/products",{signal:controller.signal}).then(data=>{if(!controller.signal.aborted)setProducts(data.products);}).catch(e=>{if(!controller.signal.aborted)setError(errorText(e));});return()=>controller.abort();},[]);
  const debt = clients.filter(c=>c.balance>0);
  const saleCents=products.reduce((sum,p)=>sum+Math.round(p.price*100)*(cart[p.id]||0),0);
  function changeTab(next:string){setTab(next);setError("");setSuccess(null);requestKey.current="";setVoucher("");setCart({});setClientId("");setAmount("");setNote("");}
  async function submit(e:React.FormEvent){e.preventDefault();if(submitting.current)return;submitting.current=true;setBusy(true);setError("");setSuccess(null);requestKey.current ||= crypto.randomUUID();try{const result=await request<{receipt:Receipt}>("/api/cash/receipts",{method:"POST",body:JSON.stringify({requestKey:requestKey.current,kind:tab,clientId,amount:Number(amount),method,note,voucherImage:voucher,items:products.filter(p=>cart[p.id]>0).map(p=>({productId:p.id,quantity:cart[p.id],unitPrice:p.price}))})});setSuccess(result.receipt);setCart({});setAmount("");setVoucher("");setNote("");requestKey.current="";}catch(e){setError(errorText(e));}finally{setBusy(false);submitting.current=false;}}
  return <section className="commerce-page"><div className="commerce-heading"><div><h1>Cobros</h1><p>Membresías, inscripciones y ventas en una sola caja.</p></div></div><div className="cash-metrics"><article><span>Saldo por cobrar</span><strong>{money(debt.reduce((sum,c)=>sum+c.balance,0))}</strong><small>{debt.length} clientes pendientes</small></article><article><span>Miembros</span><strong>{clients.length}</strong><small>En la base central</small></article><article><span>{qrUrl?"QR disponible":"Falta cargar QR"}</span><strong>QR</strong><small>{qrUrl?"Listo para cobrar":"Añádelo debajo"}</small></article></div>
    <div className="cash-layout"><div><div className="cash-tabs" aria-label="Tipo de cobro">{[["membership","Planes"],["registration","Inscripción"],["sale","Tienda"]].map(([id,label])=><button disabled={busy} aria-pressed={tab===id} key={id} onClick={()=>changeTab(id)}>{label}</button>)}</div>
    {tab==="membership"?<div className="cash-panel"><h2>Cobrar membresía</h2><p>Busca al cliente para cobrar su saldo o renovar su plan.</p><label className="cash-search">Buscar cliente<input value={query} onChange={e=>setQuery(e.target.value)} placeholder="Nombre o plan"/></label><div className="cash-client-list">{clients.filter(c=>`${c.name} ${c.plan}`.toLowerCase().includes(query.toLowerCase())).map(c=><article key={c.id}><div><strong>{c.name}</strong><small>{c.plan} · {c.balance>0?`${money(c.balance)} pendiente`:"Sin saldo pendiente"}</small></div><button onClick={()=>c.balance>0?onPay(c.id):onRenew(c.id)}>{c.balance>0?"Cobrar":"Renovar"}</button></article>)}</div>{!clients.length&&<p>Registra primero al cliente desde Clientes.</p>}</div>:<form className="cash-panel cash-checkout" onSubmit={submit}><h2>{tab==="sale"?"Venta de tienda":"Cobrar inscripción"}</h2><p>{tab==="sale"?"Elige artículos y cantidades. El precio se valida al registrar.":"Cargo independiente del plan. Este cobro no renueva la membresía."}</p><fieldset disabled={busy}><label>Cliente {tab==="sale"?"(opcional)":""}<select required={tab==="registration"} value={clientId} onChange={e=>setClientId(e.target.value)}><option value="">{tab==="sale"?"Venta de mostrador":"Seleccionar cliente"}</option>{clients.map(c=><option value={c.id} key={c.id}>{c.name}</option>)}</select></label>
    {tab==="sale"?<><div className="cash-cart">{products.filter(p=>p.active).map(p=><label key={p.id}><span>{p.name}<small>{money(p.price)} / unidad</small></span><input aria-label={`Cantidad de ${p.name}`} type="number" min="0" max="999" step="1" value={cart[p.id]||0} onChange={e=>setCart({...cart,[p.id]:Number(e.target.value)})}/></label>)}</div>{!products.some(p=>p.active)&&<p>Crea artículos disponibles en Tienda para vender.</p>}<button type="button" onClick={()=>void loadProducts()}>Actualizar artículos y precios</button></>:<label>Monto de inscripción (Bs)<input required type="number" min="0.01" max="1000000" step="0.01" value={amount} onChange={e=>setAmount(e.target.value)}/></label>}
    <div className="cash-total"><span>Total a cobrar</span><strong>{money(tab==="sale"?saleCents/100:Number(amount)||0)}</strong></div><div className="cash-tabs" aria-label="Método de pago">{["qr","cash"].map(m=><button type="button" key={m} aria-pressed={method===m} onClick={()=>setMethod(m)}>{m==="qr"?"▦ QR":"Bs Efectivo"}</button>)}</div><div className="cash-evidence">{method==="qr"&&<div className="cash-qr-preview"><strong>QR del gimnasio</strong>{qrUrl?<img src={qrUrl} alt="QR de cobro del gimnasio"/>:<p>Carga el QR oficial para mostrarlo al cliente.</p>}</div>}<VoucherPicker value={voucher} onChange={setVoucher} disabled={busy}/></div><p className="cash-hint">{method==="qr"?"El voucher es obligatorio para un cobro QR.":"En efectivo, la foto del comprobante es opcional."}</p><label>Nota opcional<input maxLength={500} value={note} onChange={e=>setNote(e.target.value)} placeholder="Detalle del cobro"/></label></fieldset><button className="cash-primary cash-submit" disabled={busy||(method==="qr"&&!voucher)||(tab==="sale"&&saleCents===0)}>{busy?"Registrando…":"✓ Registrar cobro"}</button></form>}
    {error&&<p className="cash-error" role="alert">{error}</p>}{success&&<div className="cash-success" role="status"><strong>Cobro registrado: {money(success.amount)}</strong><p>{success.description} · {success.clientName}. Disponible en Reportes.</p></div>}</div>
    <aside><details className="cash-panel cash-qr-settings" open={!qrUrl}><summary>QR de cobro del gimnasio <span>{qrUrl?"Ver / reemplazar":"Configurar"}</span></summary>{qrUrl?<img src={qrUrl} alt="QR oficial del gimnasio"/>:<p>Añade el QR que recibirán tus clientes al pagar.</p>}<label className="cash-upload">{qrSaving?"Guardando…":qrUrl?"Reemplazar QR":"Subir QR"}<input disabled={qrSaving} type="file" accept="image/png,image/jpeg,image/webp" onChange={onQrFile}/></label>{qrError&&<p className="cash-error" role="alert">{qrError}</p>}</details><article className="cash-panel"><h2>Saldos pendientes</h2><p>{debt.length} clientes con pago incompleto</p><div className="cash-client-list">{debt.sort((a,b)=>b.balance-a.balance).map(c=><button className="cash-debt" key={c.id} onClick={()=>onPay(c.id)}><span>{c.name}<small>{c.plan}</small></span><b>{money(c.balance)} ›</b></button>)}</div>{!debt.length&&<p>Todos los planes están al día.</p>}</article></aside></div></section>;
}

export function DailyReports() {
  const [day,setDay] = useState(boliviaDay);
  const [report,setReport] = useState<Report|null>(null);
  const [error,setError] = useState("");
  const [loading,setLoading] = useState(true);
  const [revision,setRevision] = useState(0);
  function refresh(next=day){setLoading(true);setReport(null);setError("");setDay(next);setRevision(n=>n+1);}
  useEffect(()=>{const controller=new AbortController();void request<Report>(`/api/reports/daily?date=${encodeURIComponent(day)}`,{signal:controller.signal}).then(data=>{if(!controller.signal.aborted)setReport(data);}).catch(e=>{if(!controller.signal.aborted)setError(errorText(e));}).finally(()=>{if(!controller.signal.aborted)setLoading(false);});return()=>controller.abort();},[day,revision]);
  return <section className="commerce-page"><div className="commerce-heading"><div><h1>Reportes</h1><p>Ingresos cobrados y vouchers · hora de Bolivia.</p></div></div><div className="cash-panel cash-report-filter"><label>Fecha<input type="date" required value={day} onChange={e=>{if(e.target.value)refresh(e.target.value);}}/></label><button onClick={()=>{refresh(boliviaDay());}}>Hoy</button><button onClick={()=>refresh()}>Actualizar</button></div>{loading&&<p>Cargando ingresos…</p>}{error&&<p role="alert" className="cash-error">{error}</p>}{report&&<><div className="cash-metrics"><article><span>Ingresos del día</span><strong>{money(report.totals.total)}</strong><small>{report.totals.count} operaciones</small></article><article><span>Efectivo</span><strong>{money(report.totals.cash)}</strong></article><article><span>QR</span><strong>{money(report.totals.qr)}</strong></article></div><div className="cash-breakdown">{["membership","registration","sale"].map(kind=><div key={kind}><span>{kindLabel[kind]}</span><strong>{money(report.totals[kind as "membership"|"registration"|"sale"])}</strong></div>)}</div><div className="cash-receipts">{report.receipts.map(r=><article className="cash-panel cash-receipt" key={r.id}><header><div><span className="cash-status">{kindLabel[r.kind]} · {r.method==="qr"?"QR":"Efectivo"}</span><h2>{r.clientName}</h2><p>{r.description}</p></div><strong>{money(r.amount)}</strong></header><time dateTime={r.createdAt}>{new Intl.DateTimeFormat("es-BO",{timeZone:"America/La_Paz",hour:"2-digit",minute:"2-digit",second:"2-digit"}).format(new Date(r.createdAt))}</time>{r.note&&<p>{r.note}</p>}{r.lines.length>0&&<ul>{r.lines.map((line,i)=><li key={i}>{line.quantity} × {line.name} · {money(line.unitPrice)} = <b>{money(line.total)}</b></li>)}</ul>}{r.voucherUrl?<details className="cash-receipt-voucher"><summary>Ver voucher</summary><a href={r.voucherUrl} target="_blank" rel="noreferrer"><img loading="lazy" src={r.voucherUrl} alt={`Voucher de ${r.clientName} por ${money(r.amount)}`}/><span>Abrir imagen completa ↗</span></a></details>:<small>Sin voucher · pago en efectivo</small>}</article>)}</div>{!report.receipts.length&&<div className="cash-panel cash-empty"><h2>Sin cobros en esta fecha</h2><p>Los pagos de planes, inscripciones y ventas aparecerán aquí.</p></div>}</>}</section>;
}
