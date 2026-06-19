const Api = (() => {
  const { url, anonKey } = CONFIG.supabase;
  const base = `${url.replace(/\/$/, "")}/rest/v1`;

  function hdrs(extra = {}) {
    return {
      apikey: anonKey,
      Authorization: `Bearer ${anonKey}`,
      "Content-Type": "application/json",
      ...extra,
    };
  }

  async function get(path) {
    const res = await fetch(`${base}${path}`, { headers: hdrs() });
    if (!res.ok) {
      const err = new Error(`${path} → ${res.status}`);
      err.status = res.status;
      throw err;
    }
    return res.json();
  }

  function fromRow(r) {
    return {
      id:         r.id,
      userKey:    r.user_key,
      lastName:   r.last_name,
      firstName:  r.first_name,
      role:       r.role,
      eventId:    r.event_id,
      eventTitle: r.event_title,
      date:       r.date,
      eventDate:  r.event_date,
      slotIndex:  r.slot_index,
      slotTime:   r.slot_time,
      type:       r.type,
      createdAt:  r.created_at,
    };
  }

  async function getUsers() {
    return (await get("/users?select=id,last_name,first_name,role")).map((u) => ({
      id:        u.id,
      lastName:  u.last_name,
      firstName: u.first_name,
      role:      u.role,
    }));
  }

  async function getUserByKey(key) {
    const rows = await get(`/users?select=id,last_name,first_name,role&key=eq.${encodeURIComponent(key)}&limit=1`);
    if (!rows.length) return null;
    const u = rows[0];
    return { id: u.id, lastName: u.last_name, firstName: u.first_name, role: u.role };
  }

  async function getConfig() {
    const rows = await get("/config?select=key,value");
    return Object.fromEntries(rows.map((r) => [r.key, r.value]));
  }

  async function getRoles() {
    return get("/roles?select=*");
  }

  async function getParticipationTypes() {
    return get("/participation_types?select=*");
  }

  async function getEvents() {
    const [rawEvents, rawDates, rawSlots] = await Promise.all([
      get("/events?select=*&is_active=eq.true&order=sort_order.asc"),
      get("/event_dates?select=*&order=sort_order.asc"),
      get("/event_slots?select=*&order=sort_order.asc"),
    ]);

    const slotsByDateId = {};
    for (const s of rawSlots) {
      (slotsByDateId[s.event_date_id] ??= []).push({ time: s.time, types: s.types });
    }

    const datesByEventId = {};
    for (const d of rawDates) {
      (datesByEventId[d.event_id] ??= []).push({
        date:      d.date,
        dateLabel: d.date_label,
        slots:     slotsByDateId[d.id] ?? [],
      });
    }

    return rawEvents.map((e) => ({
      id:          e.id,
      title:       e.title,
      description: e.description,
      location:    e.location ?? '',
      prepNote:    e.prep_note ?? '',
      dates:       datesByEventId[e.id] ?? [],
    }));
  }

  async function getRecords() {
    return (await get("/registrations?select=*&order=created_at.asc")).map(fromRow);
  }

  async function addRecord(record) {
    const res = await fetch(`${base}/registrations`, {
      method:  "POST",
      headers: hdrs({ Prefer: "return=minimal" }),
      body: JSON.stringify({
        user_key:    record.userKey,
        last_name:   record.lastName,
        first_name:  record.firstName,
        role:        record.role,
        event_id:    record.eventId,
        event_title: record.eventTitle,
        date:        record.date,
        event_date:  record.eventDate,
        slot_index:  record.slotIndex,
        slot_time:   record.slotTime,
        type:        record.type,
        created_at:  record.createdAt,
      }),
    });

    if (res.status === 409) {
      const err = new Error("slot taken");
      err.code = "slot_taken";
      throw err;
    }
    if (!res.ok) throw new Error(`registrations insert → ${res.status}`);
    return getRecords();
  }

  return { getConfig, getUsers, getUserByKey, getRoles, getParticipationTypes, getEvents, getRecords, addRecord };
})();

function checkCooldown(records, userKey, cooldownMinutes) {
  const cooldownMs = cooldownMinutes * 60_000;
  const times = records
    .filter((r) => r.userKey === userKey)
    .map((r) => new Date(r.createdAt).getTime())
    .filter(Number.isFinite);

  if (!times.length) return { allowed: true, remainingMs: 0 };
  const remaining = cooldownMs - (Date.now() - Math.max(...times));
  return remaining > 0
    ? { allowed: false, remainingMs: remaining }
    : { allowed: true, remainingMs: 0 };
}

function isSlotTaken(records, eventId, date, slotIndex, type) {
  return records.some(
    (r) => r.eventId === eventId && r.date === date && r.slotIndex === slotIndex && r.type === type
  );
}

function findSlotRecord(records, eventId, date, slotIndex, type) {
  return records.find(
    (r) => r.eventId === eventId && r.date === date && r.slotIndex === slotIndex && r.type === type
  ) ?? null;
}

function getUserRecords(records, userKey) {
  return records
    .filter((r) => r.userKey === userKey)
    .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
}

function isRegisteredForEvent(records, userKey, eventId) {
  return records.some((r) => r.userKey === userKey && r.eventId === eventId);
}

function formatRemaining(ms) {
  const mins = Math.ceil(ms / 60_000);
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return h > 0 ? `${h} ч ${String(m).padStart(2, "0")} мин` : `${mins} мин`;
}

function formatMinutes(totalMins) {
  const h = Math.floor(totalMins / 60);
  const m = totalMins % 60;
  if (h > 0 && m > 0) return `${h} ч ${m} мин`;
  if (h > 0)          return `${h} ч`;
  return `${m} мин`;
}
