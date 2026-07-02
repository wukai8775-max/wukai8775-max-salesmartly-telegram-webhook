# SaleSmartly / HelpKnow / Telegram Webhook

Vercel Serverless API for SaleSmartly and HelpKnow.

Current mode: **AI analysis + Telegram human follow-up reminders**.

The system does **not** automatically send messages to SaleSmartly customers. HelpKnow / Omen / Jett continue handling normal customer replies. All Telegram alerts go to `TELEGRAM_CHAT_ID`.

## Core Follow-Up Rule

The normal follow-up reminder logic is now based on message direction first, not on a status whitelist.

If the latest `ai` or `human` message is newer than the latest `customer` message, the last message was sent by us and the customer has not replied yet. In that case, the customer enters the Telegram human follow-up reminder flow.

Reminder timing is based on the latest `ai` / `human` message time:

```text
latest agent reply time + 3h / 6h / 9h / 24h / 48h / 72h
```

Customer status is used only for customer stage, AI analysis, suggested wording, and priority. It is no longer a hard gate that decides whether a reminder can be created.

If the specific customer scenario cannot be classified but the last message was sent by us and the customer has not replied, the system uses:

```text
general_no_reply_after_staff_message
```

Exceptions:

```text
customer opt-out: stop / not interested / no thanks / unsubscribe / don't contact me
closed customer: current_status=closed / completed / deal_closed / order_completed
high-risk handoff: ai_doubt / call_request / shipping_info / complaint_or_after_sales / payment_dispute / angry_customer
duplicate stage already alerted
quiet hours for normal low-risk reminders
```

## Endpoints

```text
GET  /api/salesmartly-telegram-webhook
POST /api/salesmartly-telegram-webhook

GET  /api/salesmartly-official-webhook
POST /api/salesmartly-official-webhook
POST /api/salesmartly-official-webhook-yuan-alert

GET  /api/analyze-followups
POST /api/analyze-followups
GET  /api/cron-analyze-followups

GET  /api/test-followup-analysis
POST /api/test-followup-analysis

POST /api/debug-supabase-insert
```

## Environment Variables

Required:

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
CRON_SECRET=
```

Optional:

```text
STAFF_ID_NAME_MAP=
TELEGRAM_FOLLOWUP_CHAT_ID=
SALES_SMARTLY_PROJECT_ID=
SALESMARTLY_SEND_MESSAGE_URL=

FOLLOWUP_QUIET_HOURS_ENABLED=false
FOLLOWUP_QUIET_TIMEZONE=Asia/Shanghai
FOLLOWUP_QUIET_START=13:00
FOLLOWUP_QUIET_END=19:00
FOLLOWUP_QUIET_BEHAVIOR=defer
```

`FOLLOWUP_MODE=telegram_only` has highest priority. Even if `AUTO_FOLLOWUP_ENABLED=true`, the analyzer does not call SaleSmartly active-send APIs and does not send customer-facing messages.

`TELEGRAM_FOLLOWUP_CHAT_ID` is retained only for backward compatibility. Current code does not prioritize it. All reminders and emergency alerts go to `TELEGRAM_CHAT_ID`.

## Follow-Up Flow

SaleSmartly webhook only receives new events and writes customer/message data into Supabase. It does not scan old conversations or decide whether a customer needs follow-up.

The follow-up logic runs in `/api/analyze-followups`. If no scheduler calls that endpoint, Telegram follow-up reminders only happen when you manually call it from PowerShell or another HTTP client.

`/api/cron-analyze-followups` is the scheduled wrapper around the same analysis logic.

## Low-Risk Reminder Statuses

Low-risk statuses create `【客户回访提醒】`, never send customer-facing messages, and obey quiet hours:

```text
first_greeting_no_reply
quality_trust_question_no_reply
b2b_wholesale_interest_no_reply
staff_next_step_question_no_reply
shipping_address_request_no_reply
general_no_reply_after_staff_message
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

`first_greeting_no_reply` applies when the customer only sent a simple greeting such as `Hi`, `Hello`, `Hey`, or `Good morning`, the AI/human has replied, and the customer did not continue.

`quality_trust_question_no_reply` applies when the customer asks about COA, Janoshik, test report, testing report, purity, batch, laboratory, lab location, testing facility, authenticity, real report, certificate, third-party test, or third-party testing, the AI/human has replied, and the customer did not continue.

Suggested human follow-up for quality/trust questions:

```text
Hi, just following up - would you like me to help you review the test report, batch details, or lab information again so everything is clear before you decide?
```

