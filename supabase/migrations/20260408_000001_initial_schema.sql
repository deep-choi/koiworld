create extension if not exists pgcrypto with schema extensions;

create type public.listing_status as enum ('active', 'sold', 'expired', 'cancelled');
create type public.ap_ledger_kind as enum (
    'listing_fee',
    'bid_hold',
    'bid_increase',
    'bid_refund',
    'purchase_debit',
    'sale_credit',
    'ad_reward',
    'manual_adjustment',
    'new_game_reset'
);

create table if not exists public.profiles (
    id uuid primary key references auth.users(id) on delete cascade,
    nickname text not null check (char_length(trim(nickname)) between 1 and 40),
    active_device_id text,
    ap_balance integer not null default 0 check (ap_balance >= 0),
    new_game_reset_day date,
    new_game_reset_count integer not null default 0 check (new_game_reset_count between 0 and 3),
    created_at timestamptz not null default timezone('utc', now()),
    last_login_at timestamptz not null default timezone('utc', now())
);

create table if not exists public.game_states (
    user_id uuid primary key references public.profiles(id) on delete cascade,
    state_json jsonb not null default '{}'::jsonb,
    honor_points integer not null default 0,
    achievement_points integer not null default 0,
    updated_at timestamptz not null default timezone('utc', now()),
    constraint game_states_state_json_object check (jsonb_typeof(state_json) = 'object')
);

create table if not exists public.marketplace_listings (
    id uuid primary key default gen_random_uuid(),
    seller_id uuid not null references public.profiles(id) on delete cascade,
    seller_nickname text not null,
    koi_id text not null check (char_length(trim(koi_id)) > 0),
    koi_json jsonb not null,
    start_price integer not null check (start_price > 0),
    buy_now_price integer not null check (buy_now_price > 0),
    current_bid integer not null check (current_bid > 0),
    current_bidder_id uuid references public.profiles(id) on delete set null,
    current_bidder_nickname text,
    bid_count integer not null default 0 check (bid_count >= 0),
    status public.listing_status not null default 'active',
    created_at timestamptz not null default timezone('utc', now()),
    expires_at timestamptz not null,
    sold_at timestamptz,
    cancelled_at timestamptz,
    constraint marketplace_listings_koi_json_object check (jsonb_typeof(koi_json) = 'object'),
    constraint marketplace_listings_price_order check (buy_now_price >= start_price),
    constraint marketplace_listings_bid_floor check (current_bid >= start_price)
);

create unique index if not exists marketplace_listings_active_koi_idx
    on public.marketplace_listings (seller_id, koi_id)
    where status = 'active';

create index if not exists marketplace_listings_active_idx
    on public.marketplace_listings (status, created_at desc);

create index if not exists marketplace_listings_expires_idx
    on public.marketplace_listings (status, expires_at);

create table if not exists public.marketplace_bids (
    id uuid primary key default gen_random_uuid(),
    listing_id uuid not null references public.marketplace_listings(id) on delete cascade,
    bidder_id uuid not null references public.profiles(id) on delete cascade,
    bidder_nickname text not null,
    amount integer not null check (amount > 0),
    created_at timestamptz not null default timezone('utc', now())
);

create index if not exists marketplace_bids_listing_created_idx
    on public.marketplace_bids (listing_id, created_at desc);

create table if not exists public.pending_koi_claims (
    id uuid primary key default gen_random_uuid(),
    user_id uuid not null references public.profiles(id) on delete cascade,
    listing_id uuid references public.marketplace_listings(id) on delete set null,
    koi_json jsonb not null,
    created_at timestamptz not null default timezone('utc', now()),
    claimed_at timestamptz,
    constraint pending_koi_claims_koi_json_object check (jsonb_typeof(koi_json) = 'object')
);

create index if not exists pending_koi_claims_user_idx
    on public.pending_koi_claims (user_id, claimed_at, created_at);

