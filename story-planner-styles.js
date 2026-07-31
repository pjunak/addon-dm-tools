export const STORY_PLANNER_STYLES = `
  <style>
    .addon-dm-tools .dmt-planner-shell{display:grid;gap:var(--space-4)}
    .addon-dm-tools .dmt-planner-heading{display:flex;align-items:flex-start;justify-content:space-between;gap:var(--space-4);flex-wrap:wrap}
    .addon-dm-tools .dmt-planner-heading h1{margin-bottom:var(--space-1)}
    .addon-dm-tools .dmt-planner-toolbar{display:flex;flex-wrap:wrap;gap:var(--space-2)}
    .addon-dm-tools .dmt-planner-workbench{display:grid;grid-template-columns:minmax(0,1fr) minmax(19rem,25rem);min-height:42rem;border:1px solid var(--border-subtle);border-radius:var(--radius-lg);overflow:hidden;background:var(--bg-raised);box-shadow:var(--shadow-md)}
    .addon-dm-tools .dmt-planner-stage{display:grid;grid-template-rows:auto minmax(36rem,72vh);min-width:0;background:var(--bg-base)}
    .addon-dm-tools .dmt-planner-stagebar{display:flex;align-items:center;justify-content:space-between;gap:var(--space-3);padding:var(--space-2) var(--space-3);border-bottom:1px solid var(--border-subtle);color:var(--text-muted);font-size:var(--text-xs)}
    .addon-dm-tools .dmt-planner-stagebar span{display:flex;align-items:center;gap:var(--space-2)}
    .addon-dm-tools .dmt-story-viewport{position:relative;overflow:auto;overscroll-behavior:contain;background-color:var(--bg-base)}
    .addon-dm-tools .dmt-story-canvas{position:relative;min-width:100%;min-height:100%;background-image:linear-gradient(to right,color-mix(in srgb,var(--border-subtle) 34%,transparent) 1px,transparent 1px),linear-gradient(to bottom,color-mix(in srgb,var(--border-subtle) 34%,transparent) 1px,transparent 1px);background-size:24px 24px}
    .addon-dm-tools .dmt-story-edges{position:absolute;inset:0;overflow:visible;pointer-events:none}
    .addon-dm-tools .dmt-story-edge{fill:none;stroke:var(--text-muted);stroke-width:2;marker-end:url(#dmt-arrow)}
    .addon-dm-tools .dmt-story-edge[data-kind="option"]{stroke:var(--accent-gold);stroke-dasharray:8 6}
    .addon-dm-tools .dmt-story-edge[data-rolled-up="true"]{opacity:.55;stroke-dasharray:4 5}
    .addon-dm-tools .dmt-story-edge-label{fill:var(--text-parchment);font-family:var(--font-ui);font-size:var(--text-xs);paint-order:stroke;stroke:var(--bg-base);stroke-width:6;stroke-linejoin:round}
    .addon-dm-tools .dmt-story-preview{fill:none;stroke:var(--accent-gold);stroke-width:2;stroke-dasharray:6 5;pointer-events:none}
    .addon-dm-tools .dmt-story-node{position:absolute;width:15rem;min-height:7.2rem;padding:var(--space-3);border:2px solid var(--accent-gold-dim);border-radius:var(--radius);background:var(--bg-raised);color:var(--text-parchment);box-shadow:var(--shadow-sm);cursor:grab;user-select:none;touch-action:none;transition:border-color var(--dur-fast) var(--ease-out),box-shadow var(--dur-fast) var(--ease-out),transform var(--dur-fast) var(--ease-out)}
    .addon-dm-tools .dmt-story-node:hover{border-color:var(--accent-gold);box-shadow:var(--shadow-md)}
    .addon-dm-tools .dmt-story-node:focus-visible,.addon-dm-tools .dmt-story-node.is-selected{outline:none;border-color:var(--accent-gold);box-shadow:0 0 0 3px color-mix(in srgb,var(--accent-gold) 25%,transparent),var(--shadow-md)}
    .addon-dm-tools .dmt-story-node:active{cursor:grabbing}
    .addon-dm-tools .dmt-story-node[data-kind="plotline"]{border-width:3px;background:color-mix(in srgb,var(--bg-raised) 90%,var(--accent-gold) 10%)}
    .addon-dm-tools .dmt-story-node[data-kind="quest"]{border-color:var(--color-info)}
    .addon-dm-tools .dmt-story-node[data-event-type="encounter"]{border-color:var(--color-danger)}
    .addon-dm-tools .dmt-story-node[data-event-type="puzzle"]{border-color:var(--color-mystery)}
    .addon-dm-tools .dmt-story-node[data-kind="branch"]{border-style:dashed;border-color:var(--accent-gold)}
    .addon-dm-tools .dmt-node-header{display:flex;align-items:flex-start;justify-content:space-between;gap:var(--space-2)}
    .addon-dm-tools .dmt-node-kind{color:var(--accent-gold);font-size:var(--text-xs);font-weight:700;letter-spacing:.08em;text-transform:uppercase}
    .addon-dm-tools .dmt-story-node h3{margin:var(--space-1) 0;color:var(--text-parchment);font-family:var(--font-title);font-size:var(--text-lg);line-height:1.15}
    .addon-dm-tools .dmt-story-node p{display:-webkit-box;overflow:hidden;margin:0;color:var(--text-muted);font-size:var(--text-xs);line-height:1.4;-webkit-box-orient:vertical;-webkit-line-clamp:2}
    .addon-dm-tools .dmt-node-meta{display:flex;flex-wrap:wrap;gap:var(--space-1);margin-top:var(--space-2)}
    .addon-dm-tools .dmt-node-marginalia{display:inline-grid;place-items:center;width:1.75rem;height:1.75rem;border:1px solid var(--accent-gold-dim);border-radius:50%;background:var(--bg-surface);color:var(--accent-gold);font-size:var(--text-xs)}
    .addon-dm-tools .dmt-node-port{position:absolute;right:-.7rem;top:50%;display:grid;place-items:center;width:1.4rem;height:1.4rem;padding:0;transform:translateY(-50%);border:2px solid var(--accent-gold);border-radius:50%;background:var(--bg-raised);color:transparent;cursor:crosshair}
    .addon-dm-tools .dmt-node-port:hover,.addon-dm-tools .dmt-node-port:focus-visible{background:var(--accent-gold);box-shadow:0 0 0 3px color-mix(in srgb,var(--accent-gold) 25%,transparent)}
    .addon-dm-tools .dmt-story-canvas.is-connecting .dmt-story-node{cursor:crosshair}
    .addon-dm-tools .dmt-planner-inspector{overflow:auto;padding:var(--space-4);border-left:1px solid var(--border-subtle);background:var(--bg-surface)}
    .addon-dm-tools .dmt-inspector-eyebrow{margin:0;color:var(--accent-gold);font-size:var(--text-xs);font-weight:700;letter-spacing:.08em;text-transform:uppercase}
    .addon-dm-tools .dmt-planner-inspector h2{margin:var(--space-1) 0 var(--space-2);color:var(--text-parchment)}
    .addon-dm-tools .dmt-inspector-actions,.addon-dm-tools .dmt-inspector-badges{display:flex;flex-wrap:wrap;gap:var(--space-2);margin-block:var(--space-3)}
    .addon-dm-tools .dmt-inspector-section{margin-top:var(--space-5);padding-top:var(--space-3);border-top:1px solid var(--border-subtle)}
    .addon-dm-tools .dmt-inspector-section h3{margin-top:0}
    .addon-dm-tools .dmt-marginalia{margin-left:var(--space-2);padding:var(--space-3);border-left:3px solid var(--accent-gold-dim);background:color-mix(in srgb,var(--bg-raised) 86%,transparent)}
    .addon-dm-tools .dmt-inspector-list{display:grid;gap:var(--space-2)}
    .addon-dm-tools .dmt-inspector-card{padding:var(--space-2);border:1px solid var(--border-subtle);border-radius:var(--radius-sm);background:var(--bg-raised)}
    .addon-dm-tools .dmt-inspector-card header{display:flex;justify-content:space-between;gap:var(--space-2)}
    .addon-dm-tools .dmt-inspector-card p{margin-bottom:0;color:var(--text-muted);font-size:var(--text-sm)}
    .addon-dm-tools .dmt-planner-form{display:grid;gap:var(--space-3)}
    .addon-dm-tools .dmt-planner-form label{display:grid;gap:var(--space-1);color:var(--text-muted);font-size:var(--text-sm)}
    .addon-dm-tools .dmt-planner-form-row{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:var(--space-2)}
    .addon-dm-tools .dmt-planner-form-actions{display:flex;flex-wrap:wrap;gap:var(--space-2)}
    .addon-dm-tools .dmt-inline-details{margin-top:var(--space-3)}
    .addon-dm-tools .dmt-inline-details>summary{min-height:2.75rem;color:var(--accent-gold);font-weight:700;cursor:pointer}
    .addon-dm-tools .dmt-flow-list{display:grid;gap:var(--space-1)}
    .addon-dm-tools .dmt-flow-row{display:grid;grid-template-columns:minmax(0,1fr) auto;align-items:center;gap:var(--space-2);padding:var(--space-2);border-bottom:1px solid var(--border-subtle)}
    .addon-dm-tools .dmt-detail-grid{display:grid;grid-template-columns:minmax(0,1fr) minmax(18rem,24rem);gap:var(--space-4);align-items:start}
    .addon-dm-tools .dmt-detail-aside{display:grid;gap:var(--space-4);position:sticky;top:var(--space-3)}
    .addon-dm-tools .dmt-empty-canvas{position:absolute;inset:0;display:grid;place-content:center;justify-items:center;padding:var(--space-5);text-align:center;color:var(--text-muted)}
    @media(max-width:1100px){
      .addon-dm-tools .dmt-planner-workbench{grid-template-columns:1fr}
      .addon-dm-tools .dmt-planner-inspector{border-left:0;border-top:1px solid var(--border-subtle);max-height:none}
      .addon-dm-tools .dmt-planner-stage{grid-template-rows:auto minmax(30rem,60vh)}
      .addon-dm-tools .dmt-detail-grid{grid-template-columns:1fr}
      .addon-dm-tools .dmt-detail-aside{position:static}
    }
    @media(max-width:768px){
      .addon-dm-tools .dmt-planner-stagebar{align-items:flex-start;flex-direction:column}
      .addon-dm-tools .dmt-planner-stage{grid-template-rows:auto minmax(28rem,55vh)}
      .addon-dm-tools .dmt-planner-form-row{grid-template-columns:1fr}
      .addon-dm-tools .dmt-story-node{width:13.5rem}
    }
  </style>
`;
