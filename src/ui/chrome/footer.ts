import { html, type Html } from '../dom/html';

export function footer(): Html {
  return html`<footer class="foot">
    <div class="foot-row">
      <span>Works in Chrome, Edge, Opera (WebHID) · needs HTTPS or localhost</span>
      <span>Unofficial · educational · use at your own risk</span>
    </div>
    <p class="foot-note">
      An independent, educational project. Not official Pulsar software, and not affiliated with,
      endorsed by or connected to Pulsar Gaming Gears in any way; product names are used only to identify
      compatible hardware. Provided as is, without warranty of any kind. Writing to a device's configuration
      memory can leave it misconfigured: use at your own risk.
    </p>
  </footer>`;
}
