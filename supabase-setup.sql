-- PORRINH4: execute este arquivo inteiro no Supabase > SQL Editor.
-- Cria salas públicas, mantém palpites em schema privado e automatiza ações da rodada.

create schema if not exists private;
create table if not exists public.porrinh4_rooms (
  code text primary key check (length(code) = 6),
  state jsonb not null,
  created_at timestamptz not null default now()
);
create table if not exists private.porrinh4_choices (
  code text primary key references public.porrinh4_rooms(code) on delete cascade,
  choices jsonb not null default '{}'::jsonb,
  host_token text not null,
  player_tokens jsonb not null default '{}'::jsonb
);
alter table private.porrinh4_choices
  add column if not exists player_tokens jsonb not null default '{}'::jsonb;

alter table public.porrinh4_rooms enable row level security;
revoke all on table public.porrinh4_rooms from anon, authenticated;
grant select on table public.porrinh4_rooms to anon, authenticated;
drop policy if exists "PORRINH4 rooms are readable" on public.porrinh4_rooms;
create policy "PORRINH4 rooms are readable"
  on public.porrinh4_rooms for select to anon, authenticated using (true);

alter table private.porrinh4_choices enable row level security;
revoke all on schema private from public, anon, authenticated;
revoke all on table private.porrinh4_choices from public, anon, authenticated;

