# SaleSmartly Telegram Webhook

Vercel Serverless API for SaleSmartly / HelpKnow alerts. It receives HelpKnow tool calls, detects high-priority customer messages, sends Telegram group reminders, and can receive official SaleSmartly webhook events to cache customer display information.

## Endpoints

```text
GET  /api/salesmartly-telegram-webhook
POST /api/salesmartly-telegram-webhook

GET  /api/salesmartly-official-webhook
POST /api/salesmartly-official-webhook
```

## Environment Variables

Configure these in Vercel. Do not commit real values to GitHub.

```text
TELEGRAM_BOT_TOKEN=
TELEGRAM_CHAT_ID=
SALES_SMARTLY_WEBHOOK_SECRET=
SALES_SMARTLY_API_TOKEN=
SALES_SMARTLY_WEBHOOK_TOKEN=
```

Optional fallback when the HelpKnow payload does not include `project_id`:

```text
SALES_SMARTLY_PROJECT_ID=
```

## HelpKnow Telegram Webhook

```text
Method: POST
Header: x-salesmartly-webhook-secret = <SALES_SMARTLY_WEBHOOK_SECRET>
URL: https://your-domain.vercel.app/api/salesmartly-telegram-webhook
```

Only these alert types send Telegram messages:

```text
shipping_info
call_request
ai_doubt
```

Normal sales inquiries, price questions, catalog requests, COA questions, MOQ questions, and shipping-cost questions return:

```json
{
  "success": true,
  "skipped": true,
  "reason": "not_a_handoff_trigger"
}
```

When `alert_type` is `ai_doubt`, HelpKnow / AI employee prompts should stop replying to the customer after the tool call. The API response includes:

```json
{
  "should_reply_customer": false,
  "handoff_required": true
}
```

## SaleSmartly Official Webhook

```text
Method: POST
Header: x-salesmartly-webhook-token = <SALES_SMARTLY_WEBHOOK_TOKEN>
URL: https://your-domain.vercel.app/api/salesmartly-official-webhook
```

Use this endpoint for SaleSmartly official webhook events such as new message notifications and customer information sync events. It extracts and caches:

```text
ws_display_name
phone
email
channel
contact_id
session_id
project_id
last_message
```

The cache is in-memory inside the Vercel runtime. It helps warm invocations enrich later Telegram alerts, but it is not a permanent database.

## SaleSmartly OpenAPI Lookup

When HelpKnow calls `/api/salesmartly-telegram-webhook` without a `ws_display_name`, the API tries to enrich the payload by:

1. Matching a cached official webhook profile by `contact_id`, `session_id`, `phone`, or `email`.
2. Querying SaleSmartly OpenAPI customer list when `SALES_SMARTLY_API_TOKEN` and `project_id` are available.

The customer lookup uses:

```text
GET https://developer.salesmartly.com/api/v2/get-contact-list
Header: external-sign
Query: project_id, page, page_size, plus phone/email/chat_user_id/name when available
```

The `external-sign` is generated from the sorted query parameters and `SALES_SMARTLY_API_TOKEN`. No token is written into source code.

## Display Name Rules

WS display name fields:

```text
ws_display_name
whatsapp_name
whatsapp_display_name
contact_name
profile_name
salesmartly_contact_name
customer_display_name
```

If no real WS / SaleSmartly display name is available, the Telegram message omits the `WS名称` line and shows:

```text
搜索关键词：<best available phone/email/customer_name/message extraction>
```

## Test Payloads

### 1. Normal price quote: should not send Telegram

```bash
curl -X POST "https://your-domain.vercel.app/api/salesmartly-telegram-webhook" \
  -H "Content-Type: application/json" \
  -H "x-salesmartly-webhook-secret: <SALES_SMARTLY_WEBHOOK_SECRET>" \
  --data-raw '{
    "last_message": "Can I get a price quote?",
    "trigger_reason": "客户提交收货信息，需要人工跟进下单",
    "ai_employee_name": "Omen",
    "ws_display_name": "",
    "customer_name": "",
    "phone": "",
    "email": "",
    "channel": "",
    "conversation_url": "",
    "project_id": "",
    "contact_id": "",
    "session_id": ""
  }'
```

Expected response:

```json
{
  "success": true,
  "skipped": true,
  "reason": "not_a_handoff_trigger"
}
```

### 2. Shipping info: should send Telegram

```bash
curl -X POST "https://your-domain.vercel.app/api/salesmartly-telegram-webhook" \
  -H "Content-Type: application/json" \
  -H "x-salesmartly-webhook-secret: <SALES_SMARTLY_WEBHOOK_SECRET>" \
  --data-raw '{
    "last_message": "Please\nName: Cody Lester\nPhone: 479-434-0112\nPostal: 72956\nAddress: 1429 Westville Rd, Van Buren, AR, USA\nEmail: Cody.lester92@me.com",
    "trigger_reason": "客户提交收货信息，需要人工跟进下单",
    "ai_employee_name": "Omen",
    "ws_display_name": "ShaLee",
    "customer_name": "Cody Lester",
    "phone": "",
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
【客户已提交收货信息】
```

### 3. Call or video request: should send Telegram

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

### 4. AI or bot doubt: should send Telegram and stop AI reply

```bash
curl -X POST "https://your-domain.vercel.app/api/salesmartly-telegram-webhook" \
  -H "Content-Type: application/json" \
  -H "x-salesmartly-webhook-secret: <SALES_SMARTLY_WEBHOOK_SECRET>" \
  --data-raw '{
    "last_message": "Are you a bot? I want a real person.",
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

Expected response includes:

```json
{
  "alert_type": "ai_doubt",
  "should_reply_customer": false,
  "handoff_required": true
}
```

### 5. SaleSmartly official webhook cache

```bash
curl -X POST "https://your-domain.vercel.app/api/salesmartly-official-webhook" \
  -H "Content-Type: application/json" \
  -H "x-salesmartly-webhook-token: <SALES_SMARTLY_WEBHOOK_TOKEN>" \
  --data-raw '{
    "event_type": "new_message",
    "project_id": "test_project",
    "contact_id": "test_contact",
    "session_id": "test_session",
    "channel": "WhatsApp",
    "profile_name": "ShaLee",
    "phone": "+1 3017511509",
    "email": "customer@example.com",
    "last_message": "Hello"
  }'
```
