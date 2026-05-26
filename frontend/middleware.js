import { createServerClient } from '@supabase/ssr'
import { NextResponse } from 'next/server'

const PUBLIC_PATHS = ['/login', '/registro']

export async function middleware(request) {
  // Preparar la respuesta base; puede ser modificada para refrescar cookies de sesión
  let response = NextResponse.next({ request })

  // Crear un cliente Supabase que lee/escribe cookies desde el contexto del middleware
  const rawUrl = process.env.NEXT_PUBLIC_SUPABASE_URL ?? ''
  const supabaseUrl = rawUrl.replace(/\/(rest|auth|storage|functions)(\/.*)?$/, '').replace(/\/$/, '')

  const supabase = createServerClient(
    supabaseUrl,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll()
        },
        setAll(cookiesToSet) {
          // Propagar cualquier cookie que Supabase quiera actualizar (refresh de sesión)
          cookiesToSet.forEach(({ name, value }) =>
            request.cookies.set(name, value)
          )
          response = NextResponse.next({ request })
          cookiesToSet.forEach(({ name, value, options }) =>
            response.cookies.set(name, value, options)
          )
        },
      },
    }
  )

  // getUser() verifica el JWT contra Supabase Auth (no confía solo en la cookie local)
  const { data: { user } } = await supabase.auth.getUser()

  const path = request.nextUrl.pathname
  const isPublic = PUBLIC_PATHS.some(p => path.startsWith(p))

  // Sin sesión → redirigir a /login (excepto rutas públicas)
  if (!user && !isPublic) {
    const loginUrl = new URL('/login', request.url)
    loginUrl.searchParams.set('redirect', path)
    return NextResponse.redirect(loginUrl)
  }

  // Con sesión activa → no dejar pasar a /login ni /registro
  if (user && isPublic) {
    return NextResponse.redirect(new URL('/', request.url))
  }

  return response
}

export const config = {
  matcher: [
    // Aplicar a todas las rutas excepto archivos estáticos y recursos internos de Next.js
    '/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)',
  ],
}