create table if not exists public.ap_ledger (
    id uuid primary key default gen_random_uuid(),
    user_id uuid not null references public.profiles(id) on delete cascade,
    kind public.ap_ledger_kind not null,
    amount integer not null,
    listing_id uuid references public.marketplace_listings(id) on delete set null,
    metadata jsonb not null default '{}'::jsonb,
    created_at timestamptz not null default timezone('utc', now()),
    constraint ap_ledger_metadata_object check (jsonb_typeof(metadata) = 'object')
);

create index if not exists ap_ledger_user_created_idx
    on public.ap_ledger (user_id, created_at desc);

create table if not exists public.ad_reward_claims (
    id uuid primary key default gen_random_uuid(),
    user_id uuid not null references public.profiles(id) on delete cascade,
    provider text not null default 'manual',
    ad_type text not null check (ad_type in ('15s', '30s')),
    verification_token text not null unique,
    reward_amount integer not null check (reward_amount > 0),
    created_at timestamptz not null default timezone('utc', now())
);

create index if not exists ad_reward_claims_user_idx
    on public.ad_reward_claims (user_id, created_at desc);

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
    fallback_nickname text;
begin
    fallback_nickname := coalesce(
        nullif(trim(new.raw_user_meta_data ->> 'full_name'), ''),
        nullif(trim(new.raw_user_meta_data ->> 'name'), ''),
        nullif(split_part(coalesce(new.email, ''), '@', 1), ''),
        'Koi_' || left(new.id::text, 6)
    );

    insert into public.profiles (id, nickname)
    values (new.id, fallback_nickname)
    on conflict (id) do nothing;

    insert into public.game_states (user_id, state_json)
    values (new.id, '{}'::jsonb)
    on conflict (user_id) do nothing;

    return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
    after insert on auth.users
    for each row execute function public.handle_new_user();

insert into public.profiles (id, nickname)
select
    u.id,
    coalesce(
        nullif(trim(u.raw_user_meta_data ->> 'full_name'), ''),
        nullif(trim(u.raw_user_meta_data ->> 'name'), ''),
        nullif(split_part(coalesce(u.email, ''), '@', 1), ''),
        'Koi_' || left(u.id::text, 6)
    ) as nickname
from auth.users u
on conflict (id) do nothing;

insert into public.game_states (user_id, state_json)
select u.id, '{}'::jsonb
from auth.users u
on conflict (user_id) do nothing;

create or replace function public.upsert_profile_context(
    p_nickname text default null,
    p_active_device_id text default null,
    p_touch_last_login boolean default true
)
returns public.profiles
language plpgsql
security definer
set search_path = public
as $$
declare
    v_user_id uuid := auth.uid();
    v_fallback_nickname text;
    v_profile public.profiles;
begin
    if v_user_id is null then
        raise exception 'Authentication required'
            using errcode = '28000';
    end if;

    select coalesce(
        nullif(trim(p_nickname), ''),
        nullif(trim(raw_user_meta_data ->> 'full_name'), ''),
        nullif(trim(raw_user_meta_data ->> 'name'), ''),
        nullif(split_part(coalesce(email, ''), '@', 1), ''),
        'Koi_' || left(v_user_id::text, 6)
    )
    into v_fallback_nickname
    from auth.users
    where id = v_user_id;

    insert into public.profiles (
        id,
        nickname,
        active_device_id,
        last_login_at
    )
    values (
        v_user_id,
        v_fallback_nickname,
        p_active_device_id,
        timezone('utc', now())
    )
    on conflict (id) do update
    set nickname = case
            when nullif(trim(p_nickname), '') is not null then trim(p_nickname)
            else public.profiles.nickname
        end,
        active_device_id = coalesce(p_active_device_id, public.profiles.active_device_id),
        last_login_at = case
            when p_touch_last_login then timezone('utc', now())
            else public.profiles.last_login_at
        end
    returning * into v_profile;

    insert into public.game_states (user_id, state_json)
    values (v_user_id, '{}'::jsonb)
    on conflict (user_id) do nothing;

    return v_profile;
