/* ============================================================
   Cuenta Corriente NTL — gestor de cuentas corrientes
   App 100% en el navegador (sin servidor). Los datos viven en
   localStorage; data.js es solo la semilla inicial.
   ============================================================ */

const STORAGE_KEY = 'ctantl_data_v1';

/* ---------- Estado ---------- */
function loadState(){
  const saved = localStorage.getItem(STORAGE_KEY);
  if (saved){
    try { return JSON.parse(saved); } catch(e){ /* cae a semilla */ }
  }
  return structuredClone(window.SEED_DATA);
}
function saveState(){
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}
let state = loadState();
let currentTab = 'Resumen';

/* ---------- Utilidades ---------- */
const num = v => (v === null || v === undefined || v === '') ? 0 : Number(v);
function fmt(v){
  const n = num(v);
  return n.toLocaleString('es-AR', {minimumFractionDigits:2, maximumFractionDigits:2});
}
function fmtCell(v){ // vacío si no hay valor
  if (v === null || v === undefined || v === '' || v === 0) return '';
  return fmt(v);
}
function esc(s){
  if (s === null || s === undefined) return '';
  return String(s).replace(/[&<>"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
}
function toDisplayDate(d){
  if (!d) return '';
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(d);
  if (m) return `${m[3]}/${m[2]}/${m[1]}`;
  return d; // fechas libres tipo "China 43"
}
function dateKey(d){
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(d || '');
  return m ? d : ''; // solo ordenables las ISO
}
function toast(msg){
  const t = document.getElementById('toast');
  t.textContent = msg; t.hidden = false;
  clearTimeout(t._t); t._t = setTimeout(()=>{ t.hidden = true; }, 2200);
}

const EMPRESAS = ['D','TN','CH','Tierra'];
const TIPOS = [
  {v:'', l:'—'},
  {v:'T', l:'T · Transferencia'},
  {v:'G', l:'G · Gasto/Comisión'},
  {v:'DEV', l:'DEV · Devolución'},
];

/* ---------- Saldo acumulado (cuentas corrientes) ---------- */
function computeSaldos(movs){
  let s = 0; const out = [];
  for (const m of movs){ s += num(m.creditos) - num(m.debitos); out.push(round2(s)); }
  return out;
}
const round2 = n => Math.round(n*100)/100;

/* ============================================================
   RENDER PRINCIPAL
   ============================================================ */
function renderTabs(){
  const tabs = ['Resumen',
    ...Object.keys(state.cuentas || {}),
    ...Object.keys(state.proveedores || {})];
  const nav = document.getElementById('tabs');
  nav.innerHTML = tabs.map(t =>
    `<button class="tab ${t===currentTab?'active':''}" data-tab="${esc(t)}">${esc(tabLabel(t))}</button>`
  ).join('');
  nav.querySelectorAll('.tab').forEach(b =>
    b.onclick = () => { currentTab = b.dataset.tab; render(); });
}
function tabLabel(t){
  if (t === 'Resumen') return '📊 Resumen';
  if (state.cuentas && state.cuentas[t]) return '💵 Cuenta ' + t;
  return '🏭 ' + t;
}

function render(){
  renderTabs();
  const main = document.getElementById('main');
  if (currentTab === 'Resumen') main.innerHTML = viewResumen();
  else if (state.cuentas && state.cuentas[currentTab]) renderCuenta(main, currentTab);
  else renderProveedor(main, currentTab);
  bindViewEvents();
}

/* ---------- Filtros por cuenta (memoria) ---------- */
const filters = {}; // key -> {q, empresa, tipo, desde, hasta}
function getFilter(key){
  if (!filters[key]) filters[key] = {q:'',empresa:'',tipo:'',desde:'',hasta:''};
  return filters[key];
}

/* ============================================================
   VISTA: CUENTA CORRIENTE (NTL / CH)
   ============================================================ */
function renderCuenta(main, key){
  const acc = state.cuentas[key];
  const movs = acc.movimientos;
  const saldos = computeSaldos(movs);
  const f = getFilter(key);

  // Totales
  const totIng = round2(movs.reduce((a,m)=>a+num(m.creditos),0));
  const totEgr = round2(movs.reduce((a,m)=>a+num(m.debitos),0));
  const saldoActual = saldos.length ? saldos[saldos.length-1] : 0;

  // Filtrado (mantiene saldo real por índice)
  const visible = movs.map((m,i)=>({m,i,saldo:saldos[i]})).filter(({m}) => matchFilter(m,f));

  const empOpts = uniqueVals(movs,'empresa');
  const tipoOpts = uniqueVals(movs,'tipo');

  main.innerHTML = `
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

    <div class="count">${visible.length} de ${movs.length} movimientos${f.q||f.empresa||f.tipo||f.desde||f.hasta?' (filtrados)':''}</div>

    <div class="table-wrap">
      <table>
        <thead><tr>
          <th>Fecha</th><th>Descripción</th><th class="num">Débitos</th><th class="num">Créditos</th>
          <th class="num">Saldo</th><th>Origen / Destino</th><th>Referencia</th><th>Empresa</th><th>Tipo</th><th></th>
        </tr></thead>
        <tbody>
          ${visible.length ? visible.map(({m,i,saldo}) => rowCuenta(m,i,saldo)).join('') :
            `<tr><td colspan="10" class="empty">Sin movimientos que coincidan.</td></tr>`}
        </tbody>
      </table>
    </div>

    ${pendientesSection(acc, key)}

    <p class="legend"><b>Empresa:</b> D = Damián · TN / Tierra / CH según origen de fondos.
      &nbsp;<b>Tipo:</b> T = Transferencia · G = Gasto/Comisión · DEV = Devolución.
      El <b>Saldo</b> se calcula solo (saldo anterior + créditos − débitos).</p>
  `;
}

function rowCuenta(m,i,saldo){
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
      <button class="iconbtn" data-edit="${i}" title="Editar">✎</button>
      <button class="iconbtn del" data-del="${i}" title="Eliminar">🗑</button>
    </div></td>
  </tr>`;
}

/* Desglose por empresa (Ingreso / Transferencias / Gastos / Saldo) */
function breakdownTable(movs){
  const emps = uniqueVals(movs,'empresa').filter(Boolean);
  if (!emps.length) return '';
  const rows = emps.map(e=>{
    const sub = movs.filter(m=>m.empresa===e);
    const ing = round2(sub.reduce((a,m)=>a+num(m.creditos),0));
    const transf = round2(sub.filter(m=>m.tipo==='T').reduce((a,m)=>a+num(m.debitos),0));
    const gasto = round2(sub.filter(m=>m.tipo==='G').reduce((a,m)=>a+num(m.debitos),0));
    const otros = round2(sub.filter(m=>m.tipo!=='T'&&m.tipo!=='G').reduce((a,m)=>a+num(m.debitos),0));
    const saldo = round2(ing - transf - gasto - otros);
    return `<tr><td><span class="tag emp-${esc(e)}">${esc(e)}</span></td>
      <td class="num cred">${fmt(ing)}</td><td class="num">${fmt(transf)}</td>
      <td class="num deb">${fmt(gasto)}</td><td class="num ${saldo<0?'saldo-neg':''}">${fmt(saldo)}</td></tr>`;
  }).join('');
  return `<div class="section-title">Desglose por empresa</div>
    <div class="table-wrap"><table style="min-width:520px"><thead><tr>
      <th>Empresa</th><th class="num">Ingresos</th><th class="num">Transferencias</th>
      <th class="num">Gastos</th><th class="num">Saldo</th></tr></thead><tbody>${rows}</tbody></table></div>`;
}

/* Pendientes de recupero */
function pendientesSection(acc, key){
  const p = acc.pendientes || [];
  const rows = p.map((m,i)=>`<tr>
    <td>${esc(m.descripcion)}</td>
    <td class="muted">${esc(m.categoria)}</td>
    <td class="num cred">${fmtCell(m.creditos)}</td>
    <td class="num deb">${fmtCell(m.debitos)}</td>
    <td>${m.empresa?`<span class="tag emp-${esc(m.empresa)}">${esc(m.empresa)}</span>`:''}</td>
    <td><div class="rowact">
      <button class="iconbtn" data-pedit="${i}" title="Editar">✎</button>
      <button class="iconbtn del" data-pdel="${i}" title="Eliminar">🗑</button>
    </div></td></tr>`).join('');
  const total = round2(p.reduce((a,m)=>a+num(m.creditos)-num(m.debitos),0));
  return `<div class="section-title">🔖 Pendientes de recupero <span class="count">(no afectan el saldo · total ${fmt(total)})</span>
      <button class="btn ghost sm" id="btn-add-pend" style="margin-left:auto">＋ Agregar pendiente</button></div>
    <div class="table-wrap"><table style="min-width:560px"><thead><tr>
      <th>Descripción</th><th>Categoría</th><th class="num">A recuperar</th><th class="num">Débito</th><th>Empresa</th><th></th>
    </tr></thead><tbody>${rows || `<tr><td colspan="6" class="empty">Sin pendientes.</td></tr>`}</tbody></table></div>`;
}

/* ============================================================
   VISTA: PROVEEDOR (Ownland / Frontier)
   ============================================================ */
function renderProveedor(main, key){
  const acc = state.proveedores[key];
  const movs = acc.movimientos;
  const f = getFilter(key);
  const totDeb = round2(movs.reduce((a,m)=>a+num(m.debitos),0));
  const totCred = round2(movs.reduce((a,m)=>a+num(m.creditos),0));
  const visible = movs.map((m,i)=>({m,i})).filter(({m}) => matchFilterProv(m,f));

  main.innerHTML = `
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
      ${visible.length ? visible.map(({m,i})=>`<tr>
        <td class="muted">${esc(toDisplayDate(m.fecha))}</td>
        <td class="num deb">${fmtCell(m.debitos)}</td>
        <td class="num cred">${fmtCell(m.creditos)}</td>
        <td class="num">${fmtCell(m.saldo)}</td>
        <td>${esc(m.salidopor)}</td><td>${esc(m.atraves)}</td><td>${esc(m.fuea)}</td>
        <td><div class="rowact">
          <button class="iconbtn" data-edit="${i}" title="Editar">✎</button>
          <button class="iconbtn del" data-del="${i}" title="Eliminar">🗑</button>
        </div></td></tr>`).join('')
      : `<tr><td colspan="8" class="empty">Sin movimientos.</td></tr>`}
    </tbody></table></div>`;
}

/* ============================================================
   VISTA: RESUMEN
   ============================================================ */
function viewResumen(){
  const blocks = Object.entries(state.cuentas || {}).map(([key,acc])=>{
    const saldos = computeSaldos(acc.movimientos);
    const saldo = saldos.length?saldos[saldos.length-1]:0;
    const ing = round2(acc.movimientos.reduce((a,m)=>a+num(m.creditos),0));
    const egr = round2(acc.movimientos.reduce((a,m)=>a+num(m.debitos),0));
    return {key,saldo,ing,egr,n:acc.movimientos.length};
  });
  const totSaldo = round2(blocks.reduce((a,b)=>a+b.saldo,0));

  const cards = blocks.map(b=>`
    <div class="card">
      <div class="k">Cuenta ${esc(b.key)} · saldo</div>
      <div class="v ${b.saldo<0?'neg':'pos'}">${fmt(b.saldo)}</div>
      <div class="count" style="margin-top:6px">Ing ${fmt(b.ing)} · Egr ${fmt(b.egr)} · ${b.n} mov.</div>
    </div>`).join('');

  const provRows = Object.entries(state.proveedores || {}).map(([key,acc])=>{
    const deb = round2(acc.movimientos.reduce((a,m)=>a+num(m.debitos),0));
    const cred = round2(acc.movimientos.reduce((a,m)=>a+num(m.creditos),0));
    return `<tr><td>${esc(key)}</td><td class="num deb">${fmt(deb)}</td>
      <td class="num cred">${fmt(cred)}</td><td class="num">${fmt(round2(cred-deb))}</td>
      <td class="num">${acc.movimientos.length}</td></tr>`;
  }).join('');

  return `
    <div class="cards">
      ${cards}
      <div class="card"><div class="k">Saldo total (cuentas)</div><div class="v ${totSaldo<0?'neg':'pos'}">${fmt(totSaldo)}</div></div>
    </div>

    <div class="section-title">🏭 Proveedores</div>
    <div class="table-wrap"><table style="min-width:520px"><thead><tr>
      <th>Proveedor</th><th class="num">Débitos</th><th class="num">Créditos</th><th class="num">Neto</th><th class="num">Mov.</th>
    </tr></thead><tbody>${provRows || `<tr><td colspan="5" class="empty">—</td></tr>`}</tbody></table></div>

    <div class="section-title">ℹ️ Cómo se guardan los datos</div>
    <div class="card">
      <p style="margin:0 0 8px">Los cambios se guardan automáticamente en <b>este navegador</b>. Para no perderlos y compartirlos:</p>
      <ul style="margin:0 0 12px;padding-left:20px;line-height:1.8;color:var(--txt-dim)">
        <li><b>Backup JSON</b>: descarga una copia de seguridad de todo.</li>
        <li><b>Importar</b>: restaura desde un backup JSON.</li>
        <li><b>Guardar en repo</b>: genera el archivo <code>data.js</code>; súbelo al repositorio para que la versión online quede actualizada para todos.</li>
      </ul>
      <button class="btn danger" id="btn-reset">↺ Restaurar datos originales del Excel</button>
    </div>
  `;
}

/* ============================================================
   FILTROS
   ============================================================ */
function matchFilter(m,f){
  if (f.q){
    const hay = (m.descripcion||'')+' '+(m.origen||'')+' '+(m.referencia||'')+' '+(m.empresa||'');
    if (!hay.toLowerCase().includes(f.q.toLowerCase())) return false;
  }
  if (f.empresa && m.empresa !== f.empresa) return false;
  if (f.tipo && m.tipo !== f.tipo) return false;
  const dk = dateKey(m.fecha);
  if (f.desde && (!dk || dk < f.desde)) return false;
  if (f.hasta && (!dk || dk > f.hasta)) return false;
  return true;
}
function matchFilterProv(m,f){
  if (!f.q) return true;
  const hay = (m.salidopor||'')+' '+(m.atraves||'')+' '+(m.fuea||'')+' '+(m.fecha||'');
  return hay.toLowerCase().includes(f.q.toLowerCase());
}
function uniqueVals(arr,field){
  return [...new Set(arr.map(x=>x[field]).filter(v=>v!==null&&v!==undefined&&v!==''))];
}

/* ============================================================
   EVENTOS DE VISTA
   ============================================================ */
function bindViewEvents(){
  const key = currentTab;
  const isCuenta = state.cuentas && state.cuentas[key];
  const isProv = state.proveedores && state.proveedores[key];

  // Filtros
  const f = getFilter(key);
  const q = document.getElementById('f-q');
  if (q) q.oninput = () => { f.q = q.value; rerenderKeepFocus(); };
  bindSel('f-empresa','empresa',f); bindSel('f-tipo','tipo',f);
  bindVal('f-desde','desde',f); bindVal('f-hasta','hasta',f);
  const clr = document.getElementById('f-clear');
  if (clr) clr.onclick = () => { filters[key] = {q:'',empresa:'',tipo:'',desde:'',hasta:''}; render(); };

  // Acciones
  on('btn-add', () => openMovModal(key, isCuenta?'cuenta':'prov', null));
  on('btn-add-pend', () => openPendModal(key, null));
  on('btn-csv', () => exportCSV(key));
  on('btn-sort', () => sortByDate(key));
  on('btn-reset', resetData);

  // Editar / eliminar filas
  document.querySelectorAll('[data-edit]').forEach(b => b.onclick = () =>
    openMovModal(key, isCuenta?'cuenta':'prov', +b.dataset.edit));
  document.querySelectorAll('[data-del]').forEach(b => b.onclick = () =>
    delMov(key, isCuenta?'cuenta':'prov', +b.dataset.del));
  document.querySelectorAll('[data-pedit]').forEach(b => b.onclick = () =>
    openPendModal(key, +b.dataset.pedit));
  document.querySelectorAll('[data-pdel]').forEach(b => b.onclick = () => {
    if (confirm('¿Eliminar este pendiente?')){ state.cuentas[key].pendientes.splice(+b.dataset.pdel,1); saveState(); render(); }
  });
}
function bindSel(id,field,f){ const el=document.getElementById(id); if(el) el.onchange=()=>{f[field]=el.value; render();}; }
function bindVal(id,field,f){ const el=document.getElementById(id); if(el) el.onchange=()=>{f[field]=el.value; render();}; }
function on(id,fn){ const el=document.getElementById(id); if(el) el.onclick=fn; }

// Re-render conservando el foco del buscador
function rerenderKeepFocus(){
  const key = currentTab; const val = document.getElementById('f-q').value;
  const pos = document.getElementById('f-q').selectionStart;
  render();
  const q = document.getElementById('f-q');
  if (q){ q.focus(); q.setSelectionRange(pos,pos); }
}

/* ============================================================
   CRUD
   ============================================================ */
function getMovArray(key,type){
  return type==='cuenta' ? state.cuentas[key].movimientos : state.proveedores[key].movimientos;
}
function delMov(key,type,idx){
  if (!confirm('¿Eliminar este movimiento?')) return;
  getMovArray(key,type).splice(idx,1);
  saveState(); render(); toast('Movimiento eliminado');
}
function sortByDate(key){
  const arr = state.cuentas[key].movimientos;
  arr.sort((a,b)=>{
    const ka=dateKey(a.fecha), kb=dateKey(b.fecha);
    if (!ka && !kb) return 0; if (!ka) return 1; if (!kb) return -1;
    return ka<kb?-1:ka>kb?1:0;
  });
  saveState(); render(); toast('Ordenado por fecha');
}
function resetData(){
  if (!confirm('Esto descarta TODOS tus cambios y vuelve a los datos originales del Excel. ¿Continuar?')) return;
  state = structuredClone(window.SEED_DATA);
  saveState(); render(); toast('Datos restaurados');
}

/* ============================================================
   MODAL
   ============================================================ */
let modalCtx = null;
function openModal(){ document.getElementById('modal-backdrop').hidden = false; }
function closeModal(){ document.getElementById('modal-backdrop').hidden = true; modalCtx = null; }

function fld(label,name,value,opts={}){
  const v = value===null||value===undefined?'':value;
  if (opts.type==='select'){
    const options = opts.options.map(o=>{
      const val = typeof o==='object'?o.v:o; const lbl = typeof o==='object'?o.l:o;
      return `<option value="${esc(val)}" ${String(val)===String(v)?'selected':''}>${esc(lbl)}</option>`;
    }).join('');
    return `<div class="field ${opts.full?'full':''}"><label>${esc(label)}</label><select name="${name}">${options}</select></div>`;
  }
  const type = opts.type||'text';
  const step = type==='number'?'step="0.01"':'';
  const list = opts.list?`list="${opts.list}"`:'';
  return `<div class="field ${opts.full?'full':''}"><label>${esc(label)}</label>
    <input type="${type}" ${step} ${list} name="${name}" value="${esc(v)}" placeholder="${esc(opts.ph||'')}"></div>`;
}

function openMovModal(key,type,idx){
  modalCtx = {key,type,idx,kind:'mov'};
  const editing = idx!==null;
  const m = editing ? getMovArray(key,type)[idx] : {};
  document.getElementById('modal-title').textContent =
    (editing?'Editar':'Nuevo')+' movimiento · '+key;

  let html;
  if (type==='cuenta'){
    html = `
      ${fld('Fecha','fecha', m.fecha ?? today(),{type:'date'})}
      ${fld('Descripción','descripcion', m.descripcion,{ph:'Ej: Efectivo Recibido'})}
      ${fld('Débitos (sale)','debitos', m.debitos,{type:'number',ph:'0.00'})}
      ${fld('Créditos (entra)','creditos', m.creditos,{type:'number',ph:'0.00'})}
      ${fld('Origen / Destino','origen', m.origen,{full:true,ph:'Detalle del movimiento'})}
      ${fld('Nombre de referencia','referencia', m.referencia,{ph:'Ej: Hugo Wong'})}
      ${fld('Empresa','empresa', m.empresa,{type:'select',options:['',...EMPRESAS]})}
      ${fld('Tipo de gasto','tipo', m.tipo,{type:'select',options:TIPOS})}
    `;
  } else {
    html = `
      ${fld('Fecha','fecha', m.fecha ?? today(),{ph:'AAAA-MM-DD o texto libre'})}
      ${fld('Débitos','debitos', m.debitos,{type:'number',ph:'0.00'})}
      ${fld('Créditos','creditos', m.creditos,{type:'number',ph:'0.00'})}
      ${fld('Saldo','saldo', m.saldo,{type:'number',ph:'0.00'})}
      ${fld('Salido por','salidopor', m.salidopor)}
      ${fld('A través de','atraves', m.atraves)}
      ${fld('Fue a','fuea', m.fuea,{full:true})}
    `;
  }
  document.getElementById('modal-form').innerHTML = html;
  openModal();
}

function openPendModal(key,idx){
  modalCtx = {key,idx,kind:'pend'};
  const editing = idx!==null;
  const arr = state.cuentas[key].pendientes;
  const m = editing ? arr[idx] : {};
  document.getElementById('modal-title').textContent = (editing?'Editar':'Nuevo')+' pendiente · '+key;
  const cats = uniqueVals(arr,'categoria');
  document.getElementById('modal-form').innerHTML = `
    ${fld('Descripción','descripcion', m.descripcion,{full:true,ph:'Ej: Hugo Wong CH38'})}
    ${fld('Categoría','categoria', m.categoria,{full:true,list:'cats',ph:'Ej: Pendientes Recupero (con NTL)'})}
    <datalist id="cats">${cats.map(c=>`<option value="${esc(c)}">`).join('')}</datalist>
    ${fld('A recuperar (crédito)','creditos', m.creditos,{type:'number',ph:'0.00'})}
    ${fld('Débito','debitos', m.debitos,{type:'number',ph:'0.00'})}
    ${fld('Empresa','empresa', m.empresa,{type:'select',options:['',...EMPRESAS]})}
  `;
  openModal();
}

function today(){
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
}

function readForm(){
  const fd = new FormData(document.getElementById('modal-form'));
  const o = {};
  for (const [k,v] of fd.entries()){
    if (['debitos','creditos','saldo'].includes(k)) o[k] = v===''?null:Number(v);
    else o[k] = v===''?null:v;
  }
  return o;
}

document.getElementById('modal-form').addEventListener('submit', e => {
  e.preventDefault();
  const data = readForm();
  const {key,type,idx,kind} = modalCtx;
  if (kind==='pend'){
    const arr = state.cuentas[key].pendientes;
    if (idx!==null) arr[idx] = data; else arr.push(data);
  } else {
    const arr = getMovArray(key,type);
    if (idx!==null) arr[idx] = {...arr[idx],...data}; else arr.push(data);
  }
  saveState(); closeModal(); render();
  toast(idx!==null?'Cambios guardados':'Movimiento agregado');
});
document.getElementById('modal-close').onclick = closeModal;
document.getElementById('modal-cancel').onclick = closeModal;
document.getElementById('modal-backdrop').onclick = e => { if (e.target.id==='modal-backdrop') closeModal(); };
document.addEventListener('keydown', e => { if (e.key==='Escape' && !document.getElementById('modal-backdrop').hidden) closeModal(); });

/* ============================================================
   EXPORTAR / IMPORTAR
   ============================================================ */
function download(filename, text, mime='text/plain'){
  const blob = new Blob([text], {type:mime});
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = filename; a.click();
  URL.revokeObjectURL(url);
}
function csvCell(v){
  if (v===null||v===undefined) return '';
  const s = String(v);
  return /[",\n;]/.test(s) ? '"'+s.replace(/"/g,'""')+'"' : s;
}
function exportCSV(key){
  const isCuenta = state.cuentas && state.cuentas[key];
  let head, rows;
  if (isCuenta){
    const movs = state.cuentas[key].movimientos;
    const saldos = computeSaldos(movs);
    head = ['Fecha','Descripción','Débitos','Créditos','Saldo','Origen/Destino','Referencia','Empresa','Tipo'];
    rows = movs.map((m,i)=>[m.fecha,m.descripcion,m.debitos,m.creditos,saldos[i],m.origen,m.referencia,m.empresa,m.tipo]);
  } else {
    const movs = state.proveedores[key].movimientos;
    head = ['Fecha','Débitos','Créditos','Saldo','Salido por','A través de','Fue a'];
    rows = movs.map(m=>[m.fecha,m.debitos,m.creditos,m.saldo,m.salidopor,m.atraves,m.fuea]);
  }
  const csv = [head, ...rows].map(r=>r.map(csvCell).join(',')).join('\n');
  download(`Cuenta_${key}.csv`, '﻿'+csv, 'text/csv;charset=utf-8');
  toast('CSV descargado');
}

document.getElementById('btn-export-json').onclick = () =>
  download('backup_cuenta_corriente.json', JSON.stringify(state,null,2), 'application/json');

document.getElementById('btn-export-datajs').onclick = () => {
  const text = `// Datos de la cuenta corriente. Generado desde la app.\n`+
    `// Súbelo al repositorio para actualizar la versión online.\n`+
    `window.SEED_DATA = ${JSON.stringify(state,null,2)};\n`;
  download('data.js', text, 'text/javascript');
  toast('data.js generado — súbelo al repositorio');
};

document.getElementById('btn-import-json').onclick = () => document.getElementById('file-input').click();
document.getElementById('file-input').onchange = e => {
  const file = e.target.files[0]; if (!file) return;
  const r = new FileReader();
  r.onload = () => {
    try {
      const data = JSON.parse(r.result);
      if (!data.cuentas) throw new Error('Formato no válido');
      if (!confirm('Esto reemplaza los datos actuales por los del archivo. ¿Continuar?')) return;
      state = data; saveState(); render(); toast('Datos importados');
    } catch(err){ alert('No se pudo importar: '+err.message); }
  };
  r.readAsText(file);
  e.target.value = '';
};

/* ---------- Arranque ---------- */
render();
