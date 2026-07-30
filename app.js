/* ============================================================
   Cuenta Corriente NTL — datos compartidos en Supabase
   - Lectura pública (RLS). Escritura con clave (funciones RPC).
   - Tiempo real: los cambios de otros se ven al instante.
   - Respaldo offline: si no hay conexión, muestra la última copia.
   ============================================================ */

const PROVEEDORES = ['Ownland', 'Frontier'];   // el resto = cuenta corriente
const CACHE_KEY = 'ctantl_cache_v2';
const CLAVE_KEY = 'ctantl_clave';

let sb = null;                 // cliente supabase
let state = { cuentas:{}, proveedores:{} };
let clave = null;              // clave de escritura (en memoria)
let currentTab = 'Resumen';
let dirty = false;             // hay datos nuevos por renderizar (modal abierto)
let offline = false;

/* ---------- Utilidades ---------- */
const num = v => (v === null || v === undefined || v === '') ? 0 : Number(v);
const round2 = n => Math.round(n*100)/100;
function fmt(v){ return num(v).toLocaleString('es-AR',{minimumFractionDigits:2,maximumFractionDigits:2}); }
function fmtCell(v){ if (v===null||v===undefined||v===''||Number(v)===0) return ''; return fmt(v); }
function esc(s){ if (s===null||s===undefined) return ''; return String(s).replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c])); }
function toDisplayDate(d){ const m=/^(\d{4})-(\d{2})-(\d{2})$/.exec(d||''); return m?`${m[3]}/${m[2]}/${m[1]}`:(d||''); }
function dateKey(d){ return /^(\d{4})-(\d{2})-(\d{2})$/.test(d||'')?d:''; }
function toast(msg){ const t=document.getElementById('toast'); t.textContent=msg; t.hidden=false; clearTimeout(t._t); t._t=setTimeout(()=>t.hidden=true,2600); }
function today(){ const d=new Date(); return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`; }

const EMPRESAS = ['D','TN','CH','Tierra'];
const TIPOS = [{v:'',l:'—'},{v:'T',l:'T · Transferencia'},{v:'G',l:'G · Gasto/Comisión'},{v:'DEV',l:'DEV · Devolución'}];

/* ---------- Saldo acumulado ---------- */
function computeSaldos(movs){ let s=0; const out=[]; for(const m of movs){ s+=num(m.creditos)-num(m.debitos); out.push(round2(s)); } return out; }

/* ============================================================
   CONEXIÓN / DATOS
   ============================================================ */
function setConn(st){
  const el=document.getElementById('conn-status');
  if(st==='ok'){ el.className='pill pill-ok'; el.textContent='Conectado'; offline=false; }
  else if(st==='wait'){ el.className='pill pill-wait'; el.textContent='Conectando…'; }
  else { el.className='pill pill-off'; el.textContent='Sin conexión'; offline=true; }
}
function cacheSave(st){ try{ localStorage.setItem(CACHE_KEY, JSON.stringify(st)); }catch(e){} }
function cacheLoad(){ try{ return JSON.parse(localStorage.getItem(CACHE_KEY)); }catch(e){ return null; } }

function buildState(movRows, pendRows){
  const st={cuentas:{},proveedores:{}};
  ['NTL','CH'].forEach(k=>st.cuentas[k]={nombre:k,movimientos:[],pendientes:[]});
  PROVEEDORES.forEach(k=>st.proveedores[k]={nombre:k,movimientos:[],pendientes:[]});
  const ensure=(c)=>{
    const bucket = PROVEEDORES.includes(c)?st.proveedores:st.cuentas;
    if(!bucket[c]) bucket[c]={nombre:c,movimientos:[],pendientes:[]};
    return bucket[c];
  };
  for(const r of (movRows||[])) ensure(r.cuenta).movimientos.push(r);
  for(const r of (pendRows||[])){ const c=st.cuentas[r.cuenta]||ensure(r.cuenta); c.pendientes.push(r); }
  const byOrden=(a,b)=>num(a.orden)-num(b.orden);
  Object.values(st.cuentas).forEach(a=>a.movimientos.sort(byOrden));
  Object.values(st.proveedores).forEach(a=>a.movimientos.sort(byOrden));
  return st;
}

async function fetchAll(){
  const [mov,pend]=await Promise.all([
    sb.from('cc_movimientos').select('*'),
    sb.from('cc_pendientes').select('*'),
  ]);
  if(mov.error) throw mov.error;
  if(pend.error) throw pend.error;
  return buildState(mov.data, pend.data);
}

let refreshTimer=null;
function scheduleRefresh(){ clearTimeout(refreshTimer); refreshTimer=setTimeout(refresh,300); }
async function refresh(){
  if(!sb) return;
  try{
    const st=await fetchAll(); state=st; cacheSave(st); setConn('ok');
    if(isAnyModalOpen()) dirty=true; else render();
  }catch(e){ setConn('off'); }
}

/* ---------- RPC (escritura) ---------- */
async function rpc(fn,args){ const {data,error}=await sb.rpc(fn,args); if(error) throw error; return data; }
function esErrorClave(e){ return /clave/i.test((e&&e.message)||''); }
async function conClave(fn){
  const c=await ensureClave(); if(!c) return false;
  try{ await fn(c); return true; }
  catch(e){
    if(esErrorClave(e)){ setClave(null); toast('Clave incorrecta'); openClaveModal('unlock'); }
    else { alert('No se pudo guardar: '+((e&&e.message)||e)); }
    return false;
  }
}

/* ============================================================
   RENDER
   ============================================================ */
function renderTabs(){
  const tabs=['Resumen',...Object.keys(state.cuentas),...Object.keys(state.proveedores)];
  const nav=document.getElementById('tabs');
  nav.innerHTML=tabs.map(t=>`<button class="tab ${t===currentTab?'active':''}" data-tab="${esc(t)}">${esc(tabLabel(t))}</button>`).join('');
  nav.querySelectorAll('.tab').forEach(b=>b.onclick=()=>{currentTab=b.dataset.tab; render();});
}
function tabLabel(t){ if(t==='Resumen') return '📊 Resumen'; if(state.cuentas[t]) return '💵 Cuenta '+t; return '🏭 '+t; }

function render(){
  dirty=false;
  renderTabs();
  const main=document.getElementById('main');
  const banner = offline ? `<div class="banner">Sin conexión con Supabase — mostrando la última copia guardada. Los cambios no se guardarán hasta reconectar.</div>` : '';
  if(currentTab==='Resumen') main.innerHTML=banner+viewResumen();
  else if(state.cuentas[currentTab]){ main.innerHTML=banner; renderCuenta(main,currentTab,true); }
  else { main.innerHTML=banner; renderProveedor(main,currentTab,true); }
  bindViewEvents();
}

const filters={};
function getFilter(key){ if(!filters[key]) filters[key]={q:'',empresa:'',tipo:'',desde:'',hasta:''}; return filters[key]; }

/* ---------- Cuenta corriente ---------- */
function renderCuenta(main,key,append){
  const acc=state.cuentas[key];
  const movs=acc.movimientos;
  const saldos=computeSaldos(movs);
  const f=getFilter(key);
  const totIng=round2(movs.reduce((a,m)=>a+num(m.creditos),0));
  const totEgr=round2(movs.reduce((a,m)=>a+num(m.debitos),0));
  const saldoActual=saldos.length?saldos[saldos.length-1]:0;
  const visible=movs.map((m,i)=>({m,saldo:saldos[i]})).filter(({m})=>matchFilter(m,f));
  const empOpts=uniqueVals(movs,'empresa'), tipoOpts=uniqueVals(movs,'tipo');

  const html=`
    <div class="cards">
      <div class="card"><div class="k">Saldo actual</div><div class="v ${saldoActual<0?'neg':'pos'}">${fmt(saldoActual)}</div></div>
      <div class="card"><div class="k">Ingresos (créditos)</div><div class="v pos">${fmt(totIng)}</div></div>
      <div class="card"><div class="k">Egresos (débitos)</div><div class="v neg">${fmt(totEgr)}</div></div>
      <div class="card"><div class="k">Movimientos</div><div class="v">${movs.length}</div></div>
    </div>
    ${breakdownTable(movs)}
    <div class="toolbar">
      <input class="grow" id="f-q" placeholder="🔎 Buscar descripción, origen/destino, referencia…" value="${esc(f.q)}">
      <select id="f-empresa"><option value="">Empresa: todas</option>${empOpts.map(e=>`<option ${f.empresa===e?'selected':''}>${esc(e)}</option>`).join('')}</select>
      <select id="f-tipo"><option value="">Tipo: todos</option>${tipoOpts.map(e=>`<option ${f.tipo===e?'selected':''}>${esc(e)}</option>`).join('')}</select>
      <input type="date" id="f-desde" value="${esc(f.desde)}" title="Desde">
      <input type="date" id="f-hasta" value="${esc(f.hasta)}" title="Hasta">
      <button class="btn ghost sm" id="f-clear">Limpiar</button>
      <div class="spacer"></div>
      <button class="btn ghost sm" id="btn-sort">↕ Ordenar por fecha</button>
      <button class="btn ghost sm" id="btn-csv">⬇ CSV</button>
      <button class="btn primary" id="btn-add">＋ Nuevo movimiento</button>
    </div>
    <div class="count">${visible.length} de ${movs.length} movimientos${(f.q||f.empresa||f.tipo||f.desde||f.hasta)?' (filtrados)':''}</div>
    <div class="table-wrap"><table><thead><tr>
      <th>Fecha</th><th>Descripción</th><th class="num">Débitos</th><th class="num">Créditos</th>
      <th class="num">Saldo</th><th>Origen / Destino</th><th>Referencia</th><th>Empresa</th><th>Tipo</th><th></th>
    </tr></thead><tbody>
      ${visible.length?visible.map(({m,saldo})=>rowCuenta(m,saldo)).join(''):`<tr><td colspan="10" class="empty">Sin movimientos que coincidan.</td></tr>`}
    </tbody></table></div>
    ${pendientesSection(acc,key)}
    <p class="legend"><b>Empresa:</b> D = Damián · TN / Tierra / CH según origen de fondos.
      &nbsp;<b>Tipo:</b> T = Transferencia · G = Gasto/Comisión · DEV = Devolución.
      El <b>Saldo</b> se calcula solo (saldo anterior + créditos − débitos).</p>`;
  if(append) main.insertAdjacentHTML('beforeend',html); else main.innerHTML=html;
}

function rowCuenta(m,saldo){
  return `<tr>
    <td class="muted">${esc(toDisplayDate(m.fecha))}</td>
    <td>${esc(m.descripcion)}</td>
    <td class="num deb">${fmtCell(m.debitos)}</td>
    <td class="num cred">${fmtCell(m.creditos)}</td>
    <td class="num ${saldo<0?'saldo-neg':'saldo-pos'}">${fmt(saldo)}</td>
    <td class="muted">${esc(m.origen)}</td>
    <td>${esc(m.referencia)}</td>
    <td>${m.empresa?`<span class="tag emp-${esc(m.empresa)}">${esc(m.empresa)}</span>`:''}</td>
    <td>${m.tipo?`<span class="tag tipo-${esc(m.tipo)}">${esc(m.tipo)}</span>`:''}</td>
    <td><div class="rowact">
      <button class="iconbtn" data-edit="${m.id}" title="Editar">✎</button>
      <button class="iconbtn del" data-del="${m.id}" title="Eliminar">🗑</button>
    </div></td></tr>`;
}

function breakdownTable(movs){
  const emps=uniqueVals(movs,'empresa').filter(Boolean);
  if(!emps.length) return '';
  const rows=emps.map(e=>{
    const sub=movs.filter(m=>m.empresa===e);
    const ing=round2(sub.reduce((a,m)=>a+num(m.creditos),0));
    const transf=round2(sub.filter(m=>m.tipo==='T').reduce((a,m)=>a+num(m.debitos),0));
    const gasto=round2(sub.filter(m=>m.tipo==='G').reduce((a,m)=>a+num(m.debitos),0));
    const otros=round2(sub.filter(m=>m.tipo!=='T'&&m.tipo!=='G').reduce((a,m)=>a+num(m.debitos),0));
    const saldo=round2(ing-transf-gasto-otros);
    return `<tr><td><span class="tag emp-${esc(e)}">${esc(e)}</span></td>
      <td class="num cred">${fmt(ing)}</td><td class="num">${fmt(transf)}</td>
      <td class="num deb">${fmt(gasto)}</td><td class="num ${saldo<0?'saldo-neg':''}">${fmt(saldo)}</td></tr>`;
  }).join('');
  return `<div class="section-title">Desglose por empresa</div>
    <div class="table-wrap"><table style="min-width:520px"><thead><tr>
      <th>Empresa</th><th class="num">Ingresos</th><th class="num">Transferencias</th>
      <th class="num">Gastos</th><th class="num">Saldo</th></tr></thead><tbody>${rows}</tbody></table></div>`;
}

function pendientesSection(acc,key){
  const p=acc.pendientes||[];
  const rows=p.map(m=>`<tr>
    <td>${esc(m.descripcion)}</td><td class="muted">${esc(m.categoria)}</td>
    <td class="num cred">${fmtCell(m.creditos)}</td><td class="num deb">${fmtCell(m.debitos)}</td>
    <td>${m.empresa?`<span class="tag emp-${esc(m.empresa)}">${esc(m.empresa)}</span>`:''}</td>
    <td><div class="rowact">
      <button class="iconbtn" data-pedit="${m.id}" title="Editar">✎</button>
      <button class="iconbtn del" data-pdel="${m.id}" title="Eliminar">🗑</button>
    </div></td></tr>`).join('');
  const total=round2(p.reduce((a,m)=>a+num(m.creditos)-num(m.debitos),0));
  return `<div class="section-title">🔖 Pendientes de recupero <span class="count">(no afectan el saldo · total ${fmt(total)})</span>
      <button class="btn ghost sm" id="btn-add-pend" style="margin-left:auto">＋ Agregar pendiente</button></div>
    <div class="table-wrap"><table style="min-width:560px"><thead><tr>
      <th>Descripción</th><th>Categoría</th><th class="num">A recuperar</th><th class="num">Débito</th><th>Empresa</th><th></th>
    </tr></thead><tbody>${rows||`<tr><td colspan="6" class="empty">Sin pendientes.</td></tr>`}</tbody></table></div>`;
}

/* ---------- Proveedor ---------- */
function renderProveedor(main,key,append){
  const acc=state.proveedores[key];
  const movs=acc.movimientos;
  const f=getFilter(key);
  const totDeb=round2(movs.reduce((a,m)=>a+num(m.debitos),0));
  const totCred=round2(movs.reduce((a,m)=>a+num(m.creditos),0));
  const visible=movs.filter(m=>matchFilterProv(m,f));
  const html=`
    <div class="cards">
      <div class="card"><div class="k">Total débitos</div><div class="v neg">${fmt(totDeb)}</div></div>
      <div class="card"><div class="k">Total créditos</div><div class="v pos">${fmt(totCred)}</div></div>
      <div class="card"><div class="k">Neto (créd − déb)</div><div class="v ${totCred-totDeb<0?'neg':'pos'}">${fmt(round2(totCred-totDeb))}</div></div>
      <div class="card"><div class="k">Movimientos</div><div class="v">${movs.length}</div></div>
    </div>
    <div class="toolbar">
      <input class="grow" id="f-q" placeholder="🔎 Buscar por 'salido por', 'a través de', 'fue a'…" value="${esc(f.q)}">
      <button class="btn ghost sm" id="f-clear">Limpiar</button>
      <div class="spacer"></div>
      <button class="btn ghost sm" id="btn-csv">⬇ CSV</button>
      <button class="btn primary" id="btn-add">＋ Nuevo movimiento</button>
    </div>
    <div class="count">${visible.length} de ${movs.length} movimientos</div>
    <div class="table-wrap"><table><thead><tr>
      <th>Fecha</th><th class="num">Débitos</th><th class="num">Créditos</th><th class="num">Saldo</th>
      <th>Salido por</th><th>A través de</th><th>Fue a</th><th></th>
    </tr></thead><tbody>
      ${visible.length?visible.map(m=>`<tr>
        <td class="muted">${esc(toDisplayDate(m.fecha))}</td>
        <td class="num deb">${fmtCell(m.debitos)}</td><td class="num cred">${fmtCell(m.creditos)}</td>
        <td class="num">${fmtCell(m.saldo)}</td>
        <td>${esc(m.salidopor)}</td><td>${esc(m.atraves)}</td><td>${esc(m.fuea)}</td>
        <td><div class="rowact">
          <button class="iconbtn" data-edit="${m.id}" title="Editar">✎</button>
          <button class="iconbtn del" data-del="${m.id}" title="Eliminar">🗑</button>
        </div></td></tr>`).join(''):`<tr><td colspan="8" class="empty">Sin movimientos.</td></tr>`}
    </tbody></table></div>`;
  if(append) main.insertAdjacentHTML('beforeend',html); else main.innerHTML=html;
}

/* ---------- Resumen ---------- */
function viewResumen(){
  const blocks=Object.entries(state.cuentas).map(([key,acc])=>{
    const s=computeSaldos(acc.movimientos); const saldo=s.length?s[s.length-1]:0;
    const ing=round2(acc.movimientos.reduce((a,m)=>a+num(m.creditos),0));
    const egr=round2(acc.movimientos.reduce((a,m)=>a+num(m.debitos),0));
    return {key,saldo,ing,egr,n:acc.movimientos.length};
  });
  const totSaldo=round2(blocks.reduce((a,b)=>a+b.saldo,0));
  const cards=blocks.map(b=>`<div class="card">
    <div class="k">Cuenta ${esc(b.key)} · saldo</div>
    <div class="v ${b.saldo<0?'neg':'pos'}">${fmt(b.saldo)}</div>
    <div class="count" style="margin-top:6px">Ing ${fmt(b.ing)} · Egr ${fmt(b.egr)} · ${b.n} mov.</div></div>`).join('');
  const provRows=Object.entries(state.proveedores).map(([key,acc])=>{
    const deb=round2(acc.movimientos.reduce((a,m)=>a+num(m.debitos),0));
    const cred=round2(acc.movimientos.reduce((a,m)=>a+num(m.creditos),0));
    return `<tr><td>${esc(key)}</td><td class="num deb">${fmt(deb)}</td>
      <td class="num cred">${fmt(cred)}</td><td class="num">${fmt(round2(cred-deb))}</td><td class="num">${acc.movimientos.length}</td></tr>`;
  }).join('');
  return `
    <div class="cards">${cards}
      <div class="card"><div class="k">Saldo total (cuentas)</div><div class="v ${totSaldo<0?'neg':'pos'}">${fmt(totSaldo)}</div></div></div>
    <div class="section-title">🏭 Proveedores</div>
    <div class="table-wrap"><table style="min-width:520px"><thead><tr>
      <th>Proveedor</th><th class="num">Débitos</th><th class="num">Créditos</th><th class="num">Neto</th><th class="num">Mov.</th>
    </tr></thead><tbody>${provRows||`<tr><td colspan="5" class="empty">—</td></tr>`}</tbody></table></div>
    <div class="section-title">ℹ️ Datos compartidos</div>
    <div class="card">
      <p style="margin:0 0 8px">Los datos se guardan en <b>Supabase</b> (proyecto Costos) y se comparten entre todos los dispositivos en tiempo real.</p>
      <ul style="margin:0 0 12px;padding-left:20px;line-height:1.8;color:var(--txt-dim)">
        <li>Para <b>editar</b> hace falta la clave (botón <b>🔒 Editar</b> arriba). Ver es libre.</li>
        <li><b>⬇ Backup</b> descarga una copia de todo en JSON.</li>
        <li>Podés <b>cambiar la clave</b> desde el botón Editar → “Cambiar clave”.</li>
      </ul>
      <button class="btn ghost" id="btn-reload">↻ Recargar datos</button>
    </div>`;
}

/* ---------- Filtros ---------- */
function matchFilter(m,f){
  if(f.q){ const hay=`${m.descripcion||''} ${m.origen||''} ${m.referencia||''} ${m.empresa||''}`.toLowerCase();
    if(!hay.includes(f.q.toLowerCase())) return false; }
  if(f.empresa && m.empresa!==f.empresa) return false;
  if(f.tipo && m.tipo!==f.tipo) return false;
  const dk=dateKey(m.fecha);
  if(f.desde && (!dk||dk<f.desde)) return false;
  if(f.hasta && (!dk||dk>f.hasta)) return false;
  return true;
}
function matchFilterProv(m,f){ if(!f.q) return true;
  return `${m.salidopor||''} ${m.atraves||''} ${m.fuea||''} ${m.fecha||''}`.toLowerCase().includes(f.q.toLowerCase()); }
function uniqueVals(arr,field){ return [...new Set(arr.map(x=>x[field]).filter(v=>v!==null&&v!==undefined&&v!==''))]; }

/* ---------- Eventos de vista ---------- */
function bindViewEvents(){
  const key=currentTab;
  const isCuenta=!!state.cuentas[key];
  const f=getFilter(key);
  const q=document.getElementById('f-q');
  if(q) q.oninput=()=>{f.q=q.value; rerenderKeepFocus();};
  bindSel('f-empresa','empresa',f); bindSel('f-tipo','tipo',f);
  bindVal('f-desde','desde',f); bindVal('f-hasta','hasta',f);
  on('f-clear',()=>{filters[key]={q:'',empresa:'',tipo:'',desde:'',hasta:''}; render();});
  on('btn-add',async()=>{ if(await requireClave()) openMovModal(key,isCuenta?'cuenta':'prov',null); });
  on('btn-add-pend',async()=>{ if(await requireClave()) openPendModal(key,null); });
  on('btn-csv',()=>exportCSV(key));
  on('btn-sort',()=>sortByDate(key));
  on('btn-reload',()=>refresh());
  document.querySelectorAll('[data-edit]').forEach(b=>b.onclick=async()=>{ if(await requireClave()) openMovModal(key,isCuenta?'cuenta':'prov',Number(b.dataset.edit)); });
  document.querySelectorAll('[data-del]').forEach(b=>b.onclick=()=>delMov(key,isCuenta?'cuenta':'prov',Number(b.dataset.del)));
  document.querySelectorAll('[data-pedit]').forEach(b=>b.onclick=async()=>{ if(await requireClave()) openPendModal(key,Number(b.dataset.pedit)); });
  document.querySelectorAll('[data-pdel]').forEach(b=>b.onclick=()=>delPend(key,Number(b.dataset.pdel)));
}
function bindSel(id,field,f){ const el=document.getElementById(id); if(el) el.onchange=()=>{f[field]=el.value; render();}; }
function bindVal(id,field,f){ const el=document.getElementById(id); if(el) el.onchange=()=>{f[field]=el.value; render();}; }
function on(id,fn){ const el=document.getElementById(id); if(el) el.onclick=fn; }
function rerenderKeepFocus(){ const el=document.getElementById('f-q'); const pos=el.selectionStart; render();
  const q=document.getElementById('f-q'); if(q){ q.focus(); q.setSelectionRange(pos,pos); } }

/* ============================================================
   CRUD (con clave)
   ============================================================ */
function getMovArray(key,type){ return type==='cuenta'?state.cuentas[key].movimientos:state.proveedores[key].movimientos; }
function findById(arr,id){ return arr.find(r=>Number(r.id)===Number(id)); }

async function delMov(key,type,id){
  if(!confirm('¿Eliminar este movimiento?')) return;
  const ok=await conClave(c=>rpc('cc_delete_movimiento',{p_clave:c,p_id:id}));
  if(ok){ await refresh(); toast('Movimiento eliminado'); }
}
async function delPend(key,id){
  if(!confirm('¿Eliminar este pendiente?')) return;
  const ok=await conClave(c=>rpc('cc_delete_pendiente',{p_clave:c,p_id:id}));
  if(ok){ await refresh(); toast('Pendiente eliminado'); }
}
async function sortByDate(key){
  const arr=[...state.cuentas[key].movimientos];
  arr.sort((a,b)=>{ const ka=dateKey(a.fecha),kb=dateKey(b.fecha);
    if(!ka&&!kb) return 0; if(!ka) return 1; if(!kb) return -1; return ka<kb?-1:ka>kb?1:0; });
  const ids=arr.map(r=>r.id);
  const ok=await conClave(c=>rpc('cc_reordenar',{p_clave:c,p_cuenta:key,p_ids:ids}));
  if(ok){ await refresh(); toast('Ordenado por fecha'); }
}

/* ---------- Modal movimiento / pendiente ---------- */
let modalCtx=null;
function isAnyModalOpen(){ return !document.getElementById('modal-backdrop').hidden || !document.getElementById('clave-backdrop').hidden; }
function openModal(){ document.getElementById('modal-backdrop').hidden=false; }
function closeModal(){ document.getElementById('modal-backdrop').hidden=true; modalCtx=null; if(dirty) render(); }

function fld(label,name,value,opts={}){
  const v=(value===null||value===undefined)?'':value;
  if(opts.type==='select'){
    const options=opts.options.map(o=>{ const val=typeof o==='object'?o.v:o; const lbl=typeof o==='object'?o.l:o;
      return `<option value="${esc(val)}" ${String(val)===String(v)?'selected':''}>${esc(lbl)}</option>`; }).join('');
    return `<div class="field ${opts.full?'full':''}"><label>${esc(label)}</label><select name="${name}">${options}</select></div>`;
  }
  const type=opts.type||'text'; const step=type==='number'?'step="0.01"':''; const list=opts.list?`list="${opts.list}"`:'';
  return `<div class="field ${opts.full?'full':''}"><label>${esc(label)}</label>
    <input type="${type}" ${step} ${list} name="${name}" value="${esc(v)}" placeholder="${esc(opts.ph||'')}"></div>`;
}

function openMovModal(key,type,id){
  modalCtx={key,type,id,kind:'mov'};
  const editing=id!=null;
  const m=editing?findById(getMovArray(key,type),id)||{}:{};
  document.getElementById('modal-title').textContent=(editing?'Editar':'Nuevo')+' movimiento · '+key;
  let html;
  if(type==='cuenta'){
    html=`
      ${fld('Fecha','fecha',m.fecha??today(),{type:'date'})}
      ${fld('Descripción','descripcion',m.descripcion,{ph:'Ej: Efectivo Recibido'})}
      ${fld('Débitos (sale)','debitos',m.debitos,{type:'number',ph:'0.00'})}
      ${fld('Créditos (entra)','creditos',m.creditos,{type:'number',ph:'0.00'})}
      ${fld('Origen / Destino','origen',m.origen,{full:true,ph:'Detalle del movimiento'})}
      ${fld('Nombre de referencia','referencia',m.referencia,{ph:'Ej: Hugo Wong'})}
      ${fld('Empresa','empresa',m.empresa,{type:'select',options:['',...EMPRESAS]})}
      ${fld('Tipo de gasto','tipo',m.tipo,{type:'select',options:TIPOS})}`;
  } else {
    html=`
      ${fld('Fecha','fecha',m.fecha??today(),{ph:'AAAA-MM-DD o texto libre'})}
      ${fld('Débitos','debitos',m.debitos,{type:'number',ph:'0.00'})}
      ${fld('Créditos','creditos',m.creditos,{type:'number',ph:'0.00'})}
      ${fld('Saldo','saldo',m.saldo,{type:'number',ph:'0.00'})}
      ${fld('Salido por','salidopor',m.salidopor)}
      ${fld('A través de','atraves',m.atraves)}
      ${fld('Fue a','fuea',m.fuea,{full:true})}`;
  }
  document.getElementById('modal-form').innerHTML=html;
  openModal();
}
function openPendModal(key,id){
  modalCtx={key,id,kind:'pend'};
  const editing=id!=null;
  const arr=state.cuentas[key].pendientes;
  const m=editing?findById(arr,id)||{}:{};
  document.getElementById('modal-title').textContent=(editing?'Editar':'Nuevo')+' pendiente · '+key;
  const cats=uniqueVals(arr,'categoria');
  document.getElementById('modal-form').innerHTML=`
    ${fld('Descripción','descripcion',m.descripcion,{full:true,ph:'Ej: Hugo Wong CH38'})}
    ${fld('Categoría','categoria',m.categoria,{full:true,list:'cats',ph:'Ej: Pendientes Recupero (con NTL)'})}
    <datalist id="cats">${cats.map(c=>`<option value="${esc(c)}">`).join('')}</datalist>
    ${fld('A recuperar (crédito)','creditos',m.creditos,{type:'number',ph:'0.00'})}
    ${fld('Débito','debitos',m.debitos,{type:'number',ph:'0.00'})}
    ${fld('Empresa','empresa',m.empresa,{type:'select',options:['',...EMPRESAS]})}`;
  openModal();
}
function readForm(){
  const fd=new FormData(document.getElementById('modal-form')); const o={};
  for(const [k,v] of fd.entries()){
    if(['debitos','creditos','saldo'].includes(k)) o[k]=v===''?null:Number(v);
    else o[k]=v===''?null:v;
  }
  return o;
}
document.getElementById('modal-form').addEventListener('submit',async e=>{
  e.preventDefault();
  const data=readForm();
  const {key,type,id,kind}=modalCtx;
  let ok;
  if(kind==='pend'){
    const row={...data,cuenta:key}; if(id!=null) row.id=id;
    ok=await conClave(c=>rpc('cc_upsert_pendiente',{p_clave:c,p_row:row}));
  } else {
    const row={...data,cuenta:key}; if(id!=null) row.id=id;
    ok=await conClave(c=>rpc('cc_upsert_movimiento',{p_clave:c,p_row:row}));
  }
  if(ok){ closeModal(); await refresh(); toast(id!=null?'Cambios guardados':'Agregado'); }
});
document.getElementById('modal-close').onclick=closeModal;
document.getElementById('modal-cancel').onclick=closeModal;
document.getElementById('modal-backdrop').onclick=e=>{ if(e.target.id==='modal-backdrop') closeModal(); };
document.addEventListener('keydown',e=>{ if(e.key==='Escape'){ if(!document.getElementById('modal-backdrop').hidden) closeModal(); else if(!document.getElementById('clave-backdrop').hidden) closeClave(null); } });

/* ============================================================
   CLAVE
   ============================================================ */
let claveResolver=null, claveMode='unlock';
function setClave(v){ clave=v; if(v) sessionStorage.setItem(CLAVE_KEY,v); else sessionStorage.removeItem(CLAVE_KEY); updateLockUI(); }
function updateLockUI(){ const b=document.getElementById('btn-clave');
  if(clave){ b.textContent='🔓 Editando'; b.classList.add('unlocked'); } else { b.textContent='🔒 Editar'; b.classList.remove('unlocked'); } }

async function ensureClave(){
  if(offline || !sb){ alert('Sin conexión con Supabase: no se puede guardar ahora.'); return null; }
  if(clave) return clave;
  return await openClaveModal('unlock');
}
async function requireClave(){ return !!(await ensureClave()); }
function openClaveModal(mode){
  claveMode=mode;
  const back=document.getElementById('clave-backdrop');
  document.getElementById('clave-input').value='';
  document.getElementById('clave-nueva').value='';
  document.getElementById('clave-error').hidden=true;
  const changing=mode==='change';
  document.getElementById('clave-title').textContent=changing?'Cambiar la clave':'Ingresá la clave para editar';
  document.getElementById('clave-label').textContent=changing?'Clave actual':'Clave';
  document.getElementById('clave-nueva-wrap').hidden=!changing;
  document.getElementById('clave-submit').textContent=changing?'Cambiar clave':'Desbloquear';
  document.getElementById('clave-change-toggle').hidden=changing;
  back.hidden=false;
  setTimeout(()=>document.getElementById('clave-input').focus(),50);
  return new Promise(res=>{ claveResolver=res; });
}
function closeClave(val){ document.getElementById('clave-backdrop').hidden=true; const r=claveResolver; claveResolver=null; if(r) r(val); if(dirty && !isAnyModalOpen()) render(); }
function claveError(msg){ const e=document.getElementById('clave-error'); e.textContent=msg; e.hidden=false; }

document.getElementById('clave-form').addEventListener('submit',async e=>{
  e.preventDefault();
  const val=document.getElementById('clave-input').value;
  if(claveMode==='change'){
    const nueva=document.getElementById('clave-nueva').value;
    if((nueva||'').length<4){ claveError('La nueva clave debe tener al menos 4 caracteres.'); return; }
    try{ await rpc('cc_cambiar_clave',{p_actual:val,p_nueva:nueva}); setClave(nueva); toast('Clave actualizada'); closeClave(nueva); }
    catch(err){ claveError(esErrorClave(err)?'La clave actual es incorrecta.':'No se pudo cambiar: '+((err&&err.message)||err)); }
  } else {
    try{ const okv=await rpc('cc_check_clave',{p_clave:val});
      if(okv){ setClave(val); toast('Edición habilitada'); closeClave(val); }
      else claveError('Clave incorrecta.'); }
    catch(err){ claveError('No se pudo verificar: '+((err&&err.message)||err)); }
  }
});
document.getElementById('clave-change-toggle').onclick=()=>openClaveModal('change');
document.getElementById('clave-close').onclick=()=>closeClave(null);
document.getElementById('clave-cancel').onclick=()=>closeClave(null);
document.getElementById('clave-backdrop').onclick=e=>{ if(e.target.id==='clave-backdrop') closeClave(null); };
document.getElementById('btn-clave').onclick=()=>{
  if(clave){ if(confirm('¿Bloquear la edición?')) { setClave(null); toast('Edición bloqueada'); } }
  else openClaveModal('unlock');
};

/* ============================================================
   BACKUP / CSV
   ============================================================ */
function download(filename,text,mime='text/plain'){
  const blob=new Blob([text],{type:mime}); const url=URL.createObjectURL(blob);
  const a=document.createElement('a'); a.href=url; a.download=filename; a.click(); URL.revokeObjectURL(url);
}
function csvCell(v){ if(v===null||v===undefined) return ''; const s=String(v); return /[",\n;]/.test(s)?'"'+s.replace(/"/g,'""')+'"':s; }
function exportCSV(key){
  const isCuenta=!!state.cuentas[key]; let head,rows;
  if(isCuenta){ const movs=state.cuentas[key].movimientos; const saldos=computeSaldos(movs);
    head=['Fecha','Descripción','Débitos','Créditos','Saldo','Origen/Destino','Referencia','Empresa','Tipo'];
    rows=movs.map((m,i)=>[m.fecha,m.descripcion,m.debitos,m.creditos,saldos[i],m.origen,m.referencia,m.empresa,m.tipo]);
  } else { const movs=state.proveedores[key].movimientos;
    head=['Fecha','Débitos','Créditos','Saldo','Salido por','A través de','Fue a'];
    rows=movs.map(m=>[m.fecha,m.debitos,m.creditos,m.saldo,m.salidopor,m.atraves,m.fuea]); }
  const csv=[head,...rows].map(r=>r.map(csvCell).join(',')).join('\n');
  download(`Cuenta_${key}.csv`,'﻿'+csv,'text/csv;charset=utf-8'); toast('CSV descargado');
}
document.getElementById('btn-export-json').onclick=()=>download('backup_cuenta_corriente.json',JSON.stringify(state,null,2),'application/json');

/* ============================================================
   REALTIME + ARRANQUE
   ============================================================ */
function subscribeRealtime(){
  try{
    sb.channel('cc-cambios')
      .on('postgres_changes',{event:'*',schema:'public',table:'cc_movimientos'},scheduleRefresh)
      .on('postgres_changes',{event:'*',schema:'public',table:'cc_pendientes'},scheduleRefresh)
      .subscribe();
  }catch(e){ /* realtime opcional */ }
}

async function init(){
  setConn('wait');
  if(!window.supabase || !window.SUPABASE_URL){
    // Sin librería/config: modo offline con la copia local o la semilla del Excel
    state=cacheLoad()||structuredClone(window.SEED_DATA||{cuentas:{},proveedores:{}});
    setConn('off'); render(); return;
  }
  sb=window.supabase.createClient(window.SUPABASE_URL,window.SUPABASE_KEY);
  clave=sessionStorage.getItem(CLAVE_KEY)||null; updateLockUI();
  try{ state=await fetchAll(); cacheSave(state); setConn('ok'); }
  catch(e){ state=cacheLoad()||structuredClone(window.SEED_DATA||{cuentas:{},proveedores:{}}); setConn('off'); }
  render();
  subscribeRealtime();
}
init();
