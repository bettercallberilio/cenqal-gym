/* ==========================================================================
   CENQAL GYM v73 · TRAZABILIDAD FIABLE + TIEMPO ACTIVO POR TEMA

   Sustituye gym-telemetry-v72.js cuando el SQL v73 esté instalado.

   Principios:
   - Una respuesta identificada se guarda en servidor ANTES de consolidarse
     localmente.
   - Si la sincronización falla, el alumno lo ve y puede reintentar.
   - El progreso local anterior se conserva como snapshot RECUPERADO separado.
   - El tiempo se registra solo con ventana visible + pregunta activa + actividad
     reciente. No es "tiempo con la página abierta".
   - Para usuarios identificados se evita duplicar telemetría anónima.
   ========================================================================== */

(function () {
  const TRACKING_TOKEN =
    (typeof GYM_PARAMS !== 'undefined' && GYM_PARAMS)
      ? (GYM_PARAMS.get('gt') || '')
      : '';

  const PREVIEW_MODE =
    (typeof GYM_PARAMS !== 'undefined' && GYM_PARAMS)
      ? (GYM_PARAMS.get('preview') === '1')
      : false;

  if (PREVIEW_MODE || !TRACKING_TOKEN) {
    console.debug('CENQAL Gym v73: vista sin trazabilidad de alumno.');
    return;
  }

  if (
    typeof GYM_SBURL === 'undefined' ||
    typeof GYM_SBKEY === 'undefined' ||
    !GYM_SBURL ||
    !GYM_SBKEY
  ) {
    console.debug('CENQAL Gym v73: faltan parámetros públicos de Supabase.');
    return;
  }

  const HEARTBEAT_MS = 20000;
  const ACTIVE_IDLE_LIMIT_MS = 90000;

  let v73LastInteractionAt = Date.now();
  let v73LastTickAt = Date.now();
  let v73HeartbeatBusy = false;
  let v73TopicMetrics = [];
  let v73SyncBusy = false;

  function v73Touch() {
    v73LastInteractionAt = Date.now();
  }

  ['pointerdown', 'touchstart', 'keydown', 'scroll'].forEach(evt => {
    window.addEventListener(evt, v73Touch, { passive: true });
  });

  async function v73Rpc(name, payload) {
    const response = await fetch(
      `${GYM_SBURL}/rest/v1/rpc/${name}`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'apikey': GYM_SBKEY,
          'Authorization': `Bearer ${GYM_SBKEY}`
        },
        body: JSON.stringify(payload || {})
      }
    );

    const raw = await response.text();

    if (!response.ok) {
      throw new Error(
        `RPC ${name} · HTTP ${response.status}` +
        (raw ? ` · ${raw.slice(0, 300)}` : '')
      );
    }

    if (!raw) return {};

    try {
      return JSON.parse(raw);
    } catch (_) {
      return {};
    }
  }

  function v73EnsureStyles() {
    if (document.getElementById('cenqal-gym-v73-style')) return;

    const style = document.createElement('style');
    style.id = 'cenqal-gym-v73-style';
    style.textContent = `
      .v73-sync{
        margin:12px 0;padding:10px 12px;border-radius:12px;
        font-size:13px;line-height:1.4
      }
      .v73-sync.info{background:#eef6ff;border:1px solid #bfdcff}
      .v73-sync.ok{background:#eefaf3;border:1px solid #b9e5ca}
      .v73-sync.error{background:#fff1f1;border:1px solid #f0b8b8}
      .v73-sync button{
        margin-top:8px;border:0;border-radius:10px;padding:8px 11px;
        font-weight:700;cursor:pointer
      }
      .v73-topic-time{
        display:block;margin-top:5px;font-size:11px;opacity:.82
      }
    `;
    document.head.appendChild(style);
  }

  function v73Banner(message, kind = 'info', retry = false) {
    v73EnsureStyles();

    let box = document.getElementById('v73SyncStatus');
    if (!box) {
      box = document.createElement('div');
      box.id = 'v73SyncStatus';

      const screen = document.getElementById('screen');
      if (screen) {
        screen.prepend(box);
      } else {
        document.body.prepend(box);
      }
    }

    box.className = `v73-sync ${kind}`;
    box.innerHTML =
      `<b>${kind === 'error' ? '⚠️' : kind === 'ok' ? '✅' : '🔄'} ` +
      `${String(message)}</b>` +
      (
        retry
          ? `<br><button type="button" onclick="cenqalGymRetrySync()">Reintentar sincronización</button>`
          : ''
      );
  }

  function v73SetAnswerButtonsDisabled(disabled) {
    document.querySelectorAll('.answer').forEach(btn => {
      btn.disabled = Boolean(disabled);
    });
  }

  async function v73EnsureServerSession(session) {
    if (!session) {
      throw new Error('No hay sesión local activa.');
    }

    if (session.serverSessionId) {
      return String(session.serverSessionId);
    }

    const result = await v73Rpc(
      'cenqal_gym_web_start_v72',
      {
        p_token: TRACKING_TOKEN,
        p_topic_number: Number(session.topic),
        p_mode: String(session.mode || 'full'),
        p_question_codes: Array.isArray(session.order)
          ? session.order
          : [],
        p_current_index: Number(session.index || 0),
        p_correct_answers: Number(session.correct || 0)
      }
    );

    if (!result || !result.ok || !result.session_id) {
      throw new Error('No se pudo crear la sesión identificada del Gym.');
    }

    session.serverSessionId = String(result.session_id);

    if (
      typeof saveJSON === 'function' &&
      typeof keySession === 'function'
    ) {
      await saveJSON(
        keySession(session.topic),
        session
      );
    }

    return session.serverSessionId;
  }

  async function v73SynchronizeCurrentSession() {
    if (v73SyncBusy) return false;

    const session = state ? state.session : null;
    if (!session) return false;

    v73SyncBusy = true;
    v73SetAnswerButtonsDisabled(true);
    v73Banner('Sincronizando la sesión identificada…', 'info');

    try {
      await v73EnsureServerSession(session);
      v73Touch();
      v73SetAnswerButtonsDisabled(false);
      v73Banner(
        'Sesión sincronizada. Tu trabajo y el tiempo activo quedarán vinculados a tu perfil.',
        'ok'
      );
      return true;
    } catch (error) {
      console.debug('CENQAL Gym v73 · fallo de sincronización:', error);
      v73SetAnswerButtonsDisabled(true);
      v73Banner(
        'No se ha podido sincronizar esta sesión. No respondas todavía: reintenta o vuelve a abrir el Gym desde Berilio.',
        'error',
        true
      );
      return false;
    } finally {
      v73SyncBusy = false;
    }
  }

  window.cenqalGymRetrySync = async function () {
    await v73SynchronizeCurrentSession();
  };

  // ------------------------------------------------------------------------
  // INICIO: el alumno no puede responder hasta tener serverSessionId.
  // ------------------------------------------------------------------------
  const v73StartTrainingBase = startTraining;

  startTraining = async function (topic, mode) {
    const previousSession = state ? state.session : null;

    await v73StartTrainingBase(topic, mode);

    const session = state ? state.session : null;

    if (
      !session ||
      session === previousSession ||
      Number(session.topic) !== Number(topic)
    ) {
      return;
    }

    v73Touch();
    await v73SynchronizeCurrentSession();
  };

  window.startTraining = startTraining;

  // ------------------------------------------------------------------------
  // REANUDACIÓN: misma regla de sincronización obligatoria.
  // ------------------------------------------------------------------------
  const v73ResumeSessionBase = resumeSession;

  resumeSession = async function (topic) {
    await v73ResumeSessionBase(topic);

    if (state && state.session) {
      v73Touch();
      await v73SynchronizeCurrentSession();
    }
  };

  window.resumeSession = resumeSession;

  // ------------------------------------------------------------------------
  // PREGUNTA MOSTRADA = interacción reciente para el reloj activo.
  // ------------------------------------------------------------------------
  if (typeof showCurrent === 'function') {
    const v73ShowCurrentBase = showCurrent;

    showCurrent = function () {
      v73Touch();
      return v73ShowCurrentBase.apply(this, arguments);
    };

    window.showCurrent = showCurrent;
  }

  // ------------------------------------------------------------------------
  // RESPUESTA:
  // 1) servidor identificado;
  // 2) solo si servidor OK, progreso local/feedback.
  // Además se silencia el logger anónimo del cliente identificado.
  // ------------------------------------------------------------------------
  const v73AnswerBase = answer;

  answer = async function (visibleIndex) {
    if (!state || state.answered || v73SyncBusy) return;

    const session = state.session;
    const question = state.currentQuestion;
    const chosen =
      state.optionView &&
      state.optionView[visibleIndex]
        ? state.optionView[visibleIndex]
        : null;

    if (!session || !question || !chosen) {
      v73Banner(
        'No se puede identificar esta respuesta. Vuelve a abrir el entrenamiento.',
        'error'
      );
      return;
    }

    const position =
      Number.isFinite(Number(session.index))
        ? Number(session.index) + 1
        : null;

    let responseTimeMs = null;
    try {
      if (typeof questionShownAt !== 'undefined') {
        responseTimeMs = Math.max(
          0,
          Math.min(
            3600000,
            Date.now() - Number(questionShownAt || Date.now())
          )
        );
      }
    } catch (_) {}

    v73SyncBusy = true;
    v73SetAnswerButtonsDisabled(true);
    v73Banner('Guardando respuesta identificada…', 'info');

    try {
      const serverSessionId =
        await v73EnsureServerSession(session);

      const result = await v73Rpc(
        'cenqal_gym_web_answer_v73',
        {
          p_token: TRACKING_TOKEN,
          p_session_id: serverSessionId,
          p_question_code: String(question.id || ''),
          p_selected_index: Number(chosen.originalIndex),
          p_position: position,
          p_response_time_ms: responseTimeMs
        }
      );

      if (!result || !result.ok) {
        throw new Error('El servidor no confirmó la respuesta.');
      }

      /*
       * El index original registra además una telemetría anónima.
       * En modo identificado v73 la anulamos SOLO durante esta llamada,
       * porque ya hemos guardado cenqal_question_responses con UID.
       */
      let savedAnonymousLogger = null;
      let anonymousLoggerWasFunction = false;

      try {
        if (typeof logGymResponse === 'function') {
          savedAnonymousLogger = logGymResponse;
          anonymousLoggerWasFunction = true;
          logGymResponse = function () {};
        }

        await v73AnswerBase(visibleIndex);
      } finally {
        if (anonymousLoggerWasFunction) {
          logGymResponse = savedAnonymousLogger;
        }
      }

      v73Touch();
      v73Banner('Respuesta guardada y sincronizada.', 'ok');

    } catch (error) {
      console.debug(
        'CENQAL Gym v73 · respuesta NO consolidada:',
        error
      );

      // El progreso local no se ha consolidado porque v73AnswerBase no se llamó.
      v73SetAnswerButtonsDisabled(false);
      v73Banner(
        'No se ha guardado la respuesta. Comprueba la conexión y vuelve a pulsarla. Si persiste, reabre el Gym desde Berilio.',
        'error'
      );
    } finally {
      v73SyncBusy = false;
    }
  };

  window.answer = answer;

  // ------------------------------------------------------------------------
  // PAUSA: se intenta marcar en servidor y después se conserva el flujo local.
  // ------------------------------------------------------------------------
  const v73PauseTrainingBase = pauseTraining;

  pauseTraining = async function () {
    const session = state ? state.session : null;
    const serverSessionId =
      session ? session.serverSessionId : null;

    if (serverSessionId) {
      try {
        await v73Rpc(
          'cenqal_gym_web_pause_v72',
          {
            p_token: TRACKING_TOKEN,
            p_session_id: String(serverSessionId)
          }
        );
      } catch (error) {
        console.debug(
          'CENQAL Gym v73 · no se pudo marcar pausa:',
          error
        );
      }
    }

    return await v73PauseTrainingBase();
  };

  window.pauseTraining = pauseTraining;

  // ------------------------------------------------------------------------
  // TIEMPO ACTIVO:
  // - ventana visible
  // - pregunta actualmente mostrada
  // - interacción en los últimos 90 s
  // - bucket idempotente de 20 s
  // ------------------------------------------------------------------------
  async function v73Heartbeat() {
    const now = Date.now();
    const elapsedSeconds = Math.max(
      1,
      Math.min(
        20,
        Math.round((now - v73LastTickAt) / 1000)
      )
    );

    v73LastTickAt = now;

    if (v73HeartbeatBusy) return;
    if (document.visibilityState !== 'visible') return;
    if ((now - v73LastInteractionAt) > ACTIVE_IDLE_LIMIT_MS) return;

    const session = state ? state.session : null;
    if (!session || !session.serverSessionId) return;

    // Solo contabilizamos tiempo de trabajo cuando hay pregunta en pantalla.
    if (!document.querySelector('.question')) return;

    v73HeartbeatBusy = true;

    try {
      const bucketMs =
        Math.floor(now / HEARTBEAT_MS) * HEARTBEAT_MS;

      await v73Rpc(
        'cenqal_gym_web_activity_v73',
        {
          p_token: TRACKING_TOKEN,
          p_session_id: String(session.serverSessionId),
          p_bucket_start: new Date(bucketMs).toISOString(),
          p_active_seconds: elapsedSeconds
        }
      );
    } catch (error) {
      console.debug(
        'CENQAL Gym v73 · heartbeat no registrado:',
        error
      );
    } finally {
      v73HeartbeatBusy = false;
    }
  }

  setInterval(v73Heartbeat, HEARTBEAT_MS);

  document.addEventListener('visibilitychange', () => {
    v73LastTickAt = Date.now();
    if (document.visibilityState === 'visible') {
      v73Touch();
    }
  });

  // ------------------------------------------------------------------------
  // RECUPERACIÓN DE PROGRESO LOCAL PREVIO
  // Solo resumen; no genera sesiones, intentos ni horas.
  // ------------------------------------------------------------------------
  async function v73ImportLocalSnapshots() {
    if (
      typeof mastery !== 'function'
    ) return;

    for (let topic = 1; topic <= 8; topic++) {
      try {
        const m = await mastery(topic);
        const rows = Object.values(m || {});

        if (!rows.length) continue;

        const practiced = rows.length;
        const mastered = rows.filter(x => x && x.mastered === true).length;
        const wrong = rows.filter(
          x => x && x.mastered !== true && x.lastCorrect === false
        ).length;
        const learning = Math.max(
          0,
          practiced - mastered - wrong
        );

        const lastMs = rows.reduce((acc, x) => {
          const n = Number(x && x.updatedAt ? x.updatedAt : 0);
          return Number.isFinite(n) ? Math.max(acc, n) : acc;
        }, 0);

        await v73Rpc(
          'cenqal_gym_local_snapshot_v73',
          {
            p_token: TRACKING_TOKEN,
            p_topic_number: topic,
            p_practiced_questions: practiced,
            p_mastered_questions: mastered,
            p_wrong_questions: wrong,
            p_learning_questions: learning,
            p_client_updated_at:
              lastMs > 0
                ? new Date(lastMs).toISOString()
                : new Date().toISOString()
          }
        );
      } catch (error) {
        console.debug(
          `CENQAL Gym v73 · snapshot local T${topic} no importado:`,
          error
        );
      }
    }
  }

  // ------------------------------------------------------------------------
  // MÉTRICAS PERSONALES POR TEMA Y HORAS EN EL PROPIO GYM
  // ------------------------------------------------------------------------
  function v73FormatTopicTime(hours) {
    const h = Number(hours || 0);

    if (!Number.isFinite(h) || h <= 0) {
      return '0 min activos';
    }

    const minutes = Math.round(h * 60);

    if (minutes < 60) {
      return `${minutes} min activos`;
    }

    const wholeHours = Math.floor(minutes / 60);
    const rem = minutes % 60;

    return rem
      ? `${wholeHours} h ${rem} min activos`
      : `${wholeHours} h activos`;
  }

  async function v73LoadMyTopicMetrics() {
    try {
      const data = await v73Rpc(
        'cenqal_gym_my_topic_metrics_v73',
        { p_token: TRACKING_TOKEN }
      );

      v73TopicMetrics =
        data && Array.isArray(data.topics)
          ? data.topics
          : [];

      return v73TopicMetrics;
    } catch (error) {
      console.debug(
        'CENQAL Gym v73 · métricas por tema no disponibles:',
        error
      );
      v73TopicMetrics = [];
      return [];
    }
  }

  function v73DecorateTopicButtons() {
    if (!Array.isArray(v73TopicMetrics) || !v73TopicMetrics.length) {
      return;
    }

    document.querySelectorAll('button.topic').forEach((btn, index) => {
      const topic = index + 1;
      const metric = v73TopicMetrics.find(
        x => Number(x.topic_number) === topic
      );

      if (!metric) return;

      let time = btn.querySelector('.v73-topic-time');

      if (!time) {
        time = document.createElement('span');
        time.className = 'v73-topic-time';
        btn.appendChild(time);
      }

      const recovered =
        Number(metric.recovered_practiced_questions || 0) > 0 &&
        Number(metric.responses || 0) === 0;

      time.textContent =
        `⏱ ${v73FormatTopicTime(metric.active_hours)}` +
        (
          recovered
            ? ` · progreso local recuperado: ${metric.recovered_practiced_questions}/40`
            : ''
        );
    });
  }

  if (typeof renderTopics === 'function') {
    const v73RenderTopicsBase = renderTopics;

    renderTopics = async function () {
      const out = await v73RenderTopicsBase.apply(this, arguments);
      v73DecorateTopicButtons();
      return out;
    };

    window.renderTopics = renderTopics;
  }

  // ------------------------------------------------------------------------
  // BOOTSTRAP
  // ------------------------------------------------------------------------
  async function v73Bootstrap() {
    v73EnsureStyles();

    await v73ImportLocalSnapshots();
    await v73LoadMyTopicMetrics();
    v73DecorateTopicButtons();

    console.debug(
      'CENQAL Gym v73: sincronización fiable y tiempo por tema activos.'
    );
  }

  v73Bootstrap();

})();
