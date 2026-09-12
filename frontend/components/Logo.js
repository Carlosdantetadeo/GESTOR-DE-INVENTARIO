'use client'

import Image from 'next/image'
import Link from 'next/link'

export default function Logo({ height = 36, href = '/', white = false, linkStyle = {} }) {
  return (
    <Link href={href} style={{ display: 'inline-flex', alignItems: 'center', textDecoration: 'none', ...linkStyle }}>
      <Image
        src="/logo-almacenero-digital-hd.png"
        alt="Almacenero Digital"
        width={320}
        height={100}
        priority
        style={{
          height: `${height}px`,
          width: 'auto',
          display: 'block',
          ...(white ? { filter: 'brightness(0) invert(1)' } : {}),
        }}
      />
    </Link>
  )
}
