# Security policy

## Reporting a vulnerability

Please report security issues privately via GitHub's
["Report a vulnerability"](../../security/advisories/new) (Security tab →
Advisories) rather than opening a public issue. Include steps to reproduce
and the version (shown in Settings) if you can.

## Deployment notes

- **Set `ALLOWED_CALDAV_HOSTS`** if the app is reachable from the internet.
  Unset, the login endpoint will connect to any host the server can reach,
  which makes it usable to probe your internal network.
- Run behind a TLS-terminating reverse proxy and set `TRUST_PROXY=true` so
  login rate limiting sees real client IPs.
- Keep `SESSION_SECRET` secret; it encrypts the session cookie, which holds
  the user's CalDAV credentials.
- Subscription feeds are fetched server-side with private/loopback/link-local
  addresses blocked, redirects re-validated, and size/time limits applied.
