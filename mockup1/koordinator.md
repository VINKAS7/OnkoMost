<app-header role="koordinator">
</app-header>

<kpi-strip src="data/queue.json">
</kpi-strip>

<div class="layout-queue">
<case-queue src="data/queue.json">
</case-queue>
<section class="detail" aria-label="Detail případu">
<case-header case-id="selected" role="koordinator">
</case-header>
<case-tracker case-id="selected"><tt-bar case-id="selected"></tt-bar></case-tracker>
<div class="detail-grid">
<div class="stack">
<task-plan case-id="selected">
</task-plan>
<mdt-upload case-id="selected">
</mdt-upload>
</div>
<div class="stack">
<missing-list case-id="selected" audience="koordinator">
</missing-list>
<handover-panel case-id="selected" compact>
</handover-panel>
<msg-thread case-id="selected">
</msg-thread>
</div>
</div>
</section>
</div>
