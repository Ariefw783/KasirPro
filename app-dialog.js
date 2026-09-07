/* KasirPro AT-08 — Professional Dialog V2 */
let resolver=null;
let activeMode='message';
let promptRequired=false;

function install(){
  if(document.getElementById('kp-global-dialog'))return;
  const wrap=document.createElement('div');
  wrap.id='kp-global-dialog';wrap.hidden=true;
  wrap.innerHTML=`
  <div class="kp-dialog-backdrop"></div>
  <div class="kp-dialog-card" role="dialog" aria-modal="true" aria-labelledby="kp-global-dialog-title">
    <div class="kp-dialog-icon" data-kp-icon>i</div>
    <div class="kp-dialog-copy">
      <h2 id="kp-global-dialog-title">Informasi</h2>
      <p data-kp-message></p>
      <label class="kp-dialog-input-wrap" data-kp-input-wrap hidden>
        <span data-kp-input-label>Input</span>
        <textarea data-kp-input rows="3" maxlength="500"></textarea>
        <small data-kp-input-help></small>
      </label>
    </div>
    <div class="kp-dialog-actions">
      <button type="button" class="kp-dialog-btn secondary" data-kp-cancel hidden>Batal</button>
      <button type="button" class="kp-dialog-btn primary" data-kp-ok>Oke</button>
    </div>
  </div>`;
  document.body.appendChild(wrap);

  const style=document.createElement('style');
  style.id='kp-global-dialog-style';
  style.textContent=`
  #kp-global-dialog{position:fixed;inset:0;z-index:2147483646;display:grid;place-items:center;padding:18px}#kp-global-dialog[hidden]{display:none!important}
  .kp-dialog-backdrop{position:absolute;inset:0;background:rgba(15,23,42,.54);backdrop-filter:blur(3px)}
  .kp-dialog-card{position:relative;width:min(92vw,470px);background:#fff;border:1px solid rgba(148,163,184,.26);border-radius:16px;box-shadow:0 28px 80px rgba(15,23,42,.30);padding:22px;display:grid;grid-template-columns:48px 1fr;gap:14px}
  .kp-dialog-icon{width:44px;height:44px;border-radius:12px;display:grid;place-items:center;font-weight:800;font-size:20px;background:#dbeafe;color:#1d4ed8}.kp-dialog-card[data-type="success"] .kp-dialog-icon{background:#dcfce7;color:#15803d}.kp-dialog-card[data-type="error"] .kp-dialog-icon{background:#fee2e2;color:#b91c1c}.kp-dialog-card[data-type="warning"] .kp-dialog-icon{background:#fef3c7;color:#b45309}
  .kp-dialog-copy h2{margin:1px 0 7px;font-size:18px;line-height:1.3;color:#0f172a}.kp-dialog-copy p{margin:0;white-space:pre-line;line-height:1.55;color:#475569;font-size:13px}
  .kp-dialog-input-wrap{display:block;margin-top:14px}.kp-dialog-input-wrap>span{display:block;margin-bottom:6px;font-size:12px;font-weight:750;color:#334155}.kp-dialog-input-wrap textarea{width:100%;resize:vertical;min-height:82px;max-height:180px;padding:10px 11px;border:1px solid #cbd5e1;border-radius:10px;background:#fff;color:#0f172a;font:inherit;font-size:13px;line-height:1.45;outline:none}.kp-dialog-input-wrap textarea:focus{border-color:#0f766e;box-shadow:0 0 0 3px rgba(15,118,110,.10)}.kp-dialog-input-wrap small{display:block;margin-top:5px;color:#94a3b8;font-size:11px;line-height:1.4}
  .kp-dialog-actions{grid-column:1/-1;display:flex;justify-content:flex-end;gap:9px;margin-top:8px}.kp-dialog-btn{border:1px solid transparent;border-radius:9px;padding:9px 15px;font-weight:750;font-size:12px;cursor:pointer}.kp-dialog-btn.primary{background:#0f766e;color:#fff}.kp-dialog-btn.primary:hover{background:#115e59}.kp-dialog-btn.secondary{background:#fff;border-color:#cbd5e1;color:#334155}.kp-dialog-btn.secondary:hover{background:#f8fafc}
  @media(max-width:520px){.kp-dialog-card{grid-template-columns:40px 1fr;padding:18px}.kp-dialog-icon{width:38px;height:38px;border-radius:10px}.kp-dialog-actions{display:grid;grid-template-columns:1fr 1fr}.kp-dialog-btn{width:100%}}
  `;
  document.head.appendChild(style);

  wrap.querySelector('[data-kp-ok]').addEventListener('click',()=>{
    if(activeMode==='prompt'){
      const input=wrap.querySelector('[data-kp-input]');
      const value=String(input?.value??'').trim();
      if(promptRequired&&!value){
        input.focus();
        input.setCustomValidity('Wajib diisi.');
        input.reportValidity();
        input.setCustomValidity('');
        return;
      }
      finish({confirmed:true,value});return;
    }
    finish(true);
  });
  wrap.querySelector('[data-kp-cancel]').addEventListener('click',()=>finish(activeMode==='prompt'?{confirmed:false,value:''}:false));
  wrap.querySelector('.kp-dialog-backdrop').addEventListener('click',()=>{if(!wrap.querySelector('[data-kp-cancel]').hidden)finish(activeMode==='prompt'?{confirmed:false,value:''}:false);});
  wrap.addEventListener('keydown',event=>{if(event.key==='Escape'&&!wrap.querySelector('[data-kp-cancel]').hidden){event.preventDefault();finish(activeMode==='prompt'?{confirmed:false,value:''}:false);}});
}

