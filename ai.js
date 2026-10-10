// All AI features. Each function sends one prompt to Claude and expects JSON back.
const Anthropic = require('@anthropic-ai/sdk');
const { cleanResume } = require('./resume');

const MOCK = process.env.AI_MOCK === 'true';
const MODEL = process.env.ANTHROPIC_MODEL || 'claude-sonnet-5-5';
let client;

const SHAPE = `{"basics":{"name":"","headline":"","email":"","phone":"","location":"",
"links":[{"label":"","url":""}]},"summary":"","experience":[{"company":"","title":"",
"location":"","start":"","end":"","bullets":[""]}],"education":[{"school":"","degree":"",
"start":"","end":"","details":""}],"projects":[{"name":"","link":"","description":"",
"bullets":[""]}],"skills":[""],"certifications":[""]}`;

const RULES = `You are an expert resume writer and career coach.
- Never invent employers, titles, dates, degrees, metrics or skills missing from the input.
- Use strong action verbs and concise bullets. Add numbers only if the input has them.
- Reply with ONLY valid JSON. No prose, no markdown fences.`;

async function askJson(system, user, maxTokens = 4000) {
  if (!process.env.ANTHROPIC_API_KEY) {
    const err = new Error('AI is not set up: add ANTHROPIC_API_KEY to your .env file');
    err.status = 503;
    throw err;
  }
  client = client || new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  const res = await client.messages.create({
    model: MODEL,
    max_tokens: maxTokens,
    system,
    messages: [{ role: 'user', content: user }],
  });
  const text = res.content
    .filter((b) => b.type === 'text')
    .map((b) => b.text)
    .join('');
  const a = text.indexOf('{');
  const z = text.lastIndexOf('}');
  try {
    return JSON.parse(text.slice(a, z + 1));
  } catch {
    const err = new Error('The AI sent an unreadable answer. Please try again.');
    err.status = 502;
    throw err;
  }
}

const MOCK_RESUME = cleanResume({
  basics: { name: 'Jane Doe', headline: 'Software Engineer', email: 'jane@example.com' },
  summary: 'Sample summary (AI_MOCK mode).',
  experience: [
    { company: 'Acme', title: 'Engineer', start: '2022', end: 'Now', bullets: ['Built things.'] },
  ],
  skills: ['JavaScript', 'Node.js'],
});

exports.generate = async (profile, role) => {
  if (MOCK) return MOCK_RESUME;
  const out = await askJson(
    `${RULES}\nReturn a resume as JSON with exactly this shape:\n${SHAPE}`,
    `Target role: ${role || 'not specified'}\n\nCandidate background:\n${profile}`,
  );
  return cleanResume(out);
};

exports.improve = async (section, content, instruction) => {
  if (MOCK) return { section, content };
  const out = await askJson(
    `${RULES}\nImprove the given resume section and keep the same structure. Reply {"content": ...}`,
    `Section: ${section}\nInstruction: ${instruction || 'make it more impactful'}\n` +
      JSON.stringify(content),
  );
  return { section, content: out.content };
};

exports.tailor = async (resume, jobDescription) => {
  if (MOCK) return { resume, changes: ['Mock mode: nothing changed'] };
  const out = await askJson(
    `${RULES}\nTailor the resume to the job: reorder and reword existing content, use the job's ` +
      `keywords ONLY where the candidate truly has that experience. ` +
      `Reply {"resume": <same shape>, "changes": ["short note per change"]}.\nShape: ${SHAPE}`,
    `Job description:\n${jobDescription}\n\nResume:\n${JSON.stringify(resume)}`,
    6000,
  );
  return { resume: cleanResume(out.resume), changes: out.changes || [] };
};

exports.atsScore = async (resume, jobDescription) => {
  if (MOCK) return { score: 80, matchedKeywords: [], missingKeywords: [], suggestions: [] };
  return askJson(
    `${RULES}\nRate ATS-friendliness${jobDescription ? ' and fit to the job' : ''}. Reply ` +
      `{"score": 0-100, "matchedKeywords": [""], "missingKeywords": [""], "suggestions": [""]}`,
    (jobDescription ? `Job description:\n${jobDescription}\n\n` : '') +
      `Resume:\n${JSON.stringify(resume)}`,
    2000,
  );
};

exports.coverLetter = async (resume, jobDescription, tone) => {
  if (MOCK) return { coverLetter: 'Sample cover letter (AI_MOCK mode).' };
  return askJson(
    `${RULES}\nWrite a cover letter under 350 words in a ${tone} tone using only facts from the ` +
      `resume. Reply {"coverLetter": "text with \\n\\n between paragraphs"}`,
    `Job description:\n${jobDescription}\n\nResume:\n${JSON.stringify(resume)}`,
    2000,
  );
};
