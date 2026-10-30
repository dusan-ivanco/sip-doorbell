# SIP Doorbell

A Home Assistant Lovelace card that turns a dashboard into a video intercom panel. It registers to a SIP server over WebSocket (WebRTC) using [JsSIP](https://jssip.net). When a call comes in, you can answer, hang up and trigger actions such as opening a gate or unlocking a door.

It is designed to work with the companion server setup in [sip-server](https://github.com/dusan-ivanco/sip-server): Asterisk + coturn + a Home Assistant webhook automation.

## Features

- Shows a live camera stream (`ha-camera-stream`) while idle.
- When an incoming call arrives, shows the **pickup** and **hangup** buttons.
- Once a call is answered, switches to the SIP video and two-way audio.
- Configurable **access buttons** (gate, door, lock, …) that run any Home Assistant tap action during a call.
- Hangup on a ringing call briefly answers it and then ends it right away, instead of rejecting it.
- Can navigate to a chosen dashboard view after hangup, for example back to home.
- Can run on many devices (tablets, phones, browsers) at once. All of them register as the same SIP account and ring together.

## How it fits together

```
 ┌──────────────┐  SIP/TLS (5061)  ┌───────────────────────────┐  WSS + WebRTC  ┌──────────────────┐
 │  Intercom    │ ───────────────► │  Asterisk (sip-server)    │ ◄────────────► │  HA dashboard    │
 │  (ext. 999)  │   dials 001      │  ConfBridge doorbell_room │                │  sip-doorbell    │
 └──────────────┘                  │  + scripts/doorbell       │                │  card (ext. 001) │
                                   └─────────────┬─────────────┘                └────────┬─────────┘
                                                 │ webhook                               │ STUN/TURN
                                                 ▼ sip_notify?state=wakeup|cancel        ▼
                                   ┌───────────────────────────┐                ┌──────────────────┐
                                   │  Home Assistant           │                │  coturn          │
                                   │  automation "SIP Notify"  │                │  (3478 / 5349)   │
                                   └───────────────────────────┘                └──────────────────┘
```

1. The intercom (PJSIP endpoint `999`, TLS) dials extension `001`.
2. Asterisk answers and puts the intercom into the ConfBridge room `doorbell_room`. The room uses SFU video and plays music on hold to the intercom while it is alone. Asterisk then starts the `doorbell` script in the background.
3. The script:
   - calls the Home Assistant webhook `sip_notify?state=wakeup`, which takes a camera snapshot and sends a push notification;
   - looks up every registered contact of `001` (every open card, up to 25) and originates a call to each one into the same room.
4. The first card that answers joins the room. The script then hangs up the other ringing panels and sends `state=cancel`, which clears the notification.
5. If nobody answers within 60 seconds, or the intercom hangs up, the room is cleared. An answered call can last at most 1 hour.

## Requirements

- Home Assistant served over **HTTPS**. Browsers allow camera and microphone access only in a secure context.
- A SIP server with a WebSocket (WSS) transport and WebRTC enabled on the endpoint, for example the [sip-server](https://github.com/dusan-ivanco/sip-server) setup.
- A STUN/TURN server for clients behind NAT or on mobile data (coturn in sip-server).
- Permission for the browser or Companion app to use the microphone and camera. The card asks for it when it loads.

## Installation

### HACS (recommended)

1. HACS → ⋮ → **Custom repositories** → add `https://github.com/dusan-ivanco/sip-doorbell` with type **Dashboard**.
2. Install **SIP Doorbell**.
3. Check that the resource `/hacsfiles/sip-doorbell/sip-doorbell.js` is registered as a **JavaScript module**. HACS normally adds it for you.

### Manual

Copy `sip-doorbell.js` and `jssip.js` to `config/www/community/sip-doorbell/`, then add the resource:

```yaml
url: /hacsfiles/sip-doorbell/sip-doorbell.js
type: module
```

> The card imports JsSIP from the fixed path `/hacsfiles/sip-doorbell/jssip.js`, so both files must be in that directory.

## Configuration

The card is meant for a dedicated view, for example `/lovelace/doorbell`, ideally in **panel** mode. It fills the whole viewport height.

```yaml
type: custom:sip-doorbell
server:
  sip:
    url: wss://sip.domain.tld/ws
    username: 001@sip.domain.tld
    credential: secret
  ice:
    - urls: stun:stun.domain.tld:3478
    - urls: turn:turn.domain.tld:3478
      username: turn
      credential: secret
access:
  - icon: mdi:gate
    click:
      entity: input_boolean.gate_lock
      tap_action:
        action: toggle
return: /lovelace/home
camera: camera.doorbell
```

| Option              | Required | Description |
|---------------------|----------|-------------|
| `server.sip.url`        | yes | WebSocket URL of the SIP server (`wss://…/ws`). With plain Asterisk this is the TLS HTTP server, by default `wss://host:8089/ws`. |
| `server.sip.username`   | yes | SIP identity in the form `user@domain`. `sip:` is added automatically. |
| `server.sip.credential` | yes | SIP password. |
| `server.ice`            | no  | List of [`RTCIceServer`](https://developer.mozilla.org/en-US/docs/Web/API/RTCIceServer) objects (STUN/TURN). |
| `access`                | no  | Buttons shown during an answered call. Each has an `icon` (MDI) and a `click` action config (`entity`, `tap_action`, … as in standard cards). |
| `return`                | no  | Dashboard path to navigate to after the **hangup** button is pressed. |
| `camera`                | no  | Camera entity shown while no call is active. |

### Button behaviour

| State                  | Visible buttons |
|------------------------|-----------------|
| Idle                   | none, only the camera stream |
| Incoming call (ringing)| pickup, hangup |
| Call answered          | access buttons, hangup |

Several cards with the same `server.sip` config on one page share one SIP user agent. The agent is keyed by a SHA-1 hash of the SIP config and stored in `window.sipDoorbell`.

## Server side (sip-server)

The [sip-server](https://github.com/dusan-ivanco/sip-server) repository contains a ready-made setup laid out as files under `/etc`. It runs on Docker with systemd units:

| Path | Purpose |
|------|---------|
| `etc/docker/compose/asterisk/` | Asterisk 22 (`andrius/asterisk:22`, host network) |
| `…/etc/asterisk/pjsip.conf` | Transports (UDP/TCP 5060, TLS 5061, WSS) and endpoints `001` (WebRTC, the card) and `999` (TLS, the intercom). Set `external_*_address`, `local_net`, `from_domain` and passwords. |
| `…/etc/asterisk/http.conf` | HTTP/HTTPS server that serves the WebSocket (`8088` / `8089`). |
| `…/etc/asterisk/extensions.conf` | Dialplan: `_XXX` puts the caller into ConfBridge and starts the script; context `doorbell` connects the answering panel. |
| `…/etc/asterisk/confbridge.conf` | Profiles `doorbell_bridge` (SFU video), `doorbell_device`, `doorbell_agents`. |
| `…/etc/asterisk/rtp.conf` | RTP range `10000–11000` and ICE host candidate mapping (private → public IP). |
| `…/var/lib/asterisk/scripts/doorbell` | Ring-all and cleanup script. It calls the HA webhook, so set your HA URL here (`https://hass.domain.tld/api/webhook/sip_notify`). |
| `etc/docker/compose/coturn/` | coturn STUN/TURN server (3478 / 5349). The bootstrap `turnadmin` commands are in `server.conf`. |
| `etc/certs/base/` | TLS certificate and key shared by Asterisk and coturn. |
| `etc/nftables.conf` | Firewall rules (SIP, TURN, RTP 10000–11000, SSH). |
| `etc/systemd/system/*.service` | `asterisk.service` and `coturn.service` (`docker compose up -d`). |
| `var/Home Assistant/*.sample` | HA `input_boolean.sip_notify` and the **SIP Notify** webhook automation. |

Codecs are limited to `alaw` and `h264`, so the intercom must support them.

### Home Assistant automation

The automation in `var/Home Assistant/automations.yaml.sample` listens on the webhook `sip_notify`:

- `state=wakeup`: turns on `input_boolean.sip_notify` and sends a high-priority push notification (`notify.user`). The notification opens `/lovelace/doorbell` and shows a live picture from `camera.doorbell` through `/api/camera_proxy/`. The Companion app fetches the picture when the notification is delivered.
- any other state (`cancel`): if `input_boolean.sip_notify` is on, turns it off and clears the notification (`clear_notification`, tag `Doorbell`).

The automation runs in `queued` mode, so a `cancel` that arrives right after `wakeup` is not dropped. The webhook is `local_only`, so the Asterisk host must reach Home Assistant from the local network. Set `local_only: false` if it calls HA from outside.

Replace `notify.user` with your own notify service and `camera.doorbell` with your camera.

## Troubleshooting

Open the browser console. The card logs:

- `SIP-DOORBELL x.y.z IS INSTALLED` (green): registered to the SIP server.
- `… INSTALLATION FAILED` (red): registration failed. Check the URL, credentials and certificate.
- `Incoming call acquired / accepted`, `Call session ended / failed: <cause>`.

Common problems:

- **Card stays blank / no permission**: the dashboard is not on HTTPS, or the microphone or camera is blocked for the site or app.
- **Call connects but no audio/video**: NAT. Check the `server.ice` TURN credentials, `external_media_address` and `rtp.conf` ICE mapping, and that UDP `10000–11000` is open.
- **WebSocket does not connect**: the WSS port (Asterisk `8089`, or your reverse proxy in front of it) must be reachable from the client.

## Credits

- [JsSIP](https://jssip.net) 3.13.9, MIT License. The bundled `jssip.js` is included as-is.
