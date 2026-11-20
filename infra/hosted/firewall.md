# Cloud firewall for the hosted server

One firewall in front of the server (DigitalOcean: Networking, Firewalls). Docker publishes ports past `ufw`, so the cloud firewall is the only place these limits hold. Set it once per server, or attach the same firewall to a new server by tag. It does not change per customer: every customer's number arrives through the same phone supplier.

A rule can be changed while calls are in progress; nothing restarts.

## Inbound rules

| Port | Protocol | Sources | For |
|---|---|---|---|
| 22 | TCP | the operator's own addresses only | SSH |
| 80 | TCP | all | Caddy, certificate renewal and redirect |
| 443 | TCP | all | Caddy, LiveKit signalling for browser calls |
| 7881 | TCP | all | LiveKit media over TCP, browser calls |
| 7882 | UDP | all | LiveKit media over UDP, browser calls |
| 5060 | TCP | the phone supplier's signalling ranges | SIP from the supplier |
| 10000-10200 | UDP | the phone supplier's media range | phone audio |

Everything else is blocked. There is no rule for 5060/udp: the supplier is told to use TCP. Ports 7880 (LiveKit API) and 6379 (Valkey) listen on 127.0.0.1 only and need no rule.

Never open 5060 to all addresses. It was open on staging for one day in November 2026 and scanners were sending call attempts within hours.

## Twilio (the supplier on staging since 2026-11-19)

Signalling, for 5060/tcp. Twilio says to accept all of them:

```
54.169.127.128/30
54.65.63.192/30
54.252.254.64/30
54.172.60.0/30
54.244.51.0/30
54.171.127.192/30
35.156.191.128/30
177.71.206.192/30
```

Media, for 10000-10200/udp:

```
168.86.128.0/18
```

Source: Twilio's Elastic SIP Trunking address page, read on 2026-11-19. Twilio announces changes to these ranges; when it does, change the two rules and nothing else.

What was seen on staging: both first answered calls arrived from `54.169.127.128` and `54.169.127.129`, inside the first range, and after the rule was limited on 2026-11-20 the SIP log showed only Twilio. The media range was applied the same day; a call with audio through it has not been confirmed in these records.

## If a call connects but there is no sound

Widen the 10000-10200/udp rule to all addresses, call again, and if sound returns the media range is wrong or has changed. Put the corrected range in and narrow the rule again.
