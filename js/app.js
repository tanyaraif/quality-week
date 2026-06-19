(() => {
  const state = {
    view:              "register",
    currentUser:       null,
    selectedEventId:   null,
    selectedDate:      null,
    selectedType:      null,
    selectedSlotIndex: null,
    records:           [],
    users:             [],
    events:            [],
    roles:             [],   // [{ id, label }]
    ptypes:            [],   // [{ id, label, for_role }]
    activeTabEventId:  null,
    refreshTimer:      null,
    formRefreshTimer:  null,
  };

  const $  = (sel) => document.querySelector(sel);
  const SAVED_KEY = "saved_user_key";

  function findUser(key)          { return state.users.find((u) => u.key === String(key || "").trim()) ?? null; }
  function findEvent(id)          { return state.events.find((e) => e.id === id) ?? null; }
  function findEventDate(ev, d)   { return ev.dates.find((x) => x.date === d) ?? null; }
  function roleLabel(id)          { return state.roles.find((r) => r.id === id)?.label ?? id; }
  function ptypesForRole(role)    { return state.ptypes.filter((t) => t.for_role === role); }
  function ptypeLabel(id)         { return state.ptypes.find((t) => t.id === id)?.label ?? id; }

  function savedKey()             { try { return localStorage.getItem(SAVED_KEY); }  catch { return null; } }
  function saveKey(k)             { try { localStorage.setItem(SAVED_KEY, k); }      catch {} }
  function clearKey()             { try { localStorage.removeItem(SAVED_KEY); }      catch {} }

  function setAuthed(yes)         { document.body.classList.toggle("authed", yes); }

  function el(tag, props = {}, ...children) {
    const node = document.createElement(tag);
    for (const [k, v] of Object.entries(props)) {
      if (k === "class") node.className = v;
      else if (k.startsWith("on") && typeof v === "function") node.addEventListener(k.slice(2).toLowerCase(), v);
      else if (v != null) node.setAttribute(k, v);
    }
    for (const c of children.flat()) {
      if (c != null) node.append(c.nodeType ? c : document.createTextNode(c));
    }
    return node;
  }

  function showModal({ type = "success", title, text, buttonText = "Понятно", onClose }) {
    const root = $("#modal-root");
    root.innerHTML = "";
    const close = () => {
      root.innerHTML = "";
      document.removeEventListener("keydown", onEsc);
      onClose?.();
    };
    const onEsc = (e) => { if (e.key === "Escape") close(); };
    document.addEventListener("keydown", onEsc);

    root.append(el("div", { class: "modal-overlay", onClick: close },
      el("div", { class: "modal", onClick: (e) => e.stopPropagation() },
        el("div", { class: `modal-icon ${type}` }, type === "success" ? "✓" : "!"),
        el("h3", {}, title),
        text ? el("p", {}, text) : null,
        el("button", { class: "btn", onClick: close }, buttonText),
      ),
    ));
  }

  function showMsg(id, text, type) {
    const box = $(id);
    if (!box) return;
    box.innerHTML = "";
    box.append(el("div", { class: `msg ${type}` }, text));
  }

  function setView(view) {
    state.view = view;
    for (const v of ["register", "schedule", "mine"]) {
      $(`#nav-${v}`).classList.toggle("active", v === view);
      $(`#view-${v}`).classList.toggle("hidden", v !== view);
    }

    if (view === "schedule") {
      startScheduleRefresh();
    } else {
      stopTimer("refreshTimer");
    }

    stopTimer("formRefreshTimer");
    if (view === "register" && state.currentUser) {
      state.formRefreshTimer = setInterval(refreshFormSlots, CONFIG.refreshIntervalMs);
    }

    if (view === "mine") renderMyRecords();
  }

  function stopTimer(key) {
    if (state[key]) { clearInterval(state[key]); state[key] = null; }
  }

  // ── Экран ввода ключа ────────────────────────────────────────────────────

  function renderKeyScreen() {
    const root = $("#view-register");
    root.innerHTML = "";
    root.append(el("div", { class: "card" },
      el("h1", {}, "Регистрация на мероприятие"),
      el("p", { class: "subtitle" }, "Введите персональный ключ, который вам выдали в личных сообщениях."),
      el("div", { id: "register-msg" }),
      el("div", { class: "field" },
        el("label", { for: "key-input" }, "Персональный ключ"),
        el("input", { id: "key-input", type: "text", placeholder: "Например: 123", autocomplete: "off" }),
      ),
      el("button", { class: "btn", onClick: handleKeySubmit }, "Продолжить"),
    ));
    const input = $("#key-input");
    input.addEventListener("keydown", (e) => { if (e.key === "Enter") handleKeySubmit(); });
    input.focus();
  }

  async function handleKeySubmit() {
    const key = $("#key-input").value.trim();
    if (!key) { showMsg("#register-msg", "Введите ключ.", "error"); return; }
    const user = findUser(key);
    if (!user) { showMsg("#register-msg", "Ключ не найден. Проверьте и попробуйте ещё раз.", "error"); return; }
    saveKey(user.key);
    state.currentUser = user;
    setAuthed(true);
    renderRegistrationForm();
    setView("register");
  }

  // ── Форма регистрации ────────────────────────────────────────────────────

  function renderRegistrationForm() {
    const user  = state.currentUser;
    const root  = $("#view-register");
    root.innerHTML = "";

    const userPtypes = ptypesForRole(user.role);
    state.selectedEventId   = null;
    state.selectedDate      = null;
    state.selectedSlotIndex = null;
    state.selectedType      = userPtypes[0]?.id ?? null;

    const typeField = userPtypes.length > 1
      ? el("div", { class: "field" },
          el("label", { for: "type-select" }, "Тип участия"),
          el("select", { id: "type-select", onChange: onDateOrTypeChange },
            ...userPtypes.map((t) => el("option", { value: t.id }, t.label)),
          ),
        )
      : el("div", { class: "field" },
          el("label", {}, "Тип участия"),
          el("div", { class: "muted" }, userPtypes[0]?.label ?? "—"),
        );

    root.append(el("div", { class: "card" },
      el("h1", {}, "Запись на слот"),
      el("div", { class: "user-badge" },
        `${user.lastName} ${user.firstName}`,
        el("span", { class: `role-pill${user.role === "tccg" ? " tck" : ""}` }, roleLabel(user.role)),
      ),
      el("div", { id: "register-msg" }),
      el("div", { class: "field" },
        el("label", { for: "event-select" }, "Мероприятие"),
        el("select", { id: "event-select", onChange: onEventChange }),
      ),
      el("div", { class: "field" },
        el("label", { for: "date-select" }, "Дата"),
        el("select", { id: "date-select", onChange: onDateOrTypeChange, disabled: "true" },
          el("option", { value: "" }, "— сначала выберите мероприятие —"),
        ),
      ),
      typeField,
      el("div", { class: "field" },
        el("label", {}, "Свободное время"),
        el("div", { id: "slots-container", class: "slots-grid" },
          el("div", { class: "muted" }, "Сначала выберите мероприятие."),
        ),
      ),
      el("button", { class: "btn", id: "register-submit", onClick: handleRegister }, "Записаться"),
    ));

    fillEventOptions();
    loadRecordsForForm(user);
  }

  function fillEventOptions() {
    const select = $("#event-select");
    if (!select) return;
    const user = state.currentUser;
    select.innerHTML = "";
    select.append(el("option", { value: "" }, "— выберите мероприятие —"));
    for (const ev of state.events) {
      const already = user && isRegisteredForEvent(state.records, user.key, ev.id);
      const opt = el("option", { value: ev.id }, already ? `${ev.title} — вы уже записаны` : ev.title);
      if (already) opt.disabled = true;
      select.append(opt);
    }
  }

  async function loadRecordsForForm(user) {
    try {
      state.records = await Api.getRecords();
    } catch {
      showMsg("#register-msg", "Не удалось загрузить данные. Записи могут быть неактуальны.", "error");
      return;
    }
    fillEventOptions();
    const cd = checkCooldown(state.records, user.key);
    if (!cd.allowed) {
      showMsg("#register-msg", `Вы недавно записывались. Следующая запись доступна через ${formatRemaining(cd.remainingMs)}.`, "info");
    }
    if (state.selectedEventId && state.selectedDate) renderSlots();
  }

  function onEventChange() {
    state.selectedEventId   = $("#event-select").value || null;
    state.selectedDate      = null;
    state.selectedSlotIndex = null;

    const dateSelect = $("#date-select");
    dateSelect.innerHTML = "";
    const ev = state.selectedEventId ? findEvent(state.selectedEventId) : null;
    if (!ev) {
      dateSelect.disabled = true;
      dateSelect.append(el("option", { value: "" }, "— сначала выберите мероприятие —"));
    } else {
      dateSelect.disabled = false;
      dateSelect.append(el("option", { value: "" }, "— выберите дату —"));
      for (const d of ev.dates) dateSelect.append(el("option", { value: d.date }, d.dateLabel));
    }
    renderSlots();
  }

  function onDateOrTypeChange() {
    state.selectedDate      = $("#date-select")?.value || null;
    state.selectedSlotIndex = null;
    const ts = $("#type-select");
    if (ts) state.selectedType = ts.value;
    renderSlots();
  }

  function renderSlots() {
    const container = $("#slots-container");
    container.innerHTML = "";

    const ev = state.selectedEventId ? findEvent(state.selectedEventId) : null;
    const eventDate = ev && state.selectedDate ? findEventDate(ev, state.selectedDate) : null;

    if (!ev)        { container.append(el("div", { class: "muted" }, "Сначала выберите мероприятие.")); return; }
    if (!eventDate) { container.append(el("div", { class: "muted" }, "Выберите дату.")); return; }

    const type      = state.selectedType;
    const available = eventDate.slots.map((slot, index) => ({ slot, index })).filter(({ slot }) => slot.types.includes(type));

    if (!available.length) {
      container.append(el("div", { class: "muted" }, "Для вашего типа участия на эту дату нет слотов."));
      return;
    }

    for (const { slot, index } of available) {
      const taken    = isSlotTaken(state.records, ev.id, state.selectedDate, index, type);
      const selected = state.selectedSlotIndex === index;
      container.append(el("div",
        {
          class: "slot" + (taken ? " taken" : "") + (selected ? " selected" : ""),
          onClick: () => { if (taken) return; state.selectedSlotIndex = index; renderSlots(); },
        },
        el("div", {},
          el("div", { class: "slot-time" }, slot.time),
          el("div", { class: "slot-meta" }, ptypeLabel(type)),
        ),
        el("div", { class: `slot-status ${taken ? "busy" : "free"}` }, taken ? "Занято" : "Свободно"),
      ));
    }
  }

  async function handleRegister() {
    const user = state.currentUser;
    if (!state.selectedEventId)        { showMsg("#register-msg", "Выберите мероприятие.", "error"); return; }
    if (!state.selectedDate)           { showMsg("#register-msg", "Выберите дату.", "error"); return; }
    if (!state.selectedType)           { showMsg("#register-msg", "Выберите тип участия.", "error"); return; }
    if (state.selectedSlotIndex === null) { showMsg("#register-msg", "Выберите свободное время.", "error"); return; }

    const btn = $("#register-submit");
    btn.disabled = true;
    btn.textContent = "Записываем…";

    try {
      state.records = await Api.getRecords();

      if (isRegisteredForEvent(state.records, user.key, state.selectedEventId)) {
        const ev = findEvent(state.selectedEventId);
        showModal({ type: "error", title: "Вы уже записаны",
          text: `На «${ev.title}» можно записаться только один раз. Посмотреть свою запись можно во вкладке «Мои записи».` });
        fillEventOptions();
        renderSlots();
        return;
      }

      const cd = checkCooldown(state.records, user.key);
      if (!cd.allowed) {
        showModal({ type: "error", title: "Ещё рано",
          text: `Запись доступна раз в ${CONFIG.registrationCooldownMinutes} мин. Подождите ещё ${formatRemaining(cd.remainingMs)}.` });
        return;
      }

      if (isSlotTaken(state.records, state.selectedEventId, state.selectedDate, state.selectedSlotIndex, state.selectedType)) {
        state.selectedSlotIndex = null;
        renderSlots();
        showModal({ type: "error", title: "Слот уже занят", text: "Это время только что заняли. Выберите другой свободный слот." });
        return;
      }

      const ev        = findEvent(state.selectedEventId);
      const eventDate = findEventDate(ev, state.selectedDate);
      const slot      = eventDate.slots[state.selectedSlotIndex];

      state.records = await Api.addRecord({
        userKey:    user.key,
        lastName:   user.lastName,
        firstName:  user.firstName,
        role:       user.role,
        eventId:    ev.id,
        eventTitle: ev.title,
        date:       eventDate.date,
        eventDate:  eventDate.dateLabel,
        slotIndex:  state.selectedSlotIndex,
        slotTime:   slot.time,
        type:       state.selectedType,
        createdAt:  new Date().toISOString(),
      });

      state.selectedSlotIndex = null;
      showModal({
        type: "success", title: "Вы записаны!",
        text: `${ev.title} · ${eventDate.dateLabel} · ${slot.time} · ${ptypeLabel(state.selectedType)}.`,
        buttonText: "К мероприятиям",
        onClose: () => { state.activeTabEventId = ev.id; setView("schedule"); },
      });
    } catch (e) {
      if (e?.code === "slot_taken") {
        try { state.records = await Api.getRecords(); } catch {}
        state.selectedSlotIndex = null;
        renderSlots();
        showModal({ type: "error", title: "Слот уже занят", text: "Это время только что заняли. Выберите другой свободный слот." });
      } else {
        showModal({ type: "error", title: "Не удалось записаться", text: "Произошла ошибка. Попробуйте ещё раз." });
      }
    } finally {
      btn.disabled = false;
      btn.textContent = "Записаться";
    }
  }

  // ── Расписание ───────────────────────────────────────────────────────────

  function renderScheduleShell() {
    const root = $("#view-schedule");
    root.innerHTML = "";

    root.append(
      el("div", { class: "event-tabs" },
        ...state.events.map((ev) =>
          el("button", {
            class: "event-tab" + (ev.id === state.activeTabEventId ? " active" : ""),
            onClick: () => { state.activeTabEventId = ev.id; renderScheduleShell(); },
          },
          ev.title,
          el("small", {}, ev.dates.map((d) => d.dateLabel).join(" · ")),
          ),
        ),
      ),
      el("div", { class: "card", id: "event-detail" },
        el("div", { class: "muted" }, "Загрузка…"),
      ),
    );

    renderEventDetail();
  }

  function buildDateTable(ev, eventDate) {
    const orderedTypes = ["train", "personal", "tccg"];
    const usedTypes    = orderedTypes.filter((t) => eventDate.slots.some((s) => s.types.includes(t)));

    const headerRow = el("tr", {},
      el("th", {}, "Время"),
      ...usedTypes.map((t) => el("th", {}, ptypeLabel(t))),
    );

    const bodyRows = eventDate.slots.map((slot, index) =>
      el("tr", {},
        el("td", { class: "slot-time" }, slot.time),
        ...usedTypes.map((t) => {
          if (!slot.types.includes(t)) return el("td", { class: "cell-empty" }, "—");
          const rec  = findSlotRecord(state.records, ev.id, eventDate.date, index, t);
          if (!rec)  return el("td", { class: "cell-free" }, "свободно");
          const mine = state.currentUser?.key === rec.userKey;
          return el("td", { class: "cell-name" + (mine ? " cell-mine" : "") }, `${rec.lastName} ${rec.firstName}`);
        }),
      ),
    );

    return el("table", { class: "schedule-table" },
      el("thead", {}, headerRow),
      el("tbody", {}, ...bodyRows),
    );
  }

  function renderEventDetail() {
    const ev   = findEvent(state.activeTabEventId);
    const card = $("#event-detail");
    if (!ev || !card) return;
    card.innerHTML = "";
    card.append(
      el("h2", {}, ev.title),
      el("p", { class: "event-desc" }, ev.description),
      ...ev.dates.map((eventDate) =>
        el("div", { class: "date-block" },
          el("h3", {}, eventDate.dateLabel),
          buildDateTable(ev, eventDate),
        ),
      ),
      el("div", { class: "refresh-note" },
        el("span", { class: "dot" }),
        `График обновляется автоматически раз в ${CONFIG.refreshIntervalMs / 1000} секунд.`,
      ),
    );
  }

  async function refreshRecords() {
    try {
      state.records = await Api.getRecords();
      if (state.view === "schedule") renderEventDetail();
    } catch {}
  }

  function startScheduleRefresh() {
    renderScheduleShell();
    refreshRecords();
    stopTimer("refreshTimer");
    state.refreshTimer = setInterval(refreshRecords, CONFIG.refreshIntervalMs);
  }

  async function refreshFormSlots() {
    if (state.view !== "register" || !state.currentUser) return;
    try { state.records = await Api.getRecords(); } catch { return; }
    fillEventOptions();
    const eventSelect = $("#event-select");
    if (eventSelect && state.selectedEventId) eventSelect.value = state.selectedEventId;
    if (state.selectedEventId && state.selectedDate && state.selectedSlotIndex !== null &&
        isSlotTaken(state.records, state.selectedEventId, state.selectedDate, state.selectedSlotIndex, state.selectedType)) {
      state.selectedSlotIndex = null;
    }
    if (state.selectedEventId && state.selectedDate) renderSlots();
  }

  // ── Мои записи ───────────────────────────────────────────────────────────

  async function renderMyRecords() {
    const root = $("#view-mine");
    root.innerHTML = "";
    const user = state.currentUser;

    if (!user) {
      root.append(el("div", { class: "card" }, el("div", { class: "empty-state" }, "Сначала войдите по ключу.")));
      return;
    }

    const list = el("div", { id: "mine-list" }, el("div", { class: "muted" }, "Загрузка…"));
    root.append(el("div", { class: "card" }, el("h2", {}, "Мои записи"), list));

    try { state.records = await Api.getRecords(); }
    catch {
      list.innerHTML = "";
      list.append(el("div", { class: "msg error" }, "Не удалось загрузить записи."));
      return;
    }

    const mine = getUserRecords(state.records, user.key);
    list.innerHTML = "";

    if (!mine.length) {
      list.append(el("div", { class: "empty-state" }, "Вы пока никуда не записаны. Перейдите во вкладку «Регистрация»."));
      return;
    }

    for (const rec of mine) {
      list.append(el("div", { class: "my-record" },
        el("div", {},
          el("div", { class: "mr-title" }, rec.eventTitle),
          el("div", { class: "mr-meta" }, `${rec.eventDate} · ${rec.slotTime}`),
        ),
        el("span", { class: "mr-type" }, ptypeLabel(rec.type)),
      ));
    }
  }

  // ── Инициализация ────────────────────────────────────────────────────────

  async function init() {
    $("#nav-register").addEventListener("click", () => setView("register"));
    $("#nav-schedule").addEventListener("click", () => setView("schedule"));
    $("#nav-mine").addEventListener("click",     () => setView("mine"));

    $("#view-register").append(el("div", { class: "card" }, el("div", { class: "muted" }, "Загрузка…")));

    try {
      [state.users, state.events, state.roles, state.ptypes] = await Promise.all([
        Api.getUsers(),
        Api.getEvents(),
        Api.getRoles(),
        Api.getParticipationTypes(),
      ]);
    } catch {
      $("#view-register").innerHTML = "";
      $("#view-register").append(el("div", { class: "card" },
        el("div", { class: "msg error" },
          "Не удалось загрузить данные. Проверьте подключение к Supabase (URL и anon-ключ в js/config.js) и обновите страницу.",
        ),
      ));
      return;
    }

    state.activeTabEventId = state.events[0]?.id ?? null;

    const sk   = savedKey();
    const user = sk ? findUser(sk) : null;
    if (user) {
      state.currentUser = user;
      setAuthed(true);
      renderRegistrationForm();
    } else {
      if (sk) clearKey();
      renderKeyScreen();
    }

    setView("register");
  }

  document.addEventListener("DOMContentLoaded", init);
})();
