export interface Signal {
  type: 'positive' | 'negative' | 'correction' | 'preference';
  confidence: number;
  context: string;
  learned?: string;
  timestamp: number;
}

export interface Pattern {
  category: string;
  preference: string;
  confidence: number;
  examples: string[];
  lastUpdated: number;
}

export interface LearnedContext {
  preferences: string;
  patterns: string;
  recentCorrections: string;
}

export interface Message {
  role: string;
  content: string;
}