end;
$$;

create or replace function public.sync_game_state(
    p_state jsonb,
    p_honor_points integer default null,
    p_achievement_points integer default null
)
returns public.game_states
language plpgsql
security definer
set search_path = public
as $$
declare
    v_user_id uuid := auth.uid();
    v_existing public.game_states;
    v_honor_points integer := 0;
    v_achievement_points integer := 0;
    v_row public.game_states;
begin
    if v_user_id is null then
        raise exception 'Authentication required'
            using errcode = '28000';
    end if;

    if jsonb_typeof(p_state) is distinct from 'object' then
        raise exception 'state_json must be a JSON object'
            using errcode = '22023';
    end if;

    select *
    into v_existing
    from public.game_states
    where user_id = v_user_id;

    v_honor_points := coalesce(
        p_honor_points,
        case
            when coalesce(p_state ->> 'honorPoints', '') ~ '^-?\d+$' then (p_state ->> 'honorPoints')::integer
            else 0
        end,
        v_existing.honor_points,
        0
    );

    v_achievement_points := coalesce(
        p_achievement_points,
        case
            when coalesce(p_state ->> 'achievementPoints', '') ~ '^-?\d+$' then (p_state ->> 'achievementPoints')::integer
            else 0
        end,
        v_existing.achievement_points,
        0
    );

    insert into public.game_states (
        user_id,
        state_json,
        honor_points,
        achievement_points,
        updated_at
    )
    values (
        v_user_id,
        p_state,
        v_honor_points,
        v_achievement_points,
        timezone('utc', now())
    )
    on conflict (user_id) do update
    set state_json = excluded.state_json,
        honor_points = excluded.honor_points,
        achievement_points = excluded.achievement_points,
        updated_at = timezone('utc', now())
    returning * into v_row;

    return v_row;
end;
$$;

create or replace function public.set_client_ap_balance(
    p_ap_balance integer
)
returns public.profiles
language plpgsql
security definer
set search_path = public
as $$
declare
    v_user_id uuid := auth.uid();
    v_profile public.profiles;
begin
    if v_user_id is null then
        raise exception 'Authentication required'
            using errcode = '28000';
    end if;

    if p_ap_balance < 0 then
        raise exception 'AP balance cannot be negative'
            using errcode = '22023';
    end if;

    update public.profiles
    set ap_balance = p_ap_balance
    where id = v_user_id
    returning * into v_profile;

    if not found then
        raise exception 'Profile not found'
            using errcode = 'P0002';
    end if;

    return v_profile;
end;
$$;

create or replace function public.create_listing(
    p_koi jsonb,
    p_buy_now_price integer,
    p_start_price integer default null,
    p_listing_fee integer default 100,
    p_expiration interval default interval '3 days'
)
returns public.marketplace_listings
language plpgsql
security definer
set search_path = public
as $$
declare
    v_user_id uuid := auth.uid();
    v_profile public.profiles;
    v_listing public.marketplace_listings;
    v_koi_id text;
    v_start_price integer;
