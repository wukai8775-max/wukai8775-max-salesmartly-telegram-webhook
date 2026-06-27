# SaleSmartly Telegram Webhook

Vercel Serverless API for SaleSmartly / HelpKnow alerts. It receives webhook payloads, detects shipping information messages, and sends Telegram group reminders.

## Endpoint

```text
GET  /api/salesmartly-telegram-webhook
POST /api/salesmartly-telegram-webhook
```

The GET endpoint is a health check:

```json
{
  "ok": true,
  "message": "SaleSmartly to Telegram webhook is running"
}
```

## Environment Variables

Configure these in Vercel. Do not commit real values to GitHub.

```text
TELEGRAM_BOT_TOKEN=
TELEGRAM_CHAT_ID=
SALES_SMARTLY_WEBHOOK_SECRET=
```

## HelpKnow / SaleSmartly Settings

```text
Method: POST
Header: x-salesmartly-webhook-secret = <SALES_SMARTLY_WEBHOOK_SECRET>
URL: https://your-domain.vercel.app/api/salesmartly-telegram-webhook
```

Optional AI employee name fields:

```text
ai_employee_name
agent_name
employee_name
staff_name
bot_name
```

Optional WhatsApp / SaleSmartly display name fields:

```text
ws_display_name
whatsapp_name
whatsapp_display_name
contact_name
profile_name
salesmartly_contact_name
customer_display_name
```

## Test Payloads

### Shipping info

```bash
curl -X POST "https://your-domain.vercel.app/api/salesmartly-telegram-webhook" \
  -H "Content-Type: application/json" \
  -H "x-salesmartly-webhook-secret: <SALES_SMARTLY_WEBHOOK_SECRET>" \
  --data-raw '{
    "customer_name": "Test Customer",
    "ai_employee_name": "Omen",
    "ws_display_name": "John WhatsApp",
    "phone": "+1 000 000 0000",
    "channel": "WhatsApp",
    "last_message": "Please\nName: John Smith\nPhone: +1 000 000 0000\nPostal: 90001",
    "trigger_reason": "客户提交收货信息",
    "conversation_url": "https://app.salesmartly.com/test",
    "project_id": "test_project",
    "contact_id": "test_contact",
    "session_id": "test_session"
  }'
```

Expected Telegram title:

```text
【客户已提交收货信息】
```

### Call or video request

```bash
curl -X POST "https://your-domain.vercel.app/api/salesmartly-telegram-webhook" \
  -H "Content-Type: application/json" \
  -H "x-salesmartly-webhook-secret: <SALES_SMARTLY_WEBHOOK_SECRET>" \
  --data-raw '{
    "last_message": "Can you call me? I want to talk to a real person.",
    "trigger_reason": "客户要求电话联系或视频通话，需要人工跟进",
    "ai_employee_name": "Omen",
    "ws_display_name": "ShaLee",
    "customer_name": "ShaLee",
    "phone": "+1 3017511509",
    "email": "",
    "channel": "WhatsApp",
    "conversation_url": "https://app.salesmartly.com/test",
    "project_id": "",
    "contact_id": "",
    "session_id": ""
  }'
```

Expected Telegram title:

```text
【客户要求电话/视频联系】
```

### AI or bot doubt

```bash
curl -X POST "https://your-domain.vercel.app/api/salesmartly-telegram-webhook" \
  -H "Content-Type: application/json" \
  -H "x-salesmartly-webhook-secret: <SALES_SMARTLY_WEBHOOK_SECRET>" \
  --data-raw '{
    "last_message": "Are you a bot? I want to talk to a real person.",
    "trigger_reason": "客户质疑是否为AI/机器人，需要人工关注",
    "ai_employee_name": "Jett",
    "ws_display_name": "ShaLee",
    "customer_name": "ShaLee",
    "phone": "+1 3017511509",
    "email": "",
    "channel": "WhatsApp",
    "conversation_url": "https://app.salesmartly.com/test",
    "project_id": "",
    "contact_id": "",
    "session_id": ""
  }'
```

Expected Telegram title:

```text
【客户质疑AI/机器人】
```
