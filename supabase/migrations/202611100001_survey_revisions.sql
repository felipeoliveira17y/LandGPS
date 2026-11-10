-- Cada envio registra uma revisão imutável de um levantamento.
create table public.survey_revisions (
  owner_id uuid not null references auth.users(id) on delete cascade,
  survey_id uuid not null,
  revision_id uuid not null,
  snapshot jsonb not null,
  created_at timestamptz not null default now(),
  primary key (owner_id, survey_id, revision_id)
);

create index survey_revisions_recent_idx
  on public.survey_revisions (owner_id, survey_id, created_at desc);

alter table public.survey_revisions enable row level security;

revoke all on public.survey_revisions from public, anon, authenticated;
grant select on public.survey_revisions to authenticated;

create policy "Users read their own survey revisions"
  on public.survey_revisions for select to authenticated
  using (owner_id = (select auth.uid()));

-- O cliente fornece IDs estáveis para repetir um envio sem criar outra revisão.
create function public.submit_survey_revision(
  p_survey_id uuid,
  p_revision_id uuid,
  p_snapshot jsonb
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_owner uuid := auth.uid();
  v_previous jsonb;
begin
  if v_owner is null then
    raise exception 'É necessário entrar na conta.' using errcode = '42501';
  end if;

  if p_survey_id is null or p_revision_id is null
    or jsonb_typeof(p_snapshot) is distinct from 'object'
    or jsonb_typeof(p_snapshot->'projeto') is distinct from 'string'
    or length(btrim(p_snapshot->>'projeto')) not between 1 and 120
    or jsonb_typeof(p_snapshot->'pontos') is distinct from 'array'
    or octet_length(p_snapshot::text) > 1048576 then
    raise exception 'Levantamento inválido ou acima de 1 MB.' using errcode = '22023';
  end if;

  if jsonb_array_length(p_snapshot->'pontos') not between 1 and 10000
    or exists (
      select 1 from jsonb_array_elements(p_snapshot->'pontos') as vertices(ponto)
      where case
        when jsonb_typeof(ponto->'lat') = 'number'
          and jsonb_typeof(ponto->'lng') = 'number'
        then (ponto->>'lat')::numeric not between -90 and 90
          or (ponto->>'lng')::numeric not between -180 and 180
        else true
      end
    ) then
    raise exception 'O levantamento contém coordenadas inválidas.' using errcode = '22023';
  end if;

  select snapshot into v_previous
  from public.survey_revisions
  where owner_id = v_owner and survey_id = p_survey_id and revision_id = p_revision_id;

  if not found then
    if not public.has_active_pro() then
      raise exception 'O envio de levantamentos requer o plano Pro.' using errcode = '42501';
    end if;
    insert into public.survey_revisions (owner_id, survey_id, revision_id, snapshot)
    values (v_owner, p_survey_id, p_revision_id, p_snapshot)
    on conflict do nothing;

    select snapshot into v_previous
    from public.survey_revisions
    where owner_id = v_owner and survey_id = p_survey_id and revision_id = p_revision_id;
  end if;

  if v_previous is distinct from p_snapshot then
    raise exception 'Esta revisão já existe com conteúdo diferente.' using errcode = '23505';
  end if;
  return p_revision_id;
end;
$$;

revoke all on function public.submit_survey_revision(uuid, uuid, jsonb) from public, anon, authenticated;
grant execute on function public.submit_survey_revision(uuid, uuid, jsonb) to authenticated;
