import Link from 'next/link'
import Image from 'next/image'
import RotatingWord from './RotatingWord'

export const metadata = {
  title: 'Almacenero Digital — Control de inventario para cualquier negocio',
  description: 'Registrá ventas e ingresos por voz o foto desde el celular. Para tiendas, depósitos, distribuidoras y más. Dashboard en tiempo real. Sin papel.',
}

const WA_LINK = 'https://wa.me/51906959989?text=Hola%2C%20quiero%20saber%20m%C3%A1s%20sobre%20Almacenero%20Digital'

const BENEFICIOS = [
  {
    icono: '🎙️',
    titulo: 'Registro por voz',
    texto: 'Tu equipo dicta la venta desde el celular y el sistema la registra al instante. Sin formularios, sin errores de tipeo.',
  },
  {
    icono: '📸',
    titulo: 'Recepción por foto',
    texto: 'Sacá foto a la factura del proveedor y el sistema extrae los productos y cantidades automáticamente. Cero carga manual.',
  },
  {
    icono: '📊',
    titulo: 'Dashboard en tiempo real',
    texto: 'Ventas, stock y movimientos actualizados al instante desde cualquier dispositivo. Tomás decisiones con datos del momento.',
  },
  {
    icono: '🏪',
    titulo: 'Multi-sede',
    texto: 'Gestioná todas tus sucursales desde un solo lugar. Cada local con su stock y reportes, todo consolidado.',
  },
]

