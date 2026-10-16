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
  // whole-body tissues
  UBERON_0000014: { cs: 'kůže', en: 'skin' },
  UBERON_0001013: { cs: 'tuková tkáň', en: 'adipose tissue' },
  UBERON_0001134: { cs: 'kosterní svaly', en: 'skeletal muscle' },
  UBERON_0002481: { cs: 'kosti', en: 'bone' },
  UBERON_0007844: { cs: 'chrupavka', en: 'cartilage' },
  UBERON_0002371: { cs: 'kostní dřeň', en: 'bone marrow' },
  UBERON_0001021: { cs: 'nervy', en: 'nerves' },
  UBERON_0002240: { cs: 'mícha', en: 'spinal cord' },
  UBERON_0000178: { cs: 'krev a cévy', en: 'blood and vessels' },
  UBERON_0000947: { cs: 'aorta', en: 'aorta' },
  UBERON_0001135: { cs: 'hladká svalovina', en: 'smooth muscle' },
  // head and neck
  UBERON_0000955: { cs: 'mozek', en: 'brain' },
  UBERON_0000007: { cs: 'hypofýza', en: 'pituitary gland' },
  UBERON_0000970: { cs: 'oči', en: 'eyes' },
  UBERON_0001044: { cs: 'slinné žlázy', en: 'salivary glands' },
  UBERON_0001831: { cs: 'příušní žláza', en: 'parotid gland' },
  UBERON_0001736: { cs: 'podčelistní žláza', en: 'submandibular gland' },
  UBERON_0002372: { cs: 'mandle', en: 'tonsils' },
  UBERON_0002046: { cs: 'štítná žláza', en: 'thyroid gland' },
  // chest
  UBERON_0003126: { cs: 'průdušnice', en: 'trachea' },
  UBERON_0002185: { cs: 'průdušky', en: 'bronchi' },
  UBERON_0001043: { cs: 'jícen', en: 'esophagus' },
  UBERON_0000977: { cs: 'pleura', en: 'pleura' },
  UBERON_0002048: { cs: 'plíce', en: 'lung' },
  UBERON_0000310: { cs: 'prsy', en: 'breast' },
  UBERON_0000948: { cs: 'srdce', en: 'heart' },
  UBERON_0001103: { cs: 'bránice', en: 'diaphragm' },
  // abdomen
  UBERON_0002107: { cs: 'játra', en: 'liver' },
  UBERON_0002106: { cs: 'slezina', en: 'spleen' },
  UBERON_0000945: { cs: 'žaludek', en: 'stomach' },
  UBERON_0001155: { cs: 'tlusté střevo', en: 'colon' },
  UBERON_0001153: { cs: 'slepé střevo', en: 'caecum' },
  UBERON_0001154: { cs: 'apendix', en: 'appendix' },
  UBERON_0002108: { cs: 'tenké střevo', en: 'small intestine' },
  UBERON_0002116: { cs: 'ileum', en: 'ileum' },
  UBERON_0001052: { cs: 'konečník', en: 'rectum' },
  UBERON_0001255: { cs: 'močový měchýř', en: 'urinary bladder' },
  UBERON_0002113: { cs: 'ledviny', en: 'kidney' },
  UBERON_0002369: { cs: 'nadledviny', en: 'adrenal gland' },
  UBERON_0002110: { cs: 'žlučník a žlučové cesty', en: 'gall bladder and bile ducts' },
  UBERON_0002114: { cs: 'duodenum', en: 'duodenum' },
  UBERON_0001264: { cs: 'pankreas', en: 'pancreas' },
  UBERON_0000029: { cs: 'lymfatické uzliny', en: 'lymph nodes' },
  // reproductive organs
  UBERON_0002367: { cs: 'prostata', en: 'prostate gland' },
  UBERON_0000998: { cs: 'semenné váčky', en: 'seminal vesicles' },
  UBERON_0001000: { cs: 'chámovody', en: 'vasa deferentia' },
  UBERON_0001301: { cs: 'nadvarlata', en: 'epididymis' },
  UBERON_0000473: { cs: 'varlata', en: 'testis' },
  UBERON_0000989: { cs: 'penis', en: 'penis' },
  UBERON_0000996: { cs: 'pochva', en: 'vagina' },
  UBERON_0000002: { cs: 'děložní hrdlo', en: 'uterine cervix' },
  UBERON_0000995: { cs: 'děloha', en: 'uterus' },
  UBERON_0001295: { cs: 'endometrium', en: 'endometrium' },
  UBERON_0003889: { cs: 'vejcovody', en: 'fallopian tubes' },
  UBERON_0000992: { cs: 'ovaria', en: 'ovaries' },
};

/** Tissues spanning the whole body: drawn fainter, and highlighted with a softer fill. */
export const WHOLE_BODY = new Set([
  'UBERON_0000014', 'UBERON_0001013', 'UBERON_0001134', 'UBERON_0002481', 'UBERON_0007844',
  'UBERON_0002371', 'UBERON_0001021', 'UBERON_0000178', 'UBERON_0001135',
]);

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
  'UBERON:0001911': 'UBERON_0000310', // mammary gland -> breast
  'UBERON:0002097': 'UBERON_0000014', // skin of body -> skin (zone of skin)
  'CL:0000233': 'UBERON_0000178', // platelet -> blood
  'UBERON:0011919': 'UBERON_0001134', // neuromuscular junction -> skeletal muscle
};
