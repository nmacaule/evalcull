/**
 * PRD §2.11 tokens and DR-016's contrast table (80 rows), transcribed from
 * ../evalcull-internal/decisions/DR-016-visual-design-system.md on 6 Nov 2026,
 * with the pairs added by DR-018, DR-020 and DR-021 and the two diff-mark pairs
 * (PRD §2.11 Allowed pairings, amended 6 Nov 2026). This is the oracle: nothing
 * here is computed by the code under test.
 */

export type Theme = 'light' | 'dark';

export interface TokenValue {
  l: number;
  c: number;
  h: number;
  hex: string;
}

/** §2.11 colour tokens, oklch with the PRD's 8-bit hex. */
export const TOKENS: Record<string, Record<Theme, TokenValue>> = {
  "neutral-1": {
    "light": {
      "l": 0.99,
      "c": 0.003,
      "h": 280,
      "hex": "#FBFCFE"
    },
    "dark": {
      "l": 0.17,
      "c": 0.005,
      "h": 280,
      "hex": "#0F0F12"
    }
  },
  "neutral-2": {
    "light": {
      "l": 0.975,
      "c": 0.004,
      "h": 280,
      "hex": "#F6F6F9"
    },
    "dark": {
      "l": 0.2,
      "c": 0.006,
      "h": 280,
      "hex": "#151619"
    }
  },
  "neutral-3": {
    "light": {
      "l": 0.95,
      "c": 0.005,
      "h": 280,
      "hex": "#EEEEF2"
    },
    "dark": {
      "l": 0.24,
      "c": 0.007,
      "h": 280,
      "hex": "#1E1F23"
    }
  },
  "neutral-4": {
    "light": {
      "l": 0.92,
      "c": 0.006,
      "h": 280,
      "hex": "#E4E4E9"
    },
    "dark": {
      "l": 0.27,
      "c": 0.008,
      "h": 280,
      "hex": "#25262A"
    }
  },
  "neutral-5": {
    "light": {
      "l": 0.89,
      "c": 0.007,
      "h": 280,
      "hex": "#DADADF"
    },
    "dark": {
      "l": 0.3,
      "c": 0.009,
      "h": 280,
      "hex": "#2D2D32"
    }
  },
  "neutral-6": {
    "light": {
      "l": 0.85,
      "c": 0.008,
      "h": 280,
      "hex": "#CCCDD3"
    },
    "dark": {
      "l": 0.34,
      "c": 0.01,
      "h": 280,
      "hex": "#37373D"
    }
  },
  "neutral-7": {
    "light": {
      "l": 0.78,
      "c": 0.009,
      "h": 280,
      "hex": "#B6B7BD"
    },
    "dark": {
      "l": 0.4,
      "c": 0.011,
      "h": 280,
      "hex": "#46474E"
    }
  },
  "neutral-8": {
    "light": {
      "l": 0.68,
      "c": 0.01,
      "h": 280,
      "hex": "#97989F"
    },
    "dark": {
      "l": 0.48,
      "c": 0.012,
      "h": 280,
      "hex": "#5C5D64"
    }
  },
  "neutral-9": {
    "light": {
      "l": 0.56,
      "c": 0.01,
      "h": 280,
      "hex": "#73747A"
    },
    "dark": {
      "l": 0.56,
      "c": 0.012,
      "h": 280,
      "hex": "#73747C"
    }
  },
  "neutral-10": {
    "light": {
      "l": 0.51,
      "c": 0.01,
      "h": 280,
      "hex": "#65666C"
    },
    "dark": {
      "l": 0.61,
      "c": 0.012,
      "h": 280,
      "hex": "#81828A"
    }
  },
  "neutral-11": {
    "light": {
      "l": 0.42,
      "c": 0.01,
      "h": 280,
      "hex": "#4C4D53"
    },
    "dark": {
      "l": 0.86,
      "c": 0.01,
      "h": 280,
      "hex": "#CFD0D8"
    }
  },
  "neutral-12": {
    "light": {
      "l": 0.2,
      "c": 0.01,
      "h": 280,
      "hex": "#15161B"
    },
    "dark": {
      "l": 0.93,
      "c": 0.006,
      "h": 280,
      "hex": "#E7E7EC"
    }
  },
  "accent-1": {
    "light": {
      "l": 0.99,
      "c": 0.004,
      "h": 280,
      "hex": "#FBFBFE"
    },
    "dark": {
      "l": 0.18,
      "c": 0.02,
      "h": 280,
      "hex": "#10111A"
    }
  },
  "accent-2": {
    "light": {
      "l": 0.975,
      "c": 0.011,
      "h": 280,
      "hex": "#F5F6FE"
    },
    "dark": {
      "l": 0.21,
      "c": 0.03,
      "h": 280,
      "hex": "#161726"
    }
  },
  "accent-3": {
    "light": {
      "l": 0.95,
      "c": 0.024,
      "h": 280,
      "hex": "#EBEDFF"
    },
    "dark": {
      "l": 0.26,
      "c": 0.06,
      "h": 280,
      "hex": "#1F2040"
    }
  },
  "accent-4": {
    "light": {
      "l": 0.91,
      "c": 0.044,
      "h": 280,
      "hex": "#DBDFFF"
    },
    "dark": {
      "l": 0.3,
      "c": 0.08,
      "h": 280,
      "hex": "#272755"
    }
  },
  "accent-5": {
    "light": {
      "l": 0.87,
      "c": 0.064,
      "h": 280,
      "hex": "#CBD0FE"
    },
    "dark": {
      "l": 0.34,
      "c": 0.1,
      "h": 280,
      "hex": "#2F2F6A"
    }
  },
  "accent-6": {
    "light": {
      "l": 0.82,
      "c": 0.091,
      "h": 280,
      "hex": "#B8BEFF"
    },
    "dark": {
      "l": 0.4,
      "c": 0.12,
      "h": 280,
      "hex": "#3D3C86"
    }
  },
  "accent-7": {
    "light": {
      "l": 0.74,
      "c": 0.136,
      "h": 280,
      "hex": "#9BA0FF"
    },
    "dark": {
      "l": 0.48,
      "c": 0.13,
      "h": 280,
      "hex": "#5152A4"
    }
  },
  "accent-8": {
    "light": {
      "l": 0.65,
      "c": 0.16,
      "h": 280,
      "hex": "#7E80EE"
    },
    "dark": {
      "l": 0.57,
      "c": 0.14,
      "h": 280,
      "hex": "#696BC7"
    }
  },
  "accent-9": {
    "light": {
      "l": 0.55,
      "c": 0.17,
      "h": 280,
      "hex": "#6260D1"
    },
    "dark": {
      "l": 0.66,
      "c": 0.14,
      "h": 280,
      "hex": "#8286E6"
    }
  },
  "accent-10": {
    "light": {
      "l": 0.5,
      "c": 0.17,
      "h": 280,
      "hex": "#5550C0"
    },
    "dark": {
      "l": 0.71,
      "c": 0.13,
      "h": 280,
      "hex": "#9297F1"
    }
  },
  "accent-11": {
    "light": {
      "l": 0.46,
      "c": 0.15,
      "h": 280,
      "hex": "#4B48A8"
    },
    "dark": {
      "l": 0.8,
      "c": 0.102,
      "h": 280,
      "hex": "#B0B7FF"
    }
  },
  "accent-12": {
    "light": {
      "l": 0.28,
      "c": 0.1,
      "h": 280,
      "hex": "#221F58"
    },
    "dark": {
      "l": 0.92,
      "c": 0.039,
      "h": 280,
      "hex": "#DFE2FF"
    }
  },
  "status-kept": {
    "light": {
      "l": 0.44,
      "c": 0.12,
      "h": 150,
      "hex": "#03642B"
    },
    "dark": {
      "l": 0.845,
      "c": 0.09,
      "h": 150,
      "hex": "#A2DDAD"
    }
  },
  "status-rejected": {
    "light": {
      "l": 0.46,
      "c": 0.12,
      "h": 25,
      "hex": "#8F3734"
    },
    "dark": {
      "l": 0.86,
      "c": 0.075,
      "h": 25,
      "hex": "#FFBFB8"
    }
  },
  "status-edited": {
    "light": {
      "l": 0.455,
      "c": 0.095,
      "h": 75,
      "hex": "#754E02"
    },
    "dark": {
      "l": 0.86,
      "c": 0.09,
      "h": 75,
      "hex": "#F4C98E"
    }
  },
  "status-preferred": {
    "light": {
      "l": 0.45,
      "c": 0.113,
      "h": 245,
      "hex": "#01598F"
    },
    "dark": {
      "l": 0.85,
      "c": 0.079,
      "h": 245,
      "hex": "#A3D4FF"
    }
  },
  "diff-insert-bg": {
    "light": {
      "l": 0.95,
      "c": 0.03,
      "h": 150,
      "hex": "#E1F5E4"
    },
    "dark": {
      "l": 0.235,
      "c": 0.04,
      "h": 150,
      "hex": "#0F2314"
    }
  },
  "diff-delete-bg": {
    "light": {
      "l": 0.95,
      "c": 0.024,
      "h": 25,
      "hex": "#FEE9E6"
    },
    "dark": {
      "l": 0.235,
      "c": 0.04,
      "h": 25,
      "hex": "#2F1614"
    }
  }
};

