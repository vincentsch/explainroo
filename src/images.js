// Optional illustrations through OpenRouter. Needs OPENROUTER_API_KEY in the
// environment or in a .env file in the project folder or the explainroo
// folder. Every request is logged with its cost in build/images/usage.jsonl.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { findEnv } from './env.js';
import { ProjectError } from './project.js';

export const IMAGE_MODELS = {
  best: 'openai/gpt-5.4-image-2',
  cheap: 'google/gemini-3.1-flash-image',
};

const ASPECTS = ['16:9', '9:16', '1:1', '4:3', '3:4', '3:2', '2:3'];

export const DEFAULT_STYLE =
  'Flat illustration for a friendly how-to video, soft colors, simple shapes, clear subject in the middle, plain light background, no text, no letters, no numbers, no logos, no watermark.';

export function findKey(projectDir) {
  return findEnv('OPENROUTER_API_KEY', projectDir);
}

export function resolveModel(name) {
  if (!name) return IMAGE_MODELS.best;
  if (IMAGE_MODELS[name]) return IMAGE_MODELS[name];
  if (/^[\w.-]+\/[\w.:-]+$/.test(name)) return name;
  throw new ProjectError(`image model must be "best", "cheap" or an OpenRouter model id like ${IMAGE_MODELS.best}`);
}

function toDataUrl(file) {
  const ext = path.extname(file).toLowerCase().slice(1);
  const mime = ext === 'jpg' || ext === 'jpeg' ? 'image/jpeg' : ext === 'webp' ? 'image/webp' : 'image/png';
  return `data:${mime};base64,${fs.readFileSync(file).toString('base64')}`;
}

// Generates one image and saves it as assets/<name>.<ext>.
export async function generateImage(project, { name, prompt, model, aspect, refs = [], style, log = () => {} }) {
  if (!name || !/^[\w-]+$/.test(name)) throw new ProjectError('the image name may only use letters, digits, "-" and "_" (it becomes assets/<name>.png)');
  if (!prompt || prompt.trim().length < 8) throw new ProjectError('describe the image in a sentence or two');
  const key = findKey(project.dir);
  if (!key) {
    throw new ProjectError('images need an OpenRouter API key. Ask the user for one (openrouter.ai/keys), then set OPENROUTER_API_KEY or put OPENROUTER_API_KEY=... in a .env file in the explainroo folder.');
  }
  const cfg = project.config.images || {};
  const modelId = resolveModel(model || cfg.model);
  const ratio = aspect || (project.config.height > project.config.width ? '9:16' : project.config.height === project.config.width ? '1:1' : '16:9');
  if (!ASPECTS.includes(ratio)) throw new ProjectError(`aspect must be one of ${ASPECTS.join(', ')}`);
  const styleText = style === false ? '' : (style || cfg.style || DEFAULT_STYLE);
  const text = `${prompt.trim()}\n\nStyle: ${styleText}\nAspect ratio: ${ratio}.`.trim();
  const content = [{ type: 'text', text }];
  for (const r of refs) {
    // Accept paths relative to the project (assets/a.png) or to the current folder.
    const file = [path.resolve(project.dir, r), path.resolve(r)].find((f) => fs.existsSync(f));
    if (!file) throw new ProjectError(`reference image ${r} does not exist (use a path like assets/${path.basename(r)})`);
    content.push({ type: 'image_url', image_url: { url: toDataUrl(file) } });
  }
  const body = {
    model: modelId,
    messages: [{ role: 'user', content }],
    modalities: ['image', 'text'],
    image_config: { aspect_ratio: ratio },
    usage: { include: true },
  };
  const t0 = Date.now();
  let res;
  let json;
  for (let attempt = 1; attempt <= 2; attempt++) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 300000);
    try {
      res = await fetch('https://openrouter.ai/api/v1/chat/completions', {
        method: 'POST',
        signal: ctrl.signal,
        headers: {
          Authorization: `Bearer ${key}`,
          'Content-Type': 'application/json',
          'HTTP-Referer': 'https://explainroo.com',
          'X-Title': 'explainroo',
        },
        body: JSON.stringify(body),
      });
      json = await res.json().catch(() => null);
    } catch (e) {
      if (attempt === 2) throw new Error(`OpenRouter request failed: ${e.name === 'AbortError' ? 'no answer after 5 minutes' : e.message}`);
      log('OpenRouter did not answer, trying once more');
      continue;
    } finally {
      clearTimeout(timer);
    }
    if (res.status >= 500 && attempt === 1) {
      log(`OpenRouter returned ${res.status}, trying once more`);
      continue;
    }
    break;
  }
  if (!res.ok) {
    const msg = json?.error?.message || `HTTP ${res.status}`;
    if (res.status === 401) throw new ProjectError(`OpenRouter rejected the API key (${msg}). Ask the user to check it.`);
    if (res.status === 402) throw new ProjectError(`the OpenRouter account has no credit left (${msg}).`);
    throw new Error(`OpenRouter error: ${msg}`);
  }
  const msg = json?.choices?.[0]?.message;
  const url = msg?.images?.[0]?.image_url?.url;
  if (!url || !url.startsWith('data:')) {
    const said = typeof msg?.content === 'string' ? msg.content.slice(0, 300) : '';
    throw new Error(`the model returned no image${said ? `. It said: "${said}"` : ''}. Try another wording or the other model.`);
  }
  const [, mime, b64] = /^data:([^;]+);base64,(.*)$/s.exec(url) || [];
  const ext = mime === 'image/jpeg' ? 'jpg' : mime === 'image/webp' ? 'webp' : 'png';
  const assets = path.join(project.dir, 'assets');
  fs.mkdirSync(assets, { recursive: true });
  for (const e of ['png', 'jpg', 'webp']) fs.rmSync(path.join(assets, `${name}.${e}`), { force: true });
  const file = path.join(assets, `${name}.${ext}`);
  const buf = Buffer.from(b64, 'base64');
  fs.writeFileSync(file, buf);

  const usage = json.usage || {};
  const entry = {
    time: new Date().toISOString(),
    name,
    file: path.relative(project.dir, file),
    provider: 'openrouter',
    model: modelId,
    served_by: json.model || modelId,
    aspect: ratio,
    prompt: prompt.trim(),
    style: styleText,
    refs,
    cost_usd: typeof usage.cost === 'number' ? usage.cost : null,
    prompt_tokens: usage.prompt_tokens ?? null,
    completion_tokens: usage.completion_tokens ?? null,
    seconds: Math.round((Date.now() - t0) / 100) / 10,
    bytes: buf.length,
    sha256: crypto.createHash('sha256').update(buf).digest('hex').slice(0, 16),
  };
  const logDir = path.join(project.paths.build, 'images');
  fs.mkdirSync(logDir, { recursive: true });
  fs.appendFileSync(path.join(logDir, 'usage.jsonl'), JSON.stringify(entry) + '\n');
  return { ...entry, file, total_usd: imageSpend(project) };
}

export function imageLog(project) {
  const p = path.join(project.paths.build, 'images', 'usage.jsonl');
  if (!fs.existsSync(p)) return [];
  return fs.readFileSync(p, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));
}

export function imageSpend(project) {
  return Math.round(imageLog(project).reduce((a, e) => a + (e.cost_usd || 0), 0) * 10000) / 10000;
}
