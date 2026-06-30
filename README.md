# SaleSmartly / HelpKnow / Telegram Webhook

Vercel Serverless API for SaleSmartly and HelpKnow. It can receive HelpKnow webhook calls, receive official SaleSmartly webhook events, send Telegram handoff alerts, store customer chats in Supabase, analyze low-risk sales follow-up cases, and create or send English customer follow-up messages.

## Endpoints

```text
GET  /api/salesmartly-telegram-webhook
POST /api/salesmartly-telegram-webhook

GET  /api/salesmartly-official-webhook
POST /api/salesmartly-official-webhook
POST /api/salesmartly-official-webhook-yuan-alert

GET  /api/analyze-followups
POST /api/analyze-followups

GET  /api/test-followup-analysis
POST /api/test-followup-analysis

POST /api/debug-supabase-insert
```

## Environment Variables

Configure these in Vercel. Do not commit real values.

```text
AUTO_FOLLOWUP_ENABLED=false

SUPABASE_URL=
SUPABASE_SERVICE_ROLE_KEY=

SALES_SMARTLY_API_TOKEN=
SALES_SMARTLY_WEBHOOK_TOKEN=

TELEGRAM_BOT_TOKEN=
TELEGRAM_CHAT_ID=
SALES_SMARTLY_WEBHOOK_SECRET=
```

Optional:

```text
SALES_SMARTLY_PROJECT_ID=
CRON_SECRET=
SALESMARTLY_SEND_MESSAGE_URL=
```

Initial production setting should stay disabled until testing is complete:

```text
AUTO_FOLLOWUP_ENABLED=false
```

With this setting the system creates `followup_tasks` and sends internal Telegram reminders, but does not send customer-facing messages. To enable automatic customer messages later:

```text
AUTO_FOLLOWUP_ENABLED=true
```

## Supabase SQL

Run this in Supabase SQL Editor.

```sql
create extension if not exists pgcrypto;

create table if not exists customers (
  id uuid primary key default gen_random_uuid(),
  contact_id text unique,
  session_id text unique,
  project_id text,
  ws_display_name text,
  customer_name text,
  phone text,
  email text,
  channel text,
  conversation_url text,
  assigned_ai_employee text,
  first_customer_message_at timestamptz,
  last_customer_message text,
  last_customer_message_at timestamptz,
  last_agent_message_at timestamptz,
  last_auto_followup_at timestamptz,
  current_status text,
  risk_level text,
  followup_stage text,
  followup_count_24h integer not null default 0,
  followup_count_total integer not null default 0,
  followup_stopped boolean not null default false,
  followup_stop_reason text,
  do_not_followup boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists messages (
  id uuid primary key default gen_random_uuid(),
  contact_id text,
  session_id text,
  project_id text,
  direction text not null check (direction in ('customer', 'ai', 'human', 'system')),
  sender_name text,
  message_text text,
  message_time timestamptz,
  raw_payload jsonb,
  created_at timestamptz not null default now()
);

create table if not exists followup_tasks (
  id uuid primary key default gen_random_uuid(),
  contact_id text,
  session_id text,
  status text not null default 'pending',
  priority text check (priority in ('high', 'medium', 'low')),
  reason text,
  suggested_message text,
  auto_send_allowed boolean not null default false,
  followup_stage text,
  scheduled_at timestamptz,
  sent_at timestamptz,
  skipped_reason text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists followup_logs (
  id uuid primary key default gen_random_uuid(),
  contact_id text,
  session_id text,
  action_type text not null check (action_type in ('auto_sent', 'skipped', 'telegram_alert', 'failed')),
  status text,
  followup_stage text,
  message_sent text,
  reason text,
  raw_result jsonb,
  created_at timestamptz not null default now()
);

create index if not exists idx_messages_contact_time on messages(contact_id, message_time desc);
create index if not exists idx_messages_session_time on messages(session_id, message_time desc);
create index if not exists idx_followup_tasks_contact_stage on followup_tasks(contact_id, followup_stage, status);
create index if not exists idx_followup_logs_contact_stage on followup_logs(contact_id, followup_stage, action_type);
```

## SaleSmartly Official Webhook

Configure SaleSmartly enterprise developer webhook:

```text
URL: https://your-domain.vercel.app/api/salesmartly-official-webhook
Method: POST
Header: x-salesmartly-webhook-token = <SALES_SMARTLY_WEBHOOK_TOKEN>
Events: new message notification, customer information sync
```

If SaleSmartly webhook token validation fails, use the shared secret fallback URL:

