/* Resume AI front end: plain JavaScript, no build step. Served by the Express backend. */
const API = '/api';
const state = {
  token: localStorage.getItem('token'),
  user: null,
  resumes: [],
  current: null, // { id|null, title, data }
  tab: 'create',
  template: 'modern',
  authMode: 'login',
};

const emptyResume = () => ({
  basics: { name: '', headline: '', email: '', phone: '', location: '', links: [] },
  summary: '',
  experience: [],
  education: [],
  projects: [],
  skills: [],
  certifications: [],
});

/* ---------- helpers ---------- */
function h(tag, attrs = {}, ...kids) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k.startsWith('aria-') && v != null) {
      el.setAttribute(k, String(v));
      continue;
    }
    if (v === false || v == null) continue;
    if (k === 'class') el.className = v;
    else if (k === 'value') el.value = v;
    else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else el.setAttribute(k, v === true ? '' : v);
  }
  for (const kid of kids.flat()) {
    if (kid == null || kid === false) continue;
    el.append(kid.nodeType ? kid : document.createTextNode(kid));
  }
  return el;
}

let toastTimer;
function toast(msg) {
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('show'), 2600);
}

async function api(path, { method = 'GET', body } = {}) {
  const res = await fetch(API + path, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(state.token && { Authorization: `Bearer ${state.token}` }),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (res.status === 204) return null;
  const json = await res.json().catch(() => ({}));
  if (res.status === 401 && state.token) {
    logout();
    throw new Error('Your session expired. Log in again.');
  }
  if (!res.ok) {
    const detail = json.details
      ? ': ' + json.details.map((d) => `${d.path} ${d.message}`).join(', ')
      : '';
    throw new Error((json.error || 'Request failed') + detail);
  }
  return json;
}

// Runs an async action on a button: disables it, shows progress, reports errors.
async function withBusy(btn, label, fn) {
  const original = btn.textContent;
  btn.disabled = true;
  btn.textContent = label;
  try {
    return await fn();
  } catch (e) {
    toast(e.message);
  } finally {
    btn.disabled = false;
    btn.textContent = original;
  }
}

const normalize = (d) => ({
  ...emptyResume(),
  ...d,
  basics: { ...emptyResume().basics, ...(d.basics || {}) },
});
const clean = (d) => ({
  ...d,
  experience: d.experience.map((e) => ({
    ...e,
    bullets: (e.bullets || []).filter((b) => b.trim()),
  })),
  projects: d.projects.map((p) => ({ ...p, bullets: (p.bullets || []).filter((b) => b.trim()) })),
});

/* ---------- auth ---------- */
function logout() {
  localStorage.removeItem('token');
  Object.assign(state, { token: null, user: null, resumes: [], current: null });
  render();
}

function renderAuth() {
  const reg = state.authMode === 'register';
  const err = h('div', { class: 'err' });
  const name = h('input', { id: 'name', autocomplete: 'name' });
  const email = h('input', { id: 'email', type: 'email', autocomplete: 'email' });
  const pass = h('input', {
    id: 'pass',
    type: 'password',
    autocomplete: reg ? 'new-password' : 'current-password',
  });
  const submit = h(
    'button',
    { class: 'btn primary', type: 'submit' },
    reg ? 'Create account' : 'Log in',
  );
  const form = h(
    'form',
    {
      onsubmit: async (e) => {
        e.preventDefault();
        err.textContent = '';
        submit.disabled = true;
        try {
          const body = reg
            ? { name: name.value, email: email.value, password: pass.value }
            : { email: email.value, password: pass.value };
          const out = await api(reg ? '/auth/register' : '/auth/login', { method: 'POST', body });
          state.token = out.token;
          state.user = out.user;
          localStorage.setItem('token', out.token);
          await boot();
        } catch (ex) {
          err.textContent = ex.message;
          submit.disabled = false;
        }
      },
    },
    reg && [h('label', { for: 'name' }, 'Your name'), name],
    h('label', { for: 'email' }, 'Email'),
    email,
    h('label', { for: 'pass' }, reg ? 'Password (8+ characters)' : 'Password'),
    pass,
    err,
    h(
      'div',
      { class: 'actions' },
      submit,
      h(
        'button',
        {
          type: 'button',
          class: 'link',
          onclick: () => {
            state.authMode = reg ? 'login' : 'register';
            render();
          },
        },
        reg ? 'I already have an account' : 'Create an account',
      ),
    ),
  );
  return h(
    'div',
    { class: 'auth-wrap' },
    h(
      'div',
      { class: 'auth' },
      h('h1', {}, reg ? 'Create your account' : 'Welcome back'),
      h(
        'p',
        {},
        'Describe your experience in plain words and get a formatted resume ' +
          'you can edit, tailor to a job, and print.',
      ),
      form,
    ),
  );
}

/* ---------- data ---------- */
async function loadResumes() {
  state.resumes = (await api('/resumes')).resumes;
}

async function openResume(id) {
  const { resume } = await api(`/resumes/${id}`);
  state.current = { id: resume.id, title: resume.title, data: normalize(resume.data) };
  if (state.tab === 'create') state.tab = 'edit';
  render();
}

function newBlank() {
  state.current = { id: null, title: 'Untitled resume', data: emptyResume() };
  state.tab = 'edit';
  render();
}

async function saveCurrent() {
  const c = state.current;
  const payload = { title: c.title || 'Untitled resume', data: clean(c.data) };
  const out = c.id
    ? await api(`/resumes/${c.id}`, { method: 'PUT', body: payload })
    : await api('/resumes', { method: 'POST', body: payload });
  c.id = out.resume.id;
  await loadResumes();
  toast('Resume saved');
  renderSide();
}

/* ---------- preview ---------- */
let previewTimer,
  previewSeq = 0;
function schedulePreview(immediate) {
  clearTimeout(previewTimer);
  previewTimer = setTimeout(updatePreview, immediate ? 0 : 350);
}
async function updatePreview() {
  const frame = document.getElementById('pframe');
  if (!frame || !state.current) return;
  const seq = ++previewSeq;
  try {
    const { html } = await api('/resumes/preview', {
      method: 'POST',
      body: { data: clean(state.current.data), template: state.template },
    });
    if (seq === previewSeq) frame.srcdoc = html;
  } catch (e) {
    /* ignore transient preview errors */
  }
}

function renderPreview() {
  const sel = h(
    'select',
    {
      'aria-label': 'Template',
      onchange: (e) => {
        state.template = e.target.value;
        schedulePreview(true);
      },
    },
    ['modern', 'classic', 'minimal'].map((t) =>
      h('option', { value: t, selected: t === state.template }, t[0].toUpperCase() + t.slice(1)),
    ),
  );
  const frame = h('iframe', {
    id: 'pframe',
    title: 'Resume preview',
    sandbox: 'allow-modals allow-same-origin',
  });
  const print = h(
    'button',
    {
      class: 'btn primary',
      onclick: () => {
        frame.contentWindow.focus();
        frame.contentWindow.print();
      },
    },
    'Print or save as PDF',
  );
  return h(
    'section',
    { class: 'preview', 'aria-label': 'Preview' },
    h('div', { class: 'pbar' }, sel, print),
    h(
      'div',
      { class: 'paper' },
      state.current
        ? frame
        : h(
            'div',
            { class: 'ph' },
            'Your resume will appear here as soon as you create or open one.',
          ),
    ),
  );
}

/* ---------- sidebar ---------- */
function renderSide() {
  const old = document.getElementById('side');
  const el = h(
    'aside',
    { class: 'side', id: 'side' },
    h(
      'button',
      {
        class: 'btn primary',
        style: 'width:100%',
        onclick: () => {
          state.tab = 'create';
          state.current = null;
          render();
        },
      },
      'New from my background',
    ),
    h(
      'button',
      { class: 'btn', style: 'width:100%;margin-top:8px', onclick: newBlank },
      'Start blank',
    ),
    h('h2', {}, 'Your resumes'),
    state.resumes.length
      ? h(
          'ul',
          { class: 'rlist' },
          state.resumes.map((r) =>
            h(
              'li',
              {},
              h(
                'button',
                {
                  'aria-current': state.current && state.current.id === r.id,
                  onclick: () => openResume(r.id),
                },
                r.title,
                h('small', {}, new Date(r.updatedAt.replace(' ', 'T') + 'Z').toLocaleDateString()),
              ),
            ),
          ),
        )
      : h('div', { class: 'empty' }, 'Nothing saved yet.'),
  );
  if (old) old.replaceWith(el);
  return el;
}

/* ---------- tabs ---------- */
function renderTabs() {
  const defs = [
    ['create', 'Create'],
    ['edit', 'Edit'],
    ['tailor', 'Tailor and check'],
  ];
  return h(
    'div',
    { class: 'tabs', role: 'tablist' },
    defs.map(([id, label]) =>
      h(
        'button',
        {
          role: 'tab',
          'aria-selected': state.tab === id,
          onclick: () => {
            state.tab = id;
            render();
          },
        },
        label,
      ),
    ),
  );
}

const needResume = () =>
  h('p', { class: 'hint', style: 'margin-top:22px' }, 'Create or open a resume first.');

/* Create: free text -> structured resume */
function tabCreate() {
  const profile = h('textarea', {
    rows: 10,
    placeholder:
      'Example: I am a final-year computer science student at XYZ University. ' +
        'I interned at ABC for 3 months building a React dashboard used by 200 staff. ' +
        'I know Node.js, Express, MongoDB and Python. My project: a chat app with 500 users...',
  });
  const role = h('input', { placeholder: 'e.g. Junior backend developer' });
  const btn = h(
    'button',
    {
      class: 'btn primary',
      onclick: () =>
        withBusy(btn, 'Writing your resume...', async () => {
          if (profile.value.trim().length < 20)
            return toast('Write at least a couple of sentences about yourself.');
          const out = await api('/ai/generate', {
            method: 'POST',
            body: {
              profile: profile.value,
              targetRole: role.value || undefined,
              save: true,
              title: role.value || 'AI resume',
            },
          });
          await loadResumes();
          state.tab = 'edit';
          await openResume(out.resumeId);
          toast('Resume created. Review and edit it.');
        }),
    },
    'Create my resume',
  );
  return h(
    'div',
    {},
    h('h3', {}, 'Tell us about yourself'),
    h(
      'p',
      { class: 'hint' },
      'Include jobs, education, projects, skills and any numbers you can share. ' +
          'Nothing is invented: the AI only uses what you write.',
    ),
    h('label', {}, 'Your background'),
    profile,
    h('label', {}, 'Role you are aiming for (optional)'),
    role,
    h('div', { class: 'actions' }, btn),
  );
}

/* Edit: structured form */
function field(label, get, set, { area, rows, placeholder } = {}) {
  const el = h(area ? 'textarea' : 'input', {
    value: get(),
    rows,
    placeholder,
    oninput: (e) => {
      set(e.target.value);
      schedulePreview();
    },
  });
  return h('div', {}, h('label', {}, label), el);
}

function listEditor(title, key, fields, makeItem) {
  const wrap = h('div', {});
  const draw = () => {
    wrap.replaceChildren(
      ...state.current.data[key].map((item, i) =>
        h(
          'div',
          { class: 'card' },
          h(
            'div',
            { class: 'card-head' },
            h('strong', {}, `${title} ${i + 1}`),
            h(
              'button',
              {
                class: 'btn small danger',
                onclick: () => {
                  state.current.data[key].splice(i, 1);
                  draw();
                  schedulePreview(true);
                },
              },
              'Remove',
            ),
          ),
          h(
            'div',
            { class: 'row2' },
            fields
              .filter((f) => !f.wide)
              .map((f) =>
                field(
                  f.label,
                  () => item[f.key] || '',
                  (v) => (item[f.key] = v),
                ),
              ),
          ),
          fields
            .filter((f) => f.wide)
            .map((f) =>
              f.lines
                ? field(
                    f.label,
                    () => (item[f.key] || []).join('\n'),
                    (v) => (item[f.key] = v.split('\n')),
                    { area: true, rows: 4, placeholder: 'One point per line' },
                  )
                : field(
                    f.label,
                    () => item[f.key] || '',
                    (v) => (item[f.key] = v),
                    { area: true, rows: 3 },
                  ),
            ),
        ),
      ),
      h(
        'button',
        {
          class: 'btn small',
          onclick: () => {
            state.current.data[key].push(makeItem());
            draw();
          },
        },
        `Add ${title.toLowerCase()}`,
      ),
    );
  };
  draw();
  return h('div', {}, h('h3', {}, title + 's'), wrap);
}

function tabEdit() {
  if (!state.current) return needResume();
  const c = state.current,
    d = c.data,
    b = d.basics;
  const saveBtn = h(
    'button',
    { class: 'btn primary', onclick: () => withBusy(saveBtn, 'Saving...', saveCurrent) },
    'Save changes',
  );
  const del = h(
    'button',
    {
      class: 'btn danger',
      onclick: async () => {
        if (!c.id || !confirm('Delete this resume? This cannot be undone.')) return;
        await api(`/resumes/${c.id}`, { method: 'DELETE' });
        state.current = null;
        state.tab = 'create';
        await loadResumes();
        render();
        toast('Resume deleted');
      },
    },
    'Delete',
  );
  return h(
    'div',
    {},
    h('h3', {}, 'Details'),
    field(
      'Resume name (only you see this)',
      () => c.title,
      (v) => (c.title = v),
    ),
    h(
      'div',
      { class: 'row2' },
      field(
        'Full name',
        () => b.name,
        (v) => (b.name = v),
      ),
      field(
        'Headline',
        () => b.headline,
        (v) => (b.headline = v),
        { placeholder: 'e.g. Full-stack developer' },
      ),
      field(
        'Email',
        () => b.email,
        (v) => (b.email = v),
      ),
      field(
        'Phone',
        () => b.phone,
        (v) => (b.phone = v),
      ),
      field(
        'Location',
        () => b.location,
        (v) => (b.location = v),
      ),
    ),
    h('h3', {}, 'Summary'),
    field(
      'Two or three sentences',
      () => d.summary,
      (v) => (d.summary = v),
      { area: true, rows: 4 },
    ),
    listEditor(
      'Experience',
      'experience',
      [
        { key: 'title', label: 'Job title' },
        { key: 'company', label: 'Company' },
        { key: 'start', label: 'Start' },
        { key: 'end', label: 'End' },
        { key: 'bullets', label: 'What you did', wide: true, lines: true },
      ],
      () => ({ title: '', company: '', location: '', start: '', end: '', bullets: [] }),
    ),
    listEditor(
      'Project',
      'projects',
      [
        { key: 'name', label: 'Name' },
        { key: 'link', label: 'Link (https://...)' },
        { key: 'description', label: 'Short description', wide: true },
        { key: 'bullets', label: 'Highlights', wide: true, lines: true },
      ],
      () => ({ name: '', link: '', description: '', bullets: [] }),
    ),
    listEditor(
      'Education',
      'education',
      [
        { key: 'degree', label: 'Degree' },
        { key: 'school', label: 'School' },
        { key: 'start', label: 'Start' },
        { key: 'end', label: 'End' },
        { key: 'details', label: 'Details', wide: true },
      ],
      () => ({ school: '', degree: '', start: '', end: '', details: '' }),
    ),
    h('h3', {}, 'Skills'),
    field(
      'Separate with commas',
      () => d.skills.join(', '),
      (v) =>
        (d.skills = v
          .split(',')
          .map((s) => s.trim())
          .filter(Boolean)),
      { area: true, rows: 2 },
    ),
    h('div', { class: 'actions' }, saveBtn, c.id && del),
  );
}

/* Tailor + ATS + cover letter */
function tabTailor() {
  if (!state.current) return needResume();
  const jd = h('textarea', { rows: 8, placeholder: 'Paste the job description here' });
  const out = h('div', { class: 'result' });
  const needJd = () => {
    if (jd.value.trim().length < 30) {
      toast('Paste the full job description first.');
      return false;
    }
    return true;
  };
  const needSaved = () => {
    if (!state.current.id) {
      toast('Save the resume first (Edit tab).');
      return false;
    }
    return true;
  };

  const score = h(
    'button',
    {
      class: 'btn',
      onclick: () =>
        needSaved() &&
        withBusy(score, 'Checking...', async () => {
          const r = await api('/ai/ats-score', {
            method: 'POST',
            body: { resumeId: state.current.id, jobDescription: jd.value.trim() || undefined },
          });
          out.replaceChildren(
            h('h3', {}, 'ATS check'),
            h('div', { class: 'score' }, String(r.score ?? '?')),
            r.matchedKeywords?.length
              ? [
                  h('p', { class: 'hint' }, 'Keywords you already match'),
                  h(
                    'div',
                    { class: 'chips' },
                    r.matchedKeywords.map((k) => h('span', { class: 'chip' }, k)),
                  ),
                ]
              : null,
            r.missingKeywords?.length
              ? [
                  h('p', { class: 'hint' }, 'Missing keywords (add only if true for you)'),
                  h(
                    'div',
                    { class: 'chips' },
                    r.missingKeywords.map((k) => h('span', { class: 'chip miss' }, k)),
                  ),
                ]
              : null,
            r.suggestions?.length
              ? [
                  h('p', { class: 'hint' }, 'Suggestions'),
                  h(
                    'ul',
                    {},
                    r.suggestions.map((s) => h('li', {}, s)),
                  ),
                ]
              : null,
          );
        }),
    },
    'Check ATS score',
  );

  const tailor = h(
    'button',
    {
      class: 'btn primary',
      onclick: () =>
        needSaved() &&
        needJd() &&
        withBusy(tailor, 'Tailoring...', async () => {
          const r = await api('/ai/tailor', {
            method: 'POST',
            body: { resumeId: state.current.id, jobDescription: jd.value, save: true },
          });
          await loadResumes();
          out.replaceChildren(
            h('h3', {}, 'Tailored copy saved'),
            h('p', { class: 'hint' }, 'Your original is unchanged. What changed:'),
            h(
              'ul',
              {},
              (r.changes || []).map((c) => h('li', {}, c)),
            ),
          );
          state.tab = 'tailor';
          const { resume } = await api(`/resumes/${r.resumeId}`);
          state.current = { id: resume.id, title: resume.title, data: normalize(resume.data) };
          renderSide();
          schedulePreview(true);
          toast('Showing the tailored copy');
        }),
    },
    'Tailor my resume to this job',
  );

  const tone = h(
    'select',
    {},
    ['professional', 'friendly', 'confident'].map((t) =>
      h('option', { value: t }, t[0].toUpperCase() + t.slice(1)),
    ),
  );
  const cover = h(
    'button',
    {
      class: 'btn',
      onclick: () =>
        needSaved() &&
        needJd() &&
        withBusy(cover, 'Writing...', async () => {
          const r = await api('/ai/cover-letter', {
            method: 'POST',
            body: { resumeId: state.current.id, jobDescription: jd.value, tone: tone.value },
          });
          const copy = h(
            'button',
            {
              class: 'btn small',
              onclick: () =>
                navigator.clipboard.writeText(r.coverLetter).then(() => toast('Copied')),
            },
            'Copy',
          );
          out.replaceChildren(
            h('h3', {}, 'Cover letter'),
            h('pre', { class: 'letter' }, r.coverLetter),
            copy,
          );
        }),
    },
    'Write a cover letter',
  );

  return h(
    'div',
    {},
    h('h3', {}, 'Match a job'),
    h(
      'p',
      { class: 'hint' },
      'Paste a job description to tailor your resume, check keyword fit, or draft a cover letter. ' +
          'Works on the saved version of your resume.',
    ),
    jd,
    h('div', { class: 'actions' }, tailor, score),
    h(
      'div',
      { class: 'actions' },
      cover,
      h('span', { class: 'status' }, 'Tone'),
      h('div', { style: 'width:150px' }, tone),
    ),
    out,
  );
}

/* ---------- shell ---------- */
function renderWorkspace() {
  const tabs = { create: tabCreate, edit: tabEdit, tailor: tabTailor };
  const work = h('main', { class: 'work', id: 'work' }, renderTabs(), tabs[state.tab]());
  return h('div', { class: 'ws' }, renderSide(), work, renderPreview());
}

function render() {
  const app = document.getElementById('app');
  const bar = h(
    'header',
    { class: 'top' },
    h('div', { class: 'brand' }, 'Resume AI'),
    state.user &&
      h(
        'div',
        { class: 'who' },
        state.user.name,
        h('button', { class: 'btn small', onclick: logout }, 'Log out'),
      ),
  );
  app.replaceChildren(bar, state.token && state.user ? renderWorkspace() : renderAuth());
  if (state.current) schedulePreview(true);
}

async function boot() {
  if (state.token) {
    try {
      state.user = (await api('/auth/me')).user;
      await loadResumes();
    } catch {
      state.token = null;
      localStorage.removeItem('token');
    }
  }
  render();
}
boot();
