// Vercel: пересылает запросы сайта к провайдеру ИИ (обходит CORS, держит поток живым)
// и сам переключается на запасную модель, если основная не отвечает (логика — в api/_ai.mjs).
// Настройки — только переменные окружения (Vercel → Settings → Environment Variables), потом Redeploy:
//   AI_API_KEY          — ключ провайдера (обязательно)
//   AI_BASE_URL         — адрес провайдера, например https://api.drakezakuru.com/v1
//   AI_MODEL            — основная модель, например gpt-6-astra (приставку провайдера сервер найдёт сам)
//   AI_FALLBACK_MODELS  — необязательно: запасные по порядку через запятую (иначе сервер выберет самые сильные сам)
import { handleAI } from './_ai.mjs';
import { guard } from './_auth.mjs';
export const config = { runtime: 'edge' };
export default async req => {
  if (req.method !== 'OPTIONS') { const g = await guard(req, true); if (g.res) return g.res; }
  return handleAI(req, (typeof process !== 'undefined' && process.env) || {});
};
