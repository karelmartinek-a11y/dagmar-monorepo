import type { ExternalProvider } from "../api/types";

const providers: ExternalProvider[] = ["google", "apple"];

function GoogleLogo() {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" focusable="false">
      <path fill="#4285f4" d="M21.6 12.23c0-.71-.06-1.4-.18-2.05H12v3.87h5.38a4.6 4.6 0 0 1-2 3.02v2.51h3.24c1.89-1.74 2.98-4.31 2.98-7.35Z" />
      <path fill="#34a853" d="M12 22c2.7 0 4.97-.9 6.62-2.42l-3.24-2.51c-.89.6-2.03.96-3.38.96-2.6 0-4.81-1.76-5.6-4.13H3.07v2.59A10 10 0 0 0 12 22Z" />
      <path fill="#fbbc05" d="M6.4 13.9A6 6 0 0 1 6.09 12c0-.66.11-1.3.31-1.9V7.51H3.07A10 10 0 0 0 2 12c0 1.61.39 3.14 1.07 4.49L6.4 13.9Z" />
      <path fill="#ea4335" d="M12 5.98c1.47 0 2.79.5 3.82 1.49l2.87-2.87C16.96 2.99 14.7 2 12 2a10 10 0 0 0-8.93 5.51L6.4 10.1c.79-2.36 3-4.12 5.6-4.12Z" />
    </svg>
  );
}

function AppleLogo() {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" focusable="false">
      <path fill="currentColor" d="M16.7 12.87c.02-2.18 1.78-3.23 1.86-3.28a4 4 0 0 0-3.16-1.71c-1.33-.14-2.62.8-3.3.8-.69 0-1.73-.79-2.85-.76a4.2 4.2 0 0 0-3.55 2.16c-1.53 2.65-.39 6.55 1.08 8.69.73 1.04 1.58 2.2 2.7 2.16 1.09-.05 1.5-.7 2.81-.7 1.3 0 1.69.7 2.82.67 1.18-.02 1.91-1.04 2.61-2.1a8.7 8.7 0 0 0 1.2-2.44 3.76 3.76 0 0 1-2.22-3.49ZM14.53 6.47a3.8 3.8 0 0 0 .87-2.73 3.88 3.88 0 0 0-2.54 1.3 3.62 3.62 0 0 0-.9 2.63c.96.07 1.94-.49 2.57-1.2Z" />
    </svg>
  );
}

function ProviderLogo({ provider }: { provider: ExternalProvider }) {
  return provider === "google" ? <GoogleLogo /> : <AppleLogo />;
}

export function ExternalLoginButtons({
  enabled,
  getUrl,
  accountLabel,
}: {
  enabled: Partial<Record<ExternalProvider, boolean>> | undefined;
  getUrl: (provider: ExternalProvider) => string;
  accountLabel: string;
}) {
  return (
    <div className="external-login" aria-label="Alternativní přihlášení">
      <span>{accountLabel}</span>
      <div className="external-login__actions">
        {providers.map((provider) => {
          const label = `Přihlásit se přes ${provider === "google" ? "Google" : "Apple"}`;
          const content = <><ProviderLogo provider={provider} /><span className="sr-only">{label}</span></>;
          return enabled?.[provider] ? (
            <a
              key={provider}
              className={`button external-login__button external-login__button--${provider}`}
              href={getUrl(provider)}
              aria-label={label}
              title={label}
            >
              {content}
            </a>
          ) : (
            <button
              key={provider}
              type="button"
              className={`button external-login__button external-login__button--${provider}`}
              aria-label={label}
              title={`${label} — poskytovatel není nakonfigurován`}
              disabled
            >
              {content}
            </button>
          );
        })}
      </div>
    </div>
  );
}
