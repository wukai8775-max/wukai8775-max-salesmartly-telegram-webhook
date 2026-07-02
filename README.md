# SaleSmartly / HelpKnow / Telegram Webhook

Vercel Serverless API for SaleSmartly and HelpKnow.

Current mode: AI analysis + Telegram human follow-up reminders.

The system does not automatically send messages to SaleSmartly customers. HelpKnow / Omen / Jett continue handling normal customer replies. All Telegram alerts go to TELEGRAM_CHAT_ID.

## Core Follow-Up Rule

Normal follow-up reminders are based on message direction first.

If the latest ai or human message is newer than the latest customer message, the last message was sent by us and the customer has not replied yet. In that case, the customer enters the Telegram human follow-up reminder flow.

Reminder timing is based on latest agent reply time plus:

```text
3h / 6h / 9h / 24h / 48h / 72h
```

Customer status is used for customer stage, AI analysis, suggested wording, and priority. Staff ownership is a hard gate for ordinary reminders only.

Ordinary follow-up reminders are limited to this staff allowlist:

```text
Omen: 1199730
Omen Agent: 1199741
Jett Agent: 1203624
```

Configure it with:

```text
FOLLOWUP_REMINDER_STAFF_ID_ALLOWLIST=1199730,1199741,1203624
```

Only customers whose customers.assigned_staff_id or latest ai/human messages.sender_id is in this allowlist can create ordinary customer follow-up reminders. Customers assigned to other staff are skipped with staff_not_in_followup_allowlist. High-risk handoff alerts are not blocked by this allowlist.

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
FOLLOWUP_REMINDER_STAFF_ID_ALLOWLIST=1199730,1199741,1203624
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

FOLLOWUP_MODE=telegram_only has highest priority. Even if AUTO_FOLLOWUP_ENABLED=true, the analyzer does not call SaleSmartly active-send APIs and does not send customer-facing messages.

TELEGRAM_FOLLOWUP_CHAT_ID is retained only for backward compatibility. Current code does not prioritize it. All reminders and emergency alerts go to TELEGRAM_CHAT_ID.

## Follow-Up Flow

SaleSmartly webhook only receives new events and writes customer/message data into Supabase. It does not scan old conversations or decide whether a customer needs follow-up.

The follow-up logic runs in /api/analyze-followups. If no scheduler calls that endpoint, Telegram follow-up reminders only happen when you manually call it from PowerShell or another HTTP client.

/api/cron-analyze-followups is the scheduled wrapper around the same analysis logic.

## Low-Risk Reminder Statuses

Low-risk statuses create customer follow-up reminders, never send customer-facing messages, and obey quiet hours:

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

High-risk statuses create need-human-handoff alerts and are not affected by quiet hours or the ordinary staff allowlist:

```text
ai_doubt
call_request
shipping_info
complaint_or_after_sales
payment_dispute
angry_customer
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
请人工进入 SaleSmartly，使用搜索关键词找到该客户，确认上下文后再手动发送，不要盲目复制。
```

High-risk reminders use:

```text
【需要人工接入】
```

## Cron For cron-job.org

cron-job.org has an about 30 second execution timeout. The cron endpoint is therefore paginated and time bounded.

Use a small job first:

```text
https://wukai8775-max-salesmartly-telegram.vercel.app/api/cron-analyze-followups?secret=<CRON_SECRET>&limit=50&offset=0
```

Recommended sharded cron-job.org setup:

```text
/api/cron-analyze-followups?secret=<CRON_SECRET>&limit=50&offset=0
/api/cron-analyze-followups?secret=<CRON_SECRET>&limit=50&offset=50
/api/cron-analyze-followups?secret=<CRON_SECRET>&limit=50&offset=100
```

The cron endpoint is stateless. It does not require a new database cursor table. Use next_offset or next_cursor from the response as the next offset if you want an external scheduler to rotate through pages. When the endpoint reaches the end of the customer list, next_offset resets to 0.

## Cron Endpoint

GET /api/cron-analyze-followups:

```text
requires CRON_SECRET
accepts Authorization: Bearer <CRON_SECRET> or ?secret=<CRON_SECRET>
returns 401 if CRON_SECRET is missing or does not match
supports limit, offset, cursor, and page
defaults to limit=50
caps limit at 100
uses cursor as an alias for offset
treats page as 1-based, so page=2&limit=50 equals offset=50
stops before cron-job.org timeout, normally around the 20 second mark
never uses force=true
keeps FOLLOWUP_MODE=telegram_only
never calls sendSaleSmartlyMessage
```

Cron response fields include:

```text
ok
success
mode
cron
auto_customer_send_disabled
quiet_hours_enabled
quiet_hours_active
quiet_timezone
quiet_start
quiet_end
followup_staff_allowlist_enabled
followup_staff_allowlist
staff_allowlist_hits
staff_allowlist_skipped
skipped_by_staff_not_allowlisted
partial
limit
offset
next_offset
next_cursor
processed_count
elapsed_ms
stopped_reason
scanned
telegram_alerts_created
tasks_created
skipped
errors
deferred_by_quiet_hours
results
```

Example result meaning:

