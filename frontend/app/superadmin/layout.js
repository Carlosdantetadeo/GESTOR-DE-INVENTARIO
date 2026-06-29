import SuperadminChrome from '../../components/SuperadminChrome'

export const metadata = {
  title: 'Panel Superadmin — Almacenero Digital',
}

export default function SuperadminLayout({ children }) {
  return <SuperadminChrome>{children}</SuperadminChrome>
}
