-- ============================================================
-- RESET DE CONTRASEÑA — Almacenero Digital
-- Ejecutar en: Supabase Dashboard → SQL Editor
-- Proyecto: nxhkzcuqnmqjtiltoztg
-- Requiere: extensión pgcrypto (ya incluida en Supabase)
-- ============================================================

-- Cambiar la contraseña de UN usuario específico:
UPDATE auth.users
SET encrypted_password = crypt('NUEVA_CONTRASEÑA_AQUI', gen_salt('bf'))
WHERE email = 'usuario@ejemplo.com';

-- ============================================================
-- Usuarios de prueba — cambiar las 3 a la vez:
-- ============================================================

UPDATE auth.users
SET encrypted_password = crypt('Admin1234!', gen_salt('bf'))
WHERE email = 'admin@almacenero.test';

UPDATE auth.users
SET encrypted_password = crypt('Super1234!', gen_salt('bf'))
WHERE email = 'supervisor@almacenero.test';

UPDATE auth.users
SET encrypted_password = crypt('Vende1234!', gen_salt('bf'))
WHERE email = 'vendedor@almacenero.test';

-- ============================================================
-- Verificar que los usuarios existen (no muestra contraseñas):
-- ============================================================

SELECT email, role, created_at, last_sign_in_at
FROM auth.users
WHERE email IN (
  'admin@almacenero.test',
  'supervisor@almacenero.test',
  'vendedor@almacenero.test'
);