/** White on the primary-action fills (§2.11 Semantics), the on-primary token. */
export const ON_PRIMARY: TokenValue = { l: 1, c: 0, h: 0, hex: '#FFFFFF' };

/** The scrim (O17 amended 6 Nov 2026): black at 40 % in both themes. */
export const SCRIM = { l: 0, c: 0, h: 0, alpha: 0.4 };

export interface ContrastRow {
  theme: Theme;
  fg: string;
  bg: string;
  use: string;
  /** WCAG 2 ratio as DR-016 prints it, 2 decimals */
  ratio: number;
  /** APCA Lc magnitude as DR-016 prints it, 1 decimal */
  lc: number;
}

/** DR-016's contrast check, row for row. */
export const DR016_ROWS: ContrastRow[] = [
  {
    "theme": "light",
    "fg": "neutral-12",
    "bg": "neutral-1",
    "use": "content text, 14 px",
    "ratio": 17.6,
    "lc": 103
  },
  {
    "theme": "light",
    "fg": "neutral-11",
    "bg": "neutral-1",
    "use": "secondary chrome text, 13 px; labels, 11 px",
    "ratio": 8.2,
    "lc": 87.2
  },
  {
    "theme": "light",
    "fg": "status-kept",
    "bg": "neutral-1",
    "use": "status word, 13 px",
    "ratio": 7.15,
    "lc": 83.1
  },
  {
    "theme": "light",
    "fg": "status-rejected",
    "bg": "neutral-1",
    "use": "status word, 13 px",
    "ratio": 7.4,
    "lc": 83.9
  },
  {
    "theme": "light",
    "fg": "status-edited",
    "bg": "neutral-1",
    "use": "status word, 13 px",
    "ratio": 7.19,
    "lc": 83.5
  },
  {
    "theme": "light",
    "fg": "status-preferred",
    "bg": "neutral-1",
    "use": "status word, 13 px",
    "ratio": 7.24,
    "lc": 83.4
  },
  {
    "theme": "light",
    "fg": "neutral-10",
    "bg": "neutral-1",
    "use": "disabled text (1.4.3 exempt)",
    "ratio": 5.57,
    "lc": 76.8
  },
  {
    "theme": "light",
    "fg": "neutral-9",
    "bg": "neutral-1",
    "use": "control border (non-text)",
    "ratio": 4.54,
    "lc": 70.5
  },
  {
    "theme": "light",
    "fg": "neutral-12",
    "bg": "neutral-2",
    "use": "content text, 14 px",
    "ratio": 16.75,
    "lc": 99.5
  },
  {
    "theme": "light",
    "fg": "neutral-11",
    "bg": "neutral-2",
    "use": "secondary chrome text, 13 px; labels, 11 px",
    "ratio": 7.81,
    "lc": 83.8
  },
  {
    "theme": "light",
    "fg": "status-kept",
    "bg": "neutral-2",
    "use": "status word, 13 px",
    "ratio": 6.8,
    "lc": 79.7
  },
  {
    "theme": "light",
    "fg": "status-rejected",
    "bg": "neutral-2",
    "use": "status word, 13 px",
    "ratio": 7.04,
    "lc": 80.5
  },
  {
    "theme": "light",
    "fg": "status-edited",
    "bg": "neutral-2",
    "use": "status word, 13 px",
    "ratio": 6.84,
    "lc": 80.1
  },
  {
    "theme": "light",
    "fg": "status-preferred",
    "bg": "neutral-2",
    "use": "status word, 13 px",
    "ratio": 6.89,
    "lc": 80
  },
  {
    "theme": "light",
    "fg": "neutral-10",
    "bg": "neutral-2",
    "use": "disabled text (1.4.3 exempt)",
    "ratio": 5.3,
    "lc": 73.4
  },
  {
    "theme": "light",
    "fg": "neutral-9",
    "bg": "neutral-2",
    "use": "control border (non-text)",
    "ratio": 4.32,
    "lc": 67.1
  },
  {
    "theme": "light",
    "fg": "neutral-12",
    "bg": "neutral-3",
    "use": "content text, 14 px",
    "ratio": 15.61,
    "lc": 94.9
  },
  {
    "theme": "light",
    "fg": "neutral-11",
    "bg": "neutral-3",
    "use": "secondary chrome text, 13 px; labels, 11 px",
    "ratio": 7.28,
    "lc": 79.1
  },
  {
    "theme": "light",
    "fg": "status-kept",
    "bg": "neutral-3",
    "use": "status word, 13 px",
    "ratio": 6.34,
    "lc": 75
  },
  {
    "theme": "light",
    "fg": "status-rejected",
    "bg": "neutral-3",
    "use": "status word, 13 px",
    "ratio": 6.57,
    "lc": 75.8
  },
  {
    "theme": "light",
    "fg": "status-edited",
    "bg": "neutral-3",
    "use": "status word, 13 px",
    "ratio": 6.37,
    "lc": 75.4
  },
  {
    "theme": "light",
    "fg": "status-preferred",
    "bg": "neutral-3",
    "use": "status word, 13 px",
    "ratio": 6.42,
    "lc": 75.3
  },
  {
    "theme": "light",
    "fg": "neutral-10",
    "bg": "neutral-3",
    "use": "disabled text (1.4.3 exempt)",
    "ratio": 4.94,
    "lc": 68.7
  },
  {
    "theme": "light",
    "fg": "neutral-9",
    "bg": "neutral-3",
    "use": "control border (non-text)",
    "ratio": 4.03,
    "lc": 62.5
  },
  {
    "theme": "light",
    "fg": "neutral-12",
    "bg": "neutral-4",
    "use": "row text, 13 px (hover)",
    "ratio": 14.26,
    "lc": 89.1
  },
  {
    "theme": "light",
    "fg": "neutral-12",
    "bg": "neutral-5",
    "use": "row text, 13 px (pressed)",
    "ratio": 12.97,
    "lc": 83.3
  },
  {
    "theme": "light",
    "fg": "neutral-12",
    "bg": "accent-3",
    "use": "row text, 13 px (selected)",
    "ratio": 15.56,
    "lc": 94.7
  },
  {
    "theme": "light",
    "fg": "neutral-12",
    "bg": "diff-insert-bg",
    "use": "diff line, 13 px mono",
    "ratio": 15.81,
    "lc": 95.7
  },
  {
    "theme": "light",
    "fg": "neutral-12",
    "bg": "diff-delete-bg",
    "use": "diff line, 13 px mono",
    "ratio": 15.49,
    "lc": 94.4
  },
  {
    "theme": "light",
    "fg": "status-kept",
    "bg": "diff-insert-bg",
    "use": "+ mark",
    "ratio": 6.42,
    "lc": 75.9
  },
  {
    "theme": "light",
    "fg": "status-rejected",
    "bg": "diff-delete-bg",
    "use": "− mark",
    "ratio": 6.52,
    "lc": 75.3
  },
  {
    "theme": "light",
    "fg": "white",
    "bg": "accent-9",
    "use": "primary action label",
    "ratio": 5.11,
    "lc": 80.3
  },
  {
    "theme": "light",
    "fg": "white",
    "bg": "accent-10",
    "use": "primary action label, hover",
    "ratio": 6.37,
    "lc": 86.4
  },
  {
    "theme": "light",
    "fg": "accent-9",
    "bg": "neutral-1",
    "use": "focus ring (non-text)",
    "ratio": 4.97,
    "lc": 73.1
  },
  {
    "theme": "light",
    "fg": "accent-9",
    "bg": "neutral-2",
    "use": "focus ring (non-text)",
    "ratio": 4.73,
    "lc": 69.7
  },
  {
    "theme": "light",
    "fg": "accent-9",
    "bg": "neutral-3",
    "use": "focus ring (non-text)",
    "ratio": 4.41,
    "lc": 65
  },
  {
    "theme": "light",
    "fg": "accent-9",
    "bg": "neutral-4",
    "use": "focus ring (non-text)",
    "ratio": 4.03,
    "lc": 59.2
  },
  {
    "theme": "light",
    "fg": "accent-9",
    "bg": "neutral-5",
    "use": "focus ring (non-text)",
    "ratio": 3.67,
    "lc": 53.5
  },
  {
    "theme": "light",
    "fg": "accent-9",
    "bg": "accent-3",
    "use": "focus ring (non-text)",
    "ratio": 4.4,
    "lc": 64.8
  },
  {
    "theme": "dark",
    "fg": "neutral-12",
    "bg": "neutral-1",
    "use": "content text, 14 px",
    "ratio": 15.53,
    "lc": 92.1
  },
  {
    "theme": "dark",
    "fg": "neutral-11",
    "bg": "neutral-1",
    "use": "secondary chrome text, 13 px; labels, 11 px",
    "ratio": 12.45,
    "lc": 77.9
  },
  {
    "theme": "dark",
    "fg": "status-kept",
    "bg": "neutral-1",
    "use": "status word, 13 px",
    "ratio": 12.29,
    "lc": 77.2
  },
  {
    "theme": "dark",
    "fg": "status-rejected",
    "bg": "neutral-1",
    "use": "status word, 13 px",
    "ratio": 12.21,
    "lc": 76.8
  },
  {
    "theme": "dark",
    "fg": "status-edited",
    "bg": "neutral-1",
    "use": "status word, 13 px",
    "ratio": 12.39,
    "lc": 77.7
  },
  {
    "theme": "dark",
    "fg": "status-preferred",
    "bg": "neutral-1",
    "use": "status word, 13 px",
    "ratio": 12.23,
    "lc": 76.9
  },
  {
    "theme": "dark",
    "fg": "neutral-10",
    "bg": "neutral-1",
    "use": "disabled text (1.4.3 exempt)",
    "ratio": 5.01,
    "lc": 35.5
  },
  {
    "theme": "dark",
    "fg": "neutral-9",
    "bg": "neutral-1",
    "use": "control border (non-text)",
    "ratio": 4.12,
    "lc": 29
  },
  {
    "theme": "dark",
    "fg": "neutral-12",
    "bg": "neutral-2",
    "use": "content text, 14 px",
    "ratio": 14.68,
    "lc": 91.6
  },
  {
    "theme": "dark",
    "fg": "neutral-11",
    "bg": "neutral-2",
    "use": "secondary chrome text, 13 px; labels, 11 px",
    "ratio": 11.77,
    "lc": 77.4
  },
  {
    "theme": "dark",
    "fg": "status-kept",
    "bg": "neutral-2",
    "use": "status word, 13 px",
    "ratio": 11.62,
    "lc": 76.6
  },
  {
    "theme": "dark",
    "fg": "status-rejected",
    "bg": "neutral-2",
    "use": "status word, 13 px",
    "ratio": 11.54,
    "lc": 76.3
  },
  {
    "theme": "dark",
    "fg": "status-edited",
    "bg": "neutral-2",
    "use": "status word, 13 px",
    "ratio": 11.71,
    "lc": 77.1
  },
  {
    "theme": "dark",
    "fg": "status-preferred",
    "bg": "neutral-2",
    "use": "status word, 13 px",
    "ratio": 11.56,
    "lc": 76.4
  },
  {
    "theme": "dark",
    "fg": "neutral-10",
    "bg": "neutral-2",
    "use": "disabled text (1.4.3 exempt)",
    "ratio": 4.73,
    "lc": 35
  },
  {
    "theme": "dark",
    "fg": "neutral-9",
    "bg": "neutral-2",
    "use": "control border (non-text)",
    "ratio": 3.89,
    "lc": 28.5
  },
  {
    "theme": "dark",
    "fg": "neutral-12",
    "bg": "neutral-3",
    "use": "content text, 14 px",
    "ratio": 13.36,
    "lc": 90.5
  },
  {
    "theme": "dark",
    "fg": "neutral-11",
    "bg": "neutral-3",
    "use": "secondary chrome text, 13 px; labels, 11 px",
    "ratio": 10.72,
    "lc": 76.3
  },
  {
    "theme": "dark",
    "fg": "status-kept",
    "bg": "neutral-3",
    "use": "status word, 13 px",
    "ratio": 10.57,
    "lc": 75.6
  },
  {
    "theme": "dark",
    "fg": "status-rejected",
    "bg": "neutral-3",
    "use": "status word, 13 px",
    "ratio": 10.5,
    "lc": 75.2
  },
  {
    "theme": "dark",
    "fg": "status-edited",
    "bg": "neutral-3",
    "use": "status word, 13 px",
    "ratio": 10.66,
    "lc": 76.1
  },
  {
    "theme": "dark",
    "fg": "status-preferred",
    "bg": "neutral-3",
    "use": "status word, 13 px",
    "ratio": 10.52,
    "lc": 75.3
  },
  {
    "theme": "dark",
    "fg": "neutral-10",
    "bg": "neutral-3",
    "use": "disabled text (1.4.3 exempt)",
    "ratio": 4.31,
    "lc": 33.9
  },
  {
    "theme": "dark",
    "fg": "neutral-9",
    "bg": "neutral-3",
    "use": "control border (non-text)",
    "ratio": 3.54,
    "lc": 27.4
  },
  {
    "theme": "dark",
    "fg": "neutral-12",
    "bg": "neutral-4",
    "use": "row text, 13 px (hover)",
    "ratio": 12.26,
    "lc": 89.4
  },
  {
    "theme": "dark",
    "fg": "neutral-12",
    "bg": "neutral-5",
    "use": "row text, 13 px (pressed)",
    "ratio": 11.12,
    "lc": 88
  },
  {
    "theme": "dark",
    "fg": "neutral-12",
    "bg": "accent-3",
    "use": "row text, 13 px (selected)",
    "ratio": 12.73,
    "lc": 89.8
  },
  {
    "theme": "dark",
    "fg": "neutral-12",
    "bg": "diff-insert-bg",
    "use": "diff line, 13 px mono",
    "ratio": 13.41,
    "lc": 90.5
  },
  {
    "theme": "dark",
    "fg": "neutral-12",
    "bg": "diff-delete-bg",
    "use": "diff line, 13 px mono",
    "ratio": 13.68,
    "lc": 90.7
  },
  {
    "theme": "dark",
    "fg": "status-kept",
    "bg": "diff-insert-bg",
    "use": "+ mark",
    "ratio": 10.61,
    "lc": 75.5
  },
  {
    "theme": "dark",
    "fg": "status-rejected",
    "bg": "diff-delete-bg",
    "use": "− mark",
    "ratio": 10.75,
    "lc": 75.4
  },
  {
    "theme": "dark",
    "fg": "white",
    "bg": "accent-8",
    "use": "primary action label",
    "ratio": 4.64,
    "lc": 77.5
  },
  {
    "theme": "dark",
    "fg": "white",
    "bg": "accent-7",
    "use": "primary action label, hover",
    "ratio": 6.79,
    "lc": 88.2
  },
  {
    "theme": "dark",
    "fg": "accent-9",
    "bg": "neutral-1",
    "use": "focus ring (non-text)",
    "ratio": 5.92,
    "lc": 41.9
  },
  {
    "theme": "dark",
    "fg": "accent-9",
    "bg": "neutral-2",
    "use": "focus ring (non-text)",
    "ratio": 5.6,
    "lc": 41.4
  },
  {
    "theme": "dark",
    "fg": "accent-9",
    "bg": "neutral-3",
    "use": "focus ring (non-text)",
    "ratio": 5.1,
    "lc": 40.3
  },
  {
    "theme": "dark",
    "fg": "accent-9",
    "bg": "neutral-4",
    "use": "focus ring (non-text)",
    "ratio": 4.68,
    "lc": 39.2
  },
  {
    "theme": "dark",
    "fg": "accent-9",
    "bg": "neutral-5",
    "use": "focus ring (non-text)",
    "ratio": 4.24,
    "lc": 37.8
  },
  {
    "theme": "dark",
    "fg": "accent-9",
    "bg": "accent-3",
    "use": "focus ring (non-text)",
    "ratio": 4.86,
    "lc": 39.6
  }
];

