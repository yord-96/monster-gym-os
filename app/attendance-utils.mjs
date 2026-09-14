export const attendanceDay = value => new Intl.DateTimeFormat("en-CA", {timeZone:"America/La_Paz",year:"numeric",month:"2-digit",day:"2-digit"}).format(new Date(value));
const normalize = value => String(value || "").normalize("NFD").replace(/[\u0300-\u036f]/g,"").toLowerCase();
export function filterAttendance(activities, clients, {period="all",query="",type="all",clientId="",now=new Date()}={}) {
  const today=attendanceDay(now);
  const localDate=new Date(`${today}T12:00:00Z`);
  localDate.setUTCDate(localDate.getUTCDate()-((localDate.getUTCDay()+6)%7));
  const start=period==="today"?today:period==="week"?localDate.toISOString().slice(0,10):period==="month"?`${today.slice(0,7)}-01`:"";
  const byId=new Map(clients.map(client=>[client.id,client]));
  return activities.filter(item=>{
    const day=attendanceDay(item.createdAt);const client=byId.get(item.clientId);
    return (!start||(day>=start&&day<=today))&&(type==="all"||item.type===type)&&(!clientId||item.clientId===clientId)&&normalize(`${item.clientName} ${client?.name||""} ${client?.phone||""} ${client?.plan||""}`).includes(normalize(query.trim()));
  }).sort((a,b)=>b.createdAt.localeCompare(a.createdAt));
}