begin
    if v_user_id is null then
        raise exception 'Authentication required'
            using errcode = '28000';
    end if;

    if jsonb_typeof(p_koi) is distinct from 'object' then
        raise exception 'koi_json must be a JSON object'
            using errcode = '22023';
    end if;

    v_koi_id := nullif(trim(p_koi ->> 'id'), '');
    v_start_price := coalesce(p_start_price, p_buy_now_price);

    if v_koi_id is null then
        raise exception 'koi_json.id is required'
            using errcode = '22023';
    end if;

    if coalesce(v_start_price, 0) <= 0 or coalesce(p_buy_now_price, 0) <= 0 then
        raise exception 'Listing prices must be positive'
            using errcode = '22023';
    end if;

    if p_buy_now_price < v_start_price then
        raise exception 'buy_now_price must be greater than or equal to start_price'
            using errcode = '22023';
    end if;

    select *
    into v_profile
    from public.profiles
    where id = v_user_id
    for update;

    if not found then
        raise exception 'Profile not found'
            using errcode = 'P0002';
    end if;

    if v_profile.ap_balance < p_listing_fee then
        raise exception 'Insufficient AP for listing fee'
            using errcode = 'P0001';
    end if;

    update public.profiles
    set ap_balance = ap_balance - p_listing_fee
    where id = v_user_id;

    insert into public.ap_ledger (user_id, kind, amount, metadata)
    values (
        v_user_id,
        'listing_fee',
        -p_listing_fee,
        jsonb_build_object(
            'koiId', v_koi_id,
            'buyNowPrice', p_buy_now_price,
            'startPrice', v_start_price
        )
    );

    insert into public.marketplace_listings (
        seller_id,
        seller_nickname,
        koi_id,
        koi_json,
        start_price,
        buy_now_price,
        current_bid,
        current_bidder_id,
        current_bidder_nickname,
        bid_count,
        status,
        expires_at
    )
    values (
        v_user_id,
        v_profile.nickname,
        v_koi_id,
        p_koi,
        v_start_price,
        p_buy_now_price,
        v_start_price,
        null,
        null,
        0,
        'active',
        timezone('utc', now()) + p_expiration
    )
    returning * into v_listing;

    return v_listing;
end;
$$;

create or replace function public.place_bid(
    p_listing_id uuid,
    p_amount integer
)
returns public.marketplace_listings
language plpgsql
security definer
set search_path = public
as $$
declare
    v_user_id uuid := auth.uid();
    v_listing public.marketplace_listings;
    v_bidder public.profiles;
    v_previous_total integer := 0;
    v_new_total integer := 0;
    v_delta integer := 0;
begin
    if v_user_id is null then
        raise exception 'Authentication required'
            using errcode = '28000';
    end if;

    if coalesce(p_amount, 0) <= 0 then
        raise exception 'Bid amount must be positive'
            using errcode = '22023';
    end if;

    select *
    into v_listing
    from public.marketplace_listings
    where id = p_listing_id
    for update;

    if not found then
        raise exception 'Listing not found'
            using errcode = 'P0002';
    end if;

    if v_listing.status <> 'active' or v_listing.expires_at <= timezone('utc', now()) then
        raise exception 'Auction is not active'
            using errcode = 'P0001';
    end if;

    if v_listing.seller_id = v_user_id then
        raise exception 'Cannot bid on your own listing'
            using errcode = 'P0001';
    end if;

    if p_amount <= v_listing.current_bid then
        raise exception 'Bid must be higher than current bid'
            using errcode = 'P0001';
    end if;

    select *
    into v_bidder
    from public.profiles
    where id = v_user_id
    for update;

    if not found then
        raise exception 'Bidder profile not found'
            using errcode = 'P0002';
    end if;

    v_new_total := p_amount + ceil(p_amount * 0.05);

    if v_listing.current_bidder_id = v_user_id then
        v_previous_total := v_listing.current_bid + ceil(v_listing.current_bid * 0.05);
        v_delta := v_new_total - v_previous_total;

        if v_delta <= 0 then
            raise exception 'Bid increase must reserve additional AP'
                using errcode = 'P0001';
        end if;

        if v_bidder.ap_balance < v_delta then
            raise exception 'Insufficient AP'
                using errcode = 'P0001';
        end if;

        update public.profiles
        set ap_balance = ap_balance - v_delta
        where id = v_user_id;

        insert into public.ap_ledger (user_id, kind, amount, listing_id, metadata)
        values (
            v_user_id,
            'bid_increase',
            -v_delta,
            v_listing.id,
            jsonb_build_object('newAmount', p_amount)
        );
    else
        if v_bidder.ap_balance < v_new_total then
            raise exception 'Insufficient AP'
                using errcode = 'P0001';
        end if;

        if v_listing.current_bidder_id is not null then
            v_previous_total := v_listing.current_bid + ceil(v_listing.current_bid * 0.05);

            update public.profiles
            set ap_balance = ap_balance + v_previous_total
            where id = v_listing.current_bidder_id;

            insert into public.ap_ledger (user_id, kind, amount, listing_id, metadata)
            values (
                v_listing.current_bidder_id,
                'bid_refund',
                v_previous_total,
                v_listing.id,
                jsonb_build_object('refundedBidAmount', v_listing.current_bid)
            );
        end if;

        update public.profiles
        set ap_balance = ap_balance - v_new_total
        where id = v_user_id;

        insert into public.ap_ledger (user_id, kind, amount, listing_id, metadata)
        values (
            v_user_id,
            'bid_hold',
            -v_new_total,
            v_listing.id,
            jsonb_build_object('bidAmount', p_amount)
        );
    end if;

    insert into public.marketplace_bids (listing_id, bidder_id, bidder_nickname, amount)
    values (v_listing.id, v_user_id, v_bidder.nickname, p_amount);

    update public.marketplace_listings
    set current_bid = p_amount,
        current_bidder_id = v_user_id,
        current_bidder_nickname = v_bidder.nickname,
        bid_count = bid_count + 1
    where id = v_listing.id
    returning * into v_listing;

    return v_listing;
