import type { ReactNode } from 'react';

const P = ({ d, size = 16 }: { d: ReactNode; size?: number }) => (
  <svg
    width={size}
    height={size}
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.8"
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
  >
    {d}
  </svg>
);

export const IconSearch = () => (
  <P
    d={
      <>
        <circle cx="11" cy="11" r="7" />
        <path d="m20 20-3.5-3.5" />
      </>
    }
  />
);
export const IconCopy = () => (
  <P
    d={
      <>
        <rect x="9" y="9" width="11" height="11" rx="2" />
        <path d="M5 15V6a2 2 0 0 1 2-2h9" />
      </>
    }
  />
);
export const IconPlus = () => <P d={<path d="M12 5v14M5 12h14" />} />;
export const IconStar = ({ on }: { on?: boolean }) => (
  <svg
    width="16"
    height="16"
    viewBox="0 0 24 24"
    fill={on ? 'currentColor' : 'none'}
    stroke="currentColor"
    strokeWidth="1.8"
    strokeLinejoin="round"
    aria-hidden="true"
  >
    <path d="m12 3 2.7 5.6 6.1.9-4.4 4.3 1 6.1L12 17l-5.4 2.9 1-6.1L3.2 9.5l6.1-.9z" />
  </svg>
);
export const IconEdit = () => (
  <P
    d={
      <>
        <path d="M12 20h9" />
        <path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z" />
      </>
    }
  />
);
export const IconArchive = () => (
  <P
    d={
      <>
        <rect x="3" y="4" width="18" height="4" rx="1" />
        <path d="M5 8v11h14V8M10 12h4" />
      </>
    }
  />
);
export const IconList = () => (
  <P d={<path d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01" />} />
);
export const IconGrid = () => (
  <P
    d={
      <>
        <rect x="3" y="3" width="7" height="7" rx="1" />
        <rect x="14" y="3" width="7" height="7" rx="1" />
        <rect x="3" y="14" width="7" height="7" rx="1" />
        <rect x="14" y="14" width="7" height="7" rx="1" />
      </>
    }
  />
);
export const IconSun = () => (
  <P
    d={
      <>
        <circle cx="12" cy="12" r="4" />
        <path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" />
      </>
    }
  />
);
export const IconMoon = () => <P d={<path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z" />} />;
export const IconEye = ({ off }: { off?: boolean }) => (
  <P
    d={
      off ? (
        <>
          <path d="M3 3l18 18" />
          <path d="M10.6 6.1A10 10 0 0 1 12 6c6 0 9.5 6 9.5 6a17 17 0 0 1-3.1 3.7M6.6 6.6A16.5 16.5 0 0 0 2.5 12S6 18 12 18a9.7 9.7 0 0 0 4-.9" />
        </>
      ) : (
        <>
          <path d="M2.5 12S6 6 12 6s9.5 6 9.5 6-3.5 6-9.5 6S2.5 12 2.5 12z" />
          <circle cx="12" cy="12" r="3" />
        </>
      )
    }
  />
);
export const IconKey = () => (
  <P
    d={
      <>
        <circle cx="8" cy="15" r="4" />
        <path d="m11 12 9-9M16 7l3 3" />
      </>
    }
  />
);
export const IconHelp = () => (
  <P
    d={
      <>
        <circle cx="12" cy="12" r="9" />
        <path d="M9.5 9a2.5 2.5 0 1 1 3.5 2.3c-.7.3-1 .9-1 1.7M12 17h.01" />
      </>
    }
  />
);
export const IconHome = () => (
  <P d={<path d="m3 11 9-8 9 8v9a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z" />} />
);
export const IconTerminal = () => (
  <P
    d={
      <>
        <rect x="3" y="4" width="18" height="16" rx="2" />
        <path d="m7 9 3 3-3 3M13 15h4" />
      </>
    }
  />
);
export const IconBook = () => (
  <P d={<path d="M4 4.5A2.5 2.5 0 0 1 6.5 2H20v18H6.5A2.5 2.5 0 0 0 4 22zM4 4.5V22" />} />
);
export const IconFlask = () => (
  <P d={<path d="M9 2h6M10 2v6L4.5 19a2 2 0 0 0 1.8 3h11.4a2 2 0 0 0 1.8-3L14 8V2" />} />
);
export const IconFolder = () => (
  <P d={<path d="M3 6a2 2 0 0 1 2-2h4l2 3h8a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />} />
);
export const IconCalendar = () => (
  <P
    d={
      <>
        <rect x="3" y="4" width="18" height="17" rx="2" />
        <path d="M3 9h18M8 2v4M16 2v4" />
      </>
    }
  />
);
export const IconNote = () => (
  <P
    d={
      <>
        <path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z" />
        <path d="M14 3v5h5M9 13h6M9 17h4" />
      </>
    }
  />
);
export const IconCode = () => <P d={<path d="m8 8-5 4 5 4M16 8l5 4-5 4M14 4l-4 16" />} />;
export const IconImport = () => <P d={<path d="M12 3v12m0 0-4-4m4 4 4-4M4 17v3h16v-3" />} />;
export const IconGear = () => (
  <P
    d={
      <>
        <circle cx="12" cy="12" r="3" />
        <path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z" />
      </>
    }
  />
);
export const IconGraph = () => (
  <P
    d={
      <>
        <circle cx="6" cy="6" r="2.5" />
        <circle cx="18" cy="8" r="2.5" />
        <circle cx="12" cy="18" r="2.5" />
        <path d="M8 7l8 1M7 8l4 8M17 10l-4 6" />
      </>
    }
  />
);
export const IconStudy = () => (
  <P
    d={
      <>
        <rect x="3" y="5" width="14" height="11" rx="2" />
        <path d="M7 20h14V9M7 9h6M7 12h4" />
      </>
    }
  />
);