const PASOS = [
  {
    nro: '01',
    titulo: 'Te registramos en 24 hs',
    texto: 'Cargamos tus productos, sedes y usuarios. Al día siguiente tu equipo ya opera sin capacitación larga.',
  },
  {
    nro: '02',
    titulo: 'Tu equipo registra desde el celular',
    texto: 'Ventas e ingresos por voz, texto o foto de factura. La app funciona también sin conexión y sincroniza al recuperar señal.',
  },
  {
    nro: '03',
    titulo: 'Vos ves todo desde el dashboard',
    texto: 'Stock actual, ventas del día, productos críticos y reportes por sede. Todo en tiempo real desde cualquier lugar.',
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
        @keyframes wa-bounce {
          0%, 100% { transform: scale(1); }
          50%       { transform: scale(1.08); }
        }

        .fade-up { animation: fadeUp 0.6s ease both; }
        .delay-1 { animation-delay: 0.1s; }
        .delay-2 { animation-delay: 0.2s; }
        .delay-3 { animation-delay: 0.3s; }
        .delay-4 { animation-delay: 0.45s; }

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

        .cta-wa {
          background: #25d366; color: #fff;
          box-shadow: 0 4px 18px rgba(37,211,102,0.35);
        }
        .cta-wa:hover { box-shadow: 0 8px 28px rgba(37,211,102,0.45); }

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

        /* Botón flotante WhatsApp */
        .wa-fab {
          position: fixed; bottom: 28px; right: 28px; z-index: 999;
          width: 58px; height: 58px; border-radius: 50%;
          background: #25d366; display: flex; align-items: center; justify-content: center;
          box-shadow: 0 4px 20px rgba(37,211,102,0.45);
          text-decoration: none; animation: wa-bounce 2.5s ease infinite;
          transition: transform 0.15s ease;
        }
        .wa-fab:hover { transform: scale(1.12); animation: none; }

        @media (max-width: 640px) {
          .hero-title { font-size: 2.1rem !important; }
          .hero-sub   { font-size: 1rem !important; }
          .grid-2, .grid-4 { grid-template-columns: 1fr !important; }
          .grid-3     { grid-template-columns: 1fr !important; }
          .cta-group  { flex-direction: column !important; align-items: stretch !important; }
          .cta-btn    { justify-content: center; }
          .stats-row  { grid-template-columns: 1fr 1fr !important; }
          .hide-mobile { display: none !important; }
        }
      `}</style>

      {/* ── BOTÓN FLOTANTE WHATSAPP ── */}
      <a href={WA_LINK} target="_blank" rel="noopener noreferrer" className="wa-fab" aria-label="Contactar por WhatsApp">
        <svg width="28" height="28" viewBox="0 0 32 32" fill="none" xmlns="http://www.w3.org/2000/svg">
          <path d="M16 2C8.268 2 2 8.268 2 16c0 2.484.675 4.813 1.852 6.81L2 30l7.39-1.826A13.94 13.94 0 0016 30c7.732 0 14-6.268 14-14S23.732 2 16 2z" fill="#fff"/>
          <path d="M22.5 19.5c-.3-.15-1.77-.873-2.044-.972-.273-.1-.472-.15-.67.15-.2.298-.77.972-.945 1.17-.174.2-.347.223-.647.075-.3-.15-1.266-.467-2.412-1.489-.891-.794-1.493-1.774-1.668-2.074-.174-.3-.018-.462.13-.61.135-.133.3-.348.45-.522.15-.174.2-.298.3-.497.1-.2.05-.373-.025-.522-.075-.15-.67-1.614-.918-2.21-.242-.58-.487-.5-.67-.51-.174-.008-.373-.01-.572-.01-.2 0-.522.075-.795.373-.273.298-1.043 1.02-1.043 2.484 0 1.464 1.068 2.878 1.218 3.077.15.2 2.102 3.207 5.092 4.496.712.307 1.268.49 1.702.627.715.227 1.367.195 1.881.118.574-.085 1.77-.723 2.02-1.422.25-.698.25-1.296.175-1.422-.075-.125-.273-.2-.572-.348z" fill="#25d366"/>
        </svg>
      </a>

      {/* ── NAV ── */}
      <nav style={{ position: 'sticky', top: 0, zIndex: 100, background: 'rgba(248,250,252,0.95)', backdropFilter: 'blur(14px)', borderBottom: '1px solid #e2e8f0' }}>
        <div style={{ maxWidth: '1100px', margin: '0 auto', padding: '0 24px', height: '68px', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          {/* Logo nav: ícono + texto compuesto para control preciso */}
          <Link href="/" style={{ display: 'inline-flex', alignItems: 'center', gap: '10px', textDecoration: 'none' }}>
            <Image src="/foto-perfil-almacenero-digital.png" alt="" width={38} height={38} priority style={{ width: '38px', height: '38px', borderRadius: '9px' }} />
            <div style={{ lineHeight: 1.15 }}>
              <div style={{ fontSize: '1rem', fontWeight: 800, color: '#0f2557', letterSpacing: '-0.3px' }}>almacenero<span style={{ color: '#2563eb' }}>.digital</span></div>
              <div style={{ fontSize: '0.6rem', fontWeight: 600, color: '#94a3b8', letterSpacing: '0.8px', textTransform: 'uppercase' }}>Tu asistente de inventario</div>
            </div>
          </Link>
          <div style={{ display: 'flex', alignItems: 'center', gap: '28px' }}>
            <a href="#beneficios" className="nav-link hide-mobile">Beneficios</a>
            <a href="#como-funciona" className="nav-link hide-mobile">Cómo funciona</a>
            <a href={WA_LINK} target="_blank" rel="noopener noreferrer" className="nav-link hide-mobile">Contacto</a>
            <Link href="/auditoria" className="cta-btn cta-primary" style={{ padding: '10px 22px', fontSize: '0.85rem' }}>
              Acceder
            </Link>
          </div>
        </div>
      </nav>

      {/* ── HERO ── */}
      <section style={{ background: 'linear-gradient(135deg, #eff6ff 0%, #f8fafc 60%, #f0fdf4 100%)', padding: '90px 24px 80px' }}>
        <div style={{ maxWidth: '800px', margin: '0 auto', textAlign: 'center' }}>

          {/* Logo HD en hero — prominente y centrado */}
          <div className="fade-up" style={{ display: 'flex', justifyContent: 'center', marginBottom: '32px' }}>
            <Image
              src="/logo-almacenero-digital-hd.png"
              alt="Almacenero Digital"
              width={420}
              height={134}
              priority
              style={{ height: '72px', width: 'auto', maxWidth: '100%' }}
            />
          </div>

          <div className="fade-up delay-1" style={{ display: 'inline-flex', alignItems: 'center', gap: '8px', background: '#dbeafe', color: '#1d4ed8', borderRadius: '99px', padding: '6px 16px', fontSize: '0.82rem', fontWeight: 700, marginBottom: '28px', letterSpacing: '0.3px' }}>
            <span style={{ width: '7px', height: '7px', borderRadius: '50%', background: '#16a34a', display: 'inline-block' }} />
            Para tiendas, depósitos, distribuidoras y más
          </div>

          <h1 className="fade-up delay-1 hero-title" style={{ fontSize: '3.2rem', fontWeight: 800, lineHeight: 1.2, letterSpacing: '-1px', marginBottom: '22px' }}>
            Tu <RotatingWord /><br />
            <span style={{ color: '#2563eb' }}>digitalizado.</span> Sin papel. En tiempo real.
          </h1>

          <p className="fade-up delay-2 hero-sub" style={{ fontSize: '1.15rem', color: '#475569', lineHeight: 1.7, maxWidth: '600px', margin: '0 auto 40px' }}>
            Tu equipo registra ventas e ingresos por voz o foto desde el celular.
            Vos ves el stock, las ventas y los reportes al instante, desde cualquier lugar.
          </p>

          <div className="fade-up delay-3 cta-group" style={{ display: 'flex', gap: '16px', justifyContent: 'center', flexWrap: 'wrap' }}>
            <Link href="/auditoria" className="cta-btn cta-primary">
              Acceder a mi cuenta →
            </Link>
            <a href={WA_LINK} target="_blank" rel="noopener noreferrer" className="cta-btn cta-wa">
              <svg width="20" height="20" viewBox="0 0 32 32" fill="none"><path d="M16 2C8.268 2 2 8.268 2 16c0 2.484.675 4.813 1.852 6.81L2 30l7.39-1.826A13.94 13.94 0 0016 30c7.732 0 14-6.268 14-14S23.732 2 16 2z" fill="rgba(255,255,255,0.3)"/><path d="M22.5 19.5c-.3-.15-1.77-.873-2.044-.972-.273-.1-.472-.15-.67.15-.2.298-.77.972-.945 1.17-.174.2-.347.223-.647.075-.3-.15-1.266-.467-2.412-1.489-.891-.794-1.493-1.774-1.668-2.074-.174-.3-.018-.462.13-.61.135-.133.3-.348.45-.522.15-.174.2-.298.3-.497.1-.2.05-.373-.025-.522-.075-.15-.67-1.614-.918-2.21-.242-.58-.487-.5-.67-.51-.174-.008-.373-.01-.572-.01-.2 0-.522.075-.795.373-.273.298-1.043 1.02-1.043 2.484 0 1.464 1.068 2.878 1.218 3.077.15.2 2.102 3.207 5.092 4.496.712.307 1.268.49 1.702.627.715.227 1.367.195 1.881.118.574-.085 1.77-.723 2.02-1.422.25-.698.25-1.296.175-1.422-.075-.125-.273-.2-.572-.348z" fill="#fff"/></svg>
              Consultar por WhatsApp
            </a>
          </div>

          {/* Stats */}
          <div className="fade-up delay-4 stats-row" style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '24px', marginTop: '64px', maxWidth: '600px', margin: '64px auto 0' }}>
            {[
              { num: '3', label: 'formas de registrar' },
              { num: '< 2s', label: 'transcripción con IA' },
              { num: '∞', label: 'sedes por empresa' },
            ].map(s => (
              <div key={s.label} style={{ padding: '20px 12px', background: '#fff', borderRadius: '12px', border: '1px solid #e2e8f0', boxShadow: '0 1px 4px rgba(0,0,0,0.05)' }}>
                <div style={{ fontSize: '2.4rem', fontWeight: 800, color: '#2563eb', lineHeight: 1 }}>{s.num}</div>
                <div style={{ fontSize: '0.85rem', color: '#64748b', marginTop: '4px' }}>{s.label}</div>
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
              Para tiendas, depósitos, distribuidoras, ropa, abarrotes y cualquier negocio con stock.
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
              Sin instalaciones. Sin capacitaciones largas. Funciona desde el celular.
            </p>
          </div>

          <div className="grid-3" style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '24px' }}>
            {PASOS.map((p) => (
              <div key={p.nro} style={{ background: '#fff', borderRadius: '14px', padding: '32px 24px', border: '1px solid #e2e8f0', boxShadow: '0 1px 4px rgba(0,0,0,0.05)' }}>
                <div style={{ fontSize: '3rem', fontWeight: 900, color: '#dbeafe', lineHeight: 1, marginBottom: '16px', letterSpacing: '-2px' }}>{p.nro}</div>
                <h3 style={{ fontSize: '1.05rem', fontWeight: 700, marginBottom: '10px', color: '#1a2236' }}>{p.titulo}</h3>
                <p style={{ fontSize: '0.875rem', color: '#64748b', lineHeight: 1.7 }}>{p.texto}</p>
              </div>
            ))}
          </div>

          {/* Demo visual */}
          <div style={{ marginTop: '48px', background: '#1e293b', borderRadius: '16px', padding: '28px 32px', maxWidth: '580px', margin: '48px auto 0' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '20px' }}>
              <div style={{ width: '10px', height: '10px', borderRadius: '50%', background: '#16a34a', boxShadow: '0 0 8px #16a34a' }} />
              <span style={{ color: '#94a3b8', fontSize: '0.78rem', fontWeight: 600, letterSpacing: '0.5px' }}>ALMACENERO DIGITAL — APP MÓVIL</span>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
              <div style={{ background: '#334155', borderRadius: '10px 10px 10px 2px', padding: '12px 16px', maxWidth: '80%' }}>
                <div style={{ color: '#94a3b8', fontSize: '0.7rem', marginBottom: '4px' }}>Vendedor — Sede Centro</div>
                <div style={{ color: '#e2e8f0', fontSize: '0.9rem' }}>🎙️ "vendí 10 caños media pulgada a 8 soles"</div>
              </div>
              <div style={{ background: '#1d4ed8', borderRadius: '10px 10px 2px 10px', padding: '12px 16px', maxWidth: '80%', alignSelf: 'flex-end' }}>
                <div style={{ color: '#bfdbfe', fontSize: '0.7rem', marginBottom: '4px' }}>Sistema</div>
                <div style={{ color: '#fff', fontSize: '0.9rem' }}>✅ Venta registrada · 10 × Caño ½" · S/ 80.00</div>
              </div>
              <div style={{ background: '#334155', borderRadius: '10px 10px 10px 2px', padding: '12px 16px', maxWidth: '80%' }}>
                <div style={{ color: '#94a3b8', fontSize: '0.7rem', marginBottom: '4px' }}>Vendedor — Sede Norte</div>
                <div style={{ color: '#e2e8f0', fontSize: '0.9rem' }}>📸 [foto de factura del proveedor]</div>
              </div>
              <div style={{ background: '#1d4ed8', borderRadius: '10px 10px 2px 10px', padding: '12px 16px', maxWidth: '85%', alignSelf: 'flex-end' }}>
                <div style={{ color: '#bfdbfe', fontSize: '0.7rem', marginBottom: '4px' }}>Sistema</div>
                <div style={{ color: '#fff', fontSize: '0.9rem' }}>✅ 8 productos detectados · Ingreso confirmado</div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ── CTA FINAL ── */}
      <section style={{ padding: '80px 24px', background: 'linear-gradient(135deg, #1e40af 0%, #2563eb 100%)' }}>
        <div style={{ maxWidth: '680px', margin: '0 auto', textAlign: 'center' }}>
          <h2 style={{ fontSize: '2.1rem', fontWeight: 800, color: '#fff', letterSpacing: '-0.5px', marginBottom: '16px', lineHeight: 1.2 }}>
            ¿Listo para digitalizar tu negocio?
          </h2>
          <p style={{ color: '#bfdbfe', fontSize: '1.05rem', lineHeight: 1.7, marginBottom: '36px' }}>
            Funciona para cualquier rubro. Escribinos y te configuramos en menos de 24 horas.
          </p>
          <div style={{ display: 'flex', gap: '16px', justifyContent: 'center', flexWrap: 'wrap' }}>
            <a href={WA_LINK} target="_blank" rel="noopener noreferrer" className="cta-btn cta-wa" style={{ padding: '18px 36px', fontSize: '1.05rem' }}>
              <svg width="22" height="22" viewBox="0 0 32 32" fill="none"><path d="M16 2C8.268 2 2 8.268 2 16c0 2.484.675 4.813 1.852 6.81L2 30l7.39-1.826A13.94 13.94 0 0016 30c7.732 0 14-6.268 14-14S23.732 2 16 2z" fill="rgba(255,255,255,0.25)"/><path d="M22.5 19.5c-.3-.15-1.77-.873-2.044-.972-.273-.1-.472-.15-.67.15-.2.298-.77.972-.945 1.17-.174.2-.347.223-.647.075-.3-.15-1.266-.467-2.412-1.489-.891-.794-1.493-1.774-1.668-2.074-.174-.3-.018-.462.13-.61.135-.133.3-.348.45-.522.15-.174.2-.298.3-.497.1-.2.05-.373-.025-.522-.075-.15-.67-1.614-.918-2.21-.242-.58-.487-.5-.67-.51-.174-.008-.373-.01-.572-.01-.2 0-.522.075-.795.373-.273.298-1.043 1.02-1.043 2.484 0 1.464 1.068 2.878 1.218 3.077.15.2 2.102 3.207 5.092 4.496.712.307 1.268.49 1.702.627.715.227 1.367.195 1.881.118.574-.085 1.77-.723 2.02-1.422.25-.698.25-1.296.175-1.422-.075-.125-.273-.2-.572-.348z" fill="#fff"/></svg>
              Consultar por WhatsApp
            </a>
            <Link href="/auditoria" className="cta-btn" style={{ background: '#fff', color: '#1d4ed8', padding: '18px 36px', fontSize: '1.05rem', boxShadow: '0 4px 24px rgba(0,0,0,0.18)' }}>
              Ya tengo cuenta →
            </Link>
          </div>
        </div>
      </section>

      {/* ── FOOTER ── */}
      <footer id="contacto" style={{ background: '#0f172a', padding: '52px 24px 32px' }}>
        <div style={{ maxWidth: '1100px', margin: '0 auto' }}>

          {/* Fila principal */}
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: '40px', marginBottom: '40px' }}>

            {/* Marca */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: '16px', maxWidth: '280px' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                <Image src="/foto-perfil-almacenero-digital.png" alt="" width={36} height={36} style={{ width: '36px', height: '36px', borderRadius: '8px' }} />
                <div style={{ lineHeight: 1.2 }}>
                  <div style={{ fontSize: '0.95rem', fontWeight: 800, color: '#f1f5f9', letterSpacing: '-0.2px' }}>almacenero<span style={{ color: '#60a5fa' }}>.digital</span></div>
                  <div style={{ fontSize: '0.6rem', color: '#475569', letterSpacing: '0.7px', textTransform: 'uppercase' }}>Tu asistente de inventario</div>
                </div>
              </div>
              <p style={{ fontSize: '0.82rem', color: '#475569', lineHeight: 1.7 }}>
                Control de stock e inventario para tiendas, depósitos y distribuidoras de Perú.
              </p>
              <a href="mailto:ctadeo@clarocomunica.com" style={{ color: '#60a5fa', textDecoration: 'none', fontSize: '0.82rem' }}>
                ctadeo@clarocomunica.com
              </a>
            </div>

            {/* Comunidad */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
              <div style={{ fontSize: '0.75rem', fontWeight: 700, color: '#64748b', letterSpacing: '1px', textTransform: 'uppercase' }}>
                Seguinos en redes
              </div>
              <div style={{ display: 'flex', gap: '12px' }}>

                {/* Facebook */}
                <a href="https://facebook.com" target="_blank" rel="noopener noreferrer" aria-label="Facebook"
                  style={{ width: '42px', height: '42px', borderRadius: '10px', background: '#1877f2', display: 'flex', alignItems: 'center', justifyContent: 'center', transition: 'transform 0.15s, opacity 0.15s', opacity: 0.9 }}
                  onMouseOver={e => e.currentTarget.style.transform='translateY(-3px)'}
                  onMouseOut={e => e.currentTarget.style.transform='translateY(0)'}>
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="#fff">
                    <path d="M18 2h-3a5 5 0 0 0-5 5v3H7v4h3v8h4v-8h3l1-4h-4V7a1 1 0 0 1 1-1h3z"/>
                  </svg>
                </a>

                {/* TikTok */}
                <a href="https://tiktok.com" target="_blank" rel="noopener noreferrer" aria-label="TikTok"
                  style={{ width: '42px', height: '42px', borderRadius: '10px', background: '#010101', border: '1px solid #333', display: 'flex', alignItems: 'center', justifyContent: 'center', transition: 'transform 0.15s', opacity: 0.9 }}
                  onMouseOver={e => e.currentTarget.style.transform='translateY(-3px)'}
                  onMouseOut={e => e.currentTarget.style.transform='translateY(0)'}>
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="#fff">
                    <path d="M19.59 6.69a4.83 4.83 0 0 1-3.77-4.25V2h-3.45v13.67a2.89 2.89 0 0 1-2.88 2.5 2.89 2.89 0 0 1-2.89-2.89 2.89 2.89 0 0 1 2.89-2.89c.28 0 .54.04.79.1V9.01a6.33 6.33 0 0 0-.79-.05 6.34 6.34 0 0 0-6.34 6.34 6.34 6.34 0 0 0 6.34 6.34 6.34 6.34 0 0 0 6.33-6.34V8.69a8.18 8.18 0 0 0 4.78 1.52V6.76a4.85 4.85 0 0 1-1.01-.07z"/>
                  </svg>
                </a>

                {/* YouTube */}
                <a href="https://youtube.com" target="_blank" rel="noopener noreferrer" aria-label="YouTube"
                  style={{ width: '42px', height: '42px', borderRadius: '10px', background: '#ff0000', display: 'flex', alignItems: 'center', justifyContent: 'center', transition: 'transform 0.15s', opacity: 0.9 }}
                  onMouseOver={e => e.currentTarget.style.transform='translateY(-3px)'}
                  onMouseOut={e => e.currentTarget.style.transform='translateY(0)'}>
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="#fff">
                    <path d="M22.54 6.42a2.78 2.78 0 0 0-1.95-1.96C18.88 4 12 4 12 4s-6.88 0-8.59.46a2.78 2.78 0 0 0-1.95 1.96A29 29 0 0 0 1 12a29 29 0 0 0 .46 5.58A2.78 2.78 0 0 0 3.41 19.6C5.12 20 12 20 12 20s6.88 0 8.59-.46a2.78 2.78 0 0 0 1.95-1.95A29 29 0 0 0 23 12a29 29 0 0 0-.46-5.58z"/>
                    <polygon points="9.75 15.02 15.5 12 9.75 8.98 9.75 15.02" fill="#ff0000"/>
                  </svg>
                </a>

              </div>
              <p style={{ fontSize: '0.78rem', color: '#334155', lineHeight: 1.6, maxWidth: '200px' }}>
                Sumate a nuestra comunidad y seguí las novedades del sistema.
              </p>
            </div>

          </div>

          {/* Línea divisoria */}
          <div style={{ borderTop: '1px solid #1e293b', paddingTop: '24px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '12px' }}>
            <span style={{ fontSize: '0.78rem', color: '#334155' }}>
              © {new Date().getFullYear()} Almacenero Digital · Claro Comunica
            </span>
            <span style={{ fontSize: '0.78rem', color: '#1e293b' }}>
              Hecho en Perú 🇵🇪
            </span>
          </div>

        </div>
      </footer>

    </div>
  )
}