end;
$$;

create or replace function public.buy_now(
    p_listing_id uuid
)
returns public.marketplace_listings
language plpgsql
security definer
set search_path = public
as $$
declare
    v_user_id uuid := auth.uid();
    v_listing public.marketplace_listings;
    v_buyer public.profiles;
    v_total_price integer;
    v_fee integer;
    v_previous_total integer := 0;
begin
    if v_user_id is null then
        raise exception 'Authentication required'
            using errcode = '28000';
    end if;

    select *
    into v_listing
    from public.marketplace_listings
    where id = p_listing_id
    for update;

    if not found then
        raise exception 'Listing not found'
            using errcode = 'P0002';
    end if;

    if v_listing.status <> 'active' or v_listing.expires_at <= timezone('utc', now()) then
        raise exception 'Auction is not active'
            using errcode = 'P0001';
    end if;

    if v_listing.seller_id = v_user_id then
        raise exception 'Cannot buy your own listing'
            using errcode = 'P0001';
    end if;

    select *
    into v_buyer
    from public.profiles
    where id = v_user_id
    for update;

    if not found then
        raise exception 'Buyer profile not found'
            using errcode = 'P0002';
    end if;

    v_fee := ceil(v_listing.buy_now_price * 0.05);
    v_total_price := v_listing.buy_now_price + v_fee;

    if v_listing.current_bidder_id is not null then
        v_previous_total := v_listing.current_bid + ceil(v_listing.current_bid * 0.05);

        update public.profiles
        set ap_balance = ap_balance + v_previous_total
        where id = v_listing.current_bidder_id;

        insert into public.ap_ledger (user_id, kind, amount, listing_id, metadata)
        values (
            v_listing.current_bidder_id,
            'bid_refund',
            v_previous_total,
            v_listing.id,
            jsonb_build_object('reason', 'buy_now_override')
        );
    end if;

    if v_buyer.ap_balance < v_total_price then
        raise exception 'Insufficient AP'
            using errcode = 'P0001';
    end if;

    update public.profiles
    set ap_balance = ap_balance - v_total_price
    where id = v_user_id;

    update public.profiles
    set ap_balance = ap_balance + v_listing.buy_now_price
    where id = v_listing.seller_id;

    insert into public.ap_ledger (user_id, kind, amount, listing_id, metadata)
    values
        (
            v_user_id,
            'purchase_debit',
            -v_total_price,
            v_listing.id,
            jsonb_build_object('buyNowPrice', v_listing.buy_now_price, 'fee', v_fee)
        ),
        (
            v_listing.seller_id,
            'sale_credit',
            v_listing.buy_now_price,
            v_listing.id,
            jsonb_build_object('saleType', 'buy_now')
        );

    insert into public.pending_koi_claims (user_id, listing_id, koi_json)
    values (v_user_id, v_listing.id, v_listing.koi_json);

    update public.marketplace_listings
    set status = 'sold',
        sold_at = timezone('utc', now())
    where id = v_listing.id
    returning * into v_listing;

    return v_listing;
