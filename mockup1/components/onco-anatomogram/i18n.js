// UI strings and organ / tissue names for <onco-anatomogram> (lang="cs" | "en").

export const STRINGS = {
  cs: {
    title: 'Anatomogram – nález a medikace',
    asOf: 'stav podkladů k',
    recalc: 'přepočítává se s každým výsledkem',
    pillFindings: 'nález', pillDrugs: 'léky',
    layer: 'Vrstva', all: 'Vše', findings: 'Nález', drugs: 'Léky',
    view: 'Výřez', body: 'Celé tělo', abdomen: 'Břicho a pánev',
    suspicionH: 'Podezření na nádor', suspicionSub: 'dle dosavadních nálezů',
    medsH: 'Současná medikace', medsSub: 'ADME – kde lék působí na orgány',
    ddiH: 'Možné lékové interakce', ddiSub: 'sdílený transportér / enzym',
    ddiPill: 'kandidát interakce', sharedPill: 'sdílený aktér',
    off: 'mimo nákres', none: 'žádné', noFinding: 'Bez nálezu v dosavadních podkladech.',
    noFindings: 'Žádné nálezy.', noDrugs: 'Bez medikace.', noSites: 'v databázi bez orgánových míst',
    spc: 'uvedeno v textu SPC', close: 'Zavřít detail orgánu', source: 'Zdroj',
    rule: 'Barvení je odvozeno pravidlem z nálezů a z databáze ADME, ne AI. Závěr formuluje MDT.',
    loadingDb: 'Načítám databázi ADME…', dbError: 'Databázi ADME se nepodařilo načíst', loadError: 'Anatomogram se nepodařilo načíst',
    notFound: 'lék nenalezen v databázi ADME',
    captionRed: 'podezření na nádor', captionBlue: 'orgány ovlivněné současnou medikací',
    attribution: 'Kresba EMBL-EBI Expression Atlas, CC BY 4.0.',
    legend: ['podezření / potvrzený nádor', 'infiltraci nelze vyloučit', 'sekundárně postiženo (obstrukce)', 'orgán ovlivněný současnou medikací', 'nález i medikace'],
    dbNote: (file, ev) => `pharmacolibrary ADME · ${file} · evidence: ${ev}. Skrytá místa: `,
    staticNote: 'Místa zadaná v datech (bez dotazu do databáze).',
    ddiText: (p, eff, gene, v) => `${p} ${eff.includes('inducer') ? 'indukuje' : 'inhibuje'} ${gene}, jehož substrátem je ${v}`,
    sharedText: (a, b, gene) => `${a} i ${b} jsou substráty ${gene}`,
  },
  en: {
    title: 'Anatomogram – findings and medication',
    asOf: 'findings as of',
    recalc: 'recomputed with every result',
    pillFindings: 'findings', pillDrugs: 'drugs',
    layer: 'Layer', all: 'All', findings: 'Findings', drugs: 'Drugs',
    view: 'View', body: 'Whole body', abdomen: 'Abdomen and pelvis',
    suspicionH: 'Suspicion of cancer', suspicionSub: 'from the findings so far',
    medsH: 'Current medication', medsSub: 'ADME – where each drug acts on organs',
    ddiH: 'Possible drug interactions', ddiSub: 'shared transporter / enzyme',
    ddiPill: 'interaction candidate', sharedPill: 'shared actor',
    off: 'not in drawing', none: 'none', noFinding: 'No finding so far.',
    noFindings: 'No findings.', noDrugs: 'No medication.', noSites: 'no organ sites in the database',
    spc: 'stated in the SPC text', close: 'Close organ detail', source: 'Source',
    rule: 'Colours are derived by rules from the findings and the ADME database, not by AI. The board makes the decision.',
    loadingDb: 'Loading the ADME database…', dbError: 'Could not load the ADME database', loadError: 'Could not load the anatomogram',
    notFound: 'drug not found in the ADME database',
    captionRed: 'suspicion of cancer', captionBlue: 'organs affected by current medication',
    attribution: 'Drawing EMBL-EBI Expression Atlas, CC BY 4.0.',
    legend: ['suspected / confirmed tumour', 'infiltration cannot be excluded', 'secondarily affected (obstruction)', 'organ affected by current medication', 'finding and medication'],
    dbNote: (file, ev) => `pharmacolibrary ADME · ${file} · evidence: ${ev}. Hidden sites: `,
    staticNote: 'Sites given in the data (no database query).',
    ddiText: (p, eff, gene, v) => `${p} ${eff.includes('inducer') ? 'induces' : 'inhibits'} ${gene}, of which ${v} is a substrate`,
    sharedText: (a, b, gene) => `${a} and ${b} are both substrates of ${gene}`,
  },
};

