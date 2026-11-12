/*
  TEMPO — настройки. Файл лежит в одной папке с index.html.
  index.html читает отсюда ключ, адрес API и модель и сам отправляет запросы.

  Если в чате «Failed to fetch» — провайдер не пускает запросы прямо из браузера (CORS).
  Тогда запускай сайт так:  node server.js   (откроется http://localhost:8080)

  ВНИМАНИЕ: ключ в этом файле виден любому, кто откроет сайт.
  Не выкладывай папку в открытый доступ с настоящим ключом.
*/
window.TEMPO_CONFIG = {
  ai: {
    apiKey: '',
    baseURL: 'https://api.drakezakuru.com/v1',

    // 'auto' — сайт сам запросит у провайдера список моделей (/models)
    // и выберет ту, что похожа на modelHint. Если знаешь точный ID — впиши его вместо 'auto'.
    model: 'auto',
    modelHint: 'gpt-6.1',

    temperature: 0.5,
    timeout: 25000,   // мс
    headers: {}       // дополнительные заголовки, если провайдер их требует
  },

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
