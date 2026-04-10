import '/hacsfiles/sip-doorbell/jssip.js';

window.customCards = window.customCards || [];
window.customCards.push({
  type:'sip-doorbell',
  name:'SIP Doorbell',
  description:'The SIP Doorbell card allows you to integrate your intercom unit.'
});

class sipDoorbell extends HTMLElement {
  constructor() {
    super();
    this.attachShadow({mode:'open'});
    window.sipDoorbell = window.sipDoorbell || {};

    this.version = '0.0.1';
    this.startup = {
      content:false,
      control:false
    };

    window.addEventListener('beforeunload', () => {
      if(window.sipDoorbell[this.config.worker]) {
        window.sipDoorbell[this.config.worker].stop();
      }
    });
  }

  getCardSize() {
    return 1;
  }

  setConfig(config) {
    this.config = {
      server:{
        sip:config?.server?.sip ? config?.server?.sip : {},
        opt:{
          mediaConstraints:{
            audio:true,
            video:true
          },
          pcConfig:{
            iceServers:config?.server?.ice ? config?.server?.ice : [],
            bundlePolicy:'balanced',
            rtcpMuxPolicy:'require',
            iceTransportPolicy:'all',
            iceCandidatePoolSize:0
          }
        }
      },
      access:config?.access ? config?.access : [],
      return:config?.return ? config?.return : '',
      camera:{
        entity:config?.camera ? config?.camera : '',
        player:''
      }
    };

    crypto.subtle.digest('SHA-1', new TextEncoder().encode(JSON.stringify(this.config.server.sip))).then((b) => {
      this.config.worker = Array.from(new Uint8Array(b)).map((d) => d.toString(16).padStart(2, '0')).join('');

      if(this.startup.content === false) {
        this.startup.content = true;
        this.content();
      }

      if(this.startup.control === false) {
        this.startup.control = true;
        this.control();
      }
    });

    navigator.mediaDevices.getUserMedia({
      audio:true,
      video:true
    }).then((e) => {
      e.getTracks().forEach((t) => t.stop());
    }).catch(() => {
      throw new Error('SIP Doorbel require audio/video permission');
    });
  }

  set hass(hass) {
    this._hass = hass;

    if(this.config.camera.entity && this.config.camera.player) {
      this.config.camera.player.hass = hass;
      this.config.camera.player.stateObj = hass.states[this.config.camera.entity];
    }
  }

  content() {
    this.shadowRoot.innerHTML = `
      <style>
        ha-camera-stream {
          width: inherit;
          height: inherit;

          --video-max-width: calc(100%);
          --video-max-height: calc(100vh - var(--header-height));
        }

        ha-icon {
          margin: 30px;
          padding: 15px;
          cursor: pointer;

          border-width: 2px;
          border-radius: 50%;
          border-style: solid;

          color: white;
          --mdc-icon-size: 30px;

          transition: all 0.25s;
          box-shadow: 0 5px 10px rgba(0, 0, 0, 0.5);
        }

        ha-icon:hover {
          transform: scale(1.05);
          box-shadow: 0 15px 25px rgba(0, 0, 0, 0.5);
        }

        ha-icon:active {
          transform: scale(0.95);
          box-shadow: 0 4px 8px rgba(0, 0, 0, 0.5);
        }

        #arena {
          width: calc(100%);
          height: calc(100vh - var(--header-height));

          display: flex;
          align-items: center;
          justify-content: center;

          background: black;
        }

        #audio {
          display: none;
        }

        #video {
          width: 100%;
          height: 100%;

          display: none;
          align-items: center;
          justify-content: center;
        }

        #scene {
          width: 100%;
          height: 100%;

          display: flex;
          align-items: center;
          justify-content: center;
        }

        #panel {
          left: 0;
          right: 0;
          bottom: 0;
          position: absolute;
        }

        #panel span {
          display: flex;
          align-items: center;
          justify-content: space-evenly;
        }

        #audio audio {
          width: inherit;
          height: inherit;
        }

        #video video {
          width: inherit;
          height: inherit;
        }

        [data-key="pickup"] {
          display: none;
          background: green;
        }

        [data-key="hangup"] {
          display: none;
          background: red;
        }

        ${this.config.access.map((d, i) => `[data-key="C${i}"] {display: none; background: blue;}`).join('')}
      </style>

      <ha-card id="arena">
        <div id="audio"><audio autoplay playsinline></audio></div>
        <div id="video"><video autoplay playsinline></video></div>
        <div id="scene"></div>
        <div id="panel">
          <span>
            ${this.config.access.map((d, i) => `<ha-icon data-key="C${i}" icon="${d.icon}"></ha-icon>`).join('')}
            <ha-icon data-key="pickup" icon="mdi:phone"></ha-icon>
            <ha-icon data-key="hangup" icon="mdi:phone-hangup"></ha-icon>
          </span>
        </div>
      </ha-card>
    `;
  }

