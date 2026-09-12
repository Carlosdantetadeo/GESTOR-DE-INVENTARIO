'use client'

import Image from 'next/image'
import Link from 'next/link'

export default function Logo({ height = 36, href = '/', linkStyle = {} }) {
  return (
    <Link href={href} style={{ display: 'inline-flex', alignItems: 'center', textDecoration: 'none', ...linkStyle }}>
      <Image
        src="/logo-almacenerodigital.png"
        alt="Almacenero Digital"
        width={200}
        height={80}
        priority
        style={{ height: `${height}px`, width: 'auto', display: 'block' }}
      />
    </Link>
  )
}
