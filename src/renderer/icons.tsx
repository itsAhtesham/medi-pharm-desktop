import React from 'react';
const paths = {
  home: (
    <>
      <path d="m3 10 9-7 9 7M5 9v12h14V9M9 21v-8h6v8" />
    </>
  ),
  users: (
    <>
      <circle cx="9" cy="7" r="3" />
      <path d="M3 21v-3a6 6 0 0 1 12 0v3M16 4a3 3 0 0 1 0 6m2 4a5 5 0 0 1 3 4v3" />
    </>
  ),
  pill: (
    <>
      <path d="m4 12 8-8a5.7 5.7 0 0 1 8 8l-8 8a5.7 5.7 0 0 1-8-8Zm4-4 8 8" />
    </>
  ),
  bag: (
    <>
      <path d="M4 7h16l1 14H3L4 7Zm4 0V5a4 4 0 0 1 8 0v2M8 12h8" />
    </>
  ),
  bell: (
    <>
      <path d="M5 17h14l-2-3V9a5 5 0 0 0-10 0v5l-2 3Zm5 3h4M12 2v2" />
    </>
  ),
  clock: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 6v6l4 2" />
    </>
  ),
  chart: (
    <>
      <path d="M3 3v18h18M7 16v-5m5 5V7m5 9V4" />
    </>
  ),
  history: (
    <>
      <path d="M3 11a9 9 0 1 1 2 7M3 4v7h7M12 7v5l4 3" />
    </>
  ),
  settings: (
    <>
      <path d="m9 3-1 3-3 1-2 4 2 2v4l4 3 3-1 3 1 4-3v-4l2-2-2-4-3-1-1-3H9Z" />
      <circle cx="12" cy="12" r="3" />
    </>
  ),
  plus: <path d="M12 4v16M4 12h16" />,
  search: (
    <>
      <circle cx="10" cy="10" r="7" />
      <path d="m16 16 5 5" />
    </>
  ),
  backup: (
    <>
      <path d="M4 13 7 4h10l3 9M4 13h16v7H4v-7Zm3 4h.01M12 6v5m-3-3 3 3 3-3" />
    </>
  ),
  download: (
    <>
      <path d="M12 3v12m-4-4 4 4 4-4M4 16v5h16v-5" />
    </>
  ),
  lock: (
    <>
      <rect x="5" y="10" width="14" height="11" rx="2" />
      <path d="M8 10V6a4 4 0 0 1 8 0v4M12 14v3" />
    </>
  ),
  shield: (
    <>
      <path d="m12 2 9 4v6c0 6-9 10-9 10S3 18 3 12V6l9-4Z" />
      <path d="m8 12 3 3 5-6" />
    </>
  ),
  arrow: <path d="M4 12h16m-6-6 6 6-6 6" />,
  activity: <path d="M2 12h5l3-8 4 16 3-8h5" />,
  menu: <path d="M4 6h16M4 12h16M4 18h16" />,
  check: <path d="m4 12 5 5L20 6" />,
};
export type IconName = keyof typeof paths;
export function Icon({ name, className = '' }: { name: IconName; className?: string }) {
  return (
    <svg
      className={`icon ${className}`}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      {paths[name]}
    </svg>
  );
}
