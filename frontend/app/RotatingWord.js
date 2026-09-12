'use client'

import { useState, useEffect } from 'react'

const WORDS = ['ferretería,', 'mueblería,', 'distribuidora,', 'tienda de ropa,', 'abarrotes,']

export default function RotatingWord() {
  const [index, setIndex]     = useState(0)
  const [visible, setVisible] = useState(true)

  useEffect(() => {
    const timer = setInterval(() => {
      setVisible(false)
      setTimeout(() => {
        setIndex(i => (i + 1) % WORDS.length)
        setVisible(true)
      }, 350)
    }, 2400)
    return () => clearInterval(timer)
  }, [])

  return (
    <span style={{
      color: '#2563eb',
      display: 'inline-block',
      opacity: visible ? 1 : 0,
      transform: visible ? 'translateY(0)' : 'translateY(-10px)',
      transition: 'opacity 0.35s ease, transform 0.35s ease',
    }}>
      {WORDS[index]}
    </span>
  )
}
