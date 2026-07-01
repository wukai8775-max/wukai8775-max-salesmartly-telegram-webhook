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

Optional compatibility and staff mapping variables:

```text
STAFF_ID_NAME_MAP=
TELEGRAM_FOLLOWUP_CHAT_ID=
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

All Telegram alerts are sent to `TELEGRAM_CHAT_ID`:

```text
客户回访提醒
需要人工接入
客户提交收货信息
客户质疑 AI / bot
客户要求电话 / 视频
投诉 / 售后 / 付款争议等紧急提醒
```

`TELEGRAM_FOLLOWUP_CHAT_ID` is retained only for backward compatibility and is not prioritized by the current code.

## STAFF_ID_NAME_MAP

`STAFF_ID_NAME_MAP` is an optional JSON object string. It maps SaleSmartly staff IDs to readable staff names when webhook payloads only provide an ID.

Recommended Vercel value:

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

If `STAFF_ID_NAME_MAP` is invalid JSON, the interfaces do not crash. The code writes a safe log with the parse error name/message only, then keeps showing `接待客服：未识别` when no other name source exists.

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

If your tables already exist, run this upgrade SQL once:

```sql
alter table customers add column if not exists assigned_staff_name text;
alter table customers add column if not exists assigned_staff_id text;
alter table customers add column if not exists last_agent_sender_name text;
alter table messages add column if not exists sender_id text;
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
assigned_staff_name / assigned_staff_id
assigned_ai_employee
last_agent_sender_name
last_message
message_time
direction
raw_payload
```

When the official webhook receives a customer message that looks like submitted shipping information, it also sends the Telegram alert `【客户已提交收货信息】` to `TELEGRAM_CHAT_ID`.

The shipping information alert also shows `接待客服` and `接待客服ID`. The value is resolved from the saved customer fields first, then from the latest `messages.sender_name` / `messages.sender_id` where `direction` is `human` or `ai`, then from `STAFF_ID_NAME_MAP` if only an ID is available.

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
SaleSmartly -> Vercel -> Supabase -> /api/analyze-followups -> TELEGRAM_CHAT_ID group reminder -> human follow-up
```

`/api/analyze-followups` only reads Supabase conversation data, creates `followup_tasks`, writes `followup_logs`, and sends Telegram reminders. It never sends messages to customers and does not change the normal HelpKnow / Omen / Jett customer reply flow.

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

High-risk scenarios. These only create Telegram `【需要人工接入】` alerts:

```text
ai_doubt
call_request
shipping_info
complaint_or_after_sales
payment_dispute
angry_customer
```

Permanent opt-out phrases stop all future follow-up reminders:

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
3h after the latest AI/human staff message if the customer has not replied
6h after the latest AI/human staff message if the customer has not replied
9h after the latest AI/human staff message if the customer has not replied
24h after the latest AI/human staff message if the customer has not replied
48h after the latest AI/human staff message if the customer has not replied
72h after the latest AI/human staff message if the customer has not replied
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
优先级：{priority}
接待客服：{staff_name or 未识别}
接待客服ID：{staff_id or 未识别}

WS名称：{ws_display_name}
客户名称：{customer_name}
联系方式：{phone/email}
搜索关键词：{ws_display_name or customer_name or phone or email or contact_id}

客户最近消息：
{last_customer_message}

AI分析：
{analysis}

建议人工回访话术：
{English suggested message}

操作建议：
请人工进入 SaleSmartly，使用“搜索关键词”找到该客户，确认上下文后再手动发送，不要盲目复制。
```

High-risk Telegram title:

```text
【需要人工接入】
```

High-risk alerts also include:

```text
接待客服：{staff_name or 未识别}
接待客服ID：{staff_id or 未识别}
```

## Staff Detection

Telegram follow-up and handoff alerts show both `接待客服` and `接待客服ID`.

Staff name detection priority:

```text
customers.assigned_staff_name
customers.assigned_ai_employee
customers.last_agent_sender_name
latest messages.sender_name where direction is human or ai
SaleSmartly payload staff / agent / assignee / owner / service_user / operator fields
if staff name is still 未识别 and staff ID exists: STAFF_ID_NAME_MAP[staff_id]
未识别
```

Staff ID detection priority:

```text
customers.assigned_staff_id
SaleSmartly payload staff_id / agent_id / assignee_id / owner_id / service_user_id / operator_id fields
latest messages.sender_id where direction is human or ai
未识别
```

Payload aliases include:

```text
assigned_staff_name / assigned_staff_id
staff_name / staff_id / staff.name / staff.id
agent_name / agent_id / agent.name / agent.id
operator_name / operator_id / operator.name / operator.id
owner_name / owner_id / owner.name / owner.id
service_user_name / service_user_id / service_user.name / service_user.id
assignee_name / assignee_id / assignee.name / assignee.id
handler_name / handler_id / handler.name / handler.id
member_name / member_id / member.name / member.id
user_name / user_id / user.name / user.id
kefu_name / kefu_id
customer_service_name / customer_service_id
ai_employee_name
receptionist
customer_service
```

When a webhook event is stored with `direction=human` or `direction=ai`:

- `messages.sender_name` is filled from the best staff name candidate;
- `messages.sender_id` is filled when the column exists and a staff ID is available;
- `customers.last_agent_sender_name` is updated;
- empty `customers.assigned_staff_name` / `customers.assigned_staff_id` fields are filled from the same staff profile.

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
- send all Telegram alerts to `TELEGRAM_CHAT_ID`;
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

Built-in scenario tests:

```bash
curl "https://your-domain.vercel.app/api/test-followup-analysis?scenario=staff_omen&force=true"
curl "https://your-domain.vercel.app/api/test-followup-analysis?scenario=staff_jett&force=true"
curl "https://your-domain.vercel.app/api/test-followup-analysis?scenario=staff_map_yinping&force=true"
curl "https://your-domain.vercel.app/api/test-followup-analysis?scenario=staff_map_jett_agent&force=true"
curl "https://your-domain.vercel.app/api/test-followup-analysis?scenario=staff_map_unknown&force=true"
curl "https://your-domain.vercel.app/api/test-followup-analysis?scenario=no_staff&force=true"
curl "https://your-domain.vercel.app/api/test-followup-analysis?scenario=handoff_jett&force=true"
curl "https://your-domain.vercel.app/api/test-followup-analysis?scenario=duplicate_stage"
```

Expected staff map results when `STAFF_ID_NAME_MAP` is configured:

```json
{
  "staff_name": "银萍",
  "staff_id": "1201819",
  "staff_source": "env.STAFF_ID_NAME_MAP"
}
```

```json
{
  "staff_name": "Jett Agent",
  "staff_id": "1203624",
  "staff_source": "env.STAFF_ID_NAME_MAP"
}
```

Expected fallback when ID is not mapped:

```json
{
  "staff_name": "未识别",
  "staff_id": "0000000"
}
```

Other useful built-in scenarios:

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
```

Duplicate stage test should not create the same reminder stage again, and `would_send_customer` remains `false`.

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
