export const CURRENCY = Object.freeze({
  code: 'XAF',
  label: 'FCFA',
  locale: 'en-US'
});

let currencyLabel = CURRENCY.label;
let numberFormatter = new Intl.NumberFormat(CURRENCY.locale, { maximumFractionDigits: 4 });

export function configureCurrency({ code, label, locale } = {}) {
  const safeLabel = typeof label === 'string' && label.trim() && label.trim().length <= 12
    ? label.trim()
    : CURRENCY.label;
  const safeLocale = typeof locale === 'string' && locale.trim()
    ? locale.trim()
    : CURRENCY.locale;

  try {
    numberFormatter = new Intl.NumberFormat(safeLocale, { maximumFractionDigits: 4 });
    currencyLabel = safeLabel;
  } catch {
    numberFormatter = new Intl.NumberFormat(CURRENCY.locale, { maximumFractionDigits: 4 });
    currencyLabel = CURRENCY.label;
  }

  return {
    code: typeof code === 'string' && /^[A-Z]{3}$/.test(code) ? code : CURRENCY.code,
    label: currencyLabel,
    locale: numberFormatter.resolvedOptions().locale
  };
}

export function formatCurrency(value) {
  const amount = typeof value === 'number'
    ? value
    : typeof value === 'string' && value.trim()
      ? Number(value)
      : Number.NaN;

  return Number.isFinite(amount)
    ? `${numberFormatter.format(amount)} ${currencyLabel}`
    : 'To be confirmed';
}
