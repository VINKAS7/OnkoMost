<app-header role="koordinator">
</app-header>

<kpi-strip src="data/queue.json">
</kpi-strip>

<div class="layout-queue">
<case-queue src="data/queue.json" selected="novak">
</case-queue>
<section class="detail" aria-label="Detail případu">
<case-header case-id="novak" role="koordinator">
</case-header>
<case-tracker case-id="novak"><tt-bar case-id="novak"></tt-bar></case-tracker>
<div class="detail-grid">
<div class="stack">
<task-plan case-id="novak">
</task-plan>
<mdt-upload case-id="novak">
</mdt-upload>
</div>
<div class="stack">
<missing-list case-id="novak" audience="koordinator">
</missing-list>
<handover-panel case-id="novak" compact>
</handover-panel>
<msg-thread case-id="novak">
</msg-thread>
</div>
</div>
</section>
</div>