create or replace function public.porrinh4_action(
  p_code text,
  p_action text,
  p_player_id text,
  p_payload jsonb default '{}'::jsonb
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  room_row public.porrinh4_rooms%rowtype;
  room_state jsonb;
  people jsonb;
  current_choices jsonb;
  secret_row private.porrinh4_choices%rowtype;
  player jsonb;
  entry record;
  choice jsonb;
  revealed jsonb;
  total integer := 0;
  deadline_ms bigint;
  new_bet integer;
begin
  if p_action = 'create' then
    if length(p_code) <> 6 or coalesce(p_payload->>'hostToken', '') = '' then
      raise exception 'Código ou token da sala inválido';
    end if;
    room_state := jsonb_build_object(
      'hostUid', p_player_id,
      'phase', 'lobby',
      'round', 1,
      'players', jsonb_build_object(p_player_id, jsonb_build_object(
        'name', left(coalesce(p_payload->>'name', 'Operador'), 18),
        'ready', false,
        'host', true,
        'joinedAt', (extract(epoch from clock_timestamp()) * 1000)::bigint
      ))
    );
    insert into public.porrinh4_rooms(code, state) values (p_code, room_state);
    insert into private.porrinh4_choices(code, choices, host_token, player_tokens)
      values (p_code, '{}'::jsonb, p_payload->>'hostToken', jsonb_build_object(p_player_id, p_payload->>'playerToken'));
    return room_state;
  end if;

  select * into room_row from public.porrinh4_rooms where code = p_code for update;
  if not found then raise exception 'Sala não encontrada'; end if;
  room_state := room_row.state;
  select * into secret_row from private.porrinh4_choices where code = p_code for update;

  if (p_action <> 'join' or (room_state->'players' ? p_player_id)) and
     coalesce(secret_row.player_tokens->>p_player_id, '') <> coalesce(p_payload->>'playerToken', '') then
    raise exception 'Sessão do jogador inválida. Saia e entre na sala novamente.';
  end if;

  if p_action in ('start', 'next') and
     (p_player_id <> room_state->>'hostUid' or
      coalesce(p_payload->>'hostToken', '') <> secret_row.host_token) then
    raise exception 'Somente quem criou a sala pode fazer isso';
  end if;

  if p_action = 'join' then
    people := room_state->'players';
    if people ? p_player_id then return room_state; end if;
    if coalesce(p_payload->>'playerToken', '') = '' then raise exception 'Sessão do jogador inválida'; end if;
    if room_state->>'phase' <> 'lobby' then raise exception 'A rodada já começou'; end if;
    if (select count(*) from jsonb_object_keys(people)) >= 10 then raise exception 'Sala cheia (máximo 10)'; end if;
    people := people || jsonb_build_object(p_player_id, jsonb_build_object(
      'name', left(coalesce(p_payload->>'name', 'Jogador'), 18),
      'ready', false,
      'host', false,
      'joinedAt', (extract(epoch from clock_timestamp()) * 1000)::bigint
    ));
    room_state := jsonb_set(room_state, '{players}', people, true);
    update private.porrinh4_choices
      set player_tokens = player_tokens || jsonb_build_object(p_player_id, p_payload->>'playerToken')
      where code = p_code;

  elsif p_action = 'start' then
    if room_state->>'phase' <> 'lobby' then raise exception 'A sala não está aguardando jogadores'; end if;
    select jsonb_object_agg(key, value || '{"ready":false}'::jsonb)
      into people from jsonb_each(room_state->'players');
    room_state := jsonb_set(room_state, '{players}', coalesce(people, '{}'::jsonb), true);
    room_state := jsonb_set(room_state, '{phase}', '"playing"'::jsonb, true);
    update private.porrinh4_choices set choices = '{}'::jsonb where code = p_code;

  elsif p_action = 'confirm' then
    if room_state->>'phase' <> 'playing' then raise exception 'As escolhas não estão abertas'; end if;
    if not (room_state->'players' ? p_player_id) then raise exception 'Você não está nesta sala'; end if;
    if (p_payload->>'number')::integer not between 0 and 3 then raise exception 'Número inválido'; end if;
    new_bet := (p_payload->>'bet')::integer;
    if new_bet < 0 or new_bet > (select count(*) * 3 from jsonb_object_keys(room_state->'players')) then
      raise exception 'Palpite fora do intervalo';
    end if;
    current_choices := secret_row.choices;
    for entry in select key, value from jsonb_each(current_choices) loop
      if entry.key <> p_player_id and (entry.value->>'bet')::integer = new_bet then
        raise exception 'Esse palpite já foi reservado';
      end if;
    end loop;
    current_choices := current_choices || jsonb_build_object(p_player_id, jsonb_build_object(
      'number', (p_payload->>'number')::integer,
      'bet', new_bet
    ));
    update private.porrinh4_choices set choices = current_choices where code = p_code;
    people := jsonb_set(room_state->'players', array[p_player_id, 'ready'], 'true'::jsonb, true);
    room_state := jsonb_set(room_state, '{players}', people, true);
    if (select bool_and(coalesce((value->>'ready')::boolean, false)) from jsonb_each(people)) then
      deadline_ms := (extract(epoch from clock_timestamp() + interval '5 seconds') * 1000)::bigint;
      room_state := jsonb_set(room_state, '{phase}', '"countdown"'::jsonb, true);
      room_state := jsonb_set(room_state, '{countdownEndsAt}', to_jsonb(deadline_ms), true);
    end if;

  elsif p_action = 'reveal' then
    if room_state->>'phase' = 'result' then return room_state; end if;
    if room_state->>'phase' <> 'countdown' then raise exception 'A rodada ainda não está na contagem'; end if;
    if (room_state->>'countdownEndsAt')::bigint > (extract(epoch from clock_timestamp()) * 1000)::bigint then
      raise exception 'Aguarde o fim da contagem de 5 segundos';
    end if;
    current_choices := secret_row.choices;
    revealed := room_state->'players';
    for entry in select key, value from jsonb_each(current_choices) loop
      choice := entry.value;
      total := total + (choice->>'number')::integer;
      revealed := jsonb_set(revealed, array[entry.key, 'number'], choice->'number', true);
      revealed := jsonb_set(revealed, array[entry.key, 'bet'], choice->'bet', true);
    end loop;
    room_state := jsonb_set(room_state, '{players}', revealed, true);
    room_state := jsonb_set(room_state, '{sum}', to_jsonb(total), true);
    room_state := jsonb_set(room_state, '{phase}', '"result"'::jsonb, true);
    room_state := room_state - 'countdownEndsAt';

  elsif p_action = 'next' then
    if room_state->>'phase' <> 'result' then raise exception 'A rodada ainda não terminou'; end if;
    select jsonb_object_agg(key, jsonb_build_object(
      'name', value->>'name', 'ready', false,
      'host', coalesce((value->>'host')::boolean, false),
      'joinedAt', value->'joinedAt'
    )) into people from jsonb_each(room_state->'players');
    room_state := jsonb_build_object(
      'hostUid', room_state->'hostUid',
      'phase', 'lobby',
      'round', coalesce((room_state->>'round')::integer, 1) + 1,
      'players', coalesce(people, '{}'::jsonb)
    );
    update private.porrinh4_choices set choices = '{}'::jsonb where code = p_code;

  else
    raise exception 'Ação desconhecida';
  end if;

  update public.porrinh4_rooms set state = room_state where code = p_code;
  return room_state;
end;
$$;

revoke all on function public.porrinh4_action(text, text, text, jsonb) from public;
grant execute on function public.porrinh4_action(text, text, text, jsonb) to anon, authenticated;

do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'porrinh4_rooms'
  ) then
    alter publication supabase_realtime add table public.porrinh4_rooms;
  end if;
end;
$$;
