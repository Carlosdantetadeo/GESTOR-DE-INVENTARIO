import SuperadminChrome from '../../components/SuperadminChrome'

export const metadata = {
  title: 'Panel Superadmin — AGENT GMS',
}

export default function SuperadminLayout({ children }) {
  return <SuperadminChrome>{children}</SuperadminChrome>
}
