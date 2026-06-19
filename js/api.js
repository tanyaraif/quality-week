/**
 * Модуль работы с jsonbin.io.
 *
 * В bin хранится объект вида:
 *   { "records": [ { запись }, ... ] }
 *
 * Запись (record):
 *   {
 *     userKey:    "123",
 *     lastName:   "Тестов",
 *     firstName:  "Тест",
 *     role:       "service",
 *     eventId:    "feedback-29",
 *     eventTitle: "Мастер-класс по обратной связи",
 *     slotIndex:  0,
 *     slotTime:   "14:00–14:30",
 *     type:       "train",
 *     createdAt:  "2026-06-18T10:00:00.000Z"
 *   }
 *
 * Если ключи jsonbin не заданы (плейсхолдеры), модуль автоматически работает
 * через localStorage — это позволяет тестировать сайт локально без бэкенда.
 */

const Api = (() => {
  const { binId, accessKey, baseUrl } = CONFIG.jsonbin;

  const isConfigured =
    binId &&
    accessKey &&
    binId !== "ВСТАВЬТЕ_BIN_ID" &&
    accessKey !== "ВСТАВЬТЕ_ACCESS_KEY";

  const LOCAL_STORAGE_KEY = "registrations_fallback";

  // -------------------- localStorage fallback ----------------------------
  function localGet() {
    try {
      const raw = localStorage.getItem(LOCAL_STORAGE_KEY);
      return raw ? JSON.parse(raw) : { records: [] };
    } catch (e) {
      return { records: [] };
    }
  }

  function localPut(data) {
    localStorage.setItem(LOCAL_STORAGE_KEY, JSON.stringify(data));
    return data;
  }

  // -------------------- jsonbin -----------------------------------------
  async function remoteGet() {
    const res = await fetch(`${baseUrl}/${binId}/latest`, {
      method: "GET",
      headers: {
        "X-Access-Key": accessKey,
        "X-Bin-Meta": "false",
      },
    });
    if (!res.ok) {
      throw new Error(`jsonbin GET ${res.status}: ${await res.text()}`);
    }
    const data = await res.json();
    // X-Bin-Meta:false возвращает сам record напрямую.
    if (data && Array.isArray(data.records)) return data;
    return { records: [] };
  }

  async function remotePut(data) {
    const res = await fetch(`${baseUrl}/${binId}`, {
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
        "X-Access-Key": accessKey,
      },
      body: JSON.stringify(data),
    });
    if (!res.ok) {
      throw new Error(`jsonbin PUT ${res.status}: ${await res.text()}`);
    }
    return data;
  }

  // -------------------- Публичный API ------------------------------------

  /** Получить { records: [...] }. */
  async function getData() {
    return isConfigured ? remoteGet() : localGet();
  }

  /** Получить только массив записей. */
  async function getRecords() {
    const data = await getData();
    return Array.isArray(data.records) ? data.records : [];
  }

  /**
   * Добавить запись. Делает повторное чтение прямо перед записью, чтобы
   * снизить риск гонок (полностью на jsonbin это не решается, но для
   * небольшой активности достаточно). Возвращает обновлённый массив.
   */
  async function addRecord(record) {
    const data = await getData();
    if (!Array.isArray(data.records)) data.records = [];
    data.records.push(record);
    if (isConfigured) {
      await remotePut(data);
    } else {
      localPut(data);
    }
    return data.records;
  }

  return {
    isConfigured,
    getRecords,
    addRecord,
  };
})();

// -------------------- Бизнес-правила (не зависят от транспорта) ----------

/**
 * Проверить лимит «раз в N часов» по ключу.
 * Возвращает { allowed: boolean, remainingMs: number }.
 */
function checkCooldown(records, userKey) {
  const cooldownMs = CONFIG.registrationCooldownHours * 60 * 60 * 1000;
  const userRecords = records
    .filter((r) => r.userKey === userKey)
    .map((r) => new Date(r.createdAt).getTime())
    .filter((t) => !isNaN(t));

  if (userRecords.length === 0) {
    return { allowed: true, remainingMs: 0 };
  }

  const last = Math.max(...userRecords);
  const elapsed = Date.now() - last;
  if (elapsed >= cooldownMs) {
    return { allowed: true, remainingMs: 0 };
  }
  return { allowed: false, remainingMs: cooldownMs - elapsed };
}

/** Проверить, занята ли конкретная ячейка (мероприятие + дата + слот + тип). */
function isSlotTaken(records, eventId, date, slotIndex, type) {
  return records.some(
    (r) =>
      r.eventId === eventId &&
      r.date === date &&
      r.slotIndex === slotIndex &&
      r.type === type
  );
}

/** Найти запись, занявшую ячейку (для отображения «кто записан»). */
function findSlotRecord(records, eventId, date, slotIndex, type) {
  return (
    records.find(
      (r) =>
        r.eventId === eventId &&
        r.date === date &&
        r.slotIndex === slotIndex &&
        r.type === type
    ) || null
  );
}

/** Все записи конкретного пользователя (по ключу), новые сверху. */
function getUserRecords(records, userKey) {
  return records
    .filter((r) => r.userKey === userKey)
    .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
}

/** Записан ли пользователь на это мероприятие (любая дата/слот/тип). */
function isRegisteredForEvent(records, userKey, eventId) {
  return records.some((r) => r.userKey === userKey && r.eventId === eventId);
}

/** Отформатировать оставшееся время ожидания в «Ч ч ММ мин». */
function formatRemaining(ms) {
  const totalMinutes = Math.ceil(ms / 60000);
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  if (hours > 0) {
    return `${hours} ч ${String(minutes).padStart(2, "0")} мин`;
  }
  return `${minutes} мин`;
}
