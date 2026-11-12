/*
  TEMPO — настройки сайта.

  Настройки ИИ (ключ, адрес, модель) задаются ТОЛЬКО на сервере:
    • Vercel → Settings → Environment Variables:
        AI_API_KEY   — ключ провайдера
        AI_BASE_URL  — адрес, например https://api.drakezakuru.com/v1
        AI_MODEL     — модель, например gpt-6-astra (необязательно)
      после изменения — Deployments → ⋯ → Redeploy.
    • Локально: те же переменные перед запуском  node server.js
*/
window.TEMPO_CONFIG = {
  music: {
    // Открытый каталог Audius: полные треки и ремиксы, ключ не нужен
    bases: [
      'https://api.audius.co/v1',
      'https://discoveryprovider.audius.co/v1',
      'https://discoveryprovider2.audius.co/v1',
      'https://discoveryprovider3.audius.co/v1'
    ]
  }
};
