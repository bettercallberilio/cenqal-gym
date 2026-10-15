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
