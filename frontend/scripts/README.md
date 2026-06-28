# scripts/ — utilidades QA

Scripts de un solo uso para **validar el login sin tocar datos de clientes reales**.
Crean/eliminan una empresa de test aislada y su usuario admin en Supabase Auth.

> El `service_role` **nunca** va en el código ni en el repo: se lee de la env var
> `SERVICE_ROLE_KEY`. Lo encontrás en Supabase Dashboard → Settings → API → `service_role`.
> Corré los scripts desde `frontend/` (ahí está `node_modules`).

## crear-empresa-test.mjs

Crea una empresa nueva (`activa = true`, nombre con prefijo `ZZZ EMPRESA TEST`) y su
usuario admin (`app_metadata { empresa_id, rol: 'admin' }`, `email_confirm: true`).
Genera una password aleatoria fuerte y la imprime **una sola vez**.

```powershell
cd frontend
$env:SERVICE_ROLE_KEY = "eyJ...service_role..."
node scripts/crear-empresa-test.mjs
```

Salida: `empresa_id`, `email` y `password` para hacer login en /login (preview o prod).
**Solo hace INSERT** — no modifica ninguna empresa ni cuenta existente.

## rollback-empresa-test.mjs

Borra la empresa de test + sus usuarios de Auth, por `empresa_id`.

```powershell
cd frontend
$env:SERVICE_ROLE_KEY = "eyJ...service_role..."
node scripts/rollback-empresa-test.mjs <empresa_id>
```

Guard de seguridad: **aborta** si el nombre no empieza con `ZZZ EMPRESA TEST` (evita
borrar un cliente real por un id mal pegado). Forzar con `FORCE=1` solo si estás seguro.

## Limpieza manual (alternativa al rollback)

- Auth: Dashboard → Authentication → Users → borrar el email `qa-login+…@agent-gms.test`.
- DB: `delete from empresas where id = '<empresa_id>';`
