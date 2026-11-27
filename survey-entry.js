// Independent access to teaching evaluation; no scoring or bot changes.
(function(){
  const p=new URLSearchParams(location.search);
  if(p.get('preview')==='1')return;
  const box=document.createElement('aside');box.className='card';
  const title=document.createElement('strong');title.textContent='Cuestionario docente · lunes 30 de noviembre';box.append(title);
  const text=document.createElement('p');text.textContent='Entrega obligatoria ese mismo día, hasta las 23:59 (hora peninsular). Tus opiniones y el permiso de investigación no se califican.';box.append(text);
  const a=document.createElement('a');a.textContent='Abrir cuestionario docente';a.className='action';a.style.display='inline-block';a.style.textDecoration='none';
  a.href='survey.html?campaign=MID-2026-11-30'+(p.get('gt')?'#gt='+encodeURIComponent(p.get('gt')):'');box.append(a);
  const app=document.querySelector('.app')||document.body;app.prepend(box);
})();
