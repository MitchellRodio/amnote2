# Creator Tasks, Stateless Slack to HubSpot

This version has no internal database. Slack commands read from Slack and HubSpot only. HubSpot is the source of truth for tasks, owners, and Slack channel to company links.

## Required env vars

```bash
SLACK_BOT_TOKEN=xoxb-...
SLACK_APP_TOKEN=xapp-...
SLACK_SIGNING_SECRET=unused-in-socket-mode
HUBSPOT_ACCESS_TOKEN=pat-na1-...
HUBSPOT_SLACK_CHANNEL_OBJECT_TYPE=2-xxxxxxxx
```

Optional:

```bash
HUBSPOT_OWNER_ID=
HUBSPOT_OWNER_EMAIL=
HUBSPOT_TASK_TO_COMPANY_ASSOCIATION_TYPE_ID=192
HUBSPOT_SLACK_CHANNEL_TO_COMPANY_ASSOCIATION_TYPE_ID=
```

## HubSpot properties used

Tasks need these custom properties if they do not already exist:

- slack_channel_id
- slack_channel_name
- slack_user_id
- slack_source_message_link
- slack_context_snippet
- hubspot_company_id
- hubspot_company_name

SlackChannel custom object properties:

- channel_id
- channel_name
- company_id

## Commands

- /link <company name> searches HubSpot companies, asks you to pick one, then stores the channel link in the HubSpot SlackChannel custom object.
- /todo creates a HubSpot task for the linked company.
- /todos lists your open HubSpot tasks in the current Slack channel.
- /list lists your open HubSpot tasks across channels.
- /mytodos same as /list.

## Notes

Slack email to HubSpot owner matching requires Slack to return user.profile.email from users.info. If your workspace does not grant email access, leave HUBSPOT_OWNER_ID or HUBSPOT_OWNER_EMAIL as a fallback, or pick an owner from the /todo dropdown.
