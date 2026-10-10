// Resume shape cleaning + the printable HTML template.
const s = (v, n = 2000) => (typeof v === 'string' ? v.slice(0, n) : '');
const list = (v, n) => (Array.isArray(v) ? v.slice(0, n) : []);
const lines = (v) =>
  list(v, 20)
    .map((x) => s(x, 1000))
    .filter((x) => x.trim());

// Forces any input into the exact resume shape (also protects against bad AI output).
function cleanResume(d) {
  d = d || {};
  const b = d.basics || {};
  return {
    basics: {
      name: s(b.name, 200),
      headline: s(b.headline, 200),
      email: s(b.email, 200),
      phone: s(b.phone, 100),
      location: s(b.location, 200),
      links: list(b.links, 10).map((l) => ({
        label: s(l && l.label, 100),
        url: s(l && l.url, 500),
      })),
    },
    summary: s(d.summary, 4000),
    experience: list(d.experience, 30).map((e) => ({
      company: s(e && e.company),
      title: s(e && e.title),
      location: s(e && e.location),
      start: s(e && e.start, 50),
      end: s(e && e.end, 50),
      bullets: lines(e && e.bullets),
    })),
    education: list(d.education, 10).map((e) => ({
      school: s(e && e.school),
      degree: s(e && e.degree),
      start: s(e && e.start, 50),
      end: s(e && e.end, 50),
      details: s(e && e.details),
    })),
    projects: list(d.projects, 20).map((p) => ({
      name: s(p && p.name),
      link: s(p && p.link, 500),
      description: s(p && p.description),
      bullets: lines(p && p.bullets),
    })),
    skills: list(d.skills, 60)
      .map((x) => s(x, 100))
      .filter(Boolean),
    certifications: list(d.certifications, 20)
      .map((x) => s(x, 300))
      .filter(Boolean),
  };
}

const esc = (t) =>
  String(t || '').replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c],
  );
const url = (u) => (/^https?:\/\//i.test(u || '') ? esc(u) : '#');

const THEMES = {
  modern: { font: "'Helvetica Neue', Arial, sans-serif", accent: '#1d4ed8' },
  classic: { font: "Georgia, 'Times New Roman', serif", accent: '#111827' },
  minimal: { font: 'Arial, sans-serif', accent: '#374151' },
};

function renderHtml(d, template) {
  const t = THEMES[template] || THEMES.modern;
  const b = d.basics;
  const bullets = (a) =>
    a.length ? `<ul>${a.map((x) => `<li>${esc(x)}</li>`).join('')}</ul>` : '';
  const dates = (x) => esc([x.start, x.end].filter(Boolean).join(' - '));
  const section = (title, body) => (body ? `<section><h2>${title}</h2>${body}</section>` : '');

  const contact = [b.email, b.phone, b.location].filter(Boolean).map(esc).join(' | ');
  const links = b.links
    .map((l) => `<a href="${url(l.url)}">${esc(l.label || l.url)}</a>`)
    .join(' | ');

  const exp = d.experience
    .map(
      (e) => `<div class="item"><div class="row">
    <strong>${esc(e.title)}${e.company ? ', ' + esc(e.company) : ''}</strong>
    <span>${dates(e)}</span></div>
    ${bullets(e.bullets)}</div>`,
    )
    .join('');
  const proj = d.projects
    .map(
      (p) => `<div class="item"><strong>${
        p.link ? `<a href="${url(p.link)}">${esc(p.name)}</a>` : esc(p.name)
      }</strong>
    ${p.description ? `<div>${esc(p.description)}</div>` : ''}${bullets(p.bullets)}</div>`,
    )
    .join('');
  const edu = d.education
    .map(
      (e) => `<div class="item"><div class="row">
    <strong>${esc(e.degree)}${e.school ? ', ' + esc(e.school) : ''}</strong><span>${dates(e)}</span></div>
    ${e.details ? `<div>${esc(e.details)}</div>` : ''}</div>`,
    )
    .join('');

  return `<!doctype html><html><head><meta charset="utf-8"><title>${esc(b.name || 'Resume')}</title>
<style>
  body{font-family:${t.font};color:#111;max-width:800px;margin:32px auto;padding:0 24px;
     line-height:1.45;font-size:14px}
  h1{margin:0;font-size:28px;color:${t.accent}} .headline{font-size:16px;color:#444}
  h2{font-size:13px;letter-spacing:.08em;text-transform:uppercase;color:${t.accent};
     border-bottom:1px solid #ddd;padding-bottom:3px;margin:22px 0 8px}
  .row{display:flex;justify-content:space-between;gap:12px} .muted{color:#666}
  ul{margin:4px 0 8px 18px;padding:0} .item{margin-bottom:10px} a{color:${t.accent}}
  @media print{body{margin:0}}
</style></head><body>
<header><h1>${esc(b.name)}</h1>${b.headline ? `<div class="headline">${esc(b.headline)}</div>` : ''}
<div class="muted">${contact}</div>${links ? `<div>${links}</div>` : ''}</header>
${section('Summary', d.summary ? `<p>${esc(d.summary)}</p>` : '')}
${section('Experience', exp)}${section('Projects', proj)}${section('Education', edu)}
${section('Skills', d.skills.length ? `<p>${d.skills.map(esc).join(' | ')}</p>` : '')}
${section('Certifications', bullets(d.certifications))}
</body></html>`;
}

module.exports = { cleanResume, renderHtml, THEMES };
