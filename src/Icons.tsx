export function Icon({ name, size = 18 }: { name: string; size?: number }) {
  const paths: Record<string, React.ReactNode> = {
    plus: <path d="M12 5v14M5 12h14" />,
    arrow: <path d="m9 5 7 7-7 7M4 12h12" />,
    upload: (
      <>
        <path d="M12 16V3m-5 5 5-5 5 5M4 15v5h16v-5" />
      </>
    ),
    film: (
      <>
        <rect x="3" y="4" width="18" height="16" rx="2" />
        <path d="M7 4v16M17 4v16M3 9h4M3 15h4M17 9h4M17 15h4" />
      </>
    ),
    file: (
      <>
        <path d="M14 3H5v18h14V8zM14 3v6h5M8 13h8M8 17h5" />
      </>
    ),
    check: <path d="m5 12 4 4L19 6" />,
    play: <path d="m8 4 12 8-12 8z" />,
    pause: (
      <>
        <path d="M8 4v16M16 4v16" />
      </>
    ),
    close: <path d="m6 6 12 12M18 6 6 18" />,
    target: (
      <>
        <circle cx="12" cy="12" r="7" />
        <circle cx="12" cy="12" r="2" />
        <path d="M12 1v4m0 14v4M1 12h4m14 0h4" />
      </>
    ),
    download: <path d="M12 3v12m-5-5 5 5 5-5M4 17v4h16v-4" />,
    external: <path d="M14 3h7v7m0-7L10 14M10 4H4v16h16v-6" />,
    back: <path d="m14 5-7 7 7 7" />,
    spark: (
      <path d="m12 3 2.5 6.5L21 12l-6.5 2.5L12 21l-2.5-6.5L3 12l6.5-2.5z" />
    ),
    save: (
      <>
        <path d="M4 3h13l4 4v14H3V3zM7 3v6h10V3M7 21v-8h10v8" />
      </>
    ),
    info: (
      <>
        <circle cx="12" cy="12" r="9" />
        <path d="M12 11v6M12 7h.01" />
      </>
    ),
    sound: (
      <>
        <path d="m11 4-5 5H2v6h4l5 5zM16 9l6 6m0-6-6 6" />
      </>
    ),
    book: (
      <>
        <path d="M12 5c-4-3-8-2-10-1v15c4-2 7-1 10 1 3-2 6-3 10-1V4c-2-1-6-2-10 1Zm0 0v15" />
      </>
    ),
  };
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {paths[name] || paths.info}
    </svg>
  );
}
