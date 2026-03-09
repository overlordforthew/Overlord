# Memory for 120363424015261408

Created: 2026-02-21T16:28:01.110Z

## Chat Config
- Chat ID: 120363424015261408 (group chat)
- Model policy: SONNET ONLY for all members EXCEPT Gil (Gil gets Opus)
- All group members have access to Overlord via Sonnet

## People
- @198105651802364 = Ailie (Gil's kid)
- Gil's kids: Ayisha, Monet, Ailie (older — resume/portfolio sites), Alan, Seneca (younger)

## Key Facts
- Gil is admin of the server
- namibarden.com is deployed via Coolify (container prefix: ock0wowgsgwwww8w00400k00, suffix changes on each deploy)
- Coolify app ID: 5 (resourceName: namibarden, projectName: beast-mode)
- Site is nginx:alpine behind Coolify's Traefik proxy (upgraded from Caddy)
- Coolify auto-deploys from GitHub main branch (when webhooks work)

## Preferences
- When Gil replies to Overlord's message, he's talking to Overlord and wants acknowledgment + action
- Max turns set to 100 (was 25). Chunk work into manageable pieces to stay within limits
- Gil expects Overlord to just do what needs doing without asking too many questions
- ALWAYS fix errors automatically — never just report an error and ask to "try again", auto-retry/fix instead
- In group chats: don't respond to every message — only jump in when clearly addressed or can add genuine value

## Notes
- Proxy is now Traefik v3.6 (not Caddy), managed by Coolify
- Custom file-based Traefik config at /traefik/dynamic/namibarden.yaml inside coolify-proxy container
- CRITICAL: namibarden.yaml has hardcoded container name in the service URL. When Coolify deploys, the container suffix changes and the file config breaks (502). Fix: update the URL in namibarden.yaml to match the new container name.
- The file config also defines routes for openclaw.namibarden.com and coolify.namibarden.com (Tailscale-only)
- HTTP->HTTPS redirect is 308 permanent (set by Traefik file config)
- www.namibarden.com properly redirects to namibarden.com (308)
- Docker labels AND file config both define routes — file config has priority: 100 to win