end;
$$;

create or replace function public.cancel_listing(
    p_listing_id uuid
)
returns public.marketplace_listings
language plpgsql
security definer
set search_path = public
as $$
declare
    v_user_id uuid := auth.uid();
    v_listing public.marketplace_listings;
begin
    if v_user_id is null then
        raise exception 'Authentication required'
            using errcode = '28000';
    end if;

    select *
    into v_listing
    from public.marketplace_listings
    where id = p_listing_id
    for update;

    if not found then
        raise exception 'Listing not found'
            using errcode = 'P0002';
    end if;

    if v_listing.seller_id <> v_user_id then
        raise exception 'Not your listing'
            using errcode = 'P0001';
    end if;

    if v_listing.status <> 'active' or v_listing.expires_at <= timezone('utc', now()) then
        raise exception 'Listing is not active'
            using errcode = 'P0001';
    end if;

    if v_listing.current_bidder_id is not null then
        raise exception 'Cannot cancel after bids have been placed'
            using errcode = 'P0001';
    end if;

    insert into public.pending_koi_claims (user_id, listing_id, koi_json)
    values (v_listing.seller_id, v_listing.id, v_listing.koi_json);

    update public.marketplace_listings
    set status = 'cancelled',
        cancelled_at = timezone('utc', now())
    where id = v_listing.id
    returning * into v_listing;

    return v_listing;
end;
$$;

create or replace function public.claim_ad_reward(
    p_verification_token text,
    p_ad_type text
)
returns table (
    reward_amount integer,
    new_balance integer
)
language plpgsql
security definer
set search_path = public
as $$
declare
    v_user_id uuid := auth.uid();
    v_reward_amount integer;
begin
    if v_user_id is null then
        raise exception 'Authentication required'
            using errcode = '28000';
    end if;

    if nullif(trim(p_verification_token), '') is null then
        raise exception 'verification_token is required'
            using errcode = '22023';
    end if;

    v_reward_amount := case p_ad_type
        when '15s' then 200
        when '30s' then 500
        else null
    end;

    if v_reward_amount is null then
        raise exception 'Unsupported ad type'
            using errcode = '22023';
    end if;

    -- TODO: Replace this placeholder with actual ad-network verification.
    insert into public.ad_reward_claims (user_id, ad_type, verification_token, reward_amount)
    values (v_user_id, p_ad_type, trim(p_verification_token), v_reward_amount);

    update public.profiles
    set ap_balance = ap_balance + v_reward_amount
    where id = v_user_id;

    insert into public.ap_ledger (user_id, kind, amount, metadata)
    values (
        v_user_id,
        'ad_reward',
        v_reward_amount,
        jsonb_build_object('adType', p_ad_type, 'verificationToken', trim(p_verification_token))
    );

    return query
    select
        v_reward_amount,
        p.ap_balance
    from public.profiles p
    where p.id = v_user_id;
end;
$$;

create or replace function public.claim_pending_kois()
returns table (
    claim_id uuid,
    listing_id uuid,
    koi_json jsonb,
    created_at timestamptz
)
language plpgsql
security definer
set search_path = public
as $$
declare
    v_user_id uuid := auth.uid();
begin
    if v_user_id is null then
        raise exception 'Authentication required'
            using errcode = '28000';
    end if;

    return query
    with claimed as (
        update public.pending_koi_claims
        set claimed_at = timezone('utc', now())
        where user_id = v_user_id
          and claimed_at is null
        returning id, listing_id, koi_json, created_at
    )
    select
        claimed.id,
        claimed.listing_id,
        claimed.koi_json,
        claimed.created_at
    from claimed
    order by claimed.created_at asc;
end;
$$;

