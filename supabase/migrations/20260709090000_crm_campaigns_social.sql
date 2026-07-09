-- CRM Campaigns, Social, and Integration-token tables.
-- Consumed by urban-crm (Campaigns tab, Social tab, Gmail/Meta OAuth).
-- Column set derived from the CRM's insert/select sites:
--   app/api/campaigns/route.js, app/api/campaigns/[id]/send/route.js,
--   lib/queries/campaigns.js, app/api/social/posts/route.js,
--   app/api/social/meta/callback/route.js, app/api/gmail/callback/route.js

create table if not exists public.campaigns (
  id              uuid primary key default gen_random_uuid(),
  name            text not null,
  type            text not null default 'email',      -- 'email' | 'sms'
  subject         text,
  body            text,
  audience        text not null default 'all',        -- 'all' | 'unreplied' | 'customers' | 'trade'
  status          text not null default 'draft',      -- 'draft' | 'sending' | 'sent' | 'failed'
  recipient_count integer,
  sent_at         timestamptz,
  created_by      text,
  created_at      timestamptz not null default now()
);

create index if not exists campaigns_created_at_idx on public.campaigns (created_at desc);

alter table public.campaigns enable row level security;

create table if not exists public.campaign_sends (
  id              uuid primary key default gen_random_uuid(),
  campaign_id     uuid not null references public.campaigns(id) on delete cascade,
  recipient_email text,
  recipient_phone text,
  status          text not null default 'sent',       -- 'sent' | 'failed'
  error           text,
  sent_at         timestamptz,
  created_at      timestamptz not null default now()
);

create index if not exists campaign_sends_campaign_idx on public.campaign_sends (campaign_id);

alter table public.campaign_sends enable row level security;

create table if not exists public.social_posts (
  id               uuid primary key default gen_random_uuid(),
  platform         text not null default 'instagram',
  caption          text,
  image_url        text,
  status           text not null default 'draft',     -- 'draft' | 'published' | 'failed'
  platform_post_id text,
  published_at     timestamptz,
  error            text,
  created_by       text,
  created_at       timestamptz not null default now()
);

create index if not exists social_posts_created_at_idx on public.social_posts (created_at desc);

alter table public.social_posts enable row level security;

create table if not exists public.integration_tokens (
  id              uuid primary key default gen_random_uuid(),
  service         text not null unique,               -- 'gmail' | 'instagram' | ...
  access_token    text,
  refresh_token   text,
  expires_at      timestamptz,
  scope           text,
  connected_email text,
  meta            jsonb,
  updated_at      timestamptz not null default now(),
  created_at      timestamptz not null default now()
);

alter table public.integration_tokens enable row level security;
