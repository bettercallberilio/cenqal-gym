'use strict';
(async function(){
  const URL_API='https://aibtvkjlmpezjsujlkvn.supabase.co';
  const KEY='sb_publishable_UsEwh-LJbvhXFcX1snjLWw_YlnH9A6T';
  const params=new URLSearchParams(location.hash.slice(1));
  const token=params.get('token')||params.get('gt')||'';
  const campaign=new URLSearchParams(location.search).get('campaign')||'MID-2026-11-30';
  // Keep bearer credentials out of navigation history, referrers and storage.
  if(location.hash)history.replaceState(null,'',location.pathname+location.search);
  const status=document.getElementById('status'),form=document.getElementById('survey');
  const fmt=s=>new Intl.DateTimeFormat('es-ES',{timeZone:'Europe/Madrid',dateStyle:'full',timeStyle:'short'}).format(new Date(s));
  async function rpc(name,body){const r=await fetch(URL_API+'/rest/v1/rpc/'+name,{method:'POST',headers:{apikey:KEY,'Content-Type':'application/json'},body:JSON.stringify(body),cache:'no-store',referrerPolicy:'no-referrer'});const d=await r.json();if(!r.ok)throw Error(d.message||'No se ha podido conectar.');return d;}
  function el(tag,text,parent){const n=document.createElement(tag);if(text)n.textContent=text;if(parent)parent.append(n);return n;}
  try{
    const data=await rpc('cenqal_survey_context_v1',{p_campaign:campaign,p_token:token});
    const c=data.campaign;if(!c)throw Error('Cuestionario no disponible.');
    status.textContent=`${c.title}\nApertura: ${fmt(c.opens_at)}\nCierre: ${fmt(c.closes_at)} (hora peninsular).`;
    if(data.submitted_at){
      status.textContent+='\n✓ Tu entrega ya quedó registrada el '+fmt(data.submitted_at)+'.';
      if(data.research_consent){const withdraw=el('button','Retirar autorización de investigación',document.getElementById('intro'));withdraw.onclick=async()=>{withdraw.disabled=true;try{await rpc('cenqal_survey_withdraw_v1',{p_campaign:campaign,p_token:token});withdraw.textContent='Autorización retirada. Tu entrega docente sigue registrada.';}catch(e){withdraw.disabled=false;status.textContent+='\n'+e.message;}};}
      return;
    }
    if(data.state!=='open'){status.textContent+='\n'+({scheduled:'Se abrirá automáticamente en la fecha indicada.',closed:'El plazo de entrega ha terminado. Si hubo una incidencia técnica, comunícala a la profesora.',disabled:'El cuestionario todavía no está activado.'}[data.state]||'No disponible.');return;}
    if(!data.authorized){status.textContent+='\nAbre el Gym desde tu acceso personal de Berilio y pulsa «Cuestionario docente». Si no puedes acceder, solicita un enlace individual a la profesora.';return;}
    const intro=document.getElementById('intro');
    el('p','Actividad docente de entrega obligatoria durante el día de apertura. Tiempo aproximado: 10–12 minutos. Las opiniones positivas o negativas no reciben puntuación ni recompensas.',intro).className='notice';
    el('p','Responde sobre tu experiencia hasta hoy. No existen respuestas correctas. Puedes dejar preguntas en blanco o seleccionar «prefiero no responder». No incluyas nombres ni datos personales en los comentarios. Las preguntas de aprendizaje miden tu percepción.',intro);
    const host=document.getElementById('questions');let group='';
    for(const q of c.definition){
      if(q.group!==group){group=q.group;el('h2',group,host).className='group';}
      const f=el('fieldset','',host);el('legend',q.label,f);
      if(q.type==='text'){const a=el('textarea','',f);a.name=q.id;a.maxLength=3000;a.setAttribute('aria-label',q.label);}
      else for(const option of q.options){const l=el('label','',f),input=el('input','',l);input.type=q.type==='multi'?'checkbox':'radio';input.name=q.id;input.value=String(option.value);l.append(document.createTextNode(option.label));}
    }
    form.hidden=false;
    form.addEventListener('submit',async event=>{
      event.preventDefault();if(!form.reportValidity())return;
      const button=document.getElementById('submit'),out=document.getElementById('result');button.disabled=true;out.textContent='Registrando en CENQAL…';
      try{
        const fd=new FormData(form),answers={};
        for(const q of c.definition){const values=fd.getAll(q.id);if(q.type==='multi'){if(values.length)answers[q.id]=values;}else if(values.length&&String(values[0]).trim())answers[q.id]=String(values[0]).trim();}
        CenqalSurvey.validate(c.definition,answers);
        const saved=await rpc('cenqal_survey_submit_v1',{p_campaign:campaign,p_token:token,p_answers:answers,p_research:fd.get('research')==='yes',p_ack:true,p_version:c.instrument_version});
        out.textContent='✓ Entrega registrada en CENQAL el '+fmt(saved.submitted_at)+'. Conserva este justificante: '+saved.receipt+'.';
        for(const input of form.querySelectorAll('input,textarea,button'))input.disabled=true;
      }catch(e){out.textContent='No se ha confirmado el guardado: '+e.message+' Tus respuestas siguen en pantalla. Puedes reintentar mientras el plazo esté abierto.';out.className='error';button.disabled=false;}
    });
  }catch(e){status.textContent='No se pudo cargar el cuestionario: '+e.message;status.className='error';}
})();
