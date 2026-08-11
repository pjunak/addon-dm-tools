export const STORY_PLANNER_STYLES = `
  <style>
    .addon-dm-tools .dmt-planner-shell{display:grid;gap:var(--space-4)}
    .addon-dm-tools .dmt-planner-heading{display:flex;align-items:flex-start;justify-content:space-between;gap:var(--space-4);flex-wrap:wrap}
    .addon-dm-tools .dmt-planner-heading h1{margin-bottom:var(--space-1)}
    .addon-dm-tools .dmt-planner-workbench{display:grid;grid-template-columns:13.5rem minmax(0,1fr);height:max(42rem,75vh);border:1px solid var(--border-subtle);border-radius:var(--radius-lg);overflow:hidden;background:var(--bg-raised);box-shadow:var(--shadow-md)}
    .addon-dm-tools .dmt-atlas-dock{min-width:0;overflow:auto;padding:var(--space-3);border-right:1px solid var(--border-subtle);background:linear-gradient(180deg,color-mix(in srgb,var(--bg-surface) 92%,var(--accent-gold) 8%),var(--bg-surface))}
    .addon-dm-tools .dmt-atlas-title{display:flex;align-items:center;gap:var(--space-2);padding-bottom:var(--space-3);border-bottom:1px solid var(--border-subtle);color:var(--accent-gold);font-family:var(--font-title);letter-spacing:.04em}
    .addon-dm-tools .dmt-atlas-title span{display:grid;place-items:center;width:1.8rem;height:1.8rem;border:1px solid var(--accent-gold-dim);border-radius:50%}
    .addon-dm-tools .dmt-atlas-group{margin-top:var(--space-4)}
    .addon-dm-tools .dmt-atlas-group h2{margin:0 0 var(--space-2);color:var(--text-muted);font-family:var(--font-ui);font-size:var(--text-xs);letter-spacing:.11em;text-transform:uppercase}
    .addon-dm-tools .dmt-atlas-tools{display:grid;gap:var(--space-2)}
    .addon-dm-tools .dmt-atlas-tool{display:flex;align-items:center;gap:var(--space-2);width:100%;min-height:2.8rem;padding:var(--space-2) var(--space-3);border:2px solid var(--accent-gold-dim);border-radius:var(--radius-sm);background:var(--bg-raised);color:var(--text-parchment);font:inherit;font-weight:700;text-align:left;cursor:grab;transition:transform var(--dur-fast) var(--ease-out),box-shadow var(--dur-fast) var(--ease-out),background var(--dur-fast) var(--ease-out)}
    .addon-dm-tools .dmt-atlas-tool:hover,.addon-dm-tools .dmt-atlas-tool:focus-visible{outline:none;transform:translateY(-1px);background:color-mix(in srgb,var(--bg-raised) 88%,var(--accent-gold) 12%);box-shadow:var(--shadow-sm)}
    .addon-dm-tools .dmt-atlas-tool:active{cursor:grabbing}
    .addon-dm-tools .dmt-atlas-tool>span{display:grid;place-items:center;width:1.35rem;height:1.35rem;border:1px solid currentColor;border-radius:50%;font-size:var(--text-xs)}
    .addon-dm-tools .dmt-atlas-tool[data-kind="plotline"]{border-width:3px;border-color:var(--accent-gold);background:color-mix(in srgb,var(--bg-raised) 90%,var(--accent-gold) 10%)}
    .addon-dm-tools .dmt-atlas-tool[data-kind="quest"]{border-color:var(--color-info)}
    .addon-dm-tools .dmt-atlas-tool[data-event-type="encounter"]{border-color:var(--color-danger)}
    .addon-dm-tools .dmt-atlas-tool[data-event-type="puzzle"]{border-color:var(--color-mystery)}
    .addon-dm-tools .dmt-atlas-tool[data-kind="branch"]{border-style:dashed;border-color:var(--accent-gold)}
    .addon-dm-tools .dmt-atlas-hint{margin:var(--space-4) 0 0;color:var(--text-muted);font-size:var(--text-xs);line-height:1.45}
    .addon-dm-tools .dmt-planner-stage{display:grid;grid-template-rows:auto minmax(0,1fr);min-width:0;min-height:0;background:var(--bg-base)}
    .addon-dm-tools .dmt-planner-stagebar{display:flex;align-items:center;justify-content:space-between;gap:var(--space-3);padding:var(--space-2) var(--space-3);border-bottom:1px solid var(--border-subtle);color:var(--text-muted);font-size:var(--text-xs)}
    .addon-dm-tools .dmt-planner-stagebar span{display:flex;align-items:center;gap:var(--space-2)}
    .addon-dm-tools .dmt-stage-canvas-wrap{position:relative;min-width:0;min-height:0;overflow:hidden}
    .addon-dm-tools .dmt-story-viewport{position:absolute;inset:0;overflow:auto;overscroll-behavior:contain;background-color:var(--bg-base)}
    .addon-dm-tools .dmt-story-canvas{position:relative;min-width:100%;min-height:100%;background-image:linear-gradient(to right,color-mix(in srgb,var(--border-subtle) 34%,transparent) 1px,transparent 1px),linear-gradient(to bottom,color-mix(in srgb,var(--border-subtle) 34%,transparent) 1px,transparent 1px);background-size:24px 24px}
    .addon-dm-tools .dmt-story-edges{position:absolute;inset:0;overflow:visible;pointer-events:none}
    .addon-dm-tools .dmt-story-edge{fill:none;stroke:var(--text-muted);stroke-width:2;marker-end:url(#dmt-arrow);transition:stroke-width var(--dur-fast) var(--ease-out),stroke var(--dur-fast) var(--ease-out)}
    .addon-dm-tools .dmt-story-edge[data-kind="option"]{stroke:var(--accent-gold);stroke-dasharray:8 6}
    .addon-dm-tools .dmt-story-edge-group.is-selected .dmt-story-edge{stroke:var(--accent-gold);stroke-width:4;filter:drop-shadow(0 0 4px color-mix(in srgb,var(--accent-gold) 55%,transparent))}
    .addon-dm-tools .dmt-story-edge-hit{fill:none;stroke:transparent;stroke-width:18;pointer-events:stroke;cursor:pointer}
    .addon-dm-tools .dmt-story-edge-hit:focus-visible{outline:none;stroke:color-mix(in srgb,var(--accent-gold) 22%,transparent)}
    .addon-dm-tools .dmt-story-edge-label{fill:var(--text-parchment);font-family:var(--font-ui);font-size:var(--text-xs);paint-order:stroke;stroke:var(--bg-base);stroke-width:6;stroke-linejoin:round;pointer-events:none}
    .addon-dm-tools .dmt-story-preview{fill:none;stroke:var(--accent-gold);stroke-width:2;stroke-dasharray:6 5;pointer-events:none}
    .addon-dm-tools .dmt-story-node{position:absolute;width:15rem;min-height:7.2rem;padding:var(--space-3);border:2px solid var(--accent-gold-dim);border-radius:var(--radius);background:var(--bg-raised);color:var(--text-parchment);box-shadow:var(--shadow-sm);cursor:grab;user-select:none;touch-action:none;transition:box-shadow var(--dur-fast) var(--ease-out),transform var(--dur-fast) var(--ease-out)}
    .addon-dm-tools .dmt-story-node:hover{box-shadow:var(--shadow-md)}
    .addon-dm-tools .dmt-story-node:focus-visible{outline:2px solid var(--accent-gold);outline-offset:3px}
    .addon-dm-tools .dmt-story-node.is-selected{box-shadow:0 0 0 3px var(--bg-base),0 0 0 6px var(--accent-gold),var(--shadow-md)}
    .addon-dm-tools .dmt-story-node:active{cursor:grabbing}
    .addon-dm-tools .dmt-story-node[data-kind="plotline"]{border-width:3px;border-color:var(--accent-gold);background:color-mix(in srgb,var(--bg-raised) 90%,var(--accent-gold) 10%)}
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
    .addon-dm-tools .dmt-selection-marquee,.addon-dm-tools .dmt-selection-hull{position:absolute;z-index:4;border:1px solid var(--accent-gold);background:color-mix(in srgb,var(--accent-gold) 12%,transparent);pointer-events:none}
    .addon-dm-tools .dmt-selection-hull{border-style:dashed;background:transparent}
    .addon-dm-tools .dmt-selection-toolbar{position:absolute;z-index:8;left:50%;bottom:var(--space-4);display:flex;align-items:center;gap:var(--space-1);max-width:calc(100% - 2rem);padding:var(--space-1);transform:translateX(-50%);border:1px solid var(--accent-gold-dim);border-radius:999px;background:color-mix(in srgb,var(--bg-surface) 94%,transparent);box-shadow:var(--shadow-lg);backdrop-filter:blur(8px)}
    .addon-dm-tools .dmt-selection-toolbar span{padding-inline:var(--space-2);color:var(--text-muted);font-size:var(--text-xs);white-space:nowrap}
    .addon-dm-tools .dmt-selection-toolbar button{min-height:2.35rem;padding:var(--space-1) var(--space-3);border:0;border-radius:999px;background:var(--bg-raised);color:var(--text-parchment);cursor:pointer}
    .addon-dm-tools .dmt-selection-toolbar button:hover,.addon-dm-tools .dmt-selection-toolbar button:focus-visible{outline:1px solid var(--accent-gold);background:color-mix(in srgb,var(--bg-raised) 82%,var(--accent-gold) 18%)}
    .addon-dm-tools .dmt-selection-toolbar button.is-danger{color:var(--color-danger)}
    .addon-dm-tools .dmt-inspector-eyebrow{margin:0;color:var(--accent-gold);font-size:var(--text-xs);font-weight:700;letter-spacing:.08em;text-transform:uppercase}
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
    .addon-dm-tools .dmt-planner-modal,.addon-dm-tools .dmt-shortcuts-modal{position:fixed;z-index:var(--z-modal,1000);inset:0;display:grid;place-items:center;padding:var(--space-4)}
    .addon-dm-tools .dmt-shortcuts-modal[hidden]{display:none}
    .addon-dm-tools .dmt-planner-modal-backdrop{position:absolute;inset:0;width:100%;height:100%;padding:0;border:0;border-radius:0;background:color-mix(in srgb,#000 72%,transparent);cursor:default}
    .addon-dm-tools .dmt-planner-dialog,.addon-dm-tools .dmt-shortcuts-dialog{position:relative;display:grid;grid-template-rows:auto auto minmax(0,1fr);width:min(58rem,100%);max-height:min(52rem,calc(100vh - 2rem));border:1px solid var(--accent-gold-dim);border-radius:var(--radius-lg);overflow:hidden;background:var(--bg-surface);box-shadow:var(--shadow-lg)}
    .addon-dm-tools .dmt-planner-dialog-header,.addon-dm-tools .dmt-shortcuts-dialog header{display:flex;align-items:flex-start;justify-content:space-between;gap:var(--space-3);padding:var(--space-4);border-bottom:1px solid var(--border-subtle)}
    .addon-dm-tools .dmt-planner-dialog-header h2,.addon-dm-tools .dmt-shortcuts-dialog h2{margin:var(--space-1) 0 0;color:var(--text-parchment)}
    .addon-dm-tools .dmt-dialog-close,.addon-dm-tools .dmt-shortcuts-dialog header button{width:2.5rem;height:2.5rem;padding:0;border:1px solid var(--border-subtle);border-radius:50%;background:var(--bg-raised);color:var(--text-parchment);font-size:var(--text-xl);cursor:pointer}
    .addon-dm-tools .dmt-dialog-tabs{display:flex;gap:var(--space-1);padding:0 var(--space-4);border-bottom:1px solid var(--border-subtle)}
    .addon-dm-tools .dmt-dialog-tabs button{min-height:3rem;padding:0 var(--space-3);border:0;border-bottom:2px solid transparent;background:transparent;color:var(--text-muted);cursor:pointer}
    .addon-dm-tools .dmt-dialog-tabs button[aria-selected="true"]{border-bottom-color:var(--accent-gold);color:var(--accent-gold)}
    .addon-dm-tools .dmt-dialog-tabs button:disabled{opacity:.45;cursor:not-allowed}
    .addon-dm-tools .dmt-planner-dialog-body{min-height:0;overflow:auto;padding:var(--space-4)}
    .addon-dm-tools .dmt-planner-dialog-body>.dmt-inspector-section:first-child,.addon-dm-tools [role="tabpanel"]>.dmt-inspector-section:first-child{margin-top:0;padding-top:0;border-top:0}
    .addon-dm-tools .dmt-shortcuts-dialog{grid-template-rows:auto minmax(0,1fr);width:min(34rem,100%)}
    .addon-dm-tools .dmt-shortcuts-dialog dl{display:grid;gap:0;margin:0;padding:var(--space-3) var(--space-4) var(--space-4);overflow:auto}
    .addon-dm-tools .dmt-shortcuts-dialog dl>div{display:grid;grid-template-columns:minmax(8rem,auto) 1fr;align-items:center;gap:var(--space-3);padding:var(--space-2) 0;border-bottom:1px solid var(--border-subtle)}
    .addon-dm-tools .dmt-shortcuts-dialog dt,.addon-dm-tools .dmt-shortcuts-dialog dd{margin:0}
    .addon-dm-tools kbd{display:inline-block;min-width:1.7rem;padding:.18rem .4rem;border:1px solid var(--border-subtle);border-bottom-width:2px;border-radius:var(--radius-sm);background:var(--bg-raised);color:var(--text-parchment);font:inherit;font-size:var(--text-xs);text-align:center}
    .addon-dm-tools .dmt-detail-grid{display:grid;grid-template-columns:minmax(0,1fr) minmax(18rem,24rem);gap:var(--space-4);align-items:start}
    .addon-dm-tools .dmt-detail-aside{display:grid;gap:var(--space-4);position:sticky;top:var(--space-3)}
    .addon-dm-tools .dmt-empty-canvas{position:absolute;z-index:3;inset:0;display:grid;place-content:center;justify-items:center;padding:var(--space-5);text-align:center;color:var(--text-muted);pointer-events:none}
    @media(max-width:900px){
      .addon-dm-tools .dmt-planner-workbench{grid-template-columns:1fr;grid-template-rows:auto minmax(36rem,65vh);height:auto}
      .addon-dm-tools .dmt-atlas-dock{display:flex;align-items:flex-start;gap:var(--space-3);overflow-x:auto;padding:var(--space-2);border-right:0;border-bottom:1px solid var(--border-subtle)}
      .addon-dm-tools .dmt-atlas-title{flex:0 0 auto;padding:var(--space-2);border:0}
      .addon-dm-tools .dmt-atlas-group{flex:0 0 auto;margin:0}
      .addon-dm-tools .dmt-atlas-group h2{margin-left:var(--space-1)}
      .addon-dm-tools .dmt-atlas-tools{display:flex}
      .addon-dm-tools .dmt-atlas-tool{width:auto;min-width:max-content}
      .addon-dm-tools .dmt-atlas-hint{display:none}
      .addon-dm-tools .dmt-detail-grid{grid-template-columns:1fr}
      .addon-dm-tools .dmt-detail-aside{position:static}
    }
    @media(max-width:768px){
      .addon-dm-tools .dmt-planner-stagebar{align-items:flex-start;flex-direction:column}
      .addon-dm-tools .dmt-planner-form-row{grid-template-columns:1fr}
      .addon-dm-tools .dmt-story-node{width:13.5rem}
      .addon-dm-tools .dmt-selection-toolbar{right:var(--space-2);bottom:var(--space-2);left:var(--space-2);justify-content:flex-start;overflow-x:auto;transform:none;border-radius:var(--radius-lg)}
      .addon-dm-tools .dmt-planner-modal,.addon-dm-tools .dmt-shortcuts-modal{align-items:end;padding:0}
      .addon-dm-tools .dmt-planner-dialog,.addon-dm-tools .dmt-shortcuts-dialog{width:100%;max-height:92vh;border-radius:var(--radius-lg) var(--radius-lg) 0 0}
      .addon-dm-tools .dmt-dialog-tabs{overflow-x:auto}
    }
  </style>
`;
