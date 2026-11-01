-- 0007_store_order_players.sql
--
-- Shop checkout: record which player each item is for.
--
-- RUN Club Management's migrations/2026-11-store-order-players.sql FIRST.
-- That adds store_order_items.player_id / player_name / player_age_group
-- and the trigger that fills in the name and age group. This file adds the
-- one function the checkout calls to set player_id.
--
-- Safe to run more than once. Run it in the Supabase SQL Editor.
-- ============================================================================

do $$
begin
  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'store_order_items' and column_name = 'player_id'
  ) then
    raise exception 'Run Club Management''s migrations/2026-11-store-order-players.sql first.';
  end if;
end $$;

-- store_assign_item_players(order, user, allocations)
--
-- Called by create-store-checkout straight after store_create_order(),
-- before the guardian is sent to Yoco. allocations is a JSON array of
--   { product_id, size_id, player_id, quantity }
-- saying how many of each item (product + size) are for which player.
--
-- store_create_order() makes one item row per product + size. When all of
-- that row is for one player it's simply tagged. When it's split between
-- children (twins ordering the same tracksuit size), the row keeps the
-- first child's quantity and a copy is added for each other child, at the
-- same price, so the order total doesn't change.
--
-- Refuses anything that doesn't add up, a player not linked to this
-- account, or an order that isn't this user's or is already paid.
-- Service role only: the checkout function is the only caller.
create or replace function store_assign_item_players(p_order_id uuid, p_user uuid, p_allocations jsonb)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  o record;
  it record;
  fk_col text;
  allocs jsonb;
  a jsonb;
  total int;
  first_done boolean;
  matched int := 0;
begin
  if jsonb_typeof(p_allocations) is distinct from 'array' then
    raise exception 'Invalid player choices.';
  end if;

  select id, auth_user_id, status, paid_at into o from store_orders where id = p_order_id for update;
  if not found or o.auth_user_id is distinct from p_user then
    raise exception 'Order not found.';
  end if;
  if o.paid_at is not null or o.status = 'paid' then
    raise exception 'This order has already been paid.';
  end if;

  if exists (
    select 1 from jsonb_array_elements(p_allocations) x
    where nullif(x->>'player_id', '') is not null
      and not exists (
        select 1 from guardian_players gp
        where gp.auth_user_id = p_user and gp.player_id = (x->>'player_id')::uuid
      )
  ) then
    raise exception 'One of the players in your cart isn''t linked to your account. Choose again in your cart.';
  end if;

  -- The column on store_order_items that points at store_orders, looked
  -- up rather than assumed.
  select att.attname into fk_col
  from pg_constraint c
  join pg_attribute att on att.attrelid = c.conrelid and att.attnum = c.conkey[1]
  where c.conrelid = 'public.store_order_items'::regclass
    and c.confrelid = 'public.store_orders'::regclass
    and c.contype = 'f'
  limit 1;
  if fk_col is null then
    raise exception 'store_order_items has no link to store_orders.';
  end if;

  for it in execute format('select * from store_order_items where %I = $1 order by sort_order for update', fk_col) using p_order_id loop
    select coalesce(jsonb_agg(x), '[]'::jsonb), coalesce(sum((x->>'quantity')::int), 0)
      into allocs, total
    from jsonb_array_elements(p_allocations) x
    where (x->>'product_id')::uuid = it.product_id
      and nullif(x->>'size_id', '')::uuid is not distinct from it.size_id;

    if jsonb_array_length(allocs) = 0 then
      continue;
    end if;
    if total <> it.quantity then
      raise exception 'Your cart changed while checking out. Go back to your cart and try again.';
    end if;
    matched := matched + jsonb_array_length(allocs);

    first_done := false;
    for a in select * from jsonb_array_elements(allocs) loop
      if not first_done then
        update store_order_items
          set player_id = nullif(a->>'player_id', '')::uuid,
              quantity = (a->>'quantity')::int
          where id = it.id;
        first_done := true;
      else
        insert into store_order_items
          select (jsonb_populate_record(null::store_order_items,
            to_jsonb(it) || jsonb_build_object(
              'id', gen_random_uuid(),
              'quantity', (a->>'quantity')::int,
              'player_id', nullif(a->>'player_id', ''),
              'player_name', '',
              'player_age_group', ''
            ))).*;
      end if;
    end loop;
  end loop;

  if matched <> jsonb_array_length(p_allocations) then
    raise exception 'Your cart changed while checking out. Go back to your cart and try again.';
  end if;
end;
$$;

revoke all on function store_assign_item_players(uuid, uuid, jsonb) from public, anon, authenticated;
grant execute on function store_assign_item_players(uuid, uuid, jsonb) to service_role;
