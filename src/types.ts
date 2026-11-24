export interface Run {
  text: string;
  /** Cor original do PDF em hex (#rrggbb) */
  color: string;
  bold?: boolean;
  italic?: boolean;
}

export type ElementKind = 'title' | 'line' | 'break';

export interface ScriptElement {
  kind: ElementKind;
  runs: Run[];
  /** Índice da música/seção a que pertence */
  section: number;
}

export interface Section {
  title: string;
  /** Duração alvo em segundos (modo duração por música). 0 = usar velocidade padrão */
  duration: number;
}

export interface Script {
  name: string;
  elements: ScriptElement[];
  sections: Section[];
  /** Cores encontradas: hex -> quantidade de caracteres */
  colors: Record<string, number>;
}
