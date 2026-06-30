# SaleSmartly / HelpKnow / Telegram Webhook

Vercel Serverless API for SaleSmartly and HelpKnow. It can:

- receive HelpKnow webhook calls and send Telegram handoff alerts;
- receive official SaleSmartly webhook events and store customer/message data in Supabase;
- analyze customer conversations and detect follow-up opportunities;
- create follow-up tasks and send Telegram reminders for human sales staff.

Current mode: **AI analysis + Telegram human follow-up reminders**.

The system does **not** automatically send any message to SaleSmartly customers. HelpKnow / Omen / Jett continue handling normal customer replies.

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
FOLLOWUP_MODE=telegram_only
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

Initial production setting should be:

```text
FOLLOWUP_MODE=telegram_only
AUTO_FOLLOWUP_ENABLED=false
```

`FOLLOWUP_MODE=telegram_only` has highest priority. Even if `AUTO_FOLLOWUP_ENABLED=true` exists in Vercel, `/api/analyze-followups` will not call the SaleSmartly active-send API and will not send customer-facing messages.

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

If SaleSmartly official webhook token validation still keeps returning `POST 401`, use the dedicated no-token receiver in the SaleSmartly enterprise developer webhook settings:

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

Only these high-risk handoff cases send Telegram:

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

## AI Analysis + Telegram Follow-Up Reminders

Current workflow:

```text
SaleSmartly -> Vercel -> Supabase -> /api/analyze-followups -> Telegram group reminder -> human follow-up
```

`/api/analyze-followups` only reads Supabase conversation data, creates `followup_tasks`, writes `followup_logs`, and sends Telegram reminders. It never sends messages to customers.

Low-risk reminder statuses:

```text
price_requested
price_list_requested
quote_sent_no_reply
payment_interest_no_reply
shipping_question_no_reply
later_followup
high_intent_no_reply
price_objection
product_question_no_reply
```

Examples that are treated as low-risk Telegram reminder candidates:

```text
Can I get a price quote?
can i have a price list?
Can I see your catalog
Pricing, delivery
Your prices are very high compared to the ...
Do you carry pills and oils also?
```

High-risk scenarios. These only create Telegram `【需要人工接入】` alerts:

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

Telegram reminder cadence:

```text
3h after last customer message
6h after last customer message
9h after last customer message
24h after last customer message
48h after last customer message
72h after last customer message
```

Duplicate prevention:

- one `contact_id` / `session_id` cannot create the same stage reminder twice;
- `followup_logs.action_type=telegram_alert` and sent `followup_tasks` are checked before alerting;
- pending tasks are reused instead of recreated;
- if the customer replies after a Telegram reminder, pending tasks are skipped and the latest customer message is analyzed again;
- after the 72h reminder, the customer is marked `followup_stopped=true` with `followup_stop_reason=no_reply_after_3_days`.

Reminder safety rules:

- suggested human follow-up scripts are English only;
- do not mention AI or automation in suggested customer-facing text;
- do not provide dosage, injection, treatment, or medical advice;
- do not invent price, stock, COA, shipping time, or payment links;
- reminders help staff solve the customer's blocker, not pressure payment.

Telegram reminder format for low-risk cases:

```text
【客户回访提醒】

客户阶段：{status}
回访节点：{followup_stage}
优先级：高 / 中 / 低

WS名称：{ws_display_name, if available}
客户名称：{customer_name, if available}
联系方式：{phone/email, if available}
搜索关键词：{ws_display_name or customer_name or phone or email or contact_id}

客户最近消息：
{last_customer_message}

AI分析：
{reason}

建议人工回访话术：
{English suggested message}

操作建议：
请人工进入 SaleSmartly，使用“搜索关键词”找到该客户，确认上下文后再手动发送，不要盲目复制。
```

High-risk Telegram title:

```text
【需要人工接入】
```

## SaleSmartly Message Sending Module

`lib/salesmartly-send.js` is retained for reference, but `/api/analyze-followups` does not import it and does not call it.

In `FOLLOWUP_MODE=telegram_only`, the system will not call any SaleSmartly active-send endpoint, regardless of `AUTO_FOLLOWUP_ENABLED`.

The optional variable below is not used by the current Telegram-only reminder flow:

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

Expected behavior in current `telegram_only` mode:

- analyze customers;
- create `followup_tasks`;
- write `followup_logs` with `telegram_alert` or `skipped`;
- send Telegram `【客户回访提醒】` for low-risk follow-up opportunities;
- send Telegram `【需要人工接入】` for high-risk cases;
- never send customer-facing messages.

Response fields include:

```json
{
  "mode": "telegram_only",
  "auto_customer_send_disabled": true,
  "scanned": 0,
  "telegram_alerts_created": 0,
  "tasks_created": 0,
  "skipped": 0,
  "errors": 0
}
```

`status_not_reminder_allowed` means the latest customer message did not match a supported low-risk follow-up status and did not match a high-risk handoff status. It should not be returned for clear price, quote, price list, catalog, shipping/delivery, price objection, or product-question messages.

Force a Telegram-only test run:

```bash
curl -X POST "https://your-domain.vercel.app/api/analyze-followups?force=true" \
  -H "Content-Type: application/json" \
  -H "x-salesmartly-webhook-secret: <SALES_SMARTLY_WEBHOOK_SECRET>" \
  --data-raw '{"limit":50}'
```

With `force=true`:

- low-risk customers ignore the 3h / 6h / 9h / 24h timing gate and immediately use the first unsent reminder node;
- duplicate stage protection still applies;
- high-risk customers still only create `【需要人工接入】`;
- the system still never sends messages to SaleSmartly customers.

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
  "mode": "telegram_only",
  "auto_customer_send_disabled": true,
  "would_send_customer": false,
  "status_detected": "price_requested",
  "telegram_alert_allowed": true,
  "auto_send_allowed": false,
  "followup_stage": "3h"
}
```

Built-in scenario tests:

```bash
curl "https://your-domain.vercel.app/api/test-followup-analysis?scenario=price_inquiry"
curl "https://your-domain.vercel.app/api/test-followup-analysis?scenario=price_quote"
curl "https://your-domain.vercel.app/api/test-followup-analysis?scenario=catalog_request"
curl "https://your-domain.vercel.app/api/test-followup-analysis?scenario=pricing_delivery"
curl "https://your-domain.vercel.app/api/test-followup-analysis?scenario=price_objection"
curl "https://your-domain.vercel.app/api/test-followup-analysis?scenario=product_question"
curl "https://your-domain.vercel.app/api/test-followup-analysis?scenario=quote_no_reply"
curl "https://your-domain.vercel.app/api/test-followup-analysis?scenario=ai_doubt"
curl "https://your-domain.vercel.app/api/test-followup-analysis?scenario=call_request"
curl "https://your-domain.vercel.app/api/test-followup-analysis?scenario=opt_out"
curl "https://your-domain.vercel.app/api/test-followup-analysis?scenario=duplicate_stage"
curl "https://your-domain.vercel.app/api/test-followup-analysis?scenario=catalog_request&force=true"
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
  "mode": "telegram_only",
  "auto_customer_send_disabled": true,
  "would_send_customer": false,
  "high_risk_type": "ai_doubt",
  "manual_handoff_required": true,
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
        "action_type": "telegram_alert",
        "followup_stage": "3h",
        "created_at": "2026-06-29T11:05:00.000Z"
      }
    ],
    "tasks": []
  }'
```

Expected: it should not create the `3h` Telegram reminder again and `would_send_customer` remains `false`.

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
