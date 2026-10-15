/* CENQAL Control v74.1 patch
   - Recovered EX1 official grades from student workspace grade entries
   - Oganeson earned/spent/balance economy view
   Safe client-side patch: no academic records are written.
*/
(() => {
  'use strict';

  const V741_EXAM_CODE = 'EX1';
  const V741_TOPIC = 1;
  const v741WorkspaceCache = new Map();
  let v741WorkspaceCourseKey = null;
  let v741EconomyRows = [];
  let v741RecoveredByStudent = new Map();
  let v741Generation = 0;

  const _loadGame = loadGame;
  const _loadLearning = loadLearning;
  const _loadStudentLearningAnalytics = loadStudentLearningAnalytics;
  const _renderStudentDetail = renderStudentDetail;
  const _clearCourseScopedState = typeof clearCourseScopedState === 'function' ? clearCourseScopedState : null;
  // Modo auditoría: sólo se permiten consultas RPC. No altera ningún registro.
  const v741ReadOnlyRpc=new Set([
    'cenqal_control_snapshot','cenqal_control_courses','cenqal_control_students',
    'cenqal_control_class_progress','cenqal_control_student_catalog',
    'cenqal_control_student_workspace','cenqal_control_deliveries_v67',
    'cenqal_control_calendar','cenqal_control_challenges','cenqal_control_exams',
    'cenqal_control_evidences','cenqal_control_audit_log',
    'cenqal_control_gamification','cenqal_control_learning_analytics_v69',
    'cenqal_control_learning_export_v69','cenqal_control_student_learning_v69',
    'cenqal_control_new_course_preview'
  ]);
  const v741OriginalRpc=rpc;
  rpc=async function(name,body={}){
    if(!v741ReadOnlyRpc.has(String(name))){
      throw new Error('Rama v74.1 de solo lectura: no se permiten ajustes ni modificaciones.');
    }
    return v741OriginalRpc(name,body);
  };


  function v741CourseKey(){
    return String(
      state?.selectedCourseId ??
      state?.snapshot?.course?.id ??
      state?.snapshot?.course?.academic_year ??
      'current'
    );
  }

  function v741StudentKeys(obj={}){
    const result=[];
    for(const [type,value] of [
      ['id',obj.student_id],['id',obj.id],['id',obj.cenqal_student_id],
      ['code',obj.student_code],['telegram',obj.telegram_user_id]
    ]){
      if(value==null||String(value).trim()==='')continue;
      const key=type+':'+String(value).trim().toLowerCase();
      if(!result.includes(key))result.push(key);
    }
    return result;
  }

  function v741Number(value){
    if(value==null||value===''||typeof value==='boolean')return null;
    const n=Number(value);
    return Number.isFinite(n)?n:null;
  }

  function v741Matches(a,b){
    const keys=v741StudentKeys(a);
    return v741StudentKeys(b).some(k=>keys.includes(k));
  }

  function v741ResetCacheIfCourseChanged(){
    const key=v741CourseKey();
    if(v741WorkspaceCourseKey!==key){
      v741WorkspaceCourseKey=key;
      v741WorkspaceCache.clear();
      v741EconomyRows=[];
      v741RecoveredByStudent=new Map();
      v741Generation++;
    }
  }

  async function v741MapLimit(items, limit, worker){
    const results=new Array(items.length);
    let next=0;
    const runners=Array.from(
      {length:Math.min(limit,Math.max(items.length,1))},
      async()=>{
        while(true){
          const i=next++;
          if(i>=items.length)return;
          results[i]=await worker(items[i],i);
        }
      }
    );
    await Promise.all(runners);
    return results;
  }

  async function v741WorkspaceForStudent(student, force=false){
    v741ResetCacheIfCourseChanged();
    const sid=studentIdOf(student);
    if(!sid)return null;
    const key=`${v741CourseKey()}:${String(sid)}`;
    if(!force && v741WorkspaceCache.has(key)){
      return v741WorkspaceCache.get(key);
    }
    const promise=rpc(
      'cenqal_control_student_workspace',
      {p_token:TOKEN,p_student_id:sid}
    ).catch(error=>({__v741_error:error?.message||String(error),student}));
    v741WorkspaceCache.set(key,promise);
    return promise;
  }

  function v741OfficialEx1FromWorkspace(workspace){
    const grades=Array.isArray(workspace?.analytics?.grades)?workspace.analytics.grades:[];
    // Un código inequívoco; no basta que el título mencione EX1.
    const matches=grades.filter(g=>[g.item_code,g.activity_code,g.exam_code]
      .some(v=>String(v??'').trim().toUpperCase()==='EX1'));
    const valid=matches.map(g=>({
      row:g,score:v741Number(g.effective_score??g.score_out_of_10??g.score??g.grade),
      time:Date.parse(g.updated_at||g.created_at||'')||0
    })).filter(x=>x.score!==null&&x.score>=0&&x.score<=10);
    if(!valid.length)return null;
    // Si existen notas oficiales incompatibles, no decidir automáticamente.
    if(new Set(valid.map(x=>x.score)).size>1)return {ambiguous:true};
    valid.sort((a,b)=>b.time-a.time);
    return {score:valid[0].score,row:valid[0].row};
  }

  async function v741LoadWorkspaces(force=false){
    v741ResetCacheIfCourseChanged();
    const requestCourse=v741CourseKey(),requestGeneration=v741Generation;
    if(!state.students?.length){
      await loadStudents(force).catch(()=>null);
    }

    if(requestCourse!==v741CourseKey()||requestGeneration!==v741Generation)return [];
    const students=(state.students||[]).filter(s=>s.active!==false);
    const workspaces=await v741MapLimit(
      students,
      4,
      async s=>({student:s,workspace:await v741WorkspaceForStudent(s,force)})
    );

    if(requestCourse!==v741CourseKey()||requestGeneration!==v741Generation)return [];
    const recovered=new Map();
    const economy=[];

    for(const item of workspaces){
      const s=item.student||{};
      const w=item.workspace||{};
      const official=v741OfficialEx1FromWorkspace(w);

      if(official&&!official.ambiguous){
        for(const key of v741StudentKeys(s)){
          recovered.set(key,official);
        }
        for(const key of v741StudentKeys(w.student||{})){
          recovered.set(key,official);
        }
      }

      const events=Array.isArray(w.gamification_events)?w.gamification_events:null;
      const deltas=events?.map(e=>v741Number(e.oganeson_delta))||[];
      const hasLedger=events!==null && deltas.every(v=>v!==null);
      const earned=hasLedger?deltas.reduce((n,v)=>n+Math.max(0,v),0):null;
      const spent=hasLedger?deltas.reduce((n,v)=>n+Math.max(0,-v),0):null;
      const ledger=hasLedger?earned-spent:null;
      const game=(state.game||[]).find(g=>v741Matches(s,g))||{};
      const balance=v741Number(w.gamification_profile?.oganeson_balance??game.oganeson_balance);
      const complete=!w.__v741_error && hasLedger && balance!==null;
      economy.push({
        student_id:studentIdOf(s),
        student_code:s.student_code||w.student?.student_code||game.student_code||'',
        student_name:s.full_name||studentName(s)||game.student_name||'',
        earned,spent,balance,ledger,movements:events?.length??null,complete,
        coherent:complete?Math.abs(ledger-balance)<0.000001:null,
        error:w.__v741_error||''
      });
    }

    if(requestCourse!==v741CourseKey()||requestGeneration!==v741Generation)return [];
    v741RecoveredByStudent=recovered;
    v741EconomyRows=economy;
    return workspaces;
  }

  function v741RecoveryFor(obj={}){
    for(const key of v741StudentKeys(obj)){
      if(v741RecoveredByStudent.has(key))return v741RecoveredByStudent.get(key);
    }
    return null;
  }

  function v741ExamScoreField(row){
    for(const key of ['exam_score','score_out_of_10','exam_average','score']){
      const v=v741Number(row?.[key]);
      if(v!==null&&v>=0&&v<=10)return {key,value:v};
    }
    return null;
  }

  function v741IsTopic1(row={}){
    const topic=Number(row.topic_number ?? row.topic ?? row.exam_topic);
    if(topic===V741_TOPIC)return true;
    const code=String(row.exam_code||row.item_code||row.activity_code||'').toUpperCase();
    return code===V741_EXAM_CODE;
  }

  const v741ProcessedLearning=new WeakSet();
  function v741ApplyRecoveredEx1ToLearning(d){
    if(!d || v741ProcessedLearning.has(d))return d;
    v741ProcessedLearning.add(d);
    const changes=[];
    const examGym=Array.isArray(d.exam_gym)?d.exam_gym:[];
    let pending=0;
    for(const row of examGym){
      if(!v741IsTopic1(row))continue;
      const rec=v741RecoveryFor(row);
      if(!rec)continue;
      row.exam_score_official=rec.score;
      row.exam_score_source_official='cenqal_grade_entries';
      const sf=v741ExamScoreField(row);
      if(!sf || examGym.filter(x=>v741IsTopic1(x)&&v741Matches(x,row)).length!==1){
        row.exam_score_pending_review=true;
        pending++;
        continue;
      }
      // Se conserva la nota técnica y se añade explícitamente la oficial.
      row.exam_score_technical=sf.value;
      changes.push({row,old:sf.value,next:rec.score,delta:rec.score-sf.value});
    }
    const processed=new Set();
    for(const change of changes){
      const student=(d.students||[]).find(x=>v741Matches(x,change.row));
      if(!student || processed.has(student)){pending++;continue}
      processed.add(student);
      student.exam1_official_score=change.next;
      student.exam1_technical_score=change.old;
      student.exam1_score_source='cenqal_grade_entries';
      const count=v741Number(student.exam_count), avg=v741Number(student.exam_average);
      if(count===null||count<=0||avg===null){pending++;continue}
      student.exam_average=Math.max(0,Math.min(10,avg+change.delta/count));
      const passed=v741Number(student.exam_passed);
      if(passed!==null){
        student.exam_passed=Math.max(0,Math.min(count,
          passed+(change.old<5&&change.next>=5?1:0)-(change.old>=5&&change.next<5?1:0)));
      }
    }
    // Si la fila técnica no existe, no se inventan denominadores ni medias.
    const knownStudents=(d.students||[]).filter(x=>v741RecoveryFor(x)).length;
    pending+=Math.max(0,knownStudents-processed.size);
    const topic=(d.topics||[]).find(v741IsTopic1);
    if(topic&&changes.length){
      const count=v741Number(topic.exam_count),avg=v741Number(topic.exam_average);
      if(count!==null&&count>0&&avg!==null){
        topic.exam_average=Math.max(0,Math.min(10,avg+
          changes.reduce((sum,x)=>sum+x.delta,0)/count));
        topic.exam_score_source='reconciliacion_lectura_ex1';
      }else pending++;
    }
    if(changes.length&&d.summary){
      const weighted=(d.students||[]).filter(x=>v741Number(x.exam_count)>0 && v741Number(x.exam_average)!==null)
        .reduce((acc,x)=>{const c=Number(x.exam_count);acc.sum+=Number(x.exam_average)*c;acc.count+=c;return acc},{sum:0,count:0});
      if(weighted.count)d.summary.exam_average=weighted.sum/weighted.count;
    }
    d.__v741_recovered_ex1=changes.filter(x=>x.delta!==0).length;
    d.__v741_checked_ex1=changes.length;
    d.__v741_pending_ex1=pending;
    return d;
  }

  function v741EnsureLearningNotice(){
    const view=document.getElementById('view-learning');
    if(!view)return;
    let note=document.getElementById('v741ExamRecoveryNote');
    if(!note){
      note=document.createElement('div');
      note.id='v741ExamRecoveryNote';
      note.className='note';
      note.style.marginBottom='14px';
      const anchor=view.querySelector('.metrics');
      if(anchor)anchor.before(note);
    }
    const checked=Number(state.learning?.__v741_checked_ex1||0);
    const changed=Number(state.learning?.__v741_recovered_ex1||0);
    const pending=Number(state.learning?.__v741_pending_ex1||0);
    note.textContent='EX1 · '+checked+' correspondencias verificadas, '+changed+
      ' ajustes de lectura y '+pending+' pendientes de revisión. Los intentos técnicos se conservan sin modificar.';
  }


  // Diagnóstico docente por tema. Lecturas RPC exclusivamente; nunca adjudica notas.
  let v741TopicSelected=1;
  const v741TopicDetailCache=new Map();
  const v741TopicNames={
    1:'Enlace químico y propiedades del agua',
    2:'Química orgánica, grupos funcionales e hidratos de carbono',
    3:'Aminoácidos y proteínas',
    4:'Lípidos',
    5:'Enzimas',
    6:'Sistemas dispersos, disoluciones y termoquímica',
    7:'Cinética, equilibrio químico y ácido-base',
    8:'Oxidación-reducción y transferencia de electrones'
  };
  const v741Percent=(num,den)=>{
    if(!Number.isFinite(num)||!Number.isFinite(den)||den<=0)return '—';
    return (100*num/den).toFixed(1)+' %';
  };

  function v741RenderTopicDashboard(){
    const view=document.getElementById('view-learning');
    if(!view)return;
    let panel=document.getElementById('v741TopicDashboard');
    if(!panel){
      panel=document.createElement('section');
      panel.id='v741TopicDashboard';
      panel.className='card';
      panel.style.margin='14px 0';
      const base=document.getElementById('learningTopics')?.closest('.card');
      if(base)base.before(panel);
      else view.appendChild(panel);
      panel.innerHTML=[
        '<div class="sectionTitle"><div><h3>🔎 Diagnóstico de aprendizaje por tema</h3>',
        '<p>Acierto, cobertura, dominio, alumnos y dificultades. Sólo seguimiento docente.</p>',
        '</div></div>',
        '<div class="searchrow"><label for="v741TopicSelector">Tema</label>',
        '<select id="v741TopicSelector" aria-label="Seleccionar tema">',
        ...Array.from({length:8},(_,i)=>'<option value="'+(i+1)+'">T'+(i+1)+' · '+v741TopicNames[i+1]+'</option>'),
        '</select>',
        '<button class="btn" id="v741TopicLoadDetail" type="button">🔍 Ver dificultades y evolución</button></div>',
        '<div id="v741TopicOverview"></div>',
        '<div id="v741TopicDiagnostics" aria-live="polite"></div>'
      ].join('');
      panel.querySelector('#v741TopicSelector').addEventListener('change',event=>{
        v741TopicSelected=Number(event.target.value)||1;
        v741RenderTopicOverview();
        const cached=v741TopicDetailCache.get(v741CourseKey());
        if(cached)v741ShowTopicDetails(cached);
        else document.getElementById('v741TopicDiagnostics').textContent=
          'Pulsa «Ver dificultades y evolución» para obtener el detalle.';
      });
      panel.querySelector('#v741TopicLoadDetail').addEventListener('click',v741LoadTopicDetails);
    }
    const selector=panel.querySelector('#v741TopicSelector');
    selector.value=String(v741TopicSelected);
    v741RenderTopicOverview();
    const cached=v741TopicDetailCache.get(v741CourseKey());
    if(cached)v741ShowTopicDetails(cached);
  }

  function v741RenderTopicOverview(){
    const panel=document.getElementById('v741TopicOverview');
    if(!panel)return;
    const topics=state.learning?.topics||[];
    const x=topics.find(t=>Number(t.topic_number)===v741TopicSelected)||{};
    const pract=v741Number(x.practiced_questions)||0;
    const mast=v741Number(x.mastered_questions)||0;
    const attempts=v741Number(x.gym_attempts)||0;
    const acc=v741Number(x.gym_accuracy_pct);
    const users=v741Number(x.gym_users)||0;
    const status=v741TopicSelected===1
      ?'EX1: calificación oficial de carga manual. El intento técnico no es fiable y no se modifica.'
      :v741TopicSelected===2
        ?(v741Number(x.exam_count)>0
          ?'EX2: hay registros de examen. Verificar las notas oficiales antes de utilizarlas para PP.'
          :'EX2: pendiente de realización. No se muestran calificaciones inexistentes.')
        :'Examen: sólo se muestran notas registradas y verificadas, sin estimaciones.';
    const mastery=v741Percent(mast,pract);
    panel.innerHTML=[
      '<div class="metrics grid" style="margin-top:12px">',
      metric('👥 Alumnos en Gym',users,'usuarios distintos en T'+v741TopicSelected),
      metric('🧠 Respuestas',attempts,'incluye repeticiones'),
      metric('🎯 Precisión',acc===null?'—':acc.toFixed(1)+' %','aciertos/respuestas'),
      metric('📚 Cobertura',pract,'preguntas-alumno practicadas'),
      metric('✅ Dominio',mastery,mast+' dominadas de '+pract+' practicadas'),
      '</div><p class="note" style="margin:12px 0">',
      esc(status),
      '</p><p class="analyticsHint">Un acierto aislado no equivale a dominio. La cobertura y el dominio se cuentan por pareja alumno–pregunta; no son 40 preguntas únicas del grupo.</p>'
    ].join('');
  }

  async function v741LoadTopicDetails(){
    const elem=document.getElementById('v741TopicDiagnostics');
    const btn=document.getElementById('v741TopicLoadDetail');
    if(!elem||!btn)return;
    const course=v741CourseKey(),generation=v741Generation;
    btn.disabled=true;
    elem.textContent='Cargando respuestas, sesiones y dominio desde CENQAL…';
    try{
      const raw=await rpc('cenqal_control_learning_export_v69',{
        p_token:TOKEN,p_course_id:v69CourseId()
      });
      if(course!==v741CourseKey()||generation!==v741Generation)return;
      if(!raw||!Array.isArray(raw.gym_attempts))throw Error('No hay respuestas detalladas disponibles en la exportación.');
      v741TopicDetailCache.set(course,raw);
      v741ShowTopicDetails(raw);
    }catch(e){
      if(course===v741CourseKey())elem.textContent=
        'No se ha podido consultar el detalle: '+String(e?.message||e);
    }finally{btn.disabled=false}
  }

  function v741ShowTopicDetails(raw){
    const el=document.getElementById('v741TopicDiagnostics');
    if(!el)return;
    const t=v741TopicSelected;
    const rows=(raw.gym_attempts||[]).filter(r=>Number(r.topic_number)===t);
    const ss=(raw.gym_sessions||[]).filter(r=>Number(r.topic_number)===t);
    const mm=(raw.gym_mastery||[]).filter(r=>Number(r.topic_number)===t);
    if(!rows.length){
      el.innerHTML='<p class="note">Todavía no hay respuestas registradas para este tema. Sin actividad no se asigna ningún juicio de rendimiento.</p>';
      return;
    }
    const map=new Map(),students=new Map(),sessions=new Map(),mastery=new Map();
    for(const r of rows){
      const question=String(r.question_id||r.question_code||'—');
      const item=map.get(question)||{id:question,n:0,wrong:0,students:new Set()};
      item.n++;
      if(r.is_correct!==true)item.wrong++;
      if(r.student_code!=null)item.students.add(String(r.student_code));
      map.set(question,item);
      const code=String(r.student_code||'SIN_CODIGO');
      const a=students.get(code)||{code,answers:[],wrong:0};
      a.answers.push(r);
      if(r.is_correct!==true)a.wrong++;
      students.set(code,a);
    }
    for(const r of ss){
      const code=String(r.student_code||'SIN_CODIGO');
      const st=sessions.get(code)||{n:0,active:0};
      st.n++;
      st.active+=Math.max(0,v741Number(r.active_minutes)||0);
      sessions.set(code,st);
    }
    for(const r of mm){
      const code=String(r.student_code||'SIN_CODIGO');
      const m=mastery.get(code)||{practiced:0,mastered:0};
      m.practiced++;
      if(r.mastered===true)m.mastered++;
      mastery.set(code,m);
    }
    const troubles=[...map.values()].filter(q=>q.n>=5&&q.wrong>=2)
      .sort((a,b)=>b.wrong-a.wrong||b.wrong/b.n-a.wrong/a.n||b.n-a.n)
      .slice(0,8);
    const studentRows=[...students.values()].sort((a,b)=>b.answers.length-a.answers.length).map(st=>{
      const m=mastery.get(st.code)||{practiced:0,mastered:0};
      const se=sessions.get(st.code)||{n:0,active:0};
      const count=st.answers.length,correct=count-st.wrong;
      const ordered=[...st.answers].sort((a,b)=>String(a.created_at||'').localeCompare(String(b.created_at||'')));
      const half=Math.floor(ordered.length/2);
      let change='—';
      if(half>=5){
        const first=ordered.slice(0,half),last=ordered.slice(-half);
        const a=first.filter(x=>x.is_correct===true).length/half;
        const b=last.filter(x=>x.is_correct===true).length/half;
        const delta=Math.round((b-a)*100);
        change=(delta>0?'+':'')+delta+' pp';
      }
      return {code:st.code,n:count,accuracy:v741Percent(correct,count),
        coverage:m.practiced,mastered:m.mastered,mastery:v741Percent(m.mastered,m.practiced),
        sessions:se.n,minutes:Math.round(se.active),change};
    });
    const groupMinutes=ss.reduce((sum,s)=>sum+Math.max(0,v741Number(s.active_minutes)||0),0);
    const actualCorrect=rows.filter(r=>r.is_correct===true).length;
    const statusCounts={};
    ss.forEach(x=>{const status=String(x.status||'sin estado');statusCounts[status]=(statusCounts[status]||0)+1});
    el.innerHTML=[
      '<h4 style="margin:18px 0 8px">Evidencias del tema T'+t+'</h4>',
      '<div class="metrics grid">',
      metric('📆 Sesiones',ss.length,Object.entries(statusCounts).map(([k,v])=>k+': '+v).join(' · ')),
      metric('⏱ Tiempo activo',Math.round(groupMinutes)+' min','suma de los registros disponibles'),
      metric('✅ Aciertos',actualCorrect+' / '+rows.length,'respuestas con repeticiones'),
      metric('🔴 Preguntas a revisar',troubles.length,'al menos 2 errores y 5 respuestas'),
      '</div>',
      '<h4 style="margin:18px 0 8px">🔴 Preguntas que concentran errores</h4>',
      '<div class="tablewrap"><table class="table"><thead><tr>',
      '<th>ID de pregunta</th><th>Errores</th><th>Respuestas</th><th>Acierto</th><th>Alumnos que la intentaron</th>',
      '</tr></thead><tbody>',
      troubles.map(x=>'<tr><td><b>'+esc(x.id)+'</b></td><td>'+x.wrong+'</td>'+
        '<td>'+x.n+'</td><td>'+v741Percent(x.n-x.wrong,x.n)+'</td>'+
        '<td>'+x.students.size+'</td></tr>').join('')||
        '<tr><td colspan="5">No hay preguntas que superen el umbral de revisión.</td></tr>',
      '</tbody></table></div>',
      '<p class="analyticsHint">Los errores repetidos pueden proceder de un mismo alumno. La tabla describe dificultades observadas, no diagnostica conceptos sin vincular la pregunta a un enunciado validado.</p>',
      '<h4 style="margin:18px 0 8px">👥 Seguimiento individual dentro del tema</h4>',
      '<div class="tablewrap"><table class="table"><thead><tr>',
      '<th>Código</th><th>Respuestas</th><th>Acierto</th><th>Practicadas / 40</th>',
      '<th>Dominadas</th><th>Dominio</th><th>Sesiones</th><th>Min activos</th><th>Evolución de acierto</th>',
      '</tr></thead><tbody>',
      studentRows.map(x=>'<tr><td><b>'+esc(x.code)+'</b></td><td>'+x.n+'</td><td>'+x.accuracy+
        '</td><td>'+x.coverage+' / 40</td><td>'+x.mastered+'</td><td>'+x.mastery+
        '</td><td>'+x.sessions+'</td><td>'+x.minutes+'</td><td>'+x.change+'</td></tr>').join(''),
      '</tbody></table></div>',
      '<p class="analyticsHint">Evolución: diferencia de acierto entre primera y última mitad de respuestas cronológicas (puntos porcentuales). Es descriptiva, no una medición causal del aprendizaje; sólo aparece con 10 o más respuestas.</p>'
    ].join('');
  }

  function v741ShowEx1Audit(){
    const view=document.getElementById('view-learning');
    if(!view)return;
    let card=document.getElementById('v741Ex1Audit');
    if(!card){
      card=document.createElement('section');
      card.id='v741Ex1Audit';
      card.className='card';
      card.style.marginBottom='14px';
      const analytics=view.querySelector('.analyticsGrid');
      if(analytics)analytics.before(card);
      else view.appendChild(card);
    }
    const data=state.learning||{};
    const gym=data.exam_gym||[];
    const rows=(state.students||[]).filter(s=>s.active!==false).map(s=>{
      const rec=v741RecoveryFor(s);
      const matches=gym.filter(x=>v741IsTopic1(x)&&v741Matches(s,x));
      const technical=matches.length===1?v741ExamScoreField(matches[0]):null;
      const score=rec?.score;
      const label=!rec?'Sin registro inequívoco':
        matches.length===0?'Oficial disponible · sin fila técnica':
        matches.length>1?'Revisar múltiples intentos':
        technical?'Comparación disponible':'Nota técnica no verificable';
      return {s,score,technical:technical?.value??null,label};
    });
    card.innerHTML=`
      <h3>📝 EX1 · consulta de calificación oficial</h3>
      <p class="subtle">Datos académicos y evidencias técnicas por separado. Si faltan fuentes, no se inventan notas ni se corrigen PP.</p>
      <div class="tablewrap"><table class="table">
        <thead><tr><th>Alumno</th><th>EX1 oficial</th><th>Intento técnico</th><th>Revisión</th></tr></thead>
        <tbody>${rows.map(x=>`<tr>
          <td>${esc(x.s.full_name||x.s.student_code||'—')}</td>
          <td><b>${x.score==null?'—':esc(Number(x.score).toFixed(2))+'/10'}</b></td>
          <td>${x.technical==null?'—':esc(Number(x.technical).toFixed(2))+'/10'}</td>
          <td>${esc(x.label)}</td>
        </tr>`).join('')||'<tr><td colspan="4">Sin alumnos cargados.</td></tr>'}</tbody>
      </table></div>`;
  }

  function v741EnsureEconomySection(){
    const view=document.getElementById('view-game');
    if(!view||document.getElementById('v741EconomySection'))return;

    const section=document.createElement('div');
    section.id='v741EconomySection';
    section.className='card';
    section.style.marginTop='14px';
    section.innerHTML=`
      <div class="sectionTitle">
        <div>
          <h3>🪙 Economía de Óganesones</h3>
          <p>Ganados acumulados, gastados y saldo actual. Ordenado por Og ganados.</p>
        </div>
        <button class="btn" id="v741EconomyRefresh">↻ Actualizar economía</button>
      </div>
      <div class="metrics grid" id="v741EconomyMetrics" style="margin-top:14px"></div>
      <div class="tablewrap">
        <table class="table">
          <thead>
            <tr>
              <th>#</th>
              <th>Código</th>
              <th>Alumno</th>
              <th>Og ganados</th>
              <th>Og gastados</th>
              <th>Saldo actual</th>
              <th>Movimientos</th>
              <th>Control</th>
            </tr>
          </thead>
          <tbody id="v741EconomyBody">
            <tr><td colspan="8" class="empty">Cargando economía…</td></tr>
          </tbody>
        </table>
      </div>
      <div class="analyticsHint" id="v741EconomyHint">
        El ranking académico sigue dependiendo exclusivamente de los PP.
      </div>
    `;
    view.appendChild(section);
    document.getElementById('v741EconomyRefresh').onclick=()=>loadGame(true);
  }

  function v741RenderEconomy(){
    v741EnsureEconomySection();
    const rows=[...v741EconomyRows].sort(
      (a,b)=>Number(b.earned||0)-Number(a.earned||0)||
             String(a.student_name||'').localeCompare(String(b.student_name||''),'es')
    );

    const metrics=document.getElementById('v741EconomyMetrics');
    const body=document.getElementById('v741EconomyBody');
    const hint=document.getElementById('v741EconomyHint');
    if(!metrics||!body)return;

    const verified=rows.filter(x=>x.complete);
    const totalEarned=verified.reduce((s,x)=>s+x.earned,0);
    const totalSpent=verified.reduce((s,x)=>s+x.spent,0);
    const totalBalance=verified.reduce((s,x)=>s+x.balance,0);
    const issues=rows.filter(x=>!x.complete||!x.coherent).length;

    metrics.innerHTML=[
      metric('🪙 Og ganados',totalEarned,'acumulado verificable: '+verified.length+' alumnos'),
      metric('🛒 Og gastados',totalSpent,'movimientos negativos verificables'),
      metric('👛 Saldo actual',totalBalance,'saldos verificables'),
      metric(issues?'⚠️ Revisar':'✅ Coherencia',issues,issues?'filas con error o diferencia':'ganados − gastados = saldo')
    ].join('');

    body.innerHTML=rows.map((x,i)=>`
      <tr>
        <td><b>${i+1}</b></td>
        <td><b>${esc(x.student_code||'—')}</b></td>
        <td>${esc(x.student_name||'—')}</td>
        <td><b>${x.earned==null?'—':esc(x.earned)}</b></td>
        <td>${x.spent==null?'—':esc(x.spent)}</td>
        <td><b>${x.balance==null?'—':esc(x.balance)}</b></td>
        <td>${x.movements==null?'—':esc(x.movements)}</td>
        <td>${
          x.error
            ?'<span class="status bad">Error de lectura</span>'
            :!x.complete
              ?'<span class="status warn">Datos incompletos</span>'
              :x.coherent
              ?'<span class="status ok">✓ Coherente</span>'
              :`<span class="status bad">${esc((x.earned-x.spent)-x.balance)} Og de diferencia</span>`
        }</td>
      </tr>
    `).join('')||'<tr><td colspan="8" class="empty">Sin movimientos de Óganesones.</td></tr>';

    if(hint){
      hint.textContent=`${rows.length} alumnos · ${rows.reduce((s,x)=>s+Number(x.movements||0),0)} movimientos. El ranking académico sigue dependiendo exclusivamente de los PP.`;
    }
  }

  const v741ProcessedStudents=new WeakSet();
  function v741PatchStudentLearning(d,sid){
    if(!d || v741ProcessedStudents.has(d))return;
    v741ProcessedStudents.add(d);
    const rec=v741RecoveryFor({student_id:sid,...(d.student||{})});
    if(!rec)return;
    d.__v741_official_ex1=rec.score;
    const t1=(d.topics||[]).find(v741IsTopic1);
    const sf=v741ExamScoreField(t1||{});
    if(sf){
      t1.exam_score_technical=sf.value;
      t1.exam_score_official=rec.score;
      const count=v741Number(d.summary?.exam_count),avg=v741Number(d.summary?.exam_average);
      if(count!==null&&count>0&&avg!==null){
        d.summary.exam_average=Math.max(0,Math.min(10,avg+(rec.score-sf.value)/count));
        const passed=v741Number(d.summary?.exam_passed);
        if(passed!==null)d.summary.exam_passed=Math.max(0,Math.min(count,
          passed+(sf.value<5&&rec.score>=5?1:0)-(sf.value>=5&&rec.score<5?1:0)));
        t1[sf.key]=rec.score;
        t1.exam_score_source='cenqal_grade_entries';
        d.__v741_recovered_ex1=true;
      }else d.__v741_pending_ex1=true;
    }else d.__v741_pending_ex1=true;
    for(const exam of (d.exams||[])){
      if(v741IsTopic1(exam)){
        exam.exam_score_official=rec.score;
        exam.exam_score_source_official='cenqal_grade_entries';
      }
    }
  }

  function v741RenderOfficialExamInStudentCard(){
    const d=state.studentDetail||{};
    const rec=v741OfficialEx1FromWorkspace(d);
    if(!rec||rec.ambiguous)return;

    const container=document.getElementById('studentSections');
    if(!container)return;

    let card=document.getElementById('v741OfficialExamCard');
    if(card)card.remove();

    card=document.createElement('details');
    card.id='v741OfficialExamCard';
    card.className='card';
    card.open=true;

    const technical=(d.exams||[])
      .find(x=>v741IsTopic1(x.session||x))
      ?.attempt?.score_out_of_10;

    card.innerHTML=`
      <summary>📝 EX1 · calificación oficial recuperada</summary>
      <div class="detailBody">
        <div class="miniList">
          <div class="miniRow"><span>Nota oficial CENQAL</span><b>${esc(Number(rec.score).toFixed(1))}/10</b></div>
          <div class="miniRow"><span>Fuente</span><b>Registro oficial de calificación</b></div>
          <div class="miniRow"><span>Intento técnico original</span><b>${technical==null?'—':esc(Number(technical).toFixed(1)+'/10')}</b></div>
        </div>
        <div class="note" style="margin-top:10px">La nota oficial se usa para la lectura académica. El intento técnico se conserva como evidencia y no se modifica.</div>
      </div>
    `;
    container.prepend(card);
  }

  loadGame=async function(force=false){
    v741EnsureEconomySection();
    const course=v741CourseKey();
    const result=await _loadGame(force);
    if(course!==v741CourseKey())return result;
    try{
      await v741LoadWorkspaces(force);
      if(course!==v741CourseKey())return result;
      v741RenderEconomy();
      const warning=document.getElementById('v741EconomyHint');
      if(warning)warning.textContent+=' Los PP de referencia proceden de pruebas técnicas: las correcciones permanecen bloqueadas durante la auditoría.';
      // Esta rama es de comprobación: los ajustes PP/Og quedan deshabilitados.
      const body=document.getElementById('gameBody');
      body?.querySelectorAll('button').forEach(b=>{
        b.disabled=true;
        b.title='Bloqueado en revisión v74.1: no registrar movimientos académicos.';
        b.textContent='Solo consulta';
      });
    }catch(e){
      const body=document.getElementById('v741EconomyBody');
      if(body)body.innerHTML=`<tr><td colspan="8" class="empty">${esc(e.message||e)}</td></tr>`;
    }
    return result;
  };

  loadLearning=async function(force=false){
    const course=v741CourseKey();
    const result=await _loadLearning(force);
    if(course!==v741CourseKey())return result;
    try{
      await v741LoadWorkspaces(force);
      if(course!==v741CourseKey())return result;
      v741ApplyRecoveredEx1ToLearning(state.learning);
      renderLearning();
      v741EnsureLearningNotice();
      v741ShowEx1Audit();
      v741RenderTopicDashboard();
    }catch(e){
      console.warn('CENQAL v74.1 EX1 recovery:',e);
      v741EnsureLearningNotice();
    }
    return result;
  };

  loadStudentLearningAnalytics=async function(sid){
    const course=v741CourseKey();
    const result=await _loadStudentLearningAnalytics(sid);
    if(course!==v741CourseKey()||String(state.currentStudentId)!==String(sid))return result;
    try{
      const student=(state.students||[]).find(s=>String(studentIdOf(s))===String(sid));
      if(student)await v741WorkspaceForStudent(student,false);
      if(!v741RecoveredByStudent.size)await v741LoadWorkspaces(false);
      if(course!==v741CourseKey()||String(state.currentStudentId)!==String(sid))return result;
      v741PatchStudentLearning(state.studentLearning,sid);
      renderStudentLearningAnalytics();
    }catch(e){
      console.warn('CENQAL v74.1 individual EX1 recovery:',e);
    }
    return result;
  };

  renderStudentDetail=function(){
    const result=_renderStudentDetail();
    try{v741RenderOfficialExamInStudentCard()}catch(e){console.warn(e)}
    return result;
  };

  if(_clearCourseScopedState){
    clearCourseScopedState=function(){
      const result=_clearCourseScopedState();
      v741WorkspaceCourseKey=null;
      v741WorkspaceCache.clear();
      v741EconomyRows=[];
      v741RecoveredByStudent=new Map();
      v741Generation++;
      return result;
    };
  }


  // Marca inequívoca para distinguir la vista de pruebas de producción.
  (function v741MarkPreview(){
    if(document.getElementById('v741PreviewNotice'))return;
    const notice=document.createElement('div');
    notice.id='v741PreviewNotice';
    notice.setAttribute('role','status');
    notice.style.cssText='position:fixed;top:0;left:0;right:0;z-index:99998;'+
      'padding:7px 12px;text-align:center;background:#172b4d;color:#fff;'+
      'font:600 12px/1.4 system-ui,sans-serif;box-shadow:0 2px 8px #0004';
    notice.textContent='🧪 CENQAL v74.1 · VISTA DE PRUEBAS · SOLO LECTURA';
    document.body.appendChild(notice);
  })();

  let v741PreparedExcelUrl=null;
  const v741ExcelMime='application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

  function v741ExcelMessage(message,isError=false){
    const el=document.getElementById('v741ExcelFeedback');
    if(el){
      el.textContent=message;
      el.style.color=isError?'#b91c1c':'#264367';
    }
  }

  // El trabajo asíncrono de Supabase termina ANTES del clic de descarga.
  // El clic explícito conserva la activación del usuario en Chrome y WebView.
  window.v741PrepareExcel=function(workbook,filename){
    if(typeof XLSX==='undefined'||typeof XLSX.write!=='function'){
      throw new Error('No se ha cargado el generador de Excel.');
    }
    const bytes=XLSX.write(workbook,{bookType:'xlsx',type:'array',compression:true});
    const blob=new Blob([bytes],{type:v741ExcelMime});
    if(blob.size===0)throw new Error('El Excel generado está vacío.');
    const safeName=String(filename||'CENQAL_Analytics.xlsx')
      .replace(/[\\/:*?"<>|]+/g,'_').slice(0,130);

    const url=URL.createObjectURL(blob);
    if(v741PreparedExcelUrl)URL.revokeObjectURL(v741PreparedExcelUrl);
    v741PreparedExcelUrl=url;

    let panel=document.getElementById('v741ExcelPanel');
    if(!panel){
      panel=document.createElement('section');
      panel.id='v741ExcelPanel';
      panel.setAttribute('role','dialog');
      panel.setAttribute('aria-label','Descargar Excel de CENQAL');
      panel.style.cssText='position:fixed;left:12px;right:12px;bottom:12px;'+
        'bottom:max(12px,env(safe-area-inset-bottom));max-width:560px;'+
        'margin:0 auto;z-index:99999;box-sizing:border-box;'+
        'background:#fff;color:#17324d;border:2px solid #3a789b;'+
        'border-radius:16px;padding:16px;box-shadow:0 5px 30px #0006;'+
        'font:14px/1.5 system-ui,sans-serif';
      document.body.appendChild(panel);
    }
    panel.innerHTML=[
      '<div style="display:flex;justify-content:space-between;gap:8px;align-items:start">',
      '<b style="font-size:16px">📊 Excel preparado</b>',
      '<button type="button" id="v741ExcelClose" aria-label="Cerrar" ',
      'style="border:0;background:transparent;font-size:22px;color:#17324d">×</button></div>',
      '<p id="v741ExcelName" style="margin:7px 0;overflow-wrap:anywhere"></p>',
      '<div style="display:flex;flex-wrap:wrap;gap:9px;margin:12px 0">',
      '<a id="v741ExcelDownload" href="#" style="display:inline-block;padding:10px 14px;',
      'background:#1f618d;color:white;border-radius:8px;text-decoration:none;',
      'font-weight:700">⬇ Descargar Excel</a>',
      '<button type="button" id="v741ExcelShare" style="padding:10px 14px;',
      'border:1px solid #1f618d;border-radius:8px;background:#edf4fc;',
      'color:#17324d;font-weight:700">Compartir / Guardar</button></div>',
      '<p id="v741ExcelFeedback" aria-live="polite"',
      ' style="margin:6px 0;color:#264367;font-size:13px">',
      'Archivo listo. Pulsa Descargar o Compartir; todavía no se ha guardado.</p>'
    ].join('');
    document.getElementById('v741ExcelName').textContent=safeName;
    const download=document.getElementById('v741ExcelDownload');
    download.href=url;
    download.download=safeName;
    download.addEventListener('click',()=>{
      v741ExcelMessage('Descarga solicitada. Comprueba Descargas; si no aparece, prueba Compartir / Guardar.');
    });

    const share=document.getElementById('v741ExcelShare');
    const file=typeof File==='function'?new File([blob],safeName,{type:v741ExcelMime}):null;
    let canShare=false;
    try{
      canShare=Boolean(file&&typeof navigator.share==='function'&&
        typeof navigator.canShare==='function'&&navigator.canShare({files:[file]}));
    }catch(_){canShare=false}
    if(!canShare){
      share.hidden=true;
    }else{
      share.addEventListener('click',async()=>{
        try{
          await navigator.share({files:[file],title:'Excel CENQAL'});
          v741ExcelMessage('Se ha abierto el menú de compartir. Comprueba dónde guardaste el archivo.');
        }catch(error){
          if(error?.name!=='AbortError')
            v741ExcelMessage('No se pudo compartir. Usa Descargar Excel.',true);
        }
      });
    }
    document.getElementById('v741ExcelClose').addEventListener('click',()=>{
      panel.remove();
      // No revocar mientras el navegador pueda estar procesando la descarga.
    });
    return {filename:safeName,bytes:blob.size,shareAvailable:canShare};
  };

  window.v741AppendOfficialEx1Audit=function(wb,anonymized=false,anonMap=null,sid=null){
    const rows=[];
    const students=sid==null?(state.students||[]):
      (state.students||[]).filter(x=>String(studentIdOf(x))===String(sid));
    for(const student of students){
      const rec=v741RecoveryFor(student);
      const code=String(student.student_code||'');
      const alias=anonMap?.get(code)||'ANON';
      rows.push({
        codigo:anonymized?alias:code,
        alumno:anonymized?alias:studentName(student),
        ex1_oficial:rec?.score??'',
        estado:rec?'identificada':'sin_nota_inequivoca_o_conflicto',
        nota:'Solo lectura. Los registros técnicos originales figuran en EXAMENES / GYM_EXAMEN.'
      });
    }
    if(typeof v69AddSheet==='function')v69AddSheet(wb,'EX1_OFICIAL',rows,[22,32,22,34,72]);
  };
  v741EnsureEconomySection();
})();