`b2b_wholesale_interest_no_reply` applies when the customer expresses B2B, wholesale, bulk, reseller, business, wellness business, health store, China vendors, channel distribution, commercial purchase, great/best price, compare prices, placing an order soon, or manager discount interest, the AI/human has replied, and the customer did not continue.

Suggested human follow-up for B2B/wholesale interest:

```text
Hi, just following up - since you mentioned larger quantities and business use, would you like me to help narrow down the best product options and prepare a more suitable wholesale quote for you?
```

`shipping_address_request_no_reply` applies when our latest AI/human message asked the customer for a shipping address or U.S. address and the customer did not continue.

`staff_next_step_question_no_reply` applies when our latest AI/human message asked the customer to confirm the next step, quantity, product choice, or whether to proceed, and the customer did not continue.

`general_no_reply_after_staff_message` applies when no more specific status matches, but the latest AI/human message is newer than the latest customer message.

Suggested human follow-up for general no-reply:

```text
Hi, just checking in - would you like me to help with anything else, such as product options, pricing, shipping, or the next step for your order?
```

## Telegram Format

Normal follow-up reminders use this format:

```text
【客户回访提醒】

客户阶段：{status}
回访节点：{followup_stage}
优先级：{priority}
接待客服：{staff_name}
接待客服ID：{staff_id}

WS名称：{ws_display_name}
客户名称：{customer_name}
联系方式：{phone/email}
搜索关键词：{search_keyword}

客户最近消息：
{last_customer_message}

我们最后回复：
{last_agent_message}

AI分析：
{analysis}

建议人工回访话术：
{suggested_message}

操作建议：
请人工进入 SaleSmartly，使用“搜索关键词”找到该客户，确认上下文后再手动发送，不要盲目复制。
```

## High-Risk Handoff Statuses

High-risk statuses create `【需要人工接入】` and are not affected by quiet hours:

```text
ai_doubt
call_request
shipping_info
complaint_or_after_sales
payment_dispute
angry_customer
```

## Automatic Schedule

### Option A: External HTTP Timer, recommended for current Vercel plan

Use an external HTTP scheduler to call once per hour:

```text
https://wukai8775-max-salesmartly-telegram.vercel.app/api/cron-analyze-followups?secret=<CRON_SECRET>
```

This is currently the safest option because Vercel returned a deployment failure for an active hourly `vercel.json` cron config on this project. That usually means the current Vercel plan does not support hourly Cron frequency.

### Option B: Vercel Cron, only when the plan supports hourly cron

This repo includes `vercel.hourly-cron.example.json` as a copyable example:

```json
{
  "crons": [
    {
      "path": "/api/cron-analyze-followups",
      "schedule": "0 * * * *"
    }
  ]
}
```

If the Vercel plan supports hourly Cron, copy this file to `vercel.json` and redeploy.

## Cron Endpoint

`GET /api/cron-analyze-followups`:

- requires `CRON_SECRET`;
- accepts `Authorization: Bearer <CRON_SECRET>` or `?secret=<CRON_SECRET>`;
- returns 401 if `CRON_SECRET` is missing or does not match;
- never uses `force=true`;
- keeps `FOLLOWUP_MODE=telegram_only`;
- never calls `sendSaleSmartlyMessage`.

Response shape:

```json
{
  "ok": true,
  "success": true,
  "mode": "telegram_only",
  "cron": true,
  "auto_customer_send_disabled": true,
  "quiet_hours_enabled": true,
  "quiet_hours_active": false,
  "quiet_timezone": "Asia/Shanghai",
  "quiet_start": "13:00",
  "quiet_end": "19:00",
  "scanned": 50,
  "telegram_alerts_created": 0,
  "tasks_created": 0,
  "skipped": 0,
  "errors": 0,
  "deferred_by_quiet_hours": 0,
  "results": [
    {
      "latest_customer_message_time": "2026-07-01T01:00:00.000Z",
      "latest_agent_message_time": "2026-07-01T02:00:00.000Z",
      "last_message_direction": "agent",
      "detected_status": "general_no_reply_after_staff_message",
      "skipped_reason": "",
      "next_due_stage": "3h",
      "next_due_at": "2026-07-01T05:00:00.000Z",
      "duplicate_stage": ""
    }
  ]
}
```

## Quiet Hours

Quiet hours are disabled by default:

```text
FOLLOWUP_QUIET_HOURS_ENABLED=false
```

Recommended setting:

```text
FOLLOWUP_QUIET_HOURS_ENABLED=true
FOLLOWUP_QUIET_TIMEZONE=Asia/Shanghai
FOLLOWUP_QUIET_START=13:00
FOLLOWUP_QUIET_END=19:00
FOLLOWUP_QUIET_BEHAVIOR=defer
```