```text
https://wukai8775-max-salesmartly-telegram.vercel.app/api/salesmartly-official-webhook?secret=<SALES_SMARTLY_WEBHOOK_SECRET>
```

If SaleSmartly official webhook token validation keeps returning `POST 401`, configure the SaleSmartly enterprise developer webhook push URL as:

```text
URL: https://wukai8775-max-salesmartly-telegram.vercel.app/api/salesmartly-official-webhook-yuan-alert
Method: POST
```

This dedicated receiver does not validate header token, signature, or `query.secret`. It reuses the same post-validation business logic as `/api/salesmartly-official-webhook`, including Supabase message/customer storage, opt-out follow-up stopping, and Telegram shipping-info alerts.

The receiver extracts and stores:

```text
ws_display_name / whatsapp_display_name / contact_name / profile_name
phone
email
channel
contact_id
session_id
project_id
conversation_url
last_message
message_time
direction
raw_payload
```

When the official webhook receives a customer message that looks like submitted shipping information, it also sends the Telegram alert `【客户已提交收货信息】`. This covers both labelled formats such as `Name: / Phone: / Address:` and multi-line customer replies such as name, phone, country, street address, zip code, and email without labels.

## HelpKnow Telegram Webhook

```text
URL: https://your-domain.vercel.app/api/salesmartly-telegram-webhook
Method: POST
Header: x-salesmartly-webhook-secret = <SALES_SMARTLY_WEBHOOK_SECRET>
```

Only these high-risk handoff cases send Telegram immediately:

```text
shipping_info
call_request
ai_doubt
```

Normal price, catalog, MOQ, COA, shipping-cost, and sales inquiry messages return:

```json
{
  "success": true,
  "skipped": true,
  "reason": "not_a_handoff_trigger"
}
```

For `ai_doubt`, the response includes:

```json
{
  "should_reply_customer": false,
  "handoff_required": true
}
```

## Automatic Follow-Up Rules

Allowed low-risk auto-send statuses:

```text
price_requested
quote_sent_no_reply
payment_interest_no_reply
shipping_question_no_reply
later_followup
```

Forbidden auto-send scenarios. These only create Telegram handoff alerts:

```text
ai_doubt
call_request
shipping_info
complaint_or_after_sales
payment_dispute
angry_customer
```

Permanent opt-out phrases stop all future follow-ups:

```text
stop
stop messaging me
don't message me
do not message me
not interested
no thanks
unsubscribe
remove me
leave me alone
don't contact me again
```

Follow-up cadence:

```text
New customer within 24h:
3h after last customer message
6h after last customer message
9h after last customer message

After 24h:
24h after first customer message
48h after first customer message
72h after first customer message
```

Duplicate prevention:

- one `contact_id` / `session_id` cannot receive the same stage twice;
- `followup_logs` are checked before sending;
- pending tasks are reused instead of recreated;
- if the customer replies after an auto follow-up, pending tasks are skipped and the latest customer message is analyzed again.

Message safety rules:

- customer-facing follow-ups are English only;
- do not mention AI or automation;
- do not provide dosage, injection, treatment, or medical advice;
- do not invent price, stock, COA, shipping time, or payment links;
- follow-up should solve the customer's blocker, not pressure payment.

## SaleSmartly Message Sending

The sender uses official active-send webhook format:

```text
POST https://webhook.salesmartly.com/{channel}/send?signature=<SALES_SMARTLY_WEBHOOK_TOKEN>
Body: chat_user_id, chat_session_id, msg_type=text, msg.text, send_time
```

The code also generates `external-sign` from `SALES_SMARTLY_API_TOKEN` and request parameters. If SaleSmartly provides a different dedicated send endpoint for your account, set:

```text
SALESMARTLY_SEND_MESSAGE_URL=
```

## Analyze Follow-Ups

Manual trigger:

```bash
curl -X POST "https://your-domain.vercel.app/api/analyze-followups" \
  -H "Content-Type: application/json" \
  -H "x-salesmartly-webhook-secret: <SALES_SMARTLY_WEBHOOK_SECRET>" \
  --data-raw '{"limit":50}'
```

With `AUTO_FOLLOWUP_ENABLED=false`, expected behavior:

- analyze customers;
- create `followup_tasks`;
- write `followup_logs`;
- send internal Telegram reminder;
- do not send customer-facing messages.

With `AUTO_FOLLOWUP_ENABLED=true`, expected behavior:

