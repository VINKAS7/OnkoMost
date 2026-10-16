<app-header role="gp">
</app-header>

<div class="page-head">
<div>
<p class="eyebrow">Referování pacienta do komplexního onkologického centra</p>
<h1>Josef Novák, 60 let · suspektní tumor hlavy pankreatu</h1>
</div>
<p class="page-note">Koncept uložen 10:42 · vyplněno ručně jen <strong>2 pole</strong></p>
</div>

<case-tracker case-id="novak">
</case-tracker>

<gp-feedback case-id="novak">
</gp-feedback>

<div class="layout-2col">
<div class="stack">
<referral-form case-id="novak">
</referral-form>
<doc-sources>
<fhir-picker slot="fhir" case-id="novak" endpoint="https://iris.ambulance-benesov.cz/fhir/r4" patient="Patient/8842" src="data/fhir-bundle-novak.json">
</fhir-picker>
<doc-dropzone slot="upload" case-id="novak">
</doc-dropzone>
</doc-sources>
</div>
<div class="stack">
<handover-panel case-id="novak" src="data/handover-novak.json" editable>
</handover-panel>
<missing-list case-id="novak" audience="gp">
</missing-list>
<confirm-send case-id="novak">
</confirm-send>
</div>
</div>
