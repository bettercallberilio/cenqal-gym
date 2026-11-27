(function(root,factory){const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;else root.CenqalSurvey=api;})(typeof globalThis!=='undefined'?globalThis:this,function(){
  'use strict';
  function windowState(c,now=Date.now()){
    if(!c.enabled)return 'disabled';
    if(now<Date.parse(c.opens_at))return 'scheduled';
    return now<Date.parse(c.closes_at)?'open':'closed';
  }
  function validate(definition,answers){
    if(!answers||Array.isArray(answers)||typeof answers!=='object')throw Error('Respuestas no válidas');
    const known=new Map(definition.map(q=>[q.id,q]));
    for(const [key,value] of Object.entries(answers)){
      const q=known.get(key);if(!q)throw Error('Pregunta desconocida: '+key);
      if(value===null)continue;
      const options=(q.options||[]).map(o=>String(o.value));
      if(q.type==='text'){if(typeof value!=='string'||value.length>3000)throw Error('Texto no válido');}
      else if(q.type==='multi'){if(!Array.isArray(value)||new Set(value).size!==value.length||value.some(v=>!options.includes(String(v))))throw Error('Selección no válida');if(value.includes('Prefiero no responder')&&value.length>1)throw Error('Si prefieres no responder, deja las demás emociones sin marcar');}
      else if(!options.includes(String(value)))throw Error('Valor fuera de escala: '+key);
    }
    return true;
  }
  function summarize(definition,responses){
    const rows=[];
    for(const q of definition){
      if(q.type==='text')continue;
      for(const o of q.options){
        const valid=responses.filter(r=>r.answers?.[q.id]!=null&&(!Array.isArray(r.answers[q.id])||r.answers[q.id].length));
        const selected=valid.filter(r=>Array.isArray(r.answers[q.id])?r.answers[q.id].includes(String(o.value)):String(r.answers[q.id])===String(o.value));
        rows.push({variable:q.id,pregunta:q.label,opcion:o.label,n_responden:valid.length,n_opcion:selected.length,porcentaje:valid.length?Math.round(1000*selected.length/valid.length)/10:null});
      }
    }
    return rows;
  }
  return {windowState,validate,summarize};
});
