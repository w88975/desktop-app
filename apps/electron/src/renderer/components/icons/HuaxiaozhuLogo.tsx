interface HuaxiaozhuLogoProps {
  className?: string
}

/**
 * Huaxiaozhu pixel art logo - uses accent color from theme
 * Apply text-accent class to get the brand purple color
 */
export function HuaxiaozhuLogo({ className }: HuaxiaozhuLogoProps) {
  return (
    <svg
      viewBox="0 0 408 66"
      className={className}
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
    >
      <text
        x="0"
        y="51"
        fill="currentColor"
        fontFamily="Inter, system-ui, sans-serif"
        fontSize="52"
        fontWeight="700"
        letterSpacing="1"
      >
        HUAXIAOZHU
      </text>
    </svg>
  )
}