```text
partial=true means this run did not cover the full customer table.
next_offset=50 means the next shard can call offset=50.
stopped_reason=more_pages_available means the batch completed but more rows exist.
stopped_reason=time_budget_exceeded means the runner stopped early to avoid timeout.
next_offset=0 means the scanner reached the end and can restart from the first page.
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

When quiet hours are active, low-risk customer follow-up reminders are deferred instead of sent. High-risk need-human-handoff alerts are still sent immediately.

During quiet hours, a low-risk due reminder:

```text
does not send Telegram
does not write followup_logs.action_type=telegram_alert
does not update last_auto_followup_at
creates or updates a followup_tasks row with status=deferred
sets skipped_reason=quiet_hours_deferred
sets scheduled_at to quiet-hour end time
may write a skipped log with reason=quiet_hours_deferred, which does not count as a sent reminder
```

After quiet hours end, the next analyzer run sends the deferred reminder if the customer still has not replied and has not entered opt-out or high-risk state. Only telegram_alert logs and sent tasks count as completed follow-up stages.

## Manual Analyze Endpoint

Manual trigger:

```text
POST https://your-domain.vercel.app/api/analyze-followups
Header: x-salesmartly-webhook-secret: <SALES_SMARTLY_WEBHOOK_SECRET>
Body: {limit:50, offset:0}
```

Manual analyze also supports limit, offset, cursor, and page. limit is capped at 100.

force=true still respects quiet hours:

```text
/api/analyze-followups?force=true&limit=50&offset=0
```

Admin quiet-hours bypass for testing:

```text
/api/analyze-followups?force=true&bypass_quiet=true&limit=50&offset=0
```

Even with bypass_quiet=true, the system only sends Telegram reminders. It never sends customer-facing messages.

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

No new database columns are required for cron pagination. followup_tasks.status is text and can already store deferred.

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

Normal sales questions return not_a_handoff_trigger so HelpKnow / Omen / Jett can continue replying normally.

## STAFF_ID_NAME_MAP

Optional JSON object string. Include these IDs at minimum:

```text
1199730 = Omen
1199741 = Omen Agent
1203624 = Jett Agent
```

Full suggested mapping:

```text
1195645 = 管理
1199730 = Omen
1201817 = 剑冰
1192958 = 邱恺
1201819 = 银萍
1192960 = 杨翔钦
1192964 = 林欣雅
1192975 = 林霖
1192978 = 林雪钦
1192979 = 郑文彬
1199741 = Omen Agent
1203624 = Jett Agent
```

If STAFF_ID_NAME_MAP is invalid JSON, the interfaces do not crash. A safe parse error summary is logged without tokens, phone numbers, or emails.

## Test Follow-Up Analysis

This endpoint does not write Supabase, Telegram, or SaleSmartly.

Core dry-run scenarios:

```text
/api/test-followup-analysis?scenario=first_greeting_no_reply
/api/test-followup-analysis?scenario=quality_trust_question_no_reply
/api/test-followup-analysis?scenario=b2b_wholesale_interest_no_reply
/api/test-followup-analysis?scenario=shipping_address_request_no_reply
/api/test-followup-analysis?scenario=staff_next_step_question_no_reply
/api/test-followup-analysis?scenario=general_no_reply_after_staff_message
/api/test-followup-analysis?scenario=customer_replied_after_agent
/api/test-followup-analysis?scenario=staff_allowlist_omen_1199730
/api/test-followup-analysis?scenario=staff_allowlist_omen_agent_1199741
/api/test-followup-analysis?scenario=staff_allowlist_jett_agent_1203624
/api/test-followup-analysis?scenario=staff_not_allowlisted_1201819
/api/test-followup-analysis?scenario=staff_missing_id
/api/test-followup-analysis?scenario=quote_no_reply
/api/test-followup-analysis?scenario=ai_doubt
/api/test-followup-analysis?scenario=call_request
/api/test-followup-analysis?scenario=opt_out
```

Quiet-hours dry-run scenarios:

```text
/api/test-followup-analysis?scenario=quiet_price_deferred
/api/test-followup-analysis?scenario=quiet_ai_doubt
/api/test-followup-analysis?scenario=quiet_force_deferred&force=true
/api/test-followup-analysis?scenario=quiet_force_bypass&force=true&bypass_quiet=true
/api/test-followup-analysis?scenario=quiet_after_end_deferred_task
/api/test-followup-analysis?scenario=quiet_deferred_log_not_duplicate
```

Expected staff allowlist result:

```text
staff_in_followup_allowlist=true
telegram_alert_allowed=true
would_send_customer=false
```

Expected non-allowlisted staff result:

```text
staff_id=1201819
staff_in_followup_allowlist=false
telegram_alert_allowed=false
skipped_reason=staff_not_in_followup_allowlist
would_send_customer=false
```

Expected missing staff ID result:

```text
staff_in_followup_allowlist=false
telegram_alert_allowed=false
skipped_reason=staff_not_in_followup_allowlist
would_send_customer=false
```

Expected high-risk result:

```text
manual_handoff_required=true
telegram_alert_allowed=true
would_send_customer=false
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
partial
limit
offset
next_offset
processed_count
elapsed_ms
stopped_reason
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
assigned_staff_id
assigned_staff_name
staff_in_followup_allowlist
skipped_reason=staff_not_in_followup_allowlist
```

Logs must not include tokens, service role keys, full phone numbers, or full email addresses.