- recheck customer reply status;
- skip high-risk cases;
- send eligible English follow-up to SaleSmartly;
- write `auto_sent` log;
- send Telegram internal record `【自动回访已发送】`.

## Vercel Cron

Recommended schedule: once per hour.

In Vercel Cron, set path:

```text
/api/analyze-followups
```

Set `CRON_SECRET` in Vercel. Vercel sends it as:

```text
Authorization: Bearer <CRON_SECRET>
```

The endpoint accepts either `CRON_SECRET` or `SALES_SMARTLY_WEBHOOK_SECRET`.

## Test Follow-Up Analysis

This endpoint does not write Supabase, Telegram, or SaleSmartly.

```bash
curl -X POST "https://your-domain.vercel.app/api/test-followup-analysis" \
  -H "Content-Type: application/json" \
  --data-raw '{
    "now": "2026-06-29T12:00:00.000Z",
    "customer": {
      "contact_id": "test_contact",
      "session_id": "test_session",
      "project_id": "test_project",
      "ws_display_name": "ShaLee",
      "customer_name": "ShaLee",
      "phone": "+1 3017511509",
      "channel": "WhatsApp",
      "first_customer_message_at": "2026-06-29T08:00:00.000Z",
      "last_customer_message_at": "2026-06-29T08:00:00.000Z",
      "last_customer_message": "Can I get the price list?",
      "created_at": "2026-06-29T08:00:00.000Z"
    },
    "messages": [
      {
        "direction": "customer",
        "message_text": "Can I get the price list?",
        "message_time": "2026-06-29T08:00:00.000Z"
      }
    ],
    "logs": [],
    "tasks": []
  }'
```

Expected:

```json
{
  "status_detected": "price_requested",
  "auto_send_allowed": true,
  "followup_stage": "3h"
}
```

High-risk test:

```bash
curl -X POST "https://your-domain.vercel.app/api/test-followup-analysis" \
  -H "Content-Type: application/json" \
  --data-raw '{
    "customer": {
      "contact_id": "test_contact",
      "session_id": "test_session",
      "first_customer_message_at": "2026-06-29T08:00:00.000Z",
      "last_customer_message_at": "2026-06-29T08:00:00.000Z",
      "last_customer_message": "Are you a bot? I want to talk to a real person."
    },
    "messages": [
      {
        "direction": "customer",
        "message_text": "Are you a bot? I want to talk to a real person.",
        "message_time": "2026-06-29T08:00:00.000Z"
      }
    ],
    "logs": [],
    "tasks": []
  }'
```

Expected:

```json
{
  "high_risk_type": "ai_doubt",
  "auto_send_allowed": false,
  "skipped_reason": "high_risk_handoff_required"
}
```

Duplicate stage test:

```bash
curl -X POST "https://your-domain.vercel.app/api/test-followup-analysis" \
  -H "Content-Type: application/json" \
  --data-raw '{
    "now": "2026-06-29T12:00:00.000Z",
    "customer": {
      "contact_id": "test_contact",
      "session_id": "test_session",
      "first_customer_message_at": "2026-06-29T08:00:00.000Z",
      "last_customer_message_at": "2026-06-29T08:00:00.000Z",
      "last_customer_message": "Can I get the price list?"
    },
    "messages": [
      {
        "direction": "customer",
        "message_text": "Can I get the price list?",
        "message_time": "2026-06-29T08:00:00.000Z"
      }
    ],
    "logs": [
      {
        "action_type": "auto_sent",
        "followup_stage": "3h",
        "created_at": "2026-06-29T11:05:00.000Z"
      }
    ],
    "tasks": []
  }'
```

Expected: it should not send `3h` again.

## Debug Supabase Insert

Use this endpoint to verify that Vercel can write to Supabase with `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY`.

```bash
curl -X POST "https://your-domain.vercel.app/api/debug-supabase-insert" \
  -H "Content-Type: application/json" \
  -H "x-salesmartly-webhook-secret: <SALES_SMARTLY_WEBHOOK_SECRET>" \
  --data-raw '{}'
```

Expected:

```json
{
  "ok": true,
  "customer_success": true,
  "message_success": true
}
```

## Official Docs Used

- SaleSmartly API use: https://help-en.salesmartly.com/docs/api-use
- API header `external-sign`: https://help-en.salesmartly.com/docs/obtain-instructions-for-the-header-parameter-of-api
- Active sending webhook: https://apifox.com/apidoc/shared-c1f4db0d-60eb-42c7-98f7-66c65bc09fdf/doc-3048234