When quiet hours are active, low-risk `【客户回访提醒】` messages are deferred instead of sent. High-risk `【需要人工接入】` alerts are still sent immediately.

During quiet hours, a low-risk due reminder:

- does not send Telegram;
- does not write `followup_logs.action_type=telegram_alert`;
- does not update `last_auto_followup_at`;
- creates or updates a `followup_tasks` row with `status=deferred`;
- sets `skipped_reason=quiet_hours_deferred`;
- sets `scheduled_at` to quiet-hour end time;
- may write a skipped log with `reason=quiet_hours_deferred`, which does not count as a sent reminder.

After quiet hours end, the next analyzer run sends the deferred reminder if the customer still has not replied and has not entered opt-out or high-risk state. Only `telegram_alert` logs and `sent` tasks count as completed follow-up stages.

## Manual Analyze Endpoint

Manual trigger:

```bash
curl -X POST "https://your-domain.vercel.app/api/analyze-followups" \
  -H "Content-Type: application/json" \
  -H "x-salesmartly-webhook-secret: <SALES_SMARTLY_WEBHOOK_SECRET>" \
  --data-raw '{"limit":50}'
```

`force=true` still respects quiet hours:

```bash
curl -X POST "https://your-domain.vercel.app/api/analyze-followups?force=true" \
  -H "Content-Type: application/json" \
  -H "x-salesmartly-webhook-secret: <SALES_SMARTLY_WEBHOOK_SECRET>" \
  --data-raw '{"limit":50}'
```

Admin bypass for testing:

```bash
curl -X POST "https://your-domain.vercel.app/api/analyze-followups?force=true&bypass_quiet=true" \
  -H "Content-Type: application/json" \
  -H "x-salesmartly-webhook-secret: <SALES_SMARTLY_WEBHOOK_SECRET>" \
  --data-raw '{"limit":50}'
```

Even with `bypass_quiet=true`, the system only sends Telegram reminders. It never sends customer-facing messages.

## Supabase SQL

Run this in Supabase SQL Editor for a fresh setup:

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
  assigned_staff_name text,
  assigned_staff_id text,
  last_agent_sender_name text,
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
  sender_id text,
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

Upgrade SQL for existing tables:

```sql
alter table customers add column if not exists assigned_staff_name text;
alter table customers add column if not exists assigned_staff_id text;
alter table customers add column if not exists last_agent_sender_name text;
alter table messages add column if not exists sender_id text;
```

No new database columns are required for new follow-up statuses. `customers.current_status` and `followup_tasks.status` are text columns.

## SaleSmartly Official Webhook

Use this if token validation works:

```text
URL: https://your-domain.vercel.app/api/salesmartly-official-webhook
Method: POST
Header: x-salesmartly-webhook-token = <SALES_SMARTLY_WEBHOOK_TOKEN>
Events: new message notification, customer information sync
```

If token validation keeps failing, use:

```text
URL: https://wukai8775-max-salesmartly-telegram.vercel.app/api/salesmartly-official-webhook-yuan-alert
Method: POST
```

The webhook stores messages/customers in Supabase. It can also send immediate high-risk Telegram alerts, including submitted shipping information. These alerts are not affected by quiet hours.

## HelpKnow Telegram Webhook

```text
URL: https://your-domain.vercel.app/api/salesmartly-telegram-webhook
Method: POST
Header: x-salesmartly-webhook-secret = <SALES_SMARTLY_WEBHOOK_SECRET>
```

Only high-risk handoff cases send Telegram from this endpoint:

```text
shipping_info
call_request
ai_doubt
```

Normal sales questions return `not_a_handoff_trigger` so HelpKnow / Omen / Jett can continue replying normally.

## STAFF_ID_NAME_MAP

Optional JSON object string:

```json
{
  "1195645": "管理",
  "1201817": "剑冰",
  "1192958": "邱恺",
  "1201819": "银萍",
  "1192960": "杨翔钦",
  "1192964": "林欣雅",
  "1192975": "林霖",
  "1192978": "林雪钦",
  "1192979": "郑文彬",
  "1199741": "Omen Agent",
  "1203624": "Jett Agent"
}
```

Single-line Vercel env value:

```text
{"1195645":"管理","1201817":"剑冰","1192958":"邱恺","1201819":"银萍","1192960":"杨翔钦","1192964":"林欣雅","1192975":"林霖","1192978":"林雪钦","1192979":"郑文彬","1199741":"Omen Agent","1203624":"Jett Agent"}
```

If invalid, the interfaces do not crash. A safe parse error summary is logged without tokens, phone numbers, or emails.

## Test Follow-Up Analysis

This endpoint does not write Supabase, Telegram, or SaleSmartly.

Core dry-run scenarios:

```bash
curl "https://your-domain.vercel.app/api/test-followup-analysis?scenario=first_greeting_no_reply"
curl "https://your-domain.vercel.app/api/test-followup-analysis?scenario=quality_trust_question_no_reply"
curl "https://your-domain.vercel.app/api/test-followup-analysis?scenario=b2b_wholesale_interest_no_reply"
curl "https://your-domain.vercel.app/api/test-followup-analysis?scenario=shipping_address_request_no_reply"
curl "https://your-domain.vercel.app/api/test-followup-analysis?scenario=staff_next_step_question_no_reply"
curl "https://your-domain.vercel.app/api/test-followup-analysis?scenario=general_no_reply_after_staff_message"
curl "https://your-domain.vercel.app/api/test-followup-analysis?scenario=customer_replied_after_agent"
curl "https://your-domain.vercel.app/api/test-followup-analysis?scenario=quote_no_reply"
curl "https://your-domain.vercel.app/api/test-followup-analysis?scenario=ai_doubt"
curl "https://your-domain.vercel.app/api/test-followup-analysis?scenario=call_request"
curl "https://your-domain.vercel.app/api/test-followup-analysis?scenario=opt_out"
```

Quiet-hours dry-run scenarios:

```bash
curl "https://your-domain.vercel.app/api/test-followup-analysis?scenario=quiet_price_deferred"
curl "https://your-domain.vercel.app/api/test-followup-analysis?scenario=quiet_ai_doubt"
curl "https://your-domain.vercel.app/api/test-followup-analysis?scenario=quiet_force_deferred&force=true"
curl "https://your-domain.vercel.app/api/test-followup-analysis?scenario=quiet_force_bypass&force=true&bypass_quiet=true"
curl "https://your-domain.vercel.app/api/test-followup-analysis?scenario=quiet_after_end_deferred_task"
curl "https://your-domain.vercel.app/api/test-followup-analysis?scenario=quiet_deferred_log_not_duplicate"
```

Expected general no-reply result:

```json
{
  "status_detected": "general_no_reply_after_staff_message",
  "last_message_direction": "agent",
  "telegram_alert_allowed": true,
  "followup_stage": "3h",
  "would_send_customer": false
}
```

Expected shipping address request result:

```json
{
  "status_detected": "shipping_address_request_no_reply",
  "telegram_alert_allowed": true,
  "followup_stage": "3h",
  "would_send_customer": false
}
```

Expected B2B/wholesale result:

```json
{
  "status_detected": "b2b_wholesale_interest_no_reply",
  "telegram_alert_allowed": true,
  "followup_stage": "3h",
  "would_send_customer": false
}
```

Expected customer-replied result:

```json
{
  "last_message_direction": "customer",
  "telegram_alert_allowed": false,
  "would_send_customer": false
}
```

Expected quiet low-risk result:

```json
{
  "quiet_hours_enabled": true,
  "quiet_hours_active": true,
  "deferred_by_quiet_hours": 1,
  "task_preview_status": "deferred",
  "would_send_customer": false
}
```

Expected high-risk quiet result:

```json
{
  "manual_handoff_required": true,
  "telegram_alert_allowed": true,
  "deferred_by_quiet_hours": 0,
  "would_send_customer": false
}
```

Staff mapping scenarios:

```bash
curl "https://your-domain.vercel.app/api/test-followup-analysis?scenario=staff_map_yinping&force=true"
curl "https://your-domain.vercel.app/api/test-followup-analysis?scenario=staff_map_jett_agent&force=true"
```

## Logging

The analyzer writes safe summary logs only:

```text
cron analyze started
followup analysis completed
quiet_hours_enabled
quiet_hours_active
quiet_timezone
deferred_by_quiet_hours
telegram_alerts_created
tasks_created
skipped
errors
mode=telegram_only
```

Per-customer result rows include diagnostic fields:

```text
latest_customer_message_time
latest_agent_message_time
last_message_direction
detected_status
skipped_reason
next_due_stage
next_due_at
duplicate_stage
```

Logs must not include tokens, service role keys, full phone numbers, or full email addresses.

## Official Docs Used

- Vercel Cron Jobs: https://vercel.com/docs/cron-jobs
- Managing Vercel Cron Jobs: https://vercel.com/docs/cron-jobs/manage-cron-jobs
- SaleSmartly API use: https://help-en.salesmartly.com/docs/api-use
- API header `external-sign`: https://help-en.salesmartly.com/docs/obtain-instructions-for-the-header-parameter-of-api
- Active sending webhook: https://apifox.com/apidoc/shared-c1f4db0d-60eb-42c7-98f7-66c65bc09fdf/doc-3048234