  control() {
    if(this.config.camera.entity) {
      this.config.camera.player = Object.assign(document.createElement('ha-camera-stream'), {
        hass:this._hass,
        stateObj:this._hass.states[this.config.camera.entity]
      });

      this.config.camera.player.setAttribute('muted', '');
      this.element('#scene').replaceChildren(this.config.camera.player);
    }

    if(window.sipDoorbell[this.config.worker]) {
      window.sipDoorbell[this.config.worker].stop();
    }

    window.sipDoorbell[this.config.worker] = new JsSIP.UA({
      sockets:new JsSIP.WebSocketInterface(this.config.server.sip.url),
      uri:'sip:' + this.config.server.sip.username,
      password:this.config.server.sip.credential
    });

    if(window.sipDoorbell[this.config.worker]) {
      window.sipDoorbell[this.config.worker].on('newRTCSession', (rtc) => {
        const stream = (c) => {
          c.ontrack = (e) => {
            if(e.track.kind === 'audio') {
              this.element('#audio audio').srcObject = e.streams[0];
            }

            if(e.track.kind === 'video') {
              this.element('#video video').srcObject = e.streams[0];
            }
          };
        };

        if(rtc.session.direction === 'incoming') {
          console.info('%cIncoming call acquired:' + ' ' + rtc.session.remote_identity, 'color: blue;');
          this.incoming_call_accepted = false;

          this.element('[data-key="pickup"]').setAttribute('style', 'display: initial;');
          this.element('[data-key="hangup"]').setAttribute('style', 'display: initial;');
          this.config.access.forEach((d, i) => this.element('[data-key="C' + i + '"]').setAttribute('style', 'display: none;'));

          rtc.session.on('accepted', () => {
            if(this.incoming_call_accepted !== null) {
              console.info('%cIncoming call accepted:' + ' ' + rtc.session.remote_identity, 'color: yellow;');
              this.incoming_call_accepted = true;

              this.element('#video').setAttribute('style', 'display: flex;');
              this.element('#scene').setAttribute('style', 'display: none;');

              this.element('[data-key="pickup"]').setAttribute('style', 'display: none;');
              this.element('[data-key="hangup"]').setAttribute('style', 'display: initial;');
              this.config.access.forEach((d, i) => this.element('[data-key="C' + i + '"]').setAttribute('style', 'display: initial;'));
            }
          });

          this.element('[data-key="pickup"]').addEventListener('click', () => {
            rtc.session.answer(this.config.server.opt);
          });

          this.element('[data-key="hangup"]').addEventListener('click', () => {
            if(this.incoming_call_accepted) {
              rtc.session.terminate();
            } else {
              this.incoming_call_accepted = null;

              rtc.session.on('accepted', () => {
                rtc.session.terminate();
              });

              rtc.session.answer(this.config.server.opt);
            }

            if(this.config.return) {
              this.dispatchEvent(new CustomEvent('hass-action', {
                detail:{
                  action:'tap',
                  config:{
                    tap_action:{
                      action:'navigate',
                      navigation_path:this.config.return
                    }
                  }
                },
                bubbles:true,
                composed:true
              }));
            }
          });
        }

        if(rtc.session.connection) {
          stream(rtc.session.connection);
        } else {
          rtc.session.on('peerconnection', () => stream(rtc.session.connection));
        }

        rtc.session.on('ended', (e) => {
          console.info('%cCall session ended:' + ' ' + e.cause, 'color: red;');
          this.cleanup();
        });

        rtc.session.on('failed', (e) => {
          console.info('%cCall session failed:' + ' ' + e.cause, 'color: red;');
          this.cleanup();
        });

        this.config.access.forEach((d, i) => {
          this.element('[data-key="C' + i + '"]').addEventListener('click', () => {
            this.dispatchEvent(new CustomEvent('hass-action', {
              detail:{
                action:'tap',
                config:d.click
              },
              bubbles:true,
              composed:true
            }));
          });
        });
      });

      window.sipDoorbell[this.config.worker].on('registered', () => {
        console.info('%cSIP-DOORBELL ' + this.version + ' IS INSTALLED', 'color: green; font-weight: bold;');
      });

      window.sipDoorbell[this.config.worker].on('unregistered', () => {
        console.info('%cSIP-DOORBELL ' + this.version + ' IS UNINSTALLED', 'color: yellow; font-weight: bold;');
      });

      window.sipDoorbell[this.config.worker].on('registrationFailed', () => {
        console.info('%cSIP-DOORBELL ' + this.version + ' INSTALLATION FAILED', 'color: red; font-weight: bold;');
      });

      window.sipDoorbell[this.config.worker].start();
    }

    this.cleanup();
  }

  cleanup() {
    this.factory('[data-key="pickup"]');
    this.factory('[data-key="hangup"]');
    this.config.access.forEach((d, i) => this.factory('[data-key="C' + i + '"]'));

    this.element('#video').removeAttribute('style');
    this.element('#scene').removeAttribute('style');
  }

  element(e) {
    return this.shadowRoot.querySelector(e);
  }

  factory(e) {
    const o = this.element(e);
    const n = o.cloneNode(true);

    n.removeAttribute('style');
    o.parentNode.replaceChild(n, o);
  }

  static getStubConfig() {
    return {
      server:{
        sip:{
          url:'wss://sip.domain.tld/ws',
          username:'001@sip.domain.tld',
          credential:'secret'
        },
        ice:[{
          urls:'stun:stun.domain.tld:3478'
        }, {
          urls:'turn:turn.domain.tld:3478',
          username:'turn',
          credential:'secret'
        }]
      },
      access:[{
        icon:'mdi:gate',
        click:{
          entity:'input_boolean.gate_lock',
          tap_action:{
            action:'toggle'
          }
        }
      }],
      return:'/lovelace/home',
      camera:'camera.doorbell'
    };
  }
}

customElements.define('sip-doorbell', sipDoorbell);