/**
 * Pairs measured after DR-016 (PRD §2.11 Allowed pairings, 6 Nov 2026), by DR-016's
 * method, with an inline Node computation run on the PRD hex values before
 * e2e/design/colour.ts existed, so these figures are independent of it.
 */
export const ADDED_ROWS: ContrastRow[] = [
  { theme: 'light', fg: 'neutral-9', bg: 'neutral-3', use: 'progress fill on track (DR-018)', ratio: 4.03, lc: 62.5 },
  { theme: 'dark', fg: 'neutral-9', bg: 'neutral-3', use: 'progress fill on track (DR-018)', ratio: 3.54, lc: 27.4 },
  { theme: 'light', fg: 'neutral-12', bg: 'neutral-1', use: 'native control fill (DR-020)', ratio: 17.6, lc: 103.0 },
  { theme: 'light', fg: 'neutral-12', bg: 'neutral-2', use: 'native control fill (DR-020)', ratio: 16.75, lc: 99.5 },
  { theme: 'light', fg: 'neutral-12', bg: 'neutral-3', use: 'native control fill (DR-020)', ratio: 15.61, lc: 94.9 },
  { theme: 'dark', fg: 'neutral-12', bg: 'neutral-1', use: 'native control fill (DR-020)', ratio: 15.53, lc: 92.1 },
  { theme: 'dark', fg: 'neutral-12', bg: 'neutral-2', use: 'native control fill (DR-020)', ratio: 14.68, lc: 91.6 },
  { theme: 'dark', fg: 'neutral-12', bg: 'neutral-3', use: 'native control fill (DR-020)', ratio: 13.36, lc: 90.5 },
  { theme: 'light', fg: 'neutral-8', bg: 'neutral-1', use: 'hover border, supplemental (DR-021)', ratio: 2.8, lc: 53.1 },
  { theme: 'light', fg: 'neutral-8', bg: 'neutral-2', use: 'hover border, supplemental (DR-021)', ratio: 2.66, lc: 49.7 },
  { theme: 'light', fg: 'neutral-8', bg: 'neutral-3', use: 'hover border, supplemental (DR-021)', ratio: 2.48, lc: 45.0 },
  { theme: 'dark', fg: 'neutral-8', bg: 'neutral-1', use: 'hover border, supplemental (DR-021)', ratio: 2.92, lc: 19.0 },
  { theme: 'dark', fg: 'neutral-8', bg: 'neutral-2', use: 'hover border, supplemental (DR-021)', ratio: 2.76, lc: 18.5 },
  { theme: 'dark', fg: 'neutral-8', bg: 'neutral-3', use: 'hover border, supplemental (DR-021)', ratio: 2.51, lc: 17.4 },
];

