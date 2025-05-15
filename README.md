# GREEN-API Integration with GoHighLevel

This integration enables WhatsApp communication within GoHighLevel (GHL) using the GREEN-API platform. Built on
the [Universal Integration Platform](https://github.com/green-api/greenapi-integration) by GREEN-API, it consists of a
NestJS adapter service that bridges the connection between the two platforms.

**Important:** This integration is designed exclusively for GoHighLevel **sub-accounts**. Attempting to install or use
it at an agency level, or selecting "Agency" during app configuration, may lead to incorrect behavior or functionality
issues.

## Overview

This documentation guides you through setting up your own integration between GREEN-API and GoHighLevel. Rather than
using a pre-existing app, you will:

1. Create your own GoHighLevel Marketplace app
2. Configure and deploy the adapter service
3. Link your GREEN-API instance with your GoHighLevel sub-account

## Architecture

### Adapter Service

The NestJS application that:

- Handles message mapping between GoHighLevel and WhatsApp
- Manages GoHighLevel OAuth authentication and token management for sub-accounts
- Provides webhook endpoints for both GoHighLevel and GREEN-API
- Creates and manages contacts from WhatsApp in GoHighLevel

## Prerequisites

- MySQL database (5.7 or higher)
- Node.js 20 or higher
- GREEN-API account and instance
- A GoHighLevel **Developer Account**. You can create one
  at [https://marketplace.gohighlevel.com/](https://marketplace.gohighlevel.com/)
- A GoHighLevel **Sub-Account** for testing the app installation and functionality
- A publicly accessible URL for the adapter service (for webhooks)

## Step 1: Setting Up the GoHighLevel Marketplace App

Before deploying the adapter service, you need to create and configure a GoHighLevel Marketplace app:

1. **Register and log in** at [https://marketplace.gohighlevel.com/](https://marketplace.gohighlevel.com/)

2. **Create a new app:**
    - Navigate to the Apps section and click "Create New App"
    - Fill in your app's basic information (name, description, etc.)

3. **Configure listing settings:**
    - In the app configuration, find "Listing Configuration"
    - **IMPORTANT:** Select **only "Sub-Account"** as the installation option
    - Do NOT select "Agency" or "Both" as this can cause functionality issues

4. **Set up OAuth:**
    - Configure the redirect URL: `YOUR_APP_URL/oauth/callback`
    - Select the required scopes:
        - contacts.readonly
        - contacts.write
        - conversations.readonly
        - conversations.write
        - conversations/message.readonly
        - conversations/message.write
        - locations.readonly
        - users.readonly

5. **Generate API credentials:**
    - Go to the "API Credentials" section
    - Generate a Client ID and Client Secret
    - Save these values - you'll need them for the adapter configuration

6. **Configure webhook settings:**
    - Set up the default webhook URL: `YOUR_APP_URL/webhooks/ghl`
    - Enable the "OutboundMessage" webhook event

7. **Create a Conversation Provider:**
    - Navigate to "Conversation Provider" in the app settings
    - Name: "GREEN-API" (or any name you prefer)
    - Type: **SMS**
    - Delivery URL: `YOUR_APP_URL/webhooks/ghl` (same as webhook URL)
    - Check both "Is this a Custom Conversation Provider?" and "Always show this Conversation Provider?"
    - Add an alias and logo if desired
    - Save the Conversation Provider ID - you'll need it for configuration

8. **Configure External Authentication:**
    - Enable External Authentication
    - Choose "API Key/Basic Auth" method
    - Add two required fields:
        - Field 1: Label "Instance ID", Key "instance_id", Type "Text"
        - Field 2: Label "Instance Token", Key "api_token_instance", Type "Text"
    - Set Authentication URL to: `YOUR_APP_URL/oauth/external-auth-credentials`
    - Set Method to: POST
    - Save the configuration

## Step 2: Setting Up the Adapter

1. **Clone the repository:**

   ```bash
   git clone https://github.com/green-api/greenapi-integration-gohighlevel.git
   cd greenapi-integration-gohighlevel
   ```

2. **Install dependencies:**

   ```bash
   npm install
   ```

3. **Set up environment variables:**

   Create a `.env` file in the root of the project with the following variables:

   ```env
   DATABASE_URL="mysql://USER:PASSWORD@HOST:PORT/DATABASE_NAME"
   APP_URL="https://your-adapter-domain.com"
   GHL_CLIENT_ID="your_ghl_client_id_from_developer_portal"
   GHL_CLIENT_SECRET="your_ghl_client_secret_from_developer_portal"
   GHL_CONVERSATION_PROVIDER_ID="your_ghl_conversation_provider_id_from_app_settings"
   ```

    - `DATABASE_URL`: Your MySQL connection string
    - `APP_URL`: The public URL where your adapter will be deployed
    - `GHL_CLIENT_ID` and `GHL_CLIENT_SECRET`: From step 5 in the GHL app setup
    - `GHL_CONVERSATION_PROVIDER_ID`: From step 7 in the GHL app setup

4. **Apply database migrations:**

   ```bash
   npx prisma migrate deploy
   ```

5. **Build and start the adapter:**

   ```bash
   # Build the application
   npm run build

   # Start in production mode
   npm run start:prod
   ```

## Step 3: Deployment

The adapter can be deployed using Docker. Configuration files:

### Docker Compose Setup (`docker-compose.yml`)

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

To deploy using Docker Compose:

```bash
# Start all services
docker-compose up -d

# Check logs
docker-compose logs -f

# Stop all services
docker-compose down
```

Note: The deployment configuration is provided as a reference and may need adjustments based on your specific
environment and requirements.

## Step 4: Installing and Using the Integration

Once your GoHighLevel app is configured and your adapter service is deployed, you can install and use the integration:

1. **Install the app in your GoHighLevel sub-account:**
    - If your app is private:
        - Copy your app's ID from marketplace.gohighlevel.com
        - From your GoHighLevel sub-account, navigate to the marketplace
        - Click on any app and modify the URL by replacing the app ID portion with your app's ID
    - Click "Install" on your app's page and then "Allow and Install"

2. **Complete the GREEN-API authentication:**
    - After OAuth authorization, you can close the page you were redirected to and return back to the previous page,
      you'll be prompted to enter your GREEN-API credentials
    - Enter your GREEN-API Instance ID and API Token (from console.green-api.com)
    - The system will verify and link your GREEN-API instance to your GHL account

## How the Integration Works

Once installed, the integration works automatically:

### Incoming Messages (WhatsApp → GHL)

1. When a customer sends a message to your WhatsApp number:
    - GREEN-API receives the message and sends it to your adapter
    - The adapter creates or updates the contact in GHL
    - The message appears in GHL's conversation interface

2. Supported incoming message types:
    - Text messages
    - Media (images, videos, documents, audio)
    - Location shares
    - Contact cards
    - And more (stickers, polls, etc.)

### Outgoing Messages (GHL → WhatsApp)

1. To reply to a WhatsApp contact:
    - Use GHL's standard messaging interface
    - The message will be routed through your adapter to GREEN-API and delivered via WhatsApp

2. Supported outgoing message types:
    - Text messages
    - File attachments

## Troubleshooting

### Common Issues

1. **Messages not being delivered:**
    - Verify your GREEN-API instance is authorized
    - Check adapter logs for any errors
    - Ensure webhook URLs are correctly configured

2. **App installation issues:**
    - Make sure your app is configured for Sub-Account only
    - Check that external authentication is properly set up

3. **Database connection errors:**
    - Verify your DATABASE_URL is correct
    - Ensure the database user has proper permissions

## License

[MIT](./LICENSE)
