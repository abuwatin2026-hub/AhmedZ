-- Clean install: skip default in-store delivery zone creation
do $$
begin
  perform 1;
end $$;

-- Clean install: skip order updates to auto-assign in-store zone
do $$
begin
  perform 1;
end $$;
