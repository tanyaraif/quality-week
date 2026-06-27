(() => {
  const state = {
    view:              "register",
    currentUser:       null,
    selectedEventId:   null,
    selectedDate:      null,
    selectedType:      null,
    selectedSlotIndex: null,
    records:           [],
    recordsLoaded:     false,
    events:            [],
    roles:             [],
    ptypes:            [],
    cfg:               {},   // { registration_cooldown_minutes, refresh_interval_seconds }
    activeTabEventId:  null,
    refreshTimer:      null,
    formRefreshTimer:  null,
  };

  const $  = (sel) => document.querySelector(sel);
  const SAVED_KEY = "saved_user_key";

  function findEvent(id)          { return state.events.find((e) => e.id === id) ?? null; }
  function findEventDate(ev, d)   { return ev.dates.find((x) => x.date === d) ?? null; }
  function roleLabel(id)          { return state.roles.find((r) => r.id === id)?.label ?? id; }
  function ptypesForRole(role)    { return state.ptypes.filter((t) => t.for_role === role); }
  function ptypeLabel(id)         { return state.ptypes.find((t) => t.id === id)?.label ?? id; }

  function todayOmsk() {
    return new Date(Date.now() + 6 * 3600_000).toISOString().slice(0, 10);
  }

  function savedKey()             { try { return localStorage.getItem(SAVED_KEY); }  catch { return null; } }
  function saveKey(k)             { try { localStorage.setItem(SAVED_KEY, k); }      catch {} }
  function clearKey()             { try { localStorage.removeItem(SAVED_KEY); }      catch {} }

  function setAuthed(yes)         { document.body.classList.toggle("authed", yes); }

  function logout() {
    clearKey();
    state.currentUser = null;
    setAuthed(false);
    renderKeyScreen();
    setView("register");
  }

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

  // ── Иконки (inline SVG) ────────────────────────────────────────────────────
  const ICONS = {
    flask:    `<path d="M9 3h6M9 3v6l-4 9a1 1 0 0 0 .9 1.4h12.2a1 1 0 0 0 .9-1.4L15 9V3"/><path d="M6.5 15h11"/>`,
    beaker:   `<path d="M6 3h12M7 3v5.5L4 19a1 1 0 0 0 1 1.3h14a1 1 0 0 0 1-1.3L17 8.5V3"/><path d="M5 15h14"/>`,
    droplet:  `<path d="M12 3s6 6 6 11a6 6 0 0 1-12 0c0-5 6-11 6-11z"/>`,
    atom:     `<circle cx="12" cy="12" r="1.5"/><ellipse cx="12" cy="12" rx="9" ry="4"/><ellipse cx="12" cy="12" rx="9" ry="4" transform="rotate(60 12 12)"/><ellipse cx="12" cy="12" rx="9" ry="4" transform="rotate(120 12 12)"/>`,
    check:    `<polyline points="20 6 9 17 4 12"/>`,
    clipboard:`<rect x="8" y="2" width="8" height="4" rx="1"/><path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2"/>`,
  };

  function icon(name, { size = 18, stroke = 1.8 } = {}) {
    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    svg.setAttribute("viewBox", "0 0 24 24");
    svg.setAttribute("width", size);
    svg.setAttribute("height", size);
    svg.setAttribute("fill", "none");
    svg.setAttribute("stroke", "currentColor");
    svg.setAttribute("stroke-width", stroke);
    svg.setAttribute("stroke-linecap", "round");
    svg.setAttribute("stroke-linejoin", "round");
    svg.innerHTML = ICONS[name] ?? "";
    return svg;
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

  function showMsg(id, text, type, { scroll = false } = {}) {
    const box = $(id);
    if (!box) return;
    box.innerHTML = "";
    box.append(el("div", { class: `msg ${type}` }, text));
    if (scroll) {
      setTimeout(() => box.scrollIntoView({ behavior: "smooth", block: "center" }), 60);
    }
  }

  function setView(view, { fromNav = false } = {}) {
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
      if (fromNav) renderRegistrationForm();
      state.formRefreshTimer = setInterval(refreshFormSlots, state.cfg.refresh_interval_seconds * 1000);
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

    const decor = el("div", { class: "login-decor" },
      el("div", { class: "logo login-logo" },
        el("div", { class: "logo-icon" },
          (() => {
            const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
            svg.setAttribute("width", "22"); svg.setAttribute("height", "22");
            svg.setAttribute("viewBox", "0 0 24 24"); svg.setAttribute("fill", "none");
            svg.setAttribute("stroke", "currentColor"); svg.setAttribute("stroke-width", "2");
            svg.setAttribute("stroke-linecap", "round"); svg.setAttribute("stroke-linejoin", "round");
            svg.innerHTML = `<path d="M9 3h6M9 3v6l-4 9a1 1 0 0 0 .9 1.4h12.2a1 1 0 0 0 .9-1.4L15 9V3"/><path d="M6.5 15h11"/>`;
            return svg;
          })(),
        ),
        el("div", { class: "logo-text" }, "Неделя ", el("span", {}, "качества")),
      ),
    );

    root.append(el("div", { class: "card card-enter" },
      decor,
      el("h1", {}, "Войдите в лабораторию"),
      el("p", { class: "subtitle" }, "Ключ прислали вам на почту — введите его, чтобы записаться на мероприятия."),
      el("div", { id: "register-msg" }),
      el("div", { class: "field" },
        el("label", { for: "key-input" }, "Персональный ключ"),
        el("input", { id: "key-input", type: "text", placeholder: "Например, service1", autocomplete: "off" }),
      ),
      el("button", { class: "btn", id: "key-submit", style: "width:100%", onClick: handleKeySubmit },
        icon("droplet"), "Запустить реакцию"),
    ));
    const input = $("#key-input");
    input.addEventListener("keydown", (e) => { if (e.key === "Enter") handleKeySubmit(); });
    input.focus();
  }

  async function handleKeySubmit() {
    const key = $("#key-input").value.trim();
    if (!key) { showMsg("#register-msg", "Введите ключ.", "error"); return; }

    // Пасхалка: «service1» — это пример из подсказки, а не настоящий ключ.
    if (key.toLowerCase() === "service1") {
      showModal({ type: "error", title: "Ну это же пример 😄",
        text: "service1 — это просто образец из подсказки. Загляните в почту, там ваш настоящий ключ." });
      return;
    }

    const btn = $("#key-submit");
    btn.disabled = true;

    let user;
    try {
      user = await Api.getUserByKey(key);
    } catch {
      showMsg("#register-msg", "Ошибка соединения. Попробуйте ещё раз.", "error");
      btn.disabled = false;
      return;
    }

    if (!user) { showMsg("#register-msg", "Ключ не найден. Проверьте и попробуйте ещё раз.", "error"); btn.disabled = false; return; }

    saveKey(key);
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
    const hasMultipleTypes = userPtypes.length > 1;
    state.selectedEventId   = null;
    state.selectedDate      = null;
    state.selectedSlotIndex = null;
    state.selectedType      = hasMultipleTypes ? null : (userPtypes[0]?.id ?? null);

    const cooldownMin = Number(state.cfg.registration_cooldown_minutes ?? 10);

    root.append(el("div", { class: "card card-enter" },
      el("div", { class: "reg-header" },
        el("h1", {}, icon("beaker", { size: 30 }), "Запись на эксперимент"),
        el("p", { class: "reg-cooldown-note" },
          icon("droplet", { size: 14 }),
          `Между записями нужно подождать ${formatMinutes(cooldownMin)} — нельзя записаться на всё сразу`
        ),
      ),
      renderUserCard(user),
      el("div", { id: "register-msg" }),
      el("div", { class: "field" },
        el("label", {}, "Выберите активность"),
        el("div", { id: "event-cards", class: "event-cards" }),
      ),
      userPtypes.length > 1
        ? el("div", { id: "type-field", class: "field form-step hidden" },
            el("label", {}, "Тип участия"),
            el("div", { id: "type-cards", class: "date-cards" }),
          )
        : null,
      el("div", { id: "date-field", class: "field form-step hidden" },
        el("label", {}, "Дата"),
        el("div", { id: "date-cards", class: "date-cards" }),
      ),
      el("div", { id: "slots-field", class: "field form-step hidden" },
        el("label", {}, "Свободное время"),
        el("div", { id: "slots-container", class: "slots-grid" }),
      ),
      el("button", { class: "btn", id: "register-submit", onClick: handleRegister },
        icon("flask"), "Записаться"),
    ));

    fillEventCards();
    loadRecordsForForm();
  }

  function renderUserCard(user) {
    const isTck = user.role === "tccg";
    return el("div", { class: "lab-badge" },
      el("div", { class: "lab-badge-flask" + (isTck ? " tck" : "") },
        icon("flask", { size: 16, stroke: 2 }),
      ),
      el("div", { class: "lab-badge-info" },
        el("span", { class: "lab-badge-name" }, `${user.firstName} ${user.lastName}`),
        el("span", { class: "lab-badge-role" }, roleLabel(user.role)),
      ),
    );
  }

  const EVENT_ICONS = {
    feedback:     "atom",
    inspector:    "droplet",
    exchange:     "beaker",
    frankenstein: "flask",
    owngame:      "clipboard",
  };

  function fillEventCards() {
    const container = $("#event-cards");
    if (!container) return;
    const user  = state.currentUser;
    const today = todayOmsk();
    container.innerHTML = "";

    if (!state.recordsLoaded) {
      container.append(el("div", { class: "event-cards-loading" },
        el("div", { class: "skeleton-card" }),
        el("div", { class: "skeleton-card" }),
        el("div", { class: "skeleton-card" }),
      ));
      return;
    }

    const withFutureDates = state.events.filter((ev) => ev.dates.some((d) => d.date >= today));
    const available = withFutureDates.filter((ev) =>
      !(user && isRegisteredForEvent(state.records, savedKey(), ev.id))
    );

    const submitBtn = $("#register-submit");

    if (!available.length) {
      const allRegistered = withFutureDates.length > 0;
      container.append(el("div", { class: "empty-events" },
        (() => {
          const f = icon("flask", { size: 44, stroke: 1.4 });
          f.setAttribute("class", "empty-events-icon");
          return f;
        })(),
        el("div", { class: "empty-events-title" },
          allRegistered ? "Вы записались на все активности 🎉" : "Сейчас нет открытых активностей",
        ),
        el("div", { class: "empty-events-text" },
          allRegistered
            ? "Свои записи можно посмотреть во вкладке «Мои записи». Чтобы изменить или отменить запись, напишите Тане в Mattermost."
            : "Запись на ближайшие активности пока закрыта. Загляните позже — слоты появятся здесь.",
        ),
      ));
      if (submitBtn) submitBtn.classList.add("hidden");
      return;
    }

    if (submitBtn) submitBtn.classList.remove("hidden");

    for (const ev of available) {
      const isSelected = state.selectedEventId === ev.id;
      const card = el("div", {
        class: "event-pick-card" + (isSelected ? " selected" : ""),
        onClick: () => onEventCardClick(ev.id),
      },
        el("div", { class: "event-pick-icon" }, icon(EVENT_ICONS[ev.id] ?? "flask", { size: 18 })),
        el("div", { class: "event-pick-body" },
          el("span", { class: "event-pick-title" }, ev.title),
          ev.description
            ? el("div", { class: "event-pick-details" },
                el("div", { class: "event-pick-desc" }, ev.description),
              )
            : null,
        ),
        el("div", { class: "event-pick-check" },
          el("svg", { viewBox: "0 0 24 24", width: "13", height: "13", fill: "none", stroke: "currentColor", "stroke-width": "3", "stroke-linecap": "round", "stroke-linejoin": "round" },
            (() => { const p = document.createElementNS("http://www.w3.org/2000/svg","polyline"); p.setAttribute("points","20 6 9 17 4 12"); return p; })()
          ),
        ),
      );
      container.append(card);
    }
  }

  function onEventCardClick(evId) {
    const prev = state.selectedEventId;
    state.selectedEventId   = evId;
    state.selectedDate      = null;
    state.selectedSlotIndex = null;

    fillEventCards();

    const typeField  = $("#type-field");
    const dateField  = $("#date-field");
    const slotsField = $("#slots-field");

    if (prev !== evId) {
      if (typeField) {
        state.selectedType = null;
        typeField.classList.add("hidden");
        typeField.classList.remove("form-step-visible");
      }
      dateField.classList.add("hidden");
      dateField.classList.remove("form-step-visible");
      slotsField.classList.add("hidden");
      slotsField.classList.remove("form-step-visible");
    }

    if (typeField) {
      fillTypeCards();
      if (typeField.classList.contains("hidden")) {
        typeField.classList.remove("hidden");
        requestAnimationFrame(() => { typeField.classList.add("form-step-visible"); scrollToField(typeField); });
      }
    } else {
      fillDateCards();
      if (dateField.classList.contains("hidden")) {
        dateField.classList.remove("hidden");
        requestAnimationFrame(() => { dateField.classList.add("form-step-visible"); scrollToField(dateField); });
      }
    }

    renderSlots();
  }

  function scrollToField(el) {
    setTimeout(() => el.scrollIntoView({ behavior: "smooth", block: "nearest" }), 60);
  }

  const TYPE_HINTS = {
    train:    "Официально убежать веселиться",
    personal: "Приду в своё личное время",
  };

  // Сколько свободных слотов у типа участия по всем будущим датам события.
  function freeSlotsForType(ev, typeId) {
    if (!ev) return 0;
    const today = todayOmsk();
    let free = 0;
    for (const d of ev.dates) {
      if (d.date < today) continue;
      d.slots.forEach((slot, index) => {
        if (slot.types.includes(typeId) &&
            !isSlotTaken(state.records, ev.id, d.date, index, typeId)) {
          free++;
        }
      });
    }
    return free;
  }

  function fillTypeCards() {
    const container = $("#type-cards");
    if (!container) return;
    container.innerHTML = "";
    const ev = state.selectedEventId ? findEvent(state.selectedEventId) : null;
    const userPtypes = ptypesForRole(state.currentUser.role);
    for (const t of userPtypes) {
      const isSelected = state.selectedType === t.id;
      const hint = TYPE_HINTS[t.id];
      const soldOut = freeSlotsForType(ev, t.id) === 0;
      container.append(el("div", {
        class: "date-pick-card type-pick-card"
          + (isSelected ? " selected" : "")
          + (soldOut ? " disabled" : ""),
        onClick: soldOut ? null : () => onTypeCardClick(t.id),
      },
        el("div", { class: "type-pick-label" }, t.label),
        soldOut
          ? el("div", { class: "type-pick-hint type-pick-soldout" }, "Нет свободных слотов")
          : (hint ? el("div", { class: "type-pick-hint" }, hint) : null),
      ));
    }
  }

  function onTypeCardClick(typeId) {
    state.selectedType      = typeId;
    state.selectedDate      = null;
    state.selectedSlotIndex = null;

    fillTypeCards();

    const dateField  = $("#date-field");
    const slotsField = $("#slots-field");

    fillDateCards();

    slotsField.classList.add("hidden");
    slotsField.classList.remove("form-step-visible");

    if (dateField.classList.contains("hidden")) {
      dateField.classList.remove("hidden");
      requestAnimationFrame(() => { dateField.classList.add("form-step-visible"); scrollToField(dateField); });
    }

    renderSlots();
  }

  // Сколько свободных слотов на конкретную дату для выбранного типа участия.
  function freeSlotsForDate(ev, d, typeId) {
    if (!ev || !d || !typeId) return 0;
    let free = 0;
    d.slots.forEach((slot, index) => {
      if (slot.types.includes(typeId) &&
          !isSlotTaken(state.records, ev.id, d.date, index, typeId)) {
        free++;
      }
    });
    return free;
  }

  function fillDateCards() {
    const container = $("#date-cards");
    if (!container) return;
    container.innerHTML = "";

    const ev = state.selectedEventId ? findEvent(state.selectedEventId) : null;
    if (!ev) return;

    const today = todayOmsk();
    const futureDates = ev.dates.filter((d) => d.date >= today);

    for (const d of futureDates) {
      const isSelected = state.selectedDate === d.date;
      const soldOut = state.selectedType
        ? freeSlotsForDate(ev, d, state.selectedType) === 0
        : false;
      const card = el("div", {
        class: "date-pick-card"
          + (isSelected ? " selected" : "")
          + (soldOut ? " disabled" : ""),
        onClick: soldOut ? null : () => onDateCardClick(d.date),
      },
        el("div", { class: "date-pick-label" }, d.dateLabel),
        soldOut ? el("div", { class: "date-pick-soldout" }, "Нет свободных слотов") : null,
      );
      container.append(card);
    }
  }

  function onDateCardClick(date) {
    state.selectedDate      = date;
    state.selectedSlotIndex = null;

    fillDateCards();

    const slotsField = $("#slots-field");
    if (slotsField.classList.contains("hidden")) {
      slotsField.classList.remove("hidden");
      requestAnimationFrame(() => { slotsField.classList.add("form-step-visible"); scrollToField(slotsField); });
    }

    renderSlots();
  }

  async function loadRecordsForForm() {
    try {
      state.records = await Api.getRecords();
    } catch (e) {
      if (e?.status === 401 || e?.status === 403) { logout(); return; }
      showMsg("#register-msg", "Не удалось загрузить данные. Записи могут быть неактуальны.", "error");
      return;
    }
    const sk = savedKey();
    if (sk) {
      const still = await Api.getUserByKey(sk).catch(() => null);
      if (!still) { logout(); return; }
    }
    state.recordsLoaded = true;
    fillEventCards();
    const cd = checkCooldown(state.records, savedKey(), state.cfg.registration_cooldown_minutes);
    if (!cd.allowed) {
      showMsg("#register-msg", `Реакция ещё идёт ☕ Следующую запись можно будет совершить через ${formatRemaining(cd.remainingMs)}.`, "info");
    }
    if (state.selectedEventId && state.selectedDate) renderSlots();
  }



  function renderSlots() {
    const container = $("#slots-container");
    container.innerHTML = "";

    const ev = state.selectedEventId ? findEvent(state.selectedEventId) : null;
    const eventDate = ev && state.selectedDate ? findEventDate(ev, state.selectedDate) : null;

    if (!ev)                    { container.append(el("div", { class: "muted" }, "Сначала выберите активность.")); return; }
    if (!state.selectedType)    { container.append(el("div", { class: "muted" }, "Выберите тип участия.")); return; }
    if (!eventDate)             { container.append(el("div", { class: "muted" }, "Выберите дату.")); return; }

    const type      = state.selectedType;
    const available = eventDate.slots.map((slot, index) => ({ slot, index })).filter(({ slot }) => slot.types.includes(type));

    if (!available.length) {
      container.append(el("div", { class: "muted" }, "На эту дату для вашего типа участия слотов нет. Выберите другую дату."));
      return;
    }

    const freeCount = available.filter(({ index }) =>
      !isSlotTaken(state.records, ev.id, state.selectedDate, index, type)
    ).length;
    if (freeCount === 0) {
      container.append(el("div", { class: "muted" }, "Все слоты на эту дату уже заняты. Попробуйте выбрать другую дату."));
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
        el("div", { class: "slot-tube" }),
        el("div", { class: "slot-time" }, slot.time),
        el("div", { class: `slot-status ${taken ? "busy" : "free"}` }, taken ? "Занято" : "Свободно"),
      ));
    }
  }

  async function handleRegister() {
    const user = state.currentUser;
    if (!state.selectedEventId)        { showMsg("#register-msg", "Выберите активность.", "error", { scroll: true }); return; }
    if (!state.selectedType)           { showMsg("#register-msg", "Выберите тип участия.", "error", { scroll: true }); return; }
    if (!state.selectedDate)           { showMsg("#register-msg", "Выберите дату.", "error", { scroll: true }); return; }
    if (state.selectedSlotIndex === null) { showMsg("#register-msg", "Выберите свободное время.", "error", { scroll: true }); return; }

    const btn = $("#register-submit");
    const setBtn = (children) => { btn.innerHTML = ""; btn.append(...children); };
    btn.disabled = true;
    setBtn([icon("droplet"), "Смешиваем реактивы…"]);

    try {
      state.records = await Api.getRecords();

      if (isRegisteredForEvent(state.records, savedKey(), state.selectedEventId)) {
        const ev = findEvent(state.selectedEventId);
        showModal({ type: "error", title: "Вы уже в эксперименте",
          text: `На «${ev.title}» можно записаться только один раз. Свою запись найдёте во вкладке «Мои записи».`,
        });
        fillEventCards();
        renderSlots();
        return;
      }

      const cd = checkCooldown(state.records, savedKey(), state.cfg.registration_cooldown_minutes);
      if (!cd.allowed) {
        showModal({ type: "error", title: "Реакция ещё идёт",
          text: `Следующая запись откроется через ${formatRemaining(cd.remainingMs)}.` });
        return;
      }

      if (isSlotTaken(state.records, state.selectedEventId, state.selectedDate, state.selectedSlotIndex, state.selectedType)) {
        state.selectedSlotIndex = null;
        renderSlots();
        showModal({ type: "error", title: "Колбу уже заняли", text: "Это время только что забрали. Выберите другую свободную пробирку." });
        return;
      }

      const ev        = findEvent(state.selectedEventId);
      const eventDate = findEventDate(ev, state.selectedDate);
      const slot      = eventDate.slots[state.selectedSlotIndex];

      state.records = await Api.addRecord({
        userKey:    savedKey(),
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
        type: "success", title: "Реакция пошла! 🎉",
        text: `Вы записаны: ${ev.title} · ${eventDate.dateLabel} · ${slot.time} · ${ptypeLabel(state.selectedType)}.`,
        buttonText: "К мероприятиям",
        onClose: () => { state.activeTabEventId = ev.id; setView("schedule"); },
      });
    } catch (e) {
      if (e?.code === "slot_taken") {
        try { state.records = await Api.getRecords(); } catch {}
        state.selectedSlotIndex = null;
        renderSlots();
        showModal({ type: "error", title: "Колбу уже заняли", text: "Это время только что забрали. Выберите другую свободную пробирку." });
      } else {
        showModal({ type: "error", title: "Реакция не удалась", text: "Что-то пошло не так. Попробуйте записаться ещё раз." });
      }
    } finally {
      btn.disabled = false;
      setBtn([icon("flask"), "Записаться"]);
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
          const mine = savedKey() && rec.userKey === savedKey();
          return el("td", { class: "cell-name" + (mine ? " cell-mine" : "") }, `${rec.firstName} ${rec.lastName}`);
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
      el("h2", {}, icon("beaker", { size: 24 }), ev.title),
      el("p", { class: "event-desc" }, ev.description),
      el("div", { class: "event-meta" },
        ev.location ? el("div", { class: "event-meta-row" },
          el("span", { class: "event-meta-label" }, "Место:"),
          el("span", {}, ev.location),
        ) : null,
        ev.prepNote ? el("div", { class: "event-meta-row" },
          el("span", { class: "event-meta-label" }, "Как начать:"),
          el("span", {}, ev.prepNote),
        ) : null,
      ),
      ...ev.dates.map((eventDate) =>
        el("div", { class: "date-block" },
          el("h3", {}, eventDate.dateLabel),
          buildDateTable(ev, eventDate),
        ),
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
    state.refreshTimer = setInterval(refreshRecords, state.cfg.refresh_interval_seconds * 1000);
  }

  async function refreshFormSlots() {
    if (state.view !== "register" || !state.currentUser) return;
    try { state.records = await Api.getRecords(); } catch { return; }
    fillEventCards();
    if (state.selectedEventId) fillTypeCards();
    if (state.selectedEventId) fillDateCards();
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
    root.append(el("div", { class: "card" },
      el("h2", {}, icon("clipboard", { size: 24 }), "Мои записи"),
      renderUserCard(user),
      list,
    ));

    try { state.records = await Api.getRecords(); }
    catch {
      list.innerHTML = "";
      list.append(el("div", { class: "msg error" }, "Не удалось загрузить записи. Попробуйте обновить страницу."));
      return;
    }

    const mine = getUserRecords(state.records, savedKey());
    list.innerHTML = "";

    if (!mine.length) {
      const emptyFlask = icon("flask", { size: 56, stroke: 1.4 });
      emptyFlask.setAttribute("class", "empty-flask");
      list.append(el("div", { class: "empty-state" },
        emptyFlask,
        el("div", {}, "Ваши колбы пока пусты. Загляните во вкладку «Записаться» и выберите эксперимент."),
      ));
      return;
    }

    list.append(el("div", { class: "mine-contact-note" },
      "Нужно изменить или отменить запись? Напишите ",
      el("strong", {}, "Тане"),
      " в Mattermost.",
    ));

    for (const rec of mine) {
      list.append(el("div", { class: "my-record" },
        el("div", { class: "mr-flask" }, icon("flask", { size: 20 })),
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
    $("#nav-register").addEventListener("click", () => setView("register", { fromNav: true }));
    $("#nav-schedule").addEventListener("click", () => setView("schedule", { fromNav: true }));
    $("#nav-mine").addEventListener("click",     () => setView("mine",     { fromNav: true }));

    $("#view-register").append(el("div", { class: "card" }, el("div", { class: "muted" }, "Загрузка…")));

    try {
      [state.events, state.roles, state.ptypes, state.cfg] = await Promise.all([
        Api.getEvents(),
        Api.getRoles(),
        Api.getParticipationTypes(),
        Api.getConfig(),
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
    const user = sk ? await Api.getUserByKey(sk).catch(() => null) : null;
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
