import type { Meta, StoryObj } from '@storybook/react-vite';
import { useState } from 'react';

import { SealedFrame, type SealedCallResult } from '../Artifacts/SealedFrame';

/**
 * A page with a stand-in for the bridge the gateway writes into an app's
 * pages (`artifacts/frame.ts`): `conch.call(tool, input)` speaks exactly the
 * messages `SealedFrame` documents. One button calls on a press; the page
 * also calls once by itself, with nobody pressing anything, and again the
 * moment someone clicks elsewhere in Conch, and again after taking focus
 * back (trying to ride on that click).
 */
const page = `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Plant diary</title>
<style>body{font:15px system-ui;margin:16px;color-scheme:light dark}button{font:inherit;padding:6px 12px}</style>
<script>
var n=0,w={};
window.conch={call:function(tool,input){return new Promise(function(f){var id='c'+(++n);w[id]=f;parent.postMessage({conch:'artifact',call:{id:id,tool:tool,input:input||{}}},'*')})}};
addEventListener('message',function(e){if(e.source!==parent)return;var m=e.data;if(!m||m.conch!=='app-call'||!w[m.id])return;w[m.id](m.result);delete w[m.id]});
</script></head><body>
<p>Pressing the button logs a watering. The page also tries once by itself, a second after it opens.</p>
<button id="log" type="button">Log watering</button>
<p id="said" aria-live="polite"></p>
<script>
var said=document.getElementById('said');
document.getElementById('log').addEventListener('click',function(){conch.call('log_watering',{plant:'fern'}).then(function(r){said.textContent=r.ok?r.text:r.message})});
setTimeout(function(){conch.call('log_watering',{plant:'cactus'}).then(function(r){said.textContent=r.ok?r.text:r.message})},1000);
addEventListener('blur',function(){conch.call('log_watering',{plant:'sneaky'});setTimeout(function(){window.focus();document.getElementById('log').focus();conch.call('log_watering',{plant:'sneakier'})},50)});
</script></body></html>`;

const src = `data:text/html;charset=utf-8,${encodeURIComponent(page)}<!--`;

interface Logged {
  tool: string;
  plant: string;
  activated: boolean;
}

const meta = {
  title: 'Patterns/Conch apps/Page bridge',
  parameters: {
    layout: 'padded',
    docs: {
      description: {
        component:
          'A Conch app’s page calls its own app’s tools through `SealedFrame` (`onCall`, ADR 0061). A change goes by itself only while the person is pressing something in the page: the click inside the frame gives the panel transient user activation, and the frame has focus. A call the page makes by itself arrives without it, so Conch asks first. The log under the page shows what the panel saw.',
      },
    },
  },
} satisfies Meta;

export default meta;
type Story = StoryObj<typeof meta>;

export const PressOrNot: Story = {
  render: function PressOrNot() {
    const [log, setLog] = useState<Logged[]>([]);
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12, maxInlineSize: 560 }}>
        <SealedFrame
          src={src}
          title="Plant diary"
          initialHeight={180}
          onCall={async (tool, input, activated): Promise<SealedCallResult> => {
            const plant = typeof input.plant === 'string' ? input.plant : '?';
            setLog((l) => [...l, { tool, plant, activated }]);
            return activated
              ? { ok: true, text: `Logged: ${plant} watered.` }
              : {
                  ok: false,
                  reason: 'confirm',
                  message: `Plant diary wants to log ${plant}. Conch asks you first.`,
                };
          }}
        />
        <button type="button" data-testid="elsewhere" style={{ alignSelf: 'start' }}>
          Something else in Conch
        </button>
        <ol data-testid="bridge-log" style={{ margin: 0, fontSize: 13 }}>
          {log.map((entry, i) => (
            <li key={i} data-activated={entry.activated}>
              {entry.tool} {entry.plant}: {entry.activated ? 'pressed in the page' : 'no press'}
            </li>
          ))}
        </ol>
      </div>
    );
  },
};
