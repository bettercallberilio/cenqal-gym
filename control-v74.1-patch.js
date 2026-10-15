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

  const _loadGame = loadGame;
  const _loadLearning = loadLearning;
  const _loadStudentLearningAnalytics = loadStudentLearningAnalytics;
  const _renderStudentDetail = renderStudentDetail;
  const _clearCourseScopedState = typeof clearCourseScopedState === 'function' ? clearCourseScopedState : null;

  function v741CourseKey(){
    return String(
      state?.selectedCourseId ??
      state?.snapshot?.course?.id ??
      state?.snapshot?.course?.academic_year ??
      'current'
    );
  }

  function v741StudentKey(value){
    return String(value ?? '').trim().toLowerCase();
  }

  function v741StudentKeys(obj={}){
    const out=[];
    for(const value of [
      obj.student_id,
      obj.id,
      obj.cenqal_student_id,
      obj.student_code,
      obj.telegram_user_id
    ]){
      const k=v741StudentKey(value);
      if(k && !out.includes(k))out.push(k);
    }
    return out;
  }

  function v741ResetCacheIfCourseChanged(){
    const key=v741CourseKey();
    if(v741WorkspaceCourseKey!==key){
      v741WorkspaceCourseKey=key;
      v741WorkspaceCache.clear();
      v741EconomyRows=[];
      v741RecoveredByStudent=new Map();
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
    const grades=Array.isArray(workspace?.analytics?.grades)
      ?workspace.analytics.grades
      :[];

    const candidates=grades.filter(g=>{
      const exact=[
        g.item_code,
        g.activity_code,
        g.exam_code,
        g.source_code
      ].some(v=>String(v||'').trim().toUpperCase()===V741_EXAM_CODE);

      if(exact)return true;

      const text=[
        g.item_code,
        g.item_title,
        g.activity_code,
        g.activity_title,
        g.source_code,
        g.source_type
      ].map(v=>String(v||'').toUpperCase()).join(' ');

      return /(^|[^A-Z0-9])EX\s*0?1([^A-Z0-9]|$)/.test(text);
    });

    const valid=candidates
      .map(g=>({
        row:g,
        score:Number(
          g.effective_score ??
          g.score_out_of_10 ??
          g.score ??
          g.grade
        ),
        time:new Date(g.updated_at||g.created_at||0).getTime()||0
      }))
      .filter(x=>Number.isFinite(x.score)&&x.score>=0&&x.score<=10)
      .sort((a,b)=>b.time-a.time);

    if(!valid.length)return null;

    return {
      score:valid[0].score,
      row:valid[0].row
    };
  }

  async function v741LoadWorkspaces(force=false){
    v741ResetCacheIfCourseChanged();
    if(!state.students?.length){
      await loadStudents(force).catch(()=>null);
    }

    const students=(state.students||[]).filter(s=>s.active!==false);
    const workspaces=await v741MapLimit(
      students,
      4,
      async s=>({student:s,workspace:await v741WorkspaceForStudent(s,force)})
    );

    const recovered=new Map();
    const economy=[];

    for(const item of workspaces){
      const s=item.student||{};
      const w=item.workspace||{};
      const official=v741OfficialEx1FromWorkspace(w);

      if(official){
        for(const key of v741StudentKeys(s)){
          recovered.set(key,official);
        }
        for(const key of v741StudentKeys(w.student||{})){
          recovered.set(key,official);
        }
      }

      const events=Array.isArray(w.gamification_events)?w.gamification_events:[];
      const earned=events.reduce(
        (sum,e)=>sum+Math.max(0,Number(e.oganeson_delta||0)),
        0
      );
      const spent=events.reduce(
        (sum,e)=>sum+Math.abs(Math.min(0,Number(e.oganeson_delta||0))),
        0
      );
      const ledger=events.reduce(
        (sum,e)=>sum+Number(e.oganeson_delta||0),
        0
      );

      const game=(state.game||[]).find(g=>{
        const sk=v741StudentKeys(s);
        return v741StudentKeys(g).some(k=>sk.includes(k));
      })||{};

      const balance=Number(
        w.gamification_profile?.oganeson_balance ??
        game.oganeson_balance ??
        0
      );

      economy.push({
        student_id:studentIdOf(s),
        student_code:s.student_code||w.student?.student_code||game.student_code||'',
        student_name:s.full_name||studentName(s)||game.student_name||'',
        earned,
        spent,
        balance,
        ledger,
        movements:events.length,
        coherent:Math.abs((earned-spent)-balance)<0.000001,
        error:w.__v741_error||''
      });
    }

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
      const v=Number(row?.[key]);
      if(Number.isFinite(v)&&v>=0&&v<=10)return {key,value:v};
    }
    return null;
  }

  function v741IsTopic1(row={}){
    const topic=Number(row.topic_number ?? row.topic ?? row.exam_topic);
    if(topic===V741_TOPIC)return true;
    const code=String(row.exam_code||row.item_code||row.activity_code||'').toUpperCase();
    return code===V741_EXAM_CODE;
  }

  function v741ApplyRecoveredEx1ToLearning(d){
    if(!d||!v741RecoveredByStudent.size)return d;

    const changes=[];
    const examGym=Array.isArray(d.exam_gym)?d.exam_gym:[];

    for(const row of examGym){
      if(!v741IsTopic1(row))continue;
      const rec=v741RecoveryFor(row);
      const sf=v741ExamScoreField(row);
      if(!rec||!sf)continue;

      const old=sf.value;
      const next=Number(rec.score);
      if(!Number.isFinite(next)||old===next)continue;

      row[sf.key]=next;
      row.exam_score_source='cenqal_grade_entries';
      row.exam_score_recovered=true;
      changes.push({row,old,next,delta:next-old});
    }

    for(const s of (d.students||[])){
      const rec=v741RecoveryFor(s);
      if(!rec)continue;

      const own=changes.find(ch=>{
        const a=v741StudentKeys(ch.row);
        return v741StudentKeys(s).some(k=>a.includes(k));
      });
      if(!own)continue;

      const count=Number(s.exam_count||0);
      const avg=Number(s.exam_average);
      if(count>0&&Number.isFinite(avg)){
        s.exam_average=Math.max(0,Math.min(10,(avg*count-own.old+own.next)/count));
      }

      const passed=Number(s.exam_passed);
      if(Number.isFinite(passed)){
        s.exam_passed=passed+(own.old<5&&own.next>=5?1:0)-(own.old>=5&&own.next<5?1:0);
      }

      s.exam1_official_score=own.next;
      s.exam1_score_source='cenqal_grade_entries';
    }

    const topic1=(d.topics||[]).find(v741IsTopic1);
    if(topic1&&changes.length){
      const count=Number(topic1.exam_count||0);
      const avg=Number(topic1.exam_average);
      const delta=changes.reduce((sum,x)=>sum+x.delta,0);
      if(count>0&&Number.isFinite(avg)){
        topic1.exam_average=Math.max(0,Math.min(10,avg+delta/count));
      }
      topic1.exam_score_source='cenqal_grade_entries';
    }

    const weighted=(d.students||[])
      .filter(s=>Number(s.exam_count||0)>0&&Number.isFinite(Number(s.exam_average)))
      .reduce((acc,s)=>{
        const c=Number(s.exam_count||0);
        acc.sum+=Number(s.exam_average)*c;
        acc.count+=c;
        return acc;
      },{sum:0,count:0});

    if(d.summary&&weighted.count){
      d.summary.exam_average=weighted.sum/weighted.count;
    }

    d.__v741_recovered_ex1=changes.length;
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
    const count=Number(state.learning?.__v741_recovered_ex1||0);
    note.innerHTML=count
      ?`✅ <b>EX1 recuperado:</b> ${count} resultados se muestran con la calificación oficial registrada en CENQAL. Los intentos técnicos originales se conservan sin modificarse.`
      :'ℹ️ EX1: no se ha aplicado ninguna sustitución de nota oficial en esta carga.';
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

    const totalEarned=rows.reduce((s,x)=>s+Number(x.earned||0),0);
    const totalSpent=rows.reduce((s,x)=>s+Number(x.spent||0),0);
    const totalBalance=rows.reduce((s,x)=>s+Number(x.balance||0),0);
    const issues=rows.filter(x=>x.error||!x.coherent).length;

    metrics.innerHTML=[
      metric('🪙 Og ganados',totalEarned,'acumulado del grupo'),
      metric('🛒 Og gastados',totalSpent,'canjes y movimientos negativos'),
      metric('👛 Saldo actual',totalBalance,'moneda disponible'),
      metric(issues?'⚠️ Revisar':'✅ Coherencia',issues,issues?'filas con error o diferencia':'ganados − gastados = saldo')
    ].join('');

    body.innerHTML=rows.map((x,i)=>`
      <tr>
        <td><b>${i+1}</b></td>
        <td><b>${esc(x.student_code||'—')}</b></td>
        <td>${esc(x.student_name||'—')}</td>
        <td><b>${esc(x.earned)}</b></td>
        <td>${esc(x.spent)}</td>
        <td><b>${esc(x.balance)}</b></td>
        <td>${esc(x.movements)}</td>
        <td>${
          x.error
            ?`<span class="status bad" title="${esc(x.error)}">Error de lectura</span>`
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

  function v741PatchStudentLearning(d, sid){
    if(!d)return;
    const candidate={student_id:sid,...(d.student||{}),...(d.summary||{})};
    const rec=v741RecoveryFor(candidate);
    if(!rec)return;

    const t1=(d.topics||[]).find(v741IsTopic1);
    const sf=v741ExamScoreField(t1||{});
    if(sf){
      const old=sf.value;
      const next=Number(rec.score);
      if(old!==next){
        t1[sf.key]=next;
        t1.exam_score_source='cenqal_grade_entries';
        const count=Number(d.summary?.exam_count||0);
        const avg=Number(d.summary?.exam_average);
        if(count>0&&Number.isFinite(avg)){
          d.summary.exam_average=Math.max(0,Math.min(10,(avg*count-old+next)/count));
        }
        const passed=Number(d.summary?.exam_passed);
        if(Number.isFinite(passed)){
          d.summary.exam_passed=passed+(old<5&&next>=5?1:0)-(old>=5&&next<5?1:0);
        }
      }
    }

    for(const e of (d.exams||[])){
      if(!v741IsTopic1(e))continue;
      const esf=v741ExamScoreField(e);
      if(esf){
        e[esf.key]=Number(rec.score);
        e.exam_score_source='cenqal_grade_entries';
      }
    }
    d.__v741_recovered_ex1=true;
  }

  function v741RenderOfficialExamInStudentCard(){
    const d=state.studentDetail||{};
    const rec=v741OfficialEx1FromWorkspace(d);
    if(!rec)return;

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
    const result=await _loadGame(force);
    try{
      await v741LoadWorkspaces(force);
      v741RenderEconomy();
    }catch(e){
      const body=document.getElementById('v741EconomyBody');
      if(body)body.innerHTML=`<tr><td colspan="8" class="empty">${esc(e.message||e)}</td></tr>`;
    }
    return result;
  };

  loadLearning=async function(force=false){
    const result=await _loadLearning(force);
    try{
      await v741LoadWorkspaces(force);
      v741ApplyRecoveredEx1ToLearning(state.learning);
      renderLearning();
      v741EnsureLearningNotice();
    }catch(e){
      console.warn('CENQAL v74.1 EX1 recovery:',e);
      v741EnsureLearningNotice();
    }
    return result;
  };

  loadStudentLearningAnalytics=async function(sid){
    const result=await _loadStudentLearningAnalytics(sid);
    try{
      const student=(state.students||[]).find(s=>String(studentIdOf(s))===String(sid));
      if(student)await v741WorkspaceForStudent(student,false);
      if(!v741RecoveredByStudent.size)await v741LoadWorkspaces(false);
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
      return result;
    };
  }

  v741EnsureEconomySection();
})();
