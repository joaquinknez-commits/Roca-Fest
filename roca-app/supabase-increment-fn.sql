-- Ejecutar este SQL en Supabase → SQL Editor
-- Crea una función para incrementar sold_quantity de forma segura (sin race conditions)

create or replace function increment_sold(ticket_type_id uuid, amount int)
returns void
language sql
security definer
as $$
  update ticket_types
  set sold_quantity = sold_quantity + amount
  where id = ticket_type_id;
$$;