const range = (from: number, to: number, scale: string) =>
  Array.from({ length: to - from + 1 }, (_, i) => `${scale}-${from + i}`);
const STATUS = ['status-kept', 'status-rejected', 'status-edited', 'status-preferred'];
const QUIET = range(1, 3, 'neutral');

/** §2.11 Allowed pairings for text: foreground token → the surfaces it may sit on. */
export const TEXT_PAIRS: Record<string, string[]> = {
  'neutral-12': [...range(1, 5, 'neutral'), 'accent-3', 'diff-insert-bg', 'diff-delete-bg'],
  'neutral-11': QUIET,
  'neutral-10': QUIET,
  ...Object.fromEntries(STATUS.map((s) => [s, QUIET])),
  'on-primary': [],
};
// The diff marks (PRD §2.11 Allowed pairings, erratum of 6 Nov 2026)
TEXT_PAIRS['status-kept'] = [...QUIET, 'diff-insert-bg'];
TEXT_PAIRS['status-rejected'] = [...QUIET, 'diff-delete-bg'];

/** The primary-action fill per theme (O4). */
export const PRIMARY_FILL: Record<Theme, { rest: string; hover: string }> = {
  light: { rest: 'accent-9', hover: 'accent-10' },
  dark: { rest: 'accent-8', hover: 'accent-7' },
};

