# [GREEN-API](https://green-api.com/en) Integration with [GoHighLevel](https://www.gohighlevel.com)

This integration enables WhatsApp communication within [GoHighLevel](https://www.gohighlevel.com) (GHL) using
the [GREEN-API](https://green-api.com/en) platform. Built on
the [Universal Integration Platform](https://github.com/green-api/greenapi-integration)
by [GREEN-API](https://green-api.com/en), it consists of a
NestJS adapter service that bridges the connection between the two platforms.

## Overview

This documentation guides you through setting up your own integration between [GREEN-API](https://green-api.com/en)
and [GoHighLevel](https://www.gohighlevel.com). You will:

1. Create your own [GoHighLevel](https://www.gohighlevel.com) Marketplace app
2. Configure and deploy the adapter service
3. Link one or multiple [GREEN-API](https://green-api.com/en) instances with
   your [GoHighLevel](https://www.gohighlevel.com)
   sub-account through an easy-to-use management interface

## Architecture

### Adapter Service

The NestJS application that:

- Handles message mapping between [GoHighLevel](https://www.gohighlevel.com) and WhatsApp
- Manages [GoHighLevel](https://www.gohighlevel.com) OAuth authentication and token management for sub-accounts
- Provides webhook endpoints for both [GoHighLevel](https://www.gohighlevel.com)
  and [GREEN-API](https://green-api.com/en)
- Creates and manages contacts from WhatsApp in [GoHighLevel](https://www.gohighlevel.com)
- Supports multiple [GREEN-API](https://green-api.com/en) instances per sub-account with a user-friendly management
  interface

## Prerequisites

- MySQL database (5.7 or higher)
- Node.js 20 or higher
- [GREEN-API](https://green-api.com/en) account and instance(s)
- A [GoHighLevel](https://www.gohighlevel.com) **Developer Account**. You can create one
  at [https://marketplace.gohighlevel.com/](https://marketplace.gohighlevel.com/)
- A [GoHighLevel](https://www.gohighlevel.com) **Sub-Account** for testing the app installation and functionality
- A publicly accessible URL for the adapter service (for webhooks)

## Step 1: Setting Up the [GoHighLevel](https://www.gohighlevel.com) Marketplace App

Before deploying the adapter service, you need to create and configure a [GoHighLevel](https://www.gohighlevel.com)
Marketplace app:

1. **Register and log in** at [https://marketplace.gohighlevel.com/](https://marketplace.gohighlevel.com/)

2. **Create a new app:**
    - Navigate to the Apps section and click "Create New App"
    - Fill in your app's basic information (name, description, etc.)

3. **Configure listing settings:**
    - In the app configuration, find "Listing Configuration"
    - **IMPORTANT:** Select **only "Sub-Account"** as the installation option
    - Do NOT select "Agency" or "Both" as this can cause functionality issues

4. **Set up OAuth:**
    - Go to "Advanced Settings" -> "Auth"
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

5. **Generate credentials:**
    - Go to the "Client Keys" section
    - Generate a Client ID and Client Secret
    - A little below there will be "Shared Secret" section — generate it as well.
    - Save these values - you'll need them for the adapter configuration

6. **Create a Conversation Provider:**
    - Navigate to "Conversation Provider" in the app settings
    - Name: "[GREEN-API](https://green-api.com/en)" (or any name you prefer)
    - Type: **SMS**
    - Delivery URL: `YOUR_APP_URL/webhooks/ghl` (same as webhook URL)
    - Check both "Is this a Custom Conversation Provider?" and "Always show this Conversation Provider?"
    - Add an alias and logo if desired
    - Save the Conversation Provider ID - you'll need it for configuration

7. **Configure Custom Page:**
    - Enable Custom Page functionality
    - Set Custom Page URL to: `YOUR_APP_URL/app/whatsapp`
    - This will provide users with an interface to manage their GREEN-API instances

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
   GHL_SHARED_SECRET="your_shared_secret_from_developer_portal"
   ```

    - `DATABASE_URL`: Your MySQL connection string
    - `APP_URL`: The public URL where your adapter will be deployed
    - `GHL_CLIENT_ID` and `GHL_CLIENT_SECRET`: From step 5 in the GHL app setup
    - `GHL_CONVERSATION_PROVIDER_ID`: From step 7 in the GHL app setup
    - `GHL_SHARED_SECRET`: From step 5 in the GHL app setup

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
      - GHL_SHARED_SECRET=${GHL_SHARED_SECRET}
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

Once your [GoHighLevel](https://www.gohighlevel.com) app is configured and your adapter service is deployed, you can
install and use the integration:

1. **Install the app in your [GoHighLevel](https://www.gohighlevel.com) sub-account:**
    - Go to "App Marketplace" (located in the side panel)
    - If your app is private:
        - Copy your app's ID from marketplace.gohighlevel.com
        - Click on any app and modify the URL by replacing the app ID portion with your app's ID
    - If your app is public, you can just search for it
    - Click "Install" on your app's page and then "Allow and Install"

2. **Access the WhatsApp Instance Management Interface:**
    - After installation, you can go to the custom page to manage your GREEN-API instances (will appear in the side
      panel)
    - The interface will allow you to add/manage multiple instances

3. **Add GREEN-API Instances:**
    - Use the management interface to add your GREEN-API instances
    - For each instance, provide:
        - Instance Name (optional, for easy identification)
        - Instance ID (from console.green-api.com)
        - API Token (from console.green-api.com)
    - You can add multiple instances and manage them independently

4. **Manage Your Instances:**
    - View all your connected GREEN-API instances
    - Edit instance names
    - Delete instances when no longer needed
    - Monitor instance status and authorization state

## How the Integration Works

Once installed, the integration works automatically:

### Incoming Messages (WhatsApp → GHL)

1. When a customer sends a message to any of your WhatsApp numbers:
    - [GREEN-API](https://green-api.com/en) receives the message and sends it to your adapter
    - The adapter creates or updates the contact in GHL
    - The contact is tagged with the specific instance ID they contacted (You must not change this tag in any way)
    - The message appears in GHL's conversation interface

2. Supported incoming message types:
    - Text messages
    - Media (images, videos, documents, audio)
    - Location shares
    - Contact cards
    - And more (stickers, polls, etc.)

3. **Group Support:**
    - **Group messages are fully supported** - when someone sends a message in a WhatsApp group
    - **Group contacts** are created with names like `[Group] Sales Team` to clearly identify them as groups
    - **Group "phone" numbers** are actually the group's chat ID (a long numeric identifier like `120363418570879210`)
    - **Group messages** show the sender's name and their phone number: `John Doe (+1234567890): Hello everyone!`

### Outgoing Messages (GHL → WhatsApp)

1. To reply to a WhatsApp contact:
    - Use GHL's standard messaging interface
    - The message will be routed through your adapter to the appropriate [GREEN-API](https://green-api.com/en) instance
      based on the contact's tag

2. Supported outgoing message types:
    - Text messages
    - File attachments

### Important Note

**⚠️ Multi-Instance Conversations:** If the same phone number writes to multiple of your GREEN-API instances (different WhatsApp numbers),
this integration will **not** create separate conversations. All messages from that phone number, regardless of which
instance they contact, will appear in a **single conversation thread**.

**📱 Group Identification:** Group contacts can be easily identified by:

- Contact name starting with `[Group]`
- Phone field containing a long numeric ID instead of a traditional phone number
- `whatsapp-group` tag automatically applied to group contacts

## Troubleshooting

### Common Issues

1. **Messages not being delivered:**
    - Check adapter logs for any errors
    - Ensure webhook URLs are correctly configured
    - Verify instance status in the management interface

2. **Instance management problems:**
    - Verify OAuth authentication is completed first
    - Check that all required environment variables are set
    - Ensure the custom page can communicate with your adapter service

3. **Database connection errors:**
    - Verify your DATABASE_URL is correct
    - Ensure the database user has proper permissions
    - Check that database migrations have been applied

## License

[MIT](./LICENSE)