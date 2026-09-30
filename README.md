# Голосовалка за командный мерч

Статическая страница (GitHub Pages) + бэкенд на Google Apps Script. Голоса и комментарии пишутся на вкладки `votes` и `comments` таблицы «Идеи для командного мерча».

- `index.html` — голосование. Вход через Google, максимум 2 голоса, голос можно менять, комментарий к любому варианту.
- `admin.html` — результаты, кто за что голосовал, комментарии, CSV, кнопка «закрыть/открыть голосование». Вход по паролю: он хранится только в `ADMIN_PASSWORD` в Apps Script и проверяется на сервере.
- `variants.json` + `images/` — 15 уникальных вариантов из таблицы (2 дубля убраны).

Пока в `config.js` пустой `APPS_SCRIPT_URL`, сайт работает в демо-режиме: всё хранится в localStorage браузера.

## Подключение бэкенда (один раз, ~10 минут)

### 1. OAuth Client ID
1. https://console.cloud.google.com/ → создать проект (любой).
2. APIs & Services → OAuth consent screen: External, название «Мерч», свой email. Scopes не нужны. Publish app (иначе войти смогут только тестовые пользователи).
3. Credentials → Create credentials → OAuth client ID → Web application.
   Authorized JavaScript origins: `https://xryachkoff.github.io` и `http://localhost:8765` (для локальной проверки).
4. Скопировать Client ID (`….apps.googleusercontent.com`).

### 2. Apps Script
1. В таблице: Расширения → Apps Script.
2. Вставить содержимое `apps-script/Code.gs`, вписать `CLIENT_ID` и `ADMIN_PASSWORD`. В репозитории остаётся заглушка — пароль не коммитить.
3. Deploy → New deployment → тип Web app. Execute as: **Me**, Who has access: **Anyone**. Разрешить доступ.
4. Скопировать URL веб-приложения (`https://script.google.com/macros/s/…/exec`).

### 3. Конфиг
Вписать оба значения в `config.js`, закоммитить и запушить.

При правке `Code.gs` нужно делать Deploy → Manage deployments → Edit → New version, чтобы URL не менялся.

## Как это защищено
- Сервер сам проверяет Google ID-токен (`aud` = наш Client ID, email подтверждён). Голос привязан к email, поэтому инкогнито не даёт голосовать повторно.
- Лимит 2 голоса и закрытие голосования проверяются на сервере, а не только в интерфейсе.
- Админские действия без верного пароля возвращают `forbidden`. После 10 неудачных попыток админка блокируется на 10 минут.
- Пароль проверяет сервер, в коде страницы его нет. Пока бэкенд не подключён (демо-режим), админка показывает только данные из этого же браузера.
