import Link from 'next/link'

export const metadata = {
  title: 'Almacenero Digital — Control de inventario para ferreterías y comercios',
  description: 'Registrá ventas e ingresos por voz desde Telegram. Dashboard en tiempo real. Multi-sede. Sin papel.',
}

const BENEFICIOS = [
  {
    icono: '🎙️',
    titulo: 'Registro por voz',
    texto: 'Tus operarios dictan las entradas y salidas desde Telegram. Sin formularios, sin errores de tipeo, sin papel.',
  },
  {
    icono: '📊',
    titulo: 'Dashboard en tiempo real',
    texto: 'Ventas, stock y movimientos actualizados al instante en cualquier dispositivo. Tomás decisiones con datos del momento.',
  },
  {
    icono: '🏪',
    titulo: 'Multi-sede',
    texto: 'Gestioná todas tus sucursales desde un solo lugar. Cada sede con su stock y sus reportes, todo consolidado.',
  },
  {
    icono: '🔍',
    titulo: 'Auditoría completa',
    texto: 'Cada movimiento queda registrado con quién lo hizo, cuándo y desde qué sede. Cero pérdidas sin explicación.',
  },
]

const PASOS = [
  {
    nro: '01',
    titulo: 'Te registramos',
    texto: 'Cargamos tus productos, sedes y usuarios. En 24 horas tu equipo ya puede operar.',
  },
  {
    nro: '02',
    titulo: 'Tu equipo usa Telegram',
    texto: 'El operario manda un audio: "vendí 3 caños de media pulgada a 15 soles". El sistema lo entiende y lo registra.',
  },
  {
    nro: '03',
    titulo: 'Vos mirás el dashboard',
    texto: 'Abrís el panel desde cualquier celular o PC y ves todo: stock actual, ventas del día, productos críticos.',
  },
]

