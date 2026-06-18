/**
 * Конфигурация мероприятий и слотов.
 *
 * Структура (мероприятия сгруппированы по названию, внутри — разные даты):
 *   id          — уникальный идентификатор мероприятия.
 *   title       — название.
 *   description — текст про мероприятие (показывается в табе).
 *   dates       — список дат проведения. Каждая дата:
 *       date      — дата в формате YYYY-MM-DD.
 *       dateLabel — человекочитаемая дата для интерфейса.
 *       slots     — список слотов этой даты. Каждый слот:
 *           time  — временной интервал (текст).
 *           types — какие типы участия доступны в этом слоте.
 *
 * Один слот = одна запись на конкретный тип участия. То есть в один интервал
 * могут записаться три разных человека: один на train, один в личное время,
 * один из ТЦК — если для слота заданы все три типа.
 */

// Стандартный набор типов для слота сервисной поддержки + ТЦК.
const ALL_TYPES = ["train", "personal", "tck"];

const EVENTS = [
  {
    id: "feedback",
    title: "Мастер-класс по обратной связи",
    description:
      "Мастер-класс по обратной связи. Разбираем, как давать и принимать " +
      "обратную связь так, чтобы она работала.",
    dates: [
      {
        date: "2026-06-29",
        dateLabel: "29 июня, понедельник",
        slots: [
          { time: "14:00–14:30", types: ALL_TYPES },
          { time: "15:00–15:30", types: ALL_TYPES },
          { time: "16:00–16:30", types: ALL_TYPES },
          { time: "17:00–17:30", types: ALL_TYPES },
        ],
      },
      {
        date: "2026-06-30",
        dateLabel: "30 июня, вторник",
        slots: [
          { time: "14:00–14:30", types: ALL_TYPES },
          { time: "14:30–15:00", types: ALL_TYPES },
          { time: "15:00–15:30", types: ALL_TYPES },
          { time: "15:30–16:00", types: ALL_TYPES },
        ],
      },
    ],
  },

  {
    id: "inspector",
    title: "Инспектор на час",
    description:
      "Инспектор на час. Возможность побыть в роли инспектора и взглянуть " +
      "на процессы с другой стороны.",
    dates: [
      {
        date: "2026-06-30",
        dateLabel: "30 июня, вторник",
        slots: [
          { time: "16:00–17:00", types: ALL_TYPES },
          { time: "16:00–17:00", types: ALL_TYPES },
          { time: "17:00–18:00", types: ALL_TYPES },
          { time: "17:00–18:00", types: ALL_TYPES },
        ],
      },
      {
        date: "2026-07-01",
        dateLabel: "1 июля, среда",
        slots: [
          { time: "15:00–16:00", types: ALL_TYPES },
          { time: "16:00–17:00", types: ALL_TYPES },
          { time: "17:00–18:00", types: ALL_TYPES },
          { time: "18:00–19:00", types: ALL_TYPES },
        ],
      },
    ],
  },

  {
    id: "exchange",
    title: "Обмен опытом",
    description:
      "Обмен опытом. Делимся наработками, кейсами и лайфхаками друг с другом.",
    dates: [
      {
        date: "2026-07-01",
        dateLabel: "1 июля, среда",
        slots: [
          { time: "15:00–16:00", types: ALL_TYPES },
          { time: "16:00–17:00", types: ALL_TYPES },
          { time: "17:00–18:00", types: ALL_TYPES },
          { time: "18:00–19:00", types: ALL_TYPES },
        ],
      },
      {
        date: "2026-07-02",
        dateLabel: "2 июля, четверг",
        slots: [
          { time: "13:00–14:00", types: ALL_TYPES },
          { time: "14:00–15:00", types: ALL_TYPES },
          { time: "15:00–16:00", types: ALL_TYPES },
          { time: "16:00–17:00", types: ALL_TYPES },
        ],
      },
    ],
  },

  {
    id: "frankenstein",
    title: "Франкенштейн",
    description:
      "Франкенштейн. Собираем из разных частей и идей что-то новое и рабочее.",
    dates: [
      {
        date: "2026-07-02",
        dateLabel: "2 июля, четверг",
        slots: [
          { time: "14:30–15:00", types: ALL_TYPES },
          { time: "15:00–15:30", types: ALL_TYPES },
          { time: "15:30–16:00", types: ALL_TYPES },
          { time: "16:00–16:30", types: ALL_TYPES },
        ],
      },
      {
        date: "2026-07-03",
        dateLabel: "3 июля, пятница",
        slots: [
          { time: "15:00–15:30", types: ALL_TYPES },
          { time: "15:30–16:00", types: ALL_TYPES },
          { time: "16:00–16:30", types: ALL_TYPES },
          { time: "16:30–17:00", types: ALL_TYPES },
        ],
      },
    ],
  },

  {
    id: "owngame",
    title: "Своя игра",
    description:
      "Своя игра. Всего 4 места на каждую дату: 2 для сотрудников сервисной " +
      "поддержки (личное время) и 2 для команды ТЦК.",
    dates: [
      {
        date: "2026-07-02",
        dateLabel: "2 июля, четверг",
        slots: [
          { time: "18:00–20:00 · место 1", types: ["personal"] },
          { time: "18:00–20:00 · место 2", types: ["personal"] },
          { time: "18:00–20:00 · место 3", types: ["tck"] },
          { time: "18:00–20:00 · место 4", types: ["tck"] },
        ],
      },
      {
        date: "2026-07-03",
        dateLabel: "3 июля, пятница",
        slots: [
          { time: "17:00–19:00 · место 1", types: ["personal"] },
          { time: "17:00–19:00 · место 2", types: ["personal"] },
          { time: "17:00–19:00 · место 3", types: ["tck"] },
          { time: "17:00–19:00 · место 4", types: ["tck"] },
        ],
      },
    ],
  },
];

/** Найти мероприятие по id. */
function findEventById(id) {
  return EVENTS.find((e) => e.id === id) || null;
}

/** Найти дату мероприятия по дате (YYYY-MM-DD). */
function findEventDate(event, date) {
  return event.dates.find((d) => d.date === date) || null;
}
