export const CUSTOM_PAGE_HTML = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>WhatsApp by GREEN-API</title>
  <style>
    :root {
      --bg: #f5f6f8;
      --surface: #ffffff;
      --surface-muted: #f9fafb;
      --border: #e4e7ec;
      --text: #101828;
      --muted: #667085;
      --brand: #3b9702;
      --brand-hover: #317e02;
      --brand-ring: rgba(59, 151, 2, 0.18);
      --danger: #d92d20;
      --danger-hover: #b42318;
      --danger-soft: #fef3f2;
      --radius: 12px;
      --shadow: 0 1px 2px rgba(16, 24, 40, 0.05);
    }

    * { box-sizing: border-box; margin: 0; padding: 0; }
    [hidden] { display: none !important; }

    body {
      font: 14px/1.5 -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
      color: var(--text);
      background: var(--bg);
      padding: 24px;
      -webkit-font-smoothing: antialiased;
    }

    a { color: var(--brand); text-decoration: none; }
    a:hover { text-decoration: underline; }

    .page { max-width: 1120px; margin: 0 auto; }

    .topbar {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 16px;
      margin-bottom: 20px;
      flex-wrap: wrap;
    }
    .brand { display: flex; align-items: center; gap: 12px; }
    .brand svg { width: 36px; height: 36px; flex: none; }
    .brand h1 { font-size: 18px; font-weight: 700; letter-spacing: -0.01em; }
    .brand p { color: var(--muted); font-size: 13px; }
    .account { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; justify-content: flex-end; }
    .account-info { text-align: right; }
    .account-name { font-size: 13px; font-weight: 500; }
    .account-id { color: #98a2b3; font-size: 11px; }
    .account-id span { font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; user-select: all; }

    .layout {
      display: grid;
      grid-template-columns: minmax(0, 1fr) 360px;
      gap: 20px;
      align-items: start;
    }

    .card {
      background: var(--surface);
      border: 1px solid var(--border);
      border-radius: var(--radius);
      box-shadow: var(--shadow);
    }
    .card-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 12px;
      padding: 16px 20px;
      border-bottom: 1px solid var(--border);
    }
    .card-title { display: flex; align-items: center; gap: 8px; font-size: 15px; font-weight: 600; }
    .count {
      min-width: 22px;
      padding: 0 7px;
      border-radius: 999px;
      background: #f2f4f7;
      color: var(--muted);
      font-size: 12px;
      font-weight: 600;
      text-align: center;
    }
    .card-body { padding: 20px; }
    .phone-card { position: sticky; top: 24px; }

    .btn {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      gap: 6px;
      height: 36px;
      padding: 0 14px;
      border: 1px solid transparent;
      border-radius: 8px;
      font: inherit;
      font-weight: 600;
      white-space: nowrap;
      cursor: pointer;
      transition: background-color 0.15s, border-color 0.15s, color 0.15s, box-shadow 0.15s;
    }
    .btn:focus-visible { outline: none; box-shadow: 0 0 0 3px var(--brand-ring); }
    .btn:disabled { opacity: 0.55; cursor: not-allowed; }
    .btn-primary { background: var(--brand); color: #fff; }
    .btn-primary:hover:not(:disabled) { background: var(--brand-hover); text-decoration: none; }
    .btn-secondary { background: var(--surface); border-color: var(--border); color: var(--text); }
    .btn-secondary:hover:not(:disabled) { background: var(--surface-muted); text-decoration: none; }
    .btn-danger { background: var(--danger); color: #fff; }
    .btn-danger:hover:not(:disabled) { background: var(--danger-hover); }
    .btn-ghost-danger { background: transparent; color: var(--danger); }
    .btn-ghost-danger:hover:not(:disabled) { background: var(--danger-soft); }
    .btn-sm { height: 30px; padding: 0 10px; font-size: 13px; }
    .btn-lg { height: 44px; font-size: 15px; }
    .btn-block { width: 100%; }

    .field { display: flex; flex-direction: column; gap: 6px; }
    .field + .field { margin-top: 14px; }
    label { font-size: 13px; font-weight: 600; }
    .optional { color: var(--muted); font-weight: 400; }
    input, select {
      width: 100%;
      height: 38px;
      padding: 0 12px;
      border: 1px solid var(--border);
      border-radius: 8px;
      background: var(--surface);
      color: var(--text);
      font: inherit;
    }
    input::placeholder { color: #98a2b3; }
    input:focus, select:focus { outline: none; border-color: var(--brand); box-shadow: 0 0 0 3px var(--brand-ring); }
    select:disabled { background: var(--surface-muted); color: var(--muted); }
    .input-with-button { position: relative; }
    .input-with-button input { padding-right: 64px; }
    .input-with-button .btn { position: absolute; right: 4px; top: 4px; height: 30px; }
    .hint { color: var(--muted); font-size: 12px; }

    .badge {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      padding: 2px 9px;
      border-radius: 999px;
      font-size: 12px;
      font-weight: 600;
      white-space: nowrap;
    }
    .badge::before { content: ""; width: 6px; height: 6px; border-radius: 50%; background: currentColor; }
    .badge.ok { color: #067647; background: #ecfdf3; }
    .badge.warn { color: #b54708; background: #fffaeb; }
    .badge.bad { color: #b42318; background: #fef3f2; }
    .badge.neutral { color: var(--muted); background: #f2f4f7; }
    .badge.live { color: #175cd3; background: #eff8ff; }

    .alert { padding: 11px 14px; border-radius: 8px; font-size: 13px; border: 1px solid transparent; }
    .alert.info { background: #eff8ff; border-color: #d1e9ff; color: #175cd3; }
    .alert.success { background: #ecfdf3; border-color: #abefc6; color: #067647; }
    .alert.warning { background: #fffaeb; border-color: #fedf89; color: #b54708; }
    .alert.error { background: #fef3f2; border-color: #fecdca; color: #b42318; }
    .alert strong { display: block; margin-bottom: 2px; }

    .add-panel { padding: 20px; border-bottom: 1px solid var(--border); background: var(--surface-muted); }
    .add-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 14px; }
    .add-grid .field + .field { margin-top: 0; }
    .add-grid .wide { grid-column: 1 / -1; }
    .form-actions { display: flex; align-items: center; justify-content: space-between; gap: 12px; margin-top: 16px; flex-wrap: wrap; }
    .form-actions .buttons { display: flex; gap: 8px; }
    #addResult:not(:empty) { margin-top: 14px; }

    .instance-row {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 16px;
      padding: 14px 20px;
    }
    .instance-row + .instance-row { border-top: 1px solid var(--border); }
    .instance-main { min-width: 0; flex: 1; }
    .instance-name { font-weight: 600; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .instance-meta { color: var(--muted); font-size: 12px; margin-top: 2px; }
    .instance-side { display: flex; align-items: center; gap: 12px; flex-wrap: wrap; justify-content: flex-end; }
    .instance-actions { display: flex; gap: 6px; }
    .rename { display: flex; gap: 6px; align-items: center; }
    .rename input { height: 30px; max-width: 280px; }

    .empty { padding: 36px 24px; text-align: center; color: var(--muted); }
    .empty-icon {
      width: 44px;
      height: 44px;
      margin: 0 auto 12px;
      border-radius: 50%;
      background: #eef7e6;
      color: var(--brand);
      display: grid;
      place-items: center;
      font-size: 20px;
    }
    .empty-title { color: var(--text); font-weight: 600; margin-bottom: 4px; }

    .phone-status {
      display: flex;
      gap: 12px;
      align-items: flex-start;
      padding: 14px;
      border: 1px solid var(--border);
      border-radius: 10px;
      background: var(--surface-muted);
    }
    .dot { width: 10px; height: 10px; border-radius: 50%; margin-top: 6px; flex: none; background: #98a2b3; }
    .dot.ready { background: #12b76a; }
    .dot.active { background: #12b76a; box-shadow: 0 0 0 4px rgba(18, 183, 106, 0.18); }
    .dot.ringing { background: #f79009; animation: pulse 1.2s infinite; }
    .dot.calling { background: #2e90fa; animation: pulse 1.2s infinite; }
    @keyframes pulse {
      0% { box-shadow: 0 0 0 0 rgba(247, 144, 9, 0.45); }
      70% { box-shadow: 0 0 0 9px rgba(247, 144, 9, 0); }
      100% { box-shadow: 0 0 0 0 rgba(247, 144, 9, 0); }
    }
    .phone-title { font-weight: 600; }
    .phone-detail { color: var(--muted); font-size: 12px; margin-top: 2px; word-break: break-word; }
    .phone-section { margin-top: 16px; }
    .dial-row { display: flex; gap: 8px; }
    .dial-row input { flex: 1; }
    .action-row { display: flex; gap: 8px; }
    .action-row .btn { flex: 1; }
    .join-row { display: flex; align-items: center; gap: 8px; margin-top: 8px; }
    .join-row .btn { flex: 1; }
    #phoneNotice { margin-top: 12px; }

    .tip {
      position: relative;
      display: inline-grid;
      place-items: center;
      width: 22px;
      height: 22px;
      flex: none;
      border-radius: 50%;
      border: 1px solid var(--border);
      background: var(--surface);
      color: var(--muted);
      font-size: 12px;
      font-weight: 700;
      cursor: help;
    }
    .tip:focus-visible { outline: none; box-shadow: 0 0 0 3px var(--brand-ring); }
    .tip::after {
      content: attr(data-tip);
      position: absolute;
      right: 0;
      bottom: calc(100% + 8px);
      width: 260px;
      padding: 10px 12px;
      border-radius: 8px;
      background: #101828;
      color: #fff;
      font-size: 12px;
      font-weight: 400;
      line-height: 1.45;
      text-align: left;
      box-shadow: 0 8px 24px rgba(16, 24, 40, 0.18);
      opacity: 0;
      visibility: hidden;
      transform: translateY(4px);
      transition: opacity 0.15s, transform 0.15s, visibility 0.15s;
      pointer-events: none;
      z-index: 10;
    }
    .tip:hover::after, .tip:focus::after { opacity: 1; visibility: visible; transform: translateY(0); }

    .center { display: grid; place-items: center; min-height: 60vh; text-align: center; color: var(--muted); }
    .spinner {
      width: 32px;
      height: 32px;
      margin: 0 auto 12px;
      border: 3px solid var(--border);
      border-top-color: var(--brand);
      border-radius: 50%;
      animation: spin 0.8s linear infinite;
    }
    @keyframes spin { to { transform: rotate(360deg); } }
    .fatal { max-width: 480px; margin: 10vh auto 0; }

    .modal-overlay {
      position: fixed;
      inset: 0;
      display: none;
      align-items: center;
      justify-content: center;
      padding: 20px;
      background: rgba(16, 24, 40, 0.45);
      z-index: 100;
    }
    .modal-overlay.open { display: flex; }
    .modal {
      width: 100%;
      max-width: 420px;
      padding: 20px;
      border-radius: var(--radius);
      background: var(--surface);
      box-shadow: 0 20px 48px rgba(16, 24, 40, 0.2);
    }
    .modal-title { font-size: 16px; font-weight: 600; margin-bottom: 6px; }
    .modal-body { color: var(--muted); }
    .modal-actions { display: flex; justify-content: flex-end; gap: 8px; margin-top: 20px; }

    @media (max-width: 900px) {
      body { padding: 16px; }
      .layout { grid-template-columns: 1fr; }
      .phone-card { position: static; }
    }
    @media (max-width: 600px) {
      .add-grid { grid-template-columns: 1fr; }
      .instance-row { flex-direction: column; align-items: stretch; }
      .instance-side { justify-content: space-between; }
      .account { justify-content: flex-start; }
      .account-info { text-align: left; }
    }
  </style>
</head>
<body>
  <div class="page">
    <div id="loading" class="center">
      <div>
        <div class="spinner"></div>
        Connecting...
      </div>
    </div>

    <div id="fatal" class="card fatal" hidden>
      <div class="card-body">
        <div class="alert error">
          <strong>Could not open the integration</strong>
          <span id="fatalMessage"></span>
        </div>
      </div>
    </div>

    <div id="main" hidden>
      <div class="topbar">
        <div class="brand">
          <svg viewBox="0 0 98.822 98.823" fill-rule="evenodd" clip-rule="evenodd" aria-hidden="true">
            <circle cx="49.411" cy="49.411" r="49.411" fill="#3B9702"/>
            <path fill="#fff" d="M80.075 18.748c-7.846,-7.847 -18.688,-12.701 -30.663,-12.701 -11.976,0 -22.818,4.854 -30.664,12.701 -7.847,7.847 -12.701,18.689 -12.701,30.664 0,11.975 4.854,22.817 12.701,30.664 7.847,7.846 18.689,12.7 30.664,12.7 11.975,0 22.816,-4.853 30.663,-12.7 7.847,-7.847 12.701,-18.689 12.701,-30.664 0,-11.975 -4.854,-22.817 -12.701,-30.664zm-3.425 3.425c-6.971,-6.97 -16.601,-11.282 -27.238,-11.282 -10.638,0 -20.269,4.312 -27.239,11.282 -6.97,6.97 -11.282,16.601 -11.282,27.239 0,10.637 4.312,20.268 11.282,27.238 6.97,6.97 16.601,11.282 27.239,11.282 10.637,0 20.267,-4.311 27.238,-11.282 6.97,-6.97 11.281,-16.601 11.281,-27.238 0,-10.638 -4.311,-20.268 -11.281,-27.239z"/>
            <path fill="#fff" d="M50.839 74.623c-3.9,0 -7.417,-0.627 -10.552,-1.88 -3.134,-1.254 -5.838,-3.018 -8.113,-5.293 -2.275,-2.275 -4.016,-4.945 -5.224,-8.01 -1.207,-3.064 -1.81,-6.407 -1.81,-10.029 0,-3.622 0.65,-6.964 1.95,-10.029 1.3,-3.064 3.122,-5.734 5.466,-8.009 2.346,-2.275 5.131,-4.04 8.358,-5.293 3.227,-1.254 6.768,-1.881 10.622,-1.881 2.646,0 5.165,0.348 7.556,1.045 2.391,0.697 4.573,1.648 6.547,2.855 1.973,1.208 3.61,2.577 4.91,4.11l-7.313 7.661c-1.671,-1.579 -3.47,-2.821 -5.397,-3.726 -1.927,-0.906 -4.098,-1.358 -6.513,-1.358 -1.996,0 -3.842,0.359 -5.536,1.079 -1.695,0.72 -3.181,1.741 -4.457,3.065 -1.277,1.323 -2.264,2.878 -2.961,4.666 -0.696,1.787 -1.044,3.726 -1.044,5.815 0,2.09 0.371,4.017 1.114,5.781 0.743,1.765 1.776,3.308 3.1,4.632 1.322,1.323 2.866,2.356 4.631,3.099 1.764,0.743 3.668,1.114 5.711,1.114 1.439,0 2.774,-0.22 4.005,-0.661 1.23,-0.442 2.321,-1.045 3.273,-1.811 0.952,-0.767 1.695,-1.672 2.229,-2.717 0.533,-1.045 0.801,-2.17 0.801,-3.377l0 -1.811 1.532 2.367 -13.303 0 0 -9.402 22.914 0c0.093,0.511 0.163,1.207 0.209,2.09 0.046,0.882 0.081,1.729 0.104,2.542 0.024,0.813 0.035,1.451 0.035,1.915 0,3.157 -0.568,6.047 -1.706,8.671 -1.137,2.624 -2.739,4.887 -4.806,6.791 -2.066,1.903 -4.492,3.378 -7.278,4.422 -2.785,1.045 -5.804,1.567 -9.054,1.567l0 0z"/>
          </svg>
          <div>
            <h1>WhatsApp by GREEN-API</h1>
            <p>Connect WhatsApp numbers to this account</p>
          </div>
        </div>
        <div class="account">
          <div class="account-info">
            <div id="accountName" class="account-name"></div>
            <div class="account-id">Account ID <span id="accountId"></span></div>
          </div>
          <span id="authBadge" class="badge neutral"></span>
        </div>
      </div>

      <div id="authAlert" class="alert warning" hidden>
        <strong>Authorization required</strong>
        This account has not finished connecting the app. Install the app again from the app marketplace to authorize it.
      </div>

      <div id="workspace" class="layout" hidden>
        <section class="card">
          <div class="card-header">
            <div class="card-title">WhatsApp instances <span id="instanceCount" class="count" hidden></span></div>
            <button id="addToggle" class="btn btn-primary btn-sm" type="button">+ Add instance</button>
          </div>

          <div id="addPanel" class="add-panel" hidden>
            <form id="addForm" autocomplete="off">
              <div class="add-grid">
                <div class="field">
                  <label for="instanceId">Instance ID</label>
                  <input id="instanceId" inputmode="numeric" placeholder="1101123456" required>
                </div>
                <div class="field">
                  <label for="instanceName">Name <span class="optional">(optional)</span></label>
                  <input id="instanceName" maxlength="100" placeholder="Sales team">
                </div>
                <div class="field wide">
                  <label for="apiToken">API token</label>
                  <div class="input-with-button">
                    <input id="apiToken" type="password" placeholder="Paste the instance API token" required>
                    <button id="tokenToggle" class="btn btn-secondary btn-sm" type="button">Show</button>
                  </div>
                </div>
              </div>
              <div class="form-actions">
                <span class="hint">Find the ID and token in the <a href="https://console.green-api.com/" target="_blank" rel="noopener noreferrer">GREEN-API console</a>.</span>
                <div class="buttons">
                  <button id="addCancel" class="btn btn-secondary" type="button">Cancel</button>
                  <button id="addSubmit" class="btn btn-primary" type="submit">Add instance</button>
                </div>
              </div>
              <div id="addResult"></div>
            </form>
          </div>

          <div id="instanceList"></div>
        </section>

        <aside id="phoneCard" class="card phone-card" hidden>
          <div class="card-header">
            <div class="card-title">Phone</div>
            <button id="phoneOff" class="btn btn-secondary btn-sm" type="button" hidden>Turn off</button>
          </div>
          <div class="card-body">
            <div class="field">
              <label for="phoneInstance">Call from</label>
              <select id="phoneInstance"></select>
            </div>

            <div class="phone-section">
              <div class="phone-status" aria-live="polite">
                <span id="phoneDot" class="dot"></span>
                <div>
                  <div id="phoneTitle" class="phone-title"></div>
                  <div id="phoneDetail" class="phone-detail"></div>
                </div>
              </div>
            </div>

            <div class="phone-section">
              <button id="phoneOn" class="btn btn-primary btn-lg btn-block" type="button">Turn on phone</button>

              <form id="dialForm" class="dial-row" hidden>
                <input id="phoneNumber" inputmode="tel" placeholder="Number with country code, e.g. 79001234567" aria-label="Phone number">
                <button class="btn btn-primary" type="submit">Call</button>
              </form>

              <div id="ringingActions" class="action-row" hidden>
                <button id="phoneAccept" class="btn btn-primary btn-lg" type="button">Accept</button>
                <button id="phoneDecline" class="btn btn-danger btn-lg" type="button">Decline</button>
              </div>

              <div id="callActions" hidden>
                <div class="action-row">
                  <button id="phoneMute" class="btn btn-secondary btn-lg" type="button" aria-pressed="false">Mute</button>
                  <button id="phoneHangUp" class="btn btn-danger btn-lg" type="button">Hang up</button>
                </div>
                <div id="joinRow" class="join-row" hidden>
                  <button id="phoneJoin" class="btn btn-secondary" type="button">Join this call</button>
                  <span class="tip" tabindex="0" aria-label="About Join" data-tip="The call is going on, but its sound is not on this page. That happens after you reload the page, or when the call was started or answered somewhere else: by a workflow, through the API or by another agent. Join moves the call's sound here; whoever had it before goes silent.">?</span>
                </div>
              </div>

              <div id="phoneNotice" class="alert" hidden></div>
            </div>
          </div>
        </aside>
      </div>
    </div>
  </div>

  <div id="modal" class="modal-overlay">
    <div class="modal" role="dialog" aria-modal="true" aria-labelledby="modalTitle">
      <div id="modalTitle" class="modal-title"></div>
      <div id="modalBody" class="modal-body"></div>
      <div class="modal-actions">
        <button id="modalCancel" class="btn btn-secondary" type="button">Cancel</button>
        <button id="modalConfirm" class="btn btn-primary" type="button">OK</button>
      </div>
    </div>
  </div>

  <script>
    function esc(value) {
      return String(value == null ? '' : value).replace(/[&<>"']/g, function (c) {
        return {'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'}[c];
      });
    }

    function $(id) {
      return document.getElementById(id);
    }

    function errorText(error) {
      return error && error.message ? error.message : String(error);
    }

    var STATE_BADGES = {
      authorized: ['ok', 'Connected'],
      notAuthorized: ['warn', 'Not authorized'],
      starting: ['neutral', 'Starting'],
      yellowCard: ['warn', 'Limited by WhatsApp'],
      pendingCode: ['warn', 'Waiting for code'],
      pendingPassword: ['warn', 'Waiting for password'],
      blocked: ['bad', 'Blocked'],
      suspended: ['bad', 'Suspended']
    };

    function stateBadge(state) {
      var badge = STATE_BADGES[state] || ['neutral', 'Unknown'];
      return '<span class="badge ' + badge[0] + '">' + esc(badge[1]) + '</span>';
    }

    class Modal {
      constructor() {
        this.overlay = $('modal');
        this.resolve = null;
        $('modalConfirm').addEventListener('click', () => this.close(true));
        $('modalCancel').addEventListener('click', () => this.close(false));
        this.overlay.addEventListener('click', (event) => {
          if (event.target === this.overlay) this.close(false);
        });
        document.addEventListener('keydown', (event) => {
          if (event.key === 'Escape' && this.overlay.classList.contains('open')) this.close(false);
        });
      }

      open(title, message, confirmText, confirmClass, withCancel) {
        $('modalTitle').textContent = title;
        $('modalBody').textContent = message;
        $('modalConfirm').textContent = confirmText;
        $('modalConfirm').className = 'btn ' + confirmClass;
        $('modalCancel').hidden = !withCancel;
        this.overlay.classList.add('open');
        setTimeout(() => $('modalConfirm').focus(), 50);
        return new Promise((resolve) => {
          this.resolve = resolve;
        });
      }

      close(result) {
        this.overlay.classList.remove('open');
        if (this.resolve) {
          this.resolve(result);
          this.resolve = null;
        }
      }

      error(message, title) {
        return this.open(title || 'Something went wrong', message, 'OK', 'btn-primary', false);
      }

      confirm(message, title, confirmText) {
        return this.open(title, message, confirmText, 'btn-danger', true);
      }
    }

    class PhonePanel {
      constructor(request) {
        this.request = request;
        this.phone = null;
        this.dialed = null;
        this.muted = false;
        this.availabilityRequest = 0;
        $('phoneOn').addEventListener('click', () => this.turnOn());
        $('phoneOff').addEventListener('click', () => this.turnOff());
        $('dialForm').addEventListener('submit', (event) => {
          event.preventDefault();
          this.dial();
        });
        $('phoneAccept').addEventListener('click', () => this.run(() => this.phone.accept()));
        $('phoneDecline').addEventListener('click', () => this.run(() => this.phone.reject()));
        $('phoneHangUp').addEventListener('click', () => this.run(() => this.phone.hangUp()));
        $('phoneJoin').addEventListener('click', () => this.run(() => this.phone.join()));
        $('phoneMute').addEventListener('click', () => this.toggleMute());
        $('phoneInstance').addEventListener('change', () => this.turnOff());
        this.render();
      }

      microphoneAllowed() {
        var policy = document.permissionsPolicy || document.featurePolicy;
        return !policy || typeof policy.allowsFeature !== 'function' || policy.allowsFeature('microphone');
      }

      async showInstances(instances) {
        var request = ++this.availabilityRequest;
        var callable = [];
        if (this.microphoneAllowed() && instances.length > 0) {
          try {
            var response = await this.request('/api/calls/availability');
            var result = await response.json();
            if (response.ok && result.success) {
              callable = instances.filter((instance) => result.instances[instance.id] === true);
            }
          } catch (error) {
            callable = [];
          }
        }
        if (request !== this.availabilityRequest) return;
        var select = $('phoneInstance');
        var current = select.value;
        select.innerHTML = callable.map((instance) => {
          return '<option value="' + esc(instance.id) + '">' + esc(instance.name) + ' (' + esc(instance.id) + ')</option>';
        }).join('');
        if (callable.some((instance) => instance.id === current)) {
          select.value = current;
        } else if (this.phone) {
          this.turnOff();
        }
        $('phoneCard').hidden = callable.length === 0;
      }

      dial() {
        var digits = $('phoneNumber').value.replace(/[^0-9]/g, '');
        if (digits.length < 7) {
          this.notice('Enter the full number with the country code.', 'error');
          return;
        }
        this.dialed = digits + '@c.us';
        this.run(() => this.phone.dial(this.dialed));
      }

      toggleMute() {
        this.muted = !this.muted;
        if (this.phone) this.phone.setMuted(this.muted);
        this.render();
      }

      async turnOn() {
        var instanceId = $('phoneInstance').value;
        if (!instanceId) return;
        var button = $('phoneOn');
        button.disabled = true;
        button.textContent = 'Turning on...';
        this.notice(null);
        try {
          var response = await this.request('/api/calls/phone-ticket', {
            method: 'POST',
            body: JSON.stringify({instanceId: instanceId})
          });
          var result = await response.json();
          if (!response.ok) throw new Error(result.message || 'Could not turn the phone on');
          var client = await import('/app/calls-phone/calls-phone.js');
          var protocol = location.protocol === 'https:' ? 'wss://' : 'ws://';
          var phone = new client.CallsPhone(protocol + location.host + result.url);
          phone.addEventListener('state', () => this.render());
          phone.addEventListener('media', () => this.render());
          phone.addEventListener('ended', (event) => {
            this.dialed = null;
            this.muted = false;
            this.render();
            this.notice('Call ended' + (event.detail && event.detail.reason ? ': ' + event.detail.reason : ''), 'info');
          });
          phone.addEventListener('error', (event) => this.notice(event.detail.message, 'error'));
          phone.addEventListener('closed', (event) => {
            this.phone = null;
            this.render();
            this.notice('The phone was disconnected' + (event.detail && event.detail.reason ? ': ' + event.detail.reason : '') + '. Turn it on again.', 'warning');
          });
          this.phone = phone;
          await phone.connect();
        } catch (error) {
          if (this.phone) this.phone.close();
          this.phone = null;
          this.notice(errorText(error), 'error');
        } finally {
          button.disabled = false;
          this.render();
        }
      }

      turnOff() {
        if (this.phone) {
          this.phone.close();
          this.phone = null;
        }
        this.dialed = null;
        this.muted = false;
        this.notice(null);
        this.render();
      }

      async run(action) {
        this.notice(null);
        try {
          await action();
        } catch (error) {
          this.notice(errorText(error), 'error');
        }
        this.render();
      }

      notice(text, kind) {
        var box = $('phoneNotice');
        box.hidden = !text;
        if (!text) return;
        box.className = 'alert ' + (kind || 'info');
        box.textContent = text;
      }

      peerLabel(info) {
        var wid = info && info.wid ? info.wid : '';
        if (wid.endsWith('@c.us')) return '+' + wid.split('@')[0];
        if (this.dialed) return '+' + this.dialed.split('@')[0];
        return info && info.name ? info.name : '';
      }

      whatsappId(info) {
        var wid = info && info.wid ? info.wid : '';
        return wid.endsWith('@lid') ? 'WhatsApp ID ' + wid.split('@')[0] : '';
      }

      render() {
        var phone = this.phone;
        var state = phone ? phone.state.state : 'off';
        if (state === 'off' || state === 'inc-call') this.dialed = null;
        var info = phone ? phone.state.info : null;
        var peer = this.peerLabel(info);
        var hiddenId = peer ? '' : this.whatsappId(info);
        var inCall = state === 'out-call' || state === 'on-call';
        var noAudio = !!phone && inCall && !phone.hasAudio;

        var views = {
          off: ['', 'Phone is off', 'Turn it on to make and answer WhatsApp calls on this page.'],
          idle: ['ready', 'Ready for calls', 'Incoming calls ring here while this page is open.'],
          'inc-call': ['ringing', peer ? 'Incoming call from ' + peer : 'Incoming call', hiddenId],
          'out-call': ['calling', 'Calling ' + (peer || 'the contact') + '...', noAudio ? 'This call was started somewhere else.' : 'Waiting for an answer.'],
          'on-call': ['active', peer ? 'On a call with ' + peer : 'On a call', noAudio ? 'The sound of this call is somewhere else.' : hiddenId]
        };
        var view = views[state] || views.off;
        $('phoneDot').className = 'dot ' + view[0];
        $('phoneTitle').textContent = view[1];
        $('phoneDetail').textContent = view[2];
        $('phoneDetail').hidden = !view[2];

        $('phoneOn').hidden = !!phone;
        if (!phone) $('phoneOn').textContent = 'Turn on phone';
        $('phoneOff').hidden = !phone;
        $('phoneInstance').disabled = state === 'inc-call' || inCall;
        $('dialForm').hidden = state !== 'idle';
        $('ringingActions').hidden = state !== 'inc-call';
        $('callActions').hidden = !inCall;
        $('joinRow').hidden = !noAudio;
        $('phoneMute').hidden = noAudio;
        $('phoneMute').textContent = this.muted ? 'Unmute' : 'Mute';
        $('phoneMute').setAttribute('aria-pressed', String(this.muted));
      }
    }

    class App {
      constructor() {
        this.encryptedUserData = null;
        this.locationId = null;
        this.instances = [];
        this.editing = null;
        this.phone = new PhonePanel((url, options) => this.request(url, options));

        window.addEventListener('message', (event) => {
          if (event.data && event.data.message === 'REQUEST_USER_DATA_RESPONSE') this.onUserData(event.data.payload);
        });
        window.parent.postMessage({message: 'REQUEST_USER_DATA'}, '*');
        this.timeout = setTimeout(() => {
          this.fail('The sign-in data did not arrive. Reload the page to try again.');
        }, 10000);

        $('addToggle').addEventListener('click', () => this.toggleAddForm(true));
        $('addCancel').addEventListener('click', () => this.toggleAddForm(false));
        $('addForm').addEventListener('submit', (event) => this.addInstance(event));
        $('tokenToggle').addEventListener('click', () => {
          var input = $('apiToken');
          var show = input.type === 'password';
          input.type = show ? 'text' : 'password';
          $('tokenToggle').textContent = show ? 'Hide' : 'Show';
        });
        $('instanceList').addEventListener('click', (event) => this.onListClick(event));
        $('instanceList').addEventListener('submit', (event) => this.onRename(event));
      }

      request(url, options) {
        options = options || {};
        var headers = Object.assign({'Content-Type': 'application/json', 'X-GHL-Context': this.encryptedUserData}, options.headers || {});
        return fetch(url, Object.assign({}, options, {headers: headers}));
      }

      async onUserData(encrypted) {
        if (!encrypted) {
          this.fail('The sign-in data was empty. Reload the page to try again.');
          return;
        }
        this.encryptedUserData = encrypted;
        try {
          var response = await fetch('/app/decrypt-user-data', {
            method: 'POST',
            headers: {'Content-Type': 'application/json'},
            body: JSON.stringify({encryptedData: encrypted})
          });
          var result = await response.json();
          if (!result.success) {
            this.fail(result.error || 'Could not read the sign-in data.');
            return;
          }
          clearTimeout(this.timeout);
          this.locationId = result.locationId;
          this.showMain(result);
          if (result.user && result.user.hasTokens) await this.loadInstances();
        } catch (error) {
          this.fail('Network error: ' + errorText(error));
        }
      }

      fail(message) {
        clearTimeout(this.timeout);
        $('loading').hidden = true;
        $('main').hidden = true;
        $('fatal').hidden = false;
        $('fatalMessage').textContent = message;
      }

      showMain(data) {
        $('loading').hidden = true;
        $('main').hidden = false;
        var who = data.userData.userName || data.userData.email || '';
        $('accountName').textContent = who;
        $('accountName').hidden = !who;
        $('accountId').textContent = data.locationId;
        var ready = !!(data.user && data.user.hasTokens);
        $('authBadge').className = 'badge ' + (ready ? 'ok' : 'warn');
        $('authBadge').textContent = ready ? 'Connected' : 'Not authorized';
        $('authAlert').hidden = ready;
        $('workspace').hidden = !ready;
      }

      async loadInstances() {
        try {
          var response = await this.request('/api/instances/' + encodeURIComponent(this.locationId));
          var result = await response.json();
          if (!response.ok || !result.success) throw new Error(result.message || 'Could not load the instances');
          this.instances = result.instances;
          this.renderInstances();
          this.phone.showInstances(this.instances);
        } catch (error) {
          $('instanceList').innerHTML = '<div class="card-body"><div class="alert error">' + esc(errorText(error)) + '</div></div>';
        }
      }

      renderInstances() {
        var count = $('instanceCount');
        count.hidden = this.instances.length === 0;
        count.textContent = String(this.instances.length);
        if (this.instances.length === 0) {
          $('instanceList').innerHTML =
            '<div class="empty">' +
            '<div class="empty-icon">+</div>' +
            '<div class="empty-title">No instances yet</div>' +
            '<div>Add a GREEN-API instance to send and receive WhatsApp messages and calls in this account.</div>' +
            '</div>';
          this.toggleAddForm(true);
          return;
        }
        $('instanceList').innerHTML = this.instances.map((instance) => this.instanceRow(instance)).join('');
      }

      instanceRow(instance) {
        var id = esc(instance.id);
        var added = instance.createdAt
          ? new Date(instance.createdAt).toLocaleDateString(undefined, {year: 'numeric', month: 'short', day: 'numeric'})
          : '';
        var name = this.editing === instance.id
          ? '<form class="rename" data-id="' + id + '">' +
            '<input name="name" value="' + esc(instance.name) + '" maxlength="100" aria-label="Instance name" required>' +
            '<button class="btn btn-primary btn-sm" type="submit">Save</button>' +
            '<button class="btn btn-secondary btn-sm" type="button" data-action="cancel-rename">Cancel</button>' +
            '</form>'
          : '<div class="instance-name" title="' + esc(instance.name) + '">' + esc(instance.name) + '</div>';
        return '<div class="instance-row">' +
          '<div class="instance-main">' + name +
          '<div class="instance-meta">ID ' + id + (added ? ' · Added ' + esc(added) : '') + '</div>' +
          '</div>' +
          '<div class="instance-side">' + stateBadge(instance.state) +
          '<div class="instance-actions">' +
          '<a class="btn btn-secondary btn-sm" href="https://console.green-api.com/instanceList/' + id + '" target="_blank" rel="noopener noreferrer">Console</a>' +
          '<button class="btn btn-secondary btn-sm" type="button" data-action="rename" data-id="' + id + '">Rename</button>' +
          '<button class="btn btn-ghost-danger btn-sm" type="button" data-action="delete" data-id="' + id + '">Remove</button>' +
          '</div></div></div>';
      }

      onListClick(event) {
        var button = event.target.closest('[data-action]');
        if (!button) return;
        var action = button.getAttribute('data-action');
        var id = button.getAttribute('data-id');
        if (action === 'rename') {
          this.editing = id;
          this.renderInstances();
          var input = document.querySelector('.rename input');
          if (input) {
            input.focus();
            input.select();
          }
        } else if (action === 'cancel-rename') {
          this.editing = null;
          this.renderInstances();
        } else if (action === 'delete') {
          this.removeInstance(id);
        }
      }

      async onRename(event) {
        event.preventDefault();
        var form = event.target;
        var id = form.getAttribute('data-id');
        var name = form.elements.name.value.trim();
        if (!name) return;
        try {
          var response = await this.request('/api/instances/' + encodeURIComponent(id), {
            method: 'PATCH',
            body: JSON.stringify({name: name})
          });
          var result = await response.json();
          if (!response.ok || !result.success) throw new Error(result.message || 'Could not rename the instance');
          this.editing = null;
          await this.loadInstances();
        } catch (error) {
          await modal.error(errorText(error), 'Rename failed');
        }
      }

      async removeInstance(id) {
        var instance = this.instances.find((item) => item.id === id);
        var confirmed = await modal.confirm(
          (instance ? instance.name : id) + ' will stop sending WhatsApp messages and calls to this account. Conversations that are already here stay.',
          'Remove this instance?',
          'Remove'
        );
        if (!confirmed) return;
        try {
          var response = await this.request('/api/instances/' + encodeURIComponent(id), {method: 'DELETE'});
          var result = await response.json();
          if (!response.ok || !result.success) throw new Error(result.message || 'Could not remove the instance');
          await this.loadInstances();
        } catch (error) {
          await modal.error(errorText(error), 'Remove failed');
        }
      }

      toggleAddForm(open) {
        $('addPanel').hidden = !open;
        $('addToggle').hidden = open;
        if (open) {
          $('instanceId').focus();
        } else {
          $('addForm').reset();
          $('apiToken').type = 'password';
          $('tokenToggle').textContent = 'Show';
          $('addResult').innerHTML = '';
        }
      }

      async addInstance(event) {
        event.preventDefault();
        var submit = $('addSubmit');
        var resultBox = $('addResult');
        var payload = {
          locationId: this.locationId,
          instanceId: $('instanceId').value.trim(),
          apiToken: $('apiToken').value.trim(),
          name: $('instanceName').value.trim() || undefined
        };
        if (!/^[0-9]+$/.test(payload.instanceId)) {
          resultBox.innerHTML = '<div class="alert error">The instance ID is a number, like 1101123456.</div>';
          return;
        }
        submit.disabled = true;
        submit.textContent = 'Adding...';
        resultBox.innerHTML = '';
        try {
          var response = await this.request('/api/instances', {method: 'POST', body: JSON.stringify(payload)});
          var result = await response.json();
          if (!response.ok) throw new Error(result.message || 'Could not add the instance');
          this.toggleAddForm(false);
          await this.loadInstances();
        } catch (error) {
          resultBox.innerHTML = '<div class="alert error">' + esc(errorText(error)) + '</div>';
        } finally {
          submit.disabled = false;
          submit.textContent = 'Add instance';
        }
      }
    }

    var modal = new Modal();
    var app = new App();
  </script>
</body>
</html>
`;
