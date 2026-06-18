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
    refreshTimer: null,
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
    $("#view-register").classList.toggle("hidden", view !== "register");
    $("#view-schedule").classList.toggle("hidden", view !== "schedule");

    if (view === "schedule") {
      startScheduleAutoRefresh();
    } else {
      stopScheduleAutoRefresh();
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

    // Селект мероприятия
    const eventSelect = el(
      "select",
      { id: "event-select", onChange: onEventChange },
      el("option", { value: "" }, "— выберите мероприятие —"),
      ...EVENTS.map((ev) => el("option", { value: ev.id }, ev.title))
    );

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

    // Подгружаем актуальные записи: нужны для отображения занятости слотов
    // и для проверки лимита 3 часа.
    loadRecordsForForm(user);
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

      // Повторная проверка лимита (мог записаться с другого устройства).
      const cd = checkCooldown(state.records, user.key);
      if (!cd.allowed) {
        showRegisterMsg(
          `Регистрация доступна раз в ${CONFIG.registrationCooldownHours} ч. ` +
            `Подождите ещё ${formatRemaining(cd.remainingMs)}.`,
          "error"
        );
        return;
      }

      // Повторная проверка занятости слота.
      if (
        isSlotTaken(
          state.records,
          state.selectedEventId,
          state.selectedDate,
          state.selectedSlotIndex,
          state.selectedType
        )
      ) {
        showRegisterMsg("Этот слот только что заняли. Выберите другой.", "error");
        renderSlots();
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

      showRegisterMsg(
        `Готово! Вы записаны: ${ev.title} (${eventDate.dateLabel}), ${slot.time}, ` +
          `${CONFIG.participationTypes[state.selectedType].label}.`,
        "success"
      );
      // Сбрасываем выбор слота, обновляем доступность.
      state.selectedSlotIndex = null;
      renderSlots();
    } catch (e) {
      showRegisterMsg("Не удалось записаться. Попробуйте ещё раз.", "error");
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
          return el(
            "td",
            { class: "cell-name" },
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

  function stopScheduleAutoRefresh() {
    if (state.refreshTimer) {
      clearInterval(state.refreshTimer);
      state.refreshTimer = null;
    }
  }

  // -------------------- Инициализация ------------------------------------
  function init() {
    $("#nav-register").addEventListener("click", () => setView("register"));
    $("#nav-schedule").addEventListener("click", () => setView("schedule"));

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
