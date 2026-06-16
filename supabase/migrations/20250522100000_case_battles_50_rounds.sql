-- Case battles: up to 50 rounds per battle (cases.gg-style)

alter table public.case_battles
  drop constraint if exists case_battles_rounds_check;

alter table public.case_battles
  add constraint case_battles_rounds_check
  check (rounds >= 1 and rounds <= 50);
