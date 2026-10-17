/** One chip = one extension. Several on a node means OR. */
export const FILE_FORMATS: { id: string; ext: string; hint?: string }[] = [
  { id: "pdf", ext: ".pdf" },
  { id: "docx", ext: ".docx" },
  { id: "doc", ext: ".doc" },
  { id: "dcm", ext: ".dcm", hint: "CT / X-ray / MRI / PET" },
  { id: "dicom", ext: ".dicom", hint: "CT / X-ray / MRI / PET" },
  { id: "jpg", ext: ".jpg", hint: "X-ray image" },
  { id: "jpeg", ext: ".jpeg", hint: "X-ray image" },
  { id: "png", ext: ".png" },
  { id: "tiff", ext: ".tiff" },
];

const BY_ID = Object.fromEntries(FILE_FORMATS.map((f) => [f.id, f]));

/** Old saved keys (docx, dicom, jpeg, any) → extension chips. */
const LEGACY: Record<string, string[]> = {
  docx: ["docx", "doc"],
  dicom: ["dcm", "dicom"],
  jpeg: ["jpg", "jpeg"],
  png: ["png"],
  tiff: ["tiff"],
  pdf: ["pdf"],
  any: FILE_FORMATS.map((f) => f.id),
};

export function expandFormats(value?: string[]): string[] {
  if (!value?.length || value.includes("any")) return FILE_FORMATS.map((f) => f.id);
  const out: string[] = [];
  for (const k of value) {
    for (const id of LEGACY[k] ?? (BY_ID[k] ? [k] : [])) {
      if (!out.includes(id)) out.push(id);
    }
  }
  return out;
}

export function formatLabel(id: string): string {
  return BY_ID[id]?.ext ?? (id.startsWith(".") ? id : `.${id}`);
}

export function formatHint(id: string): string {
  return BY_ID[id]?.hint ?? "";
}
