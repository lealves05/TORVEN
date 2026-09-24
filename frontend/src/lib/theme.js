export const hexToRgb = (hex) => {
  let h = String(hex || '').replace('#', '');
  if (h.length === 3) h = h.split('').map((c) => c + c).join('');
  const n = parseInt(h || 'ea580c', 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
};

const luminance = ([r, g, b]) => {
  const f = (c) => { c /= 255; return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; };
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
};

export const RADIUS = { none: '4px', md: '10px', lg: '14px', xl: '20px' };
export const FONTS = { Inter: 'Inter', Poppins: 'Poppins', 'DM Sans': 'DM Sans', Nunito: 'Nunito', Sistema: 'system-ui' };
export const PRESET_COLORS = ['#ea580c', '#dc2626', '#d97706', '#ca8a04', '#16a34a', '#0d9488', '#0284c7', '#2563eb', '#4f46e5', '#7c3aed', '#475569', '#18181b'];

/** Aplica cor, raio, fonte, densidade e tema no documento. */
export function applyTheme(settings = {}, prefs = {}) {
  const root = document.documentElement;
  const rgb = hexToRgb(settings.primaryColor);
  root.style.setProperty('--primary', rgb.join(' '));
  root.style.setProperty('--primary-fg', luminance(rgb) > 0.55 ? '24 24 27' : '255 255 255');
  root.style.setProperty('--radius', RADIUS[settings.radius] || RADIUS.lg);
  root.style.setProperty('--font', `'${FONTS[settings.font] || 'Inter'}'`);
  const mode = prefs.theme || settings.theme || 'system';
  const dark = mode === 'dark' || (mode === 'system' && window.matchMedia?.('(prefers-color-scheme: dark)').matches);
  root.classList.toggle('dark', !!dark);
  root.classList.toggle('density-compact', (prefs.density || settings.density) === 'compact');
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', settings.primaryColor || '#ea580c');
}