export const LEVELS = {
  confirmed: { rank: 5, tone: 'miss', cs: 'potvrzeno', en: 'confirmed' },
  suspect: { rank: 4, tone: 'miss', cs: 'podezření', en: 'suspected' },
  possible: { rank: 3, tone: 'miss', cs: 'nelze vyloučit', en: 'cannot be excluded' },
  related: { rank: 2, tone: 'warn', cs: 'sekundárně postiženo', en: 'secondarily affected' },
  excluded: { rank: 1, tone: 'ok', cs: 'vyloučeno', en: 'excluded' },
};

export const PROCESSES = {
  absorption: { cs: 'absorpce', en: 'absorption' },
  distribution: { cs: 'distribuce', en: 'distribution' },
  metabolism: { cs: 'metabolismus', en: 'metabolism' },
  excretion: { cs: 'vylučování', en: 'excretion' },
  target: { cs: 'cíl účinku', en: 'target' },
};

/** Organs of the pruned drawings, keyed by element id. */
export const ORGANS = {
  UBERON_0000955: { cs: 'mozek', en: 'brain' },
  UBERON_0001043: { cs: 'jícen', en: 'esophagus' },
  UBERON_0000977: { cs: 'pleura', en: 'pleura' },
  UBERON_0002048: { cs: 'plíce', en: 'lung' },
  UBERON_0000310: { cs: 'prsy', en: 'breast' },
  UBERON_0000948: { cs: 'srdce', en: 'heart' },
  UBERON_0002107: { cs: 'játra', en: 'liver' },
  UBERON_0002106: { cs: 'slezina', en: 'spleen' },
  UBERON_0000945: { cs: 'žaludek', en: 'stomach' },
  UBERON_0001155: { cs: 'tlusté střevo', en: 'colon' },
  UBERON_0002108: { cs: 'tenké střevo', en: 'small intestine' },
  UBERON_0001255: { cs: 'močový měchýř', en: 'urinary bladder' },
  UBERON_0002367: { cs: 'prostata', en: 'prostate gland' },
  UBERON_0002113: { cs: 'ledviny', en: 'kidney' },
  UBERON_0002369: { cs: 'nadledviny', en: 'adrenal gland' },
  UBERON_0002110: { cs: 'žlučník a žlučové cesty', en: 'gall bladder and bile ducts' },
  UBERON_0002114: { cs: 'duodenum', en: 'duodenum' },
  UBERON_0001264: { cs: 'pankreas', en: 'pancreas' },
  UBERON_0000029: { cs: 'lymfatické uzliny', en: 'lymph nodes' },
  UBERON_0000995: { cs: 'děloha', en: 'uterus' },
  UBERON_0003889: { cs: 'vejcovody', en: 'fallopian tubes' },
  UBERON_0000992: { cs: 'ovaria', en: 'ovaries' },
};

/** ADME tissue names (database vocabulary) in Czech; English is the database name itself. */
export const TISSUES_CS = {
  'adipose tissue': 'tuková tkáň', 'adrenal gland': 'nadledviny', 'bile duct': 'žlučové cesty', blood: 'krev',
  'blood-brain barrier': 'hematoencefalická bariéra', brain: 'mozek', heart: 'srdce', ileum: 'ileum', kidney: 'ledviny',
  liver: 'játra', lung: 'plíce', 'mammary gland': 'mléčná žláza', 'neuromuscular junction': 'nervosvalová ploténka',
  ovary: 'ovaria', placenta: 'placenta', platelet: 'trombocyty', 'prostate gland': 'prostata', 'skeletal muscle': 'kosterní sval',
  skin: 'kůže', 'small intestine': 'tenké střevo', stomach: 'žaludek', testis: 'varlata',
};

/** ADME tissue UBERON id -> drawing organ id, where the drawing uses a proxy organ. */
export const TISSUE_PROXY = {
  'UBERON:0002394': 'UBERON_0002110', // bile duct -> gall bladder
  'UBERON:0002116': 'UBERON_0002108', // ileum -> small intestine
  'UBERON:0001911': 'UBERON_0000310', // mammary gland -> breast (female drawing)
};
