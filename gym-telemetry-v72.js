/* ==========================================================================
   CENQAL v72 · GYM VISUAL IDENTIFICADO + LEARNING ANALYTICS
   Cargar DESPUÉS del script principal de index.html.

   Requisitos de URL:
   - sburl = URL pública de Supabase
   - sbkey = anon/public key
   - gt    = token temporal emitido por Berilio para el alumno

   Si gt no existe (p. ej. vista docente), el Gym funciona normalmente
   pero esta capa no registra actividad como alumno.
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
    console.debug('CENQAL Gym v72: vista sin trazabilidad de alumno.');
    return;
  }

  if (
    typeof GYM_SBURL === 'undefined' ||
    typeof GYM_SBKEY === 'undefined' ||
    !GYM_SBURL ||
    !GYM_SBKEY
  ) {
    console.debug('CENQAL Gym v72: faltan parámetros públicos de Supabase.');
    return;
  }

  async function v72Rpc(name, payload) {
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

  async function v72EnsureServerSession(session) {
    if (!session) return null;

    if (session.serverSessionId) {
      return session.serverSessionId;
    }

    const result = await v72Rpc(
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

  /*
   * startTraining:
   * conserva exactamente el comportamiento visual/local existente.
   * Después crea la sesión identificada en Supabase antes de que el usuario
   * pueda seguir interactuando desde esta llamada.
   */
  const v72StartTrainingBase = startTraining;
  startTraining = async function (topic, mode) {
    const previousSession = state ? state.session : null;

    await v72StartTrainingBase(topic, mode);

    const session = state ? state.session : null;

    // Si la función original salió sin crear una sesión, no hacemos nada.
    if (
      !session ||
      session === previousSession ||
      Number(session.topic) !== Number(topic)
    ) {
      return;
    }

    try {
      await v72EnsureServerSession(session);
    } catch (error) {
      console.debug(
        'CENQAL Gym v72 · inicio sin telemetría:',
        error
      );
    }
  };
  window.startTraining = startTraining;

  /*
   * resumeSession:
   * permite que sesiones locales iniciadas antes de v72 queden identificadas
   * a partir del momento en que el alumno las retoma.
   */
  const v72ResumeSessionBase = resumeSession;
  resumeSession = async function (topic) {
    await v72ResumeSessionBase(topic);

    try {
      if (state && state.session) {
        await v72EnsureServerSession(state.session);
      }
    } catch (error) {
      console.debug(
        'CENQAL Gym v72 · reanudación sin telemetría:',
        error
      );
    }
  };
  window.resumeSession = resumeSession;

  /*
   * answer:
   * primero deja que el Gym haga TODO lo que ya hacía
   * (feedback, progreso local, almacenamiento y telemetría previa).
   * Después replica el intento de forma identificada para Learning Analytics.
   */
  const v72AnswerBase = answer;
  answer = async function (visibleIndex) {
    if (!state || state.answered) return;

    const session = state.session;
    const question = state.currentQuestion;
    const chosen =
      state.optionView &&
      state.optionView[visibleIndex]
        ? state.optionView[visibleIndex]
        : null;

    const position =
      session && Number.isFinite(Number(session.index))
        ? Number(session.index) + 1
        : null;

    await v72AnswerBase(visibleIndex);

    try {
      if (!session || !question || !chosen) return;

      const serverSessionId =
        await v72EnsureServerSession(session);

      await v72Rpc(
        'cenqal_gym_web_answer_v72',
        {
          p_token: TRACKING_TOKEN,
          p_session_id: serverSessionId,
          p_question_code: String(question.id || ''),
          p_selected_index: Number(chosen.originalIndex),
          p_position: position
        }
      );
    } catch (error) {
      // Nunca bloqueamos el aprendizaje por un fallo de analítica.
      console.debug(
        'CENQAL Gym v72 · respuesta sin telemetría identificada:',
        error
      );
    }
  };
  window.answer = answer;

  /*
   * pauseTraining:
   * marca la sesión del servidor como pausada; el progreso local permanece
   * exactamente como hasta ahora.
   */
  const v72PauseTrainingBase = pauseTraining;
  pauseTraining = async function () {
    const session = state ? state.session : null;
    const serverSessionId =
      session ? session.serverSessionId : null;

    if (serverSessionId) {
      try {
        await v72Rpc(
          'cenqal_gym_web_pause_v72',
          {
            p_token: TRACKING_TOKEN,
            p_session_id: String(serverSessionId)
          }
        );
      } catch (error) {
        console.debug(
          'CENQAL Gym v72 · no se pudo marcar pausa:',
          error
        );
      }
    }

    return await v72PauseTrainingBase();
  };
  window.pauseTraining = pauseTraining;

  console.debug(
    'CENQAL Gym v72: trazabilidad identificada activa.'
  );
})();
