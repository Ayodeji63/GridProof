type GridProofMarkProps = {
  className?: string;
  size?: number;
};

export function GridProofMark({ className, size = 40 }: GridProofMarkProps) {
  return (
    <svg
      aria-hidden="true"
      className={className}
      fill="none"
      height={size}
      viewBox="0 0 48 48"
      width={size}
      xmlns="http://www.w3.org/2000/svg"
    >
      <path
        d="M24 3.5 41.25 13.4v19.2L24 42.5 6.75 32.6V13.4L24 3.5Z"
        fill="#D97706"
        stroke="#F59E0B"
        strokeLinejoin="round"
        strokeWidth="1.5"
      />
      <path
        d="M31.8 16.65A10.75 10.75 0 1 0 33.2 30.2"
        stroke="white"
        strokeLinecap="round"
        strokeWidth="3.7"
      />
      <path
        d="m25.4 25.3 3.7 3.65 6.65-8.2"
        stroke="white"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="3.7"
      />
      <circle cx="31.8" cy="16.65" fill="white" r="1.85" />
    </svg>
  );
}
