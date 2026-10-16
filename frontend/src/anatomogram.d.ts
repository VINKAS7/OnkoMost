// Types for @ebi-gene-expression-group/anatomogram (the package ships none).
declare module "@ebi-gene-expression-group/anatomogram" {
  import type { ComponentType } from "react";

  export interface AnatomogramProps {
    species: string;
    atlasUrl?: string;
    showIds?: string[];
    highlightIds?: string[];
    selectIds?: string[];
    showColour?: string;
    highlightColour?: string;
    selectColour?: string;
    showOpacity?: number;
    highlightOpacity?: number;
    selectOpacity?: number;
    onMouseOver?: (ids: string[]) => void;
    onMouseOut?: (ids: string[]) => void;
    onClick?: (ids: string[]) => void;
    onInjected?: (error: unknown, svg: SVGSVGElement) => void;
  }

  const Anatomogram: ComponentType<AnatomogramProps>;
  export default Anatomogram;
}
