import type { AppActions } from '../context';
import { html } from '../dom/html';
import type { Section } from './types';

const actions: AppActions = {
  'file.export': (ctx) => ctx.device.exportJson(),
  'file.pick': (ctx, e) => {
    const input = e.el as HTMLInputElement;
    const file = input.files?.[0];
    input.value = '';
    if (file) void ctx.device.importJson(file);
  },
  'file.drop': (ctx, e) => {
    const file = e.files?.[0];
    if (file) void ctx.device.importJson(file);
  },
};

export const profileSection: Section = {
  id: 'file',
  title: 'Profile file',
  meta: () => 'json',
  render: () => html`
    <p class="hint">Save every setting to a JSON file, or load one as a draft to review and apply. An export includes unapplied changes.</p>
    <div class="file-row">
      <button class="bb ink file-export" data-click="file.export">↓ Export .json</button>
      <label class="drop" data-drop="file.drop">
        <input type="file" accept="application/json,.json" data-change="file.pick" />
        <span>Drop a profile here</span><span class="mute">— or —</span><span class="tag">Browse…</span>
      </label>
    </div>`,
  actions,
};