create or replace function public.reset_game_data(
    p_initial_state jsonb,
    p_ap_balance integer default 400,
    p_daily_limit integer default 3
)
returns table (
    remaining_resets integer,
    applied_day date
)
language plpgsql
security definer
set search_path = public
as $$
declare
    v_user_id uuid := auth.uid();
    v_profile public.profiles;
    v_today date := current_date;
    v_used_today integer := 0;
    v_next_count integer := 0;
begin
    if v_user_id is null then
        raise exception 'Authentication required'
            using errcode = '28000';
    end if;

    if jsonb_typeof(p_initial_state) is distinct from 'object' then
        raise exception 'initial_state must be a JSON object'
            using errcode = '22023';
    end if;

    if exists (
        select 1
        from public.marketplace_listings
        where seller_id = v_user_id
          and status = 'active'
          and expires_at > timezone('utc', now())
    ) then
        raise exception 'Cancel all active listings before starting a new game'
            using errcode = 'P0001';
    end if;

    select *
    into v_profile
    from public.profiles
    where id = v_user_id
    for update;

    if not found then
        raise exception 'Profile not found'
            using errcode = 'P0002';
    end if;

    v_used_today := case
        when v_profile.new_game_reset_day = v_today then v_profile.new_game_reset_count
        else 0
    end;

    if v_used_today >= p_daily_limit then
        raise exception 'New game daily limit exceeded'
            using errcode = 'P0001';
    end if;

    v_next_count := v_used_today + 1;

    update public.profiles
    set ap_balance = p_ap_balance,
        new_game_reset_day = v_today,
        new_game_reset_count = v_next_count
    where id = v_user_id;

    insert into public.ap_ledger (user_id, kind, amount, metadata)
    values (
        v_user_id,
        'new_game_reset',
        0,
        jsonb_build_object('apBalance', p_ap_balance, 'usedToday', v_next_count)
    );

    insert into public.game_states (
        user_id,
        state_json,
        honor_points,
        achievement_points,
        updated_at
    )
    values (
        v_user_id,
        p_initial_state,
        0,
        0,
        timezone('utc', now())
    )
    on conflict (user_id) do update
    set state_json = excluded.state_json,
        honor_points = 0,
        achievement_points = 0,
        updated_at = timezone('utc', now());

    return query
    select p_daily_limit - v_next_count, v_today;
end;
$$;

create or replace function public.get_rankings(
    p_kind text default 'honorPoints',
    p_limit integer default 20
)
returns table (
    user_id uuid,
    nickname text,
    honor_points integer,
    achievement_points integer,
    ap_balance integer
)
language sql
security definer
set search_path = public
as $$
    select
        p.id as user_id,
        p.nickname,
        gs.honor_points,
        gs.achievement_points,
        p.ap_balance
    from public.profiles p
    join public.game_states gs on gs.user_id = p.id
    order by
        case
            when lower(coalesce(p_kind, 'honorpoints')) in ('achievement', 'achievementpoints') then gs.achievement_points
            else gs.honor_points
        end desc,
        p.created_at asc
    limit greatest(coalesce(p_limit, 20), 1);
$$;

create or replace function public.expire_auctions()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
    v_listing public.marketplace_listings;
    v_processed integer := 0;
begin
    for v_listing in
        select *
        from public.marketplace_listings
        where status = 'active'
          and expires_at <= timezone('utc', now())
        order by expires_at asc
        for update skip locked
    loop
        if v_listing.current_bidder_id is not null then
            update public.profiles
            set ap_balance = ap_balance + v_listing.current_bid
            where id = v_listing.seller_id;

            insert into public.ap_ledger (user_id, kind, amount, listing_id, metadata)
            values (
                v_listing.seller_id,
                'sale_credit',
                v_listing.current_bid,
                v_listing.id,
                jsonb_build_object('saleType', 'auction_expired')
            );

            insert into public.pending_koi_claims (user_id, listing_id, koi_json)
            values (v_listing.current_bidder_id, v_listing.id, v_listing.koi_json);

            update public.marketplace_listings
            set status = 'sold',
                sold_at = timezone('utc', now())
            where id = v_listing.id;
        else
            insert into public.pending_koi_claims (user_id, listing_id, koi_json)
            values (v_listing.seller_id, v_listing.id, v_listing.koi_json);

            update public.marketplace_listings
            set status = 'expired'
            where id = v_listing.id;
        end if;

        v_processed := v_processed + 1;
    end loop;

    return v_processed;
