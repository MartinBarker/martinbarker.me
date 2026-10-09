// Small presentational pieces shared by the Trawl results page and its
// playlist picker / push-progress panels. `t` is the page's theme object.

export function Card({ t, children }) {
  return (
    <section style={{
      padding: 18, background: t.card, border: `1px solid ${t.border}`,
      borderRadius: 10, margin: '16px 0',
    }}>
      {children}
    </section>
  );
}

export function SectionTitle({ t, children }) {
  return <h2 style={{ fontSize: 16, margin: '0 0 14px', color: t.text }}>{children}</h2>;
}

export function Field({ t, label, hint, children, style }) {
  return (
    <label style={{ display: 'flex', flexDirection: 'column', gap: 4, ...style }}>
      <span style={{ fontSize: 13, fontWeight: 600 }}>{label}</span>
      {children}
      {hint && <span style={{ fontSize: 12, color: t.sub }}>{hint}</span>}
    </label>
  );
}

export function Radio({ t, name, checked, onChange, label }) {
  return (
    <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer' }}>
      <input type="radio" name={name} checked={checked} onChange={onChange} />
      <span style={{ color: t.text, fontWeight: checked ? 600 : 400 }}>{label}</span>
    </label>
  );
}

export function Banner({ t, tone, children, compact }) {
  // Translucent fills so one set of tones reads correctly on both themes.
  const tones = {
    ok:    { fg: t.ok,   bg: 'rgba(22,163,74,.10)', bd: 'rgba(22,163,74,.35)' },
    warn:  { fg: t.warn, bg: 'rgba(217,119,6,.10)', bd: 'rgba(217,119,6,.35)' },
    bad:   { fg: t.bad,  bg: 'rgba(197,48,48,.10)', bd: 'rgba(197,48,48,.35)' },
    plain: { fg: t.text, bg: 'transparent',         bd: t.border },
  };
  const c = tones[tone] || tones.plain;
  return (
    <div style={{
      marginTop: compact ? 0 : 14, padding: compact ? '8px 12px' : '10px 14px',
      borderRadius: 8, background: c.bg, border: `1px solid ${c.bd}`,
      color: c.fg, fontSize: 14,
    }}>
      {children}
    </div>
  );
}

export function inputStyle(t, extra = {}) {
  return {
    width: '100%', padding: '8px 10px', fontSize: 14,
    background: t.input, color: t.text,
    border: `1px solid ${t.border}`, borderRadius: 6,
    ...extra,
  };
}

export function pagerStyle(t, disabled) {
  return {
    padding: '5px 10px', fontSize: 13, fontWeight: 600,
    background: 'transparent', color: disabled ? t.border : t.text,
    border: `1px solid ${t.border}`, borderRadius: 6,
    cursor: disabled ? 'not-allowed' : 'pointer',
  };
}

export function btnStyle(bg, disabled = false, color = '#fff', border) {
  return {
    padding: '10px 18px', fontSize: 14, fontWeight: 700,
    background: disabled ? '#6c757d' : bg, color: disabled ? '#fff' : color,
    border: border ? `1px solid ${border}` : 'none', borderRadius: 8,
    cursor: disabled ? 'not-allowed' : 'pointer',
  };
}
