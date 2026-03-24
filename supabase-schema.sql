-- Supabase SQL Editor에서 실행 (승수 저장용)
-- 1) 테이블 생성
create table if not exists player_stats (
  nickname text primary key,
  wins int not null default 0,
  updated_at timestamptz default now()
);

-- 2) 승수 증가 RPC (서버에서 호출)
create or replace function increment_wins(p_nickname text)
returns void
language plpgsql
security definer
as $$
begin
  insert into player_stats (nickname, wins)
  values (p_nickname, 1)
  on conflict (nickname)
  do update set wins = player_stats.wins + 1, updated_at = now();
end;
$$;

-- RLS 사용 시: alter table player_stats enable row level security;
-- 서비스 역할로 호출 시 RLS 우회 가능.

-- 3) 결승선 도착 기록 (레이스 ID + 말 색상당 1행, 서버에서 upsert)
create table if not exists race_results (
  id uuid primary key default gen_random_uuid(),
  race_id text not null,
  color text not null,
  nickname text not null,
  rank int not null default 0,
  finish_time_sec numeric,
  created_at timestamptz default now(),
  unique (race_id, color)
);

create index if not exists idx_race_results_race_id on race_results (race_id);
create index if not exists idx_race_results_created_at on race_results (created_at desc);
