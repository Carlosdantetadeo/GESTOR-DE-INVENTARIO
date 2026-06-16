import { NextResponse } from 'next/server'
import { SESSION_COOKIE } from '@/lib/superadmin/session'

// Invalida la cookie y redirige al login del superadmin.
export async function GET(request) {
  const res = NextResponse.redirect(new URL('/superadmin/login', request.url))
  res.cookies.set(SESSION_COOKIE, '', { httpOnly: true, path: '/', maxAge: 0 })
  return res
}