export default function LandingPage() {
  return (
    <div style={{ fontFamily: "'Inter', sans-serif", background: '#f8fafc', color: '#1a2236', overflowX: 'hidden' }}>

      <style>{`
        *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }

        @keyframes fadeUp {
          from { opacity: 0; transform: translateY(24px); }
          to   { opacity: 1; transform: translateY(0); }
        }
        @keyframes pulse-glow {
          0%, 100% { box-shadow: 0 0 0 0 rgba(37,99,235,0.18); }
          50%       { box-shadow: 0 0 0 12px rgba(37,99,235,0); }
        }

        .fade-up { animation: fadeUp 0.6s ease both; }
        .delay-1 { animation-delay: 0.1s; }
        .delay-2 { animation-delay: 0.2s; }
        .delay-3 { animation-delay: 0.3s; }
        .delay-4 { animation-delay: 0.45s; }
        .delay-5 { animation-delay: 0.6s; }

        .cta-btn {
          display: inline-flex; align-items: center; gap: 8px;
          padding: 16px 36px; border-radius: 10px; font-size: 1rem;
          font-weight: 700; cursor: pointer; text-decoration: none;
          transition: transform 0.15s ease, box-shadow 0.15s ease;
        }
        .cta-btn:hover { transform: translateY(-2px); }

        .cta-primary {
          background: #2563eb; color: #fff;
          box-shadow: 0 4px 18px rgba(37,99,235,0.35);
          animation: pulse-glow 2.5s ease infinite;
        }
        .cta-primary:hover { box-shadow: 0 8px 28px rgba(37,99,235,0.45); }

        .cta-secondary {
          background: #fff; color: #2563eb;
          border: 2px solid #2563eb;
        }
        .cta-secondary:hover { background: #eff6ff; }

        .benefit-card {
          background: #fff; border: 1px solid #e2e8f0;
          border-radius: 14px; padding: 28px 24px;
          box-shadow: 0 1px 4px rgba(0,0,0,0.06);
          transition: transform 0.18s ease, box-shadow 0.18s ease;
        }
        .benefit-card:hover {
          transform: translateY(-4px);
          box-shadow: 0 8px 24px rgba(37,99,235,0.10);
          border-color: #bfdbfe;
        }

        .nav-link {
          color: #475569; text-decoration: none; font-weight: 500;
          font-size: 0.9rem; transition: color 0.15s;
        }
        .nav-link:hover { color: #2563eb; }

        .stat-num {
          font-size: 2.4rem; font-weight: 800; color: #2563eb; line-height: 1;
        }
        .stat-label {
          font-size: 0.85rem; color: #64748b; margin-top: 4px;
        }

        @media (max-width: 640px) {
          .hero-title { font-size: 2.1rem !important; }
          .hero-sub { font-size: 1rem !important; }
          .grid-2, .grid-4 { grid-template-columns: 1fr !important; }
          .grid-3 { grid-template-columns: 1fr !important; }
          .cta-group { flex-direction: column !important; align-items: stretch !important; }
          .cta-btn { justify-content: center; }
          .stats-row { grid-template-columns: 1fr 1fr !important; }
          .hide-mobile { display: none !important; }
          .nav-cta-mobile { display: flex !important; }
        }
      `}</style>

      {/* ── NAV ── */}
      <nav style={{ position: 'sticky', top: 0, zIndex: 100, background: 'rgba(248,250,252,0.92)', backdropFilter: 'blur(14px)', borderBottom: '1px solid #e2e8f0' }}>
        <div style={{ maxWidth: '1100px', margin: '0 auto', padding: '0 24px', height: '64px', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
            <div style={{ width: '34px', height: '34px', borderRadius: '8px', background: '#2563eb', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '18px' }}>📦</div>
            <span style={{ fontWeight: 800, fontSize: '1.05rem', letterSpacing: '-0.3px' }}>Almacenero Digital</span>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '28px' }}>
            <a href="#beneficios" className="nav-link hide-mobile">Beneficios</a>
            <a href="#como-funciona" className="nav-link hide-mobile">Cómo funciona</a>
            <a href="#contacto" className="nav-link hide-mobile">Contacto</a>
            <Link href="/login" className="cta-btn cta-primary" style={{ padding: '10px 22px', fontSize: '0.85rem' }}>
              Acceder
            </Link>
          </div>
        </div>
      </nav>

      {/* ── HERO ── */}
      <section style={{ background: 'linear-gradient(135deg, #eff6ff 0%, #f8fafc 60%, #f0fdf4 100%)', padding: '90px 24px 80px' }}>
        <div style={{ maxWidth: '800px', margin: '0 auto', textAlign: 'center' }}>
          <div className="fade-up" style={{ display: 'inline-flex', alignItems: 'center', gap: '8px', background: '#dbeafe', color: '#1d4ed8', borderRadius: '99px', padding: '6px 16px', fontSize: '0.82rem', fontWeight: 700, marginBottom: '28px', letterSpacing: '0.3px' }}>
            <span style={{ width: '7px', height: '7px', borderRadius: '50%', background: '#16a34a', display: 'inline-block' }} />
            Sistema activo — Ferreterías y comercios de Perú
          </div>

          <h1 className="fade-up delay-1 hero-title" style={{ fontSize: '3.2rem', fontWeight: 800, lineHeight: 1.15, letterSpacing: '-1px', marginBottom: '22px' }}>
            Tu inventario,{' '}
            <span style={{ color: '#2563eb' }}>bajo control.</span>
            <br />Sin papel. En tiempo real.
          </h1>

          <p className="fade-up delay-2 hero-sub" style={{ fontSize: '1.15rem', color: '#475569', lineHeight: 1.7, maxWidth: '600px', margin: '0 auto 40px' }}>
            Tus operarios registran ventas e ingresos con un audio de voz desde Telegram.
            Vos ves el stock y las ventas en el dashboard al instante, desde cualquier lugar.
          </p>

          <div className="fade-up delay-3 cta-group" style={{ display: 'flex', gap: '16px', justifyContent: 'center', flexWrap: 'wrap' }}>
            <Link href="/login" className="cta-btn cta-primary">
              Acceder a mi cuenta →
            </Link>
            <a href="#como-funciona" className="cta-btn cta-secondary">
              Ver cómo funciona
            </a>
          </div>

          {/* Stats */}
          <div className="fade-up delay-4 stats-row" style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '24px', marginTop: '64px', maxWidth: '600px', margin: '64px auto 0' }}>
            {[
              { num: '100%', label: 'registro por voz' },
              { num: '< 2s', label: 'transcripción con IA' },
              { num: '∞', label: 'sedes por empresa' },
            ].map(s => (
              <div key={s.label} style={{ padding: '20px 12px', background: '#fff', borderRadius: '12px', border: '1px solid #e2e8f0', boxShadow: '0 1px 4px rgba(0,0,0,0.05)' }}>
                <div className="stat-num">{s.num}</div>
                <div className="stat-label">{s.label}</div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── BENEFICIOS ── */}
      <section id="beneficios" style={{ padding: '80px 24px', background: '#fff' }}>
        <div style={{ maxWidth: '1100px', margin: '0 auto' }}>
          <div style={{ textAlign: 'center', marginBottom: '52px' }}>
            <h2 style={{ fontSize: '2rem', fontWeight: 800, letterSpacing: '-0.5px', marginBottom: '12px' }}>
              Todo lo que necesita tu negocio
            </h2>
            <p style={{ color: '#64748b', fontSize: '1rem', maxWidth: '500px', margin: '0 auto' }}>
              Diseñado para ferreterías, depósitos y comercios con múltiples sucursales.
            </p>
          </div>

          <div className="grid-4" style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '20px' }}>
            {BENEFICIOS.map((b, i) => (
              <div key={b.titulo} className={`benefit-card fade-up delay-${i + 1}`}>
                <div style={{ fontSize: '2.2rem', marginBottom: '16px' }}>{b.icono}</div>
                <h3 style={{ fontSize: '1rem', fontWeight: 700, marginBottom: '10px', color: '#1a2236' }}>{b.titulo}</h3>
                <p style={{ fontSize: '0.875rem', color: '#64748b', lineHeight: 1.65 }}>{b.texto}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── CÓMO FUNCIONA ── */}
      <section id="como-funciona" style={{ padding: '80px 24px', background: '#f8fafc' }}>
        <div style={{ maxWidth: '900px', margin: '0 auto' }}>
          <div style={{ textAlign: 'center', marginBottom: '52px' }}>
            <h2 style={{ fontSize: '2rem', fontWeight: 800, letterSpacing: '-0.5px', marginBottom: '12px' }}>
              Tres pasos y listo
            </h2>
            <p style={{ color: '#64748b', fontSize: '1rem' }}>
              Sin instalaciones complicadas. Sin capacitaciones largas.
            </p>
          </div>

          <div className="grid-3" style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '24px' }}>
            {PASOS.map((p, i) => (
              <div key={p.nro} style={{ background: '#fff', borderRadius: '14px', padding: '32px 24px', border: '1px solid #e2e8f0', boxShadow: '0 1px 4px rgba(0,0,0,0.05)', position: 'relative' }}>
                <div style={{ fontSize: '3rem', fontWeight: 900, color: '#dbeafe', lineHeight: 1, marginBottom: '16px', letterSpacing: '-2px' }}>{p.nro}</div>
                <h3 style={{ fontSize: '1.05rem', fontWeight: 700, marginBottom: '10px', color: '#1a2236' }}>{p.titulo}</h3>
                <p style={{ fontSize: '0.875rem', color: '#64748b', lineHeight: 1.7 }}>{p.texto}</p>
              </div>
            ))}
          </div>

          {/* Demo visual — transcript fake */}
          <div style={{ marginTop: '48px', background: '#1e293b', borderRadius: '16px', padding: '28px 32px', maxWidth: '580px', margin: '48px auto 0' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '20px' }}>
              <div style={{ width: '10px', height: '10px', borderRadius: '50%', background: '#16a34a', boxShadow: '0 0 8px #16a34a' }} />
              <span style={{ color: '#94a3b8', fontSize: '0.78rem', fontWeight: 600, letterSpacing: '0.5px' }}>TELEGRAM → ALMACENERO DIGITAL</span>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
              <div style={{ background: '#334155', borderRadius: '10px 10px 10px 2px', padding: '12px 16px', maxWidth: '80%' }}>
                <div style={{ color: '#94a3b8', fontSize: '0.7rem', marginBottom: '4px' }}>Operario — Sede Centro</div>
                <div style={{ color: '#e2e8f0', fontSize: '0.9rem' }}>🎙️ "vendí 10 caños media pulgada a 8 soles cada uno"</div>
              </div>
              <div style={{ background: '#1d4ed8', borderRadius: '10px 10px 2px 10px', padding: '12px 16px', maxWidth: '80%', alignSelf: 'flex-end' }}>
                <div style={{ color: '#bfdbfe', fontSize: '0.7rem', marginBottom: '4px' }}>Almacenero Digital</div>
                <div style={{ color: '#fff', fontSize: '0.9rem' }}>✅ Venta registrada · 10 × Caño ½" · S/ 80.00</div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ── CTA FINAL ── */}
      <section style={{ padding: '80px 24px', background: 'linear-gradient(135deg, #1e40af 0%, #2563eb 100%)' }}>
        <div style={{ maxWidth: '680px', margin: '0 auto', textAlign: 'center' }}>
          <h2 style={{ fontSize: '2.1rem', fontWeight: 800, color: '#fff', letterSpacing: '-0.5px', marginBottom: '16px', lineHeight: 1.2 }}>
            ¿Ya tenés tu cuenta?
          </h2>
          <p style={{ color: '#bfdbfe', fontSize: '1.05rem', lineHeight: 1.7, marginBottom: '36px' }}>
            Ingresá al panel de control y revisá el stock y las ventas del día.
          </p>
          <Link href="/login" className="cta-btn" style={{ background: '#fff', color: '#1d4ed8', padding: '18px 44px', fontSize: '1.05rem', boxShadow: '0 4px 24px rgba(0,0,0,0.18)' }}>
            Acceder a mi cuenta →
          </Link>
        </div>
      </section>

      {/* ── FOOTER ── */}
      <footer id="contacto" style={{ background: '#0f172a', color: '#94a3b8', padding: '40px 24px' }}>
        <div style={{ maxWidth: '1100px', margin: '0 auto', display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '16px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
            <div style={{ width: '28px', height: '28px', borderRadius: '6px', background: '#2563eb', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '14px' }}>📦</div>
            <span style={{ color: '#e2e8f0', fontWeight: 700, fontSize: '0.9rem' }}>Almacenero Digital</span>
          </div>
          <div style={{ fontSize: '0.82rem', color: '#64748b' }}>
            Contacto: <a href="mailto:carlosdantetadeo@gmail.com" style={{ color: '#60a5fa', textDecoration: 'none' }}>carlosdantetadeo@gmail.com</a>
          </div>
          <div style={{ fontSize: '0.8rem', color: '#475569' }}>
            © {new Date().getFullYear()} Almacenero Digital. Todos los derechos reservados.
          </div>
        </div>
      </footer>

    </div>
  )
}