/** §5 targets. Content is text at the text-content or text-reading size. */
export const TARGETS = {
  text: { wcag: 4.5 },
  content: { lc: 90 },
  chrome: { lc: 75 },
  disabled: { lc: 30 },
  nonText: { wcag: 3, lc: 15 },
} as const;

/**
 * DR-016 rows no screen renders, each with its reason; design.spec's coverage
 * check accepts these and fails on any other row it never observed.
 */
const ON_CARDS = 'status marks sit only on cards, which are neutral-2 or neutral-3 (§2.11 screens 3 and 4)'
const DISABLED_FILL = 'a disabled control keeps its neutral-3 fill (ui/button.tsx), so disabled text sits on neutral-3 only'
const RING_OUTSET =
  'the 2 px outset ring falls on the surface around an element, and no focusable element sits on a hovered, pressed or selected surface'
export const UNUSED: Record<string, string> = Object.fromEntries(
  (['light', 'dark'] as const).flatMap((theme) => [
    [`${theme} status-kept on neutral-1`, ON_CARDS],
    [`${theme} status-edited on neutral-1`, ON_CARDS],
    [`${theme} status-preferred on neutral-1`, ON_CARDS],
    [`${theme} neutral-10 on neutral-1`, DISABLED_FILL],
    [`${theme} neutral-10 on neutral-2`, DISABLED_FILL],
    [`${theme} accent-9 on neutral-4`, RING_OUTSET],
    [`${theme} accent-9 on neutral-5`, RING_OUTSET],
    [`${theme} accent-9 on accent-3`, RING_OUTSET],
  ])
);
