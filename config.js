/*
  Mundora — настройки сайта.

  Настройки ИИ (ключ, адрес, модель) задаются ТОЛЬКО на сервере:
    • Vercel → Settings → Environment Variables:
        AI_API_KEY   — ключ провайдера
        AI_BASE_URL  — адрес, например https://api.drakezakuru.com/v1
        AI_MODEL     — модель, например gpt-6-astra (необязательно)
        AI_FALLBACK_MODELS — необязательно: запасные модели по порядку через запятую.
                       Если основная не отвечает, сервер сам проверит модели провайдера и возьмёт самую сильную.
        YT_API_KEY   — ключ YouTube Data API v3: полные версии хитов (необязательно)
      Вход и аккаунты:
        ACCESS_CODE  — стартовый код доступа (например 2134). Срабатывает один раз — дальше коды создаёт админ
        ADMIN_EMAIL  — почта администратора (по умолчанию protakolov@gmail.com)
        SMTP_USER    — почта, с которой уходят коды (mundoraaiapp@gmail.com)
        SMTP_PASS    — пароль приложения Google для этой почты (16 букв)
        База данных  — Vercel → Storage → Upstash for Redis → Connect (переменные KV_* добавятся сами)
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
