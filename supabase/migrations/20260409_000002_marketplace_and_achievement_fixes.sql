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
    v_active_listing_count integer := 0;
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

    select count(*)
    into v_active_listing_count
    from public.marketplace_listings
    where seller_id = v_user_id
      and status = 'active'
      and expires_at > timezone('utc', now());

    if v_active_listing_count >= 4 then
        raise exception 'Maximum of 4 active listings allowed'
            using errcode = 'P0001';
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

create or replace function public.list_pending_koi_claims()
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
    select
        claims.id,
        claims.listing_id,
        claims.koi_json,
        claims.created_at
    from public.pending_koi_claims as claims
    where claims.user_id = v_user_id
      and claims.claimed_at is null
    order by claims.created_at asc;
end;
$$;

create or replace function public.finalize_pending_koi_claims(
    p_claim_ids uuid[]
)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
    v_user_id uuid := auth.uid();
    v_updated_count integer := 0;
begin
    if v_user_id is null then
        raise exception 'Authentication required'
            using errcode = '28000';
    end if;

    if coalesce(array_length(p_claim_ids, 1), 0) = 0 then
        return 0;
    end if;

    update public.pending_koi_claims
    set claimed_at = timezone('utc', now())
    where user_id = v_user_id
      and claimed_at is null
      and id = any(p_claim_ids);

    get diagnostics v_updated_count = row_count;
    return v_updated_count;
end;
$$;

grant execute on function public.create_listing(jsonb, integer, integer, integer, interval) to authenticated;
grant execute on function public.list_pending_koi_claims() to authenticated;
grant execute on function public.finalize_pending_koi_claims(uuid[]) to authenticated;
