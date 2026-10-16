# Cesta pacienta bez ztráty informací

**RAKATHON 2026 · výzva VZP.** Klikací prototyp, který uzavírá informační smyčku mezi **referujícím lékařem**, **koordinátorem Komplexního onkologického centra (KOC)** a **revizním lékařem VZP**. Demo provede jeden případ – pan Josef Novák, 60 let, suspektní karcinom hlavy pankreatu – čtyřmi kroky:

<ol class="steps-overview">
<li><b>01</b><strong>Převzít</strong><br>Existující dokumentace z FHIR serveru nebo nahraných souborů – žádný velký nový formulář.</li>
<li><b>02</b><strong>Vytěžit</strong><br>AI připraví strukturovaný handover a pravidlo určí, co chybí. Lékař návrh zkontroluje a potvrdí.</li>
<li><b>03</b><strong>Koordinovat</strong><br>Koordinátor vidí stav, termín a kdo je „na tahu“. Pořadí úkolů hlídá systém.</li>
<li><b>04</b><strong>Zpětná vazba</strong><br>Závěr MDT se vrací lékaři i s původním kontextem, revizní lékař je informován automaticky, předání se potvrdí a případ uzavře.</li>
</ol>

<p class="principle">AI pouze připraví návrh → rozhoduje a potvrzuje člověk.</p>

## Obrazovky (v pořadí dema)

<ul class="screen-links">
<li><a href="#/gp"><strong>01 Referující lékař</strong><span>MUDr. Jana Dvořáková · demo 6. 1. 2026</span></a></li>
<li><a href="#/koordinator"><strong>02 Koordinátor KOC</strong><span>Bc. Petra Malá · demo 12. 1. 2026</span></a></li>
<li><a href="#/revizni"><strong>03 Revizní lékař VZP</strong><span>MUDr. Tomáš Beneš · demo 27. 1. 2026</span></a></li>
</ul>

## Demo scénář

1. **Reset demo** (tlačítko níže) → otevřete **Referující lékař**: načtou se zdroje z FHIR, po ~1 s se objeví AI handover a seznam 4 chybějících položek. Zvolte **ECOG = 1** → položka zmizí. Zaškrtněte potvrzení → **Potvrdit a odeslat do KOC**.
2. Otevřete **Koordinátor KOC**: pan Novák je ve frontě jako **nový** → **Převzít a spustit sadu** → objeví se 8 úkolů s odpovědnými a termíny, cesta případu se posune na krok 03. Označte jako hotové **CT** a **markery**; zkuste dokončit **1. MDT** před histologií → systém zablokuje: „Čeká na: Histologie z ERCP“.
3. Dokončete **histologii** a **1. MDT** → **Nahrát zprávu z MDT** (soubor nebo „Ukázková zpráva“) → **AI: strukturovat závěr** → upravte / potvrďte → **Odeslat referujícímu a reviznímu lékaři**. Za 4 s přijde simulované potvrzení od lékaře a případ se uzavře.
4. Otevřete **Revizní lékař VZP**: Novák je mezi nově předanými, s indikátory (21 / 1 / 14 / 6 dní), časovou osou s „oranžovým“ 1. MDT a AI souhrnem. Odešlete **dotaz na koordinátora** → objeví se ve vlákně zpráv na obrazovce koordinátora.

Koordinátor a revizní lékař zobrazují **připravený stav ke svému demo datu**, dokud živý průchod nedojde dál – demo tak funguje i bez kroku 1.

<demo-reset>
</demo-reset>

## Technika

Statický web: [docsify](https://docsify.js.org) vykresluje Markdown stránky, každá obrazovka skládá nativní Web Components (`/components`). Demo data jsou JSON v `/data` (pojmenovaná podle FHIR R4), stav dema se ukládá do `localStorage`. Vrstva LLM (`components/lib/llm.js`) má jednotné rozhraní kompatibilní s OpenAI; v prototypu běží jen `mock`. Kontrola úplnosti je pravidlo podle šablony, ne AI. Všechna data jsou **ilustrativní a anonymizovaná**.

Spuštění: `python3 -m http.server` nebo `npx docsify-cli serve .` v kořeni projektu.
