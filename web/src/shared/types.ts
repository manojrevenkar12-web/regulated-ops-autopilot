export interface Row { label: string; note: string; values: string[] }
export interface Caught { check: string; count: number }
export interface Work { design: string; hours: number; automatic: number; backlog: number; median_reply_h: number | null }
export interface Console { generated_from: string; designs: string[]; ledger: Row[]; caught: Caught[]; work: Work[] }