function finish(value){
  const wrap=document.getElementById('kp-global-dialog');if(wrap)wrap.hidden=true;
  const r=resolver;resolver=null;activeMode='message';promptRequired=false;r?.(value);
}
function iconFor(type){return type==='success'?'✓':(type==='error'||type==='warning'?'!':'i');}
function mapLegacy(message){
  const raw=String(message??''),lower=raw.toLowerCase();
  if(lower.includes('berhasil')||lower.includes('selesai'))return{type:'success',title:'Berhasil',message:raw};
  if(lower.includes('gagal')||lower.includes('error')||lower.includes('tidak dapat'))return{type:'error',title:'Terjadi Kendala',message:raw};
  if(lower.includes('stok')||lower.includes('peringatan')||lower.includes('harus')||lower.includes('wajib')||lower.includes('belum'))return{type:'warning',title:'Periksa Data',message:raw};
  return{type:'info',title:'KasirPro',message:raw};
}

export function showDialog({type='info',title='Informasi',message='',confirmText='Oke',cancelText='',showCancel=false}={}){
  install();activeMode='message';promptRequired=false;
  const wrap=document.getElementById('kp-global-dialog'),card=wrap.querySelector('.kp-dialog-card');
  card.dataset.type=type;wrap.querySelector('[data-kp-icon]').textContent=iconFor(type);wrap.querySelector('#kp-global-dialog-title').textContent=title;wrap.querySelector('[data-kp-message]').textContent=String(message??'');wrap.querySelector('[data-kp-input-wrap]').hidden=true;
  const ok=wrap.querySelector('[data-kp-ok]'),cancel=wrap.querySelector('[data-kp-cancel]');ok.textContent=confirmText||'Oke';cancel.textContent=cancelText||'Batal';cancel.hidden=!showCancel;wrap.hidden=false;ok.focus();
  return new Promise(resolve=>{resolver=resolve;});
}

export function promptDialog(title,message,{label='Keterangan',placeholder='',initialValue='',help='',confirmText='Lanjutkan',cancelText='Batal',required=false,type='warning'}={}){
  install();activeMode='prompt';promptRequired=!!required;
  const wrap=document.getElementById('kp-global-dialog'),card=wrap.querySelector('.kp-dialog-card');
  card.dataset.type=type;wrap.querySelector('[data-kp-icon]').textContent=iconFor(type);wrap.querySelector('#kp-global-dialog-title').textContent=title;wrap.querySelector('[data-kp-message]').textContent=String(message??'');
  const inputWrap=wrap.querySelector('[data-kp-input-wrap]'),input=wrap.querySelector('[data-kp-input]');inputWrap.hidden=false;wrap.querySelector('[data-kp-input-label]').textContent=label;wrap.querySelector('[data-kp-input-help]').textContent=help;input.placeholder=placeholder;input.value=initialValue;
  const ok=wrap.querySelector('[data-kp-ok]'),cancel=wrap.querySelector('[data-kp-cancel]');ok.textContent=confirmText;cancel.textContent=cancelText;cancel.hidden=false;wrap.hidden=false;
  return new Promise(resolve=>{resolver=resolve;setTimeout(()=>input.focus(),0);});
}

export const success=(title,message,options={})=>showDialog({type:'success',title,message,...options});
export const error=(title,message,options={})=>showDialog({type:'error',title,message,...options});
export const warning=(title,message,options={})=>showDialog({type:'warning',title,message,...options});
export const info=(title,message,options={})=>showDialog({type:'info',title,message,...options});
export const confirmDialog=(title,message,options={})=>showDialog({type:options.type||'warning',title,message,showCancel:true,confirmText:options.confirmText||'Konfirmasi',cancelText:options.cancelText||'Batal'});

window.KasirProDialog=Object.freeze({show:showDialog,success,error,warning,info,confirm:confirmDialog,prompt:promptDialog});
/* Compatibility bridge: legacy alert() call sites render through the KasirPro modal, not browser-native UI. */
window.alert=message=>{const mapped=mapLegacy(message);void showDialog(mapped);};
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',install,{once:true});else install();