end;
$$;

alter table public.profiles enable row level security;
alter table public.game_states enable row level security;
alter table public.marketplace_listings enable row level security;
alter table public.marketplace_bids enable row level security;
alter table public.pending_koi_claims enable row level security;
alter table public.ap_ledger enable row level security;
alter table public.ad_reward_claims enable row level security;

drop policy if exists "profiles_select_self" on public.profiles;
create policy "profiles_select_self"
    on public.profiles
    for select
    to authenticated
    using (id = auth.uid());

drop policy if exists "game_states_select_self" on public.game_states;
create policy "game_states_select_self"
    on public.game_states
    for select
    to authenticated
    using (user_id = auth.uid());

drop policy if exists "marketplace_listings_select_authenticated" on public.marketplace_listings;
create policy "marketplace_listings_select_authenticated"
    on public.marketplace_listings
    for select
    to authenticated
    using (true);

drop policy if exists "marketplace_bids_select_authenticated" on public.marketplace_bids;
create policy "marketplace_bids_select_authenticated"
    on public.marketplace_bids
    for select
    to authenticated
    using (true);

drop policy if exists "pending_koi_claims_select_self" on public.pending_koi_claims;
create policy "pending_koi_claims_select_self"
    on public.pending_koi_claims
    for select
    to authenticated
    using (user_id = auth.uid());

drop policy if exists "ap_ledger_select_self" on public.ap_ledger;
create policy "ap_ledger_select_self"
    on public.ap_ledger
    for select
    to authenticated
    using (user_id = auth.uid());

drop policy if exists "ad_reward_claims_select_self" on public.ad_reward_claims;
create policy "ad_reward_claims_select_self"
    on public.ad_reward_claims
    for select
    to authenticated
    using (user_id = auth.uid());

grant usage on schema public to authenticated;

grant select on public.profiles to authenticated;
grant select on public.game_states to authenticated;
grant select on public.marketplace_listings to authenticated;
grant select on public.marketplace_bids to authenticated;
grant select on public.pending_koi_claims to authenticated;
grant select on public.ap_ledger to authenticated;
grant select on public.ad_reward_claims to authenticated;

grant execute on function public.upsert_profile_context(text, text, boolean) to authenticated;
grant execute on function public.sync_game_state(jsonb, integer, integer) to authenticated;
grant execute on function public.set_client_ap_balance(integer) to authenticated;
grant execute on function public.create_listing(jsonb, integer, integer, integer, interval) to authenticated;
grant execute on function public.place_bid(uuid, integer) to authenticated;
grant execute on function public.buy_now(uuid) to authenticated;
grant execute on function public.cancel_listing(uuid) to authenticated;
grant execute on function public.claim_ad_reward(text, text) to authenticated;
grant execute on function public.claim_pending_kois() to authenticated;
grant execute on function public.reset_game_data(jsonb, integer, integer) to authenticated;
grant execute on function public.get_rankings(text, integer) to authenticated;

do $$
begin
    begin
        alter publication supabase_realtime add table public.profiles;
    exception
        when duplicate_object then null;
    end;

    begin
        alter publication supabase_realtime add table public.game_states;
    exception
        when duplicate_object then null;
    end;

    begin
        alter publication supabase_realtime add table public.marketplace_listings;
    exception
        when duplicate_object then null;
    end;

    begin
        alter publication supabase_realtime add table public.pending_koi_claims;
    exception
        when duplicate_object then null;
    end;
end;
$$;
