type Props = {
  className?: string;
};

/**
 * NEVYJEDNATELNÉ BRAND PRAVIDLO:
 * - Červená se smí používat pouze zde.
 * - Montserrat Bold se smí používat pouze zde.
 */
export default function SignageKajovo({ className }: Props) {
  return (
    <div className={"kb-signage" + (className ? ` ${className}` : "")} aria-label="Signace Kájovo">
      <span>Kájovo</span>
    </div>
  );
}
