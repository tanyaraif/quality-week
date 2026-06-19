-- ============================================================================
--  Настройка базы данных для сайта записи на мероприятия.
--  Выполните этот скрипт целиком в Supabase: SQL Editor -> New query -> Run.
-- ============================================================================

-- ---------- Роли ------------------------------------------------------------
create table if not exists public.roles (
  id    text primary key,
  label text not null
);

-- ---------- Типы участия ----------------------------------------------------
create table if not exists public.participation_types (
  id       text primary key,
  label    text not null,
  for_role text not null references public.roles(id)
);

-- ---------- Пользователи ----------------------------------------------------
create table if not exists public.users (
  id          bigint generated always as identity primary key,
  key         text not null unique,
  last_name   text not null,
  first_name  text not null,
  role        text not null references public.roles(id),
  created_at  timestamptz not null default now()
);

-- ---------- Активности -------------------------------------------------------
create table if not exists public.events (
  id          text primary key,
  title       text not null,
  description text not null default '',
  location    text not null default '',
  prep_note   text not null default '',
  sort_order  int  not null default 0,
  is_active   boolean not null default true
);

-- ---------- Даты мероприятий ------------------------------------------------
create table if not exists public.event_dates (
  id          bigint generated always as identity primary key,
  event_id    text not null references public.events(id) on delete cascade,
  date        text not null,
  date_label  text not null,
  sort_order  int  not null default 0
);

create index if not exists idx_event_dates_event_id on public.event_dates(event_id);

-- ---------- Слоты -----------------------------------------------------------
create table if not exists public.event_slots (
  id            bigint generated always as identity primary key,
  event_date_id bigint not null references public.event_dates(id) on delete cascade,
  time          text   not null,
  types         text[] not null,   -- {train,personal,tccg}
  sort_order    int    not null default 0
);

create index if not exists idx_event_slots_event_date_id on public.event_slots(event_date_id);

-- ---------- Записи на слоты -------------------------------------------------
create table if not exists public.registrations (
  id          bigint generated always as identity primary key,
  user_key    text not null,
  last_name   text not null,
  first_name  text not null,
  role        text not null,
  event_id    text not null,
  event_title text not null,
  date        text not null,
  event_date  text not null,
  slot_index  int  not null,
  slot_time   text not null,
  type        text not null,
  created_at  timestamptz not null default now(),
  constraint uniq_slot unique (event_id, date, slot_index, type)
);

create index if not exists idx_registrations_user_key on public.registrations(user_key);

-- ---------- Глобальные настройки --------------------------------------------
create table if not exists public.config (
  key    text primary key,
  value  text not null,
  note   text
);

-- ============================================================================
--  Row Level Security
-- ============================================================================
alter table public.roles               enable row level security;
alter table public.participation_types enable row level security;
alter table public.users               enable row level security;
alter table public.events              enable row level security;
alter table public.event_dates         enable row level security;
alter table public.event_slots         enable row level security;
alter table public.registrations       enable row level security;
alter table public.config              enable row level security;

drop policy if exists "roles read"                on public.roles;
drop policy if exists "participation_types read"  on public.participation_types;
drop policy if exists "users read"                on public.users;
drop policy if exists "events read"               on public.events;
drop policy if exists "event_dates read"          on public.event_dates;
drop policy if exists "event_slots read"          on public.event_slots;
drop policy if exists "registrations read"        on public.registrations;
drop policy if exists "registrations insert"      on public.registrations;
drop policy if exists "config read"               on public.config;

create policy "roles read"               on public.roles               for select to anon using (true);
create policy "participation_types read" on public.participation_types for select to anon using (true);
create policy "users read"               on public.users               for select to anon using (true);
create policy "events read"              on public.events               for select to anon using (true);
create policy "event_dates read"         on public.event_dates         for select to anon using (true);
create policy "event_slots read"         on public.event_slots         for select to anon using (true);
create policy "registrations read"       on public.registrations       for select to anon using (true);
create policy "registrations insert"     on public.registrations       for insert to anon with check (true);
create policy "config read"              on public.config              for select to anon using (true);

-- ============================================================================
--  Начальные данные
-- ============================================================================

insert into public.roles (id, label) values
  ('service', 'Сервисная поддержка'),
  ('tccg',    'ТЦК')
on conflict (id) do nothing;

insert into public.participation_types (id, label, for_role) values
  ('train',    'Train',          'service'),
  ('personal', 'Обед/Выходной', 'service'),
  ('tccg',     'ТЦК',           'tccg')
on conflict (id) do nothing;

insert into public.config (key, value, note) values
  ('registration_cooldown_minutes', '10',  'Минимальный интервал между записями одного ключа (в минутах)'),
  ('refresh_interval_seconds',      '30',  'Как часто обновлять график записей (в секундах)')
on conflict (key) do nothing;

insert into public.users (key, last_name, first_name, role) values
  ('123',      'Тестов',   'Тест',    'service'),
  ('service1', 'Иванов',   'Иван',    'service'),
  ('service2', 'Смирнова', 'Ольга',   'service'),
  ('service3', 'Кузнецов', 'Дмитрий', 'service'),
  ('service4', 'Волкова',  'Марина',  'service'),
  ('tck1',     'Петрова',  'Анна',    'tccg'),
  ('tck2',     'Соколов',  'Максим',  'tccg'),
  ('tck3',     'Морозова', 'Елена',   'tccg'),
  ('tck4',     'Зайцев',   'Артём',   'tccg')
on conflict (key) do nothing;

insert into public.events (id, title, description, location, prep_note, sort_order) values
  ('feedback',     'Мастер-класс по обратной связи', 'Соберем конструктор развивающей обратной связи',                                                                                 'Переговорка 119 (Лето)',    'Просто придти вовремя',                      1),
  ('inspector',    'Инспектор на час',                'Инспектор на час. Возможность побыть в роли инспектора и взглянуть на процессы с другой стороны.',                              'Где хочешь',               'Получить письмо с инструкциями на почте',    2),
  ('exchange',     'Обмен опытом',                    'Делимся наработками, кейсами и лайфхаками друг с другом в небольших группах.',                                                  'Сообщим после записи',     'Просто подождать сообщения в личку',          3),
  ('frankenstein', 'Франкенштейн',                    'Находим решение, применяя разные элементы',                                                                                     'Лабораторный уголок (А101)', 'Придти вовремя и получить задание',          4),
  ('owngame',      'Своя игра',                       'Интеллектуальный батл в формате «Своей игры»: выбираем тему, отвечаем на вопросы, зарабатываем очки. Лучший знаток уходит с призом!', 'Конференц-зал (2 этаж)', 'Придти вовремя',                    5)
on conflict (id) do nothing;

-- Даты и слоты добавляются через Table Editor или отдельным скриптом.
-- Пример добавить дату:
--   insert into event_dates (event_id, date, date_label, sort_order)
--   values ('feedback', '2026-06-29', 'Понедельник (29 июня)', 1);
--
-- Пример добавить слот (event_date_id берём из таблицы event_dates):
--   insert into event_slots (event_date_id, time, types, sort_order)
--   values (1, '14:00–14:30', '{train,personal,tccg}', 1);
