# Интеграция [GREEN-API](https://green-api.com) для [GoHighLevel](https://www.gohighlevel.com)

Эта интеграция обеспечивает взаимодействие с WhatsApp в [GoHighLevel](https://www.gohighlevel.com) (GHL) через
платформу [GREEN-API](https://green-api.com). Разработана на
базе [Universal Integration Platform](https://github.com/green-api/greenapi-integration)
от [GREEN-API](https://green-api.com) и состоит из
адаптера NestJS, обеспечивающего связь между двумя платформами.

**Важно:** Эта интеграция предназначена исключительно для **суб-аккаунтов** [GoHighLevel](https://www.gohighlevel.com).
Попытка установить или
использовать её на уровне агентства или выбрать "Agency" во время настройки приложения может привести к некорректной
работе или проблемам с функциональностью.

## Обзор

Данная документация проведет вас через процесс настройки вашей собственной интеграции
между [GREEN-API](https://green-api.com) и [GoHighLevel](https://www.gohighlevel.com).
Вместо использования готового приложения вы:

1. Создадите своё собственное приложение в [GoHighLevel](https://www.gohighlevel.com) Marketplace
2. Настроите и развернёте сервис-адаптер
3. Свяжете ваш инстанс [GREEN-API](https://green-api.com) с вашим
   суб-аккаунтом [GoHighLevel](https://www.gohighlevel.com)

## Архитектура

### Сервис-адаптер

Приложение NestJS, которое:

- Обрабатывает преобразование сообщений между [GoHighLevel](https://www.gohighlevel.com) и WhatsApp
- Управляет OAuth-аутентификацией [GoHighLevel](https://www.gohighlevel.com) и управлением токенами для суб-аккаунтов
- Предоставляет конечные точки для вебхуков от [GoHighLevel](https://www.gohighlevel.com)
  и [GREEN-API](https://green-api.com)
- Создаёт и управляет контактами из WhatsApp в [GoHighLevel](https://www.gohighlevel.com)

## Предварительные требования

- База данных MySQL (5.7 или выше)
- Node.js 20 или выше
- Аккаунт и инстанс [GREEN-API](https://green-api.com)
- **Аккаунт разработчика** [GoHighLevel](https://www.gohighlevel.com). Вы можете создать его на
  сайте [https://marketplace.gohighlevel.com/](https://marketplace.gohighlevel.com/)
- **Суб-аккаунт** [GoHighLevel](https://www.gohighlevel.com) для тестирования установки и функциональности приложения
- Публично доступный URL-адрес для сервиса-адаптера (для вебхуков)

## Шаг 1: Настройка приложения в [GoHighLevel](https://www.gohighlevel.com) Marketplace

Перед развертыванием сервиса-адаптера необходимо создать и настроить приложение
в [GoHighLevel](https://www.gohighlevel.com) Marketplace:

1. **Зарегистрируйтесь и войдите** на сайте [https://marketplace.gohighlevel.com/](https://marketplace.gohighlevel.com/)

2. **Создайте новое приложение:**
    - Перейдите в раздел Apps и нажмите "Create New App"
    - Заполните базовую информацию вашего приложения (название, описание и т.д.)

3. **Настройте параметры публикации:**
    - В конфигурации приложения найдите "Listing Configuration"
    - **ВАЖНО:** Выберите **только "Sub-Account"** в качестве опции установки
    - НЕ выбирайте "Agency" или оба варианта, так как это может вызвать проблемы с функциональностью

4. **Настройте OAuth:**
    - Настройте URL перенаправления: `YOUR_APP_URL/oauth/callback`
    - Выберите необходимые разрешения (scopes):
        - contacts.readonly
        - contacts.write
        - conversations.readonly
        - conversations.write
        - conversations/message.readonly
        - conversations/message.write
        - locations.readonly
        - users.readonly

5. **Сгенерируйте Client ID и Client Secret:**
    - Перейдите в раздел "API Credentials"
    - Сгенерируйте Client ID и Client Secret
    - Сохраните эти значения - они понадобятся для конфигурации адаптера

6. **Настройте параметры вебхуков:**
    - Настройте URL вебхука по умолчанию: `YOUR_APP_URL/webhooks/ghl`
    - Включите событие вебхука "OutboundMessage"

7. **Создайте Conversation Provider:**
    - Перейдите в настройки "Conversation Provider" в настройках приложения
    - Имя: "[GREEN-API](https://green-api.com)" (или любое другое по вашему выбору)
    - Тип: **SMS**
    - URL доставки: `YOUR_APP_URL/webhooks/ghl` (то же, что и URL вебхука)
    - Отметьте оба пункта: "Is this a Custom Conversation Provider?" и "Always show this Conversation Provider?"
    - При желании добавьте алиас и логотип
    - Сохраните Conversation Provider ID - он понадобится для конфигурации

8. **Настройте внешнюю аутентификацию:**
    - Включите External Authentication
    - Выберите метод "API Key/Basic Auth"
    - Добавьте два обязательных поля:
        - Поле 1: Название "Instance ID", Ключ "instance_id", Тип "Text"
        - Поле 2: Название "Instance Token", Ключ "api_token_instance", Тип "Text"
    - Установите URL аутентификации: `YOUR_APP_URL/oauth/external-auth-credentials`
    - Установите метод: POST
    - Сохраните конфигурацию

## Шаг 2: Настройка адаптера

1. **Клонируйте репозиторий:**

   ```bash
   git clone https://github.com/green-api/greenapi-integration-gohighlevel.git
   cd greenapi-integration-gohighlevel
   ```

2. **Установите зависимости:**

   ```bash
   npm install
   ```

3. **Настройте переменные окружения:**

   Создайте файл `.env` в корне проекта со следующими переменными:

   ```env
   DATABASE_URL="mysql://USER:PASSWORD@HOST:PORT/DATABASE_NAME"
   APP_URL="https://your-adapter-domain.com"
   GHL_CLIENT_ID="your_ghl_client_id_from_developer_portal"
   GHL_CLIENT_SECRET="your_ghl_client_secret_from_developer_portal"
   GHL_CONVERSATION_PROVIDER_ID="your_ghl_conversation_provider_id_from_app_settings"
   ```

    - `DATABASE_URL`: Строка подключения к вашей базе данных MySQL
    - `APP_URL`: Публичный URL, где будет развернут ваш адаптер
    - `GHL_CLIENT_ID` и `GHL_CLIENT_SECRET`: Из шага 5 настройки приложения GHL
    - `GHL_CONVERSATION_PROVIDER_ID`: Из шага 7 настройки приложения GHL

4. **Примените миграции базы данных:**

   ```bash
   npx prisma migrate deploy
   ```

5. **Соберите и запустите адаптер:**

   ```bash
   # Сборка приложения
   npm run build

   # Запуск в production режиме
   npm run start:prod
   ```

## Шаг 3: Развертывание

Адаптер может быть развернут с использованием Docker. Конфигурационные файлы:

### Настройка Docker Compose (`docker-compose.yml`)

```yaml
version: '3.8'

services:
    adapter:
        build: .
        ports:
            - "3000:3000"
        environment:
            - DATABASE_URL=${DATABASE_URL}
            - APP_URL=${APP_URL}
            - GHL_CLIENT_ID=${GHL_CLIENT_ID}
            - GHL_CLIENT_SECRET=${GHL_CLIENT_SECRET}
            - GHL_CONVERSATION_PROVIDER_ID=${GHL_CONVERSATION_PROVIDER_ID}
        depends_on:
            - db
        restart: unless-stopped

    db:
        image: mysql:8
        environment:
            - MYSQL_ROOT_PASSWORD=your_strong_root_password
            - MYSQL_USER=your_db_user
            - MYSQL_PASSWORD=your_db_password
            - MYSQL_DATABASE=ghl_adapter
        volumes:
            - mysql_data:/var/lib/mysql
        restart: unless-stopped

volumes:
    mysql_data:
```

### Dockerfile

```dockerfile
FROM node:20-alpine
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npx prisma generate
RUN npm run build
EXPOSE 3000
CMD npx prisma migrate deploy && npm run start:prod
```

Для развертывания с использованием Docker Compose:

```bash
# Запуск всех сервисов
docker-compose up -d

# Просмотр логов
docker-compose logs -f

# Остановка всех сервисов
docker-compose down
```

Примечание: Данные файлы предоставлены в качестве примера и могут требовать корректировок в зависимости от ваших
конкретных условий и требований развертывания.

## Шаг 4: Установка и использование интеграции

После настройки вашего приложения [GoHighLevel](https://www.gohighlevel.com) и развертывания сервиса-адаптера, вы можете
установить и использовать
интеграцию:

1. **Установите приложение в ваш суб-аккаунт [GoHighLevel](https://www.gohighlevel.com):**
    - Если ваше приложение приватное:
        - Скопируйте ID вашего приложения из marketplace.gohighlevel.com
        - Из вашего суб-аккаунта [GoHighLevel](https://www.gohighlevel.com) перейдите в маркетплейс
        - Нажмите на любое приложение и измените URL, заменив ID приложения на ID вашего приложения
    - Нажмите "Install" на странице вашего приложения и затем "Allow and Install"

2. **Завершите аутентификацию [GREEN-API](https://green-api.com):**
    - После OAuth-авторизации вы можете закрыть страницу, на которую вас перенаправили, и вернуться на предыдущую
      страницу, где вам будет предложено ввести учетные данные [GREEN-API](https://green-api.com)
    - Введите ваш Instance ID и API Token [GREEN-API](https://green-api.com) (из console.green-api.com)
    - Система проверит и свяжет ваш инстанс [GREEN-API](https://green-api.com) с вашим аккаунтом GHL

## Как работает интеграция

После установки интеграция работает автоматически:

### Входящие сообщения (WhatsApp → GHL)

1. Когда клиент отправляет сообщение на ваш номер WhatsApp:
    - [GREEN-API](https://green-api.com) получает сообщение и отправляет его в ваш адаптер
    - Адаптер создает или обновляет контакт в GHL
    - Сообщение появляется в интерфейсе переписки GHL

2. Поддерживаемые типы входящих сообщений:
    - Текстовые сообщения
    - Медиа (изображения, видео, документы, аудио)
    - Геолокации
    - Контактные карточки
    - И другие (стикеры, опросы и т.д.)

### Исходящие сообщения (GHL → WhatsApp)

1. Чтобы ответить контакту WhatsApp:
    - Используйте стандартный интерфейс сообщений GHL
    - Сообщение будет направлено через ваш адаптер в [GREEN-API](https://green-api.com) и доставлено по WhatsApp

2. Поддерживаемые типы исходящих сообщений:
    - Текстовые сообщения
    - Вложенные файлы

## Устранение неполадок

### Распространенные проблемы

1. **Сообщения не доставляются:**
    - Проверьте, что ваш инстанс [GREEN-API](https://green-api.com) авторизован
    - Проверьте логи адаптера на наличие ошибок
    - Убедитесь, что URL вебхуков настроены правильно

2. **Проблемы с установкой приложения:**
    - Убедитесь, что ваше приложение настроено только для Sub-Account
    - Проверьте, что внешняя аутентификация (External Authentication) настроена правильно

3. **Ошибки подключения к базе данных:**
    - Проверьте правильность DATABASE_URL
    - Убедитесь, что пользователь базы данных имеет соответствующие разрешения

## Лицензия

[MIT](./LICENSE)
