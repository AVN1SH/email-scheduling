import type { SVGProps } from "react";

const paths = {
  attachment: (
    <path d="m8 13 7-7a3 3 0 0 1 4 4l-9 9a5 5 0 0 1-7-7l10-10a1 1 0 0 1 1.4 1.4L4.4 13.4a3 3 0 0 0 4.2 4.2l9-9a1 1 0 0 0-1.4-1.4l-7 7" />
  ),
  upload: <path d="M12 15V3m-4 4 4-4 4 4M4 15v6h16v-6" />,
  clock: (
    <>
      <circle cx="12" cy="12" r="8.5" />
      <path d="M12 7v5l3 2" />
    </>
  ),
  send: (
    <>
      <path d="m21 3-6.5 18-4-7.5L3 9.5 21 3Z" />
      <path d="m10.5 13.5 5-5" />
    </>
  ),
  star: (
    <path d="m12 3 2.8 5.8 6.4.9-4.6 4.5 1.1 6.3L12 17.5l-5.7 3 1.1-6.3-4.6-4.5 6.4-.9L12 3Z" />
  ),
  archive: (
    <>
      <path d="M5 8v12h14V8M3 4h18v4H3zM9 12h6" />
    </>
  ),
  trash: (
    <>
      <path d="M4 6h16M9 6V3h6v3M6 6l1 15h10l1-15M10 10v7M14 10v7" />
    </>
  ),
  back: (
    <>
      <path d="m10 5-7 7 7 7M3 12h18" />
    </>
  ),
  filter: <path d="M3 4h18l-7 8v7l-4 2v-9L3 4Z" />,
  refresh: (
    <>
      <path d="M20 4v6h-6M20 10a8 8 0 1 0 .3 5" />
    </>
  ),
  search: (
    <>
      <circle cx="10.5" cy="10.5" r="6.5" />
      <path d="m16 16 5 5" />
    </>
  ),
  chevronLeft: <path d="m15 5-7 7 7 7" />,
  chevronRight: <path d="m9 5 7 7-7 7" />,
  close: <path d="m6 6 12 12M6 18 18 6" />,
};
export function MailIcon({
  name,
  ...props
}: SVGProps<SVGSVGElement> & { name: keyof typeof paths }) {
  return (
    <svg
      width="18"
      height="18"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      {...props}
    >
      {paths[name]}
    </svg>
  );
}
