/**
 * Основная логика приложения: навигация, регистрация, табы мероприятий.
 * Зависит от config.js, events.js, api.js (подключаются раньше в index.html).
 */

(() => {
  // -------------------- Состояние ----------------------------------------
  const state = {
    view: "register", // "register" | "schedule"
    currentUser: null, // объект пользователя после ввода ключа
    selectedEventId: null, // выбранное мероприятие в форме
    selectedDate: null, // выбранная дата мероприятия
    selectedType: null, // выбранный тип участия
    selectedSlotIndex: null, // выбранный слот
    records: [], // последние загруженные записи
    activeTabEventId: EVENTS[0] ? EVENTS[0].id : null,
    refreshTimer: null, // автообновление графика (schedule)
    formRefreshTimer: null, // автообновление слотов на форме (register)
  };

  // -------------------- Хелперы DOM --------------------------------------
  const $ = (sel) => document.querySelector(sel);
  const el = (tag, props = {}, ...children) => {
    const node = document.createElement(tag);
    Object.entries(props).forEach(([k, v]) => {
      if (k === "class") node.className = v;
      else if (k === "html") node.innerHTML = v;
      else if (k.startsWith("on") && typeof v === "function") {
        node.addEventListener(k.slice(2).toLowerCase(), v);
      } else if (v !== null && v !== undefined) {
        node.setAttribute(k, v);
      }
    });
    children.flat().forEach((c) => {
      if (c == null) return;
      node.append(c.nodeType ? c : document.createTextNode(c));
    });
    return node;
  };

  // -------------------- Модальное окно -----------------------------------
  /**
   * Показать модалку. opts: { type: "success"|"error", title, text,
   * buttonText, onClose }. Закрывается по кнопке, клику на фон и Esc.
   */
  function showModal({ type = "success", title, text, buttonText = "Понятно", onClose }) {
    const root = $("#modal-root");
    root.innerHTML = "";

    const close = () => {
      root.innerHTML = "";
      document.removeEventListener("keydown", onEsc);
      if (onClose) onClose();
    };
    const onEsc = (e) => {
      if (e.key === "Escape") close();
    };
    document.addEventListener("keydown", onEsc);

    const icon = el(
      "div",
      { class: `modal-icon ${type}` },
      type === "success" ? "✓" : "!"
    );

    const modal = el(
      "div",
      { class: "modal", onClick: (e) => e.stopPropagation() },
      icon,
      el("h3", {}, title),
      text ? el("p", {}, text) : null,
      el("button", { class: "btn", onClick: close }, buttonText)
    );

    const overlay = el("div", { class: "modal-overlay", onClick: close }, modal);
    root.append(overlay);
  }

  // -------------------- Сохранённый ключ ---------------------------------
  const SAVED_KEY = "saved_user_key";

  function saveUserKey(key) {
    try {
      localStorage.setItem(SAVED_KEY, key);
    } catch (e) {
      /* localStorage может быть недоступен — не критично */
    }
  }

  function getSavedUserKey() {
    try {
      return localStorage.getItem(SAVED_KEY);
    } catch (e) {
      return null;
    }
  }

  function clearSavedUserKey() {
    try {
      localStorage.removeItem(SAVED_KEY);
    } catch (e) {
      /* игнорируем */
    }
  }

  // -------------------- Навигация ----------------------------------------
  function setView(view) {
    state.view = view;
    $("#nav-register").classList.toggle("active", view === "register");
    $("#nav-schedule").classList.toggle("active", view === "schedule");
    $("#nav-mine").classList.toggle("active", view === "mine");
    $("#view-register").classList.toggle("hidden", view !== "register");
    $("#view-schedule").classList.toggle("hidden", view !== "schedule");
    $("#view-mine").classList.toggle("hidden", view !== "mine");

    if (view === "schedule") {
      startScheduleAutoRefresh();
    } else {
      stopScheduleAutoRefresh();
    }

    // Автообновление слотов на форме регистрации.
    stopFormAutoRefresh();
    if (view === "register" && state.currentUser) {
      state.formRefreshTimer = setInterval(
        refreshFormSlots,
        CONFIG.refreshIntervalMs
      );
    }

    if (view === "mine") {
      renderMyRecords();
    }
  }

  function stopFormAutoRefresh() {
    if (state.formRefreshTimer) {
      clearInterval(state.formRefreshTimer);
      state.formRefreshTimer = null;
    }
  }

  // ===================== ЭКРАН РЕГИСТРАЦИИ ===============================

  function renderRegisterStart() {
    const root = $("#view-register");
    root.innerHTML = "";

    const note = Api.isConfigured
      ? null
      : el(
          "div",
          { class: "msg info" },
          "Демо-режим: ключи jsonbin не заданы, данные сохраняются локально в браузере. " +
            "Заполните CONFIG.jsonbin в js/config.js для общего доступа."
        );

    const card = el(
      "div",
      { class: "card" },
      el("h1", {}, "Регистрация на мероприятие"),
      el(
        "p",
        { class: "subtitle" },
        "Введите персональный ключ, который вам выдали в личных сообщениях."
      ),
      note,
      el("div", { id: "register-msg" }),
      el(
        "div",
        { class: "field" },
        el("label", { for: "key-input" }, "Персональный ключ"),
        el("input", {
          id: "key-input",
          type: "text",
          placeholder: "Например: 123",
          autocomplete: "off",
        })
      ),
      el(
        "button",
        { class: "btn", id: "key-submit", onClick: handleKeySubmit },
        "Продолжить"
      )
    );

    root.append(card);

    const input = $("#key-input");
    input.addEventListener("keydown", (e) => {
      if (e.key === "Enter") handleKeySubmit();
    });
    input.focus();
  }

  function showRegisterMsg(text, type) {
    const box = $("#register-msg");
    if (!box) return;
    box.innerHTML = "";
    box.append(el("div", { class: `msg ${type}` }, text));
  }

  async function handleKeySubmit() {
    const key = $("#key-input").value.trim();
    if (!key) {
      showRegisterMsg("Введите ключ.", "error");
      return;
    }
    const user = findUserByKey(key);
    if (!user) {
      showRegisterMsg("Ключ не найден. Проверьте и попробуйте ещё раз.", "error");
      return;
    }

    // Запоминаем ключ, чтобы при следующем заходе войти автоматически.
    saveUserKey(user.key);

    state.currentUser = user;
    renderRegistrationForm();
    // setView запускает автообновление слотов на форме (теперь есть currentUser).
    setView("register");
  }

  /** Какие типы участия доступны пользователю по его роли. */
  function typesForUser(user) {
    return Object.entries(CONFIG.participationTypes)
      .filter(([, def]) => def.forRole === user.role)
      .map(([id, def]) => ({ id, label: def.label }));
  }

  function renderRegistrationForm() {
    const user = state.currentUser;
    const root = $("#view-register");
    root.innerHTML = "";

    const roleLabel = CONFIG.roles[user.role] || user.role;
    const userTypes = typesForUser(user);

    // Сброс выбора
    state.selectedEventId = null;
    state.selectedDate = null;
    state.selectedType = userTypes.length === 1 ? userTypes[0].id : null;
    state.selectedSlotIndex = null;

    const badge = el(
      "div",
      { class: "user-badge" },
      `${user.lastName} ${user.firstName}`,
      el(
        "span",
        { class: `role-pill ${user.role === "tck" ? "tck" : ""}` },
        roleLabel
      )
    );

    // Селект мероприятия (опции достроятся в fillEventOptions после загрузки записей)
    const eventSelect = el("select", {
      id: "event-select",
      onChange: onEventChange,
    });

    // Селект даты (заполняется после выбора мероприятия)
    const dateSelect = el(
      "select",
      { id: "date-select", onChange: onDateOrTypeChange, disabled: "true" },
      el("option", { value: "" }, "— сначала выберите мероприятие —")
    );

    // Селект типа участия (если у роли больше одного типа)
    let typeField = null;
    if (userTypes.length > 1) {
      typeField = el(
        "div",
        { class: "field" },
        el("label", { for: "type-select" }, "Тип участия"),
        el(
          "select",
          { id: "type-select", onChange: onDateOrTypeChange },
          ...userTypes.map((t) => el("option", { value: t.id }, t.label))
        )
      );
      // По умолчанию первый тип
      state.selectedType = userTypes[0].id;
    } else if (userTypes.length === 1) {
      typeField = el(
        "div",
        { class: "field" },
        el("label", {}, "Тип участия"),
        el("div", { class: "muted" }, userTypes[0].label)
      );
    }

    const card = el(
      "div",
      { class: "card" },
      el("h1", {}, "Запись на слот"),
      badge,
      el("div", { id: "register-msg" }),
      el(
        "div",
        { class: "field" },
        el("label", { for: "event-select" }, "Мероприятие"),
        eventSelect
      ),
      el(
        "div",
        { class: "field" },
        el("label", { for: "date-select" }, "Дата"),
        dateSelect
      ),
      typeField,
      el(
        "div",
        { class: "field" },
        el("label", {}, "Свободное время"),
        el(
          "div",
          { id: "slots-container", class: "slots-grid" },
          el("div", { class: "muted" }, "Сначала выберите мероприятие.")
        )
      ),
      el(
        "div",
        { style: "display:flex; gap:10px; flex-wrap:wrap;" },
        el(
          "button",
          { class: "btn", id: "register-submit", onClick: handleRegister },
          "Записаться"
        )
      )
    );

    root.append(card);

    // Опции мероприятий (пока без пометок «уже записан» — записи ещё не загружены).
    fillEventOptions();

    // Подгружаем актуальные записи: нужны для отображения занятости слотов
    // и для проверки лимита 3 часа.
    loadRecordsForForm(user);
  }

  /**
   * Заполнить селект мероприятий. Если пользователь уже записан на мероприятие,
   * помечаем его и блокируем выбор (1 запись на мероприятие).
   */
  function fillEventOptions() {
    const select = $("#event-select");
    if (!select) return;
    const user = state.currentUser;
    select.innerHTML = "";
    select.append(el("option", { value: "" }, "— выберите мероприятие —"));
    EVENTS.forEach((ev) => {
      const already =
        user && isRegisteredForEvent(state.records, user.key, ev.id);
      const opt = el(
        "option",
        { value: ev.id },
        already ? `${ev.title} — вы уже записаны` : ev.title
      );
      if (already) opt.disabled = true;
      select.append(opt);
    });
  }

  /** Загрузить записи и показать предупреждение о лимите, если он активен. */
  async function loadRecordsForForm(user) {
    try {
      state.records = await Api.getRecords();
    } catch (e) {
      showRegisterMsg(
        "Не удалось загрузить данные. Записи могут быть неактуальны.",
        "error"
      );
      return;
    }

    // Перестроим список мероприятий с учётом уже сделанных записей.
    fillEventOptions();

    const cd = checkCooldown(state.records, user.key);
    if (!cd.allowed) {
      showRegisterMsg(
        `Вы недавно записывались. Следующая запись доступна через ` +
          `${formatRemaining(cd.remainingMs)}.`,
        "info"
      );
    }
    // Перерисуем слоты с учётом занятости (если мероприятие уже выбрано).
    if (state.selectedEventId && state.selectedDate) renderSlots();
  }

  // Смена мероприятия: перезаполняем список дат и сбрасываем дату/слот.
  function onEventChange() {
    const eventId = $("#event-select").value;
    state.selectedEventId = eventId || null;
    state.selectedDate = null;
    state.selectedSlotIndex = null;

    const dateSelect = $("#date-select");
    dateSelect.innerHTML = "";

    const ev = state.selectedEventId ? findEventById(state.selectedEventId) : null;
    if (!ev) {
      dateSelect.disabled = true;
      dateSelect.append(
        el("option", { value: "" }, "— сначала выберите мероприятие —")
      );
    } else {
      dateSelect.disabled = false;
      dateSelect.append(el("option", { value: "" }, "— выберите дату —"));
      ev.dates.forEach((d) =>
        dateSelect.append(el("option", { value: d.date }, d.dateLabel))
      );
    }

    renderSlots();
  }

  // Смена даты или типа участия.
  function onDateOrTypeChange() {
    const dateSelect = $("#date-select");
    state.selectedDate = dateSelect ? dateSelect.value || null : null;
    state.selectedSlotIndex = null;

    const typeSelect = $("#type-select");
    if (typeSelect) state.selectedType = typeSelect.value;

    renderSlots();
  }

  function renderSlots() {
    const container = $("#slots-container");
    container.innerHTML = "";

    if (!state.selectedEventId) {
      container.append(el("div", { class: "muted" }, "Сначала выберите мероприятие."));
      return;
    }
    if (!state.selectedDate) {
      container.append(el("div", { class: "muted" }, "Выберите дату."));
      return;
    }

    const ev = findEventById(state.selectedEventId);
    const eventDate = findEventDate(ev, state.selectedDate);
    const type = state.selectedType;

    if (!eventDate) {
      container.append(el("div", { class: "muted" }, "Выберите дату."));
      return;
    }

    // Слоты выбранной даты, в которых доступен выбранный тип участия.
    const available = eventDate.slots
      .map((slot, index) => ({ slot, index }))
      .filter(({ slot }) => slot.types.includes(type));

    if (available.length === 0) {
      container.append(
        el(
          "div",
          { class: "muted" },
          "Для вашего типа участия на эту дату нет слотов."
        )
      );
      return;
    }

    available.forEach(({ slot, index }) => {
      const taken = isSlotTaken(
        state.records,
        ev.id,
        state.selectedDate,
        index,
        type
      );
      const selected = state.selectedSlotIndex === index;

      const node = el(
        "div",
        {
          class:
            "slot" + (taken ? " taken" : "") + (selected ? " selected" : ""),
          onClick: () => {
            if (taken) return;
            state.selectedSlotIndex = index;
            renderSlots();
          },
        },
        el(
          "div",
          {},
          el("div", { class: "slot-time" }, slot.time),
          el(
            "div",
            { class: "slot-meta" },
            CONFIG.participationTypes[type].label
          )
        ),
        el(
          "div",
          { class: "slot-status " + (taken ? "busy" : "free") },
          taken ? "Занято" : "Свободно"
        )
      );
      container.append(node);
    });
  }

  async function handleRegister() {
    const user = state.currentUser;
    if (!state.selectedEventId) {
      showRegisterMsg("Выберите мероприятие.", "error");
      return;
    }
    if (!state.selectedDate) {
      showRegisterMsg("Выберите дату.", "error");
      return;
    }
    if (!state.selectedType) {
      showRegisterMsg("Выберите тип участия.", "error");
      return;
    }
    if (state.selectedSlotIndex === null) {
      showRegisterMsg("Выберите свободное время.", "error");
      return;
    }

    const btn = $("#register-submit");
    btn.disabled = true;
    btn.textContent = "Записываем…";

    try {
      // Перечитываем актуальные данные перед записью.
      state.records = await Api.getRecords();

      // Проверка: не записан ли уже на это мероприятие (1 запись на мероприятие).
      if (isRegisteredForEvent(state.records, user.key, state.selectedEventId)) {
        const ev = findEventById(state.selectedEventId);
        showModal({
          type: "error",
          title: "Вы уже записаны",
          text: `На «${ev.title}» можно записаться только один раз. ` +
            `Посмотреть свою запись можно во вкладке «Мои записи».`,
        });
        fillEventOptions();
        renderSlots();
        return;
      }

      // Повторная проверка лимита (мог записаться с другого устройства).
      const cd = checkCooldown(state.records, user.key);
      if (!cd.allowed) {
        showModal({
          type: "error",
          title: "Ещё рано",
          text: `Запись доступна раз в ${CONFIG.registrationCooldownHours} ч. ` +
            `Подождите ещё ${formatRemaining(cd.remainingMs)}.`,
        });
        return;
      }

      // Повторная проверка занятости слота (мог занять кто-то другой).
      if (
        isSlotTaken(
          state.records,
          state.selectedEventId,
          state.selectedDate,
          state.selectedSlotIndex,
          state.selectedType
        )
      ) {
        // Мгновенно помечаем слот занятым и сбрасываем выбор.
        state.selectedSlotIndex = null;
        renderSlots();
        showModal({
          type: "error",
          title: "Слот уже занят",
          text: "Это время только что заняли. Выберите другой свободный слот.",
        });
        return;
      }

      const ev = findEventById(state.selectedEventId);
      const eventDate = findEventDate(ev, state.selectedDate);
      const slot = eventDate.slots[state.selectedSlotIndex];
      const record = {
        userKey: user.key,
        lastName: user.lastName,
        firstName: user.firstName,
        role: user.role,
        eventId: ev.id,
        eventTitle: ev.title,
        date: eventDate.date,
        eventDate: eventDate.dateLabel,
        slotIndex: state.selectedSlotIndex,
        slotTime: slot.time,
        type: state.selectedType,
        createdAt: new Date().toISOString(),
      };

      state.records = await Api.addRecord(record);

      // Сбрасываем выбор слота.
      state.selectedSlotIndex = null;

      // Модалка успеха → возврат на «Мероприятия» с активным табом события.
      showModal({
        type: "success",
        title: "Вы записаны!",
        text: `${ev.title} · ${eventDate.dateLabel} · ${slot.time} · ` +
          `${CONFIG.participationTypes[state.selectedType].label}.`,
        buttonText: "К мероприятиям",
        onClose: () => {
          state.activeTabEventId = ev.id;
          setView("schedule");
        },
      });
    } catch (e) {
      showModal({
        type: "error",
        title: "Не удалось записаться",
        text: "Произошла ошибка. Попробуйте ещё раз.",
      });
    } finally {
      btn.disabled = false;
      btn.textContent = "Записаться";
    }
  }

  // ===================== ЭКРАН РАСПИСАНИЯ (ТАБЫ) ========================

  function renderScheduleShell() {
    const root = $("#view-schedule");
    root.innerHTML = "";

    const tabs = el(
      "div",
      { class: "event-tabs", id: "event-tabs" },
      ...EVENTS.map((ev) =>
        el(
          "button",
          {
            class:
              "event-tab" +
              (ev.id === state.activeTabEventId ? " active" : ""),
            onClick: () => {
              state.activeTabEventId = ev.id;
              renderScheduleShell();
            },
          },
          ev.title,
          el("small", {}, ev.dates.map((d) => d.dateLabel).join(" · "))
        )
      )
    );

    const card = el(
      "div",
      { class: "card", id: "event-detail" },
      el("div", { class: "muted" }, "Загрузка…")
    );

    root.append(tabs, card);
    renderEventDetail();
  }

  /** Построить таблицу графика для одной даты мероприятия. */
  function buildDateTable(ev, eventDate) {
    // Типы, встречающиеся в слотах этой даты (в фиксированном порядке).
    const orderedTypes = ["train", "personal", "tck"];
    const usedTypes = orderedTypes.filter((t) =>
      eventDate.slots.some((s) => s.types.includes(t))
    );

    const headerRow = el(
      "tr",
      {},
      el("th", {}, "Время"),
      ...usedTypes.map((t) => el("th", {}, CONFIG.participationTypes[t].label))
    );

    const bodyRows = eventDate.slots.map((slot, index) => {
      const cells = usedTypes.map((t) => {
        if (!slot.types.includes(t)) {
          return el("td", { class: "cell-empty" }, "—");
        }
        const rec = findSlotRecord(
          state.records,
          ev.id,
          eventDate.date,
          index,
          t
        );
        if (rec) {
          const mine =
            state.currentUser && rec.userKey === state.currentUser.key;
          return el(
            "td",
            { class: "cell-name" + (mine ? " cell-mine" : "") },
            `${rec.lastName} ${rec.firstName}`
          );
        }
        return el("td", { class: "cell-free" }, "свободно");
      });
      return el("tr", {}, el("td", { class: "slot-time" }, slot.time), ...cells);
    });

    return el(
      "table",
      { class: "schedule-table" },
      el("thead", {}, headerRow),
      el("tbody", {}, ...bodyRows)
    );
  }

  function renderEventDetail() {
    const ev = findEventById(state.activeTabEventId);
    const card = $("#event-detail");
    if (!ev || !card) return;

    const head = el(
      "div",
      {},
      el("h2", {}, ev.title),
      el("p", { style: "margin-bottom:20px;" }, ev.description)
    );

    // По блоку на каждую дату.
    const dateBlocks = ev.dates.map((eventDate) =>
      el(
        "div",
        { style: "margin-bottom:24px;" },
        el(
          "h3",
          { style: "margin-bottom:6px; font-size:1.05rem;" },
          eventDate.dateLabel
        ),
        buildDateTable(ev, eventDate)
      )
    );

    const note = el(
      "div",
      { class: "refresh-note" },
      el("span", { class: "dot" }),
      `График обновляется автоматически раз в ${Math.round(
        CONFIG.refreshIntervalMs / 1000
      )} секунд.`
    );

    card.innerHTML = "";
    card.append(head, ...dateBlocks, note);
  }

  async function refreshRecords() {
    try {
      state.records = await Api.getRecords();
      if (state.view === "schedule") renderEventDetail();
    } catch (e) {
      // Молча игнорируем ошибку автообновления, чтобы не мешать.
      console.warn("Не удалось обновить записи:", e);
    }
  }

  function startScheduleAutoRefresh() {
    renderScheduleShell();
    refreshRecords();
    stopScheduleAutoRefresh();
    state.refreshTimer = setInterval(refreshRecords, CONFIG.refreshIntervalMs);
  }

  // Автообновление слотов на форме регистрации: если кто-то занял слот, пока
  // пользователь выбирает, он отметится как «занято» без действий пользователя.
  async function refreshFormSlots() {
    if (state.view !== "register" || !state.currentUser) return;
    try {
      state.records = await Api.getRecords();
    } catch (e) {
      return;
    }
    fillEventOptions();
    // Восстановим выбранное мероприятие в селекте (fillEventOptions сбрасывает).
    const eventSelect = $("#event-select");
    if (eventSelect && state.selectedEventId) {
      eventSelect.value = state.selectedEventId;
    }
    // Если выбранный слот успели занять — снимаем выбор.
    if (
      state.selectedEventId &&
      state.selectedDate &&
      state.selectedSlotIndex !== null &&
      isSlotTaken(
        state.records,
        state.selectedEventId,
        state.selectedDate,
        state.selectedSlotIndex,
        state.selectedType
      )
    ) {
      state.selectedSlotIndex = null;
    }
    if (state.selectedEventId && state.selectedDate) renderSlots();
  }

  function stopScheduleAutoRefresh() {
    if (state.refreshTimer) {
      clearInterval(state.refreshTimer);
      state.refreshTimer = null;
    }
  }

  // ===================== ВКЛАДКА «МОИ ЗАПИСИ» ===========================

  async function renderMyRecords() {
    const root = $("#view-mine");
    root.innerHTML = "";

    const user = state.currentUser;
    if (!user) {
      root.append(
        el(
          "div",
          { class: "card" },
          el("div", { class: "empty-state" }, "Сначала войдите по ключу.")
        )
      );
      return;
    }

    const card = el(
      "div",
      { class: "card" },
      el("h2", {}, "Мои записи"),
      el("div", { id: "mine-list" }, el("div", { class: "muted" }, "Загрузка…"))
    );
    root.append(card);

    // Подгружаем свежие данные.
    try {
      state.records = await Api.getRecords();
    } catch (e) {
      $("#mine-list").innerHTML = "";
      $("#mine-list").append(
        el("div", { class: "msg error" }, "Не удалось загрузить записи.")
      );
      return;
    }

    const mine = getUserRecords(state.records, user.key);
    const list = $("#mine-list");
    list.innerHTML = "";

    if (mine.length === 0) {
      list.append(
        el(
          "div",
          { class: "empty-state" },
          "Вы пока никуда не записаны. Перейдите во вкладку «Регистрация»."
        )
      );
      return;
    }

    mine.forEach((rec) => {
      const typeLabel =
        (CONFIG.participationTypes[rec.type] &&
          CONFIG.participationTypes[rec.type].label) ||
        rec.type;
      list.append(
        el(
          "div",
          { class: "my-record" },
          el(
            "div",
            {},
            el("div", { class: "mr-title" }, rec.eventTitle),
            el(
              "div",
              { class: "mr-meta" },
              `${rec.eventDate} · ${rec.slotTime}`
            )
          ),
          el("span", { class: "mr-type" }, typeLabel)
        )
      );
    });
  }

  // -------------------- Инициализация ------------------------------------
  function init() {
    $("#nav-register").addEventListener("click", () => setView("register"));
    $("#nav-schedule").addEventListener("click", () => setView("schedule"));
    $("#nav-mine").addEventListener("click", () => setView("mine"));

    // Если ключ был сохранён ранее и пользователь с таким ключом всё ещё есть
    // в конфиге — сразу открываем форму записи, минуя ввод ключа.
    const savedKey = getSavedUserKey();
    const savedUser = savedKey ? findUserByKey(savedKey) : null;
    if (savedUser) {
      state.currentUser = savedUser;
      renderRegistrationForm();
    } else {
      // Ключа нет или он больше не валиден — чистим и показываем ввод.
      if (savedKey) clearSavedUserKey();
      renderRegisterStart();
    }

    setView("register");
  }

  document.addEventListener("DOMContentLoaded", init);
})();
