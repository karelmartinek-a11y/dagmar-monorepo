type Props = {
  className?: string;
};

export default function SignageKajovo({ className }: Props) {
  return (
    <img
      className={"kb-signage" + (className ? ` ${className}` : "")}
      src="/LOGO/assets/svg/logo-horizontal-dark.svg"
      alt="KájovoDagmar DOCHÁZKOVÝ SYSTÉM"
    />
  );
}
